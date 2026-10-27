import { DB_KINDS, type DbKind } from "@/lib/dumps";
import { parseDbUrl } from "@/lib/runner/targets";

// Serveur uniquement (targets.ts utilise node:dns) : le formulaire client n'importe que lib/dumps.ts.

// null si l'URL convient au type de base ; sinon la raison (jamais l'URL : elle contient le mot de passe).
export function dbUrlProblem(kind: DbKind, url: string): string | null {
  let scheme: string;
  try {
    scheme = parseDbUrl(url).scheme;
  } catch (e) {
    return `URL de connexion : ${e instanceof Error ? e.message : "invalide"}`;
  }
  const { label, schemes } = DB_KINDS[kind];
  return schemes.includes(scheme) ? null : `URL ${label} attendue (${schemes.map((s) => `${s}://`).join(" ou ")}…)`;
}

function isParsable(url: string): boolean {
  try {
    parseDbUrl(url);
    return true;
  } catch {
    return false;
  }
}

// Ce qui peut s'afficher d'une URL sans code 2FA : protocole, hôtes et base, sans identifiants ni paramètres.
// Découpage identique à targets.ts : l'hôte suit le dernier « @ » de l'autorité (un mot de passe peut en contenir).
export function dbUrlLabel(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([\s\S]*)$/i.exec(url.trim());
  // Une URL qui ne s'analyse pas (ex. « / » non encodé dans le mot de passe) ne s'affiche pas du tout.
  if (!m || !isParsable(url)) return "URL invalide";
  const end = m[2].search(/[/?#]/);
  const authority = end < 0 ? m[2] : m[2].slice(0, end);
  const path = end < 0 ? "" : m[2].slice(end).replace(/[?#][\s\S]*$/, "");
  const hosts = authority.slice(authority.lastIndexOf("@") + 1);
  // Un « @ » dans le chemin : mot de passe mal encodé, on n'affiche rien après l'hôte.
  return `${m[1].toLowerCase()}${hosts}${path.includes("@") ? "" : path}`;
}
