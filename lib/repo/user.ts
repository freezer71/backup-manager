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

// Remplace le haché seulement s'il n'a pas changé entre-temps (re-hachage à la connexion : ne jamais écraser
// un changement de mot de passe fait pendant le calcul).
export function replacePasswordHash(db: DB, previous: string, hash: string): boolean {
  return db.prepare("UPDATE user SET password_hash = ? WHERE id = 1 AND password_hash = ?").run(hash, previous).changes === 1;
}

export function setTotpPending(db: DB, secret: string): void {
  db.prepare("UPDATE user SET totp_pending_secret = ? WHERE id = 1").run(secret);
}

// Première activation uniquement : le secret en attente, s'il est toujours celui dont le code a été vérifié.
export function confirmTotp(db: DB, verifiedSecret: string, step: number): boolean {
  return (
    db
      .prepare(
        "UPDATE user SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_last_step = ? WHERE id = 1 AND totp_secret IS NULL AND totp_pending_secret = ?",
      )
      .run(step, verifiedSecret).changes === 1
  );
}

// Changement d'application : l'ancien secret reste valable jusqu'à cette requête, le compte n'est jamais sans TOTP.
export function replaceTotpSecret(db: DB, verifiedSecret: string, step: number): boolean {
  return (
    db
      .prepare(
        "UPDATE user SET totp_secret = ?, totp_pending_secret = NULL, totp_last_step = ? WHERE id = 1 AND totp_secret IS NOT NULL",
      )
      .run(verifiedSecret, step).changes === 1
  );
}

// Enregistre le pas d'un code accepté, en une seule requête : de deux requêtes parallèles qui ont validé le même
// code avec un dernier pas lu trop tôt, une seule passe.
export function claimTotpStep(db: DB, verifiedSecret: string, step: number): boolean {
  return (
    db
      .prepare(
        "UPDATE user SET totp_last_step = ? WHERE id = 1 AND totp_secret = ? AND (totp_last_step IS NULL OR totp_last_step < ?)",
      )
      .run(step, verifiedSecret, step).changes === 1
  );
}
