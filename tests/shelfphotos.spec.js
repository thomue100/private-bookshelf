// Gespeicherte Fach-Fotos: schnell hintereinander fotografieren, später (auch am PC) erkennen und einsortieren,
// Weitermachen nach Neustart, Empfang über „Teilen → Bücherregal“, Abgleich und Sicherung.
import { test, expect, openApp, fixture, fixtureBytes, googleItem, isbn13 } from "./helpers.js";
import { FakeCouch, COUCH_URL } from "./fake-couch.js";

const BOOKS = [
  ["Momo", "Michael Ende", 40, 100], ["Krabat", "Otfried Preußler", 104, 194], ["Siddhartha", "Hermann Hesse", 198, 248],
  ["Buddenbrooks", "Thomas Mann", 252, 362], ["Tschick", "Wolfgang Herrndorf", 366, 436], ["Faust", "Johann Wolfgang von Goethe", 440, 520],
];
const item = (title, author, x0, x1, y0, y1, position = "standing") => ({
  kind: "book", label: "", position, title, subtitle: "", author, publisher: "", series_no: "", isbn: "",
  spine_text_vertical: `${author.split(" ").pop()}  ${title}`, spine_text_horizontal: "", text_direction: "up",
  spine_color: "#8b1e2d", text_color: "#f3e9dc", bbox: { x0: x0 / 1000, x1: x1 / 1000, y0: y0 / 800, y1: y1 / 800 }, confidence: "high",
});
const SCAN = {
  compartment: { x0: 0.02, y0: 0.0, x1: 0.99, y1: 0.99 },
  items: [...BOOKS.map(([t, a, x0, x1]) => item(t, a, x0, x1, 250, 780)), item("Der Steppenwolf", "Hermann Hesse", 60, 560, 180, 240, "lying_on_top")],
};
const ANSWER = "```json\n" + JSON.stringify(SCAN) + "\n```";
const ALL = [...BOOKS.map(([t, a]) => [t, a]), ["Der Steppenwolf", "Hermann Hesse"]];
const CONF = { url: COUCH_URL, db: "buecherregal", user: "buecher", pass: "geheim", on: true };
const SHELF_B64 = fixtureBytes("shelf.jpg").toString("base64");

function catalogFor(catalog) {
  catalog.google = q => {
    const hit = ALL.find(([t]) => q.toLowerCase().includes(t.toLowerCase()));
    return hit ? [googleItem(hit[0], hit[1], isbn13("978342" + String(ALL.indexOf(hit)).padStart(6, "0")))] : [];
  };
}
async function wallWith4er(page) {
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  await page.click("text=Ein 4er-Würfel (1112)");
  await page.click(".confirm .btn.primary");
}
async function importReview(page, n = 7) {
  await expect(page.locator(".scanlist")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".scanrow")).toHaveCount(7);
  await page.click(".actions.sticky .btn.primary");
  const cancel = page.locator(".confirm >> text=Abbrechen"); // Nachfrage „Cover suchen?“ überspringen
  await cancel.click({ timeout: 5000 }).catch(() => {});
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(n);
}
async function pickPhoto(page) {
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
}
// Foto direkt speichern (wie nach dem Fotografieren), gibt die ID zurück
const savePhotoIn = (page, fachKey = "") => page.evaluate(async ([b64, key]) => {
  const blob = await (await fetch("data:image/jpeg;base64," + b64)).blob();
  return (await savePhoto(blob, key)).id;
}, [SHELF_B64, fachKey]);
const firstFach = page => page.evaluate(() => fachOptions()[0].key);

test("Nur speichern: Fächer schnell hintereinander fotografieren, später erkennen und einsortieren", async ({ page, catalog }) => {
  catalogFor(catalog);
  await openApp(page);
  await wallWith4er(page);
  const keys = await page.evaluate(() => fachOptions().map(f => f.key));
  await page.click("text=📷 Fach-Foto einlesen");
  await page.selectOption(".sheet select[aria-label='Fach']", keys[0]);
  await page.click("text=💾 Nur speichern – später erkennen");
  await pickPhoto(page);
  await expect(page.locator(".savedok")).toContainText("Foto gespeichert");
  await expect(page.locator(".sheet select[aria-label='Fach']")).toHaveValue(keys[1]); // gleich das nächste Fach vorgewählt
  await pickPhoto(page);
  await expect(page.locator(".savedok")).toContainText("2 Fotos warten");
  expect(await page.evaluate(() => S.photos.map(p => [p.fachKey, p.blob.size > 1000, !!p.doneAt]))).toEqual([[keys[0], true, false], [keys[1], true, false]]);
  await page.click(".sheet >> text=Fertig");

  // Hinweis über dem Regal → Übersicht → erstes Foto über den Claude-Chat erkennen
  await expect(page.locator(".phbar")).toContainText("2 Fach-Fotos warten");
  await page.click(".phbar >> text=Ansehen");
  await expect(page.locator(".phcard")).toHaveCount(2);
  await page.locator(".phcard").first().locator("text=Erkennen & einsortieren").click();
  await page.click("text=💬 Über deinen Claude-Chat");
  await page.click(".sheet >> text=Erkennen starten");
  await page.locator(".bridge textarea:not([readonly])").fill(ANSWER);
  await page.click(".actions >> text=Weiter");
  await importReview(page);

  const r = await page.evaluate(() => ({ done: S.photos.map(p => !!p.doneAt), scan: S.photos[0].scan?.items.length, fach: layerList(fachOptions()[0].m, fachOptions()[0].k, "front").length }));
  expect(r).toEqual({ done: [true, false], scan: 7, fach: 6 });
  await expect(page.locator(".phbar")).toContainText("1 Fach-Foto wartet");
});

test("Erkannt, aber nicht fertig geprüft: später nur noch prüfen – ohne neue Erkennung", async ({ page, catalog }) => {
  catalogFor(catalog);
  await openApp(page);
  await wallWith4er(page);
  const id = await savePhotoIn(page, await firstFach(page));
  await page.evaluate(([id, scan]) => patchPhoto(id, { scan }), [id, SCAN]);
  await page.evaluate(() => openPhotoInbox());
  await expect(page.locator(".phcard")).toContainText("erkannt – bitte prüfen");
  await page.click(".phcard >> text=Prüfen & einsortieren");
  await expect(page.locator(".sheet")).toContainText("Schon erkannt (7 Objekte)");
  await page.click(".sheet >> text=✓ Prüfen & einsortieren");
  await importReview(page);
  expect(await page.evaluate(() => !!S.photos[0].doneAt)).toBe(true);
});

test("Android beendet die App, während Claude antwortet: beim Öffnen geht es an derselben Stelle weiter", async ({ page, catalog }) => {
  catalogFor(catalog);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8765" });
  await openApp(page);
  await wallWith4er(page);
  await page.click("text=📷 Fach-Foto einlesen");
  await page.click("text=💬 Über deinen Claude-Chat");
  await pickPhoto(page);
  await expect(page.locator(".bridge")).toBeVisible();

  await page.reload(); // App wurde im Hintergrund beendet
  await page.waitForFunction(() => S.loaded);
  await expect(page.locator(".bridge")).toBeVisible();
  await expect(page.locator(".sheet h2")).toContainText("Fach-Foto mit Claude erkennen");
  await page.evaluate(t => navigator.clipboard.writeText(t), ANSWER);
  await page.click(".bridge >> text=📥 Antwort einfügen");
  await importReview(page);
  expect(await page.evaluate(() => [S.photos.length, !!S.photos[0].doneAt, localStorage.getItem("scanPending")])).toEqual([1, true, null]);

  // Danach öffnet sich beim Start nichts mehr von selbst
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  await page.waitForTimeout(500);
  await expect(page.locator(".sheet")).toHaveCount(0);
});

test("Teilen → Bücherregal: Claudes Antwort und Fotos aus der Galerie kommen in der App an", async ({ page, catalog }) => {
  catalogFor(catalog);
  await openApp(page);
  await wallWith4er(page);
  await page.click("text=📷 Fach-Foto einlesen");
  await page.click("text=💬 Über deinen Claude-Chat");
  await pickPhoto(page);
  await expect(page.locator(".bridge")).toBeVisible();

  // So legt der Service Worker geteilten Text ab (Tests laufen ohne Service Worker)
  await page.evaluate(async t => (await caches.open("share-inbox")).put("share/1/text", new Response(t)), "Hier die Liste:\n" + ANSWER);
  await page.goto("/?share=1");
  await importReview(page);
  expect(await page.evaluate(() => [!!S.photos[0].doneAt, location.search, S.sharedAnswer ?? null])).toEqual([true, "", null]);

  // Zwei Fotos aus der Galerie teilen → landen als offene Fotos ohne Fach in der Übersicht
  await page.evaluate(async b64 => {
    const blob = await (await fetch("data:image/jpeg;base64," + b64)).blob();
    const c = await caches.open("share-inbox");
    await c.put("share/2/file-0", new Response(blob, { headers: { "content-type": "image/jpeg" } }));
    await c.put("share/2/file-1", new Response(blob, { headers: { "content-type": "image/jpeg" } }));
  }, SHELF_B64);
  await page.goto("/?share=2");
  await expect(page.locator(".sheet h2")).toHaveText("📥 Gespeicherte Fach-Fotos");
  await expect(page.locator(".phcard:not(.done)")).toHaveCount(2);
  await expect(page.locator(".phcard:not(.done)").first()).toContainText("Ohne Fach");
  expect(await page.evaluate(async () => (await (await caches.open("share-inbox")).keys()).length)).toBe(0);
});

test("Abgleich: Fach-Foto vom Handy kommt mit Bild auf den PC; erledigt und gelöscht kommen zurück", async ({ page, browser }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await page.evaluate(() => { S.shelves.walls.push({ id: "w1", name: "Wohnzimmer", columns: [{ id: "c1", modules: [newModule("1112")] }] }); return saveShelves(); });
  const key = await firstFach(page);
  const id = await savePhotoIn(page, key);
  const id2 = await savePhotoIn(page, key);
  expect(await page.evaluate(c => { saveSyncConf(c); return runSync(false); }, CONF)).toBe(true);
  const doc = couch.doc("photo:" + id);
  expect(doc.type).toBe("photo");
  expect(Object.keys(doc._attachments)).toEqual(["image"]);
  expect(doc.photo.blob).toBeUndefined();

  // PC
  const ctx = await browser.newContext();
  await ctx.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  await couch.attach(ctx);
  const pc = await ctx.newPage();
  await openApp(pc);
  expect(await pc.evaluate(c => { saveSyncConf(c); return runSync(false); }, CONF)).toBe(true);
  expect(await pc.evaluate(id => { const p = S.photos.find(x => x.id === id); return [p.fachKey, p.blob.size > 1000, fachName(p.fachKey)]; }, id)).toEqual([key, true, expect.stringContaining("Wohnzimmer")]);

  // Am PC einsortiert, am Handy gelöscht
  await pc.evaluate(id => patchPhoto(id, { doneAt: new Date().toISOString() }), id);
  expect(await pc.evaluate(() => runSync(false))).toBe(true);
  await page.evaluate(id2 => deletePhoto(S.photos.find(p => p.id === id2)), id2);
  expect(await page.evaluate(() => runSync(false))).toBe(true);
  expect(await page.evaluate(id => !!S.photos.find(p => p.id === id).doneAt, id)).toBe(true);
  expect(await pc.evaluate(() => runSync(false))).toBe(true);
  expect(await pc.evaluate(id2 => { const p = S.photos.find(x => x.id === id2); return [!!p.deletedAt, !!p.blob]; }, id2)).toEqual([true, false]);
  expect(await pc.evaluate(() => openPhotos().length)).toBe(0);
  // Nach Änderungen (nur Verweis aufs Bild geschickt) ist das Bild auf dem Server weiter vorhanden
  expect(couch.doc("photo:" + id)._attachments.image).toBeTruthy();
  await ctx.close();
});

test("Sicherung: offene Fach-Fotos mit Bild, erledigte nur als Angabe – Import auf anderem Gerät", async ({ page, browser }) => {
  await openApp(page);
  const open = await savePhotoIn(page, "");
  const done = await savePhotoIn(page, "");
  await page.evaluate(id => patchPhoto(id, { doneAt: new Date().toISOString() }), done);
  const data = await page.evaluate(() => buildBackup());
  expect(data.photos.map(p => [p.id, !!p.imageData, !!p.blob])).toEqual([[open, true, false], [done, false, false]]);

  const ctx = await browser.newContext();
  await ctx.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  const p2 = await ctx.newPage();
  await openApp(p2);
  expect(await p2.evaluate(d => importData(d), data)).toContain("2 Fach-Foto(s) übernommen");
  expect(await p2.evaluate(() => [openPhotos().map(p => p.blob.size > 1000), S.photos.filter(p => p.doneAt).length])).toEqual([[true], 1]);
  // Nochmal importieren ändert nichts
  expect(await p2.evaluate(d => importData(d), data)).not.toContain("Fach-Foto");
  await ctx.close();
});
