import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "@/lib/config";

const KEY = "x".repeat(32);

describe("loadConfig", () => {
  it("refuse une clé absente ou trop courte", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ DB_ENCRYPTION_KEY: "court" })).toThrow(/32 caractères/);
  });

  it("applique les valeurs par défaut", () => {
    const cfg = loadConfig({ DB_ENCRYPTION_KEY: KEY });
    expect(cfg).toEqual({
      dataDir: "/data",
      nasDir: "/mnt/backups-nas",
      dbKey: KEY,
      adminEmail: null,
      adminPassword: null,
      appUrl: "http://localhost:3000",
      tz: "Europe/Paris",
    });
  });

  it("lit les variables et retire le / final de APP_URL", () => {
    const cfg = loadConfig({
      DB_ENCRYPTION_KEY: KEY,
      DATA_DIR: "/tmp/d",
      NAS_DIR: "/tmp/n",
      ADMIN_EMAIL: " me@x.fr ",
      ADMIN_PASSWORD: "pw",
      APP_URL: "https://backups.example.com/",
      TZ: "UTC",
    });
    expect(cfg.adminEmail).toBe("me@x.fr");
    expect(cfg.appUrl).toBe("https://backups.example.com");
    expect(cfg.tz).toBe("UTC");
  });
});
