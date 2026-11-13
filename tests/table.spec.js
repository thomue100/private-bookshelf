// Verwaltungstabelle: Spaltenfilter, mehrstufige Sortierung, gefilterter CSV-Export, gespeicherte Ansicht.
import { test, expect, openApp, seedBooks } from "./helpers.js";
import { readFileSync } from "node:fs";

async function setup(page) {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    await patchBook("b7", { year: "1927", price: "12,90" }); await patchBook("b8", { year: "1922", price: "8" });
    await patchBook("b10", { year: "1901" }); await patchBook("b1", { year: "1979", price: "24" });
  });
  await page.goto("/#verwaltung");
  await page.waitForFunction(() => S.loaded);
}
const titles = page => page.locator("#tbl tbody tr td:nth-child(2) input").evaluateAll(els => els.map(e => e.value));
const sorted = async page => (await titles(page)).sort();
const fin = (page, k) => page.locator(`tr.frow input[aria-label='Filter ${k}']`);
async function filter(page, k, v) { await fin(page, k).fill(v); await fin(page, k).press("Enter"); }

test("Text-, Zahl- und Auswahlfilter lassen sich kombinieren", async ({ page }) => {
  await setup(page);
  await expect(page.locator("#tbl tbody tr")).toHaveCount(12);

  await fin(page, "Autor").click();
  await page.keyboard.type("hesse", { delay: 30 });
  await expect.poll(() => sorted(page)).toEqual(["Der Steppenwolf", "Siddhartha"]);
  expect(await page.evaluate(() => document.activeElement.getAttribute("aria-label"))).toBe("Filter Autor"); // Fokus bleibt beim Tippen
  await filter(page, "Autor", "");

  await filter(page, "Jahr", ">=1920");
  await expect.poll(async () => (await titles(page)).length).toBe(11);
  await filter(page, "Jahr", "1900-1930");
  await expect.poll(() => sorted(page)).toEqual(["Buddenbrooks", "Der Steppenwolf", "Siddhartha"]);
  await filter(page, "Preis", ">10");
  await expect.poll(() => sorted(page)).toEqual(["Der Steppenwolf"]);
  await filter(page, "Preis", "leer");
  await expect.poll(() => sorted(page)).toEqual(["Buddenbrooks"]);
  await filter(page, "Jahr", ""); await filter(page, "Preis", "");

  await filter(page, "Titel", "die | der");
  await expect.poll(async () => (await titles(page)).length).toBe(6);
  await filter(page, "Titel", "!die");
  await expect.poll(async () => (await titles(page)).length).toBe(9);
  await filter(page, "Titel", "");

  await filter(page, "Jahr", ">abc");
  await expect(fin(page, "Jahr")).toHaveClass(/\bbad\b/);
  await filter(page, "Jahr", "");

  await page.selectOption("tr.frow select[aria-label='Filter Status']", "read");
  await page.selectOption("tr.frow select[aria-label='Filter Lieblingsbuch']", "yes");
  await expect.poll(() => titles(page)).toEqual(["Momo"]);

  const dl = page.waitForEvent("download");
  await page.click("#tbar >> text=gefiltert");
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/-auswahl\.csv$/);
  const lines = readFileSync(await d.path(), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("Momo");

  await page.click("#tbar >> text=Alle aufheben");
  await expect(page.locator("#tbl tbody tr")).toHaveCount(12);
});

test("Mehrstufige Sortierung (Umschalt+Klick) und gespeicherte Ansicht nach Neuladen", async ({ page }) => {
  await setup(page);
  await page.click("thead th:has-text('Autor')");
  await page.click("thead th:has-text('Jahr')", { modifiers: ["Shift"] });
  await page.click("thead th:has-text('Jahr')", { modifiers: ["Shift"] }); // zweiter Klick: absteigend
  const rows = () => page.locator("#tbl tbody tr").evaluateAll(rs => rs.map(r => [r.children[2].querySelector("input").value, r.children[3].querySelector("input").value]));
  await expect.poll(async () => (await rows()).slice(0, 4)).toEqual([["The Detection Club", "2000"], ["Umberto Eco", "2000"], ["Michael Ende", "2000"], ["Michael Ende", "1979"]]); // Autor nach Nachname
  await expect(page.locator(".schip")).toHaveCount(2);

  await filter(page, "Autor", "ende");
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  await expect(fin(page, "Autor")).toHaveValue("ende");
  await expect.poll(async () => await rows()).toEqual([["Michael Ende", "2000"], ["Michael Ende", "1979"]]);
  await expect(page.locator(".schip")).toHaveCount(2);

  // Zelle bearbeiten, während ein Filter aktiv ist
  const cell = page.locator("#tbl tbody tr td:nth-child(4) input").first();
  await cell.fill("1970"); await cell.press("Enter");
  await expect.poll(() => page.evaluate(() => S.books.filter(b => b.year === "1970").length)).toBe(1);
});
