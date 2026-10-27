import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbKind } from "@/lib/dumps";
import { createProject } from "@/lib/repo/projects";
import { getRun } from "@/lib/repo/runs";
import { runProject } from "@/lib/runner/run-project";
import { testConfig, testDb } from "./helpers";

// Les dumps tels que l'application les lance (scripts fixes de lib/dumps.ts), contre de vrais serveurs.
const PG = `bm-int-pg-${process.pid}`;
const MONGO = `bm-int-mongo-${process.pid}`;
const MARIA = `bm-int-maria-${process.pid}`;
const PASSWORD = "p@ss:w0rd";
const urls: Record<DbKind, string> = { postgres: "", mongodb: "", mysql: "" };

function succeeds(file: string, args: string[]): boolean {
  try {
    execFileSync(file, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = () => succeeds("docker", ["info"]);
// Le dump MySQL tourne avec le mariadb-dump du poste (en production : celui du runner).
const hasMariadbDump = succeeds("mariadb-dump", ["--version"]);

async function retry(step: () => void, what: string) {
  for (let i = 0; i < 90; i++) {
    try {
      return step();
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`${what} n'a pas démarré`);
}

const port = (name: string, inner: number) => execFileSync("docker", ["port", name, String(inner)]).toString().trim().split("\n")[0].split(":").at(-1);

async function dump(kind: DbKind) {
  const db = testDb();
  const cfg = testConfig();
  const pid = createProject(db, {
    name: `${kind}-int`, db_kind: kind, db_url: urls[kind], cron: "0 3 * * *",
    retention_count: 3, nas_copy: false, timeout_minutes: 5, enabled: true,
  });
  return getRun(db, (await runProject(pid, "manual", { db, cfg }))!)!;
}

describe.skipIf(!hasDocker())("dumps contre de vrais serveurs", () => {
  beforeAll(async () => {
    execFileSync("docker", ["run", "-d", "--rm", "--name", PG, "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "-p", "127.0.0.1::5432", "postgres:17"]);
    execFileSync("docker", ["run", "-d", "--rm", "--name", MONGO, "-e", "MONGO_INITDB_ROOT_USERNAME=root", "-e", `MONGO_INITDB_ROOT_PASSWORD=${PASSWORD}`, "-p", "127.0.0.1::27017", "mongo:8"]);
    if (hasMariadbDump) {
      execFileSync("docker", ["run", "-d", "--rm", "--name", MARIA, "-e", `MARIADB_ROOT_PASSWORD=${PASSWORD}`, "-e", "MARIADB_DATABASE=app", "-p", "127.0.0.1::3306", "mariadb:11"]);
      urls.mysql = `mysql://root:${encodeURIComponent(PASSWORD)}@127.0.0.1:${port(MARIA, 3306)}/app`;
    }
    urls.postgres = `postgresql://postgres:${encodeURIComponent(PASSWORD)}@127.0.0.1:${port(PG, 5432)}/postgres`;
    urls.mongodb = `mongodb://root:${encodeURIComponent(PASSWORD)}@127.0.0.1:${port(MONGO, 27017)}/app?authSource=admin`;
    await retry(() => {
      execFileSync("docker", ["exec", PG, "psql", "-U", "postgres", "-c", "CREATE TABLE IF NOT EXISTS t (id int); INSERT INTO t VALUES (1);"], { stdio: "ignore" });
    }, "Postgres");
    await retry(() => {
      execFileSync("docker", ["exec", MONGO, "mongosh", "-u", "root", "-p", PASSWORD, "--quiet", "--eval", 'db.getSiblingDB("app").c.insertOne({a: 1})'], { stdio: "ignore" });
    }, "MongoDB");
    if (hasMariadbDump) {
      await retry(() => {
        execFileSync("docker", ["exec", MARIA, "mariadb", "-uroot", `-p${PASSWORD}`, "-h127.0.0.1", "app", "-e", "CREATE TABLE IF NOT EXISTS t (id int); INSERT INTO t VALUES (1);"], { stdio: "ignore" });
      }, "MariaDB");
    }
  }, 180_000);

  afterAll(() => {
    execFileSync("docker", ["rm", "-f", PG, MONGO, ...(hasMariadbDump ? [MARIA] : [])], { stdio: "ignore" });
  });

  it("PostgreSQL : dump vérifié, sans fuite du mot de passe", async () => {
    const run = await dump("postgres");
    expect(run.status, run.log).toBe("success");
    expect(run.files[0]).toMatch(/^postgres-int-backup_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.dump$/);
    expect(run.log).toMatch(/OK: .*, 1 tables/);
    expect(run.log).not.toContain(PASSWORD);
    expect(run.log).not.toContain(encodeURIComponent(PASSWORD));
  }, 120_000);

  it("MongoDB : archive vérifiée, sans fuite du mot de passe", async () => {
    const run = await dump("mongodb");
    expect(run.status, run.log).toBe("success");
    expect(run.files[0]).toMatch(/^mongodb-int-backup_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.archive\.gz$/);
    expect(run.size_bytes).toBeGreaterThan(0);
    expect(run.log).toMatch(/OK: /);
    expect(run.log).not.toContain(PASSWORD);
    expect(run.log).not.toContain(encodeURIComponent(PASSWORD));
  }, 120_000);

  it.skipIf(!hasMariadbDump)("MySQL / MariaDB : dump complet vérifié, sans fuite du mot de passe", async () => {
    const run = await dump("mysql");
    expect(run.status, run.log).toBe("success");
    expect(run.files[0]).toMatch(/^mysql-int-backup_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.sql\.gz$/);
    expect(run.log).toMatch(/OK: .*, 1 tables/);
    expect(run.log).not.toContain(PASSWORD);
    expect(run.log).not.toContain(encodeURIComponent(PASSWORD));
  }, 120_000);
});
