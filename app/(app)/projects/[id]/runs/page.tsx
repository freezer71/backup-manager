import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBytes, formatDuration, NasStatusText, StatusBadge } from "@/app/(app)/status";
import { EmptyState } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getProject } from "@/lib/repo/projects";
import { countRuns, listRuns } from "@/lib/repo/runs";
import { relativeTime } from "@/lib/time";
import { ProjectHeader } from "../ProjectHeader";

const PAGE_SIZE = 50;

function durationMs(started: string, finished: string | null): number | null {
  return finished ? new Date(finished).getTime() - new Date(started).getTime() : null;
}

export default async function ProjectRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireSession();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id)) notFound();
  const db = getDb();
  const project = getProject(db, id);
  if (!project) notFound();
  const { tz } = loadConfig();
  const pages = Math.max(1, Math.ceil(countRuns(db, id) / PAGE_SIZE));
  const requested = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const runs = listRuns(db, id, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const fmt = (d: string) => new Date(d).toLocaleString("fr-FR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
  const pageHref = (p: number) => (p === 1 ? `/projects/${id}/runs` : `/projects/${id}/runs?page=${p}`);

  return (
    <>
      <ProjectHeader db={db} project={project} />

      <div className="flex flex-col gap-3">
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
                      <span className="ml-2 text-[13px] text-muted">{relativeTime(r.started_at)}</span>
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
        {pages > 1 && (
          <nav aria-label="Pages de l'historique" className="flex items-center justify-between text-[13px] text-muted">
            {page > 1 ? <Link href={pageHref(page - 1)} className="link">← Plus récents</Link> : <span />}
            <span>Page {page} sur {pages}</span>
            {page < pages ? <Link href={pageHref(page + 1)} className="link">Plus anciens →</Link> : <span />}
          </nav>
        )}
      </div>
    </>
  );
}
