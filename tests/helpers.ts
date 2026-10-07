import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "@/lib/config";
import { openDb, type DB } from "@/lib/db";

export const TEST_KEY = "k".repeat(32);

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bm-"));
}

export function testDb(): DB {
  return openDb(path.join(tmpDir(), "app.db"), TEST_KEY);
}

export function testConfig(): AppConfig {
  const root = tmpDir();
  const nasDir = path.join(root, "nas");
  fs.mkdirSync(nasDir);
  return {
    dataDir: path.join(root, "data"),
    nasDir,
    dbKey: TEST_KEY,
    adminEmail: null,
    adminPassword: null,
    appUrl: "http://test",
    tz: "Europe/Paris",
  };
}
