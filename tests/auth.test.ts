import { generateSync } from "otplib";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { beginLoginAttempt, loginDelayMs, markAttemptSuccess, rateLimitKey } from "@/lib/auth/rate-limit";
import {
  confirmSession,
  createSession,
  deleteSession,
  deleteSessionById,
  findSession,
  isRecentlyConfirmed,
  listSessions,
  markSessionTotpOk,
} from "@/lib/auth/session";
import { checkTotp, isTotpSecret, newTotpSecret } from "@/lib/auth/totp";
import { testDb } from "./helpers";
import type { DB } from "@/lib/db";

describe("TOTP", () => {
  it("accepte un code valide et refuse son rejeu (Review Focus 5)", () => {
    const secret = newTotpSecret();
    const token = generateSync({ secret });
    const first = checkTotp(secret, token, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(checkTotp(secret, token, first.step).ok).toBe(false);
  });

  it("un dernier pas très ancien ne bloque pas la connexion (Review Focus 5)", () => {
    const secret = newTotpSecret();
    expect(checkTotp(secret, generateSync({ secret }), 1).ok).toBe(true);
  });

  it("enregistre le pas réellement validé : un code du pas précédent n'est pas rejouable", () => {
    const secret = newTotpSecret();
    const now = new Date("2026-10-04T10:00:15Z");
    const epoch = Math.floor(now.getTime() / 1000);
    const current = Math.floor(epoch / 30);
    const old = generateSync({ secret, epoch: epoch - 30 });
    expect(checkTotp(secret, old, null, now)).toEqual({ ok: true, step: current - 1 });
    expect(checkTotp(secret, old, current - 1, now).ok).toBe(false);
  });

  it("refuse tout code si le dernier pas est dans le futur (horloge reculée)", () => {
    const secret = newTotpSecret();
    const now = new Date("2026-10-04T10:00:15Z");
    const current = Math.floor(now.getTime() / 1000 / 30);
    const token = generateSync({ secret, epoch: Math.floor(now.getTime() / 1000) });
    expect(checkTotp(secret, token, current + 5, now).ok).toBe(false);
  });

  it("refuse un mauvais code ou un format invalide", () => {
    const secret = newTotpSecret();
    expect(checkTotp(secret, "000000", null).ok).toBe(false);
    expect(checkTotp(secret, "abc", null).ok).toBe(false);
  });

  it("tolère les espaces", () => {
    const secret = newTotpSecret();
    const t = generateSync({ secret });
    expect(checkTotp(secret, `${t.slice(0, 3)} ${t.slice(3)}`, null).ok).toBe(true);
  });

  it("n'accepte comme nouveau secret que la forme générée : 32 caractères base32", () => {
    expect(isTotpSecret(newTotpSecret())).toBe(true);
    expect(isTotpSecret("A".repeat(16))).toBe(false);
    expect(isTotpSecret("a".repeat(32))).toBe(false);
    expect(isTotpSecret(`${"A".repeat(31)}1`)).toBe(false);
    expect(isTotpSecret("A".repeat(33))).toBe(false);
  });
});

function fail(db: DB, ip: string, kind: "password" | "totp", now: Date): void {
  const r = beginLoginAttempt(db, ip, kind, now);
  expect(r.allowed).toBe(true);
}

function succeed(db: DB, ip: string, kind: "password" | "totp", now: Date): void {
  const r = beginLoginAttempt(db, ip, kind, now);
  if (!r.allowed) throw new Error("tentative refusée");
  markAttemptSuccess(db, r.attemptId);
}

describe("limitation des tentatives", () => {
  const t0 = new Date("2026-10-04T10:00:00Z");

  it("libre jusqu'à 4 échecs, puis attente exponentielle plafonnée", () => {
    const db = testDb();
    for (let i = 0; i < 4; i++) fail(db, "1.1.1.1", "password", t0);
    expect(loginDelayMs(db, "1.1.1.1", "password", t0)).toBe(0);
    fail(db, "1.1.1.1", "password", t0);
    expect(loginDelayMs(db, "1.1.1.1", "password", t0)).toBe(30_000);
    // Les tentatives refusées n'ajoutent rien : on avance après l'attente.
    const t1 = new Date(t0.getTime() + 30_000);
    fail(db, "1.1.1.1", "password", t1);
    expect(loginDelayMs(db, "1.1.1.1", "password", t1)).toBe(60_000);
    expect(loginDelayMs(db, "2.2.2.2", "password", t1)).toBe(0);
    expect(loginDelayMs(db, "1.1.1.1", "password", new Date(t1.getTime() + 61_000))).toBe(0);
  });

  it("un succès du mot de passe ne remet pas à zéro le compteur TOTP", () => {
    const db = testDb();
    for (let i = 0; i < 6; i++) fail(db, "ip", "totp", new Date(t0.getTime() + i * 40_000));
    const now = new Date(t0.getTime() + 5 * 40_000 + 10_000);
    expect(loginDelayMs(db, "ip", "totp", now)).toBeGreaterThan(0);
    succeed(db, "ip", "password", now);
    expect(loginDelayMs(db, "ip", "totp", now)).toBeGreaterThan(0);
  });

  it("un succès TOTP remet à zéro les compteurs mot de passe et TOTP de la clé", () => {
    const db = testDb();
    for (let i = 0; i < 5; i++) fail(db, "ip", "password", t0);
    for (let i = 0; i < 5; i++) fail(db, "ip", "totp", t0);
    expect(loginDelayMs(db, "ip", "password", t0)).toBeGreaterThan(0);
    // Un succès TOTP exige que le délai TOTP soit écoulé.
    succeed(db, "ip", "totp", new Date(t0.getTime() + 31_000));
    const now = new Date(t0.getTime() + 31_000);
    expect(loginDelayMs(db, "ip", "password", now)).toBe(0);
    expect(loginDelayMs(db, "ip", "totp", now)).toBe(0);
  });

  it("réserve l'échec avant le travail asynchrone : des requêtes parallèles ne contournent pas la limite", () => {
    const db = testDb();
    const results = Array.from({ length: 6 }, () => beginLoginAttempt(db, "9.9.9.9", "totp", t0));
    expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
    expect(results[5].allowed).toBe(false);
  });

  it("regroupe les IPv6 par /64 et normalise les IPv4 mappées", () => {
    expect(rateLimitKey("2001:db8:1:2:3:4:5:6")).toBe(rateLimitKey("2001:db8:1:2:ffff::1"));
    expect(rateLimitKey("2001:db8::1")).not.toBe(rateLimitKey("2001:db9::1"));
    expect(rateLimitKey("1.2.3.4")).toBe("1.2.3.4");
    expect(rateLimitKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });

  it("limite globale TOTP : 21 échecs TOTP sur 21 clés ralentissent une clé neuve (5 min max)", () => {
    const db = testDb();
    for (let i = 0; i < 21; i++) fail(db, `10.0.0.${i}`, "totp", t0);
    const delay = loginDelayMs(db, "10.0.1.1", "totp", t0);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(300_000);
    expect(beginLoginAttempt(db, "10.0.1.1", "totp", t0).allowed).toBe(false);
  });

  it("limite globale douce du mot de passe : libre jusqu'à 100 échecs, puis au plus 30 s", () => {
    const db = testDb();
    for (let i = 0; i < 100; i++) fail(db, `10.0.${Math.floor(i / 250)}.${i % 250}`, "password", t0);
    expect(loginDelayMs(db, "10.9.9.9", "password", t0)).toBe(0);
    expect(beginLoginAttempt(db, "10.9.9.9", "password", t0).allowed).toBe(true);
    const delay = loginDelayMs(db, "10.9.9.8", "password", t0);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(30_000);
  });

  it("limite globale du mot de passe plafonnée à 30 s (le propriétaire n'attend jamais plus)", () => {
    const db = testDb();
    const insert = db.prepare("INSERT INTO login_attempts (ip, attempted_at, success, kind) VALUES (?, ?, 0, 'password')");
    for (let i = 0; i < 300; i++) insert.run(`k${i}`, t0.toISOString());
    const delay = loginDelayMs(db, "neuve", "password", t0);
    expect(delay).toBe(30_000);
    expect(loginDelayMs(db, "neuve", "password", new Date(t0.getTime() + 31_000))).toBe(0);
    // Une connexion complète (succès TOTP) remet aussi à zéro le compteur global du mot de passe.
    db.prepare("INSERT INTO login_attempts (ip, attempted_at, success, kind) VALUES ('autre', ?, 1, 'totp')").run(t0.toISOString());
    expect(loginDelayMs(db, "neuve", "password", t0)).toBe(0);
  });
});

describe("appareil de confiance et limites globales", () => {
  const t0 = new Date("2026-10-04T10:00:00Z");

  it("(a) TOTP : l'appareil de confiance est exempté de la limite globale", () => {
    const db = testDb();
    for (let i = 0; i < 21; i++) fail(db, `10.0.0.${i}`, "totp", t0);
    expect(loginDelayMs(db, "10.0.1.1", "totp", t0)).toBeGreaterThan(0);
    expect(loginDelayMs(db, "10.0.1.1", "totp", t0, { trusted: true })).toBe(0);
    expect(beginLoginAttempt(db, "10.0.1.1", "totp", t0, { trusted: true }).allowed).toBe(true);
  });

  it("(b) mot de passe : l'appareil de confiance est exempté de la limite globale", () => {
    const db = testDb();
    const insert = db.prepare("INSERT INTO login_attempts (ip, attempted_at, success, kind) VALUES (?, ?, 0, 'password')");
    for (let i = 0; i < 101; i++) insert.run(`k${i}`, t0.toISOString());
    expect(loginDelayMs(db, "neuve", "password", t0)).toBeGreaterThan(0);
    expect(loginDelayMs(db, "neuve", "password", t0, { trusted: true })).toBe(0);
    expect(beginLoginAttempt(db, "neuve", "password", t0, { trusted: true }).allowed).toBe(true);
  });

  it("(c) n'exempte jamais de la limite par clé", () => {
    for (const kind of ["password", "totp"] as const) {
      const db = testDb();
      for (let i = 0; i < 5; i++) {
        expect(beginLoginAttempt(db, "7.7.7.7", kind, t0, { trusted: true }).allowed).toBe(true);
      }
      expect(loginDelayMs(db, "7.7.7.7", kind, t0, { trusted: true })).toBeGreaterThan(0);
      expect(beginLoginAttempt(db, "7.7.7.7", kind, t0, { trusted: true }).allowed).toBe(false);
    }
  });

  it("les échecs d'un appareil de confiance sont enregistrés comme les autres", () => {
    const db = testDb();
    beginLoginAttempt(db, "7.7.7.7", "totp", t0, { trusted: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0").get()).toEqual({ n: 1 });
  });
});

describe("sessions", () => {
  it("session en attente de TOTP courte, puis 7 jours après validation", () => {
    const db = testDb();
    const t0 = new Date("2026-10-04T10:00:00Z");
    const token = createSession(db, { ip: "ip", userAgent: "ua" }, t0);
    expect(findSession(db, token, t0)).toMatchObject({ totp_ok: false });
    expect(findSession(db, token, new Date(t0.getTime() + 11 * 60_000))).toBeNull();

    const token2 = createSession(db, { ip: null, userAgent: null }, t0);
    const upgraded = markSessionTotpOk(db, token2, t0)!;
    // Utilisée toutes les 3 h : jamais inactive, mais limitée à 7 jours au total.
    for (let h = 3; h <= 6 * 24; h += 3) {
      expect(findSession(db, upgraded, new Date(t0.getTime() + h * 3_600_000))).toMatchObject({ totp_ok: true });
    }
    expect(findSession(db, upgraded, new Date(t0.getTime() + 8 * 86_400_000))).toBeNull();
    expect(findSession(db, token2, t0)).toBeNull();
  });

  it("stocke le jeton haché et le supprime à la déconnexion", () => {
    const db = testDb();
    const token = createSession(db, { ip: null, userAgent: null });
    const raw = db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
    expect(raw.token_hash).not.toBe(token);
    deleteSession(db, token);
    expect(findSession(db, token)).toBeNull();
  });

  it("la validation TOTP renouvelle le jeton (anti-fixation) et n'est utilisable qu'une fois", () => {
    const db = testDb();
    const t0 = new Date("2026-10-04T10:00:00Z");
    const token = createSession(db, { ip: null, userAgent: null }, t0);
    const upgraded = markSessionTotpOk(db, token, t0);
    expect(upgraded).not.toBeNull();
    expect(upgraded).not.toBe(token);
    expect(findSession(db, token, t0)).toBeNull();
    expect(findSession(db, upgraded!, t0)).toMatchObject({ totp_ok: true });
    expect(markSessionTotpOk(db, token, t0)).toBeNull();
    expect(markSessionTotpOk(db, upgraded!, t0)).toBeNull();
  });

  it("refuse de valider une session expirée et purge les sessions expirées à la création", () => {
    const db = testDb();
    const t0 = new Date("2026-10-04T10:00:00Z");
    const token = createSession(db, { ip: null, userAgent: null }, t0);
    const later = new Date(t0.getTime() + 11 * 60_000);
    expect(markSessionTotpOk(db, token, later)).toBeNull();
    createSession(db, { ip: null, userAgent: null }, later);
    const count = db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("sessions : inactivité et confirmation récente", () => {
  const t0 = new Date("2026-10-04T10:00:00Z");
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  it("expire après 4 h sans activité", () => {
    const db = testDb();
    const token = markSessionTotpOk(db, createSession(db, { ip: null, userAgent: null }, t0), t0)!;
    expect(findSession(db, token, at(3 * 60))).not.toBeNull();
    expect(findSession(db, token, at(6 * 60))).not.toBeNull(); // 3 h après la dernière activité
    expect(findSession(db, token, at(10 * 60 + 1))).toBeNull(); // plus de 4 h après
  });

  it("une connexion complète vaut confirmation pendant 10 min, renouvelable par un code", () => {
    const db = testDb();
    const token = markSessionTotpOk(db, createSession(db, { ip: null, userAgent: null }, t0), t0)!;
    expect(isRecentlyConfirmed(findSession(db, token, at(9))!, at(9))).toBe(true);
    expect(isRecentlyConfirmed(findSession(db, token, at(11))!, at(11))).toBe(false);
    confirmSession(db, findSession(db, token, at(30))!.id, at(30));
    expect(isRecentlyConfirmed(findSession(db, token, at(35))!, at(35))).toBe(true);
  });

  it("une session en attente de TOTP n'est jamais confirmée", () => {
    const db = testDb();
    const token = createSession(db, { ip: null, userAgent: null }, t0);
    const s = findSession(db, token, t0)!;
    confirmSession(db, s.id, t0);
    expect(isRecentlyConfirmed(findSession(db, token, t0)!, t0)).toBe(false);
  });

  it("liste les sessions ouvertes et en révoque une", () => {
    const db = testDb();
    const a = markSessionTotpOk(db, createSession(db, { ip: "203.0.113.1", userAgent: "Firefox" }, t0), t0)!;
    const b = markSessionTotpOk(db, createSession(db, { ip: "203.0.113.2", userAgent: "Safari" }, t0), t0)!;
    createSession(db, { ip: "198.51.100.9", userAgent: "attente" }, t0); // en attente de TOTP : non listée
    const list = listSessions(db, at(1));
    expect(list.map((s) => s.ip).sort()).toEqual(["203.0.113.1", "203.0.113.2"]);
    deleteSessionById(db, findSession(db, b, at(1))!.id);
    expect(findSession(db, b, at(2))).toBeNull();
    expect(findSession(db, a, at(2))).not.toBeNull();
  });
});

describe("mot de passe", () => {
  it("argon2id 64 Mio / 3 passes ; un ancien haché est à recalculer", async () => {
    const h = await hashPassword("un-mot-de-passe-long");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(needsRehash(h)).toBe(false);
    expect(await verifyPassword(h, "un-mot-de-passe-long")).toBe(true);
    expect(needsRehash("$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaA")).toBe(true);
    expect(needsRehash("$2b$10$bcrypt")).toBe(true);
  });
});
