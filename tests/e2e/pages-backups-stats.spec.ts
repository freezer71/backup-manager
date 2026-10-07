import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { countRequests, expectNoPrefetchLoop, login } from "./helpers";

// S'appuie sur le projet « Projet E2E » et son run réussi créés par flow.spec.ts (ordre alphabétique, workers: 1).

test.describe.configure({ mode: "serial" });

test("page Backups : liste, filtre par projet et téléchargement", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);

  await page.getByRole("link", { name: "Backups", exact: true }).click();
  await page.waitForURL(/\/backups$/, { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Projet E2E" }).first()).toBeVisible();

  await page.getByRole("navigation", { name: "Filtrer par projet" }).getByRole("link", { name: "Projet E2E" }).click();
  await page.waitForURL(/\/backups\?project=\d+$/, { waitUntil: "commit" });
  await expect(page.getByRole("cell", { name: "Projet E2E" }).first()).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /e2e\.txt/ }).first().click();
  expect(fs.readFileSync(await (await download).path(), "utf8")).toBe("contenu\n");

  // Bouton du tableau de bord : dernier backup du projet.
  await page.goto("/");
  const row = page.getByRole("row").filter({ hasText: "Projet E2E" });
  const fromDashboard = page.waitForEvent("download");
  await row.getByRole("link", { name: /Télécharger/ }).click();
  expect(fs.readFileSync(await (await fromDashboard).path(), "utf8")).toBe("contenu\n");
});

test("page Statistiques : espace disque, durées et fiabilité", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.getByRole("link", { name: "Statistiques", exact: true }).click();
  await page.waitForURL(/\/stats$/, { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Espace disque" })).toBeVisible();
  await expect(page.getByText("Disque du serveur (backups locaux)")).toBeVisible();
  await expect(page.getByText(/Répartition par projet/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Durée des derniers backups" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Fiabilité/ })).toBeVisible();
  // Répartition : un seul projet, donc 100 % de l'espace ; fiabilité : 1 backup réussi sur 1.
  await expect(page.getByRole("row", { name: /^Projet E2E 100 % .* 1 backup$/ })).toBeVisible();
  await expect(page.getByRole("row", { name: "Projet E2E 1 1 0 0 100 %" })).toBeVisible();
});

test("aucune boucle de préchargement sur Backups et Statistiques", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.goto("/backups");
  const filterHref = await page.getByRole("navigation", { name: "Filtrer par projet" }).getByRole("link", { name: "Projet E2E" }).getAttribute("href");
  expect(filterHref).toBeTruthy();
  for (const url of ["/backups", filterHref!, "/stats"]) {
    expectNoPrefetchLoop(await countRequests(page, url), url);
  }
});
