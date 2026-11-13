// Optional: Abgleich gegen einen echten CouchDB-Server prüfen (läuft nur, wenn COUCH_REAL_URL gesetzt ist).
// Beispiel:  COUCH_REAL_URL=http://localhost:5984 COUCH_REAL_USER=admin COUCH_REAL_PASS=geheim npm test -- sync-real
// Achtung: legt bei jedem Lauf eine neue Datenbank „bookshelf-test-…“ an.
import { test, expect, openApp, seedBooks } from "./helpers.js";

const URL_ = process.env.COUCH_REAL_URL;
test.skip(!URL_, "COUCH_REAL_URL nicht gesetzt");

test("Echter Server: zwei Geräte, Anhänge, Konflikt, Löschung", async ({ page, browser }) => {
  const conf = { url: URL_, db: "bookshelf-test-" + Date.now(), user: process.env.COUCH_REAL_USER || "", pass: process.env.COUCH_REAL_PASS || "", on: true };
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    const fid = uid();
    await DB.putBlob({ id: fid, bookId: "b2", blob: new Blob(["%PDF-1.4 echt"], { type: "application/pdf" }) });
    await patchBook("b2", { files: [{ id: fid, name: "x.pdf", type: "application/pdf", size: 13 }] });
  });
  expect(await page.evaluate(c => testSyncConf(c).then(i => i.db_name), conf)).toBe(conf.db);
  expect(await page.evaluate(async c => { await saveSyncConf(c); return runSync(false) || SY.lastError; }, conf)).toBe(true);

  const ctx = await browser.newContext();
  await ctx.route(url => !url.href.startsWith("http://localhost") && !url.href.startsWith(URL_), r => r.abort());
  const p2 = await ctx.newPage();
  await openApp(p2);
  expect(await p2.evaluate(async c => { await saveSyncConf(c); return runSync(false) || SY.lastError; }, conf)).toBe(true);
  expect(await p2.evaluate(async () => [S.books.length, S.books.filter(b => b.coverBlob).length, await (await DB.getBlob(S.books.find(b => b.id === "b2").files[0].id)).blob.text()]))
    .toEqual([12, 6, "%PDF-1.4 echt"]);

  await page.evaluate(() => patchBook("b1", { notes: "A" }));
  await page.waitForTimeout(20);
  await p2.evaluate(async () => { await patchBook("b1", { notes: "B neuer" }); await removeBook("b4"); });
  for (const p of [p2, page, p2]) expect(await p.evaluate(() => runSync(false) || SY.lastError)).toBe(true);
  for (const p of [page, p2]) expect(await p.evaluate(() => [S.books.find(b => b.id === "b1").notes, !!S.books.find(b => b.id === "b4")])).toEqual(["B neuer", false]);
  await ctx.close();
});
