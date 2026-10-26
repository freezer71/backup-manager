import { describe, expect, it } from "vitest";
import { parseDbUrl, resolveTargets, type Resolver } from "@/lib/runner/targets";

const resolver = (table: Record<string, string>, srv: Record<string, Array<{ name: string; port: number }>> = {}, txt: Record<string, string[][]> = {}): Resolver => ({
  lookup4: async (host) => {
    if (!table[host]) throw new Error(`ENOTFOUND ${host}`);
    return table[host];
  },
  resolveSrv: async (name) => srv[name] ?? [],
  resolveTxt: async (host) => txt[host] ?? [],
});

describe("parseDbUrl", () => {
  it("lit l'hôte et le port, avec le port par défaut du protocole", () => {
    expect(parseDbUrl("postgres://u:p@db.example.com/app")).toEqual({ scheme: "postgres", hosts: [{ host: "db.example.com", port: 5432 }] });
    expect(parseDbUrl("postgresql://u:p%40ss@db.example.com:6543/app?sslmode=verify-full").hosts).toEqual([{ host: "db.example.com", port: 6543 }]);
    expect(parseDbUrl("mongodb://u:p@a.example.com:27018,b.example.com/app?replicaSet=rs0").hosts).toEqual([
      { host: "a.example.com", port: 27018 },
      { host: "b.example.com", port: 27017 },
    ]);
    expect(parseDbUrl("mysql://root@10.0.0.4/x").hosts).toEqual([{ host: "10.0.0.4", port: 3306 }]);
  });

  it("garde un @ du mot de passe dans les identifiants", () => {
    expect(parseDbUrl("postgres://u:a@b@db.example.com/app").hosts).toEqual([{ host: "db.example.com", port: 5432 }]);
  });

  it("refuse ce qu'il ne sait pas restreindre", () => {
    expect(() => parseDbUrl("host=db.example.com user=u")).toThrow(/URL/);
    expect(() => parseDbUrl("postgres:///app?host=/var/run/postgresql")).toThrow(/hôte/);
    expect(() => parseDbUrl("postgres://u@db.example.com/app?host=autre.example.com")).toThrow(/host/);
    expect(() => parseDbUrl("postgres://u@[2001:db8::1]:5432/app")).toThrow(/IPv6/);
    expect(() => parseDbUrl("ftp://u@db.example.com/x")).toThrow(/port/);
    expect(() => parseDbUrl("postgres://u@db.example.com:99999/app")).toThrow(/port/);
    expect(() => parseDbUrl("postgres://u@db_exemple!/app")).toThrow(/hôte/);
  });

  it("n'inclut jamais la valeur dans le message d'erreur", () => {
    expect(() => parseDbUrl("postgres://u:motdepasse@[::1]/x")).toThrow(expect.objectContaining({ message: expect.not.stringContaining("motdepasse") }));
  });
});

describe("resolveTargets", () => {
  it("résout chaque hôte une fois, en IPv4", async () => {
    const r = await resolveTargets("postgres://u:p@db.example.com/app", resolver({ "db.example.com": "203.0.113.7" }));
    expect(r).toEqual({ url: "postgres://u:p@db.example.com/app", targets: [{ host: "db.example.com", ip: "203.0.113.7", port: 5432 }] });
  });

  it("garde une IP littérale sans la résoudre", async () => {
    const r = await resolveTargets("mysql://root@198.51.100.4:3307/x", resolver({}));
    expect(r.targets).toEqual([{ host: null, ip: "198.51.100.4", port: 3307 }]);
  });

  it("refuse une adresse de la boucle locale ou non spécifiée", async () => {
    await expect(resolveTargets("postgres://u@db.example.com/x", resolver({ "db.example.com": "127.0.0.1" }))).rejects.toThrow(/locale/);
    await expect(resolveTargets("postgres://u@0.0.0.0/x", resolver({}))).rejects.toThrow(/locale/);
  });

  it("transforme mongodb+srv en liste d'hôtes (la sandbox n'a pas de DNS)", async () => {
    const r = await resolveTargets(
      "mongodb+srv://u:p@cluster0.example.net/app?retryWrites=true",
      resolver(
        { "s1.example.net": "203.0.113.1", "s2.example.net": "203.0.113.2" },
        { "_mongodb._tcp.cluster0.example.net": [{ name: "s1.example.net", port: 27017 }, { name: "s2.example.net", port: 27017 }] },
        { "cluster0.example.net": [["authSource=admin&replicaSet=atlas-x"]] },
      ),
    );
    expect(r.url).toBe("mongodb://u:p@s1.example.net:27017,s2.example.net:27017/app?authSource=admin&replicaSet=atlas-x&retryWrites=true&tls=true");
    expect(r.targets.map((t) => t.ip)).toEqual(["203.0.113.1", "203.0.113.2"]);
  });

  it("refuse un enregistrement SRV hors du domaine de l'URL", async () => {
    await expect(
      resolveTargets(
        "mongodb+srv://u@cluster0.example.net/app",
        resolver({ "evil.example.org": "203.0.113.9" }, { "_mongodb._tcp.cluster0.example.net": [{ name: "evil.example.org", port: 27017 }] }),
      ),
    ).rejects.toThrow(/SRV/);
  });
});
