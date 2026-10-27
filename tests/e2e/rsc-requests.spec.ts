import { expect, test, type Page } from "@playwright/test";
import { countRequests, expectNoPrefetchLoop, login } from "./helpers";

async function findHrefs(page: Page) {
  await page.goto("/");
  const projectHref = await page.getByRole("link", { name: "Projet E2E" }).getAttribute("href");
  expect(projectHref).toBeTruthy();
  // L'historique a sa propre route, accessible par l'onglet.
  await page.goto(projectHref!);
  await page.getByRole("link", { name: /^Historique/ }).click();
  await page.waitForURL(/\/projects\/\d+\/runs$/);
  const historyHref = new URL(page.url()).pathname;
  const runHref = await page.locator('a[href*="/runs/"]').first().getAttribute("href");
  expect(runHref).toBeTruthy();
  return { projectHref: projectHref!, historyHref, runHref: runHref! };
}

test.describe.configure({ mode: "serial" });

test("aucune boucle de préchargement sur les routes dynamiques", async ({ page }) => {
  await login(page);
  const hrefs = await findHrefs(page);

  for (const url of [hrefs.projectHref, hrefs.historyHref, hrefs.runHref, "/projects/new", "/"]) {
    expectNoPrefetchLoop(await countRequests(page, url), url);
  }
});

test("la page d'un run terminé ne fait ni polling ni préchargement en boucle", async ({ page }) => {
  // Chaque test a son propre contexte de navigateur : on se reconnecte.
  await login(page);
  const { runHref } = await findHrefs(page);
  const counts = await countRequests(page, runHref);
  expect([...counts.api], "requêtes /api/runs/ sur un run terminé").toEqual([]);
  expectNoPrefetchLoop(counts, runHref);
});
