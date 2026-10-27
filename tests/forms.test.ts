import { describe, expect, it } from "vitest";
import { parseProjectForm } from "@/lib/forms";

describe("parseProjectForm", () => {
  it("convertit les champs du formulaire", () => {
    const fd = new FormData();
    fd.set("name", "Pilote");
    fd.set("db_kind", "postgres");
    fd.set("db_url", " postgresql://u:p@h/db ");
    fd.set("cron", "0 3 * * *");
    fd.set("retention_count", "7");
    fd.set("timeout_minutes", "30");
    fd.set("nas_copy", "on");
    expect(parseProjectForm(fd)).toEqual({
      name: "Pilote",
      db_kind: "postgres",
      db_url: "postgresql://u:p@h/db",
      cron: "0 3 * * *",
      retention_count: 7,
      timeout_minutes: 30,
      nas_copy: true,
      enabled: false,
    });
  });

  it("URL vide = null (inchangée), nombres invalides = NaN rejeté plus loin", () => {
    const fd = new FormData();
    fd.set("db_url", "  ");
    fd.set("retention_count", "abc");
    const p = parseProjectForm(fd);
    expect(p.db_url).toBeNull();
    expect(Number.isNaN(p.retention_count)).toBe(true);
  });
});
