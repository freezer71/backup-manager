import { generateSecret, generateURI, verifySync } from "otplib";

const STEP_S = 30;

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return generateURI({ issuer: "Backup Manager", label: email, secret });
}

export function checkTotp(
  secret: string,
  token: string,
  lastStep: number | null,
  now: Date = new Date(),
): { ok: true; step: number } | { ok: false } {
  const clean = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false };
  // L'heure est lue une seule fois : même instant pour la vérification et pour le garde anti-rejeu.
  const epoch = Math.floor(now.getTime() / 1000);
  const current = Math.floor(epoch / STEP_S);
  // Dernier pas dans le futur (horloge reculée ou état incohérent) : on refuse plutôt que d'ignorer le garde.
  if (lastStep !== null && lastStep > current + 1) return { ok: false };
  // otplib lève une erreur pour un afterTimeStep hors fenêtre : le garde n'est passé que dans la fenêtre
  // (un pas plus ancien est de toute façon hors de la fenêtre acceptée, donc non rejouable).
  const replayGuard = lastStep !== null && lastStep >= current - 1 ? { afterTimeStep: lastStep } : {};
  try {
    const result = verifySync({ secret, token: clean, epoch, epochTolerance: STEP_S, ...replayGuard });
    // Le type de retour d'otplib est l'union TOTP | HOTP : seul le résultat TOTP porte `timeStep`
    // (le pas réellement validé, delta compris). Sans lui, on refuse (échec fermé).
    return result.valid && "timeStep" in result ? { ok: true, step: result.timeStep } : { ok: false };
  } catch {
    return { ok: false };
  }
}
