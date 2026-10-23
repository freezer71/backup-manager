"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/login/actions";
import { clearSessionCookie, getClientIp, isCurrentDeviceTrusted, requireSession } from "@/lib/auth/next-session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { beginLoginAttempt, markAttemptSuccess } from "@/lib/auth/rate-limit";
import { deleteAllSessions } from "@/lib/auth/session";
import { checkTotp, isTotpSecret } from "@/lib/auth/totp";
import { revokeAllTrustedDevices } from "@/lib/auth/trusted-device";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { getSetting, setSetting } from "@/lib/repo/settings";
import { getUser, replaceTotpSecret, setPasswordHash } from "@/lib/repo/user";
import { sendNotification } from "@/lib/runner/notify";

// Vérifie le mot de passe actuel avec la même limitation qu'une connexion :
// une session volée ne doit pas permettre de deviner le mot de passe sans limite.
async function checkCurrentPassword(fd: FormData): Promise<FormState | null> {
  const db = getDb();
  const ip = await getClientIp();
  const attempt = beginLoginAttempt(db, ip, "password", undefined, { trusted: await isCurrentDeviceTrusted() });
  if (!attempt.allowed) return { error: `Trop de tentatives. Réessayez dans ${Math.ceil(attempt.retryAfterMs / 1000)} s.` };
  const user = getUser(db);
  const ok = !!user && (await verifyPassword(user.password_hash, String(fd.get("current_password") ?? "")));
  if (!ok) {
    audit(db, "password.check_failed", null, ip);
    return { error: "Mot de passe actuel incorrect." };
  }
  markAttemptSuccess(db, attempt.attemptId);
  return null;
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const next = String(fd.get("new_password") ?? "");
  const mismatch = next !== fd.get("confirm_password");
  const refused = await checkCurrentPassword(fd);
  if (refused) return refused;
  if (next.length < 12) return { error: "12 caractères minimum." };
  if (mismatch) return { error: "Les deux mots de passe ne correspondent pas." };
  const db = getDb();
  setPasswordHash(db, await hashPassword(next));
  deleteAllSessions(db);
  revokeAllTrustedDevices(db);
  audit(db, "password.change", null, await getClientIp());
  await clearSessionCookie();
  redirect("/login");
}

// Remplace l'application TOTP sans jamais effacer l'ancienne : un compte sans TOTP laisserait quiconque connaît
// le mot de passe lier son propre authentificateur, jusqu'à ce que le propriétaire refasse la 2FA.
// Le nouveau secret vient du formulaire (jamais stocké avant) : le mot de passe et un code valide pour ce secret
// sont exigés, une session seule ne suffit pas.
export async function replaceTotpAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const secret = String(fd.get("secret") ?? "");
  if (!isTotpSecret(secret)) return { error: "Rechargez la page pour générer un nouveau QR code." };
  const refused = await checkCurrentPassword(fd);
  if (refused) return refused;
  const db = getDb();
  const ip = await getClientIp();
  const attempt = beginLoginAttempt(db, ip, "totp", undefined, { trusted: await isCurrentDeviceTrusted() });
  if (!attempt.allowed) return { error: `Trop de tentatives. Réessayez dans ${Math.ceil(attempt.retryAfterMs / 1000)} s.` };
  const result = checkTotp(secret, String(fd.get("code") ?? ""), null);
  if (!result.ok || !replaceTotpSecret(db, secret, result.step)) {
    audit(db, "totp.replace_failed", null, ip);
    return { error: "Code incorrect. Vérifiez l'heure de votre téléphone." };
  }
  markAttemptSuccess(db, attempt.attemptId);
  deleteAllSessions(db);
  revokeAllTrustedDevices(db);
  audit(db, "totp.replaced", null, ip);
  await clearSessionCookie();
  redirect("/login");
}

export async function saveWebhookAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const url = String(fd.get("webhook_url") ?? "").trim();
  if (url && !/^https?:\/\//.test(url)) return { error: "L'URL doit commencer par http:// ou https://" };
  const db = getDb();
  setSetting(db, "webhook_url", url || null);
  audit(db, "webhook.update", null, await getClientIp());
  revalidatePath("/settings");
  return { ok: url ? "Webhook enregistré." : "Webhook supprimé." };
}

export async function testWebhookAction(): Promise<FormState> {
  await requireSession();
  const url = getSetting(getDb(), "webhook_url");
  if (!url) return { error: "Aucun webhook enregistré." };
  try {
    await sendNotification(url, { project: "test", status: "test", message: "Notification de test", runUrl: loadConfig().appUrl });
    return { ok: "Notification envoyée." };
  } catch (e) {
    return { error: `Échec : ${e instanceof Error ? e.message : "erreur inconnue"}` };
  }
}
