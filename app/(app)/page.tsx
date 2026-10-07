import Link from "next/link";
import { EmptyState, PageHeader, Stats, Status, type Tone } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { loadConfig } from "@/lib/config";
import { describeCron, nextRuns } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { projectHealth, type Health } from "@/lib/health";
import { listProjects } from "@/lib/repo/projects";
import { lastRun, lastSuccessfulRun } from "@/lib/repo/runs";
import { isNasReady } from "@/lib/runner/storage";
import { daysAgoIso, diskUsage, reliabilityStats, storageByProject } from "@/lib/stats";
import { relativeTime } from "@/lib/time";
import { formatBytes, NasStatusText } from "@/app/(app)/status";

const HEALTH: Record<Health, [string, Tone]> = {
  ok: ["OK", "ok"],
  running: ["En cours", "run"],
  stuck: ["Bloqué", "bad"],
  never: ["Jamais exécuté", "idle"],
  disabled: ["Désactivé", "idle"],
  failing: ["En échec", "bad"],
  stale: ["Aucun succès récent", "bad"],
  nas_warning: ["Copie NAS en échec", "warn"],
};

export default async function DashboardPage() {
  await requireSession();
  const db = getDb();
  const cfg = loadConfig();
  const fmt = (d: Date | string) => new Date(d).toLocaleString("fr-FR", { timeZone: cfg.tz, dateStyle: "short", timeStyle: "short" });

  const rows = listProjects(db).map((p) => {
    const last = lastRun(db, p.id);
    const success = lastSuccessfulRun(db, p.id);
    return { p, success, health: projectHealth(p, last, success, cfg.tz), next: p.enabled ? nextRuns(p.cron, 1, cfg.tz)[0] : null };
  });
  const alerts = rows.filter((r) => ["stuck", "failing", "stale", "nas_warning"].includes(r.health));

  const storage = storageByProject(db);
  const reliability = reliabilityStats(db, daysAgoIso(30));
  const totals = reliability.projects.reduce((acc, p) => ({ total: acc.total + p.total, success: acc.success + p.success }), { total: 0, success: 0 });
  const successRate = totals.total === 0 ? null : Math.round((totals.success / totals.total) * 1000) / 10;
  const nasReady = await isNasReady(cfg.nasDir);
  const nasDisk = nasReady ? await diskUsage(cfg.nasDir) : null;
  const upcoming = rows.filter((r) => r.next).sort((a, b) => a.next!.getTime() - b.next!.getTime())[0];

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle={rows.length === 0 ? "Aucun projet pour l'instant." : `${rows.length} ${rows.length > 1 ? "projets" : "projet"}`}
        actions={
          <>
            <Link href="/backups" className="btn btn-secondary">Tous les backups</Link>
            <Link href="/projects/new" className="btn btn-primary">Nouveau projet</Link>
          </>
        }
      />

      {alerts.length > 0 && (
        <div role="alert" className="panel border-bad/40 px-4 py-3 text-bad">
          {alerts.map((a) => a.p.name).join(", ")} {alerts.length > 1 ? "demandent" : "demande"} votre attention.
        </div>
      )}

      <Stats
        items={[
          { label: "Stockage", value: formatBytes(storage.totalBytes), hint: `${storage.projects.reduce((n, p) => n + p.count, 0)} conservés` },
          {
            label: "Réussite sur 30 jours",
            value: successRate === null ? "—" : `${successRate.toString().replace(".", ",")} %`,
            hint: `${totals.success} sur ${totals.total}`,
          },
          {
            label: "NAS",
            value: nasReady ? "Monté" : <span className="text-warn">Absent</span>,
            hint: nasDisk ? `${formatBytes(nasDisk.freeBytes)} libres` : "Copies NAS impossibles",
          },
          {
            label: "Prochain backup",
            value: upcoming?.next ? relativeTime(upcoming.next) : "—",
            hint: upcoming?.next ? `${upcoming.p.name}, ${fmt(upcoming.next)}` : "Aucune planification active",
          },
        ]}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-medium">Projets</h2>
        <div className="panel overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState title="Aucun projet">Créez un environnement de secrets, puis un projet.</EmptyState>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Projet</th><th>État</th><th>Dernier succès</th><th>Taille</th><th>NAS</th><th>Prochain</th><th><span className="sr-only">Télécharger</span></th></tr>
              </thead>
              <tbody>
                {rows.map(({ p, success, health, next }) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projects/${p.id}`} className="link font-medium">{p.name}</Link>
                      <div className="text-[13px] text-muted">{describeCron(p.cron)}</div>
                    </td>
                    <td><Status tone={HEALTH[health][1]}>{HEALTH[health][0]}</Status></td>
                    <td className="whitespace-nowrap">
                      {success?.finished_at ? (
                        <span title={fmt(success.finished_at)}>{relativeTime(success.finished_at)}</span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{success ? formatBytes(success.size_bytes) : <span className="text-faint">—</span>}</td>
                    <td>{success ? <NasStatusText status={success.nas_status} /> : <span className="text-faint">—</span>}</td>
                    <td className="whitespace-nowrap text-muted">{next ? fmt(next) : "—"}</td>
                    <td className="text-right">
                      {success && !success.pruned && success.files.length > 0 && (
                        <a
                          href={`/api/runs/${success.id}/files/0`}
                          download
                          title={success.files.length > 1 ? `Premier des ${success.files.length} fichiers — tous sur la page Backups` : success.files[0]}
                          className="btn btn-secondary"
                        >
                          Télécharger
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
