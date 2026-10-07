import { describe, expect, it } from "vitest";
import { verifyPassword } from "@/lib/auth/password";
import { ensureAdmin } from "@/lib/bootstrap";
import { ConfigError } from "@/lib/config";
import { getUser } from "@/lib/repo/user";
import { testConfig, testDb } from "./helpers";

describe("ensureAdmin", () => {
  it("crée le compte depuis les variables puis les ignore", async () => {
    const db = testDb();
    const cfg = { ...testConfig(), adminEmail: "Me@X.fr", adminPassword: "mot-de-passe-long" };
    expect(await ensureAdmin(db, cfg)).toBe("created");
    const user = getUser(db)!;
    expect(user.email).toBe("me@x.fr");
    expect(await verifyPassword(user.password_hash, "mot-de-passe-long")).toBe(true);
    expect(await ensureAdmin(db, { ...cfg, adminPassword: "autre-mot-de-passe" })).toBe("exists");
  });

  it("refuse de démarrer sans compte ni variables, ou avec un mot de passe court", async () => {
    await expect(ensureAdmin(testDb(), testConfig())).rejects.toThrow(ConfigError);
    await expect(
      ensureAdmin(testDb(), { ...testConfig(), adminEmail: "a@b.c", adminPassword: "court" }),
    ).rejects.toThrow(/12 caractères/);
  });
});
