// Echtes Regal (Montana-Würfel): anlegen, einräumen, Doppelreihe, liegend/oben drauf, wieder herausnehmen.
import { test, expect, openApp, seedBooks } from "./helpers.js";

async function newWall(page, preset) {
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  if (preset) await page.click(`text=${preset}`);
  await page.click(".confirm .btn.primary");
}

test("Regalwand 4er + 2er anlegen und Bücher per Antippen einräumen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "4er-Würfel + 2er-Würfel nebeneinander");
  await expect(page.locator(".fach")).toHaveCount(6);
  const before = await page.locator(".witem").count();
  for (const fi of [0, 0, 1, 4]) {
    await page.locator(".witem").first().click();
    await page.locator(".fach").nth(fi).click({ position: { x: 200, y: 20 } });
  }
  await expect(page.locator(".witem")).toHaveCount(before - 4);
  expect(await page.evaluate(() => S.books.filter(b => locationOf(b.id)).length)).toBe(4);

  // Standort im Buch anzeigen und wieder herausnehmen
  await page.locator(".spine").first().click();
  await page.click("text=Buch öffnen");
  const meta = page.locator(".sec:has(h3:text-is('Standort')) .meta");
  await expect(meta).toContainText("Fach");
  await page.click("text=↩ Aus dem Regal nehmen");
  await expect(meta).toHaveText("Noch nicht im echten Regal eingeräumt.");
  expect(await page.evaluate(() => S.books.filter(b => locationOf(b.id)).length)).toBe(3);
});

test("2er-Würfel hochkant hat Fächer oben/unten", async ({ page }) => {
  await openApp(page);
  await newWall(page, "Ein 2er-Würfel hochkant");
  await expect(page.locator(".fach")).toHaveCount(2);
  expect(await page.evaluate(() => { const m = S.shelves.walls[0].columns[0].modules[0]; return [m.type, m.orient, modLayout(m).keys]; })).toEqual(["6112", "v", ["T", "B"]]);
});

test("Doppelreihe, oben aufgelegt und liegend werden gespeichert und beschrieben", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  const r = await page.evaluate(async () => {
    const m = S.shelves.walls[0].columns[0].modules[0];
    await placeBook("b0", m, "TL", 0);
    await placeBook("b1", m, "TL", 0, "back");
    await placeBook("b2", m, "TL", 0, "top");
    setLying("b3", true); await placeBook("b3", m, "TL", 1); await saveShelves();
    return ["b0", "b1", "b2", "b3"].map(id => locationText(locationOf(id)));
  });
  expect(r[0]).toMatch(/1\. von links/);
  expect(r[1]).toMatch(/hintere Reihe/);
  expect(r[2]).toMatch(/liegt oben auf der Reihe/);
  expect(r[3]).toMatch(/\(liegend\)/);
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  expect(await page.evaluate(() => [locationOf("b1").layer, locationOf("b2").layer, isLying("b3")])).toEqual(["back", "top", true]);
});

for (const vp of [{ width: 1300, height: 900 }, { width: 390, height: 844 }]) {
  test(`Einräumen: ganzer Titel, Autor und Band sind lesbar (${vp.width} px)`, async ({ page }) => {
    await page.setViewportSize(vp);
    await openApp(page);
    const LONG = "Die schönsten Weihnachtsgeschichten am Kamin aus vierzig Jahren gesammelt und neu herausgegeben";
    await page.evaluate(async long => {
      const add = (id, title, seriesNo, extra = {}) => putBook({ id, title, author: "Ursula Richter und Wolf-Dieter Stubel", seriesNo, status: "unread", addedAt: new Date().toISOString(), ...extra });
      await add("w10", "Weihnachtsgeschichten am Kamin", "10");
      await add("w2", "Weihnachtsgeschichten am Kamin", "2");
      await add("w3", "Weihnachtsgeschichten am Kamin", "23326", { spine: { text: "RICHTER (HG.). Weihnachtsgeschichten am Kamin 3 12393" } }); // Band nur im Rückentext
      await add("lang", long, "");
    }, LONG);
    await newWall(page, "Ein 4er-Würfel (1112)");

    const items = page.locator(".wside .witem b");
    await expect(items).toHaveText([LONG, "Weihnachtsgeschichten am Kamin · Band 2", "Weihnachtsgeschichten am Kamin · Band 3", "Weihnachtsgeschichten am Kamin · Band 10"]);
    // nichts abgeschnitten: Text bricht um statt mit „…“ zu enden
    for (const b of await items.all()) expect(await b.evaluate(e => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).whiteSpace !== "nowrap")).toBe(true);
    await expect(page.locator(".wside .witem").nth(1)).toContainText("Ursula Richter und Wolf-Dieter Stubel");

    // Antippen: die Einräum-Leiste nennt Titel, Band und Autor
    await page.locator(".wside .witem", { hasText: "Band 10" }).click();
    await expect(page.locator(".pickbar")).toContainText("„Weihnachtsgeschichten am Kamin · Band 10“ (Ursula Richter und Wolf-Dieter Stubel) einräumen");
    await page.locator(".fach").first().click();
    await expect.poll(() => page.evaluate(() => !!locationOf("w10"))).toBe(true);
    expect(await page.locator(".spine[data-id=w10]").getAttribute("title")).toContain("Band 10");
  });
}
