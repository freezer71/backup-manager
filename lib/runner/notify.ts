import type { AppConfig } from "@/lib/config";
import type { DB } from "@/lib/db";
import { getSetting } from "@/lib/repo/settings";

export type NotifyPayload = { project: string; status: string; message: string; runUrl: string };

export async function sendNotification(url: string, p: NotifyPayload, fetchImpl: typeof fetch = fetch): Promise<void> {
  const text = `[Backup] ${p.project} : ${p.status} — ${p.message}\n${p.runUrl}`;
  const init: RequestInit = url.includes("ntfy")
    ? { method: "POST", body: text, headers: { Title: `Backup ${p.project}`, Tags: "warning" } }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...p, content: text }) };

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Jamais l'erreur brute : elle peut contenir l'URL du webhook, dont le jeton est un secret.
      lastError = new Error(
        e instanceof Error && e.name === "TimeoutError" ? "Délai dépassé" : `Échec réseau (${e instanceof Error ? e.name : "inconnu"})`,
      );
    }
  }
  throw lastError;
}

export async function notifyProblem(
  db: DB,
  cfg: AppConfig,
  input: { projectSlug: string; projectId: number; runId: number; status: string; message: string },
  send: typeof sendNotification = sendNotification,
): Promise<void> {
  const url = getSetting(db, "webhook_url");
  if (!url) return;
  try {
    await send(url, {
      project: input.projectSlug,
      status: input.status,
      message: input.message,
      runUrl: `${cfg.appUrl}/projects/${input.projectId}/runs/${input.runId}`,
    });
  } catch (e) {
    console.error(`[notify] échec de l'envoi pour le run ${input.runId} : ${e instanceof Error ? e.message : "erreur inconnue"}`);
  }
}
