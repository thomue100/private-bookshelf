// Navigation: Kopfzeile am PC, Leiste unten am Handy, alles Seltene gebündelt unter „Mehr“, Tastenkürzel.
import { test, expect, openApp, seedBooks } from "./helpers.js";

test("PC: Kopfzeile mit allen Bereichen, keine Leiste unten; aktiver Bereich ist markiert", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".bottomnav")).toBeHidden();
  await expect(page.locator("nav.topnav a")).toHaveText(["Bibliothek", "Regal", "Wünsche", "Tabelle", "Mehr"]);
  await expect(page.locator("nav.topnav a.on")).toHaveText("Bibliothek");
  await page.click("nav.topnav a[data-view=wunsch]");
  await expect(page.locator("#v-wunsch")).toBeVisible();
  await expect(page.locator("nav.topnav a[aria-current=page]")).toHaveText("Wünsche");
});

test("Handy: Leiste unten mit Hinzufügen in der Mitte; Tabelle gehört zu „Mehr“", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await seedBooks(page);
  await expect(page.locator("nav.topnav")).toBeHidden();
  await expect(page.locator(".bottomnav a")).toHaveText(["Bibliothek", "Regal", "Wünsche", "Mehr"]);
  // Leiste liegt unten am Rand und verdeckt kein Buch dauerhaft (Inhalt hat Platz darunter)
  const box = await page.locator(".bottomnav").boundingBox();
  expect(Math.round(box.y + box.height)).toBe(844);
  await page.click(".bottomnav a[data-view=mehr]");
  await expect(page.locator("#v-mehr")).toBeVisible();
  await page.click("#tableRun");
  await expect(page.locator("#v-verwaltung")).toBeVisible();
  await expect(page.locator(".bottomnav a.on")).toHaveText("Mehr");
  await page.click(".bottomnav .bn-add");
  await expect(page.locator(".sheet h2")).toHaveText("Buch hinzufügen");
});

test("„Mehr“ bündelt alle früheren Menüpunkte und Werkzeuge mit Zählern", async ({ page }) => {
  await openApp(page, "#mehr");
  await seedBooks(page);
  await page.evaluate(() => renderAll());
  for (const id of ["stackRun", "shelfScanRun", "photoInboxRun", "titleListRun", "tableRun", "coverRun", "dupRun", "heightRun",
    "exportRun", "importRun", "autoBackupRun", "syncRun", "exportCsv", "aboutRun", "providerRun", "recLogRun"])
    await expect(page.locator("#" + id), id).toBeVisible();
  await expect(page.locator(".mstats")).toContainText("12im Bestand");
  await expect(page.locator("#coverRun .mcount")).toHaveText("6"); // seedBooks: gerade Nummern ohne Cover
  await page.click("#recLogRun");
  await expect(page.locator(".sheet h2")).toContainText("Erkennungsprotokoll");
});

test("Tastenkürzel: / springt in die Suche, N öffnet „Buch hinzufügen“ – nicht beim Tippen in Feldern", async ({ page }) => {
  await openApp(page, "#wunsch");
  await page.keyboard.press("/");
  await expect(page.locator("#v-regal")).toBeVisible();
  await expect(page.locator("#q")).toBeFocused();
  await page.keyboard.type("n");
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(page.locator("#q")).toHaveValue("n");
  await page.locator("#q").blur();
  await page.keyboard.press("n");
  await expect(page.locator(".sheet h2")).toHaveText("Buch hinzufügen");
});
