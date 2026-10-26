import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as Array<{ url: string; status: string; message: string }>);
vi.mock("@/lib/runner/notify", () => ({
  sendNotification: vi.fn(async (url: string, p: { status: string; message: string }) => {
    sent.push({ url, status: p.status, message: p.message });
  }),
}));
vi.mock("@/lib/config", () => ({ loadConfig: () => ({ appUrl: "https://backups.example.com" }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

import { safeNextPath } from "@/lib/auth/next-session";
import { listAudit } from "@/lib/repo/audit";
import { setSetting } from "@/lib/repo/settings";
import { securityEvent } from "@/lib/security-events";
import { testDb } from "./helpers";

beforeEach(() => {
  sent.length = 0;
});

describe("alertes de sécurité", () => {
  it("journalise toujours, alerte le webhook pour les événements sensibles seulement", () => {
    const db = testDb();
    setSetting(db, "webhook_url", "https://ntfy.sh/moi");
    securityEvent(db, "secret.reveal", "prod/DATABASE_URL", "203.0.113.5");
    securityEvent(db, "run.manual", "pilote", "203.0.113.5");
    expect(listAudit(db).map((e) => e.action)).toEqual(["run.manual", "secret.reveal"]);
    expect(sent).toEqual([{ url: "https://ntfy.sh/moi", status: "secret.reveal", message: "secret affiché : prod/DATABASE_URL (IP 203.0.113.5)" }]);
  });

  it("prévient aussi l'ancien webhook quand il est remplacé", () => {
    const db = testDb();
    setSetting(db, "webhook_url", "https://ntfy.sh/nouveau");
    securityEvent(db, "webhook.update", "ntfy.sh/…", "203.0.113.5", ["https://ntfy.sh/ancien"]);
    expect(sent.map((s) => s.url).sort()).toEqual(["https://ntfy.sh/ancien", "https://ntfy.sh/nouveau"]);
  });

  it("sans webhook : journal seulement", () => {
    const db = testDb();
    securityEvent(db, "password.change", null, null);
    expect(sent).toEqual([]);
    expect(listAudit(db)[0].action).toBe("password.change");
  });
});

describe("safeNextPath", () => {
  it("ne redirige que vers un chemin de l'application", () => {
    expect(safeNextPath("/projects/3/runs/9")).toBe("/projects/3/runs/9");
    expect(safeNextPath("/environments/2?x=1")).toBe("/environments/2?x=1");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "", null, undefined, "/a b"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
