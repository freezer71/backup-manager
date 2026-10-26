import dns from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP, isIPv6, type LookupFunction } from "node:net";
import type { AppConfig } from "@/lib/config";
import type { DB } from "@/lib/db";
import { getSetting } from "@/lib/repo/settings";

export type NotifyPayload = { project: string; status: string; message: string; runUrl: string };

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

// Adresses jamais joignables par le webhook : l'application est sur dokploy-network, une URL interne ferait d'elle
// un relais vers les autres services (SSRF).
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96]] as const) {
  PRIVATE.addSubnet(net, bits, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(ip);
  if (!family) return false;
  return !PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

// null si l'URL est acceptable comme webhook ; sinon la raison (jamais l'URL elle-même : son jeton est un secret).
export function webhookUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "URL invalide";
  }
  if (u.protocol !== "https:") return "L'URL doit commencer par https://";
  if (u.username || u.password) return "Identifiants dans l'URL refusés (mettez le jeton dans le chemin)";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) return isPublicAddress(host) ? null : "Adresse privée ou locale refusée";
  if (host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) return "Adresse privée ou locale refusée";
  if (!host.includes(".")) return "Nom de domaine complet attendu (pas un nom de service interne)";
  return null;
}

// Ce qui peut s'afficher d'un webhook : l'hôte seulement, le chemin porte souvent le jeton.
export function webhookLabel(url: string): string {
  try {
    return `${new URL(url).host}/…`;
  } catch {
    return "URL invalide";
  }
}

// Transport du webhook : HTTPS uniquement, sans redirection, et l'IP réellement contactée est vérifiée à la connexion
// (un nom qui résout vers une adresse privée, même après coup, est refusé).
export function safeFetch(url: string, init: RequestInit, opts: { lookup?: (host: string) => Promise<string> } = {}): Promise<Response> {
  const problem = webhookUrlProblem(url);
  if (problem) return Promise.reject(new Error(problem));
  const resolve = opts.lookup ?? (async (host: string) => (await dns.lookup(host)).address);
  const lookup: LookupFunction = (hostname, options, callback) => {
    resolve(hostname).then(
      (address) => {
        if (!isPublicAddress(address)) return callback(new Error("Destination privée refusée"), "", 4);
        const family = isIPv6(address) ? 6 : 4;
        if (options.all) (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
        else callback(null, address, family);
      },
      (e: Error) => callback(e, "", 4),
    );
  };
  return new Promise((done, fail) => {
    const req = https.request(
      url,
      { method: init.method ?? "GET", headers: init.headers as Record<string, string>, lookup, signal: init.signal ?? undefined },
      (res) => {
        res.resume(); // corps ignoré
        res.on("end", () => done(new Response(null, { status: Math.max(200, res.statusCode ?? 500) })));
        res.on("error", fail);
      },
    );
    req.on("error", fail);
    req.end(typeof init.body === "string" ? init.body : undefined);
  });
}

export async function sendNotification(url: string, p: NotifyPayload, fetchImpl: Transport = safeFetch): Promise<void> {
  const text = `[Backup] ${p.project} : ${p.status} — ${p.message}\n${p.runUrl}`;
  const init: RequestInit = url.includes("ntfy")
    ? { method: "POST", body: text, headers: { Title: `Backup ${p.project}`, Tags: "warning" } }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...p, content: text }) };

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Jamais l'erreur brute : elle peut contenir l'URL du webhook, dont le jeton est un secret.
      lastError = new Error(
        e instanceof Error && e.name === "TimeoutError" ? "Délai dépassé" : `Échec réseau (${e instanceof Error ? e.name : "inconnu"})`,
      );
    }
  }
  throw lastError;
}

export async function notifyProblem(
  db: DB,
  cfg: AppConfig,
  input: { projectSlug: string; projectId: number; runId: number; status: string; message: string },
  send: typeof sendNotification = sendNotification,
): Promise<void> {
  const url = getSetting(db, "webhook_url");
  if (!url) return;
  try {
    await send(url, {
      project: input.projectSlug,
      status: input.status,
      message: input.message,
      runUrl: `${cfg.appUrl}/projects/${input.projectId}/runs/${input.runId}`,
    });
  } catch (e) {
    console.error(`[notify] échec de l'envoi pour le run ${input.runId} : ${e instanceof Error ? e.message : "erreur inconnue"}`);
  }
}
