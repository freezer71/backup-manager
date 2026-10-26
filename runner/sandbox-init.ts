// Premier processus de la sandbox d'un run, lancé par bubblewrap dans des espaces de noms neufs (processus, réseau,
// IPC, nom d'hôte, montages). Il tourne en root mais avec seulement CAP_SETUID, CAP_SETGID, CAP_NET_ADMIN et
// CAP_NET_BIND_SERVICE, valables dans ce réseau vide uniquement.
//
// 1. Il lit sa configuration sur l'entrée standard (jamais dans ses arguments, lisibles dans /proc).
// 2. Pour chaque destination autorisée, il attache son IP à l'interface loopback et y écoute : chaque connexion est
//    relayée par un socket Unix vers le runner, qui ouvre la vraie connexion vers cette IP et ce port, et aucune autre.
//    Le nom de la base pointe vers cette IP dans le /etc/hosts de la sandbox : TLS vérifie toujours le vrai nom.
// 3. Il lance le script sous l'uid du run (sans capacités, ni groupes) et sort avec son code.
// Quand il sort, bubblewrap détruit l'espace de processus : plus rien du script ne survit.
// Autonome (modules node: uniquement) : c'est le seul fichier du runner lu dans la sandbox.
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import { constants } from "node:os";

export type SandboxInitConfig = {
  uid: number;
  gid: number;
  script: string;
  cwd: string;
  env: Record<string, string>;
  relays: Array<{ ip: string; port: number; socket: string }>;
};

function fail(message: string): never {
  process.stderr.write(`[sandbox] ${message}\n`);
  process.exit(125);
}

async function readConfig(): Promise<SandboxInitConfig> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input) as SandboxInitConfig;
}

function relay(ip: string, port: number, socket: string): Promise<net.Server> {
  const server = net.createServer((client) => {
    const upstream = net.createConnection(socket);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close).on("close", close);
    upstream.on("error", close).on("close", close);
    client.pipe(upstream).pipe(client);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, ip, () => resolve(server));
  });
}

async function main(): Promise<void> {
  const cfg = await readConfig();
  for (const ip of new Set(cfg.relays.map((r) => r.ip))) {
    if (ip.startsWith("127.")) continue;
    try {
      execFileSync("ip", ["addr", "add", `${ip}/32`, "dev", "lo"], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      fail(`réseau : ${ip} impossible à attacher (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
    }
  }
  const seen = new Set<string>();
  for (const r of cfg.relays) {
    const key = `${r.ip}:${r.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await relay(r.ip, r.port, r.socket).catch((e: Error) => fail(`réseau : écoute sur ${key} impossible (${e.message})`));
  }

  const child = spawn("bash", ["-euo", "pipefail", cfg.script], {
    cwd: cfg.cwd,
    // Cast : le typage de Next impose NODE_ENV dans ProcessEnv, qu'on ne transmet volontairement pas.
    env: cfg.env as NodeJS.ProcessEnv,
    uid: cfg.uid,
    gid: cfg.gid,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("error", (e) => fail(`bash impossible à lancer : ${e.message}`));
  child.on("exit", (code, signal) => {
    // Convention du shell pour un processus tué par un signal.
    process.exit(code ?? 128 + (signal ? constants.signals[signal] : 1));
  });
  // Le runner arrête la sandbox en la tuant : on transmet un SIGTERM au script avant.
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
