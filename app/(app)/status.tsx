import { Status, type Tone } from "@/app/components/ui";
import type { NasStatus, RunStatus } from "@/lib/repo/runs";

const LABELS: Record<RunStatus, [string, Tone]> = {
  running: ["en cours", "run"],
  success: ["réussi", "ok"],
  failed: ["échec", "bad"],
  timeout: ["timeout", "bad"],
  interrupted: ["interrompu", "warn"],
  skipped: ["ignoré", "idle"],
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const [label, tone] = LABELS[status];
  return <Status tone={tone} testId="run-status">{label}</Status>;
}

const NAS_LABELS: Record<NasStatus, string> = { "n/a": "sans objet", ok: "copié", failed: "échec" };

export function nasLabel(status: NasStatus): string {
  return NAS_LABELS[status];
}

// Copie NAS : texte simple, en couleur seulement en cas d'échec.
export function NasStatusText({ status }: { status: NasStatus }) {
  return <span className={status === "failed" ? "text-warn" : status === "n/a" ? "text-faint" : "text-muted"}>{nasLabel(status)}</span>;
}

export function formatBytes(n: number | null): string {
  if (n === null) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1).replace(".", ",")} ${units[i]}`;
}

// 850 → « 850 ms », 4200 → « 4,2 s », 65000 → « 1 min 05 s », 3_720_000 → « 1 h 02 min ».
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}
