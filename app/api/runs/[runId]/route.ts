import { requireApiSession } from "@/lib/auth/next-session";
import { getDb } from "@/lib/db";
import { getRun } from "@/lib/repo/runs";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!(await requireApiSession())) return new Response("Non authentifié", { status: 401 });
  const run = getRun(getDb(), Number((await params).runId));
  if (!run) return new Response("Introuvable", { status: 404 });
  return Response.json({ status: run.status, log: run.log, finished_at: run.finished_at });
}
