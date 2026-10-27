import type { DbKind } from "@/lib/dumps";
import type { ProjectInput } from "@/lib/repo/projects";

export function parseProjectForm(fd: FormData): ProjectInput {
  const str = (k: string) => String(fd.get(k) ?? "");
  return {
    name: str("name"),
    db_kind: str("db_kind") as DbKind,
    // Vide : URL inchangée (modification) ; la création la refuse.
    db_url: str("db_url").trim() || null,
    cron: str("cron"),
    retention_count: Number(str("retention_count")),
    timeout_minutes: Number(str("timeout_minutes")),
    nas_copy: fd.get("nas_copy") === "on",
    enabled: fd.get("enabled") === "on",
  };
}
