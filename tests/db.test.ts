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
      expect.arrayContaining(["user", "sessions", "login_attempts", "environments", "secrets", "projects", "runs", "audit_log", "settings"]),
    );
    db.close();
  });

  it("migration 5 : les projets existants gardent l'accès à la base que leur script utilise", () => {
    const file = path.join(tmpDir(), "app.db");
    const db = new Database(file);
    db.pragma("cipher='sqlcipher'");
    db.pragma("legacy=4");
    db.pragma(`key='${TEST_KEY}'`);
    for (const m of MIGRATIONS.slice(0, 4)) db.exec(m);
    db.pragma("user_version = 4");
    const insert = db.prepare(
      "INSERT INTO projects (name, slug, script, cron, created_at, updated_at) VALUES (?, ?, ?, '0 3 * * *', '', '')",
    );
    insert.run("pg", "pg", 'pg_dump "$DATABASE_URL" -f x');
    insert.run("mongo", "mongo", 'mongodump --uri="$MONGO_URI"');
    insert.run("autre", "autre", "tar czf x /etc");
    db.close();
    const migrated = openDb(file, TEST_KEY);
    const rows = migrated.prepare("SELECT slug, network_secret FROM projects ORDER BY id").all();
    expect(rows).toEqual([
      { slug: "pg", network_secret: "DATABASE_URL" },
      { slug: "mongo", network_secret: "MONGO_URI" },
      { slug: "autre", network_secret: null },
    ]);
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
