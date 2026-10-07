import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEnvironment, upsertSecret } from "@/lib/repo/environments";
import { createProject } from "@/lib/repo/projects";
import { getRun } from "@/lib/repo/runs";
import { runProject } from "@/lib/runner/run-project";
import { TEMPLATES } from "@/lib/templates";
import { testConfig, testDb } from "./helpers";

const NAME = `bm-int-pg-${process.pid}`;
let url = "";

function hasDocker(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasDocker())("modèle Postgres contre un vrai serveur", () => {
  beforeAll(async () => {
    execFileSync("docker", ["run", "-d", "--rm", "--name", NAME, "-e", "POSTGRES_PASSWORD=p@ss:w0rd", "-p", "127.0.0.1::5432", "postgres:17"]);
    const port = execFileSync("docker", ["port", NAME, "5432"]).toString().trim().split("\n")[0].split(":").at(-1);
    url = `postgresql://postgres:${encodeURIComponent("p@ss:w0rd")}@127.0.0.1:${port}/postgres`;
    for (let i = 0; i < 60; i++) {
      try {
        execFileSync("docker", ["exec", NAME, "pg_isready", "-U", "postgres"], { stdio: "ignore" });
        execFileSync("docker", ["exec", NAME, "psql", "-U", "postgres", "-c", "CREATE TABLE t (id int); INSERT INTO t VALUES (1);"], { stdio: "ignore" });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error("Postgres n'a pas démarré");
  }, 90_000);

  afterAll(() => {
    execFileSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
  });

  it("produit un dump vérifié, sans fuite du mot de passe dans les logs", async () => {
    const db = testDb();
    const cfg = testConfig();
    const envId = createEnvironment(db, { name: "pg", description: "" });
    upsertSecret(db, envId, "DATABASE_URL", url);
    const pid = createProject(db, {
      name: "pg-int", environment_id: envId, script: TEMPLATES.postgres.script, cron: "0 3 * * *",
      retention_count: 3, nas_copy: false, timeout_minutes: 5, enabled: true,
    });
    const run = getRun(db, (await runProject(pid, "manual", { db, cfg }))!)!;
    expect(run.status, run.log).toBe("success");
    expect(run.files[0]).toMatch(/^pg-int-backup_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.dump$/);
    expect(run.log).toMatch(/OK: .*, 1 tables/);
    expect(run.log).not.toContain("p@ss:w0rd");
  }, 120_000);
});
