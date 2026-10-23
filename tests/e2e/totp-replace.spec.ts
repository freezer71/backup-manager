import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { generateSync } from "otplib";
import { login } from "./helpers";

const STATE_FILE = path.resolve(".e2e-data/totp-secret.txt");

test("changer d'application 2FA : l'ancienne reste valable jusqu'à la validation, puis seule la nouvelle passe", async ({ page }) => {
  // Deux attentes du pas TOTP suivant (connexion, puis reconnexion) : jusqu'à une minute.
  test.setTimeout(150_000);
  await login(page);
  const oldSecret = fs.readFileSync(STATE_FILE, "utf8");

  await page.goto("/settings");
  const form = page.locator("form", { has: page.getByTestId("totp-new-secret") });
  const newSecret = (await page.getByTestId("totp-new-secret").textContent())!.trim();
  expect(newSecret).not.toBe(oldSecret);

  // Le nouveau secret n'est stocké nulle part : une autre visite (une session volée, par exemple) en voit un
  // autre, et ne peut donc pas connaître celui que le propriétaire va scanner.
  const other = await page.context().newPage();
  await other.goto("/settings");
  expect((await other.getByTestId("totp-new-secret").textContent())!.trim()).not.toBe(newSecret);
  await other.close();

  // Un code faux ne change rien : la session reste ouverte, l'ancienne application reste la seule valable.
  await form.getByLabel("Mot de passe actuel").fill("e2e-password-123");
  await form.getByLabel("Code de la nouvelle application").fill("000000");
  await form.getByRole("button", { name: /Remplacer/ }).click();
  await expect(form.getByText("Code incorrect.", { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);

  await form.getByLabel("Mot de passe actuel").fill("e2e-password-123");
  await form.getByLabel("Code de la nouvelle application").fill(generateSync({ secret: newSecret }));
  await form.getByRole("button", { name: /Remplacer/ }).click();
  await page.waitForURL(/\/login$/, { waitUntil: "commit" });
  fs.writeFileSync(STATE_FILE, newSecret);

  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Mot de passe").fill("e2e-password-123");
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await page.waitForURL(/login\/totp/, { waitUntil: "commit" });
  await page.getByLabel("Code à 6 chiffres").fill(generateSync({ secret: oldSecret }));
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByText("Code incorrect.")).toBeVisible();

  // Le pas utilisé pour valider la nouvelle application est déjà consommé : attendre le suivant.
  await page.waitForTimeout(31_000 - (Date.now() % 30_000));
  await page.getByLabel("Code à 6 chiffres").fill(generateSync({ secret: newSecret }));
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
});
