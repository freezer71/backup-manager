import fs from "node:fs/promises";
import type { AppConfig } from "@/lib/config";
import type { DB } from "@/lib/db";
import type { Project } from "@/lib/repo/projects";
import { listUnprunedSuccesses, markPruned } from "@/lib/repo/runs";
import { isNasReady, localBackupDir, nasBackupDir } from "./storage";

// Ne s'appelle qu'après un succès : le run le plus récent fait donc toujours partie des runs gardés.
export async function applyRetention(db: DB, cfg: AppConfig, project: Project): Promise<number> {
  const keep = Math.max(1, project.retention_count);
  const toPrune = listUnprunedSuccesses(db, project.id).slice(keep);
  const nasReady = await isNasReady(cfg.nasDir);
  let pruned = 0;
  for (const run of toPrune) {
    await fs.rm(localBackupDir(cfg, project.slug, run), { recursive: true, force: true });
    if (nasReady) await fs.rm(nasBackupDir(cfg, project.slug, run), { recursive: true, force: true });
    // Copie NAS à purger mais NAS indisponible : on ne marque pas, la prochaine rétention réessaiera.
    if (!nasReady && run.nas_status === "ok") continue;
    markPruned(db, run.id);
    pruned++;
  }
  return pruned;
}
