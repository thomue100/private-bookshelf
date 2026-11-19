// Vorgaben für einen Stapel: Fach, Schlagworte, Lesestatus, Bestand/Wunschliste – für „Speichern & nächstes“ und den Stapel-Modus.
import { test, expect, openApp, isbn13 } from "./helpers.js";

async function wall(page) {
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  await page.click("text=Ein 4er-Würfel (1112)");
  await page.click(".confirm .btn.primary");
  await expect(page.locator(".wall .fach").first()).toBeVisible();
}
const fachTitles = page => page.evaluate(() => { const f = fachOptions()[0]; return layerList(f.m, f.k, "front").map(id => S.books.find(b => b.id === id).title); });

test("„Speichern & nächstes“ mit Vorgaben: Fach in Erfassungsreihenfolge, Schlagwort, Status – abschaltbar", async ({ page }) => {
  await openApp(page);
  await wall(page);
  await page.evaluate(() => openAdd());
  await page.click("text=⚙ Vorgaben für alle Bücher festlegen");
  const dlg = page.locator(".confirm:has-text('Vorgaben für alle Bücher')");
  await dlg.locator("select").first().selectOption({ index: 1 });
  await dlg.locator(".taginput").fill("Krimi"); await dlg.locator(".taginput").press("Enter");
  await dlg.locator("select").nth(1).selectOption("read");
  await dlg.locator(".btn.primary").click();
  await expect(page.locator(".presetbar .presettext")).toContainText("#Krimi");
  await expect(page.locator(".presetbar .presettext")).toContainText("Gelesen");

  for (const t of ["Erstes", "Zweites", "Drittes"]) {
    await page.click("text=Ganz von Hand eintragen");
    await expect(page.locator(".presetbar .presettext")).toContainText("📍"); // Vorgaben bleiben sichtbar
    await page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field").first().fill(t);
    await page.click("text=Speichern & nächstes");
    await expect(page.locator(".sheet h2")).toHaveText("Buch hinzufügen");
  }
  await expect.poll(() => fachTitles(page)).toEqual(["Erstes", "Zweites", "Drittes"]);
  const r = await page.evaluate(() => S.books.map(b => [b.title, b.status, b.tags, readsOf(b).length]));
  expect(r.every(([, s, tags, reads]) => s === "read" && tags.join() === "Krimi" && reads === 1)).toBe(true);

  // abschalten: nächstes Buch ganz normal
  await page.click(".presetbar button:text-is('aus')");
  await expect(page.locator(".presetbar")).toContainText("einschalten");
  await page.click("text=Ganz von Hand eintragen");
  await page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field").first().fill("Viertes");
  await page.click("text=Speichern & nächstes");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(4);
  const v = await page.evaluate(() => { const b = S.books.find(x => x.title === "Viertes"); return [b.status, b.tags || [], !!locationOf(b.id)]; });
  expect(v).toEqual(["unread", [], false]);
});

test("Stapel mit Vorgaben: alle ins Fach in Erfassungsreihenfolge, Wunschliste nicht einsortiert, gelöschtes Fach stört nicht", async ({ page, catalog }) => {
  const A = isbn13("978342300001"), B = isbn13("978342300002");
  const DNB = { [A]: { title: "Momo", author: "Ende, Michael", isbn: A }, [B]: { title: "Tschick", author: "Herrndorf, Wolfgang", isbn: B } };
  catalog.dnb = cql => { const m = cql.match(/num=(\d+)/); return m && DNB[m[1]] ? [DNB[m[1]]] : []; };
  await openApp(page);
  await wall(page);
  await page.evaluate(async ([a, b]) => {
    localStorage.setItem("capturePreset", JSON.stringify({ on: true, fachKey: fachOptions()[0].key, tags: ["Flohmarkt"], status: "unread", wish: false }));
    await newStackEntry({ isbn: b, createdAt: "2026-01-01T10:00:00.000Z" });
    await newStackEntry({ isbn: a, createdAt: "2026-01-01T10:01:00.000Z" });
    openStackReview();
  }, [A, B]);
  await expect(page.locator(".stkrow.sure")).toHaveCount(2);
  await expect(page.locator(".sheet .presetbar .presettext")).toContainText("#Flohmarkt");
  await page.click(".actions.sticky .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(2);
  await expect.poll(() => fachTitles(page)).toEqual(["Tschick", "Momo"]); // wie erfasst, nicht alphabetisch
  expect(await page.evaluate(() => S.books.map(b => b.tags.join()))).toEqual(["Flohmarkt", "Flohmarkt"]);

  // Vorgabe Wunschliste: angelegt als Wunsch, nicht im Regal
  await page.evaluate(async () => {
    localStorage.setItem("capturePreset", JSON.stringify({ ...JSON.parse(localStorage.getItem("capturePreset")), wish: true }));
    await newStackEntry({ rec: { title: "Krabat", author: "Otfried Preußler" }, sure: true, lookupAt: new Date().toISOString() });
    openStackReview();
  });
  await page.click(".actions.sticky .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(3);
  expect(await page.evaluate(() => { const b = S.books.find(x => x.title === "Krabat"); return [isWish(b), !!locationOf(b.id)]; })).toEqual([true, false]);

  // Fach gibt es nicht mehr: Vorgaben gelten weiter, eingeräumt wird nicht
  const r = await page.evaluate(() => {
    localStorage.setItem("capturePreset", JSON.stringify({ on: true, fachKey: "weg:TL", tags: [], status: "reading", wish: false }));
    const p = capturePreset(); return [p.fach, p.fachKey, p.status];
  });
  expect(r).toEqual([null, "", "reading"]);
});
