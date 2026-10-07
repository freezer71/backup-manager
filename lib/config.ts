export type AppConfig = {
  dataDir: string;
  nasDir: string;
  dbKey: string;
  adminEmail: string | null;
  adminPassword: string | null;
  appUrl: string;
  tz: string;
};

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const dbKey = env.DB_ENCRYPTION_KEY ?? "";
  if (dbKey.length < 32) {
    throw new ConfigError("DB_ENCRYPTION_KEY manquante ou trop courte (32 caractères minimum)");
  }
  return {
    dataDir: env.DATA_DIR || "/data",
    nasDir: env.NAS_DIR || "/mnt/backups-nas",
    dbKey,
    adminEmail: env.ADMIN_EMAIL?.trim() || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    appUrl: (env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
    tz: env.TZ || "Europe/Paris",
  };
}
