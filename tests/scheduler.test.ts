import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, updateProject, type ProjectInput } from "@/lib/repo/projects";
import { refreshProjectSchedule, scheduledProjectIds, startScheduler, stopScheduler } from "@/lib/scheduler";
import { testConfig, testDb } from "./helpers";

const input: ProjectInput = {
  name: "a",
  environment_id: null,
  script: "echo",
  cron: "0 3 * * *",
  retention_count: 1,
  nas_copy: false,
  timeout_minutes: 1,
  enabled: true,
};

afterEach(() => stopScheduler());

describe("scheduler", () => {
  it("planifie uniquement les projets actifs et suit les modifications", () => {
    const db = testDb();
    const a = createProject(db, input);
    const b = createProject(db, { ...input, name: "b", enabled: false });
    startScheduler({ db, cfg: testConfig() });
    expect(scheduledProjectIds()).toEqual([a]);

    updateProject(db, b, { ...input, name: "b", enabled: true });
    refreshProjectSchedule(b);
    expect(scheduledProjectIds().sort()).toEqual([a, b].sort());

    updateProject(db, a, { ...input, enabled: false });
    refreshProjectSchedule(a);
    expect(scheduledProjectIds()).toEqual([b]);

    db.prepare("DELETE FROM projects WHERE id = ?").run(b);
    refreshProjectSchedule(b);
    expect(scheduledProjectIds()).toEqual([]);
  });

  it("un cron invalide n'empêche pas de planifier les autres projets", () => {
    const db = testDb();
    const good = createProject(db, input);
    const bad = createProject(db, { ...input, name: "bad" });
    db.prepare("UPDATE projects SET cron = 'invalide' WHERE id = ?").run(bad);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => startScheduler({ db, cfg: testConfig() })).not.toThrow();
    expect(scheduledProjectIds()).toEqual([good]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
