// Sandbox d'un run : bubblewrap, lancé par le runner (root avec CAP_SYS_ADMIN, profils seccomp et AppArmor du dépôt).
//
// Le script voit :
// - le système en lecture seule (/usr, /etc), un /proc à lui seul (aucun autre processus visible), un /dev minimal ;
// - en écriture : /out ($OUTPUT_DIR) et /tmp ($HOME, $TMPDIR), deux dossiers propres au run ;
// - le réseau : uniquement les IP et ports de l'URL de base désignée, par les relais (voir sandbox-init.ts) ;
//   aucun DNS, le nom de la base est dans /etc/hosts.
// Il ne voit pas /work (les autres runs), le socket du runner, ni le code du runner.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Target } from "../lib/runner/targets.ts";
import type { SandboxInitConfig } from "./sandbox-init.ts";

export const SANDBOX_OUT = "/out";
export const SANDBOX_TMP = "/tmp";
const SANDBOX_SCRIPT = "/run/script.sh";
const SANDBOX_INIT = "/run/init.ts";
const SANDBOX_RELAYS = "/run/relay";
const INIT_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "sandbox-init.ts");

// Dossiers fusionnés de Debian (/bin -> usr/bin…) : recréés en liens dans la sandbox.
const USR_LINKS = ["bin", "lib", "lib64", "sbin"];

export type SandboxFiles = {
  scriptPath: string;
  workDir: string;
  outDir: string;
  hostsFile: string;
  resolvFile: string;
  relayDir: string;
};

export function bwrapArgs(f: SandboxFiles): string[] {
  return [
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-net",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--die-with-parent",
    "--new-session",
    "--hostname",
    "sandbox",
    "--cap-add",
    "CAP_SETUID",
    "--cap-add",
    "CAP_SETGID",
    "--cap-add",
    "CAP_NET_ADMIN",
    "--cap-add",
    "CAP_NET_BIND_SERVICE",
    "--ro-bind",
    "/usr",
    "/usr",
    ...USR_LINKS.flatMap((d) => ["--symlink", `usr/${d}`, `/${d}`]),
    "--ro-bind",
    "/etc",
    "/etc",
    "--ro-bind",
    f.hostsFile,
    "/etc/hosts",
    "--ro-bind",
    f.resolvFile,
    "/etc/resolv.conf",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--bind",
    f.workDir,
    SANDBOX_TMP,
    "--bind",
    f.outDir,
    SANDBOX_OUT,
    // Sans --perms, bubblewrap crée /run en 0700 : ni l'init (root sans CAP_DAC_OVERRIDE) ni le script n'y entreraient.
    "--perms",
    "0755",
    "--dir",
    "/run",
    "--ro-bind",
    f.scriptPath,
    SANDBOX_SCRIPT,
    "--ro-bind",
    INIT_SOURCE,
    SANDBOX_INIT,
    "--ro-bind",
    f.relayDir,
    SANDBOX_RELAYS,
    "--remount-ro",
    "/",
    "--chdir",
    "/",
    "--",
    process.execPath,
    "--no-warnings",
    SANDBOX_INIT,
  ];
}

// Nom de la base -> IP figée par le runner ; resolv.conf vide : aucune requête DNS ne peut aboutir.
export function hostsFileContent(targets: Target[]): string {
  const lines = ["127.0.0.1 localhost"];
  for (const t of targets) if (t.host) lines.push(`${t.ip} ${t.host}`);
  return lines.join("\n") + "\n";
}

export type Relays = { relays: SandboxInitConfig["relays"]; close: () => void };

// Un socket Unix par destination, dans un dossier root 0700 : seul l'init de la sandbox (root) peut s'y connecter,
// et chaque connexion ne peut aller que vers l'IP et le port de cette destination.
export async function openRelays(relayDir: string, targets: Target[]): Promise<Relays> {
  await fs.mkdir(relayDir, { mode: 0o700 });
  const servers: net.Server[] = [];
  const relays: SandboxInitConfig["relays"] = [];
  try {
    for (const [i, t] of targets.entries()) {
      const name = `${i}.sock`;
      const server = net.createServer((inner) => {
        const upstream = net.createConnection({ host: t.ip, port: t.port });
        const close = () => {
          inner.destroy();
          upstream.destroy();
        };
        inner.on("error", close).on("close", close);
        upstream.on("error", close).on("close", close);
        inner.pipe(upstream).pipe(inner);
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path.join(relayDir, name), resolve);
      });
      servers.push(server);
      relays.push({ ip: t.ip, port: t.port, socket: `${SANDBOX_RELAYS}/${name}` });
    }
  } catch (e) {
    for (const s of servers) s.close();
    throw e;
  }
  return { relays, close: () => servers.forEach((s) => s.close()) };
}

export function initConfig(o: { uid: number; gid: number; env: Record<string, string>; relays: Relays["relays"] }): SandboxInitConfig {
  return { uid: o.uid, gid: o.gid, script: SANDBOX_SCRIPT, cwd: SANDBOX_TMP, env: o.env, relays: o.relays };
}

// Au démarrage : une sandbox vide doit pouvoir se créer. Sinon (capacités, seccomp ou AppArmor manquants),
// le runner refuse de démarrer plutôt que d'exécuter un script hors sandbox.
export function selfTest(): Promise<void> {
  const args = [
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-net",
    "--unshare-uts",
    "--die-with-parent",
    "--new-session",
    "--ro-bind",
    "/usr",
    "/usr",
    ...USR_LINKS.flatMap((d) => ["--symlink", `usr/${d}`, `/${d}`]),
    "--proc",
    "/proc",
    "--remount-ro",
    "/",
    "--",
    "/usr/bin/true",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("bwrap", args, { stdio: ["ignore", "ignore", "pipe"], env: { PATH: "/usr/bin:/bin" } as Record<string, string> as NodeJS.ProcessEnv });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => reject(new Error(`bwrap introuvable : ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`sandbox impossible à créer (code ${code}) : ${stderr.trim() || "sans message"}`)),
    );
  });
}
