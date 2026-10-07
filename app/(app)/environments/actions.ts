"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/login/actions";
import { getClientIp, requireSession } from "@/lib/auth/next-session";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import {
  createEnvironment,
  deleteEnvironment,
  deleteSecret,
  getEnvironment,
  getSecret,
  importDotenv,
  updateEnvironment,
  upsertSecret,
} from "@/lib/repo/environments";
import { toFormError } from "@/lib/validation";

function envFields(fd: FormData) {
  return { name: String(fd.get("name") ?? ""), description: String(fd.get("description") ?? "") };
}

export async function createEnvironmentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const db = getDb();
  let id: number;
  try {
    id = createEnvironment(db, envFields(fd));
  } catch (e) {
    return toFormError(e);
  }
  audit(db, "environment.create", envFields(fd).name, await getClientIp());
  redirect(`/environments/${id}`);
}

export async function updateEnvironmentAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  try {
    updateEnvironment(getDb(), id, envFields(fd));
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath(`/environments/${id}`);
  return { ok: "Enregistré." };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature imposée par useActionState (état précédent)
export async function deleteEnvironmentAction(id: number, _: FormState): Promise<FormState> {
  await requireSession();
  const db = getDb();
  const env = getEnvironment(db, id);
  try {
    deleteEnvironment(db, id);
  } catch (e) {
    return toFormError(e);
  }
  audit(db, "environment.delete", env?.name ?? String(id), await getClientIp());
  redirect("/environments");
}

export async function saveSecretAction(envId: number, _: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const db = getDb();
  const env = getEnvironment(db, envId);
  if (!env) return { error: "Environnement introuvable" };
  const key = String(fd.get("key") ?? "").trim();
  try {
    upsertSecret(db, envId, key, String(fd.get("value") ?? ""));
  } catch (e) {
    return toFormError(e);
  }
  audit(db, "secret.update", `${env.name}/${key}`, await getClientIp());
  revalidatePath(`/environments/${envId}`);
  return { ok: `${key} enregistrée.` };
}

export async function importDotenvAction(envId: number, _: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const db = getDb();
  const env = getEnvironment(db, envId);
  if (!env) return { error: "Environnement introuvable" };
  let count: number;
  try {
    count = importDotenv(db, envId, String(fd.get("dotenv") ?? ""));
  } catch (e) {
    return toFormError(e);
  }
  audit(db, "secret.import", `${env.name} (${count})`, await getClientIp());
  revalidatePath(`/environments/${envId}`);
  return { ok: count > 1 ? `${count} secrets importés.` : `${count} secret importé.` };
}

export async function deleteSecretAction(secretId: number): Promise<void> {
  await requireSession();
  const db = getDb();
  const secret = getSecret(db, secretId);
  if (!secret) return;
  deleteSecret(db, secretId);
  audit(db, "secret.delete", `${getEnvironment(db, secret.environment_id)?.name}/${secret.key}`, await getClientIp());
  revalidatePath(`/environments/${secret.environment_id}`);
}

export async function revealSecretAction(secretId: number): Promise<string> {
  await requireSession();
  const db = getDb();
  const secret = getSecret(db, secretId);
  if (!secret) throw new Error("Secret introuvable");
  audit(db, "secret.reveal", `${getEnvironment(db, secret.environment_id)?.name}/${secret.key}`, await getClientIp());
  return secret.value;
}
