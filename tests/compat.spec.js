// Die wichtigste Zusage der App: vorhandene Daten und alte Sicherungen funktionieren weiter.
import { test, expect, openApp, seedBooks, fixture } from "./helpers.js";
import { readFileSync } from "node:fs";

test("Datenbank im alten Format (Version 1) wird beim Öffnen übernommen", async ({ page }) => {
  await page.goto("/manifest.webmanifest"); // gleiche Herkunft, aber App noch nicht gestartet
  await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open("buecherregal", 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("books", { keyPath: "id" }); d.createObjectStore("meta", { keyPath: "key" }); };
    r.onsuccess = () => {
      const t = r.result.transaction("books", "readwrite");
      t.objectStore("books").put({ id: "v1book", title: "Krabat", author: "Otfried Preußler", status: "unread", rating: 0, addedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
      t.oncomplete = () => { r.result.close(); res(); };
    };
  }));
  await openApp(page);
  expect(await page.evaluate(() => S.books.map(b => b.title))).toEqual(["Krabat"]);
  expect(await page.evaluate(async () => (await indexedDB.databases()).find(d => d.name === "buecherregal").version)).toBe(3);
  await expect(page.locator("#shelf .card")).toHaveCount(1);
});

test("Datenbank Version 2 (Bücher, Bilder, Regal) wird um Fach-Fotos erweitert, alles bleibt erhalten", async ({ page }) => {
  await page.goto("/manifest.webmanifest");
  await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open("buecherregal", 2);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("books", { keyPath: "id" }); d.createObjectStore("meta", { keyPath: "key" }); d.createObjectStore("blobs", { keyPath: "id" }).createIndex("bookId", "bookId"); };
    r.onsuccess = () => {
      const t = r.result.transaction(["books", "meta", "blobs"], "readwrite");
      t.objectStore("books").put({ id: "v2book", title: "Momo", author: "Michael Ende", status: "read", rating: 4, addedAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", images: [{ id: "img1", caption: "Widmung", size: 3 }] });
      t.objectStore("blobs").put({ id: "img1", bookId: "v2book", blob: new Blob(["abc"], { type: "image/png" }) });
      t.objectStore("meta").put({ key: "shelves", value: { walls: [{ id: "w1", name: "Flur", columns: [] }], updatedAt: "2025-01-01T00:00:00Z" } });
      t.oncomplete = () => { r.result.close(); res(); };
    };
  }));
  await openApp(page);
  const r = await page.evaluate(async () => ({
    titles: S.books.map(b => b.title), wall: S.shelves.walls[0]?.name, photos: S.photos.length,
    blob: (await DB.getBlob("img1"))?.blob.size, version: (await indexedDB.databases()).find(d => d.name === "buecherregal").version,
  }));
  expect(r).toEqual({ titles: ["Momo"], wall: "Flur", photos: 0, blob: 3, version: 3 });
  // Sicherung ohne Fach-Fotos sieht aus wie bisher (kein neues Feld)
  expect(Object.keys(await page.evaluate(() => buildBackup()))).toEqual(["app", "version", "exportedAt", "books", "deleted", "shelves"]);
});

test("Sicherung Version 1 lässt sich importieren; alte Lesedaten werden zu Lesezeiträumen", async ({ page }) => {
  await openApp(page);
  await page.click("#menuBtn");
  const chooser = page.waitForEvent("filechooser");
  await page.click("text=Sicherung importieren");
  await (await chooser).setFiles(fixture("backup-v1.json"));
  await expect(page.locator(".toast")).toContainText("1 neu");
  const b = await page.evaluate(() => { const b = S.books.find(x => x.id === "old1"); return { title: b.title, reads: readsOf(b), notes: b.notes }; });
  expect(b.title).toBe("Momo");
  expect(b.notes).toBe("Alte Sicherung");
  expect(b.reads).toHaveLength(1);
  expect(b.reads[0]).toMatchObject({ start: "2020-01-01", end: "2020-02-01" });
});

test("Sicherung hin und zurück: Cover, Anhänge, Buchrücken und Regal bleiben erhalten", async ({ page, browser }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    const img = await new Promise(r => { const c = document.createElement("canvas"); c.width = 20; c.height = 20; c.toBlob(r, "image/png"); });
    const iid = uid(), fid = uid();
    await DB.putBlob({ id: iid, bookId: "b2", blob: img });
    await DB.putBlob({ id: fid, bookId: "b2", blob: new Blob(["%PDF-1.4 test"], { type: "application/pdf" }) });
    await patchBook("b2", { images: [{ id: iid, caption: "Widmung", size: img.size }], files: [{ id: fid, name: "Vorleser.pdf", type: "application/pdf", size: 13 }],
      signed: true, signedBy: "Bernhard Schlink", dedication: "Für Thomas", price: "12,90", value: "20", tags: ["Klassiker"], series: "Reihe", seriesNo: "2",
      reads: [{ start: "2021-01-01", end: "2021-02-01", note: "" }], gone: null, spine: { color: "#123456", imageBlob: img } });
    await patchBook("b4", { gone: { how: "verschenkt", to: "Anna", date: "2024-05-01", note: "Geburtstag" } });
    await patchBook("b5", { wish: true });
    S.shelves.walls.push({ id: "w1", name: "Wohnzimmer", columns: [{ id: "c1", modules: [newModule("1112")] }] });
    await placeBook("b0", S.shelves.walls[0].columns[0].modules[0], "TL", 0);
    await placeBook("b1", S.shelves.walls[0].columns[0].modules[0], "TL", 0, "back");
  });
  const data = await page.evaluate(() => buildBackup({ images: true, files: true }));
  expect(data).toMatchObject({ app: "buecherregal", version: 2 });

  // Zweites „Gerät“: leerer Browser-Kontext
  const ctx2 = await browser.newContext();
  await ctx2.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  const p2 = await ctx2.newPage();
  await openApp(p2);
  const msg = await p2.evaluate(d => importData(d), data);
  expect(msg).toContain("12 neu");
  expect(msg).toContain("Regal-Aufstellung übernommen");
  const r = await p2.evaluate(async () => {
    const b = S.books.find(x => x.id === "b2");
    return {
      cover: S.books.filter(x => x.coverBlob).length,
      img: !!(await DB.getBlob(b.images[0].id)), file: !!(await DB.getBlob(b.files[0].id)),
      fields: [b.signedBy, b.dedication, b.price, b.value, b.tags, b.series, b.seriesNo, readsOf(b).length],
      spine: !!b.spine.imageBlob, gone: S.books.find(x => x.id === "b4").gone.to, wish: isWish(S.books.find(x => x.id === "b5")),
      loc0: locationOf("b0")?.layer, loc1: locationOf("b1")?.layer,
    };
  });
  expect(r).toEqual({ cover: 6, img: true, file: true, fields: ["Bernhard Schlink", "Für Thomas", "12,90", "20", ["Klassiker"], "Reihe", "2", 1], spine: true, gone: "Anna", wish: true, loc0: "front", loc1: "back" });
  await ctx2.close();
});

test("Abgleich: neuere Änderung gewinnt, Löschungen werden übernommen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  const backup = await page.evaluate(() => buildBackup());
  // Lokal: b0 neuer bearbeitet; in der Sicherung: b1 neuer und b2 gelöscht
  await page.evaluate(() => patchBook("b0", { notes: "lokal neuer" }));
  const later = new Date(Date.now() + 60_000).toISOString();
  backup.books.find(b => b.id === "b1").notes = "aus Sicherung";
  backup.books.find(b => b.id === "b1").updatedAt = later;
  backup.books.find(b => b.id === "b0").notes = "alt";
  backup.books = backup.books.filter(b => b.id !== "b2");
  backup.deleted = { b2: later };
  const msg = await page.evaluate(d => importData(d), backup);
  expect(msg).toContain("1 aktualisiert");
  expect(msg).toContain("1 gelöscht");
  expect(await page.evaluate(() => [S.books.find(b => b.id === "b0").notes, S.books.find(b => b.id === "b1").notes, !!S.books.find(b => b.id === "b2")]))
    .toEqual(["lokal neuer", "aus Sicherung", false]);
});

test("Mitgelieferte Beispiel-Sicherung ist gültiges JSON im erwarteten Format", () => {
  const d = JSON.parse(readFileSync(fixture("backup-v1.json"), "utf8"));
  expect(d.app).toBe("buecherregal");
  expect(Array.isArray(d.books)).toBe(true);
});
