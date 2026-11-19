// Stufe 2 – Buchrücken einzeln und scharf lesen: Übersicht (Lage), dann jeder Rücken aus dem Originalfoto, waagerecht gedreht,
// in Gruppen gelesen; Rahmen anpassen bei 0/2 Rücken; abgeschnittene Antworten nachfordern; unsichere genauer lesen (API und Chat-Collage).
import { test, expect, openApp, fixture, googleItem, isbn13, claudeShelf, shelfAnswer } from "./helpers.js";

const item = (title, author, x0, x1, more = {}) => ({ kind: "book", position: "standing", title, author, text_direction: "up", bbox: { x0, x1, y0: 0.3, y1: 0.95 }, confidence: "high", ...more });
const SCAN = { compartment: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [
  item("Momo", "Michael Ende", 0.04, 0.10),
  item("Krabat", "Otfried Preußler", 0.11, 0.18, { text_direction: "down" }),
  { kind: "book", position: "lying_on_top", title: "Siddhartha", author: "Hermann Hesse", text_direction: "horizontal", bbox: { x0: 0.2, x1: 0.7, y0: 0.15, y1: 0.25 }, confidence: "high" },
  item("Tschick", "Wolfgang Herrndorf", 0.72, 0.8, { quadFlat: [0.72, 0.3, 0.79, 0.32, 0.8, 0.95, 0.73, 0.93] }),
  { kind: "other", label: "CD", position: "standing", bbox: { x0: 0.85, x1: 0.9, y0: 0.5, y1: 0.95 } },
] };
function catalogFor(catalog) {
  catalog.google = q => { q = q.toLowerCase(); const hit = SCAN.items.find(it => it.title && q.includes(it.title.toLowerCase())); return hit ? [googleItem(hit.title, hit.author, isbn13("9783420" + String(hit.title.length).padStart(5, "0")))] : []; };
}
async function scan(page, handler) {
  await page.context().route("https://api.anthropic.com/**", handler);
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("aiKey", "sk-ant-test"));
  await page.evaluate(() => openShelfScan());
  await expect(page.locator(".sheet")).toContainText("ct pro Fach"); // Kosten vorher sichtbar
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
}
const readReqs = log => log.filter(b => b.output_config?.format?.schema?.properties?.spines);
const imgSizes = (page, req) => page.evaluate(async content => Promise.all(content.filter(c => c.type === "image").map(async c => {
  const i = await loadImage(await (await fetch("data:image/jpeg;base64," + c.source.data)).blob()); return [i.naturalWidth, i.naturalHeight];
})), req.messages[0].content);

test("Zwei Runden: Übersicht mit Haiku, dann jeder Rücken einzeln – waagerecht, nummeriert, strukturierte Ausgabe", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  await scan(page, claudeShelf(SCAN, { log }));
  await expect(page.locator(".scanrow")).toHaveCount(5, { timeout: 30_000 });
  expect(log[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 16000, output_config: { effort: "low", format: { type: "json_schema" } } });
  const rd = readReqs(log);
  expect(rd).toHaveLength(1);                                                            // 4 Bücher → eine Gruppe (die CD wird nicht gelesen)
  expect(rd[0]).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low" } });
  expect(rd[0].tool_choice).toBeUndefined();
  expect(rd[0].messages[0].content.filter(c => c.type === "text").map(c => c.text).slice(0, 4)).toEqual(["Rücken Nr. 1:", "Rücken Nr. 2:", "Rücken Nr. 3:", "Rücken Nr. 4:"]);
  const sizes = await imgSizes(page, rd[0]);
  expect(sizes).toHaveLength(4);
  for (const [w, h] of sizes) { expect(w).toBeGreaterThan(h); expect(Math.max(w, h)).toBeLessThanOrEqual(1200); } // Schrift waagerecht
  // Titel kommen aus Runde 2
  await expect(page.locator(".scanrow").nth(0).locator(".scanin input").first()).toHaveValue("Momo");
  await expect(page.locator(".scanrow").nth(3).locator(".scanin input").first()).toHaveValue("Tschick");
  const data = await page.evaluate(() => S.photos[0].scan);
  expect(data.two_stage).toBe(1);
  expect(data.items[3].quad).toHaveLength(4);                                            // schräger Rücken: Ecken aus der Übersicht
  // Rückenbilder fürs echte Regal: aus denselben Ausschnitten, stehend
  await page.click(".actions.sticky .btn.primary");
  await page.locator(".confirm >> text=Abbrechen").click({ timeout: 5000 }).catch(() => {});
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(4);
  const sp = await page.evaluate(async () => { const b = S.books.find(x => x.title === "Tschick"); const i = await loadImage(b.spine.imageBlob); return [i.naturalWidth, i.naturalHeight]; });
  expect(sp[1]).toBeGreaterThan(sp[0] * 3);
});

test("Ausschnitt ohne Rücken → breiter neu lesen; abgeschnittene Antwort → kleinere Gruppen nachfordern", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  let first = true;
  // eigene Nachbildung: Gruppen mit mehr als 2 Rücken werden abgeschnitten (max_tokens), Rücken 1 zeigt beim ersten Mal keinen Rücken
  await scan(page, async route => {
    const body = JSON.parse(route.request().postData());
    log.push(body);
    const p = body.output_config?.format?.schema?.properties;
    let out = shelfAnswer(SCAN, body), stop = "end_turn";
    if (p?.spines) {
      const n = body.messages[0].content.filter(c => c.type === "image").length;
      if (n > 2) { stop = "max_tokens"; out = '{"spines":[{"n":1,"title":"Mo'; }
      else if (first && out.spines.some(s => s.n === 1)) { first = false; out.spines.find(s => s.n === 1).books_in_image = 0; }
    }
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ model: body.model, stop_reason: stop, content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] }) });
  });
  await expect(page.locator(".scanrow")).toHaveCount(5, { timeout: 30_000 });
  const counts = readReqs(log).map(b => b.messages[0].content.filter(c => c.type === "image").length);
  expect(counts.slice(0, 3)).toEqual([4, 2, 2]);                                         // 4 abgeschnitten → in zwei Hälften
  expect(counts[3]).toBe(1);                                                             // Rücken 1 breiter neu gelesen
  const wide = await imgSizes(page, readReqs(log)[3]), normal = await imgSizes(page, readReqs(log)[1]);
  expect(wide[0][1] / wide[0][0]).toBeGreaterThan(normal[0][1] / normal[0][0]);           // mehr Rand (gedreht: höher im Verhältnis)
  await expect(page.locator(".scanrow").nth(0).locator(".scanin input").first()).toHaveValue("Momo");
  const r = await page.evaluate(async () => (await DB.getMeta("recLog"))[0].ai.map(a => a.step));
  expect(r).toContain("rücken (breiter)");
});

test("Unsichere Rücken genauer lesen – mit Schlüssel per API", async ({ page, catalog }) => {
  catalogFor(catalog);
  let round = 0;
  await scan(page, claudeShelf(SCAN, { answer: body => {
    if (!body.output_config?.format?.schema?.properties?.spines) return undefined;
    round++;
    const out = shelfAnswer(SCAN, body);
    if (round === 1) { const s = out.spines.find(x => x.n === 2); s.title = ""; s.author = ""; s.confidence = "low"; }
    return out;
  } }));
  await expect(page.locator(".scanrow")).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator(".scanrow.unsure")).toHaveCount(1);
  await page.click("text=🔍 Unsichere Rücken genauer lesen");
  await expect(page.locator(".scanrow.unsure")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".scanrow").nth(1).locator(".scanin input").first()).toHaveValue("Krabat");
  expect(round).toBe(2);
  expect(await page.evaluate(() => S.photos[0].review.items[1].title)).toBe("Krabat");   // gemerkt
});

test("Ohne Schlüssel: unsichere Rücken als nummerierte Collage über die Claude-Chat-Brücke", async ({ page, catalog }) => {
  catalogFor(catalog);
  const low = { ...SCAN, items: SCAN.items.map((it, i) => i === 1 ? { ...it, title: "", author: "", spine_text_vertical: "", confidence: "low" } : it) };
  await openApp(page);
  await page.evaluate(() => openShelfScan());
  await page.click("text=💬 Über deinen Claude-Chat");
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  await page.locator(".bridge textarea:not([readonly])").fill("```json\n" + JSON.stringify(low) + "\n```");
  await page.click(".actions >> text=Weiter");
  await expect(page.locator(".scanrow.unsure")).toHaveCount(1, { timeout: 30_000 });
  await page.click("text=🔍 Unsichere Rücken genauer lesen");
  await expect(page.locator(".bridge")).toBeVisible();
  await expect(page.locator(".bridge textarea[readonly]")).toHaveValue(/Collage aus Buchrücken/);
  await page.locator(".bridge textarea:not([readonly])").fill("```json\n" + JSON.stringify({ spines: [{ n: 1, books_in_image: 1, title: "Krabat", subtitle: "", author: "Otfried Preußler", publisher: "", series: "", volume: "", order_no: "", isbn: "", spine_text: "Preußler Krabat", confidence: "high" }] }) + "\n```");
  await page.click(".actions >> text=Weiter");
  await expect(page.locator(".scanrow.unsure")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".scanrow").nth(1).locator(".scanin input").first()).toHaveValue("Krabat");
});

test("Kosten: Schätzung je Fach (Haiku für die Lage, eingestelltes Modell zum Lesen, Sammelauftrag halb)", async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => ({ s: shelfCostCents(25, { model: "claude-sonnet-5-5" }), b: shelfCostCents(25, { model: "claude-sonnet-5-5", batch: true }), o: shelfCostCents(25, { model: "claude-opus-5-5" }) }));
  expect(r.s).toBeGreaterThan(3); expect(r.s).toBeLessThan(15);
  expect(r.b).toBeCloseTo(r.s / 2, 5);
  expect(r.o).toBeGreaterThan(r.s);
});
