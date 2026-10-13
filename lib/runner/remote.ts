import net from "node:net";
import type { RunnerMessage, RunRequest } from "@/runner/server";
import type { ExecResult } from "./execute";

export type RemoteRun = {
  result: ExecResult;
  // Dossier des sorties, dans le volume partagé avec le runner (lecture seule ici).
  outDir: string;
  // À appeler une fois les sorties copiées : le runner tue ce qui reste du run et supprime ses fichiers.
  release: () => void;
};

// Marge au-delà du timeout du script : arrêt forcé (10 s), délais de grâce, chmod des sorties.
const SAFETY_MARGIN_MS = 60_000;

export function runRemote(socketPath: string, req: RunRequest, onLog?: (log: string) => void): Promise<RemoteRun> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buffer = "";
    let log = "";
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      reject(new Error(`runner : ${message}`));
    };
    const timer = setTimeout(() => fail("aucune réponse dans le délai"), req.timeoutMs + SAFETY_MARGIN_MS);

    const handle = (m: RunnerMessage) => {
      if (m.t === "log") {
        log += m.d;
        onLog?.(log);
      } else if (m.t === "error") {
        fail(m.message);
      } else if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          result: { exitCode: m.exitCode, signal: m.signal as NodeJS.Signals | null, timedOut: m.timedOut, log: m.log },
          outDir: m.outDir,
          release: () => sock.end(),
        });
      }
    };

    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify(req) + "\n"));
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          handle(JSON.parse(line) as RunnerMessage);
        } catch {
          fail("réponse illisible");
        }
      }
    });
    sock.on("error", (e) => fail(e.message));
    sock.on("close", () => fail("connexion fermée avant la fin du run"));
  });
}
