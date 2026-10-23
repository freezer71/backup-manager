import { describe, expect, it } from "vitest";
import { audit, listAudit } from "@/lib/repo/audit";
import {
  createEnvironment,
  deleteEnvironment,
  getSecretsMap,
  importDotenv,
  listEnvironments,
  listSecretKeys,
  upsertSecret,
} from "@/lib/repo/environments";
import { getSetting, setSetting } from "@/lib/repo/settings";
import { claimTotpStep, confirmTotp, createUser, getUser, replaceTotpSecret, setTotpPending } from "@/lib/repo/user";
import { ValidationError } from "@/lib/validation";
import { testDb } from "./helpers";

describe("environnements et secrets", () => {
  it("crée, liste et compte les secrets", () => {
    const db = testDb();
    const id = createEnvironment(db, { name: "pilote", description: "prod" });
    upsertSecret(db, id, "DATABASE_URL", "postgres://a");
    upsertSecret(db, id, "DATABASE_URL", "postgres://b");
    upsertSecret(db, id, "OTHER", "x");
    expect(getSecretsMap(db, id)).toEqual({ DATABASE_URL: "postgres://b", OTHER: "x" });
    expect(listEnvironments(db)[0]).toMatchObject({ name: "pilote", secret_count: 2 });
    expect(listSecretKeys(db, id).map((s) => s.key)).toEqual(["DATABASE_URL", "OTHER"]);
  });

  it("refuse un nom en double et une clé invalide", () => {
    const db = testDb();
    const id = createEnvironment(db, { name: "a", description: "" });
    expect(() => createEnvironment(db, { name: "a", description: "" })).toThrow(ValidationError);
    expect(() => upsertSecret(db, id, "bad-key", "v")).toThrow(ValidationError);
  });

  it("importe un .env", () => {
    const db = testDb();
    const id = createEnvironment(db, { name: "e", description: "" });
    expect(importDotenv(db, id, "A=1\nB=2")).toBe(2);
    expect(getSecretsMap(db, id)).toEqual({ A: "1", B: "2" });
  });

  it("refuse de supprimer un environnement utilisé par un projet", () => {
    const db = testDb();
    const id = createEnvironment(db, { name: "e", description: "" });
    db.prepare(
      "INSERT INTO projects (name, slug, environment_id, script, cron, created_at, updated_at) VALUES ('p','p',?,'echo','0 3 * * *','t','t')",
    ).run(id);
    expect(() => deleteEnvironment(db, id)).toThrow(/utilisé par 1 projet/);
  });
});

describe("réglages, audit, utilisateur", () => {
  it("lit et écrit un réglage", () => {
    const db = testDb();
    expect(getSetting(db, "webhook_url")).toBeNull();
    setSetting(db, "webhook_url", "https://ntfy.sh/x");
    expect(getSetting(db, "webhook_url")).toBe("https://ntfy.sh/x");
    setSetting(db, "webhook_url", null);
    expect(getSetting(db, "webhook_url")).toBeNull();
  });

  it("journalise les actions, les plus récentes d'abord", () => {
    const db = testDb();
    audit(db, "login.ok", "me", "1.2.3.4");
    audit(db, "secret.reveal", "pilote/DATABASE_URL");
    expect(listAudit(db).map((a) => a.action)).toEqual(["secret.reveal", "login.ok"]);
  });

  it("tronque cible et IP à 254 caractères", () => {
    const db = testDb();
    audit(db, "login.failed", "x".repeat(10_000), "y".repeat(10_000));
    const [entry] = listAudit(db);
    expect(entry.target).toHaveLength(254);
    expect(entry.ip).toHaveLength(254);
  });

  it("purge les entrées de plus de 180 jours à l'écriture suivante", () => {
    const db = testDb();
    const old = new Date(Date.now() - 181 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 179 * 86_400_000).toISOString();
    db.prepare("INSERT INTO audit_log (at, action) VALUES (?, 'old')").run(old);
    db.prepare("INSERT INTO audit_log (at, action) VALUES (?, 'recent')").run(recent);
    audit(db, "new");
    expect(listAudit(db).map((a) => a.action).sort()).toEqual(["new", "recent"]);
  });

  it("confirme un TOTP en attente", () => {
    const db = testDb();
    createUser(db, "me@x.fr", "hash");
    setTotpPending(db, "SECRET");
    expect(confirmTotp(db, "SECRET", 42)).toBe(true);
    expect(getUser(db)).toMatchObject({ totp_secret: "SECRET", totp_pending_secret: null, totp_last_step: 42 });
  });

  it("n'active que le secret vérifié : un QR régénéré entre-temps ne l'est pas", () => {
    const db = testDb();
    createUser(db, "me@x.fr", "hash");
    setTotpPending(db, "AUTRE");
    expect(confirmTotp(db, "AFFICHÉ", 5)).toBe(false);
    expect(getUser(db)).toMatchObject({ totp_secret: null, totp_pending_secret: "AUTRE" });
  });

  it("la première activation ne remplace jamais une 2FA déjà active", () => {
    const db = testDb();
    createUser(db, "me@x.fr", "hash");
    setTotpPending(db, "ACTIF");
    confirmTotp(db, "ACTIF", 1);
    setTotpPending(db, "AUTRE");
    expect(confirmTotp(db, "AUTRE", 5)).toBe(false);
    expect(getUser(db)).toMatchObject({ totp_secret: "ACTIF", totp_last_step: 1 });
  });

  it("remplace le TOTP actif par le secret vérifié, sans jamais laisser le compte sans TOTP", () => {
    const db = testDb();
    createUser(db, "me@x.fr", "hash");
    setTotpPending(db, "ANCIEN");
    confirmTotp(db, "ANCIEN", 1);
    expect(replaceTotpSecret(db, "NOUVEAU", 7)).toBe(true);
    expect(getUser(db)).toMatchObject({ totp_secret: "NOUVEAU", totp_pending_secret: null, totp_last_step: 7 });
  });

  it("le remplacement exige une 2FA active : la première activation passe par la page dédiée", () => {
    const db = testDb();
    createUser(db, "me@x.fr", "hash");
    expect(replaceTotpSecret(db, "NOUVEAU", 7)).toBe(false);
    expect(getUser(db)).toMatchObject({ totp_secret: null });
  });

  it("un pas TOTP n'est enregistré qu'une fois : le même code envoyé deux fois en parallèle ne passe qu'une fois", () => {
    const db = testDb();
    createUser(db, "me@x.fr", "hash");
    setTotpPending(db, "S");
    confirmTotp(db, "S", 10);
    expect(claimTotpStep(db, "S", 11)).toBe(true);
    expect(claimTotpStep(db, "S", 11)).toBe(false);
    expect(claimTotpStep(db, "S", 10)).toBe(false);
    expect(claimTotpStep(db, "S", 12)).toBe(true);
    expect(getUser(db)?.totp_last_step).toBe(12);
  });

  it("refuse le pas si le secret vérifié n'est plus le secret actif", () => {
    const db = testDb();
    createUser(db, "me@x.fr", "hash");
    setTotpPending(db, "S");
    confirmTotp(db, "S", 10);
    expect(claimTotpStep(db, "ANCIEN", 11)).toBe(false);
    expect(getUser(db)?.totp_last_step).toBe(10);
  });
});
