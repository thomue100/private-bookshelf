// „📏 Maße nachtragen“: Höhe, Dicke und Rückenbild aus gespeicherten Fach-Fotos, DNB und Google Books – nur was fehlt.
import { test, expect, openApp, isbn13, googleItem } from "./helpers.js";

const I1 = isbn13("978342312345"), I2 = isbn13("978342312346");
const base = { status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z" };
const spine = (page, id) => page.evaluate(id => { const s = S.books.find(b => b.id === id).spine; if (!s) return s; const { imageBlob, ...r } = s; return { ...r, img: !!imageBlob }; }, id);
const run = async page => {
  await page.evaluate(() => { S.heightPause = 0; measureRun(); });
  await expect(page.locator(".sheet .saved", { hasText: "Fertig:" })).toBeVisible({ timeout: 20_000 });
};

test("Google-Books-Maße: Einheiten werden in cm umgerechnet, Unsinn verworfen", async ({ page }) => {
  await openApp(page);
  expect(await page.evaluate(() => ["21.00 cm", "20,5 cm", "24 mm", "8.5 in", "", null].map(dimCm))).toEqual([21, 20.5, 2.4, 21.6, 0, 0]);
});

test("Höhe und Dicke aus Google Books, wenn die DNB nichts hat; vorhandene Werte bleiben", async ({ page, catalog }) => {
  catalog.google = q => q === "isbn:" + I1 ? [{ ...googleItem("Momo", "Michael Ende", I1), id: "vol1" }] : q === "isbn:" + I2 ? [{ ...googleItem("Tschick", "Wolfgang Herrndorf", I2), id: "vol2" }] : [];
  catalog.googleVolume = id => ({ vol1: { volumeInfo: { dimensions: { height: "20.50 cm", width: "12.00 cm", thickness: "2.40 cm" } } }, vol2: { volumeInfo: { dimensions: { height: "19.00 cm", thickness: "90 cm" } } } })[id];
  await openApp(page);
  await page.evaluate(([i1, i2, base]) => Promise.all([
    putBook({ ...base, id: "a", title: "Momo", isbn: i1 }),                                   // alter Datensatz ohne spine
    putBook({ ...base, id: "b", title: "Tschick", isbn: i2, spine: { heightCm: 22, color: "#123456" } }), // Höhe selbst gemessen
  ]), [I1, I2, base]);
  await run(page);
  expect(await spine(page, "a")).toEqual({ heightCm: 20.5, thickCm: 2.4, img: false });
  expect(await spine(page, "b")).toEqual({ heightCm: 22, color: "#123456", img: false }); // 90 cm Dicke ist Unsinn → bleibt leer
});

test("Gespeichertes Fach-Foto: Rücken wird dem Buch im Fach zugeordnet – Höhe, Dicke und Rückenbild", async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    S.shelves.walls.push({ id: "w1", name: "Wohnzimmer", columns: [{ id: "c1", modules: [newModule("1112")] }] });
    const f = fachOptions()[0];
    await putBook({ status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z", id: "k", title: "Krabat", author: "Otfried Preußler" });
    await putBook({ status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z", id: "s", title: "Siddhartha", author: "Hermann Hesse", spine: { heightCm: 18, thickCm: 1.2 } });
    await putBook({ status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z", id: "x", title: "Krabat", author: "Otfried Preußler" }); // gleiches Buch, anderes Fach
    layerList(f.m, f.k, "front").push("k", "s");
    await saveShelves();
    const c = document.createElement("canvas"); c.width = 400; c.height = 300; const g = c.getContext("2d"); g.fillStyle = "#468"; g.fillRect(0, 0, 400, 300); g.fillStyle = "#c33"; g.fillRect(40, 90, 24, 180);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg"));
    await putPhoto({ id: "p1", createdAt: new Date().toISOString(), fachKey: f.key, blob, w: 400, h: 300, doneAt: new Date().toISOString(),
      scan: { compartment: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [
        { title: "Krabat", author: "Preußler", bbox: { x0: 0.1, x1: 0.16, y0: 0.3, y1: 0.9 }, spine_color: "#cc3333" },
        { title: "Siddhartha", author: "Hesse", bbox: { x0: 0.2, x1: 0.25, y0: 0.4, y1: 0.9 } },
        { title: "Unbekannt", bbox: { x0: 0.3, x1: 0.35, y0: 0.4, y1: 0.9 } }] } });
  });
  await run(page);
  expect(await spine(page, "k")).toEqual({ heightCm: 19.8, thickCm: 2, color: "#cc3333", img: true });
  expect(await spine(page, "s")).toEqual({ heightCm: 18, thickCm: 1.2, img: true }); // Maße bleiben, nur das Bild kommt dazu
  expect(await spine(page, "x")).toBeUndefined();                                    // steht nicht in diesem Fach
});

test("Keine Maße im Katalog wird gemerkt: nächster Lauf fragt nicht erneut, „Trotzdem neu fragen“ schon", async ({ page, catalog }) => {
  const asked = [];
  catalog.dnb = cql => { asked.push(cql); return []; };
  await openApp(page);
  await page.evaluate(([i1, base]) => putBook({ ...base, id: "a", title: "Momo", isbn: i1 }), [I1, base]);
  await run(page);
  expect(asked).toEqual([`num=${I1}`]);
  expect(await page.evaluate(async () => Object.keys(await DB.getMeta("measureMiss")))).toEqual(["a"]);
  expect(await page.evaluate(async () => (await buildBackup()).measureMiss)).toBeUndefined();
  await page.evaluate(() => closeSheet());
  await page.evaluate(() => measureRun());
  await expect(page.locator(".sheet .note")).toContainText("1 Buch wird übersprungen");
  expect(asked.length).toBe(1);
  await page.click("text=Trotzdem neu fragen");
  await expect(page.locator(".sheet .saved", { hasText: "Fertig:" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".sheet .covlog .covrow b")).toHaveText(["Momo"]); // wieder gesucht (Antwort ggf. aus dem 30-Minuten-Zwischenspeicher)
});

test("Fach-Foto übernehmen: vorhandenes Buch bekommt fehlende Maße, Vorhandenes bleibt", async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => [
    mergeSpine({ heightCm: 24, text: "Alt" }, { heightCm: 20, thickCm: 2, color: "#111111", text: "Neu", mode: "quer" }),
    mergeSpine(undefined, { thickCm: 1.5 }),
    mergeSpine({ heightCm: 24, thickCm: 2 }, { heightCm: 20, thickCm: 3 }),
  ]);
  expect(r).toEqual([{ heightCm: 24, text: "Alt", thickCm: 2, color: "#111111" }, { thickCm: 1.5 }, null]);
});
