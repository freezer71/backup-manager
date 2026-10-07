import { createHash, randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";

export const TRUSTED_DEVICE_TTL_MS = 90 * 86_400_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Émis après une connexion complète (mot de passe + TOTP). Seul le haché du jeton est stocké.
export function issueTrustedDevice(db: DB, meta: { userAgent: string | null }, now: Date = new Date()): string {
  db.prepare("DELETE FROM trusted_devices WHERE expires_at <= ?").run(now.toISOString());
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO trusted_devices (token_hash, created_at, last_used_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
  ).run(
    hashToken(token),
    now.toISOString(),
    now.toISOString(),
    new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS).toISOString(),
    meta.userAgent?.slice(0, 254) ?? null,
  );
  return token;
}

export function isTrustedDevice(db: DB, token: string, now: Date = new Date()): boolean {
  const row = db.prepare("SELECT id, expires_at FROM trusted_devices WHERE token_hash = ?").get(hashToken(token)) as
    | { id: number; expires_at: string }
    | undefined;
  if (!row) return false;
  if (new Date(row.expires_at) <= now) {
    db.prepare("DELETE FROM trusted_devices WHERE id = ?").run(row.id);
    return false;
  }
  db.prepare("UPDATE trusted_devices SET last_used_at = ? WHERE id = ?").run(now.toISOString(), row.id);
  return true;
}

// À appeler lors d'un changement de mot de passe ou d'une réinitialisation TOTP.
export function revokeAllTrustedDevices(db: DB): void {
  db.prepare("DELETE FROM trusted_devices").run();
}
