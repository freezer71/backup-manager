import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "@/lib/config";
import type { DB } from "@/lib/db";
import { getSecretsMap } from "@/lib/repo/environments";
import { getProject, type Project } from "@/lib/repo/projects";
import { createRun, finishRun, getRun, hasRunningRun, setRunLog, type NasStatus, type RunStatus } from "@/lib/repo/runs";
import { buildRunEnv, formatStamp } from "./env";
import { executeScript } from "./execute";
import { makeMasker } from "./mask";
import { notifyProblem, sendNotification } from "./notify";
import { applyRetention } from "./retention";
import { copyToNas, dirStats, isNasReady, localBackupDir, moveOutputs, NAS_MARKER, nasBackupDir } from "./storage";

export type RunDeps = {
  db: DB;
  cfg: AppConfig;
  now?: () => Date;
  send?: typeof sendNotification;
  // Transmis à executeScript (tests) : délai avant d'arrêter les processus restés actifs après la fin du script.
  exitGraceMs?: number;
};

const g = globalThis as unknown as { __bmLocks?: Set<number> };
const locks = (g.__bmLocks ??= new Set<number>());

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function isProjectBusy(db: DB, projectId: number): boolean {
  return locks.has(projectId) || hasRunningRun(db, projectId);
}

// Crée le run de façon synchrone (pour pouvoir rediriger vers sa page tout de suite),
// puis exécute le backup en arrière-plan dans `done`.
export function startProjectRun(
  projectId: number,
  trigger: "schedule" | "manual",
  deps: RunDeps,
): { runId: number; done: Promise<void> } | null {
  const { db, cfg } = deps;
  const project = getProject(db, projectId);
  if (!project) return null;
  const stamp = formatStamp((deps.now ?? (() => new Date()))(), cfg.tz);

  if (isProjectBusy(db, projectId)) {
    const runId = createRun(db, { projectId, trigger, stamp, status: "skipped" });
    finishRun(db, runId, { status: "skipped", log: "Ignoré : une exécution de ce projet est déjà en cours.\n" });
    return { runId, done: Promise.resolve() };
  }

  const runId = createRun(db, { projectId, trigger, stamp });
  locks.add(projectId);
  const done = execute(project, runId, stamp, deps).finally(() => locks.delete(projectId));
  return { runId, done };
}

export async function runProject(
  projectId: number,
  trigger: "schedule" | "manual",
  deps: RunDeps,
): Promise<number | null> {
  const started = startProjectRun(projectId, trigger, deps);
  if (!started) return null;
  await started.done;
  return started.runId;
}

async function execute(project: Project, runId: number, stamp: string, deps: RunDeps): Promise<void> {
  const { db, cfg } = deps;
  const send = deps.send ?? sendNotification;
  const notify = (status: string, message: string) =>
    notifyProblem(db, cfg, { projectSlug: project.slug, projectId: project.id, runId, status, message }, send);

  const runDir = path.join(cfg.dataDir, "tmp", String(runId));
  const workDir = path.join(runDir, "work");
  const outDir = path.join(runDir, "out");
  const scriptPath = path.join(runDir, "script.sh");
  let log = "";
  let mask = (s: string) => s;

  try {
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(scriptPath, project.script, { mode: 0o700 });

    const secrets = project.environment_id ? getSecretsMap(db, project.environment_id) : {};
    mask = makeMasker(Object.values(secrets));

    let lastFlush = 0;
    const scriptStart = Date.now();
    const result = await executeScript({
      scriptPath,
      cwd: workDir,
      env: buildRunEnv({ secrets, outputDir: outDir, homeDir: workDir, projectSlug: project.slug, stamp, tz: cfg.tz }),
      timeoutMs: project.timeout_minutes * 60_000,
      exitGraceMs: deps.exitGraceMs,
      tz: cfg.tz,
      mask,
      onLog: (current) => {
        log = current;
        const t = Date.now();
        if (t - lastFlush > 1000) {
          lastFlush = t;
          setRunLog(db, runId, current);
        }
      },
    });
    log = result.log;
    const scriptMs = Date.now() - scriptStart;

    const produced = await dirStats(outDir);
    let status: RunStatus = "success";
    if (result.timedOut) status = "timeout";
    else if (result.exitCode !== 0) {
      status = "failed";
      log += `Le script s'est terminé avec le code ${result.exitCode ?? result.signal}\n`;
    } else if (produced.files.length === 0) {
      status = "failed";
      log += "Aucun fichier produit dans $OUTPUT_DIR\n";
    }

    if (status !== "success") {
      finishRun(db, runId, { status, exit_code: result.exitCode, log, script_ms: scriptMs });
      await notify(status, status === "timeout" ? `timeout après ${project.timeout_minutes} min` : `code ${result.exitCode ?? result.signal}`);
      return;
    }

    const run = getRun(db, runId)!;
    const stored = await moveOutputs(outDir, localBackupDir(cfg, project.slug, run));

    let nasStatus: NasStatus = "n/a";
    let nasError: string | null = null;
    let nasMs: number | null = null;
    if (project.nas_copy) {
      const nasStart = Date.now();
      try {
        if (!(await isNasReady(cfg.nasDir))) {
          throw new Error(`NAS indisponible : ${cfg.nasDir} absent, non inscriptible ou sans fichier ${NAS_MARKER}`);
        }
        await copyToNas(localBackupDir(cfg, project.slug, run), nasBackupDir(cfg, project.slug, run));
        nasStatus = "ok";
      } catch (e) {
        nasStatus = "failed";
        nasError = errorMessage(e);
      }
      nasMs = Date.now() - nasStart;
    }

    finishRun(db, runId, {
      status: "success",
      exit_code: 0,
      size_bytes: stored.size,
      files: stored.files,
      log,
      nas_status: nasStatus,
      nas_error: nasError,
      script_ms: scriptMs,
      nas_ms: nasMs,
    });

    try {
      await applyRetention(db, cfg, project);
    } catch (e) {
      console.error(`[retention] projet ${project.slug} :`, e);
    }

    if (nasStatus === "failed") await notify("nas_failed", nasError ?? "copie NAS en échec");
  } catch (e) {
    try {
      finishRun(db, runId, { status: "failed", log: log + mask(`Erreur interne : ${errorMessage(e)}\n`) });
      await notify("failed", mask(`erreur interne : ${errorMessage(e)}`));
    } catch (inner) {
      console.error(`[run] projet ${project.slug}, run ${runId} : ${mask(errorMessage(inner))}`);
    }
  } finally {
    await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
  }
}
