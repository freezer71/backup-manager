export const MASK = "••••";
const MIN_LENGTH = 4;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function makeMasker(values: string[]): (text: string) => string {
  const needles = new Set<string>();
  const add = (v: string) => {
    if (v.length >= MIN_LENGTH) needles.add(v);
  };
  for (const v of values) {
    add(v);
    add(v.trim());
    // Le flux est découpé ligne par ligne avant masquage : chaque ligne d'un secret multi-lignes (PEM…) doit être masquée seule.
    for (const fragment of v.split(/\r?\n/)) add(fragment.trim());
    add(encodeURIComponent(v));
    try {
      const url = new URL(v);
      if (url.password) {
        add(url.password);
        add(decodeURIComponent(url.password));
      }
    } catch {
      // pas une URL
    }
  }
  if (needles.size === 0) return (t) => t;
  const re = new RegExp(
    [...needles].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"),
    "g",
  );
  return (t) => t.replace(re, MASK);
}
