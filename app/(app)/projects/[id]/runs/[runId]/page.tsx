import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/app/components/ui";
import { requireSession } from "@/lib/auth/next-session";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getProject } from "@/lib/repo/projects";
import { getRun } from "@/lib/repo/runs";
import { formatBytes, formatDuration, nasLabel, StatusBadge } from "@/app/(app)/status";
import { LiveLog } from "./LiveLog";

export default async function RunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  await requireSession();
  const { id, runId } = await params;
  const db = getDb();
  const run = getRun(db, Number(runId));
  const project = getProject(db, Number(id));
  if (!run || !project || run.project_id !== project.id) notFound();
  const { tz } = loadConfig();
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("fr-FR", { timeZone: tz, dateStyle: "short", timeStyle: "medium" }) : "—");
  const total = run.finished_at ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime() : null;

  const facts: Array<[string, React.ReactNode]> = [
    ["Statut", <StatusBadge key="s" status={run.status} />],
    ["Déclencheur", run.trigger === "manual" ? "manuel" : "planifié"],
    ["Début", fmt(run.started_at)],
    ["Fin", fmt(run.finished_at)],
    ["Durée", formatDuration(total)],
    ["Script", formatDuration(run.script_ms)],
    ["Taille", formatBytes(run.size_bytes)],
    ["Copie NAS", run.nas_ms === null ? nasLabel(run.nas_status) : `${nasLabel(run.nas_status)}, ${formatDuration(run.nas_ms)}`],
  ];

  return (
    <>
      <PageHeader back={{ href: `/projects/${project.id}`, label: project.name }} title={`Exécution #${run.id}`} />

      <dl className="panel grid grid-cols-2 gap-x-6 gap-y-4 p-4 md:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {run.nas_error && <p className="-mt-6 text-[13px] text-warn">{run.nas_error}</p>}

      {run.status === "success" && (
        <Section title="Fichiers">
          {run.pruned ? (
            <p className="text-muted">Supprimés par la rétention.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {run.files.map((f, i) => (
                <li key={f}>
                  <a href={`/api/runs/${run.id}/files/${i}`} download className="mono inline-flex items-baseline gap-2 break-all hover:underline underline-offset-4">
                    {f}
                    <span aria-hidden className="text-muted">↓</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Journal" panel={false}>
        <LiveLog runId={run.id} initialLog={run.log} running={run.status === "running"} />
      </Section>
    </>
  );
}
