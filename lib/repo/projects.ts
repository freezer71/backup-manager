import { isValidCron } from "@/lib/cron";
import { nowIso, type DB } from "@/lib/db";
import { dbUrlProblem } from "@/lib/db-url";
import { isDbKind, type DbKind } from "@/lib/dumps";
import { isUniqueViolation, slugify, ValidationError } from "@/lib/validation";

// L'URL de connexion n'est jamais chargée avec le projet (pages, formulaires) : seulement par getProjectDbUrl,
// pour un run ou après une confirmation par code 2FA.
export type Project = {
  id: number;
  name: string;
  slug: string;
  db_kind: DbKind;
  has_db_url: boolean;
  cron: string;
  retention_count: number;
  nas_copy: boolean;
  timeout_minutes: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

// db_url : null en modification = URL inchangée.
export type ProjectInput = Omit<Project, "id" | "slug" | "has_db_url" | "created_at" | "updated_at"> & { db_url: string | null };

type ProjectRow = Omit<Project, "nas_copy" | "enabled" | "has_db_url"> & { nas_copy: number; enabled: number; has_db_url: number };

const COLUMNS =
  "id, name, slug, db_kind, (db_url IS NOT NULL AND db_url != '') AS has_db_url, cron, retention_count, nas_copy, timeout_minutes, enabled, created_at, updated_at";

function toProject(row: ProjectRow): Project {
  return { ...row, nas_copy: row.nas_copy === 1, enabled: row.enabled === 1, has_db_url: row.has_db_url === 1 };
}

function normalize(input: ProjectInput, current: { db_kind: DbKind; db_url: string | null } | null): ProjectInput {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Nom requis");
  if (!isDbKind(input.db_kind)) throw new ValidationError("Type de base inconnu");
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
  const db_url = input.db_url?.trim() || null;
  if (db_url === null && !current?.db_url) throw new ValidationError("URL de connexion requise");
  // Changer de type sans nouvelle URL : l'URL enregistrée doit convenir au nouveau type.
  const problem = dbUrlProblem(input.db_kind, db_url ?? current!.db_url!);
  if (problem) throw new ValidationError(problem);
  return { ...input, name, cron, db_url };
}

export function createProject(db: DB, input: ProjectInput): number {
  const p = normalize(input, null);
  const slug = slugify(p.name);
  const now = nowIso();
  try {
    const res = db
      .prepare(
        `INSERT INTO projects (name, slug, db_kind, db_url, cron, retention_count, nas_copy, timeout_minutes, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.name, slug, p.db_kind, p.db_url, p.cron, p.retention_count, p.nas_copy ? 1 : 0, p.timeout_minutes, p.enabled ? 1 : 0, now, now);
    return Number(res.lastInsertRowid);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Un projet « ${slug} » existe déjà`);
    throw e;
  }
}

// Le slug ne change jamais : il nomme les dossiers de backup sur disque.
export function updateProject(db: DB, id: number, input: ProjectInput): void {
  const current = db.prepare("SELECT db_kind, db_url FROM projects WHERE id = ?").get(id) as { db_kind: DbKind; db_url: string | null } | undefined;
  if (!current) throw new ValidationError("Projet introuvable");
  const p = normalize(input, current);
  db.prepare(
    `UPDATE projects SET name = ?, db_kind = ?, db_url = COALESCE(?, db_url), cron = ?, retention_count = ?, nas_copy = ?,
       timeout_minutes = ?, enabled = ?, updated_at = ? WHERE id = ?`,
  ).run(p.name, p.db_kind, p.db_url, p.cron, p.retention_count, p.nas_copy ? 1 : 0, p.timeout_minutes, p.enabled ? 1 : 0, nowIso(), id);
}

export function deleteProject(db: DB, id: number): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function getProject(db: DB, id: number): Project | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
  return row && toProject(row);
}

export function getProjectDbUrl(db: DB, id: number): string | null {
  const row = db.prepare("SELECT db_url FROM projects WHERE id = ?").get(id) as { db_url: string | null } | undefined;
  return row?.db_url || null;
}

export function listProjects(db: DB): Project[] {
  return (db.prepare(`SELECT ${COLUMNS} FROM projects ORDER BY name`).all() as ProjectRow[]).map(toProject);
}
