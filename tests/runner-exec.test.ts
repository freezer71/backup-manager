import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRunEnv, formatStamp } from "@/lib/runner/env";
import { executeScript, type ExecOptions } from "@/lib/runner/execute";
import { makeMasker, MASK } from "@/lib/runner/mask";
import { tmpDir } from "./helpers";

function run(script: string, opts: Partial<ExecOptions> = {}, secrets: Record<string, string> = {}) {
  const dir = tmpDir();
  const scriptPath = path.join(dir, "script.sh");
  fs.writeFileSync(scriptPath, script);
  const env = buildRunEnv({ secrets, outputDir: dir, homeDir: dir, projectSlug: "p", stamp: "s", tz: "Europe/Paris" });
  return executeScript({ scriptPath, cwd: dir, env, timeoutMs: 10_000, tz: "Europe/Paris", mask: makeMasker(Object.values(secrets)), ...opts });
}

// Processus sortis du groupe lancés par les tests : on les arrête nous-mêmes (par PID) à la fin.
const pidFiles: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const f of pidFiles.splice(0)) {
    try {
      process.kill(Number(fs.readFileSync(f, "utf8").trim()), "SIGKILL");
    } catch {
      // déjà terminé ou fichier absent
    }
  }
});

const has = (cmd: string) => {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

// Lance `sleep 30` dans une nouvelle session (hors du groupe du script, comme un démon) et écrit son PID.
// setsid si présent (Linux), sinon POSIX::setsid de perl (macOS n'a pas de setsid).
function escapedSleep(): string {
  const pidFile = path.join(tmpDir(), "pid");
  pidFiles.push(pidFile);
  if (has("setsid")) return `setsid sh -c 'echo $$ > "${pidFile}"; exec sleep 30' &`;
  return `perl -MPOSIX -e 'POSIX::setsid(); open(my $f, ">", "${pidFile}"); print $f $$; close($f); exec("sleep", "30")' &`;
}

describe("formatStamp", () => {
  it("formate dans le fuseau demandé", () => {
    expect(formatStamp(new Date("2026-10-04T01:02:03Z"), "Europe/Paris")).toBe("2026-10-04_03-02-03");
  });
});

describe("buildRunEnv", () => {
  it("ne transmet jamais l'environnement du processus", () => {
    vi.stubEnv("DB_ENCRYPTION_KEY", "ne-doit-pas-fuiter");
    const env = buildRunEnv({ secrets: { A: "1" }, outputDir: "/o", homeDir: "/h", projectSlug: "p", stamp: "s", tz: "UTC" });
    expect(env.DB_ENCRYPTION_KEY).toBeUndefined();
    expect(env).toMatchObject({ A: "1", OUTPUT_DIR: "/o", HOME: "/h", PROJECT_NAME: "p", TIMESTAMP: "s", TZ: "UTC" });
  });
  it("les variables réservées priment sur un secret homonyme", () => {
    const env = buildRunEnv({ secrets: { OUTPUT_DIR: "/pirate" }, outputDir: "/o", homeDir: "/h", projectSlug: "p", stamp: "s", tz: "UTC" });
    expect(env.OUTPUT_DIR).toBe("/o");
  });
});

describe("makeMasker", () => {
  it("masque les valeurs, la forme encodée et le mot de passe d'une URL (Review Focus 2)", () => {
    const mask = makeMasker(["postgresql://user:p%40ssw0rd@host:5432/db", "abc"]);
    expect(mask("url=postgresql://user:p%40ssw0rd@host:5432/db")).toBe(`url=${MASK}`);
    expect(mask("password p@ssw0rd rejected")).toBe(`password ${MASK} rejected`);
    expect(mask("password p%40ssw0rd rejected")).toBe(`password ${MASK} rejected`);
    expect(mask("abc reste visible (moins de 4 caractères)")).toBe("abc reste visible (moins de 4 caractères)");
  });
});

describe("masquage des secrets multi-lignes", () => {
  it("masque chaque ligne d'un secret PEM affiché avec echo", async () => {
    const key = "-----BEGIN KEY-----\nMIIEvQIBADANBgkqhkiG9w0B\n-----END KEY-----";
    const r = await run('echo "$KEY"', {}, { KEY: key });
    expect(r.log).not.toContain("MIIEvQIBADANBgkqhkiG9w0B");
    expect(r.log).not.toContain("BEGIN KEY");
    expect(r.log).not.toContain("END KEY");
  });
  it("masque une valeur terminée par un saut de ligne", async () => {
    const r = await run('echo "t=$TOKEN"', {}, { TOKEN: "tok-secret-123\n" });
    expect(r.log).toContain(`t=${MASK}`);
    expect(r.log).not.toContain("tok-secret-123");
  });
});

describe("executeScript", () => {
  it("capture stdout et stderr avec horodatage", async () => {
    const r = await run("echo bonjour\necho oups >&2\n");
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.log).toMatch(/^\[\d\d:\d\d:\d\d\] bonjour$/m);
    expect(r.log).toMatch(/^\[\d\d:\d\d:\d\d\] ! oups$/m);
  });

  it("renvoie le code de sortie et échoue sur variable non définie (-u)", async () => {
    expect((await run("exit 3")).exitCode).toBe(3);
    expect((await run('echo "$NON_DEFINIE"')).exitCode).not.toBe(0);
  });

  it("n'expose pas DB_ENCRYPTION_KEY au script", async () => {
    vi.stubEnv("DB_ENCRYPTION_KEY", "ne-doit-pas-fuiter");
    const r = await run('echo "cle=${DB_ENCRYPTION_KEY:-absente}"');
    expect(r.log).toContain("cle=absente");
  });

  it("masque les secrets dans les logs", async () => {
    const r = await run('echo "url=$DATABASE_URL"', {}, { DATABASE_URL: "postgres://u:supersecret@h/db" });
    expect(r.log).toContain(`url=${MASK}`);
    expect(r.log).not.toContain("supersecret");
  });

  it("tue le groupe de processus au timeout", async () => {
    const start = Date.now();
    const r = await run("sleep 30 & wait", { timeoutMs: 300, killGraceMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - start).toBeLessThan(5_000);
    expect(r.log).toContain("Timeout");
  });

  it("tronque le journal", async () => {
    const r = await run("for i in $(seq 1 200); do echo ligne-$i; done", { maxLogBytes: 500 });
    expect(Buffer.byteLength(r.log)).toBeLessThan(600);
    expect(r.log).toContain("journal tronqué");
  });

  it("appelle onLog au fil de l'eau", async () => {
    const seen: string[] = [];
    await run("echo a\necho b", { onLog: (l) => seen.push(l) });
    expect(seen.at(-1)).toContain("b");
  });

  it("ne sature pas la mémoire sur une ligne sans saut de ligne", async () => {
    const r = await run("head -c 5000000 /dev/zero | tr '\\0' a", { maxLogBytes: 2000 });
    expect(Buffer.byteLength(r.log)).toBeLessThan(2500);
    expect(r.log).toContain("ignorée");
  });

  it("n'enregistre aucun fragment d'une ligne de plus de 64 Ko (secret à cheval sur la coupure)", async () => {
    const secret = "S3cr3t-Zq8wXy-Lm4nPv-Rt6uKd";
    const script = `head -c 65520 /dev/zero | tr '\\0' a\nprintf '%s' "$SECRET"\nhead -c 5000 /dev/zero | tr '\\0' b\necho\necho suite\n`;
    const r = await run(script, {}, { SECRET: secret });
    for (let i = 0; i + 8 <= secret.length; i++) expect(r.log).not.toContain(secret.slice(i, i + 8));
    expect(r.log).toContain("ignorée");
    expect(r.log).toContain("suite");
  });

  it("conserve le message de timeout après troncature", async () => {
    const r = await run("for i in $(seq 1 200); do echo ligne-$i; done; sleep 30", { maxLogBytes: 500, timeoutMs: 500, killGraceMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.log).toContain("journal tronqué");
    expect(r.log).toContain("Timeout");
  });

  it("se termine quand le script est fini malgré un processus d'arrière-plan qui garde les tubes ouverts", async () => {
    const start = Date.now();
    const r = await run("sleep 30 &\necho fini\n", { exitGraceMs: 300 });
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.log).toContain("fini");
    expect(r.log).toContain("Processus encore actifs après la fin du script : arrêtés.");
  }, 15_000);

  it("se termine quand un processus sorti du groupe (setsid, démon) garde les tubes ouverts", async () => {
    const start = Date.now();
    const r = await run(`${escapedSleep()}\nsleep 0.2\necho fini\nexit 4\n`, { exitGraceMs: 300 });
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(r.exitCode).toBe(4);
    expect(r.timedOut).toBe(false);
    expect(r.log).toContain("fini");
  }, 15_000);

  it("au timeout, se résout au plus tard killGraceMs + 2 s après le SIGKILL même sans fermeture des tubes", async () => {
    const start = Date.now();
    const r = await run(`${escapedSleep()}\nsleep 30\n`, { timeoutMs: 300, killGraceMs: 200, exitGraceMs: 60_000 });
    expect(Date.now() - start).toBeLessThan(300 + 200 + 2_000 + 1_000);
    expect(r.timedOut).toBe(true);
    expect(r.log).toContain("Timeout");
  }, 15_000);
});
