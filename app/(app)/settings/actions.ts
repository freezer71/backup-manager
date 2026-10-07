"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/login/actions";
import { clearSessionCookie, getClientIp, isCurrentDeviceTrusted, requireSession } from "@/lib/auth/next-session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { beginLoginAttempt, markAttemptSuccess } from "@/lib/auth/rate-limit";
import { deleteAllSessions } from "@/lib/auth/session";
import { revokeAllTrustedDevices } from "@/lib/auth/trusted-device";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { getSetting, setSetting } from "@/lib/repo/settings";
import { getUser, resetTotp, setPasswordHash } from "@/lib/repo/user";
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

export async function resetTotpAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const refused = await checkCurrentPassword(fd);
  if (refused) return refused;
  const db = getDb();
  resetTotp(db);
  deleteAllSessions(db);
  revokeAllTrustedDevices(db);
  audit(db, "totp.reset", null, await getClientIp());
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
