import type { ProjectInput } from "@/lib/repo/projects";

export function parseProjectForm(fd: FormData): ProjectInput {
  const str = (k: string) => String(fd.get(k) ?? "");
  const env = str("environment_id");
  return {
    name: str("name"),
    environment_id: env ? Number(env) : null,
    script: str("script"),
    cron: str("cron"),
    retention_count: Number(str("retention_count")),
    timeout_minutes: Number(str("timeout_minutes")),
    nas_copy: fd.get("nas_copy") === "on",
    enabled: fd.get("enabled") === "on",
  };
}
