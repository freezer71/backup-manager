import { describe, expect, it } from "vitest";
import {
  TRUSTED_DEVICE_TTL_MS,
  isTrustedDevice,
  issueTrustedDevice,
  revokeAllTrustedDevices,
} from "@/lib/auth/trusted-device";
import { testDb } from "./helpers";

describe("appareil de confiance", () => {
  const t0 = new Date("2026-10-04T10:00:00Z");

  it("reconnaît un jeton émis, pas un jeton inconnu, et ne stocke que son haché", () => {
    const db = testDb();
    const token = issueTrustedDevice(db, { userAgent: "UA" }, t0);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isTrustedDevice(db, token, t0)).toBe(true);
    expect(isTrustedDevice(db, "inconnu", t0)).toBe(false);
    const rows = JSON.stringify(db.prepare("SELECT * FROM trusted_devices").all());
    expect(rows).not.toContain(token);
  });

  it("met à jour last_used_at à chaque usage", () => {
    const db = testDb();
    const token = issueTrustedDevice(db, { userAgent: null }, t0);
    const later = new Date(t0.getTime() + 3_600_000);
    expect(isTrustedDevice(db, token, later)).toBe(true);
    const row = db.prepare("SELECT last_used_at FROM trusted_devices").get() as { last_used_at: string };
    expect(row.last_used_at).toBe(later.toISOString());
  });

  it("expire après 90 jours et supprime la ligne expirée", () => {
    const db = testDb();
    const token = issueTrustedDevice(db, { userAgent: null }, t0);
    expect(TRUSTED_DEVICE_TTL_MS).toBe(90 * 86_400_000);
    expect(isTrustedDevice(db, token, new Date(t0.getTime() + TRUSTED_DEVICE_TTL_MS - 1))).toBe(true);
    expect(isTrustedDevice(db, token, new Date(t0.getTime() + TRUSTED_DEVICE_TTL_MS))).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM trusted_devices").get()).toEqual({ n: 0 });
  });

  it("revokeAllTrustedDevices invalide tous les jetons", () => {
    const db = testDb();
    const a = issueTrustedDevice(db, { userAgent: null }, t0);
    const b = issueTrustedDevice(db, { userAgent: "x" }, t0);
    revokeAllTrustedDevices(db);
    expect(isTrustedDevice(db, a, t0)).toBe(false);
    expect(isTrustedDevice(db, b, t0)).toBe(false);
  });
});
