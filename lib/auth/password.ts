import { hash, verify } from "@node-rs/argon2";

// argon2id, 64 Mio, 3 passes : au-delà du minimum OWASP (19 Mio, 2 passes), le coût reste ~0,1 s par connexion,
// et les tentatives sont de toute façon limitées (rate-limit.ts).
const PARAMS = { memoryCost: 65536, timeCost: 3, parallelism: 1 };

export function hashPassword(pw: string): Promise<string> {
  return hash(pw, PARAMS);
}

export async function verifyPassword(passwordHash: string, pw: string): Promise<boolean> {
  try {
    return await verify(passwordHash, pw);
  } catch {
    return false;
  }
}

// Un haché créé avec d'autres paramètres est recalculé à la prochaine connexion réussie.
export function needsRehash(passwordHash: string): boolean {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
  return !m || Number(m[1]) !== PARAMS.memoryCost || Number(m[2]) !== PARAMS.timeCost || Number(m[3]) !== PARAMS.parallelism;
}
