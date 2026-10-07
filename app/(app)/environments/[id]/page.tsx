import { notFound } from "next/navigation";
import { EmptyState, PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { getDb } from "@/lib/db";
import { getEnvironment, listSecretKeys } from "@/lib/repo/environments";
import { deleteEnvironmentAction, importDotenvAction, saveSecretAction, updateEnvironmentAction } from "../actions";
import { DeleteForm, EnvironmentForm, ImportForm, SecretForm } from "./forms";
import { SecretRow } from "./SecretRow";

export default async function EnvironmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) notFound();
  const db = getDb();
  const env = getEnvironment(db, id);
  if (!env) notFound();
  const secrets = listSecretKeys(db, id);

  return (
    <>
      <PageHeader back={{ href: "/environments", label: "Environnements" }} title={env.name} subtitle={env.description || `${secrets.length} ${secrets.length > 1 ? "secrets" : "secret"}`} />

      <Section title="Secrets" panel={false}>
        <div className="panel overflow-x-auto">
          {secrets.length === 0 ? (
            <EmptyState title="Aucun secret">Ajoutez-en un ou importez un fichier .env.</EmptyState>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Clé</th><th>Valeur</th><th>Modifié</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {secrets.map((s) => <SecretRow key={s.id} id={s.id} secretKey={s.key} updatedAt={s.updated_at} />)}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Ajouter ou modifier un secret">
          <SecretForm action={saveSecretAction.bind(null, id)} />
        </Section>
        <Section title="Importer un .env">
          <ImportForm action={importDotenvAction.bind(null, id)} />
        </Section>
      </div>

      <Section title="Renommer">
        <EnvironmentForm action={updateEnvironmentAction.bind(null, id)} submitLabel="Enregistrer" initial={env} />
      </Section>

      <Section title="Supprimer l'environnement" tone="danger">
        <DeleteForm action={deleteEnvironmentAction.bind(null, id)} label="Supprimer" confirmText="Je confirme la suppression de cet environnement et de ses secrets" />
      </Section>
    </>
  );
}
