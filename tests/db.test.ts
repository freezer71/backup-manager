import fs from "node:fs";
import path from "node:path";
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
