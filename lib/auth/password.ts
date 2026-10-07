import { hash, verify } from "@node-rs/argon2";

export function hashPassword(pw: string): Promise<string> {
  return hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, pw: string): Promise<boolean> {
  try {
    return await verify(passwordHash, pw);
  } catch {
    return false;
  }
}
