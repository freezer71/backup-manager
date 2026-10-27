import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("premier démarrage → TOTP → projet (base PostgreSQL) → run → téléchargement du dump", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);

  const url = process.env.E2E_PG_URL!;
  const password = process.env.E2E_PG_PASSWORD!;
  await page.goto("/projects/new");
  await page.getByLabel("Nom").fill("Projet E2E");
  await page.getByLabel("Type de base").selectOption("postgres");
  await page.getByLabel("URL de connexion").fill(url);
  await page.getByLabel("Copier sur le NAS").uncheck();
  await page.getByRole("button", { name: "Créer le projet", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projet E2E" })).toBeVisible();
  // L'URL enregistrée s'affiche sans identifiants ; la page n'en contient pas le mot de passe.
  await expect(page.getByTestId("db-url")).toHaveText(/^postgresql:\/\/127\.0\.0\.1:\d+\/postgres$/);
  expect(await page.content()).not.toContain(password);
  await page.getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(page.getByTestId("db-url")).toHaveText(url);

  await page.getByRole("button", { name: "Lancer maintenant", exact: true }).click();
  await page.waitForURL(/\/runs\/\d+$/, { waitUntil: "commit" });
  await expect(page.getByTestId("run-status")).toHaveText("réussi", { timeout: 20_000 });
  await expect(page.getByTestId("run-log")).toContainText("OK:");
  await expect(page.getByTestId("run-log")).toContainText("1 tables");
  await expect(page.getByTestId("run-log")).not.toContainText(password);

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /^projet-e2e-backup_.*\.dump$/ }).click();
  const file = await (await download).path();
  // Format personnalisé de pg_dump : commence par « PGDMP ».
  expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe("PGDMP");
});

test("les routes protégées refusent sans session", async ({ request }) => {
  expect((await request.get("/api/runs/1")).status()).toBe(401);
  expect((await request.get("/api/runs/1/files/0")).status()).toBe(401);
  const res = await request.get("/projects/new", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(res.status());
});
