import { DB_KINDS, type DbKind } from "@/lib/dumps";
import { parseDbUrl } from "@/lib/runner/targets";

// Serveur uniquement (targets.ts utilise node:dns) : le formulaire client n'importe que lib/dumps.ts.

// Partie de l'URL après l'hôte (chemin, paramètres). Un « @ » à cet endroit signale un mot de passe dont les
// caractères spéciaux (« / », « ? », « # ») ne sont pas encodés : l'hôte réel ne serait pas celui qu'on croit.
function afterAuthority(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([\s\S]*)$/i.exec(url.trim());
  if (!m) return null;
  const end = m[1].search(/[/?#]/);
  return end < 0 ? "" : m[1].slice(end);
}

// null si l'URL convient au type de base ; sinon la raison (jamais l'URL : elle contient le mot de passe).
export function dbUrlProblem(kind: DbKind, url: string): string | null {
  if (afterAuthority(url)?.includes("@")) {
    return "URL de connexion : encodez les caractères spéciaux du mot de passe (« / » en %2F, « ? » en %3F, « # » en %23, « @ » en %40)";
  }
  let scheme: string;
  try {
    scheme = parseDbUrl(url).scheme;
  } catch (e) {
    return `URL de connexion : ${e instanceof Error ? e.message : "invalide"}`;
  }
  const { label, schemes } = DB_KINDS[kind];
  return schemes.includes(scheme) ? null : `URL ${label} attendue (${schemes.map((s) => `${s}://`).join(" ou ")}…)`;
}

// Ce qui peut s'afficher d'une URL sans code 2FA : protocole, hôtes reconnus par l'analyseur et nom de la base.
// Rien n'est recopié de l'autorité brute (identifiants), ni des paramètres.
export function dbUrlLabel(url: string): string {
  const rest = afterAuthority(url);
  if (rest === null || rest.includes("@")) return "URL invalide";
  let parsed: ReturnType<typeof parseDbUrl>;
  try {
    parsed = parseDbUrl(url);
  } catch {
    return "URL invalide";
  }
  const hosts = parsed.hosts.map((h) => (h.port ? `${h.host}:${h.port}` : h.host)).join(",");
  const base = /^\/([A-Za-z0-9_.-]+)/.exec(rest)?.[1];
  return `${parsed.scheme}://${hosts}${base ? `/${base}` : ""}`;
}
