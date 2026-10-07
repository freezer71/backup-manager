import fs from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "@/lib/auth/password";
import { ConfigError, loadConfig, type AppConfig } from "@/lib/config";
import { getDb, type DB } from "@/lib/db";
import { getProject } from "@/lib/repo/projects";
import { markRunningAsInterrupted } from "@/lib/repo/runs";
import { createUser, getUser } from "@/lib/repo/user";
import { notifyProblem } from "@/lib/runner/notify";
import { startScheduler } from "@/lib/scheduler";

export async function ensureAdmin(db: DB, cfg: AppConfig): Promise<"created" | "exists"> {
  if (getUser(db)) return "exists";
  if (!cfg.adminEmail || !cfg.adminPassword) {
    throw new ConfigError("Aucun compte : définir ADMIN_EMAIL et ADMIN_PASSWORD pour le premier démarrage");
  }
  if (cfg.adminPassword.length < 12) throw new ConfigError("ADMIN_PASSWORD : 12 caractères minimum");
  createUser(db, cfg.adminEmail.toLowerCase(), await hashPassword(cfg.adminPassword));
  return "created";
}

export function bootstrap(): Promise<void> {
  const g = globalThis as unknown as { __bmBoot?: Promise<void> };
  g.__bmBoot ??= doBootstrap().catch((e) => {
    g.__bmBoot = undefined;
    throw e;
  });
  return g.__bmBoot;
}

// Next.js garde sinon le serveur en vie (instrumentation en erreur) : en production,
// une configuration invalide doit arrêter le conteneur, pas le laisser « unhealthy ».
export async function bootstrapOrExit(): Promise<void> {
  try {
    await bootstrap();
  } catch (e) {
    if (process.env.NODE_ENV !== "production") throw e;
    console.error(`[bootstrap] échec : ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

async function doBootstrap(): Promise<void> {
  const cfg = loadConfig();
  const db = getDb();
  await fs.mkdir(path.join(cfg.dataDir, "backups"), { recursive: true });
  await fs.rm(path.join(cfg.dataDir, "tmp"), { recursive: true, force: true });

  if ((await ensureAdmin(db, cfg)) === "created") {
    console.log(`[bootstrap] compte ${cfg.adminEmail} créé ; ADMIN_PASSWORD peut être retirée`);
  }

  const interrupted = markRunningAsInterrupted(db);
  startScheduler({ db, cfg });
  console.log("[bootstrap] planificateur démarré");

  for (const run of interrupted) {
    const project = getProject(db, run.project_id);
    if (!project) continue;
    try {
      await notifyProblem(db, cfg, {
        projectSlug: project.slug,
        projectId: project.id,
        runId: run.id,
        status: "interrupted",
        message: "interrompu par un redémarrage de l'application",
      });
    } catch (e) {
      console.error(`[bootstrap] notification du run ${run.id} :`, e);
    }
  }
}
