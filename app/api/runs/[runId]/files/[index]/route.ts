import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getClientIp, requireApiSession } from "@/lib/auth/next-session";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/repo/audit";
import { getProject } from "@/lib/repo/projects";
import { getRun } from "@/lib/repo/runs";
import { localBackupDir } from "@/lib/runner/storage";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string; index: string }> }) {
  if (!(await requireApiSession())) return new Response("Non authentifié", { status: 401 });
  const { runId, index } = await params;
  if (!/^\d+$/.test(index)) return new Response("Index invalide", { status: 400 });
  const db = getDb();
  const run = getRun(db, Number(runId));
  if (!run || run.status !== "success") return new Response("Introuvable", { status: 404 });
  if (run.pruned) return new Response("Fichier supprimé par la rétention", { status: 410 });
  const project = getProject(db, run.project_id);
  const file = run.files[Number(index)];
  if (!project || !file) return new Response("Introuvable", { status: 404 });

  // Le chemin vient uniquement de la base ; on vérifie quand même qu'il reste dans le dossier du run.
  const base = path.resolve(localBackupDir(loadConfig(), project.slug, run));
  const full = path.resolve(base, file);
  if (!full.startsWith(base + path.sep)) return new Response("Chemin invalide", { status: 400 });

  let size: number;
  try {
    size = (await fs.stat(full)).size;
  } catch {
    return new Response("Fichier absent du disque", { status: 404 });
  }
  audit(db, "backup.download", `${project.slug}/${file}`, await getClientIp());
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    },
  });
}
