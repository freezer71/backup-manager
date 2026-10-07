"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/login/actions";
import { getClientIp, requireSession } from "@/lib/auth/next-session";
import { getDb } from "@/lib/db";
import { parseProjectForm } from "@/lib/forms";
import { audit } from "@/lib/repo/audit";
import { getEnvironment } from "@/lib/repo/environments";
import { createProject, deleteProject, getProject, updateProject } from "@/lib/repo/projects";
import { isProjectBusy, startProjectRun } from "@/lib/runner/run-project";
import { getRunDeps, refreshProjectSchedule } from "@/lib/scheduler";
import { safeChildDir } from "@/lib/runner/storage";
import { toFormError } from "@/lib/validation";

export async function createProjectAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const db = getDb();
  const input = parseProjectForm(fd);
  if (input.environment_id !== null && !getEnvironment(db, input.environment_id)) {
    return { error: "Environnement introuvable" };
  }
  let id: number;
  try {
    id = createProject(db, input);
  } catch (e) {
    return toFormError(e);
  }
  refreshProjectSchedule(id);
  audit(db, "project.create", getProject(db, id)!.slug, await getClientIp());
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const db = getDb();
  const before = getProject(db, id);
  if (!before) return { error: "Projet introuvable" };
  const input = parseProjectForm(fd);
  if (input.environment_id !== null && !getEnvironment(db, input.environment_id)) {
    return { error: "Environnement introuvable" };
  }
  try {
    updateProject(db, id, input);
  } catch (e) {
    return toFormError(e);
  }
  refreshProjectSchedule(id);
  const ip = await getClientIp();
  audit(db, "project.update", before.slug, ip);
  if (before.script !== getProject(db, id)!.script) audit(db, "script.update", before.slug, ip);
  revalidatePath(`/projects/${id}`);
  return { ok: "Enregistré." };
}

export async function deleteProjectAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
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
  audit(db, "project.delete", nasFailed ? `${project.slug} (NAS : échec suppression)` : project.slug, await getClientIp());
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
