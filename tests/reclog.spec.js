// Stufe 0 – Erkennungsprotokoll: KI-Anfrage (Modell, Bildgröße, rohe Antwort, stop_reason, Dauer), Katalogabfragen je Quelle
// mit Ergebnis/Fehlerart, Kandidaten mit Punkten, gewählter Treffer und warum. Schlüssel stehen nie darin.
import { test, expect, openApp, fixture, googleItem, isbn13, claudeShelf } from "./helpers.js";

const item = (title, author, x0, x1) => ({ kind: "book", position: "standing", title, author, publisher: "", isbn: "", spine_text_vertical: title, text_direction: "up", bbox: { x0, x1, y0: 0.3, y1: 0.95 }, confidence: "high" });
const SCAN = { compartment: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [item("Momo", "Michael Ende", 0.05, 0.12), item("Unbekanntes Werk", "Niemand", 0.13, 0.2)] };
const json = (r, body, status = 200) => r.fulfill({ status, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(body) });

async function scanWithApi(page, handler) {
  await page.context().route("https://api.anthropic.com/**", handler);
  await openApp(page);
  await page.evaluate(() => { localStorage.setItem("aiKey", "sk-ant-geheim-123"); localStorage.setItem("gbooksKey", "GOOGLE-GEHEIM"); });
  await page.evaluate(() => openShelfScan());
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
}
const lastRun = page => page.evaluate(async () => (await DB.getMeta("recLog"))?.[0]);

test("Fach-Foto: Protokoll mit Modell, Bildgröße, roher Antwort, Katalogabfragen je Quelle, Punkten und Begründung", async ({ page, catalog }) => {
  catalog.google = q => q.toLowerCase().includes("momo") ? [googleItem("Momo", "Michael Ende", isbn13("978352220210"))] : [];
  await page.route("https://lobid.org/**", r => r.fulfill({ status: 429, body: "{}" }));        // Kontingent erschöpft
  await page.route("https://openlibrary.org/**", r => r.abort("failed"));                         // nicht erreichbar
  await scanWithApi(page, claudeShelf(SCAN));
  await expect(page.locator(".scanrow")).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(async () => (await lastRun(page))?.books?.length).toBe(2);
  const r = await lastRun(page);
  expect(r).toMatchObject({ kind: "fach-foto", model: "claude-sonnet-5-5", gesendet: { w: 1000, h: 800 } });
  // zwei Runden: Übersicht (günstiges Modell, verkleinertes Foto), dann die Rücken einzeln (eingestelltes Modell)
  expect(r.ai[0]).toMatchObject({ step: "übersicht", model: "claude-haiku-5-5", max_tokens: 16000, stop_reason: "end_turn", status: 200, usage: { output_tokens: 200 } });
  expect(r.ai[0].imgs[0]).toMatchObject({ w: 1000, h: 800 });
  expect(r.ai[1]).toMatchObject({ step: "rücken", model: "claude-sonnet-5-5", stop_reason: "end_turn" });
  expect(r.ai[1].imgs).toHaveLength(2);
  expect(r.ai[1].raw).toContain("Unbekanntes Werk");
  expect(r.ai[0].ms).toBeGreaterThanOrEqual(0);
  const momo = r.books[0];
  expect(momo.gelesen).toMatchObject({ title: "Momo", author: "Michael Ende", position: "standing" });
  const bySrc = Object.fromEntries(momo.abfragen.map(q => [q.src, q]));
  expect(bySrc["Google Books"]).toMatchObject({ n: 1 });
  expect(bySrc["DNB"]).toMatchObject({ n: 0 });
  expect(bySrc["lobid"].err).toBe("gesperrt/Kontingent (429)");
  expect(bySrc["Open Library"].err).toBe("nicht erreichbar (Netz/CORS)");
  expect(momo.kandidaten[0]).toMatchObject({ title: "Momo", src: "Google Books" });
  expect(momo.kandidaten[0].score).toBeGreaterThan(3);
  expect(momo.gewaehlt).toBe(0);
  expect(momo.warum).toMatch(/^automatisch: .* Punkte/);
  expect(r.books[1].warum).toBe("keine Kandidaten gefunden");
  // nie Schlüssel im Protokoll
  const all = JSON.stringify(await page.evaluate(() => DB.getMeta("recLog")));
  expect(all).not.toContain("sk-ant-geheim");
  expect(all).not.toContain("GOOGLE-GEHEIM");

  // „🧾 Protokoll anzeigen / teilen“ in der Prüfliste → Datei
  await page.click("text=🧾 Protokoll anzeigen / teilen");
  await expect(page.locator(".reclist .recrow").first()).toContainText("Fach-Foto");
  await expect(page.locator(".reclist .recrow").first()).toContainText("lobid: gesperrt/Kontingent (429)");
  const file = await page.evaluate(async () => { let out; const orig = saveFile; saveFile = async (n, b) => { out = { n, t: await b.text() }; }; document.querySelector(".confirm .btn:not(.primary):not(.ghost)").click(); await new Promise(r => setTimeout(r, 300)); saveFile = orig; return out; });
  expect(file.n).toMatch(/^buecherregal-protokoll-\d{4}-\d\d-\d\d\.json$/);
  const data = JSON.parse(file.t);
  expect(data.app).toBe("buecherregal-protokoll");
  expect(data.runs[0].books).toHaveLength(2);
  expect(file.t).not.toContain("sk-ant-geheim");
});

test("Abgeschnittene KI-Antwort (max_tokens) wird klar gemeldet und protokolliert", async ({ page }) => {
  await scanWithApi(page, r => json(r, { model: "claude-haiku-5-5", stop_reason: "max_tokens", content: [{ type: "text", text: '{"compartment":{},"items":[{"kind":"book","title":"Mo' }] }));
  await expect(page.locator(".sheet .note")).toContainText("abgeschnitten");
  await expect.poll(async () => (await lastRun(page))?.ai?.length).toBe(2); // einmal mit mehr Platz nachgefordert
  const r = await lastRun(page);
  expect(r.ai.map(a => [a.stop_reason, a.max_tokens])).toEqual([["max_tokens", 16000], ["max_tokens", 32000]]);
  expect(r.ai[0].err).toContain("abgeschnitten");
});

test("Cover-Foto, Barcode und Titelsuche werden ebenfalls protokolliert", async ({ page, catalog }) => {
  const I = isbn13("978342312345");
  catalog.dnb = cql => cql.includes(I) ? [{ title: "Der Vorleser", author: "Schlink, Bernhard", isbn: I }] : [];
  catalog.google = q => q.toLowerCase().includes("vorleser") ? [googleItem("Der Vorleser", "Bernhard Schlink", I)] : [];
  await page.context().route("https://api.anthropic.com/**", r => json(r, { model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ title: "Der Vorleser", author: "Bernhard Schlink", isbn: "" }) }] }));
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("aiKey", "sk-ant-test"));
  // Cover-Foto
  await page.evaluate(() => openAdd());
  const chooser = page.waitForEvent("filechooser");
  await page.click("text=🖼 Cover-Bild wählen");
  await (await chooser).setFiles(fixture("cover-a.jpg"));
  await expect(page.locator(".cand").first()).toBeVisible();
  await expect.poll(async () => (await lastRun(page))?.searches?.length).toBe(1);
  let r = await lastRun(page);
  expect(r).toMatchObject({ kind: "cover" });
  expect(r.ai[0]).toMatchObject({ step: "cover", stop_reason: "end_turn" });
  expect(r.searches[0].q).toContain("Vorleser");
  // Barcode (ISBN eintippen)
  await page.evaluate(() => closeSheet());
  await page.evaluate(i => handleIsbn(i), I);
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  await expect.poll(async () => (await lastRun(page))?.searches?.[0]?.abfragen?.length).toBe(3);
  r = await lastRun(page);
  expect(r).toMatchObject({ kind: "barcode", isbn: I });
  expect(r.searches[0].abfragen.map(q => q.src).sort()).toEqual(["DNB", "Google Books", "Open Library"]);
});
