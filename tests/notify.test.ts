import { testConfig, testDb } from "./helpers";
import { setSetting } from "@/lib/repo/settings";
import { describe, expect, it, vi } from "vitest";
import { isPublicAddress, notifyProblem, safeFetch, sendNotification, webhookUrlProblem } from "@/lib/runner/notify";

const payload = { project: "pilote", status: "failed", message: "code 1", runUrl: "https://b/projects/1/runs/2" };

describe("sendNotification", () => {
  it("envoie du JSON avec un champ content (Discord, webhook générique)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await sendNotification("https://discord.com/api/webhooks/x", payload, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject(payload);
    expect(body.content).toContain("pilote");
  });

  it("envoie du texte brut à ntfy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await sendNotification("https://ntfy.sh/mes-backups", payload, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(typeof init.body).toBe("string");
    expect(init.body).toContain("pilote");
    expect(init.headers.Title).toBe("Backup pilote");
  });

  it("réessaie une fois puis lève l'erreur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await expect(sendNotification("https://x", payload, fetchImpl)).rejects.toThrow("HTTP 500");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("secrets dans les erreurs de notification", () => {
  const url = "https://discord.com/api/webhooks/123/SECRETTOKEN";

  it("l'erreur relancée ne contient ni l'URL ni son jeton", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError(`fetch failed: ${url}`));
    const err = await sendNotification(url, payload, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).not.toContain("SECRETTOKEN");
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain("SECRETTOKEN");
  });

  it("notifyProblem ne journalise jamais le jeton (URL invalide)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = testDb();
    setSetting(db, "webhook_url", "not a url/SECRETTOKEN");
    await notifyProblem(db, testConfig(), { projectSlug: "p", projectId: 1, runId: 2, status: "failed", message: "m" });
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls.map((c) => c.map((x) => (x instanceof Error ? [x.message, x.stack, Object.entries(x)] : x))))).not.toContain("SECRETTOKEN");
    spy.mockRestore();
  });
});

describe("destination du webhook", () => {
  it("n'accepte qu'une URL https publique, sans identifiants", () => {
    expect(webhookUrlProblem("https://ntfy.sh/mes-backups")).toBeNull();
    expect(webhookUrlProblem("https://discord.com/api/webhooks/1/x")).toBeNull();
    expect(webhookUrlProblem("http://ntfy.sh/x")).toMatch(/https/);
    expect(webhookUrlProblem("https://u:p@ntfy.sh/x")).toMatch(/Identifiants/);
    expect(webhookUrlProblem("https://127.0.0.1/x")).toMatch(/[Pp]rivée/);
    expect(webhookUrlProblem("https://10.0.1.5:3000/x")).toMatch(/[Pp]rivée/);
    expect(webhookUrlProblem("https://[::1]/x")).toMatch(/[Pp]rivée/);
    expect(webhookUrlProblem("https://localhost/x")).toMatch(/[Pp]rivée/);
    expect(webhookUrlProblem("https://backup-manager:3000/x")).toMatch(/Nom de domaine/);
    expect(webhookUrlProblem("pas une url")).toMatch(/URL invalide/);
  });

  it("classe les adresses privées, locales et réservées", () => {
    for (const ip of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["1.1.1.1", "203.0.114.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("le transport par défaut refuse une résolution DNS vers une adresse privée (rebinding)", async () => {
    await expect(
      safeFetch("https://interne.example/x", { method: "POST", body: "x" }, { lookup: async () => "10.0.1.7" }),
    ).rejects.toThrow(/privée/);
  });
});
