import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { describe, expect, it } from "vitest";
import { DatabaseKeyError, openDb } from "@/lib/db";
import { MIGRATIONS } from "@/lib/db/migrations";
import { TEST_KEY, tmpDir } from "./helpers";

describe("openDb", () => {
  it("crée le schéma et positionne user_version", () => {
    const file = path.join(tmpDir(), "a.db");
    const db = openDb(file, TEST_KEY);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["user", "sessions", "login_attempts", "projects", "runs", "audit_log", "settings"]),
    );
    db.close();
  });

  it("migration 6 : chaque projet reprend l'URL de son environnement, les runs sont gardés, les environnements supprimés", () => {
    const file = path.join(tmpDir(), "app.db");
    const db = new Database(file);
    db.pragma("cipher='sqlcipher'");
    db.pragma("legacy=4");
    db.pragma(`key='${TEST_KEY}'`);
    for (const m of MIGRATIONS.slice(0, 5)) db.exec(m);
    db.pragma("user_version = 5");
    db.pragma("foreign_keys = ON");
    db.exec(`
      INSERT INTO environments (id, name, created_at, updated_at) VALUES (1, 'pg', '', ''), (2, 'mongo', '', ''), (3, 'vide', '', '');
      INSERT INTO secrets (environment_id, key, value, updated_at) VALUES
        (1, 'DATABASE_URL', 'postgresql://u:p@db.example.com/app', ''),
        (1, 'AUTRE', 'x', ''),
        (2, 'MONGO_URI', 'mongodb+srv://u:p@cluster.example.net/app', '');
      INSERT INTO projects (id, name, slug, environment_id, network_secret, script, cron, created_at, updated_at) VALUES
        (1, 'Pg', 'pg', 1, 'DATABASE_URL', 'pg_dump "$DATABASE_URL"', '0 3 * * *', 'c', 'u'),
        (2, 'Mongo', 'mongo', 2, 'MONGO_URI', 'mongodump --uri="$MONGO_URI"', '0 4 * * *', 'c', 'u'),
        (3, 'Sans URL', 'sans-url', 3, NULL, 'tar czf x /etc', '0 5 * * *', 'c', 'u');
      INSERT INTO runs (project_id, trigger, status, stamp, started_at) VALUES (1, 'manual', 'success', 's', 'a'), (2, 'manual', 'success', 's', 'a');
    `);
    db.close();

    const migrated = openDb(file, TEST_KEY);
    expect(migrated.prepare("SELECT id, slug, db_kind, db_url, cron, enabled FROM projects ORDER BY id").all()).toEqual([
      { id: 1, slug: "pg", db_kind: "postgres", db_url: "postgresql://u:p@db.example.com/app", cron: "0 3 * * *", enabled: 1 },
      { id: 2, slug: "mongo", db_kind: "mongodb", db_url: "mongodb+srv://u:p@cluster.example.net/app", cron: "0 4 * * *", enabled: 1 },
      { id: 3, slug: "sans-url", db_kind: "postgres", db_url: null, cron: "0 5 * * *", enabled: 0 },
    ]);
    expect(migrated.prepare("SELECT project_id FROM runs ORDER BY id").all()).toEqual([{ project_id: 1 }, { project_id: 2 }]);
    const tables = (migrated.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).not.toContain("environments");
    expect(tables).not.toContain("secrets");
    expect(migrated.pragma("foreign_keys", { simple: true })).toBe(1);
    // Les runs suivent toujours leur projet.
    migrated.prepare("DELETE FROM projects WHERE id = 1").run();
    expect(migrated.prepare("SELECT count(*) AS n FROM runs").get()).toEqual({ n: 1 });
  });

  it("migration 7 : le type mysql est accepté, projets et runs sont gardés", () => {
    const file = path.join(tmpDir(), "app7.db");
    const db = new Database(file);
    db.pragma("cipher='sqlcipher'");
    db.pragma("legacy=4");
    db.pragma(`key='${TEST_KEY}'`);
    db.pragma("foreign_keys = OFF");
    for (const m of MIGRATIONS.slice(0, 6)) db.exec(m);
    db.pragma("user_version = 6");
    db.pragma("foreign_keys = ON");
    db.exec(`
      INSERT INTO projects (id, name, slug, db_kind, db_url, cron, created_at, updated_at) VALUES
        (1, 'Pg', 'pg', 'postgres', 'postgresql://u:p@db.example.com/app', '0 3 * * *', 'c', 'u');
      INSERT INTO runs (project_id, trigger, status, stamp, started_at) VALUES (1, 'manual', 'success', 's', 'a');
    `);
    expect(() => db.exec("UPDATE projects SET db_kind = 'mysql'")).toThrow(/CHECK/);
    db.close();

    const migrated = openDb(file, TEST_KEY);
    expect(migrated.prepare("SELECT id, slug, db_kind, db_url FROM projects").all()).toEqual([
      { id: 1, slug: "pg", db_kind: "postgres", db_url: "postgresql://u:p@db.example.com/app" },
    ]);
    migrated.prepare("UPDATE projects SET db_kind = 'mysql' WHERE id = 1").run();
    expect(() => migrated.prepare("UPDATE projects SET db_kind = 'oracle'").run()).toThrow(/CHECK/);
    migrated.prepare("DELETE FROM projects WHERE id = 1").run();
    expect(migrated.prepare("SELECT count(*) AS n FROM runs").get()).toEqual({ n: 0 });
  });

  it("refuse une mauvaise clé", () => {
    const file = path.join(tmpDir(), "b.db");
    openDb(file, TEST_KEY).close();
    expect(() => openDb(file, "z".repeat(32))).toThrow(DatabaseKeyError);
  });

  it("le fichier est illisible sans la clé", () => {
    const file = path.join(tmpDir(), "c.db");
    const db = openDb(file, TEST_KEY);
    db.prepare("INSERT INTO settings (key, value) VALUES ('x', 'SUPERSECRETVALUE')").run();
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    const raw = fs.readFileSync(file);
    expect(raw.subarray(0, 15).toString()).not.toBe("SQLite format 3");
    expect(raw.includes(Buffer.from("SUPERSECRETVALUE"))).toBe(false);
  });

  it("rouvrir une base existante ne rejoue pas les migrations", () => {
    const file = path.join(tmpDir(), "d.db");
    openDb(file, TEST_KEY).close();
    const db = openDb(file, TEST_KEY);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    db.close();
  });
});
