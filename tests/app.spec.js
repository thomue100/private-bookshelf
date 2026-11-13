// Grundcheck: alle Ansichten laden fehlerfrei, Offline-Liste ist vollständig, Handy-Ansicht läuft nicht über.
import { test, expect, openApp, seedBooks } from "./helpers.js";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../app/", import.meta.url));

test("Service Worker: alle App-Dateien stehen in der Offline-Liste", () => {
  const sw = readFileSync(APP + "sw.js", "utf8");
  const listed = new Set([...sw.matchAll(/["']\.?\/?([\w./-]+\.(?:js|css|html|webmanifest|png|svg))["']/g)].map(m => m[1]));
  const files = readdirSync(APP).filter(f => /\.(js|css|html|webmanifest)$/.test(f) && f !== "sw.js");
  for (const f of files) expect(listed, `${f} fehlt in FILES von sw.js`).toContain(f);
  expect(sw).toMatch(/VERSION\s*=\s*["']v\d+["']/);
});

for (const hash of ["#regal", "#wand", "#wunsch", "#verwaltung"]) {
  test(`Ansicht ${hash} lädt ohne Fehler`, async ({ page }) => {
    await openApp(page);
    await seedBooks(page);
    await page.goto("/" + hash);
    await page.waitForFunction(() => S.loaded);
    await expect(page.locator(`#v-${hash.slice(1)}`)).toBeVisible();
  });
}

test("Handy-Ansicht ist nicht breiter als der Bildschirm", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  const page = await ctx.newPage();
  await openApp(page);
  await seedBooks(page);
  for (const hash of ["#regal", "#wunsch", "#verwaltung"]) {
    await page.goto("/" + hash);
    await page.waitForFunction(() => S.loaded);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), hash).toBeLessThanOrEqual(390);
  }
  await ctx.close();
});
