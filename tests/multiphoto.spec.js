// Stufe 8 – Ein Fach in mehreren Fotos: aufnehmen (links → rechts), jedes Foto erkennen, zusammengesetzt prüfen,
// Bücher am Übergang nur einmal; gespeicherte Fotos nachträglich zusammenfassen und trennen; alte Einzelfotos unverändert.
import { test, expect, openApp, fixture, fixtureBytes, googleItem, isbn13, claudeShelf } from "./helpers.js";

const item = (title, author, x0, x1) => ({ kind: "book", position: "standing", title, author, text_direction: "up", bbox: { x0, x1, y0: 0.3, y1: 0.95 }, confidence: "high" });
const TITLES = ["Momo", "Krabat", "Tschick", "Siddhartha"];
function catalogFor(catalog) {
  catalog.google = q => { q = q.toLowerCase(); const t = TITLES.find(x => q.includes(x.toLowerCase())); return t ? [googleItem(t, "Autor " + t, isbn13("97834200" + String(TITLES.indexOf(t)).padStart(4, "0")))] : []; };
}
// Zwei gespeicherte, schon erkannte Fotos anlegen (wie nach einem Sammelauftrag); groupIt: als ein Fach
async function twoPhotos(page, scanA, scanB, groupIt = true) {
  await page.evaluate(async ({ b64, scanA, scanB, groupIt }) => {
    const blob = await (await fetch("data:image/jpeg;base64," + b64)).blob();
    const a = await putPhoto({ id: "pa", createdAt: "2026-11-20T10:00:00Z", fachKey: "", blob, w: 800, h: 600, scan: scanA });
    await putPhoto({ id: "pb", createdAt: "2026-11-20T10:01:00Z", fachKey: "", blob, w: 800, h: 600, scan: scanB, ...(groupIt ? { partOf: a.id, part: 2 } : {}) });
  }, { b64: fixtureBytes("shelf.jpg").toString("base64"), scanA, scanB, groupIt });
}
const comp = { x0: 0, y0: 0, x1: 1, y1: 1 };
const rows = page => page.locator(".scanrow");

test("Zwei Fotos eines Fachs: zusammen geprüft, das Buch am Übergang zählt einmal, beide Fotos erledigt", async ({ page, catalog }) => {
  catalogFor(catalog);
  await openApp(page);
  await twoPhotos(page, { compartment: comp, items: [item("Momo", "Michael Ende", .1, .3), item("Krabat", "Otfried Preußler", .4, .6), item("Tschick", "Wolfgang Herrndorf", .8, .95)] },
    { compartment: comp, items: [item("Tschick", "Wolfgang Herrndorf", .02, .2), item("Siddhartha", "Hermann Hesse", .3, .5)] });
  // Prüfen-Liste: nur ein Eintrag (erstes Foto), mit beiden Bildern
  const ready = await page.evaluate(() => scannedPhotos().map(p => p.id));
  expect(ready).toEqual(["pa"]);
  await page.evaluate(() => openPhotoInbox());
  await expect(page.locator(".phcard")).toHaveCount(1);
  await expect(page.locator(".phcard")).toContainText("2 Fotos von einem Fach");
  await expect(page.locator(".phcard .phstrip img")).toHaveCount(2);
  await page.locator(".phcard button:text-is('Prüfen & einsortieren')").click();
  await page.locator(".sheet button:text-is('✓ Prüfen & einsortieren')").click();
  await expect(rows(page)).toHaveCount(5, { timeout: 20_000 });
  // Tschick vom zweiten Foto: übersprungen, mit Hinweis auf Nr. 3
  await expect(rows(page).nth(3).locator(".scancb input")).not.toBeChecked();
  await expect(rows(page).nth(3)).toContainText("dasselbe Buch wie Nr. 3");
  await expect(rows(page).nth(4)).toContainText("Foto 2");
  // Rahmen sind aufs Gesamtbild umgerechnet: zweites Foto rechts
  const rv = await page.evaluate(() => S.photos.find(p => p.id === "pa").review);
  expect(rv.group).toBe("pa,pb");
  expect(rv.items[4].bbox.x0).toBeGreaterThan(0.5);
  expect(rv.items[0].bbox.x1).toBeLessThan(0.5);
  await page.click(".actions.sticky .btn.primary");
  await page.locator(".confirm >> text=Abbrechen").click({ timeout: 2000 }).catch(() => {});
  await expect.poll(() => page.evaluate(() => S.books.map(b => b.title))).toEqual(["Momo", "Krabat", "Tschick", "Siddhartha"]);
  expect(await page.evaluate(() => S.photos.filter(p => p.doneAt).map(p => p.id).sort())).toEqual(["pa", "pb"]);
});

test("Aufnehmen in mehreren Fotos: Abschnitt für Abschnitt, dann erkennt die App jedes Foto und setzt sie zusammen", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  // beide Fotos zeigen dieselben zwei Bücher (volle Überlappung) → jedes Buch nur einmal
  await page.context().route("https://api.anthropic.com/**", claudeShelf({ compartment: comp, items: [item("Momo", "Michael Ende", .1, .3), item("Krabat", "Otfried Preußler", .5, .7)] }, { log }));
  await openApp(page);
  await page.evaluate(() => { localStorage.setItem("aiKey", "sk-ant-test"); localStorage.setItem("aiJudge", "0"); openShelfScan(); });
  await page.getByText("Fach passt nicht auf ein Foto").click();
  let chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  await expect(page.locator(".sheet .savedok")).toContainText("✓ Foto 1 gespeichert");
  chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Nächstes Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  await expect(page.locator(".sheet .savedok")).toContainText("✓ Foto 2 gespeichert");
  await expect(page.locator(".sheet .phstrip img")).toHaveCount(2);
  expect(await page.evaluate(() => S.photos.map(p => [p.part || 1, !!p.partOf]))).toEqual([[1, false], [2, true]]);
  await page.click("[data-groupdone]");
  await expect(rows(page)).toHaveCount(4, { timeout: 30_000 });
  expect(log.filter(b => b.output_config?.format?.schema?.properties?.items)).toHaveLength(2); // jedes Foto: eigene Übersicht
  expect(await page.evaluate(() => [...document.querySelectorAll(".scanrow .scancb input")].map(i => i.checked))).toEqual([true, true, false, false]);
  expect(await page.evaluate(() => S.photos.every(p => p.scan))).toBe(true);
});

test("Gespeicherte Fotos nachträglich zusammenfassen und wieder trennen; Einzelfotos wie bisher", async ({ page }) => {
  await openApp(page);
  const one = { compartment: comp, items: [item("Momo", "Michael Ende", .1, .3)] };
  await twoPhotos(page, one, one, false);
  await page.evaluate(() => openPhotoInbox());
  await expect(page.locator(".phcard")).toHaveCount(2);
  await page.locator(".phcard").first().locator("[data-join]").click();
  await expect(page.locator(".phcard")).toHaveCount(1);
  expect(await page.evaluate(() => { const b = S.photos.find(p => p.id === "pb"); return [b.partOf, b.part]; })).toEqual(["pa", 2]);
  await page.locator(".phcard [data-split]").click();
  await expect(page.locator(".phcard")).toHaveCount(2);
  expect(await page.evaluate(() => { const b = S.photos.find(p => p.id === "pb"); return [b.partOf ?? null, b.part ?? null]; })).toEqual([null, null]);
  // Einzelfoto: Gruppe aus einem Foto
  expect(await page.evaluate(() => photoGroup(S.photos.find(p => p.id === "pa")).map(p => p.id))).toEqual(["pa"]);
});

test("Sicherung: ein Fach aus mehreren Fotos bleibt nach dem Einlesen zusammen (Felder nur ergänzt)", async ({ page }) => {
  await openApp(page);
  const one = { compartment: comp, items: [item("Momo", "Michael Ende", .1, .3)] };
  await twoPhotos(page, one, one, true);
  const backup = await page.evaluate(async () => JSON.parse(JSON.stringify(await buildBackup())));
  expect(backup.photos.find(p => p.id === "pb")).toMatchObject({ partOf: "pa", part: 2 });
  expect(backup.photos.find(p => p.id === "pa").partOf).toBeUndefined();
  // frisches Gerät: Sicherung einlesen
  await page.evaluate(async () => { for (const p of [...S.photos]) { await DB.delPhoto?.(p.id); } S.photos = []; });
  await page.evaluate(async b => { await importData(b); }, backup);
  expect(await page.evaluate(() => photoGroup(S.photos.find(p => p.id === "pb")).map(p => p.id))).toEqual(["pa", "pb"]);
});
