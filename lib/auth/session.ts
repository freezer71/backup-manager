import { createHash, randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";

export const PENDING_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 7 * 86_400_000;
// Sans activité pendant 4 h, la session expire (la limite de 7 jours reste).
export const IDLE_TTL_MS = 4 * 3_600_000;
// Actions sensibles (secrets, scripts, téléchargements, webhook) : code TOTP saisi il y a moins de 10 min.
export const REAUTH_TTL_MS = 10 * 60_000;
// last_seen_at n'est réécrit qu'une fois par minute au plus.
const TOUCH_EVERY_MS = 60_000;

export type Session = { id: number; totp_ok: boolean; expires_at: string; reauth_at: string | null };

export type SessionInfo = { id: number; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null };

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
  const row = db
    .prepare("SELECT id, totp_ok, expires_at, created_at, last_seen_at, reauth_at FROM sessions WHERE token_hash = ?")
    .get(hashToken(token)) as
    | { id: number; totp_ok: number; expires_at: string; created_at: string; last_seen_at: string | null; reauth_at: string | null }
    | undefined;
  if (!row) return null;
  const lastSeen = new Date(row.last_seen_at ?? row.created_at).getTime();
  if (new Date(row.expires_at) <= now || (row.totp_ok === 1 && now.getTime() - lastSeen > IDLE_TTL_MS)) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
    return null;
  }
  if (now.getTime() - lastSeen >= TOUCH_EVERY_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now.toISOString(), row.id);
  }
  return { id: row.id, totp_ok: row.totp_ok === 1, expires_at: row.expires_at, reauth_at: row.reauth_at };
}

export function isRecentlyConfirmed(session: Session, now: Date = new Date()): boolean {
  return session.totp_ok && !!session.reauth_at && now.getTime() - new Date(session.reauth_at).getTime() < REAUTH_TTL_MS;
}

// Après un code TOTP valide saisi pour confirmer une action sensible.
export function confirmSession(db: DB, sessionId: number, now: Date = new Date()): void {
  db.prepare("UPDATE sessions SET reauth_at = ? WHERE id = ? AND totp_ok = 1").run(now.toISOString(), sessionId);
}

// Sessions complètes encore valides, la plus récemment utilisée d'abord.
export function listSessions(db: DB, now: Date = new Date()): SessionInfo[] {
  const idleLimit = new Date(now.getTime() - IDLE_TTL_MS).toISOString();
  return db
    .prepare(
      `SELECT id, created_at, COALESCE(last_seen_at, created_at) AS last_seen_at, ip, user_agent FROM sessions
       WHERE totp_ok = 1 AND expires_at > ? AND COALESCE(last_seen_at, created_at) >= ? ORDER BY last_seen_at DESC`,
    )
    .all(now.toISOString(), idleLimit) as SessionInfo[];
}

export function deleteSessionById(db: DB, id: number): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

// Anti-fixation : la session validée reçoit un NOUVEAU jeton ; l'ancien cesse de fonctionner.
// Ne s'applique qu'à une session en attente et non expirée. Renvoie null sinon.
export function markSessionTotpOk(db: DB, token: string, now: Date = new Date()): string | null {
  const newToken = randomBytes(32).toString("base64url");
  const info = db
    .prepare(
      `UPDATE sessions SET token_hash = ?, totp_ok = 1, expires_at = ?, last_seen_at = ?, reauth_at = ?
       WHERE token_hash = ? AND totp_ok = 0 AND expires_at > ?`,
    )
    .run(
      hashToken(newToken),
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      now.toISOString(),
      now.toISOString(),
      hashToken(token),
      now.toISOString(),
    );
  return info.changes === 1 ? newToken : null;
}

export function deleteSession(db: DB, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function deleteAllSessions(db: DB): void {
  db.prepare("DELETE FROM sessions").run();
}
