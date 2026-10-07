import Link from "next/link";
import { EmptyState, PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { getDb } from "@/lib/db";
import { listEnvironments } from "@/lib/repo/environments";
import { createEnvironmentAction } from "./actions";
import { EnvironmentForm } from "./[id]/forms";

export default async function EnvironmentsPage() {
  await requireSession();
  const envs = listEnvironments(getDb());
  return (
    <>
      <PageHeader title="Environnements" subtitle="Les secrets sont chiffrés en base et transmis aux scripts comme variables d'environnement." />

      <div className="panel overflow-x-auto">
        {envs.length === 0 ? (
          <EmptyState title="Aucun environnement">Créez-en un ci-dessous pour y ranger vos secrets.</EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Nom</th><th>Secrets</th><th>Description</th></tr>
            </thead>
            <tbody>
              {envs.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/environments/${e.id}`} className="link font-medium">{e.name}</Link></td>
                  <td className="text-muted">{e.secret_count}</td>
                  <td className="text-muted">{e.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Section title="Nouvel environnement">
        <EnvironmentForm action={createEnvironmentAction} submitLabel="Créer" />
      </Section>
    </>
  );
}
