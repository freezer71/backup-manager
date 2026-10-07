import { nowIso, type DB } from "@/lib/db";

export type User = {
  id: 1;
  email: string;
  password_hash: string;
  totp_secret: string | null;
  totp_pending_secret: string | null;
  totp_last_step: number | null;
  created_at: string;
};

export function getUser(db: DB): User | undefined {
  return db.prepare("SELECT * FROM user WHERE id = 1").get() as User | undefined;
}

export function createUser(db: DB, email: string, passwordHash: string): void {
  db.prepare("INSERT INTO user (id, email, password_hash, created_at) VALUES (1, ?, ?, ?)").run(
    email,
    passwordHash,
    nowIso(),
  );
}

export function setPasswordHash(db: DB, hash: string): void {
  db.prepare("UPDATE user SET password_hash = ? WHERE id = 1").run(hash);
}

export function setTotpPending(db: DB, secret: string): void {
  db.prepare("UPDATE user SET totp_pending_secret = ? WHERE id = 1").run(secret);
}

export function confirmTotp(db: DB, step: number): void {
  db.prepare(
    "UPDATE user SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_last_step = ? WHERE id = 1",
  ).run(step);
}

export function setTotpLastStep(db: DB, step: number): void {
  db.prepare("UPDATE user SET totp_last_step = ? WHERE id = 1").run(step);
}

export function resetTotp(db: DB): void {
  db.prepare(
    "UPDATE user SET totp_secret = NULL, totp_pending_secret = NULL, totp_last_step = NULL WHERE id = 1",
  ).run();
}
