// Abgleich mit dem eigenen CouchDB-Server: zwei Geräte, Offline-Phasen, Konflikte, Löschungen, Anhänge, alte Daten.
import { test, expect, openApp, seedBooks } from "./helpers.js";
import { FakeCouch, COUCH_URL } from "./fake-couch.js";

const CONF = { url: COUCH_URL, db: "buecherregal", user: "buecher", pass: "geheim", on: true };

/** Zweites Gerät: eigener, leerer Browser-Kontext mit demselben Server. */
async function device(browser, couch) {
  const ctx = await browser.newContext();
  await ctx.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  await couch.attach(ctx);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await openApp(page);
  return { ctx, page, errors };
}
const connect = (page, conf = CONF) => page.evaluate(async c => { await saveSyncConf(c); return runSync(false); }, conf);
const sync = page => page.evaluate(() => runSync(false));
const book = (page, id) => page.evaluate(id => { const b = S.books.find(x => x.id === id); return b && { ...b, coverBlob: !!b.coverBlob }; }, id);

test("Einrichten über die Oberfläche lädt alle Bücher auf den Server", async ({ page }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);
  await page.click("#menuBtn");
  await page.click("text=Abgleich mit eigenem Server");
  await page.fill("input[aria-label='Serveradresse']", COUCH_URL);
  await page.fill("input[aria-label='Benutzer']", "buecher");
  await page.fill("input[aria-label='Passwort']", "geheim");
  await page.click("text=Verbindung prüfen & einschalten");
  await expect(page.locator(".sybox .note")).toContainText("Abgleich aktiv");
  await expect(page.locator(".sybox .note")).toContainText("Zuletzt abgeglichen");
  expect(couch.docCount).toBe(12);
  expect(Object.keys(couch.doc("book:b1")._attachments)).toEqual(["cover"]); // ungerade Testbücher haben ein Cover
  await expect(page.locator("#syncDot")).toBeVisible();
});

test("Falsches Passwort: verständliche Meldung, App arbeitet normal weiter", async ({ page }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await page.evaluate(() => openSyncSettings());
  await page.fill("input[aria-label='Serveradresse']", COUCH_URL);
  await page.fill("input[aria-label='Benutzer']", "buecher");
  await page.fill("input[aria-label='Passwort']", "falsch");
  await page.click("text=Verbindung prüfen & einschalten");
  await expect(page.locator(".toast")).toContainText("Passwort stimmt nicht");
  expect(await page.evaluate(() => SY.conf?.on || false)).toBe(false);
  expect(couch.docCount).toBe(0);
});

test("Fehlende Datenbank wird angelegt, wenn der Benutzer das darf", async ({ page }) => {
  const couch = new FakeCouch({ create: false });
  await couch.attach(page.context());
  await openApp(page);
  expect(await page.evaluate(c => testSyncConf(c).then(i => i.db_name), CONF)).toBe("buecherregal");
});

test("Zwei Geräte: Bücher, Cover, Dateien, Buchrücken und Regal kommen vollständig an", async ({ page, browser }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    const pic = await new Promise(r => { const c = document.createElement("canvas"); c.width = 30; c.height = 30; c.toBlob(r, "image/png"); });
    const iid = uid(), fid = uid();
    await DB.putBlob({ id: iid, bookId: "b2", blob: pic });
    await DB.putBlob({ id: fid, bookId: "b2", blob: new Blob(["%PDF-1.4 Vorleser"], { type: "application/pdf" }) });
    await patchBook("b2", { images: [{ id: iid, caption: "Widmung", size: pic.size }], files: [{ id: fid, name: "Vorleser.pdf", type: "application/pdf", size: 17 }], spine: { color: "#123456", imageBlob: pic }, tags: ["Klassiker"], price: "12,90" });
    S.shelves.walls.push({ id: "w1", name: "Wohnzimmer", columns: [{ id: "c1", modules: [newModule("1112")] }] });
    await placeBook("b0", S.shelves.walls[0].columns[0].modules[0], "TL", 0);
  });
  expect(await connect(page)).toBe(true);

  const B = await device(browser, couch);
  expect(await connect(B.page)).toBe(true);
  const r = await B.page.evaluate(async () => {
    const b = S.books.find(x => x.id === "b2");
    return {
      n: S.books.length, covers: S.books.filter(x => x.coverBlob).length,
      img: (await DB.getBlob(b.images[0].id))?.blob.size > 0, pdf: await (await DB.getBlob(b.files[0].id)).blob.text(),
      spine: !!b.spine.imageBlob, tags: b.tags, price: b.price, where: locationOf("b0")?.w.name,
    };
  });
  expect(r).toEqual({ n: 12, covers: 6, img: true, pdf: "%PDF-1.4 Vorleser", spine: true, tags: ["Klassiker"], price: "12,90", where: "Wohnzimmer" });
  await expect(B.page.locator("#shelf .card")).toHaveCount(12);
  expect(B.errors).toEqual([]);
  await B.ctx.close();
});

test("Änderungen und Löschungen laufen in beide Richtungen; Offline-Phase wird nachgeholt", async ({ page, browser }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);
  await connect(page);
  const B = await device(browser, couch);
  await connect(B.page);

  // PC (A) ist aus: beide Geräte arbeiten offline weiter
  couch.down = true;
  await page.evaluate(async () => { await patchBook("b0", { notes: "von A" }); await removeBook("b5"); });
  await B.page.evaluate(() => patchBook("b1", { rating: 5 }));
  expect(await sync(page)).toBe(false);
  expect(await page.evaluate(() => SY.lastError)).toContain("nicht erreichbar");
  expect(await page.evaluate(() => S.books.find(b => b.id === "b0").notes)).toBe("von A"); // lokal gespeichert

  // PC wieder an
  couch.down = false;
  expect(await sync(page)).toBe(true);
  expect(await sync(B.page)).toBe(true);
  expect(await sync(page)).toBe(true);
  for (const p of [page, B.page]) {
    expect(await p.evaluate(() => [S.books.find(b => b.id === "b0").notes, S.books.find(b => b.id === "b1").rating, !!S.books.find(b => b.id === "b5"), S.books.length]))
      .toEqual(["von A", 5, false, 11]);
  }
  expect(couch.doc("book:b5").deletedAt).toBeTruthy();
  await B.ctx.close();
});

test("Konflikt: dasselbe Buch auf beiden Geräten geändert → die neuere Änderung gewinnt überall", async ({ page, browser }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);
  await connect(page);
  const B = await device(browser, couch);
  await connect(B.page);
  await page.evaluate(() => patchBook("b3", { notes: "ältere Notiz (A)" }));
  await page.waitForTimeout(20);
  await B.page.evaluate(() => patchBook("b3", { notes: "neuere Notiz (B)" }));
  await sync(B.page); // B zuerst auf dem Server
  await sync(page);   // A ist älter → übernimmt B
  await sync(B.page);
  for (const p of [page, B.page]) expect((await book(p, "b3")).notes).toBe("neuere Notiz (B)");

  // umgekehrte Reihenfolge: das ältere Gerät lädt zuerst hoch, das neuere überschreibt
  await B.page.evaluate(() => patchBook("b4", { notes: "älter (B)" }));
  await page.waitForTimeout(20);
  await page.evaluate(() => patchBook("b4", { notes: "neuer (A)" }));
  await sync(B.page); await sync(page); await sync(B.page);
  for (const p of [page, B.page]) expect((await book(p, "b4")).notes).toBe("neuer (A)");
  await B.ctx.close();
});

test("Unveränderte Cover werden nicht erneut hochgeladen", async ({ page }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);
  await connect(page);
  const rev = couch.doc("book:b1")._rev;
  const digest = couch.doc("book:b1")._attachments.cover.digest;
  let sentCover = null;
  page.on("request", r => { if (r.method() === "PUT" && r.url().includes("book%3Ab1")) sentCover = JSON.parse(r.postData())._attachments.cover; });
  await page.evaluate(() => patchBook("b1", { notes: "nur Notiz" }));
  await sync(page);
  expect(sentCover).toEqual({ stub: true });
  expect(couch.doc("book:b1")._rev).not.toBe(rev);
  expect(couch.doc("book:b1")._attachments.cover.digest).toBe(digest);
  expect(couch.doc("book:b1").book.notes).toBe("nur Notiz");
});

test("Alte Datensätze (ohne Zeitstempel, alte Lesedaten) werden abgeglichen und bleiben lesbar", async ({ page, browser }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await page.goto("/manifest.webmanifest");
  await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open("buecherregal", 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("books", { keyPath: "id" }); d.createObjectStore("meta", { keyPath: "key" }); };
    r.onsuccess = () => { const t = r.result.transaction("books", "readwrite"); t.objectStore("books").put({ id: "alt", title: "Momo", author: "Michael Ende", status: "read", startedAt: "2020-01-01", finishedAt: "2020-02-01" }); t.oncomplete = () => { r.result.close(); res(); }; };
  }));
  await openApp(page);
  expect(await connect(page)).toBe(true);
  const B = await device(browser, couch);
  await connect(B.page);
  expect(await B.page.evaluate(() => { const b = S.books.find(x => x.id === "alt"); return [b.title, readsOf(b)[0].start]; })).toEqual(["Momo", "2020-01-01"]);
  await B.ctx.close();
});

test("Ohne eingetragenen Server gibt es keinen Abgleich", async ({ page }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);
  await page.waitForTimeout(500);
  expect(couch.log).toEqual([]);
  expect(await page.evaluate(() => runSync(true))).toBe(false);
  await expect(page.locator("#syncDot")).toHaveCount(0);
});

test("Sicherungsdateien enthalten keine Zugangsdaten", async ({ page }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);
  await connect(page);
  const data = JSON.stringify(await page.evaluate(() => buildBackup()));
  expect(data).not.toContain("geheim");
  expect(data).not.toContain(COUCH_URL);
});

test("Große Dateien (über 2 MB) werden einzeln übertragen und kommen an", async ({ page, browser }) => {
  const couch = new FakeCouch();
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    const fid = uid();
    await DB.putBlob({ id: fid, bookId: "b0", blob: new Blob([new Uint8Array(2_500_000).fill(65)], { type: "application/epub+zip" }) });
    await patchBook("b0", { files: [{ id: fid, name: "Momo.epub", type: "application/epub+zip", size: 2_500_000 }] });
  });
  expect(await connect(page)).toBe(true);
  expect(couch.log.some(l => /^PUT buecherregal\/book:b0\/file-/.test(l))).toBe(true);
  const B = await device(browser, couch);
  await connect(B.page);
  expect(await B.page.evaluate(async () => (await DB.getBlob(S.books.find(b => b.id === "b0").files[0].id)).blob.size)).toBe(2_500_000);
  await B.ctx.close();
});

test("Handy: Abgleich-Symbol passt in die Kopfzeile", async ({ browser }) => {
  const couch = new FakeCouch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  await couch.attach(ctx);
  const page = await ctx.newPage();
  await openApp(page);
  await connect(page);
  await expect(page.locator("#syncDot")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("handy.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await ctx.close();
});
