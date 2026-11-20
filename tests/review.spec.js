// Stufe 5 – Prüfliste, die man schnell abarbeitet: Kategorien 🟢🔵🟡🔴 gezählt und filterbar, Rücken groß, Kandidaten mit Cover,
// Sammelaktionen („Alle 🔵 so übernehmen“, „🟢 übernehmen, Rest später“), Barcode je Zeile.
import { test, expect, openApp, fixture, googleItem, isbn13, claudeShelf } from "./helpers.js";

const item = (title, author, x0, x1, more = {}) => ({ kind: "book", position: "standing", title, author, text_direction: "up", bbox: { x0, x1, y0: 0.3, y1: 0.95 }, confidence: "high", ...more });
const SCAN = { compartment: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [
  item("Momo", "Michael Ende", 0.04, 0.12),
  item("Krabat", "Otfried Preußler", 0.14, 0.22),
  item("Tschick", "Wolfgang Herrndorf", 0.3, 0.38),
  item("", "", 0.4, 0.46, { confidence: "low" }),
] };
const ISBN = { momo: isbn13("978342000011"), krabatA: isbn13("978342000012"), krabatB: isbn13("978342000013"), tschick: isbn13("978342000014") };
function catalogFor(catalog) {
  catalog.google = q => {
    q = q.toLowerCase();
    if (q.includes("isbn:" + ISBN.tschick)) return [googleItem("Tschick", "Wolfgang Herrndorf", ISBN.tschick, "https://img.test/c.jpg", "Rowohlt", "2010")];
    if (q.includes("momo")) return [googleItem("Momo", "Michael Ende", ISBN.momo, "https://img.test/a.jpg", "Thienemann", "1973")];
    if (q.includes("krabat")) return [googleItem("Krabat. Roman", "Otfried Preußler", ISBN.krabatA, "https://img.test/b.jpg", "Thienemann", "1971"),
      googleItem("Krabat. Jugendbuch", "Otfried Preußler", ISBN.krabatB, "https://img.test/d.jpg", "dtv", "1987")];
    return [];
  };
}
async function scan(page) {
  await page.context().route("https://api.anthropic.com/**", claudeShelf(SCAN));
  await openApp(page);
  await page.evaluate(() => { localStorage.setItem("aiKey", "sk-ant-test"); localStorage.setItem("aiJudge", "0"); openShelfScan(); });
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  await expect(page.locator(".scanrow")).toHaveCount(4, { timeout: 30_000 });
}
const rows = page => page.locator(".scanrow");
const cats = page => page.evaluate(() => [...document.querySelectorAll(".scanrow")].map(r => r.dataset.cat));

test("Kategorien gezählt und filterbar, Kandidaten-Cover antippen, Sammelaktion 🔵, Barcode je Zeile, Rücken groß", async ({ page, catalog }) => {
  catalogFor(catalog);
  await scan(page);
  expect(await cats(page)).toEqual(["ok", "pick", "own", "bad"]);
  const bar = page.locator(".scancats");
  await expect(bar).toContainText("🟢 1 sicher");
  await expect(bar).toContainText("🔵 1 ohne Katalogtreffer");
  await expect(bar).toContainText("🟡 1 mehrere Ausgaben");
  await expect(bar).toContainText("🔴 1 nicht lesbar");
  // Filter: nur 🔵, nochmal tippen = alle
  await bar.locator("[data-cat=own]").click();
  await expect(page.locator(".scanrow:visible")).toHaveCount(1);
  await expect(page.locator(".scanrow:visible .scanin input").first()).toHaveValue("Tschick");
  await bar.locator("[data-cat=own]").click();
  await expect(page.locator(".scanrow:visible")).toHaveCount(4);
  // 🟡: Kandidaten mit Cover – antippen wählt die Ausgabe
  const kr = rows(page).nth(1);
  await expect(kr.locator(".scancand")).toHaveCount(2);
  await expect(kr.locator(".scancand img").first()).toHaveAttribute("src", /img\.test/);
  await kr.locator(".scancand").nth(1).click();
  await expect(kr.locator(".scanpick select")).toHaveValue("1");
  await expect(kr).not.toHaveClass(/unsure/);
  await expect(kr.locator(".scancand")).toHaveCount(0);                                 // erledigt → Kandidaten weg
  // Sammelaktion: alle 🔵 so übernehmen
  await page.locator("[data-bulk=own]").click();
  expect(await cats(page)).toEqual(["ok", "ok", "ok", "bad"]);
  // 🔴 Zeile: Barcode scannen macht sie eindeutig (Live-Kamera nachgebildet)
  await page.evaluate(isbn => { window.liveScan = async () => isbn; }, ISBN.tschick);
  const bad = rows(page).nth(3);
  await bad.getByRole("button", { name: "▦ Barcode" }).click();
  await expect(bad.locator(".scanpick select option:checked")).toContainText(ISBN.tschick);
  await expect(bad).not.toHaveClass(/unsure/);
  await expect(page.locator(".warnnote")).toHaveCount(0);
  // Rücken antippen = groß aus dem Originalfoto, Schrift waagerecht
  await rows(page).nth(0).locator(".scanthumb.zoom").click();
  const big = page.locator(".spinezoom canvas");
  await expect(big).toBeVisible();
  const [w, h] = await big.evaluate(c => [c.width, c.height]);
  expect(w).toBeGreaterThan(h);
  await page.locator(".spinezoom").click();
  await expect(page.locator(".spinezoom")).toHaveCount(0);
});

test("🟢 sichere jetzt übernehmen, Rest später: bleibt am Fach-Foto, beim Abschluss nichts doppelt", async ({ page, catalog }) => {
  catalogFor(catalog);
  await scan(page);
  await page.locator("[data-bulk=ok]").click();
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Die übrigen 3 warten");
  expect(await page.evaluate(() => S.books.map(b => b.title))).toEqual(["Momo"]);
  const rv = await page.evaluate(() => S.photos[0].review.items.map(it => !!it.doneId));
  expect(rv).toEqual([true, false, false, false]);
  expect(await page.evaluate(() => S.photos[0].doneAt || null)).toBeNull();
  // Nach Neustart weitermachen: Momo ist als übernommen markiert
  await page.reload(); await page.waitForFunction(() => typeof S !== "undefined" && S.loaded && typeof runShelfScan === "function");
  await page.evaluate(() => runShelfScan(S.photos[0], "stored"));
  await expect(rows(page)).toHaveCount(4, { timeout: 15_000 });
  await expect(rows(page).nth(0)).toContainText("Schon übernommen");
  await expect(rows(page).nth(0).locator(".scancb input")).toBeDisabled();
  await page.locator("[data-bulk=own]").click();
  await rows(page).nth(3).locator(".scancb input").uncheck();                          // unlesbaren weglassen
  await rows(page).nth(1).getByRole("button", { name: "✓ Passt so" }).click();
  await page.click(".actions.sticky .btn.primary");
  await page.locator(".confirm >> text=Abbrechen").click({ timeout: 3000 }).catch(() => {});
  await expect.poll(() => page.evaluate(() => S.books.map(b => b.title).sort())).toEqual(["Krabat. Roman", "Momo", "Tschick"]);
  expect(await page.evaluate(() => !!S.photos[0].doneAt)).toBe(true);
});

test("Alte gemerkte Prüfliste ohne Kategorien-Felder lädt weiter", async ({ page, catalog }) => {
  catalogFor(catalog);
  await scan(page);
  // Zustand wie von einer älteren Version gemerkt: ohne doneId/judge/suggest
  await page.evaluate(async () => { const p = S.photos[0]; await patchPhoto(p.id, { review: { ...p.review, items: p.review.items.map(({ doneId, judge, suggest, ...it }) => it) } }); closeSheet(); });
  await page.evaluate(() => runShelfScan(S.photos[0], "stored"));
  await expect(rows(page)).toHaveCount(4, { timeout: 15_000 });
  expect(await cats(page)).toEqual(["ok", "pick", "own", "bad"]);
});
