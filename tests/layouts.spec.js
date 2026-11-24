// Mehrere Aufstellungen: dieselben Bücher in Varianten einsortieren, wechseln, Standort, Sicherung, alter Stand ohne Varianten.
import { test, expect, openApp, seedBooks } from "./helpers.js";

async function wallWithBooks(page) {
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  await page.click("text=Ein 4er-Würfel (1112)");
  await page.click(".confirm .btn.primary");
  await page.evaluate(async () => {
    const m = S.shelves.walls[0].columns[0].modules[0];
    await placeBooks(["b0", "b1", "b2"], m, "TL");
    setLying("b2", true); await saveShelves();
  });
}

test("Zweite Aufstellung anlegen, umstellen, wechseln – Bücher bleiben dieselben", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await wallWithBooks(page);

  // ohne Varianten: unter „⋯ Mehr“
  await page.click(".walltools details.wmenu summary");
  await page.click(".wmenu-list >> text=🗂 Aufstellungen");
  await expect(page.locator(".lyrow")).toHaveCount(1);
  await page.fill("input[aria-label='Name der neuen Aufstellung']", "Nach Farben");
  await page.click("text=📋 Kopie der jetzigen");
  await expect(page.locator(".lybtn")).toHaveText("🗂 Nach Farben");

  // in der Kopie umstellen: b0 ins Fach unten rechts, b1 herausnehmen
  await page.evaluate(async () => { const m = S.shelves.walls[0].columns[0].modules[0]; await placeBook("b0", m, "BR"); unshelve("b1"); await saveShelves(); renderAll(); });
  expect(await page.evaluate(() => [locationOf("b0").k, !!locationOf("b1"), isLying("b2")])).toEqual(["BR", false, true]);

  // Standort zeigt auch die andere Aufstellung
  await page.evaluate(() => openDetail("b1"));
  await expect(page.locator(".lyloc")).toContainText("In „Aufstellung 1“:");
  await expect(page.locator(".lyloc")).toContainText("oben links");
  await page.click(".sheet .x");

  // nach Neustart zurück zur ersten
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await page.click(".lybtn");
  await page.locator(".lyrow:not(.active) input").fill("Nach Autoren");
  await page.locator(".lyrow:not(.active) input").dispatchEvent("change");
  await expect(page.locator(".lyrow:not(.active) input")).toHaveValue("Nach Autoren");
  await page.click(".lyrow:not(.active) >> text=Zeigen");
  await expect(page.locator(".lybtn")).toHaveText("🗂 Nach Autoren");
  expect(await page.evaluate(() => [locationOf("b0").k, locationOf("b1").k, isLying("b2"), S.books.length])).toEqual(["TL", "TL", true, 12]);

  // leere Variante mit gleichem Aufbau, danach die alte löschen
  await page.click(".lybtn");
  await page.fill("input[aria-label='Name der neuen Aufstellung']", "Neu");
  await page.click("text=🧱 Gleicher Aufbau, leer");
  expect(await page.evaluate(() => [S.shelves.walls[0].columns[0].modules.length, !!locationOf("b0"), isLying("b2"), S.shelves.variants.length])).toEqual([1, false, false, 3]);
  await page.click(".lybtn");
  await expect(page.locator(".lyrow")).toHaveCount(3);
  await page.locator(".lyrow:not(.active)").first().locator("text=Löschen").click();
  await page.click(".confirm .btn.primary");
  await expect(page.locator(".lyrow")).toHaveCount(2);
});

test("Aufstellungen reisen mit der Sicherung; Dubletten-Zusammenführung gilt auch in anderen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await wallWithBooks(page);
  const backup = await page.evaluate(async () => {
    await addLayout("B", false);
    unshelve("b1"); await saveShelves();
    return await buildBackup({ images: false, files: false });
  });
  expect(backup.shelves.variants.map(v => v.name)).toEqual(["Aufstellung 1", "B"]);
  expect(backup.shelves.variants[0].walls).toBeTruthy();
  expect(backup.shelves.variants[1].walls).toBeUndefined();

  // Dublette: b1 in b5 zusammenführen → in Aufstellung 1 steht jetzt b5
  await page.evaluate(() => mergeBooks("b5", ["b1"]));
  const ids = await page.evaluate(() => S.shelves.variants[0].walls[0].columns[0].modules[0].fachs.TL);
  expect(ids).toEqual(["b0", "b5", "b2"]);

  // Gerät ohne Regal: Sicherung importieren
  await page.evaluate(async b => { S.shelves = { walls: [], updatedAt: "" }; await DB.setMeta("shelves", S.shelves); await importData(b); }, backup);
  expect(await page.evaluate(() => [S.shelves.variants.length, activeLayout().name, !!locationOf("b1")])).toEqual([2, "B", false]);
  await page.evaluate(() => switchLayout(S.shelves.variants[0].id));
  expect(await page.evaluate(() => [locationOf("b0")?.k, !!locationOf("b1")])).toEqual(["TL", false]); // b1 ist zusammengeführt und gelöscht
});

test("Alter Regal-Stand ohne Aufstellungen funktioniert wie bisher", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    const old = { updatedAt: "2025-01-01T00:00:00.000Z", walls: [{ id: "w1", name: "Alt", columns: [{ id: "c1", modules: [{ id: "m1", type: "6112", color: "#f3f2ee", orient: "h", fachs: { L: ["b3"], R: [] }, back: {}, top: {} }] }] }] };
    await DB.setMeta("shelves", old);
  });
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  expect(await page.evaluate(() => [layoutsOf().length, locationOf("b3").k])).toEqual([0, "L"]);
  await expect(page.locator(".walltools > .lybtn")).toHaveCount(0); // nur unter „⋯ Mehr“
  await page.click(".walltools details.wmenu summary");
  await page.click(".wmenu-list >> text=🗂 Aufstellungen");
  await expect(page.locator(".lyrow.active input")).toHaveValue("Aktuelle Aufstellung");
  expect(await page.evaluate(() => layoutLocations("b3"))).toEqual([]);
});
