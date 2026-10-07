import { nowIso, type DB } from "@/lib/db";
import { assertSecretKey, isUniqueViolation, parseDotenv, ValidationError } from "@/lib/validation";

export type Environment = {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Nom requis");
  return trimmed;
}

export function createEnvironment(db: DB, input: { name: string; description: string }): number {
  const now = nowIso();
  try {
    const res = db
      .prepare("INSERT INTO environments (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(assertName(input.name), input.description.trim(), now, now);
    return Number(res.lastInsertRowid);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Un environnement « ${input.name.trim()} » existe déjà`);
    throw e;
  }
}

export function updateEnvironment(db: DB, id: number, input: { name: string; description: string }): void {
  try {
    db.prepare("UPDATE environments SET name = ?, description = ?, updated_at = ? WHERE id = ?").run(
      assertName(input.name),
      input.description.trim(),
      nowIso(),
      id,
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Un environnement « ${input.name.trim()} » existe déjà`);
    throw e;
  }
}

export function deleteEnvironment(db: DB, id: number): void {
  const { n } = db.prepare("SELECT count(*) AS n FROM projects WHERE environment_id = ?").get(id) as { n: number };
  if (n > 0) throw new ValidationError(`Environnement utilisé par ${n} projet(s) : modifiez-les d'abord`);
  db.prepare("DELETE FROM environments WHERE id = ?").run(id);
}

export function getEnvironment(db: DB, id: number): Environment | undefined {
  return db.prepare("SELECT * FROM environments WHERE id = ?").get(id) as Environment | undefined;
}

export function listEnvironments(db: DB): Array<Environment & { secret_count: number }> {
  return db
    .prepare(
      `SELECT e.*, (SELECT count(*) FROM secrets s WHERE s.environment_id = e.id) AS secret_count
       FROM environments e ORDER BY e.name`,
    )
    .all() as Array<Environment & { secret_count: number }>;
}

export function listSecretKeys(db: DB, envId: number): Array<{ id: number; key: string; updated_at: string }> {
  return db
    .prepare("SELECT id, key, updated_at FROM secrets WHERE environment_id = ? ORDER BY key")
    .all(envId) as Array<{ id: number; key: string; updated_at: string }>;
}

export function getSecret(
  db: DB,
  secretId: number,
): { id: number; environment_id: number; key: string; value: string } | undefined {
  return db.prepare("SELECT id, environment_id, key, value FROM secrets WHERE id = ?").get(secretId) as
    | { id: number; environment_id: number; key: string; value: string }
    | undefined;
}

export function upsertSecret(db: DB, envId: number, key: string, value: string): void {
  assertSecretKey(key);
  const now = nowIso();
  db.prepare(
    `INSERT INTO secrets (environment_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (environment_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(envId, key, value, now);
  db.prepare("UPDATE environments SET updated_at = ? WHERE id = ?").run(now, envId);
}

export function deleteSecret(db: DB, secretId: number): void {
  db.prepare("DELETE FROM secrets WHERE id = ?").run(secretId);
}

export function getSecretsMap(db: DB, envId: number): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM secrets WHERE environment_id = ?").all(envId) as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function importDotenv(db: DB, envId: number, text: string): number {
  const pairs = parseDotenv(text);
  for (const [key] of pairs) assertSecretKey(key);
  db.transaction(() => {
    for (const [key, value] of pairs) upsertSecret(db, envId, key, value);
  })();
  return pairs.length;
}
