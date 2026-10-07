import { cronPeriodMs } from "@/lib/cron";
import type { Run } from "@/lib/repo/runs";

export type Health = "disabled" | "never" | "running" | "stuck" | "failing" | "stale" | "nas_warning" | "ok";

export function projectHealth(
  p: { enabled: boolean; cron: string; timeout_minutes: number },
  last: Run | undefined,
  lastSuccess: Run | undefined,
  tz: string,
  now: Date = new Date(),
): Health {
  if (!p.enabled) return "disabled";
  if (last?.status === "running") {
    // Le runner arrête tout script au timeout : au-delà de timeout + 5 min, le run ne se terminera plus seul.
    const elapsed = now.getTime() - new Date(last.started_at).getTime();
    return elapsed > (p.timeout_minutes + 5) * 60_000 ? "stuck" : "running";
  }
  if (last && last.status !== "success") return "failing";
  if (!lastSuccess?.finished_at) return "never";
  const age = now.getTime() - new Date(lastSuccess.finished_at).getTime();
  // Période infinie (moins de 2 prochaines exécutions) : jamais périmé.
  const period = cronPeriodMs(p.cron, tz, now);
  if (Number.isFinite(period) && age > 2 * period) return "stale";
  if (lastSuccess.nas_status === "failed") return "nas_warning";
  return "ok";
}
