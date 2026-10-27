import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEnvironment, upsertSecret } from "@/lib/repo/environments";
import { createProject } from "@/lib/repo/projects";
import { getRun } from "@/lib/repo/runs";
import { MASK } from "@/lib/runner/mask";
import { runRemote } from "@/lib/runner/remote";
import { runProject } from "@/lib/runner/run-project";
import { copyOutputs, localBackupDir } from "@/lib/runner/storage";
import { parseMaxRunBytes, startRunner } from "@/runner/server";
import { testConfig, testDb, tmpDir } from "./helpers";

const servers: net.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function runner() {
  const root = tmpDir();
  const socket = path.join(root, "runner.sock");
  const workDir = path.join(root, "work");
  servers.push(await startRunner(socket, { workDir, appGid: process.getgid!(), sandbox: false }));
  return { socket, workDir };
}

const base = { networkSecret: null, projectSlug: "pilote", stamp: "2026-10-13_03-00-00", tz: "Europe/Paris", timeoutMs: 10_000 };

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
}

describe("runner isolé", () => {
  it("exécute le script, renvoie le journal masqué et les sorties, puis nettoie à la libération", async () => {
    const { socket, workDir } = await runner();
    const logs: string[] = [];
    const remote = await runRemote(
      socket,
      { ...base, runId: 7, script: 'echo "url=$DATABASE_URL"; echo data > "$OUTPUT_DIR/$PROJECT_NAME.dump"', secrets: { DATABASE_URL: "postgres://u:motdepasse@h/db" } },
      (l) => logs.push(l),
    );
    expect(remote.result.exitCode).toBe(0);
    expect(remote.result.log).toContain(`url=${MASK}`);
    expect(remote.result.log).not.toContain("motdepasse");
    expect(logs.at(-1)).toBe(remote.result.log);
    expect(fs.readFileSync(path.join(remote.outDir, "pilote.dump"), "utf8")).toBe("data\n");
    remote.release();
    await waitFor(() => !fs.existsSync(path.join(workDir, "7")));
    expect(fs.existsSync(path.join(workDir, "7"))).toBe(false);
  });

  it("ne transmet pas l'environnement du runner au script", async () => {
    const { socket } = await runner();
    process.env.BM_TEST_SECRET = "ne-doit-pas-fuir";
    try {
      const remote = await runRemote(socket, { ...base, runId: 8, script: 'echo "v=${BM_TEST_SECRET:-absent}"', secrets: {} });
      expect(remote.result.log).toContain("v=absent");
      remote.release();
    } finally {
      delete process.env.BM_TEST_SECRET;
    }
  });

  it("refuse une requête invalide", async () => {
    const { socket } = await runner();
    await expect(runRemote(socket, { ...base, runId: 9, projectSlug: "../x", script: "true", secrets: {} })).rejects.toThrow(
      /requête invalide/,
    );
  });

  it("runProject passe par le runner quand RUNNER_SOCKET est défini", async () => {
    const { socket, workDir } = await runner();
    const db = testDb();
    const cfg = { ...testConfig(), runnerSocket: socket, runnerWorkDir: workDir };
    const env = createEnvironment(db, { name: "prod", description: "" });
    upsertSecret(db, env, "TOKEN", "jeton-secret-123");
    const projectId = createProject(db, {
      name: "Pilote",
      environment_id: env, network_secret: null,
      script: 'echo "t=$TOKEN"; echo x > "$OUTPUT_DIR/f.dump"; ln -s /etc/passwd "$OUTPUT_DIR/lien"',
      cron: "0 3 * * *",
      retention_count: 3,
      nas_copy: false,
      timeout_minutes: 1,
      enabled: true,
    });
    const run = getRun(db, (await runProject(projectId, "manual", { db, cfg }))!)!;
    expect(run.status).toBe("success");
    expect(run.files).toEqual(["f.dump"]);
    expect(run.log).toContain(`t=${MASK}`);
    expect(run.log).toContain("Ignorés (liens symboliques ou fichiers spéciaux) : lien");
    expect(fs.existsSync(path.join(localBackupDir(cfg, "pilote", run), "lien"))).toBe(false);
  });
});

describe("copyOutputs", () => {
  it("refuse un $OUTPUT_DIR remplacé par un lien symbolique", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "vrai"));
    fs.writeFileSync(path.join(root, "vrai", "app.db"), "secret");
    fs.symlinkSync(path.join(root, "vrai"), path.join(root, "out"));
    await expect(copyOutputs(path.join(root, "out"), path.join(root, "dest"))).rejects.toThrow(/remplacé/);
  });

  it("copie les sous-dossiers et ignore les liens", async () => {
    const root = tmpDir();
    const out = path.join(root, "out");
    fs.mkdirSync(path.join(out, "sous"), { recursive: true });
    fs.writeFileSync(path.join(out, "sous", "a.dump"), "abc");
    fs.symlinkSync("/etc/passwd", path.join(out, "sous", "lien"));
    const r = await copyOutputs(out, path.join(root, "dest"));
    expect(r).toEqual({ files: [path.join("sous", "a.dump")], size: 3, skipped: [path.join("sous", "lien")] });
  });
});

describe("sorties d'un runner compromis", () => {
  it("refuse un dossier de sortie qui n'est pas celui du run", async () => {
    const root = tmpDir();
    const socket = path.join(root, "faux.sock");
    const fake = await new Promise<net.Server>((resolve) => {
      const s = net.createServer((sock) => {
        sock.once("data", () => {
          sock.write(JSON.stringify({ t: "result", exitCode: 0, signal: null, timedOut: false, log: "", outDir: "/etc" }) + "\n");
        });
      });
      s.listen(socket, () => resolve(s));
    });
    servers.push(fake);
    const db = testDb();
    const cfg = { ...testConfig(), runnerSocket: socket, runnerWorkDir: path.join(root, "work") };
    const projectId = createProject(db, {
      name: "Pilote",
      environment_id: null,
      network_secret: null,
      script: "true",
      cron: "0 3 * * *",
      retention_count: 3,
      nas_copy: false,
      timeout_minutes: 1,
      enabled: true,
    });
    const run = getRun(db, (await runProject(projectId, "manual", { db, cfg }))!)!;
    expect(run.status).toBe("failed");
    expect(run.log).toContain("dossier de sortie inattendu");
    expect(run.files).toEqual([]);
  });
});

describe("RUN_MAX_BYTES", () => {
  it("refuse une valeur non entière, nulle ou négative", () => {
    expect(parseMaxRunBytes(undefined)).toBeUndefined();
    expect(parseMaxRunBytes("8000000")).toBe(8_000_000);
    for (const bad of ["abc", "0", "-5", "1.5", "1e400"]) expect(() => parseMaxRunBytes(bad), bad).toThrow(/RUN_MAX_BYTES/);
  });
});
