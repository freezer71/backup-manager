import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getUser } from "@/lib/repo/user";
import { clientIpFromHeaders, parseTrustedProxies } from "./client-ip";
import { findSession, type Session } from "./session";
import { isTrustedDevice, TRUSTED_DEVICE_TTL_MS } from "./trusted-device";

// Le préfixe __Host- impose Secure, Path=/ et l'absence de Domain (déjà le cas en production).
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-bm_session" : "bm_session";

// Cookie d'appareil de confiance : identifie le navigateur (pas la session), survit à la déconnexion.
export const TRUSTED_COOKIE = process.env.NODE_ENV === "production" ? "__Host-bm_device" : "bm_device";

const TRUSTED_PROXIES = parseTrustedProxies(process.env.TRUSTED_PROXIES);

// Traefik remplace l'en-tête X-Forwarded-For venant d'un client non fiable, et le complète quand la requête
// arrive par un proxy de confiance (cloudflared) : voir clientIpFromHeaders.
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h.get("x-forwarded-for"), h.get("x-real-ip"), TRUSTED_PROXIES);
}

export async function setSessionCookie(token: string, maxAgeMs: number): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  // Pas de cookies().delete : il émet un Set-Cookie sans Secure, rejeté par les navigateurs pour un nom __Host-.
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function currentSession(): Promise<{ token: string; session: Session } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = findSession(getDb(), token);
  return session ? { token, session } : null;
}

export async function requireSession(): Promise<void> {
  const current = await currentSession();
  if (!current) redirect("/login");
  if (!current.session.totp_ok) {
    redirect(getUser(getDb())?.totp_secret ? "/login/totp" : "/setup-2fa");
  }
}

// Session après mot de passe, avant TOTP.
export async function requirePendingSession(): Promise<string> {
  const current = await currentSession();
  if (!current) redirect("/login");
  if (current.session.totp_ok) redirect("/");
  return current.token;
}

export async function requireApiSession(): Promise<boolean> {
  const current = await currentSession();
  return !!current?.session.totp_ok;
}

export async function isCurrentDeviceTrusted(): Promise<boolean> {
  const token = (await cookies()).get(TRUSTED_COOKIE)?.value;
  return !!token && isTrustedDevice(getDb(), token);
}

export async function setTrustedDeviceCookie(token: string): Promise<void> {
  (await cookies()).set(TRUSTED_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(TRUSTED_DEVICE_TTL_MS / 1000),
  });
}
