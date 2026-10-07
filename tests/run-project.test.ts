import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/config";
import type { DB } from "@/lib/db";
import { createEnvironment, upsertSecret } from "@/lib/repo/environments";
import { createProject, getProject, type ProjectInput } from "@/lib/repo/projects";
import { createRun, getRun, listRuns } from "@/lib/repo/runs";
import { setSetting } from "@/lib/repo/settings";
import { MASK } from "@/lib/runner/mask";
import { localBackupDir, NAS_MARKER, nasBackupDir } from "@/lib/runner/storage";
import { isProjectBusy, runProject, startProjectRun, type RunDeps } from "@/lib/runner/run-project";
import { testConfig, testDb } from "./helpers";

const input: ProjectInput = {
  name: "Pilote",
  environment_id: null,
  script: 'echo "dump" > "$OUTPUT_DIR/$PROJECT_NAME-$TIMESTAMP.dump"',
  cron: "0 3 * * *",
  retention_count: 14,
  nas_copy: true,
  timeout_minutes: 1,
  enabled: true,
};

function setup(overrides: Partial<ProjectInput> = {}, { nasReady = true } = {}) {
  const db: DB = testDb();
  const cfg: AppConfig = testConfig();
  if (nasReady) fs.writeFileSync(path.join(cfg.nasDir, NAS_MARKER), "");
  setSetting(db, "webhook_url", "https://hook");
  const send = vi.fn().mockResolvedValue(undefined);
  const deps: RunDeps = { db, cfg, send };
  const projectId = createProject(db, { ...input, ...overrides });
  return { db, cfg, deps, send, projectId };
}

describe("runProject", () => {
  it("succès : fichiers déplacés, copiés sur le NAS, dossier temporaire supprimé", async () => {
    const { db, cfg, deps, send, projectId } = setup();
    const runId = (await runProject(projectId, "manual", deps))!;
    const run = getRun(db, runId)!;
    expect(run).toMatchObject({ status: "success", exit_code: 0, nas_status: "ok" });
    expect(run.files).toHaveLength(1);
    expect(run.size_bytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(localBackupDir(cfg, "pilote", run), run.files[0]))).toBe(true);
    expect(fs.existsSync(path.join(nasBackupDir(cfg, "pilote", run), run.files[0]))).toBe(true);
    expect(fs.readdirSync(path.join(cfg.dataDir, "tmp"))).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("mesure la durée du script et celle de la copie NAS", async () => {
    const { db, deps, projectId } = setup({ script: 'sleep 0.2; echo x > "$OUTPUT_DIR/f"' });
    const run = getRun(db, (await runProject(projectId, "manual", deps))!)!;
    expect(run.script_ms).toBeGreaterThanOrEqual(200);
    expect(run.nas_ms).not.toBeNull();
    expect(run.nas_ms).toBeGreaterThanOrEqual(0);
  });

  it("sans copie NAS : nas_ms reste nul, script_ms mesuré même en cas d'échec", async () => {
    const { db, deps, projectId } = setup({ nas_copy: false });
    expect(getRun(db, (await runProject(projectId, "manual", deps))!)!.nas_ms).toBeNull();
    db.prepare("UPDATE projects SET script = 'exit 3' WHERE id = ?").run(projectId);
    const failed = getRun(db, (await runProject(projectId, "manual", deps))!)!;
    expect(failed.status).toBe("failed");
    expect(failed.script_ms).not.toBeNull();
  });

  it("échec du script : statut failed et notification", async () => {
    const { db, deps, send, projectId } = setup({ script: "echo avant; exit 7" });
    const run = getRun(db, (await runProject(projectId, "schedule", deps))!)!;
    expect(run).toMatchObject({ status: "failed", exit_code: 7 });
    expect(run.log).toContain("code 7");
    expect(send).toHaveBeenCalledWith("https://hook", expect.objectContaining({ project: "pilote", status: "failed" }));
  });

  it("aucun fichier produit = échec", async () => {
    const { db, deps, projectId } = setup({ script: "echo rien" });
    const run = getRun(db, (await runProject(projectId, "manual", deps))!)!;
    expect(run.status).toBe("failed");
    expect(run.log).toContain("Aucun fichier");
  });

  it("NAS sans fichier témoin : backup réussi mais copie en échec, notifiée (Review Focus 1)", async () => {
    const { db, cfg, deps, send, projectId } = setup({}, { nasReady: false });
    const run = getRun(db, (await runProject(projectId, "manual", deps))!)!;
    expect(run).toMatchObject({ status: "success", nas_status: "failed" });
    expect(run.nas_error).toContain(NAS_MARKER);
    expect(fs.readdirSync(cfg.nasDir)).toEqual([]);
    expect(send).toHaveBeenCalledWith("https://hook", expect.objectContaining({ status: "nas_failed" }));
  });

  it("nas_copy désactivé : nas_status n/a", async () => {
    const { db, deps, projectId } = setup({ nas_copy: false });
    const run = getRun(db, (await runProject(projectId, "manual", deps))!)!;
    expect(run.nas_status).toBe("n/a");
  });

  it("ignore un déclenchement si un run est déjà en cours", async () => {
    const { db, deps, projectId } = setup();
    createRun(db, { projectId, trigger: "manual", stamp: "s" });
    const run = getRun(db, (await runProject(projectId, "schedule", deps))!)!;
    expect(run.status).toBe("skipped");
  });

  it("verrou en mémoire : deux lancements simultanés → un seul s'exécute", async () => {
    const { db, deps, projectId } = setup({ script: 'sleep 0.3; echo x > "$OUTPUT_DIR/f"' });
    const a = startProjectRun(projectId, "manual", deps)!;
    const b = startProjectRun(projectId, "manual", deps)!;
    await Promise.all([a.done, b.done]);
    expect(getRun(db, a.runId)!.status).toBe("success");
    expect(getRun(db, b.runId)!.status).toBe("skipped");
  });

  it("deux runs dans la même seconde n'écrasent pas le même dossier", async () => {
    const fixed = new Date("2026-10-04T01:00:00Z");
    const { db, cfg, deps, projectId } = setup({ nas_copy: false });
    const d = { ...deps, now: () => fixed };
    const r1 = getRun(db, (await runProject(projectId, "manual", d))!)!;
    const r2 = getRun(db, (await runProject(projectId, "manual", d))!)!;
    expect(localBackupDir(cfg, "pilote", r1)).not.toBe(localBackupDir(cfg, "pilote", r2));
    expect(fs.existsSync(localBackupDir(cfg, "pilote", r1))).toBe(true);
  });

  it("masque les secrets dans le log enregistré", async () => {
    const { db, deps } = setup();
    const envId = createEnvironment(db, { name: "e", description: "" });
    upsertSecret(db, envId, "TOKEN", "tres-secret-123");
    const pid = createProject(db, { ...input, name: "masque", environment_id: envId, script: 'echo "$TOKEN"; echo x > "$OUTPUT_DIR/f"' });
    const run = getRun(db, (await runProject(pid, "manual", deps))!)!;
    expect(run.log).toContain(MASK);
    expect(run.log).not.toContain("tres-secret-123");
  });

  it("rétention : garde les N derniers succès en local et sur le NAS", async () => {
    const { db, cfg, deps, projectId } = setup({ retention_count: 2 });
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push((await runProject(projectId, "manual", deps))!);
    const [oldest, ...kept] = ids.map((id) => getRun(db, id)!);
    expect(oldest.pruned).toBe(true);
    expect(fs.existsSync(localBackupDir(cfg, "pilote", oldest))).toBe(false);
    expect(fs.existsSync(nasBackupDir(cfg, "pilote", oldest))).toBe(false);
    for (const r of kept) {
      expect(r.pruned).toBe(false);
      expect(fs.existsSync(localBackupDir(cfg, "pilote", r))).toBe(true);
    }
  });

  it("rétention : NAS indisponible, le run n'est pas marqué pruned et sa copie NAS est purgée plus tard", async () => {
    const { db, cfg, deps, projectId } = setup({ retention_count: 2 });
    const marker = path.join(cfg.nasDir, NAS_MARKER);
    const ids: number[] = [];
    for (let i = 0; i < 2; i++) ids.push((await runProject(projectId, "manual", deps))!);
    fs.rmSync(marker);
    ids.push((await runProject(projectId, "manual", deps))!);
    const [first, second] = ids.map((id) => getRun(db, id)!);
    expect(first.pruned).toBe(false);
    expect(fs.existsSync(localBackupDir(cfg, "pilote", first))).toBe(false);
    expect(fs.existsSync(nasBackupDir(cfg, "pilote", first))).toBe(true);
    fs.writeFileSync(marker, "");
    await runProject(projectId, "manual", deps);
    for (const r of [getRun(db, first.id)!, getRun(db, second.id)!]) {
      expect(r.pruned).toBe(true);
      expect(fs.existsSync(nasBackupDir(cfg, "pilote", r))).toBe(false);
    }
  });

  it("un échec ne déclenche pas la rétention", async () => {
    const { db, deps, projectId } = setup({ retention_count: 1 });
    const ok = (await runProject(projectId, "manual", deps))!;
    db.prepare("UPDATE projects SET script = 'exit 1' WHERE id = ?").run(projectId);
    await runProject(projectId, "manual", deps);
    expect(getRun(db, ok)!.pruned).toBe(false);
    expect(listRuns(db, projectId)).toHaveLength(2);
  });

  it("processus d'arrière-plan encore actif à la fin du script : succès, fichier conservé", async () => {
    const { db, cfg, deps, projectId } = setup({ script: 'sleep 30 & echo fini > "$OUTPUT_DIR/f"', nas_copy: false });
    const start = Date.now();
    const run = getRun(db, (await runProject(projectId, "manual", { ...deps, exitGraceMs: 300 }))!)!;
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(run.status).toBe("success");
    expect(run.files).toEqual(["f"]);
    expect(fs.readFileSync(path.join(localBackupDir(cfg, "pilote", run), "f"), "utf8")).toBe("fini\n");
  }, 15_000);

  it("projet inexistant : null", async () => {
    const { deps } = setup();
    expect(await runProject(9999, "manual", deps)).toBeNull();
    expect(getProject(deps.db, 9999)).toBeUndefined();
  });
});

describe("isProjectBusy", () => {
  it("vrai pendant une exécution, faux ensuite", async () => {
    const { db, deps, projectId } = setup({ script: "sleep 0.3" });
    expect(isProjectBusy(db, projectId)).toBe(false);
    const started = startProjectRun(projectId, "manual", deps)!;
    expect(isProjectBusy(db, projectId)).toBe(true);
    await started.done;
    expect(isProjectBusy(db, projectId)).toBe(false);
  });
});
