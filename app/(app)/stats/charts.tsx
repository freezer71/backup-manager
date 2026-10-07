import type { DurationPoint } from "@/lib/stats";
import { formatDuration } from "@/app/(app)/status";

// Barre horizontale de proportion (0 à 100 %).
export function ShareBar({ percent, className = "bg-fg" }: { percent: number; className?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-line" role="presentation">
      <div className={`h-full ${className}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

const SCRIPT = "#ededed";
const NAS = "#8f8f8f";
const OTHER = "#3a3a3a";

// Une barre par backup : script, copie NAS, reste (déplacement, rétention), en niveaux de gris.
export function DurationBars({ series }: { series: DurationPoint[] }) {
  const W = 600;
  const H = 96;
  const max = Math.max(...series.map((p) => p.totalMs), 1);
  const slot = W / Math.max(series.length, 30);
  const bar = Math.max(2, slot * 0.55);
  const h = (ms: number) => (ms / max) * H;

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full border-b border-line" preserveAspectRatio="none" role="img" aria-label="Durée des derniers backups">
        {series.map((p, i) => {
          const x = i * slot + (slot - bar) / 2;
          const script = p.scriptMs ?? 0;
          const nas = p.nasMs ?? 0;
          const other = Math.max(0, p.totalMs - script - nas);
          let y = H;
          const parts: Array<[number, string]> = [
            [script, SCRIPT],
            [nas, NAS],
            [other, OTHER],
          ];
          return (
            <g key={p.runId}>
              <title>{`${new Date(p.finishedAt).toLocaleString("fr-FR")} — total ${formatDuration(p.totalMs)}, script ${formatDuration(p.scriptMs)}, NAS ${formatDuration(p.nasMs)}`}</title>
              {parts.map(([ms, color]) => {
                const height = h(ms);
                y -= height;
                return height > 0 ? <rect key={color} x={x} y={y} width={bar} height={height} fill={color} /> : null;
              })}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2" style={{ background: SCRIPT }} />script</span>
        <span className="flex items-center gap-1.5"><span className="size-2" style={{ background: NAS }} />copie NAS</span>
        <span className="flex items-center gap-1.5"><span className="size-2" style={{ background: OTHER }} />autre</span>
        <span className="ml-auto">max {formatDuration(max)}</span>
      </figcaption>
    </figure>
  );
}
