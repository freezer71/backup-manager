import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyToNas } from "@/lib/runner/storage";
import { tmpDir } from "./helpers";

// Nécessite les binaires age et age-keygen (brew install age, apt install age).
function keypair(): { identity: string; recipient: string } {
  const identity = path.join(tmpDir(), "identity.txt");
  execFileSync("age-keygen", ["-o", identity], { stdio: "ignore" });
  const recipient = execFileSync("age-keygen", ["-y", identity]).toString().trim();
  return { identity, recipient };
}

function decrypt(file: string, identity: string): string {
  return execFileSync("age", ["-d", "-i", identity, file]).toString();
}

function sources(): string {
  const src = tmpDir();
  fs.writeFileSync(path.join(src, "pilote.dump"), "contenu secret de la base");
  fs.mkdirSync(path.join(src, "schema"));
  fs.writeFileSync(path.join(src, "schema", "roles.sql"), "CREATE ROLE x;");
  return src;
}

describe("copyToNas avec clé publique", () => {
  it("chiffre chaque fichier en .age, sans laisser de clair, en gardant l'arborescence", async () => {
    const { identity, recipient } = keypair();
    const src = sources();
    const dest = path.join(tmpDir(), "nas", "pilote", "run");
    await copyToNas(src, dest, [recipient]);

    expect(fs.readdirSync(dest).sort()).toEqual(["pilote.dump.age", "schema"]);
    expect(fs.readdirSync(path.join(dest, "schema"))).toEqual(["roles.sql.age"]);
    const stored = fs.readFileSync(path.join(dest, "pilote.dump.age"));
    expect(stored.includes("contenu secret")).toBe(false);
    expect(decrypt(path.join(dest, "pilote.dump.age"), identity)).toBe("contenu secret de la base");
    expect(decrypt(path.join(dest, "schema", "roles.sql.age"), identity)).toBe("CREATE ROLE x;");
  });

  it("chiffre pour chaque destinataire", async () => {
    const a = keypair();
    const b = keypair();
    const dest = path.join(tmpDir(), "run");
    await copyToNas(sources(), dest, [a.recipient, b.recipient]);
    expect(decrypt(path.join(dest, "pilote.dump.age"), a.identity)).toBe("contenu secret de la base");
    expect(decrypt(path.join(dest, "pilote.dump.age"), b.identity)).toBe("contenu secret de la base");
  });

  it("n'écrase jamais une copie existante", async () => {
    const { recipient } = keypair();
    const dest = path.join(tmpDir(), "run");
    fs.mkdirSync(dest);
    await expect(copyToNas(sources(), dest, [recipient])).rejects.toThrow();
  });

  it("échoue, sans rien laisser en clair, si age refuse la clé", async () => {
    const dest = path.join(tmpDir(), "run");
    await expect(copyToNas(sources(), dest, ["age1pasunevraiecle"])).rejects.toThrow(/age/);
    const left = fs.existsSync(dest) ? fs.readdirSync(dest, { recursive: true }).map(String) : [];
    expect(left.filter((f) => f.endsWith(".dump") || f.endsWith(".sql"))).toEqual([]);
  });
});

describe("copyToNas sans clé publique", () => {
  it("copie les fichiers tels quels", async () => {
    const dest = path.join(tmpDir(), "run");
    await copyToNas(sources(), dest);
    expect(fs.readFileSync(path.join(dest, "pilote.dump"), "utf8")).toBe("contenu secret de la base");
    expect(fs.readFileSync(path.join(dest, "schema", "roles.sql"), "utf8")).toBe("CREATE ROLE x;");
  });
});
