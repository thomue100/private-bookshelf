// Hinweis auf eine neue App-Version. Die Tests sperren Service Worker (playwright.config.js), deshalb wird der
// Service-Worker-Container nachgebildet: ein EventTarget mit `controller` und `getRegistration`.
import { test, expect, openApp } from "./helpers.js";

const fakeSw = hadController => `(() => {
  const t = new EventTarget(); t.controller = ${hadController ? "{}" : "null"}; t.updates = 0;
  t.getRegistration = async () => ({ update: async () => { t.updates++; } });
  watchForUpdates(t); window.__sw = t;
})()`;

test("Erste Installation: kein Hinweis – danach zeigt jede neue Version „Jetzt aktualisieren“", async ({ page }) => {
  await openApp(page);
  await page.evaluate(fakeSw(false));
  await page.evaluate(() => __sw.dispatchEvent(new Event("controllerchange"))); // erster Service Worker übernimmt
  await expect(page.locator(".updbar")).toHaveCount(0);
  await page.evaluate(() => __sw.dispatchEvent(new Event("controllerchange"))); // neue Version
  await expect(page.locator(".updbar")).toContainText("Neue Version");

  await page.getByRole("button", { name: "Hinweis schließen" }).click();
  await expect(page.locator(".updbar")).toHaveCount(0);
});

test("„Jetzt aktualisieren“ lädt die Seite neu; beim Zurückkehren wird nach Updates gesucht", async ({ page }) => {
  await openApp(page);
  await page.evaluate(fakeSw(true));
  await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => page.evaluate(() => __sw.updates)).toBe(1);

  await page.evaluate(() => { window.__alt = true; __sw.dispatchEvent(new Event("controllerchange")); });
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Jetzt aktualisieren" }).click()]);
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded);
  expect(await page.evaluate(() => window.__alt)).toBeUndefined(); // wirklich neu geladen
  await expect(page.locator(".updbar")).toHaveCount(0);
});
