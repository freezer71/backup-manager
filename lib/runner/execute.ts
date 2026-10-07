import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

export type ExecOptions = {
  scriptPath: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  tz: string;
  mask: (s: string) => string;
  onLog?: (log: string) => void;
  killGraceMs?: number;
  // Délai entre la fin de bash et l'arrêt forcé des processus qui gardent encore stdout/stderr ouverts.
  exitGraceMs?: number;
  maxLogBytes?: number;
};

export type ExecResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  log: string;
};

export function executeScript(o: ExecOptions): Promise<ExecResult> {
  const maxBytes = o.maxLogBytes ?? 1_000_000;
  const clock = new Intl.DateTimeFormat("fr-FR", {
    timeZone: o.tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return new Promise((resolve) => {
    let log = "";
    let logBytes = 0;
    let truncated = false;
    let timedOut = false;

    const MAX_LINE = 65_536;
    const LONG_LINE = "[ligne de plus de 64 Ko ignorée]";

    // system : message du runner, toujours ajouté (masqué) même si le journal est tronqué.
    const push = (line: string, isErr: boolean, system = false) => {
      if (truncated && !system) return;
      const entry = `[${clock.format(new Date())}]${isErr ? " !" : ""} ${o.mask(line)}\n`;
      const size = Buffer.byteLength(entry);
      if (system) {
        log += entry;
      } else if (logBytes + size > maxBytes) {
        truncated = true;
        log += "[… journal tronqué …]\n";
      } else {
        log += entry;
        logBytes += size;
      }
      o.onLog?.(log);
    };

    // detached : le script devient chef d'un groupe de processus, qu'on peut tuer en entier.
    const child = spawn("bash", ["-euo", "pipefail", o.scriptPath], {
      cwd: o.cwd,
      // Cast : le typage de Next impose NODE_ENV dans ProcessEnv, qu'on ne transmet volontairement pas.
      env: o.env as NodeJS.ProcessEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const readLines = (stream: Readable, isErr: boolean) => {
      let buffer = "";
      let skipping = false; // ligne de plus de MAX_LINE : on jette tout jusqu'au prochain saut de ligne
      const emit = (line: string) => {
        // Jamais de fragment d'une ligne trop longue : un secret à cheval sur une coupure échapperait au masquage.
        push(line.length > MAX_LINE ? LONG_LINE : line, isErr);
      };
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        if (truncated) {
          buffer = "";
          return;
        }
        if (skipping) {
          const nl = chunk.indexOf("\n");
          if (nl < 0) return;
          skipping = false;
          chunk = chunk.slice(nl + 1);
        }
        buffer += chunk;
        let i: number;
        while ((i = buffer.indexOf("\n")) >= 0) {
          emit(buffer.slice(0, i));
          buffer = buffer.slice(i + 1);
        }
        if (buffer.length > MAX_LINE) {
          push(LONG_LINE, isErr);
          buffer = "";
          skipping = true;
        }
      });
      stream.on("end", () => {
        if (buffer) emit(buffer);
      });
    };
    readLines(child.stdout, false);
    readLines(child.stderr, true);

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        // déjà terminé
      }
    };

    // `close` attend que tous les processus qui partagent stdout/stderr aient fini : un `sleep &` resté
    // en arrière-plan, ou un démon sorti du groupe (setsid), le retarderait jusqu'au timeout, voire pour toujours.
    // On se fie donc à `exit` (fin de bash), avec un délai de grâce, et on ne résout qu'une fois.
    let settled = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    let exitGraceTimer: NodeJS.Timeout | undefined;
    let forceTimer: NodeJS.Timeout | undefined;

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(exitGraceTimer);
      clearTimeout(forceTimer);
      resolve({ exitCode: code, signal, timedOut, log });
    };

    // Les tubes ne se fermeront pas d'eux-mêmes : on tue le groupe et on les détruit pour libérer le run.
    const forceFinish = (message?: string) => {
      if (settled) return;
      killGroup("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      if (message) push(message, true, true);
      finish(exitCode, exitSignal);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      push("Timeout atteint, arrêt du script", true, true);
      killGroup("SIGTERM");
      killTimer = setTimeout(() => {
        killGroup("SIGKILL");
        forceTimer = setTimeout(() => forceFinish(), 2_000);
      }, o.killGraceMs ?? 10_000);
    }, o.timeoutMs);

    child.on("error", (err) => push(`Impossible de lancer bash : ${err.message}`, true, true));
    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      exitGraceTimer = setTimeout(
        () => forceFinish("Processus encore actifs après la fin du script : arrêtés."),
        o.exitGraceMs ?? 5_000,
      );
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
