import { isIPv6 } from "node:net";
import type { DB } from "@/lib/db";

export type AttemptKind = "password" | "totp";

const WINDOW_MS = 15 * 60_000;
const FREE_FAILURES = 4;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;
const GLOBAL_FREE_FAILURES = 20;
const GLOBAL_BASE_DELAY_MS = 5_000;
const GLOBAL_MAX_DELAY_MS = 5 * 60_000;
// Limite globale douce du mot de passe : freine une attaque distribuée sans que le propriétaire attende plus de 30 s.
const PASSWORD_GLOBAL_FREE = 100;
const PASSWORD_GLOBAL_BASE_DELAY_MS = 2_000;
const PASSWORD_GLOBAL_MAX_DELAY_MS = 30_000;

// Clé de limitation : IPv4 inchangée, IPv4 mappée en IPv6 ramenée à l'IPv4, IPv6 réduite à son /64
// (un client IPv6 contrôle un /64 entier : limiter l'adresse exacte serait inutile).
export function rateLimitKey(ip: string): string {
  const clean = ip.split("%")[0].toLowerCase();
  if (!isIPv6(clean)) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(clean);
  if (mapped) return mapped[1];

  const toGroups = (part: string): string[] => {
    if (part === "") return [];
    const groups: string[] = [];
    for (const g of part.split(":")) {
      if (g.includes(".")) {
        const [a, b, c, d] = g.split(".").map(Number);
        groups.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
      } else {
        groups.push(g);
      }
    }
    return groups;
  };
  const [head, tail] = clean.includes("::") ? clean.split("::") : [clean, null];
  const headGroups = toGroups(head);
  const tailGroups = tail === null ? [] : toGroups(tail);
  const zeros = tail === null ? [] : Array<string>(8 - headGroups.length - tailGroups.length).fill("0");
  const full = [...headGroups, ...zeros, ...tailGroups];
  return `${full
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

type Row = { id: number; attempted_at: string; success: number; kind: AttemptKind };

// Échecs depuis la dernière réinitialisation (succès TOTP = connexion complète).
function failuresSinceReset(rows: Row[], kind: AttemptKind | null): { count: number; last: string | null } {
  let count = 0;
  let last: string | null = null;
  for (const r of rows) {
    if (r.success && r.kind === "totp") {
      count = 0;
      last = null;
    } else if (!r.success && (kind === null || r.kind === kind)) {
      count++;
      last = r.attempted_at;
    }
  }
  return { count, last };
}

function remaining(count: number, free: number, base: number, max: number, last: string | null, now: Date): number {
  if (count <= free || !last) return 0;
  const wait = Math.min(base * 2 ** Math.min(count - free - 1, 20), max);
  return Math.max(0, new Date(last).getTime() + wait - now.getTime());
}

// `trusted` (appareil déjà connecté en entier) exempte des limites GLOBALES uniquement : la limite par clé reste appliquée.
export type AttemptOptions = { trusted?: boolean };

export function loginDelayMs(
  db: DB,
  ip: string,
  kind: AttemptKind,
  now: Date = new Date(),
  opts: AttemptOptions = {},
): number {
  const key = rateLimitKey(ip);
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const all = db
    .prepare("SELECT id, ip, attempted_at, success, kind FROM login_attempts WHERE attempted_at > ? ORDER BY id")
    .all(since) as Array<Row & { ip: string }>;

  const perKey = failuresSinceReset(
    all.filter((r) => r.ip === key),
    kind,
  );
  const keyDelay = remaining(perKey.count, FREE_FAILURES, BASE_DELAY_MS, MAX_DELAY_MS, perKey.last, now);

  // Limite globale TOTP (attaque distribuée sur 10^6 codes, mot de passe connu) : 20 / 5 s / 5 min.
  // Limite globale du mot de passe : seuil haut et plafond de 30 s, pour qu'un anonyme ne verrouille pas le propriétaire.
  let globalDelay = 0;
  if (kind === "password") {
    const global = failuresSinceReset(
      all.filter((r) => r.kind === "password" || r.success), // les succès TOTP remettent à zéro
      null,
    );
    // Exposant décalé de 1 : le premier échec au-delà du seuil coûte 2 s · 2 = 4 s.
    globalDelay = remaining(
      global.count,
      PASSWORD_GLOBAL_FREE,
      PASSWORD_GLOBAL_BASE_DELAY_MS * 2,
      PASSWORD_GLOBAL_MAX_DELAY_MS,
      global.last,
      now,
    );
  } else {
    const global = failuresSinceReset(
      all.filter((r) => r.kind === "totp"),
      null,
    );
    // Exposant décalé de 1 : le premier échec au-delà du seuil coûte 5 s · 2 = 10 s.
    globalDelay = remaining(global.count, GLOBAL_FREE_FAILURES, GLOBAL_BASE_DELAY_MS * 2, GLOBAL_MAX_DELAY_MS, global.last, now);
  }
  return Math.max(keyDelay, opts.trusted ? 0 : globalDelay);
}

// Réservation atomique (synchrone) : l'échec est inscrit AVANT tout travail asynchrone (argon2),
// donc des requêtes parallèles voient les tentatives déjà en cours. Le succès l'annule ensuite.
export function beginLoginAttempt(
  db: DB,
  ip: string,
  kind: AttemptKind,
  now: Date = new Date(),
  opts: AttemptOptions = {},
): { allowed: true; attemptId: number } | { allowed: false; retryAfterMs: number } {
  return db.transaction(() => {
    db.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").run(
      new Date(now.getTime() - 86_400_000).toISOString(),
    );
    const retryAfterMs = loginDelayMs(db, ip, kind, now, opts);
    if (retryAfterMs > 0) return { allowed: false as const, retryAfterMs };
    const info = db
      .prepare("INSERT INTO login_attempts (ip, attempted_at, success, kind) VALUES (?, ?, 0, ?)")
      .run(rateLimitKey(ip), now.toISOString(), kind);
    return { allowed: true as const, attemptId: Number(info.lastInsertRowid) };
  })();
}

export function markAttemptSuccess(db: DB, attemptId: number): void {
  db.prepare("UPDATE login_attempts SET success = 1 WHERE id = ?").run(attemptId);
}
