export type AppConfig = {
  dataDir: string;
  nasDir: string;
  dbKey: string;
  adminEmail: string | null;
  adminPassword: string | null;
  appUrl: string;
  tz: string;
  // Socket du runner isolé ; null = scripts exécutés dans ce processus (développement, tests).
  runnerSocket: string | null;
  // Clés publiques age : si présentes, chaque copie NAS est chiffrée pour elles, le NAS ne reçoit jamais de clair.
  nasRecipients: string[];
};

const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const dbKey = env.DB_ENCRYPTION_KEY ?? "";
  if (dbKey.length < 32) {
    throw new ConfigError("DB_ENCRYPTION_KEY manquante ou trop courte (32 caractères minimum)");
  }
  const runnerSocket = env.RUNNER_SOCKET || null;
  // En production, un script ne doit jamais tourner à côté de la base et de sa clé.
  if (env.NODE_ENV === "production" && !runnerSocket && env.RUNNER_MODE !== "local") {
    throw new ConfigError("RUNNER_SOCKET manquante : les scripts doivent tourner dans le runner isolé (ou RUNNER_MODE=local)");
  }
  const nasRecipients = (env.NAS_AGE_RECIPIENTS ?? "").split(/[\s,]+/).filter(Boolean);
  // La valeur fautive n'est pas citée : ce pourrait être une clé privée collée par erreur.
  if (nasRecipients.some((r) => !AGE_RECIPIENT.test(r))) {
    throw new ConfigError("NAS_AGE_RECIPIENTS : clé publique age invalide (attendu : age1…, séparées par des virgules)");
  }
  return {
    dataDir: env.DATA_DIR || "/data",
    nasDir: env.NAS_DIR || "/mnt/backups-nas",
    dbKey,
    adminEmail: env.ADMIN_EMAIL?.trim() || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    appUrl: (env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
    tz: env.TZ || "Europe/Paris",
    runnerSocket,
    nasRecipients,
  };
}
