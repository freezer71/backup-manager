import QRCode from "qrcode";
import { PageHeader, Section } from "@/app/components/ui";
import { currentSession, requireSession } from "@/lib/auth/next-session";
import { listSessions } from "@/lib/auth/session";
import { newTotpSecret, totpUri } from "@/lib/auth/totp";
import { listTrustedDevices } from "@/lib/auth/trusted-device";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listAudit } from "@/lib/repo/audit";
import { getSetting } from "@/lib/repo/settings";
import { getUser } from "@/lib/repo/user";
import { webhookLabel, webhookUrlProblem } from "@/lib/runner/notify";
import { revokeDeviceAction, revokeSessionAction } from "./actions";
import { PasswordForm, ReplaceTotpForm, RevokeButton, WebhookForm } from "./forms";

export default async function SettingsPage() {
  await requireSession();
  const db = getDb();
  const { tz } = loadConfig();
  const entries = listAudit(db, 100);
  // Un secret neuf à chaque affichage, jamais stocké : il ne vit que dans ce formulaire jusqu'au remplacement.
  // Stocké, n'importe quelle session (volée comprise) pourrait le lire avant que le propriétaire ne le scanne.
  const newSecret = newTotpSecret();
  const qr = await QRCode.toDataURL(totpUri(getUser(db)?.email ?? "", newSecret));
  const webhook = getSetting(db, "webhook_url");
  const currentId = (await currentSession())?.session.id;
  const fmt = (d: string) => new Date(d).toLocaleString("fr-FR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <PageHeader title="Paramètres" subtitle="Notifications, sécurité du compte et journal d'audit." />
      <Section title="Notifications d'échec" description="Un webhook (ntfy, Discord…) appelé quand un backup ou une copie NAS échoue.">
        <WebhookForm current={webhook ? webhookLabel(webhook) : null} problem={webhook ? webhookUrlProblem(webhook) : null} />
      </Section>
      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Mot de passe">
          <PasswordForm />
        </Section>
        <Section
          title="Double authentification"
          description="Pour changer de téléphone : scannez ce QR code avec la nouvelle application. L'actuelle reste valable jusqu'à la validation."
        >
          <ReplaceTotpForm qr={qr} secret={newSecret} />
        </Section>
      </div>
      <Section title="Sessions ouvertes" description="Une session expire après 4 h d'inactivité, et au plus tard 7 jours après la connexion." panel={false}>
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Dernière activité</th><th>Ouverte le</th><th>IP</th><th>Navigateur</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {listSessions(db).map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap">{fmt(s.last_seen_at)}{s.id === currentId && <span className="ml-2 text-muted">(celle-ci)</span>}</td>
                  <td className="whitespace-nowrap text-muted">{fmt(s.created_at)}</td>
                  <td className="mono text-muted">{s.ip}</td>
                  <td className="max-w-xs truncate text-muted">{s.user_agent}</td>
                  <td className="text-right"><RevokeButton action={revokeSessionAction.bind(null, s.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Appareils de confiance" description="Navigateurs déjà connectés en entier : ils échappent aux limites globales de connexion (pas à celle de leur IP)." panel={false}>
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Dernier usage</th><th>Ajouté le</th><th>Navigateur</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {listTrustedDevices(db).map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap">{fmt(d.last_used_at)}</td>
                  <td className="whitespace-nowrap text-muted">{fmt(d.created_at)}</td>
                  <td className="max-w-xs truncate text-muted">{d.user_agent}</td>
                  <td className="text-right"><RevokeButton action={revokeDeviceAction.bind(null, d.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Journal d'audit" panel={false}>
        <div className="panel max-h-[32rem] overflow-auto">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Action</th><th>Cible</th><th>IP</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-muted">{new Date(e.at).toLocaleString("fr-FR", { timeZone: tz })}</td>
                  <td className="mono">{e.action}</td>
                  <td className="break-all">{e.target}</td>
                  <td className="mono text-muted">{e.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
