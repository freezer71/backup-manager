// Sandbox des scripts, dans le vrai conteneur runner (image Docker, capacités et profil seccomp du compose),
// face à un vrai Postgres. Chaque test tente réellement ce qu'un script malveillant ferait.
// Le profil AppArmor n'est pas chargé ici (absent de Docker Desktop) : il se vérifie sur l'hôte (README).
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ID = `bm-sbx-${process.pid}`;
const NET = ID;
const PG = `${ID}-pg`;
const RUNNER = `${ID}-runner`;
const IMAGE = `${ID}-image`;
const ROOT = path.resolve(__dirname, "..");
const PASSWORD = "Pg-s3cret-Xq7";
const URL = `postgresql://postgres:${PASSWORD}@${PG}:5432/postgres`;

function hasDocker(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();

type Outcome = { result?: { exitCode: number | null; log: string; timedOut: boolean }; files?: Array<{ name: string; size: number }>; error?: string };

let runId = 1;
function run(script: string, opts: { secrets?: Record<string, string>; networkSecret?: string | null; timeoutMs?: number } = {}): Promise<Outcome> {
  const req = {
    runId: runId++,
    script,
    secrets: opts.secrets ?? { DATABASE_URL: URL },
    networkSecret: opts.networkSecret === undefined ? "DATABASE_URL" : opts.networkSecret,
    projectSlug: "sbx",
    stamp: "2026-10-26_03-00-00",
    tz: "Europe/Paris",
    timeoutMs: opts.timeoutMs ?? 60_000,
  };
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-u", "1001:1001", RUNNER, "node", "/client.mjs", JSON.stringify(req)]);
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(JSON.parse(out.trim().split("\n").at(-1) ?? "") as Outcome);
      } catch {
        reject(new Error(`sortie illisible : ${out}`));
      }
    });
  });
}

describe.skipIf(!hasDocker())("sandbox des scripts (conteneur runner)", () => {
  beforeAll(async () => {
    // amd64 comme la production (mongodb-database-tools n'existe pas pour arm64).
    docker("build", "-q", "--platform", "linux/amd64", "--target", "runner", "-t", IMAGE, ROOT);
    docker("network", "create", NET);
    docker("run", "-d", "--rm", "--name", PG, "--network", NET, "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "postgres:17");
    docker(
      "run", "-d", "--rm", "--platform", "linux/amd64", "--name", RUNNER, "--network", NET,
      "--read-only", "--tmpfs", "/tmp:size=64m,mode=1777", "--tmpfs", "/work", "--tmpfs", "/run/bm",
      "--cap-drop", "ALL",
      ...["CHOWN", "SETUID", "SETGID", "KILL", "SYS_ADMIN", "NET_ADMIN", "NET_BIND_SERVICE"].flatMap((c) => ["--cap-add", c]),
      "-e", "RUN_MAX_BYTES=8000000", // 8 Mo : de quoi tester la limite de taille
      "--security-opt", "no-new-privileges:true",
      "--security-opt", `seccomp=${path.join(ROOT, "deploy/seccomp/runner.json")}`,
      "-v", `${path.join(ROOT, "tests/sandbox/client.mjs")}:/client.mjs:ro`,
      IMAGE,
    );
    for (let i = 0; i < 90; i++) {
      try {
        execFileSync("docker", ["exec", PG, "pg_isready", "-U", "postgres"], { stdio: "ignore" });
        execFileSync("docker", ["exec", RUNNER, "test", "-S", "/run/bm/runner.sock"], { stdio: "ignore" });
        execFileSync("docker", ["exec", PG, "psql", "-U", "postgres", "-c", "CREATE TABLE IF NOT EXISTS t (id int); INSERT INTO t VALUES (1);"], { stdio: "ignore" });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error(`runner ou Postgres non prêts :\n${docker("logs", RUNNER)}`);
  }, 900_000);

  afterAll(() => {
    for (const args of [["rm", "-f", RUNNER, PG], ["network", "rm", NET]]) {
      try {
        execFileSync("docker", args, { stdio: "ignore" });
      } catch {
        // déjà supprimé ou jamais créé
      }
    }
  });

  it("le runner démarre en mode sandbox", () => {
    expect(docker("logs", RUNNER)).toContain("(sandbox par run)");
  });

  it("dump la base autorisée, sans fuite du mot de passe", async () => {
    const r = await run('pg_dump "$DATABASE_URL" -F c -f "$OUTPUT_DIR/db.dump"; pg_restore -l "$OUTPUT_DIR/db.dump" | grep -c "TABLE DATA"');
    expect(r.error).toBeUndefined();
    expect(r.result?.exitCode, r.result?.log).toBe(0);
    expect(r.result?.log).toContain(`Sandbox : réseau limité à ${PG}:5432`);
    expect(r.result?.log).not.toContain(PASSWORD);
    expect(r.files?.[0]).toMatchObject({ name: "db.dump" });
    expect(r.files?.[0].size).toBeGreaterThan(0);
  });

  it("n'écrit que dans $OUTPUT_DIR et $TMPDIR, ne voit ni /work, ni le socket, ni les relais", async () => {
    const r = await run(
      [
        "set +e",
        'touch /etc/x 2>/dev/null && echo "FUITE etc" || echo "etc=ro"',
        'touch /usr/x 2>/dev/null && echo "FUITE usr" || echo "usr=ro"',
        'touch /x 2>/dev/null && echo "FUITE racine" || echo "racine=ro"',
        'ls /work >/dev/null 2>&1 && echo "FUITE work" || echo "work=absent"',
        'test -e /run/bm/runner.sock && echo "FUITE socket" || echo "socket=absent"',
        'ls /run/relay >/dev/null 2>&1 && echo "FUITE relais" || echo "relais=fermés"',
        'test -e /runner && echo "FUITE code" || echo "code=absent"',
        'echo ok > "$TMPDIR/t" && echo "tmp=ok"',
        'echo ok > "$OUTPUT_DIR/f" && echo "out=ok"',
        'echo "uid=$(id -u) groups=$(id -G)"',
      ].join("\n"),
    );
    const log = r.result?.log ?? "";
    expect(log).not.toContain("FUITE");
    for (const ok of ["etc=ro", "usr=ro", "racine=ro", "work=absent", "socket=absent", "relais=fermés", "code=absent", "tmp=ok", "out=ok"]) {
      expect(log).toContain(ok);
    }
    expect(log).toMatch(/uid=(\d+) groups=\1\n/);
  });

  it("aucun réseau hors de l'hôte et du port autorisés, pas de DNS", async () => {
    const r = await run(
      [
        "set +e",
        'getent hosts example.com >/dev/null && echo "FUITE dns" || echo "dns=bloqué"',
        'timeout 5 bash -c "exec 3<>/dev/tcp/1.1.1.1/443" 2>/dev/null && echo "FUITE internet" || echo "internet=bloqué"',
        `timeout 5 bash -c "exec 3<>/dev/tcp/${PG}/22" 2>/dev/null && echo "FUITE port" || echo "autre-port=bloqué"`,
        `timeout 5 bash -c "exec 3<>/dev/tcp/${PG}/5432" 2>/dev/null && echo "base=joignable" || echo "base=injoignable"`,
        'ip addr add 10.9.9.9/32 dev lo 2>/dev/null && echo "FUITE ip" || echo "ip=refusé"',
      ].join("\n"),
    );
    const log = r.result?.log ?? "";
    expect(log).not.toContain("FUITE");
    for (const ok of ["dns=bloqué", "internet=bloqué", "autre-port=bloqué", "base=joignable", "ip=refusé"]) expect(log).toContain(ok);
  });

  it("sans secret réseau désigné, aucun réseau du tout", async () => {
    const r = await run(`timeout 5 bash -c "exec 3<>/dev/tcp/${PG}/5432" 2>/dev/null && echo "FUITE base" || echo "base=bloquée"`, { networkSecret: null });
    expect(r.result?.log).toContain("Sandbox : aucun accès réseau");
    expect(r.result?.log).toContain("base=bloquée");
  });

  it("refuse le run si le secret désigné est absent", async () => {
    const r = await run("true", { secrets: {}, networkSecret: "DATABASE_URL" });
    expect(r.error).toMatch(/DATABASE_URL.*absent/);
  });

  it("pas d'espace de noms utilisateur, de montage ni de changement d'identité", async () => {
    const r = await run(
      [
        "set +e",
        'unshare -U true 2>/dev/null && echo "FUITE userns" || echo "userns=refusé"',
        'unshare -n true 2>/dev/null && echo "FUITE netns" || echo "netns=refusé"',
        'mount -t tmpfs x /tmp 2>/dev/null && echo "FUITE mount" || echo "mount=refusé"',
        'grep -q "^CapEff:\\s*0\\+$" /proc/self/status && echo "caps=aucune" || echo "FUITE caps"',
        'grep -q "^NoNewPrivs:\\s*1$" /proc/self/status && echo "nnp=1" || echo "FUITE nnp"',
      ].join("\n"),
    );
    const log = r.result?.log ?? "";
    expect(log).not.toContain("FUITE");
    for (const ok of ["userns=refusé", "netns=refusé", "mount=refusé", "caps=aucune", "nnp=1"]) expect(log).toContain(ok);
  });

  it("un run ne voit pas les processus (ni leurs arguments) d'un autre run", async () => {
    const victim = run('bash -c "sleep 8" "SECRET-DANS-ARGV-123"; echo fin');
    await new Promise((r) => setTimeout(r, 2000));
    const spy = await run(
      'n=$(ls -d /proc/[0-9]* | wc -l); echo "processus=$n"; cat /proc/[0-9]*/cmdline 2>/dev/null | tr "\\0" " " | grep -q "SECRET-DANS-ARG[V]" && echo "FUITE argv" || echo "argv=invisible"',
    );
    expect(spy.result?.log).toContain("argv=invisible");
    expect(Number(/processus=(\d+)/.exec(spy.result?.log ?? "")?.[1])).toBeLessThan(8);
    await victim;
  }, 60_000);

  it("rien ne survit au run, même un démon détaché", async () => {
    const id = runId;
    const r = await run('setsid bash -c "sleep 300" </dev/null >/dev/null 2>&1 & echo lancé');
    expect(r.result?.exitCode).toBe(0);
    await new Promise((res) => setTimeout(res, 1000));
    const uid = String(100_000 + id);
    const owners = docker("exec", RUNNER, "sh", "-c", "for s in /proc/[0-9]*/status; do awk '/^Uid:/{print $2}' $s 2>/dev/null; done");
    expect(owners.split("\n")).not.toContain(uid);
  });

  it("arrête un run qui écrit plus que la taille maximale", async () => {
    const started = Date.now();
    const r = await run('head -c 20000000 /dev/zero > "$TMPDIR/gros"; sleep 60; echo "FUITE fini"', { networkSecret: null });
    expect(Date.now() - started).toBeLessThan(40_000);
    expect(r.result?.exitCode).not.toBe(0);
    expect(r.result?.log).toContain("Arrêté : plus de");
    expect(r.result?.log).not.toContain("FUITE");
  }, 60_000);

  it("un dossier rendu illisible ne cache pas ce qui est écrit", async () => {
    const r = await run('mkdir "$TMPDIR/cache"; head -c 20000000 /dev/zero > "$TMPDIR/cache/gros"; chmod 000 "$TMPDIR/cache"; sleep 60; echo "FUITE fini"', { networkSecret: null });
    expect(r.result?.log).toContain("Arrêté : plus de");
    expect(r.result?.log).not.toContain("FUITE");
  }, 60_000);
});
