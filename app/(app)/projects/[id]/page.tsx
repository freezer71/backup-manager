import { notFound } from "next/navigation";
import { Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { getDb } from "@/lib/db";
import { dbUrlLabel } from "@/lib/db-url";
import { getProject, getProjectDbUrl } from "@/lib/repo/projects";
import { deleteProjectAction, revealDbUrlAction, updateProjectAction } from "../actions";
import { DeleteProjectForm } from "../DeleteProjectForm";
import { ProjectForm } from "../ProjectForm";
import { ProjectHeader } from "./ProjectHeader";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) notFound();
  const db = getDb();
  const project = getProject(db, id);
  if (!project) notFound();
  const url = getProjectDbUrl(db, id);

  return (
    <>
      <ProjectHeader db={db} project={project} />

      <Section>
        <ProjectForm
          action={updateProjectAction.bind(null, id)}
          project={project}
          savedUrlLabel={url ? dbUrlLabel(url) : null}
          revealUrl={revealDbUrlAction.bind(null, id)}
          submitLabel="Enregistrer"
        />
      </Section>

      <Section title="Supprimer le projet" tone="danger">
        <DeleteProjectForm action={deleteProjectAction.bind(null, id)} />
      </Section>
    </>
  );
}
