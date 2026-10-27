import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { expect, test, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import { login } from "./helpers";

// Vieillit la confirmation TOTP de toutes les sessions, comme si le dernier code datait d'une heure.
function expireConfirmations() {
  const db = new Database(path.resolve(".e2e-data/app.db"));
  db.pragma("cipher='sqlcipher'");
  db.pragma("legacy=4");
  db.pragma("key='e2e-key-0123456789abcdef0123456789abcdef'");
  db.pragma("busy_timeout = 5000");
  db.prepare("UPDATE sessions SET reauth_at = ?").run(new Date(Date.now() - 3_600_000).toISOString());
  db.close();
}

async function typeNextCode(page: Page) {
  const secret = fs.readFileSync(path.resolve(".e2e-data/totp-secret.txt"), "utf8");
  await page.waitForTimeout(31_000 - (Date.now() % 30_000)); // pas suivant : le dernier code est déjà consommé
  await page.getByLabel("Code à 6 chiffres").fill(generateSync({ secret }));
}

test("CSP avec nonce sur chaque page, sans violation", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content.Security.Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await login(page);
  for (const url of ["/", "/environments", "/projects/new", "/backups", "/stats", "/settings", "/page-inexistante"]) {
    const res = await page.goto(url);
    const csp = res!.headers()["content-security-policy"] ?? "";
    expect(csp, url).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp, url).toContain("frame-ancestors 'none'");
    // Tous les scripts de la page portent le nonce de la réponse.
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    const scripts = await page.locator("script").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).nonce));
    expect(scripts.length, url).toBeGreaterThan(0);
    expect(scripts.every((n) => n === nonce), url).toBe(true);
  }
  expect(violations).toEqual([]);
});

test("une session sans code récent ne lit pas un secret, ne télécharge pas, ne modifie pas le webhook", async ({ page }) => {
  await login(page);
  expireConfirmations();

  await page.getByRole("link", { name: "Environnements" }).click();
  await page.getByRole("link", { name: "e2e", exact: true }).click();
  await page.getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(page.getByTestId("secret-GREETING")).toContainText("Code 2FA requis");
  await expect(page.getByTestId("secret-GREETING")).not.toContainText("bonjour-secret");

  const envUrl = page.url();
  await page.getByRole("link", { name: "Confirmer avec un code" }).click();
  await page.waitForURL(/\/confirm\?next=/);
  await typeNextCode(page);
  await page.getByRole("button", { name: "Confirmer", exact: true }).click();
  await page.waitForURL(envUrl);
  await page.getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(page.getByTestId("secret-GREETING")).toHaveText("bonjour-secret");

  expireConfirmations();
  const res = await page.request.get("/api/runs/1/files/0", { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toMatch(/^\/confirm\?next=%2Fprojects%2F\d+%2Fruns%2F1$/);

  await page.goto("/settings");
  await page.getByLabel("URL (ntfy, Discord…)").fill("https://ntfy.sh/e2e");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Action sensible : confirmez d'abord")).toBeVisible();
});

test("le webhook refuse http et les adresses internes", async ({ page }) => {
  await login(page); // connexion complète : confirmation valable 10 min
  await page.goto("/settings");
  for (const [url, message] of [
    ["http://ntfy.sh/e2e", "https://"],
    ["https://10.0.1.5/hook", "Adresse privée"],
    ["https://backup-manager:3000/x", "Nom de domaine complet"],
  ]) {
    await page.getByLabel("URL (ntfy, Discord…)").fill(url);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
  }
});
