import { describe, expect, it } from "vitest";
import { createProject, getProject, listProjects, updateProject, type ProjectInput } from "@/lib/repo/projects";
import {
  createRun,
  finishRun,
  getRun,
  hasRunningRun,
  lastRun,
  lastSuccessfulRun,
  listRuns,
  listUnprunedSuccesses,
  markRunningAsInterrupted,
} from "@/lib/repo/runs";
import { TEMPLATES } from "@/lib/templates";
import { ValidationError } from "@/lib/validation";
import { testDb } from "./helpers";

export const baseInput: ProjectInput = {
  name: "Pilote",
  environment_id: null,
  script: "echo ok",
  cron: "0 3 * * *",
  retention_count: 14,
  nas_copy: true,
  timeout_minutes: 60,
  enabled: true,
};

describe("projets", () => {
  it("crée un projet avec un slug et des booléens", () => {
    const db = testDb();
    const id = createProject(db, baseInput);
    expect(getProject(db, id)).toMatchObject({ slug: "pilote", nas_copy: true, enabled: true });
    expect(listProjects(db)).toHaveLength(1);
  });

  it("refuse cron invalide, rétention nulle, timeout hors bornes, script vide, nom en double", () => {
    const db = testDb();
    createProject(db, baseInput);
    expect(() => createProject(db, { ...baseInput, name: "x", cron: "nope" })).toThrow(ValidationError);
    expect(() => createProject(db, { ...baseInput, name: "x", cron: "0 0 31 2 *" })).toThrow(ValidationError);
    expect(() => createProject(db, { ...baseInput, name: "x", retention_count: 0 })).toThrow(ValidationError);
    expect(() => createProject(db, { ...baseInput, name: "x", timeout_minutes: 0 })).toThrow(ValidationError);
    expect(() => createProject(db, { ...baseInput, name: "x", script: "  " })).toThrow(ValidationError);
    expect(() => createProject(db, baseInput)).toThrow(/existe déjà/);
  });

  it("normalise les fins de ligne CRLF du script (Review Focus 3)", () => {
    const db = testDb();
    const id = createProject(db, { ...baseInput, script: "echo a\r\necho b\r\n" });
    expect(getProject(db, id)!.script).toBe("echo a\necho b\n");
    updateProject(db, id, { ...baseInput, script: "echo c\r\n" });
    expect(getProject(db, id)!.script).toBe("echo c\n");
  });

  it("garde le slug quand on renomme", () => {
    const db = testDb();
    const id = createProject(db, baseInput);
    updateProject(db, id, { ...baseInput, name: "Autre nom" });
    expect(getProject(db, id)).toMatchObject({ name: "Autre nom", slug: "pilote" });
  });

  it("le modèle Postgres reprend la vérification pg_restore", () => {
    expect(TEMPLATES.postgres.script).toContain('pg_dump "$DATABASE_URL" -F c');
    expect(TEMPLATES.postgres.script).toContain("pg_restore -l");
  });
});

describe("runs", () => {
  it("cycle de vie d'un run", () => {
    const db = testDb();
    const pid = createProject(db, baseInput);
    const rid = createRun(db, { projectId: pid, trigger: "manual", stamp: "2026-10-04_03-00-00" });
    expect(hasRunningRun(db, pid)).toBe(true);
    finishRun(db, rid, { status: "success", log: "ok", exit_code: 0, size_bytes: 10, files: ["a.dump"], nas_status: "ok" });
    const run = getRun(db, rid)!;
    expect(run).toMatchObject({ status: "success", files: ["a.dump"], nas_status: "ok", pruned: false });
    expect(run.finished_at).not.toBeNull();
    expect(hasRunningRun(db, pid)).toBe(false);
    expect(listUnprunedSuccesses(db, pid).map((r) => r.id)).toEqual([rid]);
  });

  it("lastRun ignore les runs skipped", () => {
    const db = testDb();
    const pid = createProject(db, baseInput);
    const a = createRun(db, { projectId: pid, trigger: "manual", stamp: "s" });
    finishRun(db, a, { status: "failed", log: "" });
    const b = createRun(db, { projectId: pid, trigger: "schedule", stamp: "s", status: "skipped" });
    finishRun(db, b, { status: "skipped", log: "" });
    expect(lastRun(db, pid)!.id).toBe(a);
  });

  it("listes et derniers runs sans journal, getRun avec", () => {
    const db = testDb();
    const pid = createProject(db, baseInput);
    const rid = createRun(db, { projectId: pid, trigger: "manual", stamp: "s" });
    finishRun(db, rid, { status: "success", log: "journal complet\n", files: ["a.dump"] });
    for (const r of [listRuns(db, pid)[0], lastRun(db, pid)!, lastSuccessfulRun(db, pid)!]) {
      expect(r).toMatchObject({ id: rid, status: "success", files: ["a.dump"], log: "" });
    }
    expect(getRun(db, rid)!.log).toBe("journal complet\n");
  });

  it("passe les runs en cours à interrupted au redémarrage (Review Focus 4)", () => {
    const db = testDb();
    const pid = createProject(db, baseInput);
    const rid = createRun(db, { projectId: pid, trigger: "schedule", stamp: "s" });
    const affected = markRunningAsInterrupted(db);
    expect(affected.map((r) => r.id)).toEqual([rid]);
    expect(getRun(db, rid)).toMatchObject({ status: "interrupted" });
    expect(getRun(db, rid)!.log).toContain("redémarrage");
    expect(hasRunningRun(db, pid)).toBe(false);
  });
});
