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

const colsMenu = page => page.locator("#tbar .tpop:has(.tpcols)");
const viewsMenu = page => page.locator("#tbar .tpop:has(form.tvsave)");
const colWidth = (page, k) => page.locator(`#tbl col[data-k='${k}']`).evaluate(c => parseInt(c.style.width));

test("Spalten ein-/ausblenden und Breite ziehen – bleibt nach Neuladen erhalten", async ({ page }) => {
  await setup(page);
  await expect(page.locator("#tbl thead th[data-k='isbn']")).toHaveCount(1);

  await colsMenu(page).locator("summary").click();
  await page.getByLabel("Spalte ISBN").uncheck();
  await expect(page.locator("#tbl thead th[data-k='isbn']")).toHaveCount(0);
  await expect(page.locator("#tbl tbody tr").first().locator("td")).toHaveCount(await page.locator("#tbl thead tr").first().locator("th").count());
  await expect(colsMenu(page)).toHaveAttribute("open", ""); // Menü bleibt beim Umschalten offen
  await expect(page.getByLabel("Spalte Titel")).toBeDisabled(); // Titel lässt sich nicht ausblenden

  // Breite der Autor-Spalte ziehen (+80 px); das Ziehen sortiert nicht
  await page.click("#stats"); // daneben klicken schließt das Menü
  await expect(colsMenu(page)).not.toHaveAttribute("open", "");
  const sortsBefore = await page.evaluate(() => JSON.stringify(S.tSorts));
  const w0 = await colWidth(page, "author");
  const g = await page.locator("#tbl thead th[data-k='author'] .colgrip").boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 40, g.y + g.height / 2, { steps: 4 });
  await page.mouse.move(g.x + g.width / 2 + 80, g.y + g.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(await colWidth(page, "author")).toBe(w0 + 80);
  expect(await page.evaluate(() => JSON.stringify(S.tSorts))).toBe(sortsBefore);

  await page.reload();
  await page.waitForFunction(() => S.loaded);
  await expect(page.locator("#tbl thead th[data-k='isbn']")).toHaveCount(0);
  expect(await colWidth(page, "author")).toBe(w0 + 80);
  await expect(colsMenu(page).locator("summary")).toContainText("1 aus");

  // Doppelklick auf den Rand = Standardbreite; „Alle zeigen“ blendet wieder ein
  await page.locator("#tbl thead th[data-k='author'] .colgrip").dblclick();
  expect(await colWidth(page, "author")).toBe(w0);
  await colsMenu(page).locator("summary").click();
  await colsMenu(page).getByRole("button", { name: "Alle zeigen" }).click();
  await expect(page.locator("#tbl thead th[data-k='isbn']")).toHaveCount(1);
});

test("Filtervorschläge zeigen vorhandene Werte und beachten die anderen Filter", async ({ page }) => {
  await setup(page);
  const opts = k => page.evaluate(k => [...document.querySelectorAll(`#fsug-${k} option`)].map(o => o.value), k);

  await fin(page, "Autor").click();
  const all = await opts("author");
  expect(all.slice(0, 2)).toEqual(["Hermann Hesse", "Michael Ende"]); // häufigste zuerst
  expect(all).toHaveLength(10);

  await page.selectOption("tr.frow select[aria-label='Filter Status']", "read");
  await fin(page, "Autor").click();
  expect(await opts("author")).toEqual(["Franz Kafka", "Michael Ende", "Otfried Preußler", "The Detection Club"]);

  // Mehrere Werte mit „|“: Vorschläge hängen an das Getippte an
  await fin(page, "Autor").fill("Michael Ende | ");
  await expect.poll(() => opts("author")).toContain("Michael Ende | Franz Kafka");
  await fin(page, "Autor").fill("Michael Ende | Franz Kafka");
  await fin(page, "Autor").press("Enter");
  await expect.poll(() => sorted(page)).toEqual(["Die Verwandlung", "Momo"]);

  await fin(page, "Jahr").click();
  expect(await opts("year")).toEqual(["2000"]);
});

test("Benannte Ansichten speichern, anwenden, als geändert erkennen und löschen", async ({ page }) => {
  await setup(page);
  await filter(page, "Autor", "hesse");
  await page.click("thead th:has-text('Jahr')");
  await colsMenu(page).locator("summary").click();
  await page.getByLabel("Spalte ISBN").uncheck();

  await viewsMenu(page).locator("summary").click();
  await page.getByLabel("Name der Ansicht").fill("Hesse-Bücher");
  await viewsMenu(page).getByRole("button", { name: "Speichern" }).click();
  await expect(viewsMenu(page).locator("summary")).toHaveText("⭐ Hesse-Bücher");

  // Grundeinstellung: alles zurück
  await viewsMenu(page).locator("summary").click();
  await viewsMenu(page).getByRole("button", { name: "Grundeinstellung" }).click();
  await expect(page.locator("#tbl tbody tr")).toHaveCount(12);
  await expect(page.locator("#tbl thead th[data-k='isbn']")).toHaveCount(1);
  await expect(viewsMenu(page).locator("summary")).toHaveText("⭐ Ansichten");

  // Ansicht anwenden – auch nach Neuladen vorhanden
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  await viewsMenu(page).locator("summary").click();
  await viewsMenu(page).getByRole("button", { name: "Hesse-Bücher", exact: true }).click();
  await expect.poll(() => sorted(page)).toEqual(["Der Steppenwolf", "Siddhartha"]);
  await expect(page.locator("#tbl thead th[data-k='isbn']")).toHaveCount(0);
  await expect(fin(page, "Autor")).toHaveValue("hesse");
  expect(await page.evaluate(() => S.tSorts)).toEqual([{ key: "year", dir: 1 }]);

  // Änderung wird angezeigt
  await filter(page, "Autor", "ende");
  await expect(viewsMenu(page).locator("summary")).toHaveText("⭐ Hesse-Bücher (geändert)");

  // Löschen mit Rückfrage
  await viewsMenu(page).locator("summary").click();
  await page.getByLabel("Ansicht Hesse-Bücher löschen").click();
  await page.locator(".overlay.confirm").getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(viewsMenu(page).locator("summary")).toHaveText("⭐ Ansichten");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tableViews")))).toEqual([]);
});

test("Gespeicherte Tabellen-Einstellung im alten Format (ohne Spalten/Breiten) wird übernommen", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => localStorage.setItem("tableView", JSON.stringify({ colF: { author: "ende" }, sorts: [{ key: "year", dir: -1 }], showF: true })));
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  await expect.poll(() => sorted(page)).toEqual(["Die unendliche Geschichte", "Momo"]);
  await expect(page.locator("#tbl thead tr").first().locator("th")).toHaveCount(22); // alle Spalten sichtbar
  expect(await page.evaluate(() => [S.tHidden, S.tW, S.tFilter, S.tView])).toEqual([[], {}, "all", ""]);
});
