import { describe, expect, it } from "vitest";
import { dbUrlLabel } from "@/lib/db-url";
import { DB_KINDS } from "@/lib/dumps";
import { createProject, getProject, getProjectDbUrl, listProjects, updateProject, type ProjectInput } from "@/lib/repo/projects";
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
import { ValidationError } from "@/lib/validation";
import { testDb } from "./helpers";

export const baseInput: ProjectInput = {
  name: "Pilote",
  db_kind: "postgres",
  db_url: "postgresql://lecteur:mot-de-passe@db.example.com:5432/app",
  cron: "0 3 * * *",
  retention_count: 14,
  nas_copy: true,
  timeout_minutes: 60,
  enabled: true,
};

describe("projets", () => {
  it("crée un projet avec un slug et des booléens, sans charger l'URL avec lui", () => {
    const db = testDb();
    const id = createProject(db, baseInput);
    const project = getProject(db, id)!;
    expect(project).toMatchObject({ slug: "pilote", db_kind: "postgres", has_db_url: true, nas_copy: true, enabled: true });
    expect(JSON.stringify(project)).not.toContain("mot-de-passe");
    expect(JSON.stringify(listProjects(db))).not.toContain("mot-de-passe");
    expect(getProjectDbUrl(db, id)).toBe(baseInput.db_url);
  });

  it("refuse cron invalide, rétention nulle, timeout hors bornes, nom en double", () => {
    const db = testDb();
    createProject(db, baseInput);
    expect(() => createProject(db, { ...baseInput, name: "x", cron: "nope" })).toThrow(ValidationError);
    expect(() => createProject(db, { ...baseInput, name: "x", cron: "0 0 31 2 *" })).toThrow(ValidationError);
    expect(() => createProject(db, { ...baseInput, name: "x", retention_count: 0 })).toThrow(ValidationError);
    expect(() => createProject(db, { ...baseInput, name: "x", timeout_minutes: 0 })).toThrow(ValidationError);
    expect(() => createProject(db, baseInput)).toThrow(/existe déjà/);
  });

  it("valide l'URL selon le type de base, sans jamais la citer dans l'erreur", () => {
    const db = testDb();
    const attempts: Array<[Partial<ProjectInput>, RegExp]> = [
      [{ db_url: null }, /URL de connexion requise/],
      [{ db_url: "mongodb://u:secret-1@h.example.com/app" }, /URL PostgreSQL attendue/],
      [{ db_kind: "mongodb" }, /URL MongoDB attendue/],
      [{ db_url: "postgresql://u:secret-1@/app?host=/var/run" }, /URL de connexion/],
      [{ db_kind: "oracle" as never }, /Type de base inconnu/],
      [{ db_kind: "mysql" }, /URL MySQL \/ MariaDB attendue/],
      [{ db_kind: "mysql", db_url: "mysql://u:secret-1@a.example.com,b.example.com/app" }, /un seul hôte/],
      [{ db_kind: "mysql", db_url: "mysql://u:secret-1@db.example.com/%2D%2Dplugin-dir=%2Ftmp" }, /nom de base invalide/],
      [{ db_kind: "mysql", db_url: "mysql://u:secret-1@db.example.com/-x" }, /nom de base invalide/],
      [{ db_kind: "mysql", db_url: "mysql://u:secret-1@db.example.com/app?ssl-mode=PREFERRED" }, /ssl-mode doit valoir/],
      [{ db_kind: "mysql", db_url: "mysql://u:secret-1@db.example.com/app?ssl-mode=REQUIRED&ssl-mode=DISABLED" }, /ssl-mode doit valoir/],
      [{ db_url: "postgresql://u:5432/secret-1@db.example.com/app" }, /encodez les caractères spéciaux/],
    ];
    for (const [patch, message] of attempts) {
      let error: unknown;
      try {
        createProject(db, { ...baseInput, name: "x", ...patch });
      } catch (e) {
        error = e;
      }
      expect(error, String(message)).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toMatch(message);
      expect((error as Error).message).not.toContain("secret-1");
    }
    expect(createProject(db, { ...baseInput, name: "m", db_kind: "mongodb", db_url: "mongodb+srv://u:p@cluster.example.net/app" })).toBeGreaterThan(0);
    expect(createProject(db, { ...baseInput, name: "my", db_kind: "mysql", db_url: "mysql://u:p@db.example.com/app" })).toBeGreaterThan(0);
    expect(createProject(db, { ...baseInput, name: "maria", db_kind: "mysql", db_url: "mariadb://u:p@db.example.com:3307/app" })).toBeGreaterThan(0);
  });

  it("modification : URL vide = inchangée ; changer de type exige une URL adaptée", () => {
    const db = testDb();
    const id = createProject(db, baseInput);
    updateProject(db, id, { ...baseInput, name: "Autre nom", db_url: null });
    expect(getProject(db, id)).toMatchObject({ name: "Autre nom", slug: "pilote" });
    expect(getProjectDbUrl(db, id)).toBe(baseInput.db_url);
    expect(() => updateProject(db, id, { ...baseInput, db_kind: "mongodb", db_url: null })).toThrow(/URL MongoDB attendue/);
    updateProject(db, id, { ...baseInput, db_kind: "mongodb", db_url: " mongodb://u:p@m.example.com/app " });
    expect(getProject(db, id)?.db_kind).toBe("mongodb");
    expect(getProjectDbUrl(db, id)).toBe("mongodb://u:p@m.example.com/app");
  });
});

describe("dumps", () => {
  it("chaque type a son script fixe, qui lit l'URL dans DATABASE_URL", () => {
    expect(DB_KINDS.postgres.script).toContain('pg_dump "$DATABASE_URL" -F c');
    expect(DB_KINDS.postgres.script).toContain("pg_restore -l");
    expect(DB_KINDS.mongodb.script).toContain('mongodump --uri="$DATABASE_URL"');
    expect(DB_KINDS.mysql.script).toContain('rest="${DATABASE_URL#*://}"');
    expect(DB_KINDS.mysql.script).toContain('mariadb-dump "${opts[@]}" | gzip');
    // Le mot de passe ne passe jamais en argument (visible dans ps).
    expect(DB_KINDS.mysql.script).not.toMatch(/--password|-p"/);
  });

  it("libellé affichable : ni identifiants ni paramètres", () => {
    expect(dbUrlLabel("postgresql://u:p%40ss@db.example.com:5432/app?sslmode=require&password=x")).toBe("postgresql://db.example.com:5432/app");
    expect(dbUrlLabel("mongodb+srv://u:p@ss@cluster.example.net/app")).toBe("mongodb+srv://cluster.example.net/app");
    expect(dbUrlLabel("postgresql://u:pa/ss@db.example.com/app")).toBe("URL invalide");
    // Mot de passe « 5432/x » non encodé : « u:5432 » ressemble à un hôte valide, rien ne doit en sortir.
    expect(dbUrlLabel("postgresql://u:5432/x@db.example.com/app")).toBe("URL invalide");
    expect(dbUrlLabel("mongodb+srv://u:p@cluster.example.net")).toBe("mongodb+srv://cluster.example.net");
    expect(dbUrlLabel("n'importe quoi")).toBe("URL invalide");
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
