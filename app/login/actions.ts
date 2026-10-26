"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import {
  clearSessionCookie,
  currentSession,
  getClientIp,
  isCurrentDeviceTrusted,
  requirePendingSession,
  setSessionCookie,
  setTrustedDeviceCookie,
} from "@/lib/auth/next-session";
import { beginLoginAttempt, loginDelayMs, markAttemptSuccess } from "@/lib/auth/rate-limit";
import { createSession, deleteSession, markSessionTotpOk, PENDING_TTL_MS, SESSION_TTL_MS } from "@/lib/auth/session";
import { issueTrustedDevice } from "@/lib/auth/trusted-device";
import { checkTotp } from "@/lib/auth/totp";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { claimTotpStep, confirmTotp, getUser, replacePasswordHash } from "@/lib/repo/user";
import { securityEvent } from "@/lib/security-events";

const MAX_EMAIL = 254;

// reauth : l'action demande un code TOTP récent (voir hasRecentConfirmation).
export type FormState = { error?: string; ok?: string; reauth?: boolean };

function tooMany(ms: number): FormState {
  return { error: `Trop de tentatives. Réessayez dans ${Math.ceil(ms / 1000)} s.` };
}

// Première connexion complète depuis ce navigateur : il devient un appareil de confiance (limites globales exemptées).
async function trustThisDevice(db: ReturnType<typeof getDb>, ip: string, email: string): Promise<void> {
  const userAgent = (await headers()).get("user-agent");
  await setTrustedDeviceCookie(issueTrustedDevice(db, { userAgent }));
  securityEvent(db, "device.trusted", email, ip);
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const db = getDb();
  const ip = await getClientIp();
  const trusted = await isCurrentDeviceTrusted();
  const attempt = beginLoginAttempt(db, ip, "password", new Date(), { trusted });
  if (!attempt.allowed) return tooMany(attempt.retryAfterMs);

  const rawEmail = String(fd.get("email") ?? "").trim().toLowerCase();
  if (rawEmail.length > MAX_EMAIL) {
    audit(db, "login.failed", null, ip);
    return { error: "Email ou mot de passe incorrect." };
  }
  const email = rawEmail;
  const password = String(fd.get("password") ?? "");
  const user = getUser(db);
  // verifyPassword est toujours exécuté (même si l'email est faux) pour ne pas révéler l'email par le temps de réponse.
  const passwordOk = !!user && (await verifyPassword(user.password_hash, password));
  const ok = !!user && user.email === email && passwordOk;
  if (ok) {
    markAttemptSuccess(db, attempt.attemptId);
    if (needsRehash(user.password_hash)) replacePasswordHash(db, user.password_hash, await hashPassword(password));
  }
  audit(db, ok ? "login.password_ok" : "login.failed", email, ip);
  if (!ok || !user) return { error: "Email ou mot de passe incorrect." };

  const previous = await currentSession();
  if (previous) deleteSession(db, previous.token);
  const token = createSession(db, { ip, userAgent: (await headers()).get("user-agent") });
  await setSessionCookie(token, PENDING_TTL_MS);
  redirect(user.totp_secret ? "/login/totp" : "/setup-2fa");
}

export async function totpAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = await requirePendingSession();
  const db = getDb();
  const ip = await getClientIp();
  const user = getUser(db);
  if (!user?.totp_secret) redirect("/setup-2fa");
  const trusted = await isCurrentDeviceTrusted();
  const attempt = beginLoginAttempt(db, ip, "totp", new Date(), { trusted });
  if (!attempt.allowed) return tooMany(attempt.retryAfterMs);

  const result = checkTotp(user.totp_secret, String(fd.get("code") ?? ""), user.totp_last_step);
  // user.totp_last_step a été lu avant les await : seul l'enregistrement atomique du pas exclut le rejeu.
  const accepted = result.ok && claimTotpStep(db, user.totp_secret, result.step);
  if (!accepted) {
    audit(db, result.ok ? "login.totp_replayed" : "login.totp_failed", user.email, ip);
    // Après 5 codes faux (délai TOTP actif pour cette IP), la session en attente est détruite : il faut ressaisir le mot de passe.
    if (loginDelayMs(db, ip, "totp", new Date(), { trusted }) > 0) {
      deleteSession(db, token);
      await clearSessionCookie();
      redirect("/login");
    }
    return { error: "Code incorrect." };
  }
  markAttemptSuccess(db, attempt.attemptId);
  const fullToken = markSessionTotpOk(db, token);
  if (!fullToken) {
    await clearSessionCookie();
    redirect("/login");
  }
  await setSessionCookie(fullToken, SESSION_TTL_MS);
  if (!trusted) await trustThisDevice(db, ip, user.email);
  audit(db, "login.ok", user.email, ip);
  redirect("/");
}

export async function confirmTotpSetupAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = await requirePendingSession();
  const db = getDb();
  const ip = await getClientIp();
  const user = getUser(db);
  if (!user) redirect("/login");
  if (user.totp_secret) redirect("/login/totp");
  if (!user.totp_pending_secret) return { error: "Rechargez la page pour générer un nouveau QR code." };
  const trusted = await isCurrentDeviceTrusted();
  const attempt = beginLoginAttempt(db, ip, "totp", new Date(), { trusted });
  if (!attempt.allowed) return tooMany(attempt.retryAfterMs);

  const pending = user.totp_pending_secret;
  const result = checkTotp(pending, String(fd.get("code") ?? ""), null);
  if (!result.ok || !confirmTotp(db, pending, result.step)) {
    audit(db, "totp.setup_failed", user.email, ip);
    if (loginDelayMs(db, ip, "totp", new Date(), { trusted }) > 0) {
      deleteSession(db, token);
      await clearSessionCookie();
      redirect("/login");
    }
    return { error: "Code incorrect. Vérifiez l'heure de votre téléphone." };
  }
  markAttemptSuccess(db, attempt.attemptId);
  const fullToken = markSessionTotpOk(db, token);
  if (!fullToken) {
    await clearSessionCookie();
    redirect("/login");
  }
  await setSessionCookie(fullToken, SESSION_TTL_MS);
  if (!trusted) await trustThisDevice(db, ip, user.email);
  audit(db, "totp.enabled", user.email, ip);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const current = await currentSession();
  if (current) deleteSession(getDb(), current.token);
  await clearSessionCookie();
  redirect("/login");
}
