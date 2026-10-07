import { expect, test, type Page } from "@playwright/test";
import { countRequests, expectNoPrefetchLoop, login } from "./helpers";

async function findHrefs(page: Page) {
  await page.goto("/");
  const projectHref = await page.getByRole("link", { name: "Projet E2E" }).getAttribute("href");
  expect(projectHref).toBeTruthy();
  await page.goto(projectHref!);
  const runHref = await page.locator('a[href*="/runs/"]').first().getAttribute("href");
  expect(runHref).toBeTruthy();
  await page.goto("/environments");
  const envDetail = await page.locator('a[href^="/environments/"]').first().getAttribute("href");
  expect(envDetail).toBeTruthy();
  return { projectHref: projectHref!, runHref: runHref!, envDetail: envDetail! };
}

test.describe.configure({ mode: "serial" });

test("aucune boucle de préchargement sur les routes dynamiques", async ({ page }) => {
  await login(page);
  const hrefs = await findHrefs(page);

  for (const url of [hrefs.projectHref, hrefs.runHref, hrefs.envDetail, "/"]) {
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
