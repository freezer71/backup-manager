import Link from "next/link";
import { EmptyState, PageHeader } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listProjects } from "@/lib/repo/projects";
import { listRecentBackups } from "@/lib/stats";
import { relativeTime } from "@/lib/time";
import { formatBytes, NasStatusText } from "@/app/(app)/status";

export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  await requireSession();
  const db = getDb();
  const { tz } = loadConfig();
  const projects = listProjects(db);
  const raw = Number((await searchParams).project);
  const selected = projects.find((p) => p.id === raw) ?? null;
  const backups = listRecentBackups(db, { projectId: selected?.id ?? null, limit: 100 });
  const total = backups.reduce((n, b) => n + (b.sizeBytes ?? 0), 0);
  const fmt = (d: string) => new Date(d).toLocaleString("fr-FR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
  const filter = (active: boolean) => `rounded-md px-2.5 py-1 text-[13px] transition-colors ${active ? "bg-raised text-fg" : "text-muted hover:text-fg"}`;

  return (
    <>
      <PageHeader title="Backups" subtitle={`${backups.length} ${backups.length > 1 ? "backups" : "backup"} · ${formatBytes(total)}`} />

      <nav aria-label="Filtrer par projet" className="-mt-4 flex flex-wrap gap-1">
        <Link href="/backups" className={filter(selected === null)}>Tous</Link>
        {projects.map((p) => (
          <Link key={p.id} href={`/backups?project=${p.id}`} className={filter(selected?.id === p.id)}>{p.name}</Link>
        ))}
      </nav>

      <div className="panel overflow-x-auto">
        {backups.length === 0 ? (
          <EmptyState title="Aucun backup disponible">Lancez un projet pour voir ses backups ici.</EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Projet</th><th>Taille</th><th>NAS</th><th>Fichiers</th></tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.runId} className="align-top">
                  <td className="whitespace-nowrap">
                    <Link href={`/projects/${b.projectId}/runs/${b.runId}`} className="link">{fmt(b.finishedAt)}</Link>
                    <div className="text-[13px] text-muted">{relativeTime(b.finishedAt)}</div>
                  </td>
                  <td><Link href={`/projects/${b.projectId}`} className="link">{b.projectName}</Link></td>
                  <td className="whitespace-nowrap">{formatBytes(b.sizeBytes)}</td>
                  <td><NasStatusText status={b.nasStatus} /></td>
                  <td>
                    <ul className="flex flex-col gap-1">
                      {b.files.map((f, i) => (
                        <li key={f}>
                          <a href={`/api/runs/${b.runId}/files/${i}`} download className="mono inline-flex items-baseline gap-2 break-all text-fg hover:underline underline-offset-4">
                            {f}
                            <span aria-hidden className="text-muted">↓</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {backups.length === 100 && <p className="text-[13px] text-muted">Seuls les 100 derniers backups sont affichés.</p>}
    </>
  );
}
