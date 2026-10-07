import fs from "node:fs/promises";
import type { DB } from "@/lib/db";
import type { NasStatus, RunStatus } from "@/lib/repo/runs";

// Requêtes de lecture pour les pages Backups et Statistiques. Aucune ne charge le journal des runs.

export type BackupEntry = {
  runId: number;
  projectId: number;
  projectName: string;
  finishedAt: string;
  sizeBytes: number | null;
  files: string[];
  nasStatus: NasStatus;
};

export function listRecentBackups(db: DB, opts: { projectId?: number | null; limit?: number } = {}): BackupEntry[] {
  const rows = db
    .prepare(
      `SELECT r.id AS runId, r.project_id AS projectId, p.name AS projectName, r.finished_at AS finishedAt,
              r.size_bytes AS sizeBytes, r.files AS files, r.nas_status AS nasStatus
       FROM runs r JOIN projects p ON p.id = r.project_id
       WHERE r.status = 'success' AND r.pruned = 0 AND (? IS NULL OR r.project_id = ?)
       ORDER BY r.finished_at DESC, r.id DESC LIMIT ?`,
    )
    .all(opts.projectId ?? null, opts.projectId ?? null, opts.limit ?? 100) as Array<Omit<BackupEntry, "files"> & { files: string }>;
  return rows.map((r) => ({ ...r, files: JSON.parse(r.files) as string[] }));
}

export type ProjectStorage = { projectId: number; name: string; bytes: number; count: number; percent: number };

// Espace occupé par les backups conservés (non supprimés par la rétention), par projet.
export function storageByProject(db: DB): { totalBytes: number; projects: ProjectStorage[] } {
  const rows = db
    .prepare(
      `SELECT p.id AS projectId, p.name AS name,
              COALESCE(SUM(CASE WHEN r.status = 'success' AND r.pruned = 0 THEN r.size_bytes END), 0) AS bytes,
              COUNT(CASE WHEN r.status = 'success' AND r.pruned = 0 THEN 1 END) AS count
       FROM projects p LEFT JOIN runs r ON r.project_id = p.id
       GROUP BY p.id ORDER BY bytes DESC, p.name`,
    )
    .all() as Array<Omit<ProjectStorage, "percent">>;
  const totalBytes = rows.reduce((sum, r) => sum + r.bytes, 0);
  return {
    totalBytes,
    projects: rows.map((r) => ({ ...r, percent: totalBytes === 0 ? 0 : Math.round((r.bytes / totalBytes) * 1000) / 10 })),
  };
}

export type DurationSummary = { last: number | null; avg: number | null; max: number | null };
export type DurationPoint = { runId: number; finishedAt: string; totalMs: number; scriptMs: number | null; nasMs: number | null };

function summarize(values: Array<number | null>): DurationSummary {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return { last: null, avg: null, max: null };
  return {
    last: known[known.length - 1],
    avg: Math.round(known.reduce((a, b) => a + b, 0) / known.length),
    max: Math.max(...known),
  };
}

// Durées des `limit` derniers backups réussis d'un projet, en ordre chronologique.
export function durationStats(
  db: DB,
  projectId: number,
  limit = 30,
): { series: DurationPoint[]; total: DurationSummary; script: DurationSummary; nas: DurationSummary } {
  const rows = db
    .prepare(
      `SELECT id AS runId, finished_at AS finishedAt,
              CAST(ROUND((julianday(finished_at) - julianday(started_at)) * 86400000) AS INTEGER) AS totalMs,
              script_ms AS scriptMs, nas_ms AS nasMs
       FROM runs WHERE project_id = ? AND status = 'success' AND finished_at IS NOT NULL
       ORDER BY id DESC LIMIT ?`,
    )
    .all(projectId, limit) as DurationPoint[];
  const series = rows.reverse();
  return {
    series,
    total: summarize(series.map((p) => p.totalMs)),
    script: summarize(series.map((p) => p.scriptMs)),
    nas: summarize(series.map((p) => p.nasMs)),
  };
}

export type ProjectReliability = {
  projectId: number;
  name: string;
  total: number;
  success: number;
  failed: number;
  nasFailed: number;
  successRate: number | null;
};
export type FailureEntry = { runId: number; projectId: number; projectName: string; status: RunStatus; startedAt: string };

// Fiabilité depuis `sinceIso` : les runs ignorés (déjà en cours) ne comptent pas.
export function reliabilityStats(db: DB, sinceIso: string): { projects: ProjectReliability[]; recentFailures: FailureEntry[] } {
  const rows = db
    .prepare(
      `SELECT p.id AS projectId, p.name AS name,
              COUNT(r.id) AS total,
              COUNT(CASE WHEN r.status = 'success' THEN 1 END) AS success,
              COUNT(CASE WHEN r.status IN ('failed', 'timeout', 'interrupted') THEN 1 END) AS failed,
              COUNT(CASE WHEN r.status = 'success' AND r.nas_status = 'failed' THEN 1 END) AS nasFailed
       FROM projects p
       LEFT JOIN runs r ON r.project_id = p.id AND r.status NOT IN ('skipped', 'running') AND r.started_at >= ?
       GROUP BY p.id ORDER BY p.name`,
    )
    .all(sinceIso) as Array<Omit<ProjectReliability, "successRate">>;
  const recentFailures = db
    .prepare(
      `SELECT r.id AS runId, r.project_id AS projectId, p.name AS projectName, r.status AS status, r.started_at AS startedAt
       FROM runs r JOIN projects p ON p.id = r.project_id
       WHERE r.status IN ('failed', 'timeout', 'interrupted') AND r.started_at >= ?
       ORDER BY r.started_at DESC, r.id DESC LIMIT 10`,
    )
    .all(sinceIso) as FailureEntry[];
  return {
    projects: rows.map((r) => ({ ...r, successRate: r.total === 0 ? null : Math.round((r.success / r.total) * 1000) / 10 })),
    recentFailures,
  };
}

export type DiskUsage = { totalBytes: number; freeBytes: number; usedBytes: number };

// Espace du système de fichiers qui contient `dir` (disque local ou partage NAS). null si inaccessible.
export async function diskUsage(dir: string): Promise<DiskUsage | null> {
  try {
    const s = await fs.statfs(dir);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    return { totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - s.bfree * s.bsize) };
  } catch {
    return null;
  }
}

// Date ISO d'il y a `days` jours (début de la fenêtre des statistiques de fiabilité).
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
