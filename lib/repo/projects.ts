import { isValidCron } from "@/lib/cron";
import { nowIso, type DB } from "@/lib/db";
import { isUniqueViolation, slugify, ValidationError } from "@/lib/validation";

export type Project = {
  id: number;
  name: string;
  slug: string;
  environment_id: number | null;
  script: string;
  cron: string;
  retention_count: number;
  nas_copy: boolean;
  timeout_minutes: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ProjectInput = Omit<Project, "id" | "slug" | "created_at" | "updated_at">;

type ProjectRow = Omit<Project, "nas_copy" | "enabled"> & { nas_copy: number; enabled: number };

function toProject(row: ProjectRow): Project {
  return { ...row, nas_copy: row.nas_copy === 1, enabled: row.enabled === 1 };
}

function normalize(input: ProjectInput): ProjectInput {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Nom requis");
  const cron = input.cron.trim().replace(/\s+/g, " ");
  if (!isValidCron(cron)) {
    throw new ValidationError("Expression cron invalide (5 champs attendus, ex. « 0 3 * * * »)");
  }
  if (!Number.isInteger(input.retention_count) || input.retention_count < 1 || input.retention_count > 1000) {
    throw new ValidationError("La rétention doit être un entier entre 1 et 1000");
  }
  if (!Number.isInteger(input.timeout_minutes) || input.timeout_minutes < 1 || input.timeout_minutes > 1440) {
    throw new ValidationError("Le timeout doit être un entier entre 1 et 1440 minutes");
  }
  const script = input.script.replace(/\r\n?/g, "\n");
  if (!script.trim()) throw new ValidationError("Le script est vide");
  return { ...input, name, cron, script };
}

export function createProject(db: DB, input: ProjectInput): number {
  const p = normalize(input);
  const slug = slugify(p.name);
  const now = nowIso();
  try {
    const res = db
      .prepare(
        `INSERT INTO projects (name, slug, environment_id, script, cron, retention_count, nas_copy, timeout_minutes, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.name, slug, p.environment_id, p.script, p.cron, p.retention_count, p.nas_copy ? 1 : 0, p.timeout_minutes, p.enabled ? 1 : 0, now, now);
    return Number(res.lastInsertRowid);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Un projet « ${slug} » existe déjà`);
    throw e;
  }
}

// Le slug ne change jamais : il nomme les dossiers de backup sur disque.
export function updateProject(db: DB, id: number, input: ProjectInput): void {
  const p = normalize(input);
  db.prepare(
    `UPDATE projects SET name = ?, environment_id = ?, script = ?, cron = ?, retention_count = ?, nas_copy = ?,
       timeout_minutes = ?, enabled = ?, updated_at = ? WHERE id = ?`,
  ).run(p.name, p.environment_id, p.script, p.cron, p.retention_count, p.nas_copy ? 1 : 0, p.timeout_minutes, p.enabled ? 1 : 0, nowIso(), id);
}

export function deleteProject(db: DB, id: number): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function getProject(db: DB, id: number): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row && toProject(row);
}

export function listProjects(db: DB): Project[] {
  return (db.prepare("SELECT * FROM projects ORDER BY name").all() as ProjectRow[]).map(toProject);
}
