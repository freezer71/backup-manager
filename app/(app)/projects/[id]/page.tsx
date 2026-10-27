import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBytes, formatDuration, NasStatusText, StatusBadge } from "@/app/(app)/status";
import { SubmitButton } from "@/app/components/SubmitButton";
import { EmptyState, PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { loadConfig } from "@/lib/config";
import { describeCron, nextRuns } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { dbUrlLabel } from "@/lib/db-url";
import { DB_KINDS } from "@/lib/dumps";
import { getProject, getProjectDbUrl } from "@/lib/repo/projects";
import { listRuns } from "@/lib/repo/runs";
import { relativeTime } from "@/lib/time";
import { deleteProjectAction, revealDbUrlAction, runNowAction, updateProjectAction } from "../actions";
import { DeleteProjectForm } from "../DeleteProjectForm";
import { ProjectForm } from "../ProjectForm";

function durationMs(started: string, finished: string | null): number | null {
  return finished ? new Date(finished).getTime() - new Date(started).getTime() : null;
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const id = Number((await params).id);
  const db = getDb();
  const project = getProject(db, id);
  if (!project) notFound();
  const { tz } = loadConfig();
  const runs = listRuns(db, id);
  const url = getProjectDbUrl(db, id);
  const upcoming = project.enabled ? nextRuns(project.cron, 3, tz) : [];
  const fmt = (d: Date | string) => new Date(d).toLocaleString("fr-FR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <PageHeader
        back={{ href: "/", label: "Tableau de bord" }}
        title={project.name}
        subtitle={
          <>
            {project.enabled ? describeCron(project.cron) : "Planification désactivée"}
            {" · "}{DB_KINDS[project.db_kind].label}{!url && <span className="text-warn"> · URL de connexion manquante</span>}
            {upcoming.length > 0 && <> · prochaines exécutions : {upcoming.map((d) => fmt(d)).join(", ")}</>}
          </>
        }
        actions={
          <form action={runNowAction.bind(null, id)}>
            <SubmitButton>Lancer maintenant</SubmitButton>
          </form>
        }
      />

      <Section title="Historique" panel={false}>
        <div className="panel overflow-x-auto">
          {runs.length === 0 ? (
            <EmptyState title="Aucune exécution">Cliquez sur « Lancer maintenant » pour faire un premier backup.</EmptyState>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Début</th><th>Déclencheur</th><th>Statut</th><th>Durée</th><th>Taille</th><th>NAS</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/projects/${id}/runs/${r.id}`} className="link">{fmt(r.started_at)}</Link>
                      <div className="text-[13px] text-muted">{relativeTime(r.started_at)}</div>
                    </td>
                    <td className="text-muted">{r.trigger === "manual" ? "manuel" : "planifié"}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="whitespace-nowrap">{formatDuration(durationMs(r.started_at, r.finished_at))}</td>
                    <td className="whitespace-nowrap">{r.pruned ? <span className="text-muted">supprimé (rétention)</span> : formatBytes(r.size_bytes)}</td>
                    <td><NasStatusText status={r.nas_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

      <Section title="Configuration">
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
