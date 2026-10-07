import { nowIso, type DB } from "@/lib/db";

export type RunStatus = "running" | "success" | "failed" | "timeout" | "interrupted" | "skipped";
export type NasStatus = "n/a" | "ok" | "failed";

// Un Run renvoyé par listRuns, lastRun ou lastSuccessfulRun a `log: ""` : seul getRun charge le journal.
export type Run = {
  id: number;
  project_id: number;
  trigger: "schedule" | "manual";
  status: RunStatus;
  stamp: string;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  size_bytes: number | null;
  files: string[];
  log: string;
  nas_status: NasStatus;
  nas_error: string | null;
  pruned: boolean;
  // Durées mesurées depuis la migration 4 (null pour les runs plus anciens).
  script_ms: number | null;
  nas_ms: number | null;
};

export type FinishPatch = {
  status: RunStatus;
  log: string;
  exit_code?: number | null;
  size_bytes?: number | null;
  files?: string[];
  nas_status?: NasStatus;
  nas_error?: string | null;
  script_ms?: number | null;
  nas_ms?: number | null;
};

type RunRow = Omit<Run, "files" | "pruned"> & { files: string; pruned: number };

// Listes et derniers runs : toutes les colonnes sauf le journal (jusqu'à 1 Mo par run), renvoyé vide.
const SUMMARY_COLUMNS =
  "id, project_id, trigger, status, stamp, started_at, finished_at, exit_code, size_bytes, files, '' AS log, nas_status, nas_error, pruned, script_ms, nas_ms";

function toRun(row: RunRow): Run {
  return { ...row, files: JSON.parse(row.files) as string[], pruned: row.pruned === 1 };
}

export function createRun(
  db: DB,
  input: { projectId: number; trigger: Run["trigger"]; stamp: string; status?: RunStatus },
): number {
  const res = db
    .prepare("INSERT INTO runs (project_id, trigger, status, stamp, started_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.projectId, input.trigger, input.status ?? "running", input.stamp, nowIso());
  return Number(res.lastInsertRowid);
}

export function setRunLog(db: DB, id: number, log: string): void {
  db.prepare("UPDATE runs SET log = ? WHERE id = ?").run(log, id);
}

export function finishRun(db: DB, id: number, patch: FinishPatch): void {
  db.prepare(
    `UPDATE runs SET status = ?, log = ?, exit_code = ?, size_bytes = ?, files = ?, nas_status = ?, nas_error = ?,
       script_ms = ?, nas_ms = ?, finished_at = ? WHERE id = ?`,
  ).run(
    patch.status,
    patch.log,
    patch.exit_code ?? null,
    patch.size_bytes ?? null,
    JSON.stringify(patch.files ?? []),
    patch.nas_status ?? "n/a",
    patch.nas_error ?? null,
    patch.script_ms ?? null,
    patch.nas_ms ?? null,
    nowIso(),
    id,
  );
}

export function getRun(db: DB, id: number): Run | undefined {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  return row && toRun(row);
}

export function listRuns(db: DB, projectId: number, limit = 50): Run[] {
  return (
    db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT ?`).all(projectId, limit) as RunRow[]
  ).map(toRun);
}

export function lastRun(db: DB, projectId: number): Run | undefined {
  const row = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM runs WHERE project_id = ? AND status != 'skipped' ORDER BY id DESC LIMIT 1`)
    .get(projectId) as RunRow | undefined;
  return row && toRun(row);
}

export function lastSuccessfulRun(db: DB, projectId: number): Run | undefined {
  const row = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM runs WHERE project_id = ? AND status = 'success' ORDER BY id DESC LIMIT 1`)
    .get(projectId) as RunRow | undefined;
  return row && toRun(row);
}

export function hasRunningRun(db: DB, projectId: number): boolean {
  return !!db.prepare("SELECT 1 FROM runs WHERE project_id = ? AND status = 'running'").get(projectId);
}

export function markRunningAsInterrupted(db: DB): Run[] {
  const rows = (db.prepare("SELECT * FROM runs WHERE status = 'running'").all() as RunRow[]).map(toRun);
  const stmt = db.prepare(
    "UPDATE runs SET status = 'interrupted', finished_at = ?, log = log || ? WHERE id = ?",
  );
  for (const r of rows) stmt.run(nowIso(), "Interrompu par un redémarrage de l'application.\n", r.id);
  return rows;
}

export function listUnprunedSuccesses(db: DB, projectId: number): Run[] {
  return (
    db
      .prepare("SELECT * FROM runs WHERE project_id = ? AND status = 'success' AND pruned = 0 ORDER BY id DESC")
      .all(projectId) as RunRow[]
  ).map(toRun);
}

export function markPruned(db: DB, id: number): void {
  db.prepare("UPDATE runs SET pruned = 1 WHERE id = ?").run(id);
}
