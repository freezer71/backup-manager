import QRCode from "qrcode";
import { PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { newTotpSecret, totpUri } from "@/lib/auth/totp";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listAudit } from "@/lib/repo/audit";
import { getSetting } from "@/lib/repo/settings";
import { getUser } from "@/lib/repo/user";
import { PasswordForm, ReplaceTotpForm, WebhookForm } from "./forms";

export default async function SettingsPage() {
  await requireSession();
  const db = getDb();
  const { tz } = loadConfig();
  const entries = listAudit(db, 100);
  // Un secret neuf à chaque affichage, jamais stocké : il ne vit que dans ce formulaire jusqu'au remplacement.
  // Stocké, n'importe quelle session (volée comprise) pourrait le lire avant que le propriétaire ne le scanne.
  const newSecret = newTotpSecret();
  const qr = await QRCode.toDataURL(totpUri(getUser(db)?.email ?? "", newSecret));

  return (
    <>
      <PageHeader title="Paramètres" subtitle="Notifications, sécurité du compte et journal d'audit." />
      <Section title="Notifications d'échec" description="Un webhook (ntfy, Discord…) appelé quand un backup ou une copie NAS échoue.">
        <WebhookForm current={getSetting(db, "webhook_url") ?? ""} />
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
