import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DB_KINDS } from "@/lib/dumps";
import { tmpDir } from "./helpers";

// Le script MySQL découpe l'URL lui-même : on le lance avec un faux mariadb-dump qui note ses arguments et son
// mot de passe, puis écrit un dump (complet ou non).
function dumpWith(url: string, output: string): { dir: string; log: string } {
  const dir = tmpDir();
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "mariadb-dump"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${dir}/args"\nprintf '%s' "$MYSQL_PWD" > "${dir}/pwd"\nprintf '${output}'\n`,
    { mode: 0o755 },
  );
  const script = path.join(dir, "dump.sh");
  fs.writeFileSync(script, DB_KINDS.mysql.script);
  const env = { PATH: `${bin}:${process.env.PATH}`, DATABASE_URL: url, OUTPUT_DIR: dir, PROJECT_NAME: "p", TIMESTAMP: "x" };
  const log = execFileSync("bash", ["-euo", "pipefail", script], { env: env as Record<string, string> as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "ignore"] });
  return { dir, log: log.toString() };
}

function run(url: string): { args: string[]; password: string; log: string } {
  const { dir, log } = dumpWith(url, "CREATE TABLE t (id int);\\n-- Dump completed on x\\n");
  return { args: fs.readFileSync(path.join(dir, "args"), "utf8").trim().split("\n"), password: fs.readFileSync(path.join(dir, "pwd"), "utf8"), log };
}

describe("script MySQL / MariaDB", () => {
  it("découpe l'URL : hôte, port, utilisateur, base, mot de passe décodé hors ligne de commande", () => {
    const password = "p@ss:w0rd/#%?&\\né";
    const r = run(`mysql://r%C3%A9mi:${encodeURIComponent(password)}@db.example.com:3307/ma%2Dbase?ssl-mode=REQUIRED`);
    expect(r.password).toBe(password);
    expect(r.args).toEqual(expect.arrayContaining(["--host=db.example.com", "--port=3307", "--user=rémi", "--ssl", "--databases", "ma-base"]));
    expect(r.args.join(" ")).not.toContain("w0rd");
    expect(r.log).toMatch(/^OK: .+, 1 tables\n$/);
  });

  it("valeurs par défaut : port 3306, sans utilisateur ni base = toutes les bases, sans TLS imposé", () => {
    const r = run("mariadb://db.example.com");
    expect(r.password).toBe("");
    expect(r.args).toEqual(expect.arrayContaining(["--host=db.example.com", "--port=3306", "--all-databases"]));
    expect(r.args.some((a) => a.startsWith("--user") || a.startsWith("--ssl"))).toBe(false);
  });

  it("ssl-mode : vérification du certificat, ou TLS désactivé", () => {
    expect(run("mysql://u:p@db.example.com/app?charset=x&ssl-mode=VERIFY_IDENTITY").args).toEqual(
      expect.arrayContaining(["--ssl", "--ssl-verify-server-cert", "--ssl-ca=/etc/ssl/certs/ca-certificates.crt"]),
    );
    expect(run("mysql://u:p@db.example.com/app?ssl-mode=DISABLED").args).toContain("--skip-ssl");
  });

  it("refuse un nom de base qui serait lu comme une option", () => {
    expect(() => run("mysql://u@db.example.com/%2D%2Dplugin-dir=%2Ftmp")).toThrow();
  });

  it("échoue si le dump n'est pas allé jusqu'au bout", () => {
    expect(() => dumpWith("mysql://u@db.example.com/app", "CREATE TABLE t (id int);\\n")).toThrow();
  });
});
