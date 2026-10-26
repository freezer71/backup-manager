"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/app/login/actions";
import {
  clearSessionCookie,
  currentSession,
  getClientIp,
  isCurrentDeviceTrusted,
  requireSession,
  safeNextPath,
} from "@/lib/auth/next-session";
import { beginLoginAttempt, loginDelayMs, markAttemptSuccess } from "@/lib/auth/rate-limit";
import { confirmSession, deleteSession } from "@/lib/auth/session";
import { checkTotp } from "@/lib/auth/totp";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { claimTotpStep, getUser } from "@/lib/repo/user";

// Même limitation et même anti-rejeu qu'à la connexion. Trop d'échecs : la session est détruite.
export async function confirmAction(next: string, _: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const current = await currentSession();
  const db = getDb();
  const user = getUser(db);
  if (!current || !user?.totp_secret) redirect("/login");
  const ip = await getClientIp();
  const trusted = await isCurrentDeviceTrusted();
  const attempt = beginLoginAttempt(db, ip, "totp", new Date(), { trusted });
  if (!attempt.allowed) return { error: `Trop de tentatives. Réessayez dans ${Math.ceil(attempt.retryAfterMs / 1000)} s.` };

  const result = checkTotp(user.totp_secret, String(fd.get("code") ?? ""), user.totp_last_step);
  if (!(result.ok && claimTotpStep(db, user.totp_secret, result.step))) {
    audit(db, "reauth.failed", null, ip);
    if (loginDelayMs(db, ip, "totp", new Date(), { trusted }) > 0) {
      deleteSession(db, current.token);
      await clearSessionCookie();
      redirect("/login");
    }
    return { error: "Code incorrect." };
  }
  markAttemptSuccess(db, attempt.attemptId);
  confirmSession(db, current.session.id);
  audit(db, "reauth.ok", null, ip);
  redirect(safeNextPath(next));
}
