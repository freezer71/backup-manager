import { describe, expect, it } from "vitest";
import type { DB } from "@/lib/db";
import { createProject, type ProjectInput } from "@/lib/repo/projects";
import { createRun, finishRun, markPruned } from "@/lib/repo/runs";
import { diskUsage, durationStats, listRecentBackups, reliabilityStats, storageByProject } from "@/lib/stats";
import { testDb, tmpDir } from "./helpers";

const base: ProjectInput = {
  name: "Pilote",
  environment_id: null,
  script: "echo",
  cron: "0 3 * * *",
  retention_count: 14,
  nas_copy: true,
  timeout_minutes: 60,
  enabled: true,
};

// Crée un run terminé avec des dates maîtrisées (started_at/finished_at réécrits après finishRun).
function addRun(
  db: DB,
  projectId: number,
  o: { status?: "success" | "failed" | "timeout" | "skipped"; size?: number; startedAt: string; durationMs: number; scriptMs?: number; nasMs?: number; nas?: "ok" | "failed" | "n/a"; files?: string[] },
): number {
  const id = createRun(db, { projectId, trigger: "schedule", stamp: "s" });
  const status = o.status ?? "success";
  finishRun(db, id, {
    status,
    log: "journal",
    size_bytes: status === "success" ? (o.size ?? 100) : null,
    files: status === "success" ? (o.files ?? ["f.dump"]) : [],
    nas_status: o.nas ?? (status === "success" ? "ok" : "n/a"),
    script_ms: o.scriptMs ?? null,
    nas_ms: o.nasMs ?? null,
  });
  const finished = new Date(new Date(o.startedAt).getTime() + o.durationMs).toISOString();
  db.prepare("UPDATE runs SET started_at = ?, finished_at = ? WHERE id = ?").run(o.startedAt, finished, id);
  return id;
}

function twoProjects() {
  const db = testDb();
  const a = createProject(db, base);
  const b = createProject(db, { ...base, name: "Plume" });
  return { db, a, b };
}

describe("listRecentBackups", () => {
  it("liste les succès non supprimés de tous les projets, du plus récent au plus ancien, sans le journal", () => {
    const { db, a, b } = twoProjects();
    const r1 = addRun(db, a, { startedAt: "2026-10-01T01:00:00Z", durationMs: 1000 });
    const r2 = addRun(db, b, { startedAt: "2026-10-02T01:00:00Z", durationMs: 1000, files: ["x.dump", "y.sql"] });
    addRun(db, a, { status: "failed", startedAt: "2026-10-03T01:00:00Z", durationMs: 1000 });
    const pruned = addRun(db, a, { startedAt: "2026-09-01T01:00:00Z", durationMs: 1000 });
    markPruned(db, pruned);

    const list = listRecentBackups(db);
    expect(list.map((r) => r.runId)).toEqual([r2, r1]);
    expect(list[0]).toMatchObject({ projectId: b, projectName: "Plume", files: ["x.dump", "y.sql"], nasStatus: "ok", sizeBytes: 100 });
    expect(list[0]).not.toHaveProperty("log");
  });

  it("filtre par projet et respecte la limite", () => {
    const { db, a, b } = twoProjects();
    for (let i = 0; i < 5; i++) addRun(db, a, { startedAt: `2026-10-0${i + 1}T01:00:00Z`, durationMs: 1000 });
    addRun(db, b, { startedAt: "2026-10-09T01:00:00Z", durationMs: 1000 });
    expect(listRecentBackups(db, { projectId: a }).every((r) => r.projectId === a)).toBe(true);
    expect(listRecentBackups(db, { projectId: a, limit: 2 })).toHaveLength(2);
  });
});

describe("storageByProject", () => {
  it("additionne les backups conservés par projet et calcule les pourcentages", () => {
    const { db, a, b } = twoProjects();
    addRun(db, a, { size: 300, startedAt: "2026-10-01T01:00:00Z", durationMs: 1 });
    addRun(db, a, { size: 300, startedAt: "2026-10-02T01:00:00Z", durationMs: 1 });
    addRun(db, b, { size: 400, startedAt: "2026-10-02T01:00:00Z", durationMs: 1 });
    const pruned = addRun(db, b, { size: 9999, startedAt: "2026-09-01T01:00:00Z", durationMs: 1 });
    markPruned(db, pruned);

    const s = storageByProject(db);
    expect(s.totalBytes).toBe(1000);
    expect(s.projects).toEqual([
      expect.objectContaining({ projectId: a, name: "Pilote", bytes: 600, count: 2, percent: 60 }),
      expect.objectContaining({ projectId: b, name: "Plume", bytes: 400, count: 1, percent: 40 }),
    ]);
  });

  it("aucun backup : total nul et pourcentages à 0", () => {
    const { db } = twoProjects();
    const s = storageByProject(db);
    expect(s.totalBytes).toBe(0);
    expect(s.projects.every((p) => p.percent === 0 && p.bytes === 0)).toBe(true);
  });
});

describe("durationStats", () => {
  it("donne dernier, moyenne et maximum des succès, et la série chronologique des N derniers", () => {
    const { db, a } = twoProjects();
    addRun(db, a, { startedAt: "2026-10-01T01:00:00Z", durationMs: 2000, scriptMs: 1500, nasMs: 400 });
    addRun(db, a, { startedAt: "2026-10-02T01:00:00Z", durationMs: 4000, scriptMs: 3000, nasMs: 800 });
    addRun(db, a, { status: "failed", startedAt: "2026-10-03T01:00:00Z", durationMs: 99_000 });
    addRun(db, a, { startedAt: "2026-10-04T01:00:00Z", durationMs: 6000 });

    const d = durationStats(db, a, 30);
    expect(d.series.map((p) => p.totalMs)).toEqual([2000, 4000, 6000]);
    expect(d.total).toEqual({ last: 6000, avg: 4000, max: 6000 });
    expect(d.script).toEqual({ last: 3000, avg: 2250, max: 3000 });
    expect(d.nas).toEqual({ last: 800, avg: 600, max: 800 });
  });

  it("sans mesure : valeurs nulles", () => {
    const { db, a } = twoProjects();
    const d = durationStats(db, a, 30);
    expect(d.series).toEqual([]);
    expect(d.total).toEqual({ last: null, avg: null, max: null });
  });

  it("la série est limitée aux N derniers", () => {
    const { db, a } = twoProjects();
    for (let i = 1; i <= 5; i++) addRun(db, a, { startedAt: `2026-10-0${i}T01:00:00Z`, durationMs: i * 1000 });
    expect(durationStats(db, a, 3).series.map((p) => p.totalMs)).toEqual([3000, 4000, 5000]);
  });
});

describe("reliabilityStats", () => {
  it("compte succès, échecs et échecs NAS depuis une date, ignore les runs ignorés et anciens", () => {
    const { db, a, b } = twoProjects();
    addRun(db, a, { startedAt: "2026-10-01T01:00:00Z", durationMs: 1 });
    addRun(db, a, { startedAt: "2026-10-02T01:00:00Z", durationMs: 1, nas: "failed" });
    addRun(db, a, { status: "failed", startedAt: "2026-10-03T01:00:00Z", durationMs: 1 });
    addRun(db, a, { status: "timeout", startedAt: "2026-10-03T02:00:00Z", durationMs: 1 });
    addRun(db, a, { status: "skipped", startedAt: "2026-10-03T03:00:00Z", durationMs: 1 });
    addRun(db, a, { startedAt: "2026-08-01T01:00:00Z", durationMs: 1 });

    const r = reliabilityStats(db, "2026-09-05T00:00:00Z");
    const pa = r.projects.find((p) => p.projectId === a)!;
    expect(pa).toMatchObject({ total: 4, success: 2, failed: 2, nasFailed: 1, successRate: 50 });
    const pb = r.projects.find((p) => p.projectId === b)!;
    expect(pb).toMatchObject({ total: 0, successRate: null });
    expect(r.recentFailures.map((f) => f.status)).toEqual(["timeout", "failed"]);
  });
});

describe("diskUsage", () => {
  it("renvoie total, libre et utilisé pour un dossier existant, null sinon", async () => {
    const u = await diskUsage(tmpDir());
    expect(u).not.toBeNull();
    expect(u!.totalBytes).toBeGreaterThan(0);
    expect(u!.usedBytes + u!.freeBytes).toBeLessThanOrEqual(u!.totalBytes);
    expect(await diskUsage("/chemin/qui/n/existe/pas")).toBeNull();
  });
});
