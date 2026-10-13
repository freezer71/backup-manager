// Runner isolé : exécute les scripts de backup hors du conteneur de l'application.
// Il n'a ni la base, ni DB_ENCRYPTION_KEY, ni le NAS. L'application lui envoie un run par le socket
// (une ligne JSON) et reçoit le journal au fil de l'eau, puis le résultat ; elle lit ensuite $OUTPUT_DIR
// dans le volume partagé (monté en lecture seule chez elle) et ferme la connexion, ce qui nettoie le run.
//
// En root (production), chaque run tourne sous son propre uid/gid : un script ne peut lire ni
// l'environnement (les secrets) ni les fichiers d'un autre run, ni joindre le socket.
// Lancé par node directement (type stripping) : imports relatifs avec extension .ts.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRunEnv } from "../lib/runner/env.ts";
import { executeScript } from "../lib/runner/execute.ts";
import { makeMasker } from "../lib/runner/mask.ts";

export type RunRequest = {
  runId: number;
  script: string;
  secrets: Record<string, string>;
  projectSlug: string;
  stamp: string;
  tz: string;
  timeoutMs: number;
  exitGraceMs?: number;
};

export type RunnerMessage =
  | { t: "log"; d: string }
  | { t: "result"; exitCode: number | null; signal: string | null; timedOut: boolean; log: string; outDir: string }
  | { t: "error"; message: string };

const MAX_REQUEST_BYTES = 4_000_000;
const UID_BASE = 100_000;

export type RunnerOptions = { workDir: string; appGid: number };

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
    Object.values(r.secrets).every((v) => typeof v === "string");
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

  // base : root, traversable sans être listable. work/out : à l'uid du run, groupe de l'application
  // (setgid) pour qu'elle lise les sorties ; les autres runs ne peuvent pas les lister.
  // work est traversable par tous : le lanceur y entre (chdir) en root, avant de changer d'uid.
  await fs.mkdir(base, { mode: 0o711 });
  await fs.chmod(base, 0o711);
  await fs.writeFile(scriptPath, req.script, { mode: 0o640 });
  for (const [dir, mode] of [[workDir, 0o2751], [outDir, 0o2750]] as const) {
    await fs.mkdir(dir, { mode: 0o750 });
    if (root) {
      await fs.chmod(dir, mode);
      await fs.chown(dir, id, opts.appGid);
    }
  }
  if (root) await fs.chown(scriptPath, 0, id);
  return { workDir, outDir, scriptPath, uid: root ? id : undefined };
}

async function handleRun(opts: RunnerOptions, req: RunRequest, send: (m: RunnerMessage) => void) {
  const dirs = await prepareRun(opts, req);
  const mask = makeMasker(Object.values(req.secrets));
  let sent = 0;
  const result = await executeScript({
    scriptPath: dirs.scriptPath,
    cwd: dirs.workDir,
    env: buildRunEnv({
      secrets: req.secrets,
      outputDir: dirs.outDir,
      homeDir: dirs.workDir,
      projectSlug: req.projectSlug,
      stamp: req.stamp,
      tz: req.tz,
    }),
    timeoutMs: req.timeoutMs,
    exitGraceMs: req.exitGraceMs,
    tz: req.tz,
    mask,
    uid: dirs.uid,
    gid: dirs.uid,
    onLog: (log) => {
      // Le journal ne fait que grandir : on n'envoie que la suite.
      if (log.length > sent) {
        send({ t: "log", d: log.slice(sent) });
        sent = log.length;
      }
    },
  });
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
  const opts: RunnerOptions = {
    workDir: process.env.WORK_DIR || "/work",
    appGid: Number(process.env.APP_GID || 1001),
  };
  startRunner(socketPath, opts).then(
    () => console.log(`[runner] prêt sur ${socketPath}${isRoot() ? " (un uid par run)" : " (sans changement d'uid)"}`),
    (e) => {
      console.error("[runner] démarrage impossible :", e);
      process.exit(1);
    },
  );
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => process.exit(0));
}
