import { PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listAudit } from "@/lib/repo/audit";
import { getSetting } from "@/lib/repo/settings";
import { PasswordForm, ResetTotpForm, WebhookForm } from "./forms";

export default async function SettingsPage() {
  await requireSession();
  const db = getDb();
  const { tz } = loadConfig();
  const entries = listAudit(db, 100);

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
        <Section title="Double authentification">
          <ResetTotpForm />
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
