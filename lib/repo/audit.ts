import { nowIso, type DB } from "@/lib/db";

export type AuditEntry = { id: number; at: string; action: string; target: string | null; ip: string | null };

const MAX_FIELD = 254;
const RETENTION_MS = 180 * 86_400_000;

const clip = (v: string | null): string | null => (v === null ? null : v.slice(0, MAX_FIELD));

export function audit(db: DB, action: string, target: string | null = null, ip: string | null = null): void {
  db.prepare("DELETE FROM audit_log WHERE at < ?").run(new Date(Date.now() - RETENTION_MS).toISOString());
  db.prepare("INSERT INTO audit_log (at, action, target, ip) VALUES (?, ?, ?, ?)").run(nowIso(), action, clip(target), clip(ip));
}

export function listAudit(db: DB, limit = 100): AuditEntry[] {
  return db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit) as AuditEntry[];
}
