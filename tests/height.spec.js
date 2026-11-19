// Buchhöhe aus der DNB (MARC 300 $c) und lobid („… ; 21 cm“): beim Anlegen, „Leere Felder online ergänzen“, Sammellauf.
// Eine vorhandene (gemessene, aus dem Fach-Foto berechnete) Höhe wird nie überschrieben.
import { test, expect, openApp, isbn13 } from "./helpers.js";

const I1 = isbn13("978342312345"), I2 = isbn13("978342312346"), I3 = isbn13("978342312347");
const DNB = {
  [I1]: { title: "Der Vorleser", author: "Schlink, Bernhard", publisher: "Diogenes", year: "1997", isbn: I1, extent: "207 S.", format: "21 x 13,5 cm" },
  [I2]: { title: "Momo", author: "Ende, Michael", publisher: "Thienemann", year: "1973", isbn: I2, extent: "304 S.", format: "24 x 17 cm" },
  [I3]: { title: "Tschick", author: "Herrndorf, Wolfgang", publisher: "Rowohlt", year: "2010", isbn: I3, extent: "254 S." }, // ohne $c
};
const dnbByIsbn = cql => { const m = cql.match(/num=(\d+)/); return m && DNB[m[1]] ? [DNB[m[1]]] : []; };
const book = (page, id) => page.evaluate(id => S.books.find(b => b.id === id), id);

test("Formatangabe: erste Zahl ist die Höhe, Komma als Dezimalzeichen, Unsinn wird verworfen", async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => ["21 cm", "19 cm", "24 x 17 cm", "21 x 13,5 cm", "20,5 cm", "ca. 18cm", "12 × 19 cm",
    "45 cm", "5 cm", "123 cm", "300 S.", "", null].map(heightFromFormat));
  expect(r).toEqual([21, 19, 24, 21, 20.5, 18, 12, 0, 0, 0, 0, 0, 0]);
  // lobid: Umfang und Format in einem Feld; Hörbücher bekommen keine Höhe
  const l = await page.evaluate(() => [fromLobid({ title: "X", extent: "317 S. ; 21 cm" }).heightCm, fromLobid({ title: "Y", extent: "1 CD ; 12 cm", type: ["Audio"] }).heightCm, fromLobid({ title: "Z" }).heightCm]);
  expect(l).toEqual([21, undefined, undefined]);
});

test("ISBN erfassen: Höhe aus der DNB landet im Buchrücken; ohne $c keine Höhe", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await openApp(page);
  for (const isbn of [I1, I3]) {
    await page.evaluate(() => openAdd());
    const inp = page.getByPlaceholder("ISBN eintippen oder Link einfügen");
    await inp.fill(isbn);
    await inp.press("Enter");
    await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
    await page.click(".actions .btn.primary");
    await expect(page.locator(".sheet")).toHaveCount(0);
  }
  const r = await page.evaluate(([a, b]) => [S.books.find(x => x.isbn === a).spine, S.books.find(x => x.isbn === b).spine], [I1, I3]);
  expect(r[0]).toEqual({ heightCm: 21 });
  expect(r[1]).toBeUndefined();
});

test("„Leere Felder online ergänzen“ trägt eine fehlende Höhe nach und behält den übrigen Rücken; vorhandene Höhe bleibt", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await openApp(page);
  await page.evaluate(([i1, i2]) => Promise.all([
    putBook({ id: "a", title: "Der Vorleser", author: "Bernhard Schlink", isbn: i1, status: "unread", rating: 0, notes: "", addedAt: new Date().toISOString(), spine: { color: "#123456", thickCm: 1.4 } }),
    putBook({ id: "m", title: "Momo", author: "Michael Ende", isbn: i2, status: "unread", rating: 0, notes: "", addedAt: new Date().toISOString(), spine: { heightCm: 18.5 } }),
  ]), [I1, I2]);
  for (const id of ["a", "m"]) {
    await page.evaluate(id => openDetail(id, true), id);
    await page.click("text=🔎 Leere Felder online ergänzen");
    if (id === "a") { await expect(page.locator(".toast")).toContainText("Höhe (21 cm)"); await page.click("text=💾 Speichern"); }
    await page.waitForTimeout(300);
    await page.evaluate(() => closeSheet());
  }
  await expect.poll(async () => (await book(page, "a")).spine).toEqual({ color: "#123456", thickCm: 1.4, heightCm: 21 });
  expect((await book(page, "m")).spine).toEqual({ heightCm: 18.5 });
});

test("Verwaltung: Buchhöhen aus der DNB nachtragen – nur Bücher mit ISBN ohne Höhe, alte Bücher ohne Rücken gehen mit", async ({ page, catalog }) => {
  const asked = [];
  catalog.dnb = cql => { asked.push(cql); return dnbByIsbn(cql); };
  await openApp(page, "#verwaltung");
  await page.evaluate(([i1, i2, i3]) => {
    S.heightPause = 0;
    const base = { status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z" };
    return Promise.all([
      putBook({ ...base, id: "alt", title: "Momo", isbn: i2 }),                                // alter Datensatz ohne spine
      putBook({ ...base, id: "eig", title: "Der Vorleser", isbn: i1, spine: { heightCm: 30 } }),  // selbst gemessen
      putBook({ ...base, id: "ohne", title: "Tschick", isbn: i3 }),                              // DNB ohne Format
      putBook({ ...base, id: "kein", title: "Ohne ISBN" }),
      putBook({ ...base, id: "wun", title: "Wunsch", isbn: i1, wish: true }),
    ]);
  }, [I1, I2, I3]);
  await page.click("#heightRun");
  await expect(page.locator(".sheet .saved")).toContainText("Fertig: 1 Höhen nachgetragen, 1 ohne Angabe.");
  expect(asked.sort()).toEqual([`num=${I2}`, `num=${I3}`].sort());
  const r = await page.evaluate(() => ["alt", "eig", "ohne", "kein"].map(id => S.books.find(b => b.id === id).spine?.heightCm ?? null));
  expect(r).toEqual([24, 30, null, null]);
});
