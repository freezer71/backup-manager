import { Cron } from "croner";
import cronstrue from "cronstrue/i18n";

export function isValidCron(expr: string): boolean {
  if (expr.trim().split(/\s+/).length !== 5) return false;
  try {
    const job = new Cron(expr, { paused: true });
    const hasNextRun = job.nextRun() !== null;
    job.stop();
    return hasNextRun;
  } catch {
    return false;
  }
}

export function nextRuns(expr: string, n: number, tz: string, from?: Date): Date[] {
  const job = new Cron(expr, { paused: true, timezone: tz });
  const runs = job.nextRuns(n, from);
  job.stop();
  return runs;
}

export function describeCron(expr: string): string {
  try {
    return cronstrue.toString(expr, { locale: "fr", use24HourTimeFormat: true });
  } catch {
    return "Expression invalide";
  }
}

export function cronPeriodMs(expr: string, tz: string, from: Date = new Date()): number {
  const runs = nextRuns(expr, 2, tz, from);
  if (runs.length < 2) return Infinity;
  return runs[1].getTime() - runs[0].getTime();
}
