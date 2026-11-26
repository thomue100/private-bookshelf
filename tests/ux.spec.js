// Feinschliff der Oberfläche: Buch-Blatt am Handy, Titel in der Kopfzeile, leere Schlagwort-Auswahl, Spaltenfilter-Schalter.
import { test, expect, openApp, seedBooks } from "./helpers.js";

test("Buch am Handy: Lesestatus in einer Zeile, Titel in der Kopfzeile erst beim Rollen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(() => openDetail("b0"));
  const seg = page.locator(".dview .seg button");
  await expect(seg).toHaveCount(3);
  const tops = await seg.evaluateAll(bs => bs.map(b => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1); // alle drei nebeneinander
  const headTitle = page.locator(".sheet-h h2");
  await expect(headTitle).toHaveText("Momo");
  await expect(headTitle).toHaveCSS("opacity", "0");
  await page.locator(".sheet").evaluate(s => { s.scrollTop = 400; s.dispatchEvent(new Event("scroll")); });
  await expect(headTitle).toHaveCSS("opacity", "1");
  // Bearbeiten: Titel immer sichtbar
  await page.click(".actions .btn.primary");
  await expect(headTitle).toHaveText("Bearbeiten: Momo");
  await expect(headTitle).toHaveCSS("opacity", "1");
});

test("Ohne Schlagworte keine leere Auswahl; Spaltenfilter ist ein Schalter", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(() => renderAll());
  await expect(page.locator("#tagSlot select")).toBeHidden();
  await page.evaluate(async () => { await patchBook("b1", { tags: ["Fantasy"] }); renderAll(); });
  await expect(page.locator("#tagSlot select")).toBeVisible();
  await page.goto("/#verwaltung");
  const btn = page.locator("#tbar button:has-text('Spaltenfilter')");
  const before = await btn.getAttribute("aria-pressed");
  await btn.click();
  await expect(page.locator("#tbar button:has-text('Spaltenfilter')")).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  await expect(page.locator("#tbar button:has-text('Spaltenfilter')")).toHaveText("⛃ Spaltenfilter");
});
