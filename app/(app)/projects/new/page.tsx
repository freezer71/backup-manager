import { PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { createProjectAction } from "../actions";
import { ProjectForm } from "../ProjectForm";

export default async function NewProjectPage() {
  await requireSession();
  return (
    <>
      <PageHeader back={{ href: "/", label: "Tableau de bord" }} title="Nouveau projet" subtitle="Un projet = une base de données à sauvegarder, avec sa planification, sa rétention et sa copie NAS." />
      <Section>
        <ProjectForm action={createProjectAction} submitLabel="Créer le projet" />
      </Section>
    </>
  );
}
