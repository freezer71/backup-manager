import { describe, expect, it } from "vitest";
import { parseProjectForm } from "@/lib/forms";

describe("parseProjectForm", () => {
  it("convertit les champs du formulaire", () => {
    const fd = new FormData();
    fd.set("name", "Pilote");
    fd.set("environment_id", "3");
    fd.set("script", "echo");
    fd.set("cron", "0 3 * * *");
    fd.set("retention_count", "7");
    fd.set("timeout_minutes", "30");
    fd.set("nas_copy", "on");
    expect(parseProjectForm(fd)).toEqual({
      name: "Pilote",
      environment_id: 3,
      script: "echo",
      cron: "0 3 * * *",
      retention_count: 7,
      timeout_minutes: 30,
      nas_copy: true,
      enabled: false,
    });
  });

  it("environnement vide = null, nombres invalides = NaN rejeté plus loin", () => {
    const fd = new FormData();
    fd.set("environment_id", "");
    fd.set("retention_count", "abc");
    const p = parseProjectForm(fd);
    expect(p.environment_id).toBeNull();
    expect(Number.isNaN(p.retention_count)).toBe(true);
  });
});
