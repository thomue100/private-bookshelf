// Viele Fach-Fotos auf einmal erkennen (Sammelauftrag über die nachgebildete Anthropic-API), der Reihe nach prüfen,
// Ausweichweg „einzeln erkennen“, und die frühere Texterkennung gibt es nicht mehr.
import { test, expect, openApp, fixtureBytes, googleItem, isbn13, shelfAnswer } from "./helpers.js";

const BOOKS = [
  ["Momo", "Michael Ende", 40, 100], ["Krabat", "Otfried Preußler", 104, 194], ["Siddhartha", "Hermann Hesse", 198, 248],
];
const item = (title, author, x0, x1) => ({
  kind: "book", label: "", position: "standing", title, subtitle: "", author, publisher: "", series_no: "", isbn: "",
  spine_text_vertical: title, spine_text_horizontal: "", text_direction: "up", spine_color: "#8b1e2d", text_color: "#f3e9dc",
  bbox: { x0: x0 / 1000, x1: x1 / 1000, y0: 250 / 800, y1: 780 / 800 }, confidence: "high",
});
const SCAN_A = { compartment: { x0: 0.02, y0: 0, x1: 0.99, y1: 0.99 }, items: BOOKS.slice(0, 2).map(([t, a, x0, x1]) => item(t, a, x0, x1)) };
const SCAN_B = { compartment: SCAN_A.compartment, items: BOOKS.slice(2).map(([t, a, x0, x1]) => item(t, a, x0, x1)) };
const SHELF_B64 = fixtureBytes("shelf.jpg").toString("base64");
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
const json = (r, body, status = 200) => r.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
const msg = out => ({ type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] });
// Antwort auf eine Anfrage (Übersicht oder Rücken lesen) für das Fach scan
const answer = (scan, params) => msg(shelfAnswer(scan, params));
const readCount = params => params.messages[0].content.filter(c => c.type === "image").length;

function catalogFor(catalog) {
  catalog.google = q => { const hit = BOOKS.find(([t]) => q.toLowerCase().includes(t.toLowerCase())); return hit ? [googleItem(hit[0], hit[1], isbn13("978342" + String(BOOKS.indexOf(hit)).padStart(6, "0")))] : []; };
}
// Regalwand mit einem 4er-Würfel und zwei gespeicherten Fach-Fotos (oben links, oben rechts)
async function twoPhotos(page) {
  await openApp(page);
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  await page.click("text=Ein 4er-Würfel (1112)");
  await page.click(".confirm .btn.primary");
  return page.evaluate(async b64 => {
    const blob = await (await fetch("data:image/jpeg;base64," + b64)).blob();
    const [f1, f2] = fachOptions();
    const a = await savePhoto(blob, f1.key); const b = await savePhoto(blob, f2.key);
    localStorage.setItem("aiKey", "sk-ant-test");
    return { a: a.id, b: b.id, fa: f1.key, fb: f2.key };
  }, SHELF_B64);
}

test("Sammelauftrag: alle Fotos auf einmal erkennen, abholen, der Reihe nach prüfen und einsortieren", async ({ page, catalog }) => {
  catalogFor(catalog);
  let sentOv = null, sentRd = null, ended = false, polls = 0, single = 0;
  await page.context().route("https://api.anthropic.com/**", async r => {
    const req = r.request(), url = req.url();
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: CORS });
    if (url.endsWith("/v1/messages")) { const b = JSON.parse(req.postData()); if (!b.output_config?.format?.schema?.properties?.books) single++; return json(r, answer(SCAN_A, b)); } // Treffer-Wahl (judge.js) läuft direkt
    if (url.endsWith("/v1/messages/batches") && req.method() === "POST") {
      const body = JSON.parse(req.postData());
      if (!sentOv) { sentOv = body; return json(r, { id: "msgbatch_ov", processing_status: "in_progress" }); } // Runde 1: Übersichten
      sentRd = body; return json(r, { id: "msgbatch_rd", processing_status: "in_progress" });                // Runde 2: Rücken lesen
    }
    const m = url.match(/\/(msgbatch_ov|msgbatch_rd)(\/results)?$/);
    if (m && !m[2]) {
      polls++;
      return json(r, { id: m[1], processing_status: ended ? "ended" : "in_progress", results_url: ended ? `https://api.anthropic.com/v1/messages/batches/${m[1]}/results` : null });
    }
    if (m && m[2]) {
      const sent = m[1] === "msgbatch_ov" ? sentOv : sentRd;
      // Runde 1: o0 = erstes Foto (A), o1 = zweites (B); Runde 2: 2 Rücken = Foto A, 1 Rücken = Foto B
      const lines = sent.requests.map((q, i) => JSON.stringify({ custom_id: q.custom_id, result: { type: "succeeded",
        message: answer(m[1] === "msgbatch_ov" ? (i ? SCAN_B : SCAN_A) : (readCount(q.params) === 2 ? SCAN_A : SCAN_B), q.params) } }));
      return r.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/x-jsonl" }, body: lines.join("\n") + "\n" });
    }
    return json(r, { error: { message: "unbekannt" } }, 404);
  });
  const ids = await twoPhotos(page);
  await page.evaluate(() => openPhotoInbox());
  await page.click("text=🤖 Alle 2 Fotos erkennen");
  await expect(page.locator(".batchrun")).toContainText("2 Fotos werden gerade von Claude erkannt");
  // Runde 1: beide Fotos mit Bild, schlanke Übersicht mit günstigem Modell und strukturierter Ausgabe (kein erzwungenes tool_choice)
  expect(sentOv.requests.map(q => q.custom_id)).toEqual(["o0", "o1"]);
  expect(sentOv.requests[0].params.messages[0].content[0].type).toBe("image");
  expect(sentOv.requests[0].params.messages[0].content[1].text).toContain("ONE compartment");
  expect(sentOv.requests[0].params).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low", format: { type: "json_schema" } } });
  expect(sentOv.requests[0].params.tool_choice).toBeUndefined();
  await expect(page.locator(".phcard").first()).toContainText("wird gerade von Claude erkannt");
  // noch nicht fertig: „Jetzt nachsehen“ meldet das
  await page.click("text=Jetzt nachsehen");
  await expect(page.locator(".toast").last()).toContainText("Claude arbeitet noch");
  expect(polls).toBeGreaterThan(0);
  // fertig: Ergebnisse landen an den Fotos, der Sammelauftrag ist erledigt
  ended = true;
  await page.click("text=Jetzt nachsehen");                     // Runde 1 fertig → Runde 2 (Rücken) wird abgeschickt
  await expect.poll(() => !!sentRd).toBe(true);
  expect(sentRd.requests.map(q => readCount(q.params)).sort()).toEqual([1, 2]);
  expect(sentRd.requests[0].params.model).toBe("claude-sonnet-5-5");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("aiBatches") || "[]").map(b => b.kind))).toEqual(["read"]);
  await page.click("text=Jetzt nachsehen");                     // Runde 2 fertig
  await expect(page.locator("text=2 erkannte Fächer der Reihe nach prüfen")).toBeVisible();
  expect(await page.evaluate(() => ({ scans: S.photos.filter(p => p.scan).length, batches: localStorage.getItem("aiBatches") }))).toEqual({ scans: 2, batches: null });

  // der Reihe nach: erstes Fach prüfen → übernehmen → zweites Fach öffnet sich von selbst
  await page.click("text=2 erkannte Fächer der Reihe nach prüfen");
  await expect(page.locator(".scanrow")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator(".sheet .note.info").first()).toContainText("Danach geht es direkt mit dem nächsten Fach weiter");
  await page.click(".actions.sticky .btn.primary");
  await expect(page.locator(".scanrow")).toHaveCount(1, { timeout: 30_000 });
  await page.click(".actions.sticky .btn.primary");
  await page.locator(".confirm >> text=Abbrechen").click({ timeout: 5000 }).catch(() => {}); // Cover-Nachfrage einmal am Ende
  await expect.poll(() => page.evaluate(() => S.photos.filter(p => p.doneAt).length)).toBe(2);
  const r = await page.evaluate(k => ({
    n: S.books.length,
    a: locationOf(S.books.find(b => b.title === "Momo").id)?.list.map(id => S.books.find(b => b.id === id).title),
    b: locationOf(S.books.find(b => b.title === "Siddhartha").id)?.list.map(id => S.books.find(b => b.id === id).title),
    chain: S.reviewChain,
  }), ids);
  expect(r).toEqual({ n: 3, a: ["Momo", "Krabat"], b: ["Siddhartha"], chain: false });
  expect(single).toBe(0); // Erkennung lief ganz über den Sammelauftrag (nur die Treffer-Wahl geht direkt)
});

test("Sammelauftrag klappt nicht: Fotos einzeln erkennen", async ({ page, catalog }) => {
  catalogFor(catalog);
  let single = 0, cur = SCAN_A;
  await page.context().route("https://api.anthropic.com/**", async r => {
    const req = r.request();
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: CORS });
    if (req.url().endsWith("/v1/messages/batches")) return json(r, { error: { type: "invalid_request_error", message: "Batches sind für diesen Schlüssel nicht freigeschaltet." } }, 400);
    if (req.url().endsWith("/v1/messages")) {
      const params = JSON.parse(req.postData());
      if (params.output_config?.format?.schema?.properties?.items) { single++; cur = single === 1 ? SCAN_A : SCAN_B; } // je Foto: Übersicht, dann Rücken
      return json(r, answer(cur, params));
    }
    return json(r, {}, 404);
  });
  await twoPhotos(page);
  await page.evaluate(() => openPhotoInbox());
  await page.click("text=🤖 Alle 2 Fotos erkennen");
  await expect(page.locator(".confirm")).toContainText("nicht freigeschaltet");
  await page.click(".confirm button >> text=Einzeln erkennen");
  await expect.poll(() => page.evaluate(() => S.photos.filter(p => p.scan).length), { timeout: 20_000 }).toBe(2);
  expect(single).toBe(2);
  await expect(page.locator("text=2 erkannte Fächer der Reihe nach prüfen")).toBeVisible();
});

test("Ohne KI-Schlüssel: Hinweis statt Knopf; die frühere Texterkennung gibt es nicht mehr", async ({ page }) => {
  await twoPhotos(page);
  const r = await page.evaluate(() => {
    localStorage.removeItem("aiKey");
    localStorage.setItem("scanMode", "ocr"); // gespeicherte Wahl aus einer älteren App-Version
    return { modes: scanModes(true).map(m => m[0]), def: defaultMode(), ocr: typeof ocrScanShelf + typeof ocrCover };
  });
  expect(r).toEqual({ modes: ["later", "api", "chat"], def: "chat", ocr: "undefinedundefined" });
  await page.evaluate(() => openPhotoInbox());
  await expect(page.locator(".sheet")).toContainText("2 Fotos noch nicht erkannt");
  await expect(page.locator("text=🤖 Alle")).toHaveCount(0);
});
