// Stufe 6 – Barcode als Hauptweg: nur echte Buch-ISBNs (978/979, Prüfziffer, ohne Preis-Zusatz), Taschenlampe und Fokus,
// Rahmen dort, wo der Barcode gesehen wird; im Stapel: nochmal gescannt → nicht still doppelt, schon vorhanden → sofort gesagt.
import { test, expect, openApp, isbn13 } from "./helpers.js";

const A = isbn13("978342300011"), B = isbn13("978342300012");
const DNB = { [A]: { title: "Momo", author: "Ende, Michael", publisher: "Thienemann", year: "1973", isbn: A }, [B]: { title: "Tschick", author: "Herrndorf, Wolfgang", publisher: "Rowohlt", year: "2010", isbn: B } };
const dnbByIsbn = cql => { const m = cql.match(/num=(\d+)/); return m && DNB[m[1]] ? [DNB[m[1]]] : []; };

// Testbild-Kamera mit Taschenlampe/Fokus; die Barcode-Erkennung liest window._code (mit Lage im Bild)
async function fakeCamera(page) {
  await page.addInitScript(() => {
    window._code = null; window._constraints = [];
    window.BarcodeDetector = class { static async getSupportedFormats() { return ["ean_13"]; } async detect() { return window._code ? [{ rawValue: window._code, boundingBox: { x: 200, y: 180, width: 240, height: 100 } }] : []; } };
    const c = document.createElement("canvas"); c.width = 640; c.height = 480; let n = 0;
    const paint = () => { const g = c.getContext("2d"); g.fillStyle = `hsl(${(n++ * 40) % 360} 60% 50%)`; g.fillRect(0, 0, 640, 480); };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      paint(); setInterval(paint, 200);
      const s = c.captureStream(10), t = s.getVideoTracks()[0];
      t.getCapabilities = () => ({ torch: true, focusMode: ["manual", "continuous"] });
      t.applyConstraints = async x => { window._constraints.push(x); };
      return s;
    };
  });
}
const code = (page, v) => page.evaluate(v => { window._code = v; }, v);

test("Nur echte Buch-ISBNs aus dem Strichcode", async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(([a]) => ({
    ok: isbnFromBarcode(a), n979: isbnFromBarcode("9791032305690"),
    addon: isbnFromBarcode(a + "51299"), addon2: isbnFromBarcode(a + " 12"),
    food: isbnFromBarcode("4006381333931"), check: isbnFromBarcode(a.slice(0, 12) + ((+a[12] + 1) % 10)),
    isbn10: isbnFromBarcode("3161484100"), ean8: isbnFromBarcode("96385074"),
  }), [A]);
  expect(r).toEqual({ ok: A, n979: "9791032305690", addon: A, addon2: A, food: null, check: null, isbn10: null, ean8: null });
});

test("Live-Scan: Taschenlampe, Dauer-Fokus, Rahmen am Barcode, fremder Strichcode wird erklärt", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await fakeCamera(page);
  await openApp(page);
  const res = page.evaluate(() => liveScan());
  await expect(page.locator(".scan")).toBeVisible();
  const torch = page.locator(".scan .btn.torch");
  await expect(torch).toBeVisible();
  await torch.click();
  await expect(torch).toHaveClass(/on/);
  const cons = await page.evaluate(() => window._constraints);
  expect(cons).toContainEqual({ advanced: [{ focusMode: "continuous" }] });
  expect(cons).toContainEqual({ advanced: [{ torch: true }] });
  await code(page, "4006381333931");                                                  // Lebensmittel-Strichcode
  await expect(page.locator(".scan .bottom p")).toContainText("kein ISBN-Barcode");
  await expect(page.locator(".scan .seen")).toHaveClass(/on/);                         // dort gesehen
  await code(page, A + "51299");                                                       // mit Preis-Zusatz
  expect(await res).toBe(A);
  await expect(page.locator(".scan")).toHaveCount(0);
});

test("Stapel: nochmal gescannt → „Schon im Stapel“ statt doppelt, zweites Exemplar auf Wunsch; vorhandenes Buch wird gleich gemeldet", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await fakeCamera(page);
  await openApp(page);
  await page.evaluate(async b => { await putBook({ id: "t1", title: "Tschick", author: "Wolfgang Herrndorf", isbn: b, status: "read", rating: 0, addedAt: new Date().toISOString() }); }, B);
  await page.evaluate(() => openStackCapture());
  const count = page.locator(".stkcount"), info = page.locator(".scan.stack .bottom p");
  await expect(page.locator(".scan.stack .btn.torch")).toBeVisible();
  await code(page, A);
  await expect(count).toHaveText("📚 1 im Stapel");
  await code(page, B);
  await expect(count).toHaveText("📚 2 im Stapel");
  await expect(info).toContainText("Steht schon in deinem Regal");
  await expect(info).toHaveClass(/stkwarn/);
  await code(page, A);                                                                 // Momo nochmal
  await expect(info).toContainText("Schon im Stapel (Nr. 1)");
  await expect(count).toHaveText("📚 2 im Stapel");
  await page.click(".scan.stack button:text-is('＋ Zweites Exemplar')");
  await expect(count).toHaveText("📚 3 im Stapel");
  expect(await page.evaluate(a => S.stack.filter(e => e.isbn === a).length, A)).toBe(2);
});

test("Barcode im Foto: wird auch in Ausschnitten gesucht (kleiner Barcode im großen Bild)", async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(async a => {
    const seen = [];
    // nachgebildete Erkennung: findet den Barcode erst in einem Ausschnitt (nicht im ganzen Bild)
    window.BarcodeDetector = class { async detect(src) { seen.push(src instanceof HTMLCanvasElement ? "crop" : "full"); return seen.length >= 4 ? [{ rawValue: a }] : []; } };
    const c = document.createElement("canvas"); c.width = 3000; c.height = 2000; c.getContext("2d").fillRect(0, 0, 10, 10);
    const img = await loadImage(await canvasBlob(c, .8));
    return { isbn: await decodeFromImage(img), seen };
  }, A);
  expect(r.isbn).toBe(A);
  expect(r.seen).toEqual(["full", "crop", "crop", "crop"]);
});
