import { createHash, randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";

export const PENDING_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 7 * 86_400_000;

export type Session = { id: number; totp_ok: boolean; expires_at: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(
  db: DB,
  meta: { ip: string | null; userAgent: string | null },
  now: Date = new Date(),
): string {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO sessions (token_hash, totp_ok, expires_at, created_at, ip, user_agent) VALUES (?, 0, ?, ?, ?, ?)",
  ).run(hashToken(token), new Date(now.getTime() + PENDING_TTL_MS).toISOString(), now.toISOString(), meta.ip, meta.userAgent);
  return token;
}

export function findSession(db: DB, token: string, now: Date = new Date()): Session | null {
  const row = db.prepare("SELECT id, totp_ok, expires_at FROM sessions WHERE token_hash = ?").get(hashToken(token)) as
    | { id: number; totp_ok: number; expires_at: string }
    | undefined;
  if (!row) return null;
  if (new Date(row.expires_at) <= now) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
    return null;
  }
  return { id: row.id, totp_ok: row.totp_ok === 1, expires_at: row.expires_at };
}

// Anti-fixation : la session validée reçoit un NOUVEAU jeton ; l'ancien cesse de fonctionner.
// Ne s'applique qu'à une session en attente et non expirée. Renvoie null sinon.
export function markSessionTotpOk(db: DB, token: string, now: Date = new Date()): string | null {
  const newToken = randomBytes(32).toString("base64url");
  const info = db
    .prepare(
      "UPDATE sessions SET token_hash = ?, totp_ok = 1, expires_at = ? WHERE token_hash = ? AND totp_ok = 0 AND expires_at > ?",
    )
    .run(hashToken(newToken), new Date(now.getTime() + SESSION_TTL_MS).toISOString(), hashToken(token), now.toISOString());
  return info.changes === 1 ? newToken : null;
}

export function deleteSession(db: DB, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function deleteAllSessions(db: DB): void {
  db.prepare("DELETE FROM sessions").run();
}
