import { PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { getDb } from "@/lib/db";
import { listEnvironments } from "@/lib/repo/environments";
import { createProjectAction } from "../actions";
import { ProjectForm } from "../ProjectForm";

export default async function NewProjectPage() {
  await requireSession();
  const environments = listEnvironments(getDb()).map(({ id, name }) => ({ id, name }));
  return (
    <>
      <PageHeader back={{ href: "/", label: "Tableau de bord" }} title="Nouveau projet" subtitle="Un projet = un script bash planifié, avec ses secrets, sa rétention et sa copie NAS." />
      <Section>
        <ProjectForm action={createProjectAction} environments={environments} submitLabel="Créer le projet" />
      </Section>
    </>
  );
}
