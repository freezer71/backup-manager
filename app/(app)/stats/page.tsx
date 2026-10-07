import Link from "next/link";
import path from "node:path";
import { PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listProjects } from "@/lib/repo/projects";
import { isNasReady } from "@/lib/runner/storage";
import { daysAgoIso, diskUsage, durationStats, reliabilityStats, storageByProject, type DiskUsage } from "@/lib/stats";
import { formatBytes, formatDuration, StatusBadge } from "@/app/(app)/status";
import { DurationBars, ShareBar } from "./charts";

const RELIABILITY_DAYS = 30;
const pct = (n: number) => `${n.toString().replace(".", ",")} %`;

function Disk({ title, usage, note }: { title: string; usage: DiskUsage | null; note?: string }) {
  const percent = usage ? (usage.usedBytes / usage.totalBytes) * 100 : 0;
  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-[13px] text-muted">{title}</h3>
      {usage ? (
        <>
          <ShareBar percent={percent} className={percent > 90 ? "bg-bad" : percent > 75 ? "bg-warn" : "bg-fg"} />
          <p>
            {formatBytes(usage.usedBytes)} utilisés sur {formatBytes(usage.totalBytes)} ({percent.toFixed(1).replace(".", ",")} %) — {formatBytes(usage.freeBytes)} libres
          </p>
        </>
      ) : (
        <p className="text-muted">Indisponible.</p>
      )}
      {note && <p className="text-[13px] text-muted">{note}</p>}
    </div>
  );
}

export default async function StatsPage() {
  await requireSession();
  const db = getDb();
  const cfg = loadConfig();
  const fmt = (d: string) => new Date(d).toLocaleString("fr-FR", { timeZone: cfg.tz, dateStyle: "short", timeStyle: "short" });

  const projects = listProjects(db);
  const storage = storageByProject(db);
  const reliability = reliabilityStats(db, daysAgoIso(RELIABILITY_DAYS));
  const durations = projects.map((p) => ({ project: p, stats: durationStats(db, p.id, 30) }));
  const [localDisk, nasReady] = await Promise.all([diskUsage(path.join(cfg.dataDir, "backups")), isNasReady(cfg.nasDir)]);
  const nasDisk = nasReady ? await diskUsage(cfg.nasDir) : null;

  return (
    <>
      <PageHeader title="Statistiques" subtitle="Espace occupé, durée des backups et fiabilité." />

      <Section title="Espace disque" panel={false}>
        <div className="panel grid md:grid-cols-2">
          <Disk title="Disque du serveur (backups locaux)" usage={localDisk} />
          <div className="border-t border-line md:border-t-0 md:border-l">
            <Disk title="NAS" usage={nasDisk} note={nasReady ? undefined : "NAS non monté ou fichier témoin absent."} />
          </div>
        </div>
        <div className="panel overflow-x-auto">
          <p className="px-3 pt-3 text-[13px] text-muted">Répartition par projet — {formatBytes(storage.totalBytes)} de backups conservés</p>
          <table className="data-table min-w-[32rem]">
            <tbody>
              {storage.projects.map((p) => (
                <tr key={p.projectId}>
                  <td className="w-40"><Link href={`/projects/${p.projectId}`} className="link">{p.name}</Link></td>
                  <td className="min-w-32"><ShareBar percent={p.percent} /></td>
                  <td className="w-20 text-right">{pct(p.percent)}</td>
                  <td className="w-24 text-right text-muted">{formatBytes(p.bytes)}</td>
                  <td className="w-28 text-right text-muted">{p.count} {p.count > 1 ? "backups" : "backup"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Durée des backups"
        description="Les 30 derniers backups réussis. Le détail script et copie NAS est mesuré depuis l'ajout de cette page."
        panel={false}
      >
        <div className="panel divide-y divide-line">
          {durations.map(({ project, stats }) => (
            <div key={project.id} className="grid gap-4 p-4 md:grid-cols-[14rem_1fr]">
              <div className="flex flex-col gap-2">
                <Link href={`/projects/${project.id}`} className="link font-medium">{project.name}</Link>
                {stats.series.length === 0 ? (
                  <p className="text-muted">Pas encore de backup réussi.</p>
                ) : (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[13px]">
                    <dt className="text-muted">Dernier</dt><dd>{formatDuration(stats.total.last)}</dd>
                    <dt className="text-muted">Moyenne</dt><dd>{formatDuration(stats.total.avg)}</dd>
                    <dt className="text-muted">Maximum</dt><dd>{formatDuration(stats.total.max)}</dd>
                    <dt className="text-muted">Script</dt><dd>{formatDuration(stats.script.avg)} en moyenne</dd>
                    <dt className="text-muted">Copie NAS</dt><dd>{formatDuration(stats.nas.avg)} en moyenne</dd>
                  </dl>
                )}
              </div>
              {stats.series.length > 0 && <DurationBars series={stats.series} />}
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Fiabilité (${RELIABILITY_DAYS} derniers jours)`} panel={false}>
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[36rem]">
            <thead>
              <tr><th>Projet</th><th>Backups</th><th>Réussis</th><th>Échecs</th><th>Copies NAS en échec</th><th>Taux de réussite</th></tr>
            </thead>
            <tbody>
              {reliability.projects.map((p) => (
                <tr key={p.projectId}>
                  <td>{p.name}</td>
                  <td>{p.total}</td>
                  <td>{p.success}</td>
                  <td className={p.failed > 0 ? "text-bad" : "text-muted"}>{p.failed}</td>
                  <td className={p.nasFailed > 0 ? "text-warn" : "text-muted"}>{p.nasFailed}</td>
                  <td className={p.successRate !== null && p.successRate < 95 ? "text-bad" : ""}>{p.successRate === null ? "—" : pct(p.successRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reliability.recentFailures.length > 0 && (
          <div className="panel p-4">
            <h3 className="mb-2 text-[13px] text-muted">Derniers échecs</h3>
            <ul className="flex flex-col gap-1.5">
              {reliability.recentFailures.map((f) => (
                <li key={f.runId} className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={f.status} />
                  <Link href={`/projects/${f.projectId}/runs/${f.runId}`} className="link">{f.projectName}, {fmt(f.startedAt)}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </>
  );
}
