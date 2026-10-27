"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/login/actions";
import { getClientIp, hasRecentConfirmation, reauthRequired, requireSession } from "@/lib/auth/next-session";
import { getDb } from "@/lib/db";
import { parseProjectForm } from "@/lib/forms";
import { audit } from "@/lib/repo/audit";
import { createProject, deleteProject, getProject, getProjectDbUrl, updateProject } from "@/lib/repo/projects";
import { isProjectBusy, startProjectRun } from "@/lib/runner/run-project";
import { getRunDeps, refreshProjectSchedule } from "@/lib/scheduler";
import { safeChildDir } from "@/lib/runner/storage";
import { securityEvent } from "@/lib/security-events";
import { toFormError } from "@/lib/validation";

// Créer, modifier ou supprimer un projet demande un code récent : l'URL de connexion choisit la base copiée.
export async function createProjectAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  if (!(await hasRecentConfirmation())) return reauthRequired();
  const db = getDb();
  const input = parseProjectForm(fd);
  let id: number;
  try {
    id = createProject(db, input);
  } catch (e) {
    return toFormError(e);
  }
  refreshProjectSchedule(id);
  securityEvent(db, "project.create", getProject(db, id)!.slug, await getClientIp());
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  if (!(await hasRecentConfirmation())) return reauthRequired();
  const db = getDb();
  const before = getProject(db, id);
  if (!before) return { error: "Projet introuvable" };
  const input = parseProjectForm(fd);
  try {
    updateProject(db, id, input);
  } catch (e) {
    return toFormError(e);
  }
  refreshProjectSchedule(id);
  const ip = await getClientIp();
  audit(db, "project.update", before.slug, ip);
  if (input.db_url !== null || input.db_kind !== before.db_kind) securityEvent(db, "db_url.update", before.slug, ip);
  revalidatePath(`/projects/${id}`);
  return { ok: "Enregistré." };
}

export async function revealDbUrlAction(id: number): Promise<{ value: string } | { reauth: true }> {
  await requireSession();
  if (!(await hasRecentConfirmation())) return { reauth: true };
  const db = getDb();
  const project = getProject(db, id);
  const url = getProjectDbUrl(db, id);
  if (!project || !url) throw new Error("URL introuvable");
  securityEvent(db, "db_url.reveal", project.slug, await getClientIp());
  return { value: url };
}

export async function deleteProjectAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  if (!(await hasRecentConfirmation())) return reauthRequired();
  if (fd.get("confirm") !== "on") return { error: "Confirmation requise." };
  const { db, cfg } = getRunDeps();
  const project = getProject(db, id);
  if (!project) redirect("/");
  if (isProjectBusy(db, id)) return { error: "Une exécution est en cours : réessayez après sa fin." };
  let nasFailed = false;
  if (fd.get("delete_files") === "on") {
    const local = safeChildDir(path.join(cfg.dataDir, "backups"), project.slug);
    const nas = safeChildDir(cfg.nasDir, project.slug);
    if (!local || !nas) return { error: "Chemin de backup invalide, suppression annulée" };
    try {
      await fs.rm(local, { recursive: true, force: true });
    } catch (e) {
      return { error: `Suppression des fichiers locaux impossible : ${e instanceof Error ? e.message : String(e)}` };
    }
    try {
      await fs.rm(nas, { recursive: true, force: true });
    } catch {
      nasFailed = true;
    }
  }
  deleteProject(db, id);
  refreshProjectSchedule(id);
  securityEvent(db, "project.delete", nasFailed ? `${project.slug} (NAS : échec suppression)` : project.slug, await getClientIp());
  redirect("/");
}

export async function runNowAction(id: number): Promise<void> {
  await requireSession();
  const deps = getRunDeps();
  const started = startProjectRun(id, "manual", deps);
  if (!started) redirect("/");
  started.done.catch((e) => console.error(`[run] projet ${id} :`, e));
  audit(deps.db, "run.manual", getProject(deps.db, id)?.slug ?? String(id), await getClientIp());
  redirect(`/projects/${id}/runs/${started.runId}`);
}
