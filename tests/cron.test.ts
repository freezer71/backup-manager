import { describe, expect, it } from "vitest";
import { cronPeriodMs, describeCron, isValidCron, nextRuns } from "@/lib/cron";

describe("cron", () => {
  it("valide 5 champs uniquement", () => {
    expect(isValidCron("0 3 * * *")).toBe(true);
    expect(isValidCron("*/15 * * * *")).toBe(true);
    expect(isValidCron("0 0 3 * * *")).toBe(false);
    expect(isValidCron("pas un cron")).toBe(false);
    expect(isValidCron("")).toBe(false);
  });
  it("calcule les prochaines exécutions dans le fuseau donné", () => {
    const from = new Date("2026-10-04T12:00:00Z");
    const runs = nextRuns("0 3 * * *", 2, "Europe/Paris", from);
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-10-05T01:00:00.000Z", "2026-10-06T01:00:00.000Z"]);
  });
  it("décrit en français", () => {
    expect(describeCron("0 3 * * *")).toBe("À 03:00");
  });
  it("donne la période", () => {
    expect(cronPeriodMs("0 3 * * *", "Europe/Paris", new Date("2026-10-04T12:00:00Z"))).toBe(86_400_000);
  });
  it("rejette cron qui ne s'exécute jamais", () => {
    expect(isValidCron("0 0 31 2 *")).toBe(false);
  });
  it("retourne Infinity pour cronPeriodMs sans 2 exécutions", () => {
    expect(cronPeriodMs("0 0 31 2 *", "Europe/Paris")).toBe(Infinity);
  });
});
