import { loadConfig } from "@/lib/config";
import type { DB } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { getSetting } from "@/lib/repo/settings";
import { sendNotification } from "@/lib/runner/notify";

// Événements qui déclenchent une alerte sur le webhook, en plus du journal d'audit : ce qui donne accès aux bases
// sauvegardées ou au compte. Si ce n'est pas vous, vous le savez tout de suite (et pas au prochain passage dans le journal).
const ALERTS: Record<string, string> = {
  "device.trusted": "connexion complète depuis un nouvel appareil",
  "password.change": "mot de passe changé",
  "totp.replaced": "application 2FA remplacée",
  "webhook.update": "webhook modifié",
  "db_url.reveal": "URL de connexion affichée",
  "db_url.update": "URL de connexion ou type de base modifiés",
  "project.create": "projet créé",
  "project.delete": "projet supprimé",
  "backup.download": "backup téléchargé",
};

export function isAlerted(action: string): boolean {
  return action in ALERTS;
}

// Journalise, puis alerte sans attendre (une alerte en échec ne bloque jamais l'action).
// `extraUrls` : destinataires supplémentaires (l'ancien webhook quand il est remplacé).
export function securityEvent(db: DB, action: string, target: string | null, ip: string | null, extraUrls: string[] = []): void {
  audit(db, action, target, ip);
  const label = ALERTS[action];
  if (!label) return;
  const urls = [...new Set([getSetting(db, "webhook_url"), ...extraUrls].filter((u): u is string => !!u))];
  if (urls.length === 0) return;
  const { appUrl } = loadConfig();
  const message = `${label}${target ? ` : ${target}` : ""} (IP ${ip ?? "inconnue"})`;
  for (const url of urls) {
    sendNotification(url, { project: "sécurité", status: action, message, runUrl: `${appUrl}/settings` }).catch((e: unknown) =>
      console.error(`[sécurité] alerte ${action} non envoyée : ${e instanceof Error ? e.message : "erreur inconnue"}`),
    );
  }
}
