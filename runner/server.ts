// Runner isolé : exécute les scripts de backup hors du conteneur de l'application.
// Il n'a ni la base, ni DB_ENCRYPTION_KEY, ni le NAS. L'application lui envoie un run par le socket
// (une ligne JSON) et reçoit le journal au fil de l'eau, puis le résultat ; elle lit ensuite $OUTPUT_DIR
// dans le volume partagé (monté en lecture seule chez elle) et ferme la connexion, ce qui nettoie le run.
//
// En root (production), chaque run tourne sous son propre uid/gid, dans une sandbox bubblewrap (sandbox.ts) :
// il ne voit ni les processus, ni les fichiers, ni les secrets d'un autre run, n'écrit que dans $OUTPUT_DIR et
// $TMPDIR, et ne joint que la base désignée pour son projet. Sans sandbox fonctionnelle, le runner ne démarre pas.
// Lancé par node directement (type stripping) : imports relatifs avec extension .ts.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRunEnv } from "../lib/runner/env.ts";
import { executeScript, type ExecResult } from "../lib/runner/execute.ts";
import { makeMasker } from "../lib/runner/mask.ts";
import { resolveTargets, systemResolver, type Resolver, type Target } from "../lib/runner/targets.ts";
import { bwrapArgs, hostsFileContent, initConfig, openRelays, SANDBOX_OUT, SANDBOX_TMP, selfTest, type Relays } from "./sandbox.ts";

export type RunRequest = {
  runId: number;
  script: string;
  secrets: Record<string, string>;
  projectSlug: string;
  stamp: string;
  tz: string;
  timeoutMs: number;
  exitGraceMs?: number;
  // Secret contenant l'URL de la base : ses hôtes et ports sont les seules destinations réseau du script.
  // null : aucun réseau.
  networkSecret: string | null;
};

export type RunnerMessage =
  | { t: "log"; d: string }
  | { t: "result"; exitCode: number | null; signal: string | null; timedOut: boolean; log: string; outDir: string }
  | { t: "error"; message: string };

const MAX_REQUEST_BYTES = 4_000_000;
const UID_BASE = 100_000;

// sandbox : false seulement hors production (tests sans root) ; le script tourne alors sans isolement réseau.
// maxRunBytes : taille maximale de $OUTPUT_DIR + $TMPDIR d'un run (le volume /work n'a pas de quota).
export type RunnerOptions = { workDir: string; appGid: number; sandbox: boolean; resolver?: Resolver; maxRunBytes?: number };

const DEFAULT_MAX_RUN_BYTES = 50 * 1024 ** 3;
const USAGE_CHECK_MS = 10_000;
// En dessous, le run en cours est arrêté, même sous sa taille maximale (plusieurs runs à la fois).
const MIN_FREE_BYTES = 1024 ** 3;

function isRoot(): boolean {
  return process.getuid?.() === 0;
}

// Un uid par run, jamais 0 ni celui de l'application ; recyclé après 900 000 runs (le précédent est fini et nettoyé).
export function runUid(runId: number): number {
  return UID_BASE + (runId % 900_000);
}

function parseRequest(line: string): RunRequest {
  const r = JSON.parse(line) as RunRequest;
  const ok =
    Number.isSafeInteger(r.runId) &&
    r.runId > 0 &&
    typeof r.script === "string" &&
    typeof r.projectSlug === "string" &&
    /^[a-z0-9-]{1,50}$/.test(r.projectSlug) &&
    typeof r.stamp === "string" &&
    /^[0-9_-]{1,32}$/.test(r.stamp) &&
    typeof r.tz === "string" &&
    Number.isSafeInteger(r.timeoutMs) &&
    r.timeoutMs > 0 &&
    typeof r.secrets === "object" &&
    r.secrets !== null &&
    Object.values(r.secrets).every((v) => typeof v === "string") &&
    (r.networkSecret === null || (typeof r.networkSecret === "string" && /^[A-Z_][A-Z0-9_]*$/.test(r.networkSecret)));
  if (!ok) throw new Error("requête invalide");
  return r;
}

// Lance une commande sous l'uid du run (sans shell utilisateur, sans secrets) et attend sa fin.
// cwd doit être traversable par root sans CAP_DAC_OVERRIDE : le chdir a lieu avant le changement d'uid.
function asRunUser(runId: number, args: string[], cwd: string): Promise<void> {
  const id = runUid(runId);
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      uid: id,
      gid: id,
      // Cast : le typage de Next impose NODE_ENV dans ProcessEnv, qu'on ne transmet volontairement pas.
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" } as Record<string, string> as NodeJS.ProcessEnv,
      stdio: "ignore",
    });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

// Taille de work + out, mesurée sous l'uid du run (root sans CAP_DAC_READ_SEARCH ne peut pas les parcourir).
// Une mesure incomplète (dossier rendu illisible par le script, du en échec) compte comme un dépassement :
// sinon un chmod 000 suffirait à cacher ce qu'il écrit.
function runUsageBytes(runId: number, base: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("du", ["-s", "-B1", "-x", "work", "out"], {
      cwd: base,
      uid: runUid(runId),
      gid: runUid(runId),
      env: { PATH: "/usr/bin:/bin" } as Record<string, string> as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve(Infinity));
    child.on("close", (code) => {
      const sizes = out.trim().split("\n").map((line) => Number(line.split("\t")[0]));
      resolve(code !== 0 || sizes.length !== 2 || sizes.some((n) => !Number.isFinite(n)) ? Infinity : sizes[0] + sizes[1]);
    });
  });
}

// Espace libre du volume /work : garde-fou commun, quelle que soit la façon dont les runs se partagent le disque.
async function freeBytes(dir: string): Promise<number> {
  try {
    const s = await fs.statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

export function parseMaxRunBytes(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("RUN_MAX_BYTES doit être un nombre d'octets entier et positif");
  return n;
}

// Tue tout ce qui tourne encore sous l'uid du run, y compris un démon sorti du groupe (setsid).
async function killRunUser(runId: number): Promise<void> {
  if (!isRoot()) return;
  await asRunUser(runId, ["bash", "-c", "kill -KILL -1 2>/dev/null; exit 0"], "/");
}

export async function cleanupRun(opts: RunnerOptions, runId: number): Promise<void> {
  const base = path.join(opts.workDir, String(runId));
  await killRunUser(runId);
  if (isRoot()) {
    // Sans CAP_DAC_OVERRIDE, root ne peut pas vider les dossiers du run : c'est l'uid du run qui le fait.
    for (const sub of ["work", "out"]) {
      await asRunUser(runId, ["find", sub, "-mindepth", "1", "-delete"], base).catch(() => {});
    }
  }
  await fs.rm(base, { recursive: true, force: true }).catch((e) => {
    console.error(`[runner] nettoyage du run ${runId} :`, e instanceof Error ? e.message : e);
  });
}

async function prepareRun(opts: RunnerOptions, req: RunRequest) {
  const base = path.join(opts.workDir, String(req.runId));
  await cleanupRun(opts, req.runId); // restes d'un run interrompu portant le même id
  const workDir = path.join(base, "work");
  const outDir = path.join(base, "out");
  const scriptPath = path.join(base, "script.sh");
  const root = isRoot();
  const id = runUid(req.runId);

  // base : root, traversable sans être listable. out : à l'uid du run, groupe de l'application (setgid) pour
  // qu'elle lise les sorties. work : à l'uid du run seul, traversable pour que le lanceur (root sans
  // CAP_DAC_OVERRIDE) puisse y entrer avant de changer d'uid.
  await fs.mkdir(base, { mode: 0o711 });
  await fs.chmod(base, 0o711);
  await fs.writeFile(scriptPath, req.script, { mode: 0o640 });
  for (const [dir, mode, gid] of [[workDir, 0o711, id], [outDir, 0o2750, opts.appGid]] as const) {
    await fs.mkdir(dir, { mode: 0o750 });
    if (root) {
      await fs.chmod(dir, mode);
      await fs.chown(dir, id, gid);
    }
  }
  if (root) await fs.chown(scriptPath, 0, id);
  return { base, workDir, outDir, scriptPath, uid: root ? id : undefined };
}

// URL de la base désignée : destinations autorisées, et valeur à donner au script (mongodb+srv développé).
async function networkFor(opts: RunnerOptions, req: RunRequest): Promise<{ secrets: Record<string, string>; targets: Target[] }> {
  if (req.networkSecret === null) return { secrets: req.secrets, targets: [] };
  const value = req.secrets[req.networkSecret];
  if (value === undefined) throw new Error(`le secret ${req.networkSecret} (URL de la base) est absent de l'environnement du projet`);
  const { url, targets } = await resolveTargets(value, opts.resolver ?? systemResolver);
  return { secrets: { ...req.secrets, [req.networkSecret]: url }, targets };
}

async function handleRun(opts: RunnerOptions, req: RunRequest, send: (m: RunnerMessage) => void) {
  const dirs = await prepareRun(opts, req);
  const { secrets, targets } = await networkFor(opts, req);
  // Valeurs d'origine et développées : les deux sont masquées.
  const mask = makeMasker([...Object.values(req.secrets), ...Object.values(secrets)]);
  let sent = 0;
  const onLog = (log: string) => {
    // Le journal ne fait que grandir : on n'envoie que la suite.
    if (log.length > sent) {
      send({ t: "log", d: log.slice(sent) });
      sent = log.length;
    }
  };
  const common = { scriptPath: dirs.scriptPath, timeoutMs: req.timeoutMs, exitGraceMs: req.exitGraceMs, tz: req.tz, mask, onLog };

  let relays: Relays | null = null;
  let result: ExecResult;
  // Au-delà de la taille maximale, le run est arrêté (sinon un script remplirait le disque de l'hôte, /data compris).
  const maxBytes = opts.maxRunBytes ?? DEFAULT_MAX_RUN_BYTES;
  let oversized = false;
  const watchdog =
    dirs.uid === undefined
      ? undefined
      : setInterval(() => {
          void Promise.all([runUsageBytes(req.runId, dirs.base), freeBytes(opts.workDir)]).then(([bytes, free]) => {
            if ((bytes > maxBytes || free < MIN_FREE_BYTES) && !oversized) {
              oversized = true;
              void killRunUser(req.runId);
            }
          });
        }, USAGE_CHECK_MS);
  try {
    if (opts.sandbox && dirs.uid !== undefined) {
      // chmod explicite : l'umask du runner (027) retirerait la lecture au script.
      for (const [name, content] of [["hosts", hostsFileContent(targets)], ["resolv.conf", ""]]) {
        await fs.writeFile(path.join(dirs.base, name), content);
        await fs.chmod(path.join(dirs.base, name), 0o644);
      }
      relays = await openRelays(path.join(dirs.base, "relay"), targets);
      const env = buildRunEnv({ secrets, outputDir: SANDBOX_OUT, homeDir: SANDBOX_TMP, projectSlug: req.projectSlug, stamp: req.stamp, tz: req.tz });
      result = await executeScript({
        ...common,
        cwd: "/",
        env: { PATH: "/usr/bin:/bin" },
        launcher: {
          file: "bwrap",
          args: bwrapArgs({
            scriptPath: dirs.scriptPath,
            workDir: dirs.workDir,
            outDir: dirs.outDir,
            hostsFile: path.join(dirs.base, "hosts"),
            resolvFile: path.join(dirs.base, "resolv.conf"),
            relayDir: path.join(dirs.base, "relay"),
          }),
          input: JSON.stringify(initConfig({ uid: dirs.uid, gid: dirs.uid, env, relays: relays.relays })),
        },
        notes: [
          targets.length === 0
            ? "Sandbox : aucun accès réseau"
            : `Sandbox : réseau limité à ${targets.map((t) => `${t.host ?? t.ip}:${t.port}`).join(", ")}`,
        ],
      });
    } else {
      result = await executeScript({
        ...common,
        cwd: dirs.workDir,
        env: buildRunEnv({ secrets, outputDir: dirs.outDir, homeDir: dirs.workDir, projectSlug: req.projectSlug, stamp: req.stamp, tz: req.tz }),
        uid: dirs.uid,
        gid: dirs.uid,
        notes: ["Sandbox désactivée (hors production) : réseau et fichiers non restreints"],
      });
    }
  } finally {
    clearInterval(watchdog);
    relays?.close();
  }
  if (oversized) {
    const limit = maxBytes >= 1024 ** 3 ? `${Math.round(maxBytes / 1024 ** 3)} Gio` : `${Math.round(maxBytes / 1024 ** 2)} Mio`;
    result = {
      ...result,
      exitCode: result.exitCode === 0 ? 1 : result.exitCode,
      log: result.log + `[runner] Arrêté : plus de ${limit} écrits dans $OUTPUT_DIR et $TMPDIR, dossier illisible, ou disque presque plein\n`,
    };
  }
  // Plus rien ne doit tourner (ni modifier les sorties) pendant que l'application les copie.
  await killRunUser(req.runId);
  if (dirs.uid !== undefined) {
    // Un script qui crée ses fichiers en 0600 les rendrait illisibles pour l'application.
    await asRunUser(req.runId, ["chmod", "-R", "g+rX", "out"], path.dirname(dirs.outDir));
  }
  send({
    t: "result",
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    log: result.log,
    outDir: dirs.outDir,
  });
}

function handleConnection(opts: RunnerOptions, sock: net.Socket) {
  let buffer = "";
  let runId: number | null = null;
  let started = false;
  const send = (m: RunnerMessage) => {
    if (!sock.destroyed) sock.write(JSON.stringify(m) + "\n");
  };

  sock.setEncoding("utf8");
  sock.on("data", (chunk: string) => {
    if (started) return;
    buffer += chunk;
    if (buffer.length > MAX_REQUEST_BYTES) {
      send({ t: "error", message: "requête trop grande" });
      sock.destroy();
      return;
    }
    const nl = buffer.indexOf("\n");
    if (nl < 0) return;
    started = true;
    let req: RunRequest;
    try {
      req = parseRequest(buffer.slice(0, nl));
    } catch (e) {
      send({ t: "error", message: e instanceof Error ? e.message : String(e) });
      sock.end();
      return;
    }
    runId = req.runId;
    handleRun(opts, req, send).catch((e) => {
      send({ t: "error", message: makeMasker(Object.values(req.secrets))(e instanceof Error ? e.message : String(e)) });
      sock.end();
    });
  });
  // L'application ferme la connexion une fois les sorties copiées (ou parce qu'elle a redémarré) :
  // on arrête tout ce qui reste du run et on supprime ses fichiers.
  sock.on("close", () => {
    if (runId !== null) void cleanupRun(opts, runId);
  });
  sock.on("error", () => {});
}

export async function startRunner(socketPath: string, opts: RunnerOptions): Promise<net.Server> {
  process.umask(0o027);
  if (opts.sandbox) await selfTest();
  await fs.mkdir(opts.workDir, { recursive: true });
  // Restes d'un runner arrêté en plein run.
  for (const name of await fs.readdir(opts.workDir)) {
    if (/^\d+$/.test(name)) await cleanupRun(opts, Number(name));
  }
  await fs.rm(socketPath, { force: true });
  const server = net.createServer((sock) => handleConnection(opts, sock));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  // Seule l'application (groupe appGid) peut se connecter ; les scripts tournent sous d'autres uid/gid.
  await fs.chmod(socketPath, 0o660);
  if (isRoot()) await fs.chown(socketPath, 0, opts.appGid);
  return server;
}

// Lancé directement (node runner/server.ts), pas importé par les tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const socketPath = process.env.RUNNER_SOCKET || "/run/bm/runner.sock";
  // En root (production), la sandbox est obligatoire : aucune variable ne la désactive.
  const opts: RunnerOptions = {
    workDir: process.env.WORK_DIR || "/work",
    appGid: Number(process.env.APP_GID || 1001),
    sandbox: isRoot(),
    maxRunBytes: parseMaxRunBytes(process.env.RUN_MAX_BYTES),
  };
  startRunner(socketPath, opts).then(
    () => console.log(`[runner] prêt sur ${socketPath}${opts.sandbox ? " (sandbox par run)" : " (SANS sandbox)"}`),
    (e) => {
      console.error("[runner] démarrage impossible :", e);
      process.exit(1);
    },
  );
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => process.exit(0));
}
