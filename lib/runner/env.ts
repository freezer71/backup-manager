export function formatStamp(d: Date, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
}

// Environnement minimal : aucune variable du processus Next.js (dont DB_ENCRYPTION_KEY) n'est héritée.
export function buildRunEnv(o: {
  secrets: Record<string, string>;
  outputDir: string;
  homeDir: string;
  projectSlug: string;
  stamp: string;
  tz: string;
}): Record<string, string> {
  return {
    ...o.secrets,
    PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: o.homeDir,
    TZ: o.tz,
    LANG: "C.UTF-8",
    OUTPUT_DIR: o.outputDir,
    PROJECT_NAME: o.projectSlug,
    TIMESTAMP: o.stamp,
  };
}
