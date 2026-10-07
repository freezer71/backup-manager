import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("premier démarrage → TOTP → environnement → projet → run → téléchargement", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);

  await page.getByRole("link", { name: "Environnements" }).click();
  await page.waitForURL(/\/environments$/, { waitUntil: "commit" });
  await page.getByLabel("Nom").fill("e2e");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await page.waitForURL(/\/environments\/\d+$/, { waitUntil: "commit" });
  await page.getByLabel("Clé").fill("GREETING");
  await page.getByLabel("Valeur").fill("bonjour-secret");
  await page.getByRole("button", { name: "Enregistrer le secret", exact: true }).click();
  await expect(page.getByTestId("secret-GREETING")).toHaveText("••••••••");
  await page.getByRole("button", { name: "Afficher", exact: true }).click();
  await expect(page.getByTestId("secret-GREETING")).toHaveText("bonjour-secret");

  await page.goto("/projects/new");
  await page.getByLabel("Nom").fill("Projet E2E");
  await page.getByLabel("Environnement de secrets").selectOption({ label: "e2e" });
  await page.getByLabel("Copier sur le NAS").uncheck();
  await page.getByLabel("Modèle").selectOption("empty");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type('echo "$GREETING"\necho contenu > "$OUTPUT_DIR/e2e.txt"\n');
  await page.getByRole("button", { name: "Créer le projet", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projet E2E" })).toBeVisible();

  await page.getByRole("button", { name: "Lancer maintenant", exact: true }).click();
  await page.waitForURL(/\/runs\/\d+$/, { waitUntil: "commit" });
  await expect(page.getByTestId("run-status")).toHaveText("réussi", { timeout: 20_000 });
  await expect(page.getByTestId("run-log")).toContainText("••••");
  await expect(page.getByTestId("run-log")).not.toContainText("bonjour-secret");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "e2e.txt" }).click();
  const file = await (await download).path();
  expect(fs.readFileSync(file, "utf8")).toBe("contenu\n");
});

test("les routes protégées refusent sans session", async ({ request }) => {
  expect((await request.get("/api/runs/1")).status()).toBe(401);
  expect((await request.get("/api/runs/1/files/0")).status()).toBe(401);
  const res = await request.get("/environments", { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(res.status());
});
