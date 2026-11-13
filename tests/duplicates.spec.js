// Mögliche Dubletten: Erkennung, Zusammenführen (mit Anhängen und Regalplatz), „Sind verschiedene Bücher“, alte Sicherung.
import { test, expect, openApp } from "./helpers.js";

async function seed(page) {
  await openApp(page, "#verwaltung");
  await page.evaluate(async () => {
    const add = b => putBook({ status: "unread", rating: 0, addedAt: new Date().toISOString(), ...b });
    await add({ id: "m1", title: "Momo", author: "Michael Ende", isbn: "9783522202107", year: "1973", tags: ["Kinderbuch"], addedAt: "2024-01-01T00:00:00Z" });
    await add({ id: "m2", title: "momo ", author: "Michael  Ende", publisher: "Thienemann", tags: ["Lieblinge"], rating: 4, notes: "Geschenk von Oma",
      reads: [{ start: "2023-05-01", end: "2023-05-20", note: "" }], status: "read", addedAt: "2025-01-01T00:00:00Z" });
    await add({ id: "s1", title: "Der Steppenwolf", author: "Hermann Hesse", isbn: "3-518-36675-0" });          // ISBN-10 …
    await add({ id: "s2", title: "Steppenwolf (Taschenbuch)", author: "H. Hesse", isbn: "9783518366752" });    // … = dieselbe ISBN-13
    await add({ id: "w1", title: "Weihnachtsgeschichten am Kamin", author: "Ursula Richter", isbn: "9783499235016" });
    await add({ id: "w2", title: "Weihnachtsgeschichten am Kamin", author: "Ursula Richter", isbn: "9783499233265" }); // andere ISBN → anderer Band
    await add({ id: "h1", title: "Harry Potter", author: "J. K. Rowling", seriesNo: "1" });
    await add({ id: "h2", title: "Harry Potter", author: "J. K. Rowling", seriesNo: "2" });                    // andere Band-Nr.
    await add({ id: "x1", title: "Krabat", author: "Otfried Preußler" });
  });
  await page.waitForFunction(() => S.books.length === 9);
}
const groups = page => page.evaluate(() => dupGroups().map(g => g.map(b => b.id).sort()).sort());

test("Erkennung: gleiche ISBN (auch 10/13) oder gleicher Titel+Autor – andere ISBN/Band-Nr. zählt nicht", async ({ page }) => {
  await seed(page);
  expect(await groups(page)).toEqual([["m1", "m2"], ["s1", "s2"]]);
  await expect(page.locator("#dupRun")).toHaveText("🧩 Dubletten prüfen (4)");
  await page.click("#tfilters >> text=Mögliche Dubletten");
  await expect(page.locator("#tbl tbody tr")).toHaveCount(4);
});

test("Zusammenführen übernimmt Angaben, Lesezeiten, Bilder und den Regalplatz", async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const img = await new Promise(r => { const c = document.createElement("canvas"); c.width = c.height = 8; c.toBlob(r, "image/png"); });
    await DB.putBlob({ id: "img-a", bookId: "m2", blob: img });
    await patchBook("m2", { images: [{ id: "img-a", caption: "Widmung", size: img.size }] });
    S.shelves.walls.push({ id: "w1", name: "Wohnzimmer", columns: [{ id: "c1", modules: [newModule("1112")] }] });
    await placeBook("x1", S.shelves.walls[0].columns[0].modules[0], "TL", 0);
    await placeBook("m2", S.shelves.walls[0].columns[0].modules[0], "TL", 1);
  });

  await page.click("#dupRun");
  const card = page.locator(".dupgroup", { hasText: "Momo" });
  await expect(card.locator(".duprow")).toHaveCount(2);
  await expect(card.locator("input[type=radio]:checked")).toHaveValue("m2"); // eingeräumt → bleibt standardmäßig
  await card.locator("input[value=m1]").check();                         // trotzdem den älteren behalten
  await card.getByRole("button", { name: "Zusammenführen" }).click();
  await page.locator(".overlay.confirm").getByRole("button", { name: "Zusammenführen" }).click();
  await expect(page.locator(".dupgroup", { hasText: "Momo" })).toHaveCount(0);

  const r = await page.evaluate(async () => {
    const b = S.books.find(x => x.id === "m1");
    const blob = await DB.getBlob("img-a");
    const loc = locationOf("m1");
    return { n: S.books.length, gone: !S.books.some(x => x.id === "m2"), tomb: !!S.deleted.m2, title: b.title, isbn: b.isbn, publisher: b.publisher,
      tags: b.tags, rating: b.rating, notes: b.notes, reads: b.reads.length, status: b.status, images: b.images.map(i => i.id), blobOwner: blob && blob.bookId,
      pos: loc && loc.pos, addedAt: b.addedAt };
  });
  expect(r).toEqual({ n: 8, gone: true, tomb: true, title: "Momo", isbn: "9783522202107", publisher: "Thienemann", tags: ["Kinderbuch", "Lieblinge"], rating: 4,
    notes: "Geschenk von Oma", reads: 1, status: "read", images: ["img-a"], blobOwner: "m1", pos: 1, addedAt: "2024-01-01T00:00:00Z" });
});

test("„Sind verschiedene Bücher“ wird gemerkt, landet in der Sicherung und lässt sich wieder einlesen", async ({ page, browser }) => {
  await seed(page);
  await page.click("#dupRun");
  await page.locator(".dupgroup", { hasText: "Steppenwolf" }).getByRole("button", { name: "Sind verschiedene Bücher" }).click();
  await expect(page.locator(".dupgroup")).toHaveCount(1);
  expect(await groups(page)).toEqual([["m1", "m2"]]);

  const backup = await page.evaluate(() => buildBackup({ images: false, files: false }));
  expect(backup.books.find(b => b.id === "s1").notDup).toEqual(["s2"]);

  // zweites Gerät (leerer Browser-Kontext): Sicherung einlesen → die Entscheidung gilt dort auch
  const ctx2 = await browser.newContext();
  await ctx2.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  const p2 = await ctx2.newPage();
  await openApp(p2, "#verwaltung");
  await p2.evaluate(d => importData(d), backup);
  await p2.waitForFunction(() => S.books.length === 9);
  expect(await groups(p2)).toEqual([["m1", "m2"]]);
  await ctx2.close();
});

test("Band-Nummern: verschiedene Bände sind keine Dubletten – auch bei (falsch) gleicher ISBN", async ({ page }) => {
  await openApp(page, "#verwaltung");
  const vols = await page.evaluate(() => [
    "URSULA RICHTER (HG.). Weihnachtsgeschichten am Kamin 8 13427", "Barbara Mürmann · WEIHNACHTSGESCHICHTEN AM KAMIN · 32",
    "DIE SCHÖNSTEN WEIHNACHTSGESCHICHTEN AM KAMIN AUS 40 JAHREN", "Harry Potter Band 3", "Weihnachtsgeschichten am Kamin 12", "Momo", "1984",
  ].map(volFromText));
  expect(vols).toEqual(["8", "32", "", "3", "12", "", ""]);

  // so sieht es nach dem alten Fach-Foto-Import aus: gleiche ISBN, Band nur im Rückentext bzw. als Band-Nr.
  await page.evaluate(async () => {
    const sp = t => ({ text: t, color: "#333" });
    await putBook({ id: "r6", title: "Weihnachtsgeschichten am Kamin", author: "Ursula Richter", isbn: "9783499233265", seriesNo: "23326", spine: sp("URSULA RICHTER (HG.). Weihnachtsgeschichten am Kamin 6 13021") });
    await putBook({ id: "r7", title: "Weihnachtsgeschichten am Kamin", author: "Ursula Richter", isbn: "9783499233265", seriesNo: "23326", spine: sp("URSULA RICHTER (HG.). Weihnachtsgeschichten am Kamin 7 13262") });
    await putBook({ id: "m27", title: "Weihnachtsgeschichten am Kamin", author: "Barbara Mürmann", isbn: "9783499015601", seriesNo: "27" });
    await putBook({ id: "m28", title: "Weihnachtsgeschichten am Kamin", author: "Barbara Mürmann", isbn: "9783499015601", seriesNo: "28", notes: "Weiteres Exemplar" });
    await putBook({ id: "k1", title: "Krabat", author: "Otfried Preußler", isbn: "9783522175203", seriesNo: "" });
    await putBook({ id: "k2", title: "Krabat", author: "Otfried Preußler", isbn: "9783522175203" });
  });
  expect(await page.evaluate(() => dupGroups().map(g => g.map(b => b.id).sort()))).toEqual([["k1", "k2"]]);
  // „schon vorhanden?“: Band 9 ist nicht Band 8 – Band 7 schon (Verlagsnummer und Band-Nr. widersprechen sich nicht)
  expect(await page.evaluate(() => [
    findDuplicate({ title: "Weihnachtsgeschichten am Kamin", author: "Barbara Mürmann", seriesNo: "29" })?.id ?? null,
    findDuplicate({ title: "Weihnachtsgeschichten am Kamin", author: "Ursula Richter", seriesNo: "7" })?.id ?? null,
  ])).toEqual([null, "r7"]);
});

test("Alte Sicherung (Version 1, ohne notDup) – Dubletten werden erkannt", async ({ page }) => {
  await openApp(page, "#verwaltung");
  await page.evaluate(() => importData({ app: "buecherregal", version: 1, books: [
    { id: "o1", title: "Faust", author: "Goethe", isbn: "9783150000014", status: "read", startedAt: "2020-01-01", finishedAt: "2020-02-01", addedAt: "2020-01-01T00:00:00Z" },
    { id: "o2", title: "Faust", author: "Goethe", status: "unread", addedAt: "2021-01-01T00:00:00Z" }] }));
  await page.waitForFunction(() => S.books.length === 2);
  expect(await groups(page)).toEqual([["o1", "o2"]]);
  await page.evaluate(() => mergeBooks("o2", ["o1", "o2"]));
  const b = await page.evaluate(() => S.books[0]);
  expect([b.id, b.isbn, b.status, b.reads, b.startedAt]).toEqual(["o2", "9783150000014", "read", [{ start: "2020-01-01", end: "2020-02-01", note: "" }], undefined]);
});
