// Destinations réseau d'un run : les hôtes de l'URL de base de données désignée pour le projet, et rien d'autre.
// Utilisé par le runner (node runner/server.ts, sans alias « @/ ») : uniquement des modules node:.
import dns from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

export type DbHost = { host: string; port: number };
// host : le nom à inscrire dans le /etc/hosts de la sandbox (null pour une IP littérale).
export type Target = { host: string | null; ip: string; port: number };

export type Resolver = {
  lookup4: (host: string) => Promise<string>;
  resolveSrv: (name: string) => Promise<Array<{ name: string; port: number }>>;
  resolveTxt: (host: string) => Promise<string[][]>;
};

export const systemResolver: Resolver = {
  lookup4: async (host) => (await dns.lookup(host, { family: 4 })).address,
  resolveSrv: (name) => dns.resolveSrv(name),
  resolveTxt: (host) => dns.resolveTxt(host),
};

const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  postgresql: 5432,
  mongodb: 27017,
  mysql: 3306,
  mariadb: 3306,
  redis: 6379,
  rediss: 6379,
};

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

// Les messages ne citent jamais la valeur : elle contient le mot de passe.
class TargetError extends Error {}

function splitUrl(value: string): { scheme: string; userinfo: string | null; hostlist: string; rest: string } {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([\s\S]*)$/i.exec(value.trim());
  if (!m) throw new TargetError("l'URL de la base doit être de la forme protocole://hôte:port/…");
  const scheme = m[1].toLowerCase();
  const end = m[2].search(/[/?#]/);
  const authority = end < 0 ? m[2] : m[2].slice(0, end);
  const rest = end < 0 ? "" : m[2].slice(end);
  const at = authority.lastIndexOf("@");
  return { scheme, userinfo: at < 0 ? null : authority.slice(0, at), hostlist: at < 0 ? authority : authority.slice(at + 1), rest };
}

export function parseDbUrl(value: string): { scheme: string; hosts: DbHost[] } {
  const { scheme, hostlist, rest } = splitUrl(value);
  if (/[?&](host|hostaddr)=/i.test(rest)) {
    throw new TargetError("paramètre host/hostaddr non pris en charge : mettez l'hôte dans l'URL");
  }
  if (!hostlist) throw new TargetError("l'URL de la base n'a pas d'hôte (socket Unix non pris en charge)");
  const hosts = hostlist.split(",").map((entry): DbHost => {
    if (entry.startsWith("[") || isIPv6(entry)) throw new TargetError("adresse IPv6 non prise en charge : utilisez un nom ou une IPv4");
    const colon = entry.lastIndexOf(":");
    const host = (colon < 0 ? entry : entry.slice(0, colon)).toLowerCase();
    const portText = colon < 0 ? null : entry.slice(colon + 1);
    if (!HOSTNAME.test(host)) throw new TargetError("hôte invalide dans l'URL de la base");
    if (portText === null && scheme === "mongodb+srv") return { host, port: 0 };
    const port = portText === null ? DEFAULT_PORTS[scheme] : Number(portText);
    if (port === undefined) throw new TargetError(`port obligatoire pour le protocole ${scheme}`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TargetError("port invalide dans l'URL de la base");
    return { host, port };
  });
  if (scheme === "mongodb+srv" && (hosts.length !== 1 || hosts[0].port !== 0)) {
    throw new TargetError("mongodb+srv : un seul hôte, sans port");
  }
  return { scheme, hosts };
}

function assertRoutable(ip: string): void {
  if (ip.startsWith("127.") || ip === "0.0.0.0") throw new TargetError("la base pointe vers une adresse locale : refusé");
}

async function resolveHost(h: DbHost, resolver: Resolver): Promise<Target> {
  if (isIPv4(h.host)) {
    assertRoutable(h.host);
    return { host: null, ip: h.host, port: h.port };
  }
  let ip: string;
  try {
    ip = await resolver.lookup4(h.host);
  } catch {
    throw new TargetError(`impossible de résoudre ${h.host} (IPv4)`);
  }
  assertRoutable(ip);
  return { host: h.host, ip, port: h.port };
}

// mongodb+srv:// demande des requêtes DNS SRV et TXT que la sandbox ne peut pas faire : le runner les fait avant
// le run et donne au script l'URL mongodb:// équivalente (règles de la spécification « Initial DNS Seedlist Discovery »).
async function expandSrv(value: string, host: string, resolver: Resolver): Promise<{ url: string; hosts: DbHost[] }> {
  const { userinfo, rest } = splitUrl(value);
  const parent = host.split(".").slice(1).join(".");
  if (!parent.includes(".")) throw new TargetError("mongodb+srv : l'hôte doit avoir au moins trois parties (cluster.domaine.tld)");
  let records: Array<{ name: string; port: number }>;
  try {
    records = await resolver.resolveSrv(`_mongodb._tcp.${host}`);
  } catch {
    throw new TargetError(`mongodb+srv : enregistrement SRV introuvable pour ${host}`);
  }
  if (records.length === 0) throw new TargetError(`mongodb+srv : enregistrement SRV introuvable pour ${host}`);
  const hosts = records.map((r) => {
    const name = r.name.replace(/\.$/, "").toLowerCase();
    if (!name.endsWith(`.${parent}`) || !HOSTNAME.test(name)) throw new TargetError("mongodb+srv : enregistrement SRV hors du domaine de l'URL");
    return { host: name, port: r.port };
  });

  const params = new URLSearchParams();
  let txt: string[][] = [];
  try {
    txt = await resolver.resolveTxt(host);
  } catch {
    // TXT facultatif.
  }
  if (txt.length > 1) throw new TargetError("mongodb+srv : plusieurs enregistrements TXT");
  for (const [k, v] of new URLSearchParams(txt[0]?.join("") ?? "")) {
    if (["authSource", "replicaSet", "loadBalanced"].includes(k)) params.set(k, v);
  }
  const q = rest.indexOf("?");
  const path = q < 0 ? rest : rest.slice(0, q);
  for (const [k, v] of new URLSearchParams(q < 0 ? "" : rest.slice(q + 1))) params.set(k, v);
  if (!params.has("tls") && !params.has("ssl")) params.set("tls", "true");

  const auth = userinfo === null ? "" : `${userinfo}@`;
  const url = `mongodb://${auth}${hosts.map((h) => `${h.host}:${h.port}`).join(",")}${path || "/"}?${params}`;
  return { url, hosts };
}

// Renvoie l'URL à donner au script (identique, sauf mongodb+srv) et les destinations IPv4 autorisées.
// Les IP sont figées ici : le script ne peut pas obtenir une autre réponse DNS pendant le run.
export async function resolveTargets(value: string, resolver: Resolver = systemResolver): Promise<{ url: string; targets: Target[] }> {
  const parsed = parseDbUrl(value);
  let url = value;
  let hosts = parsed.hosts;
  if (parsed.scheme === "mongodb+srv") ({ url, hosts } = await expandSrv(value, parsed.hosts[0].host, resolver));
  const targets: Target[] = [];
  for (const h of hosts) {
    const t = await resolveHost(h, resolver);
    if (!targets.some((x) => x.ip === t.ip && x.port === t.port && x.host === t.host)) targets.push(t);
  }
  return { url, targets };
}
