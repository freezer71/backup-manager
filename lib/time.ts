// « il y a 3 min », « dans 2 h », « il y a 4 j » : durée relative lisible, en français.
export function relativeTime(iso: string | Date, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [86_400_000, "j"],
    [3_600_000, "h"],
    [60_000, "min"],
  ];
  if (abs < 60_000) return diff < 0 ? "à l'instant" : "dans moins d'une minute";
  const [size, label] = units.find(([u]) => abs >= u)!;
  const n = Math.floor(abs / size);
  return diff < 0 ? `il y a ${n} ${label}` : `dans ${n} ${label}`;
}
