// „📚 Stapel erfassen“: Kamera bleibt offen, Barcode → Fotos → nächstes Buch; Prüfliste; Neustart; Dubletten/Wunschliste; DB-Version 3 → 4.
// Die Kamera ist ein Testbild-Video, die Barcode-Erkennung liest window._code (vom Test gesetzt).
import { test, expect, openApp, googleItem, isbn13 } from "./helpers.js";

const A = isbn13("978342300001"), B = isbn13("978342300002");
const DNB = { [A]: { title: "Momo", author: "Ende, Michael", publisher: "Thienemann", year: "1973", isbn: A, format: "21 cm" },
              [B]: { title: "Tschick", author: "Herrndorf, Wolfgang", publisher: "Rowohlt", year: "2010", isbn: B } };
const dnbByIsbn = cql => { const m = cql.match(/num=(\d+)/); return m && DNB[m[1]] ? [DNB[m[1]]] : []; };

async function fakeCamera(page) {
  await page.addInitScript(() => {
    window._code = null;
    window.BarcodeDetector = class { static async getSupportedFormats() { return ["ean_13"]; } async detect() { return window._code ? [{ rawValue: window._code }] : []; } };
    const c = document.createElement("canvas"); c.width = 640; c.height = 480; let n = 0;
    const paint = () => { const g = c.getContext("2d"); g.fillStyle = `hsl(${(n++ * 40) % 360} 60% 50%)`; g.fillRect(0, 0, 640, 480); };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { paint(); setInterval(paint, 200); return c.captureStream(10); };
  });
}
const code = (page, v) => page.evaluate(v => { window._code = v; }, v);
const count = page => page.locator(".stkcount");

test("Stapel: Barcode, Cover- und Rückenfoto, Buch ohne Barcode per Sammelauftrag – alles übernehmen", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  catalog.google = q => q.toLowerCase().includes("krabat") ? [googleItem("Krabat", "Otfried Preußler", isbn13("978352217520"))] : [];
  const ids = [];
  await page.context().route("https://api.anthropic.com/**", async r => {
    const url = r.request().url(), hdr = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (r.request().method() === "POST" && url.endsWith("/v1/messages/batches")) {
      for (const q of JSON.parse(r.request().postData()).requests) { ids.push(q.custom_id); expect(JSON.stringify(q.params)).toContain("cover_quad"); }
      return r.fulfill({ status: 200, headers: hdr, body: JSON.stringify({ id: "msgbatch_1", processing_status: "in_progress" }) });
    }
    if (url.endsWith("/msgbatch_1")) return r.fulfill({ status: 200, headers: hdr, body: JSON.stringify({ id: "msgbatch_1", processing_status: "ended", results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results" }) });
    if (url.endsWith("/results")) return r.fulfill({ status: 200, headers: hdr, body: ids.map(id => JSON.stringify({ custom_id: id, result: { type: "succeeded", message: { content: [{ type: "text", text: JSON.stringify({ title: "Krabat", author: "Otfried Preußler", isbn: "", confidence: "high" }) }] } } })).join("\n") });
    return r.fulfill({ status: 404, headers: hdr, body: "{}" });
  });
  await fakeCamera(page);
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("aiKey", "sk-ant-test"));
  await page.evaluate(() => openAdd());
  await page.click("#addStack");
  await expect(page.locator(".scan.stack")).toBeVisible();
  await expect(count(page)).toHaveText("📚 0 im Stapel");

  await code(page, A);
  await expect(count(page)).toHaveText("📚 1 im Stapel");
  await page.click(".scan.stack button:text-is('📷 Cover')");
  await expect(page.locator(".scan.stack button:text-is('📷 Cover ✓')")).toBeVisible();
  await page.click(".scan.stack button:text-is('📷 Rücken')");
  await expect(page.locator(".scan.stack button:text-is('📷 Rücken ✓')")).toBeVisible();
  await code(page, B); // nächster Barcode: ohne Tippen weiter zum nächsten Buch
  await expect(count(page)).toHaveText("📚 2 im Stapel");
  await code(page, null);
  await page.click(".scan.stack button:text-is('Weiter ▶')");
  await page.click(".scan.stack button:text-is('📷 Cover (ohne Barcode)')");
  await expect(count(page)).toHaveText("📚 3 im Stapel");
  await page.click(".scan.stack button:text-is('Weiter ▶')");
  await page.click(".scan.stack >> text=✓ Fertig – prüfen (3)");
  await expect(page.locator(".scan.stack")).toHaveCount(0);

  // Prüfliste: zwei sicher (grün), eins noch nicht erkannt
  await expect(page.locator(".stkrow")).toHaveCount(3);
  await expect(page.locator(".stkrow.sure")).toHaveCount(2);
  await expect(page.locator(".stkrow.new")).toHaveCount(1);
  await page.click("text=🤖 1 Buch ohne Barcode erkennen");
  await expect(page.locator(".stkrow.wait")).toHaveCount(1);
  await page.click("text=Jetzt nachsehen");
  await expect(page.locator(".stkrow.unsure .stkfields input").first()).toHaveValue("Krabat"); // nur über den Titel gefunden → gelb
  await page.click(".actions.sticky .btn.primary");
  await page.click(".confirm .btn.primary"); // „nicht sicher erkannt – trotzdem übernehmen?“
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(3);
  const r = await page.evaluate(async () => ({
    titles: S.books.map(b => b.title).sort(),
    momo: (b => ({ cover: !!b.coverBlob, spine: !!b.spine?.imageBlob, h: b.spine?.heightCm, src: b.source }))(S.books.find(b => b.title === "Momo")),
    stack: S.stack.length, db: (await DB.allStack()).length,
  }));
  expect(r).toEqual({ titles: ["Krabat", "Momo", "Tschick"], momo: { cover: true, spine: true, h: 21, src: "stapel" }, stack: 0, db: 0 });
});

test("Stapel überlebt einen Neustart; angefangene Suchen laufen beim Öffnen weiter", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await fakeCamera(page);
  await openApp(page);
  await page.evaluate(() => openAdd());
  await page.click("#addStack");
  await code(page, A);
  await expect(count(page)).toHaveText("📚 1 im Stapel");
  await page.click(".scan.stack button:text-is('📷 Cover')");
  await expect(page.locator(".scan.stack button:text-is('📷 Cover ✓')")).toBeVisible();
  // ein Eintrag, dessen Buchdaten noch nicht gesucht wurden (App wurde vorher beendet)
  await page.evaluate(b => DB.putStack({ id: "offen", createdAt: new Date().toISOString(), isbn: b }), B);
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  await expect.poll(() => page.evaluate(() => S.stack.find(e => e.id === "offen")?.rec?.title)).toBe("Tschick");
  await page.evaluate(() => openAdd());
  await page.click("button:text-is('Stapel prüfen (2)')");
  await expect(page.locator(".stkrow.sure")).toHaveCount(2);
  await expect(page.locator(".stkrow").first().locator(".stkthumb img")).toHaveCount(1); // Cover-Foto ist noch da
});

test("Stapel: vorhandenes Buch nicht angehakt, Wunsch wird als gekauft übernommen", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await openApp(page);
  await page.evaluate(([a, b]) => Promise.all([
    putBook({ id: "da", title: "Momo", author: "Michael Ende", isbn: a, status: "read", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z" }),
    putBook({ id: "wu", title: "Tschick", author: "Wolfgang Herrndorf", isbn: b, status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z", wish: true }),
    newStackEntry({ isbn: a }), newStackEntry({ isbn: b }),
  ]), [A, B]);
  await page.evaluate(() => openStackReview());
  await expect(page.locator(".stkrow.sure")).toHaveCount(2);
  await expect(page.locator(".stkrow.off")).toHaveCount(1);
  await expect(page.locator(".stkrow.off .stkdup")).toContainText("schon in deinem Regal");
  await expect(page.locator(".stkdup").last()).toContainText("Wunschliste");
  await page.click(".actions.sticky .btn.primary"); // „1 Buch übernehmen“
  await expect.poll(() => page.evaluate(() => isWish(S.books.find(b => b.id === "wu")))).toBe(false);
  expect(await page.evaluate(() => [S.books.length, S.stack.length])).toEqual([2, 1]); // das vorhandene bleibt im Stapel
});

test("Ohne KI-Schlüssel: Buch ohne Barcode über die Claude-Chat-Brücke erkennen", async ({ page, catalog }) => {
  catalog.google = q => q.toLowerCase().includes("krabat") ? [googleItem("Krabat", "Otfried Preußler", isbn13("978352217520"))] : [];
  await openApp(page);
  await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 300; c.height = 400; c.getContext("2d").fillRect(0, 0, 300, 400);
    await newStackEntry({ coverBlob: await new Promise(r => c.toBlob(r, "image/jpeg")) });
    openStackReview();
  });
  await expect(page.locator(".stkrow.new")).toHaveCount(1);
  await page.click("button:text-is('💬 Mit Claude-Chat erkennen')");
  await page.locator(".bridge textarea:not([readonly])").fill("```json\n" + JSON.stringify({ title: "Krabat", author: "Otfried Preußler", isbn: "" }) + "\n```");
  await page.click(".actions >> text=Weiter");
  await expect(page.locator(".stkrow.unsure .stkfields input").first()).toHaveValue("Krabat");
  await expect(page.locator(".stkrow.unsure .stkfields input").nth(1)).toHaveValue("Otfried Preußler");
});

test("Datenbank Version 3 → 4: Bücher und Fach-Fotos bleiben, Stapel-Speicher kommt dazu", async ({ page }) => {
  await page.goto("/manifest.webmanifest");
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open("buecherregal", 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("books", { keyPath: "id" }); d.createObjectStore("meta", { keyPath: "key" });
      d.createObjectStore("blobs", { keyPath: "id" }).createIndex("bookId", "bookId"); d.createObjectStore("photos", { keyPath: "id" });
    };
    r.onsuccess = () => {
      const d = r.result, t = d.transaction(["books", "photos"], "readwrite");
      t.objectStore("books").put({ id: "alt", title: "Alter Datensatz", author: "X", status: "read", rating: 3, notes: "", addedAt: "2019-01-01T00:00:00.000Z" });
      t.objectStore("photos").put({ id: "p1", createdAt: "2024-01-01T00:00:00.000Z", fachKey: "" });
      t.oncomplete = () => { d.close(); res(); }; t.onerror = () => rej(t.error);
    };
    r.onerror = () => rej(r.error);
  }));
  await openApp(page);
  const r = await page.evaluate(async () => {
    const d = await new Promise(res => { const q = indexedDB.open("buecherregal"); q.onsuccess = () => res(q.result); });
    const out = { version: d.version, stores: [...d.objectStoreNames].sort(), books: S.books.map(b => b.title), photos: S.photos.length, stack: S.stack.length };
    d.close(); return out;
  });
  expect(r).toEqual({ version: 4, stores: ["blobs", "books", "meta", "photos", "stack"], books: ["Alter Datensatz"], photos: 1, stack: 0 });
  // Sicherung enthält keinen Stapel
  await page.evaluate(() => newStackEntry({ isbn: "9783423000013" }));
  expect(Object.keys(await page.evaluate(() => buildBackup()))).not.toContain("stack");
});
