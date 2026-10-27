import { StatusBadge } from "@/app/(app)/status";
import { SubmitButton } from "@/app/components/SubmitButton";
import { PageHeader } from "@/app/components/ui";
import { loadConfig } from "@/lib/config";
import { describeCron, nextRuns } from "@/lib/cron";
import type { DB } from "@/lib/db";
import { DB_KINDS } from "@/lib/dumps";
import type { Project } from "@/lib/repo/projects";
import { countRuns, lastRun } from "@/lib/repo/runs";
import { relativeTime } from "@/lib/time";
import { runNowAction } from "../actions";
import { ProjectTabs } from "./ProjectTabs";

// En-tête commun à la configuration et à l'historique : résumé, dernier backup, lancement manuel, onglets.
export function ProjectHeader({ db, project }: { db: DB; project: Project }) {
  const { tz } = loadConfig();
  const upcoming = project.enabled ? nextRuns(project.cron, 1, tz) : [];
  const last = lastRun(db, project.id);
  const fmt = (d: Date) => d.toLocaleString("fr-FR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <PageHeader
        back={{ href: "/", label: "Tableau de bord" }}
        title={project.name}
        subtitle={
          <div className="flex flex-col gap-1">
            <span>
              {DB_KINDS[project.db_kind].label} · {project.enabled ? describeCron(project.cron) : "planification désactivée"}
              {upcoming.length > 0 && <> · prochain : {fmt(upcoming[0])}</>}
              {!project.has_db_url && <span className="text-warn"> · URL de connexion manquante</span>}
            </span>
            {last && (
              <span className="flex items-center gap-2 text-[13px]">
                Dernier backup : <StatusBadge status={last.status} /> {relativeTime(last.started_at)}
              </span>
            )}
          </div>
        }
        actions={
          <form action={runNowAction.bind(null, project.id)}>
            <SubmitButton>Lancer maintenant</SubmitButton>
          </form>
        }
      />
      <ProjectTabs projectId={project.id} runCount={countRuns(db, project.id)} />
    </>
  );
}
