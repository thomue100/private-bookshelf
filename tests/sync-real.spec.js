// Optional: Abgleich gegen einen echten CouchDB-Server prüfen (läuft nur, wenn COUCH_REAL_URL gesetzt ist).
//
// Empfohlen: eine eigene Test-Datenbank, in der der App-Benutzer Mitglied ist (z. B. „buecherregal-test“), dann reicht der App-Benutzer:
//   PowerShell:  $env:COUCH_REAL_URL="https://mein-pc.tailXXXX.ts.net"; $env:COUCH_REAL_DB="buecherregal-test"
//                $env:COUCH_REAL_USER="buecher"; $env:COUCH_REAL_PASS="…"; npx playwright test sync-real
//   bash:        COUCH_REAL_URL=… COUCH_REAL_DB=buecherregal-test COUCH_REAL_USER=buecher COUCH_REAL_PASS=… npx playwright test sync-real
// Die Test-Datenbank wird vor und nach dem Lauf geleert. Zum Schutz der echten Bücher muss ihr Name „test“ enthalten.
// Ohne COUCH_REAL_DB wird wie früher je Lauf eine neue Datenbank „bookshelf-test-…“ angelegt (dafür braucht der Benutzer Admin-Rechte).
import { test, expect, openApp, seedBooks } from "./helpers.js";

const URL_ = (process.env.COUCH_REAL_URL || "").replace(/\/+$/, "");
const USER = process.env.COUCH_REAL_USER || "", PASS = process.env.COUCH_REAL_PASS || "";
const DBNAME = process.env.COUCH_REAL_DB || "bookshelf-test-" + Date.now();
test.skip(!URL_, "COUCH_REAL_URL nicht gesetzt");

const auth = USER ? { Authorization: "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64") } : {};
async function couch(path, opt = {}) {
  const r = await fetch(`${URL_}/${encodeURIComponent(DBNAME)}${path}`, { ...opt, headers: { "Content-Type": "application/json", ...auth, ...(opt.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
/** Alle Dokumente der Test-Datenbank löschen (als Mitglied erlaubt, kein Admin nötig). */
async function emptyTestDb() {
  if (!/test/i.test(DBNAME)) throw new Error(`Sicherheitsstopp: „${DBNAME}“ enthält nicht „test“ – echte Bücher werden nie geleert.`);
  const all = await couch("/_all_docs");
  if (all.status === 404) return; // gibt es noch nicht – legt die App selbst an, wenn sie darf
  expect(all.status, "Test-Datenbank lesbar? Ist der Benutzer dort Mitglied?").toBe(200);
  const docs = all.body.rows.filter(r => !r.id.startsWith("_design/")).map(r => ({ _id: r.id, _rev: r.value.rev, _deleted: true }));
  if (docs.length) expect((await couch("/_bulk_docs", { method: "POST", body: JSON.stringify({ docs }) })).status).toBe(201);
}

test.beforeAll(emptyTestDb);
test.afterAll(emptyTestDb);

test("Echter Server: zwei Geräte, Anhänge, Konflikt, Löschung", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const conf = { url: URL_, db: DBNAME, user: USER, pass: PASS, on: true };
  await page.context().route(url => url.href.startsWith(URL_ + "/"), r => r.continue()); // nur den eigenen Server durchlassen (Rest bleibt gesperrt)
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
  await ctx.route(url => !url.href.startsWith("http://localhost") && !url.href.startsWith(URL_ + "/"), r => r.abort());
  const p2 = await ctx.newPage();
  await openApp(p2);
  expect(await p2.evaluate(async c => { await saveSyncConf(c); return runSync(false) || SY.lastError; }, conf)).toBe(true);
  expect(await p2.evaluate(async () => [S.books.length, S.books.filter(b => b.coverBlob).length, await (await DB.getBlob(S.books.find(b => b.id === "b2").files[0].id)).blob.text()]))
    .toEqual([12, 6, "%PDF-1.4 echt"]);

  // Konflikt (neuere Änderung gewinnt), Löschung und „verschiedene Bücher“ (notDup) laufen in beide Richtungen
  await page.evaluate(() => patchBook("b1", { notes: "A" }));
  await page.waitForTimeout(20);
  await p2.evaluate(async () => { await patchBook("b1", { notes: "B neuer" }); await removeBook("b4"); await markDistinct(["b5", "b6"]); });
  for (const p of [p2, page, p2]) expect(await p.evaluate(() => runSync(false) || SY.lastError)).toBe(true);
  for (const p of [page, p2]) expect(await p.evaluate(() => [S.books.find(b => b.id === "b1").notes, !!S.books.find(b => b.id === "b4"), S.books.find(b => b.id === "b5").notDup]))
    .toEqual(["B neuer", false, ["b6"]]);

  // Auf dem Server: 11 Bücher, 1 Löschvermerk, Regal-Dokument
  const all = await couch("/_all_docs?include_docs=true");
  const docs = all.body.rows.map(r => r.doc);
  expect([docs.filter(d => d._id.startsWith("book:") && !d.deletedAt).length, docs.filter(d => d.deletedAt).length]).toEqual([11, 1]);
  await ctx.close();
});
