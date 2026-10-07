import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { loadConfig } from "@/lib/config";
import { MIGRATIONS } from "./migrations";

export type DB = Database.Database;

export class DatabaseKeyError extends Error {}

export function nowIso(): string {
  return new Date().toISOString();
}

export function openDb(file: string, key: string): DB {
  const db = new Database(file);
  db.pragma("cipher='sqlcipher'");
  db.pragma("legacy=4");
  db.pragma(`key='${key.replace(/'/g, "''")}'`);
  try {
    db.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch {
    db.close();
    throw new DatabaseKeyError(
      "Impossible d'ouvrir la base : clé de chiffrement incorrecte ou fichier corrompu",
    );
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

const g = globalThis as unknown as { __bmDb?: DB };

export function getDb(): DB {
  if (!g.__bmDb) {
    const cfg = loadConfig();
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    g.__bmDb = openDb(path.join(cfg.dataDir, "app.db"), cfg.dbKey);
  }
  return g.__bmDb;
}

