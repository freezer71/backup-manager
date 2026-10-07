import { describe, expect, it } from "vitest";
import { cronPeriodMs } from "@/lib/cron";
import { projectHealth } from "@/lib/health";
import type { Run } from "@/lib/repo/runs";

const now = new Date("2026-10-04T12:00:00Z");
const p = { enabled: true, cron: "0 3 * * *", timeout_minutes: 60 };
const run = (o: Partial<Run>): Run => ({
  id: 1, project_id: 1, trigger: "schedule", status: "success", stamp: "s",
  started_at: "2026-10-04T01:00:00Z", finished_at: "2026-10-04T01:01:00Z",
  exit_code: 0, size_bytes: 1, files: [], log: "", nas_status: "ok", nas_error: null, pruned: false, script_ms: null, nas_ms: null, ...o,
});

describe("projectHealth", () => {
  it("désactivé, jamais lancé, en cours", () => {
    expect(projectHealth({ ...p, enabled: false }, undefined, undefined, "UTC", now)).toBe("disabled");
    expect(projectHealth(p, undefined, undefined, "UTC", now)).toBe("never");
    expect(projectHealth(p, run({ status: "running", started_at: "2026-10-04T11:30:00Z", finished_at: null }), undefined, "UTC", now)).toBe("running");
  });
  it("en cours depuis plus que timeout + 5 min : bloqué", () => {
    const since = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
    expect(projectHealth(p, run({ status: "running", started_at: since(64), finished_at: null }), undefined, "UTC", now)).toBe("running");
    expect(projectHealth(p, run({ status: "running", started_at: since(66), finished_at: null }), undefined, "UTC", now)).toBe("stuck");
    expect(projectHealth({ ...p, timeout_minutes: 1 }, run({ status: "running", started_at: since(7), finished_at: null }), undefined, "UTC", now)).toBe("stuck");
  });
  it("dernier run en échec", () => {
    expect(projectHealth(p, run({ status: "failed" }), run({}), "UTC", now)).toBe("failing");
    expect(projectHealth(p, run({ status: "interrupted" }), run({}), "UTC", now)).toBe("failing");
  });
  it("aucun succès depuis plus de 2 périodes", () => {
    const old = run({ finished_at: "2026-10-01T01:00:00Z" });
    expect(projectHealth(p, old, old, "UTC", now)).toBe("stale");
  });
  it("copie NAS en échec", () => {
    const r = run({ nas_status: "failed" });
    expect(projectHealth(p, r, r, "UTC", now)).toBe("nas_warning");
  });
  it("ok", () => {
    const r = run({});
    expect(projectHealth(p, r, r, "UTC", now)).toBe("ok");
  });
  it("cron sans prochaine exécution : jamais périmé", () => {
    const old = run({ finished_at: "2020-01-01T00:00:00Z" });
    expect(cronPeriodMs("0 0 30 2 *", "UTC", now)).toBe(Infinity);
    expect(projectHealth({ ...p, cron: "0 0 30 2 *" }, old, old, "UTC", now)).toBe("ok");
  });
});
