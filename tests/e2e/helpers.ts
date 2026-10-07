import fs from "node:fs";
import path from "node:path";
import { expect, type Page, type Request } from "@playwright/test";
import { generateSync } from "otplib";

const STATE_FILE = path.resolve(".e2e-data/totp-secret.txt");

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Mot de passe").fill("e2e-password-123");
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await page.waitForURL(/setup-2fa|login\/totp/, { waitUntil: "commit" });
  if (page.url().includes("/setup-2fa")) {
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    fs.writeFileSync(STATE_FILE, secret);
    await page.getByLabel("Code à 6 chiffres").fill(generateSync({ secret }));
    await page.getByRole("button", { name: "Activer", exact: true }).click();
  } else {
    // Attendre le pas TOTP suivant pour ne pas rejouer le dernier code accepté.
    const secret = fs.readFileSync(STATE_FILE, "utf8");
    await page.waitForTimeout(31_000 - (Date.now() % 30_000));
    await page.getByLabel("Code à 6 chiffres").fill(generateSync({ secret }));
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
}

export type RequestCounts = {
  // Requêtes ?_rsc= par « chemin + segment préchargé » sur toute la fenêtre.
  rsc: Map<string, number>;
  // Les mêmes, après les 2 premières secondes : une boucle continue, une rafale de chargement non.
  lateRsc: Map<string, number>;
  // Requêtes /api/runs/ par chemin (sondage du journal).
  api: Map<string, number>;
};

// Compte les requêtes pendant `ms` après la navigation vers `url`.
// Next 16 précharge segment par segment (en-tête Next-Router-Segment-Prefetch : /_tree, /_head, page…) :
// un même lien produit donc plusieurs requêtes légitimes, d'où le comptage par segment.
export async function countRequests(page: Page, url: string, ms = 10_000): Promise<RequestCounts> {
  const counts: RequestCounts = { rsc: new Map(), lateRsc: new Map(), api: new Map() };
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  let t0 = Date.now();
  const onRequest = (req: Request) => {
    const u = new URL(req.url());
    if (u.searchParams.has("_rsc")) {
      const key = `${u.pathname} [${req.headers()["next-router-segment-prefetch"] ?? "page"}]`;
      bump(counts.rsc, key);
      if (Date.now() - t0 > 2_000) bump(counts.lateRsc, key);
    }
    if (u.pathname.startsWith("/api/runs/")) bump(counts.api, u.pathname);
  };
  page.on("request", onRequest);
  t0 = Date.now();
  await page.goto(url);
  await page.waitForTimeout(ms);
  page.off("request", onRequest);
  return counts;
}

// Aucune boucle : au plus 3 requêtes par segment, et au plus 1 après le chargement initial.
export function expectNoPrefetchLoop(counts: RequestCounts, from: string) {
  for (const [key, n] of counts.rsc) expect(n, `${n} requêtes _rsc vers ${key} depuis ${from}`).toBeLessThanOrEqual(3);
  for (const [key, n] of counts.lateRsc) expect(n, `${n} requêtes _rsc tardives vers ${key} depuis ${from}`).toBeLessThanOrEqual(1);
}
