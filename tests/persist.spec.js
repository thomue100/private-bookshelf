// Stufe 1 – Listen gehen nie mehr verloren: Prüfliste am Fach-Foto gemerkt, Entwurf „Prüfen & speichern“ nach Neustart,
// Hintergrund/✕/Zurück-Taste mit Nachfrage, keine stillen Ersetzungen durch Hintergrund-Aktionen.
import { test, expect, openApp, fixture, googleItem, isbn13, claudeShelf } from "./helpers.js";

const item = (title, author, x0, x1) => ({ kind: "book", position: "standing", title, author, publisher: "", isbn: "", spine_text_vertical: title, text_direction: "up", bbox: { x0, x1, y0: 0.3, y1: 0.95 }, confidence: "high" });
const SCAN = { compartment: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [item("Momo", "Michael Ende", 0.05, 0.12), item("Krabat", "Otfried Preußler", 0.13, 0.2), item("Tschick", "Wolfgang Herrndorf", 0.21, 0.28)] };
const json = (r, body) => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(body) });
function catalogFor(catalog) {
  catalog.google = q => { q = q.toLowerCase(); for (const [t, a] of [["momo", "Michael Ende"], ["krabat", "Otfried Preußler"], ["tschick", "Wolfgang Herrndorf"]]) if (q.includes(t)) return [googleItem(t[0].toUpperCase() + t.slice(1), a, isbn13("97834230" + String(t.length).padStart(4, "0")))]; return []; };
}
async function scanPhoto(page) {
  await page.context().route("https://api.anthropic.com/**", claudeShelf(SCAN));
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("aiKey", "sk-ant-test"));
  await page.evaluate(() => openShelfScan());
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  await expect(page.locator(".scanrow")).toHaveCount(3, { timeout: 30_000 });
}
const rows = page => page.locator(".scanrow");

test("Fach-Foto-Prüfliste: Korrekturen, Auswahl und „Passt so“ überstehen einen Neustart", async ({ page, catalog }) => {
  catalogFor(catalog);
  await scanPhoto(page);
  await rows(page).nth(0).locator(".scanin input").first().fill("Momo – geändert");
  await rows(page).nth(1).locator("input[type=checkbox]").uncheck();
  await page.locator(".scanopts select").first().selectOption("read");
  await page.waitForTimeout(1200); // gemerkt (verzögert gespeichert)
  await page.reload();                                                 // Android hat die App beendet
  await page.waitForFunction(() => S.loaded);
  await expect(rows(page)).toHaveCount(3, { timeout: 15_000 });       // macht von selbst dort weiter
  await expect(rows(page).nth(0).locator(".scanin input").first()).toHaveValue("Momo – geändert");
  await expect(rows(page).nth(1)).toHaveClass(/off/);
  await expect(page.locator(".scanopts select").first()).toHaveValue("read");
  // Schließen verliert nichts: über „Gespeicherte Fach-Fotos“ wieder da
  await page.click(".sheet .x");
  await expect(page.locator(".toast")).toContainText("Prüfliste gemerkt");
  await page.evaluate(() => openPhotoInbox());
  await page.click("text=Prüfen & einsortieren");
  await expect(rows(page).nth(0).locator(".scanin input").first()).toHaveValue("Momo – geändert");
  // Übernehmen: gemerkter Stand wird gelöscht
  await page.click(".actions.sticky .btn.primary");
  await page.locator(".confirm >> text=Abbrechen").click({ timeout: 5000 }).catch(() => {});
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(2);
  expect(await page.evaluate(() => S.books.find(b => b.title.startsWith("Momo"))?.status)).toBe("read");
  expect(await page.evaluate(() => S.photos[0].review)).toBeNull();
});

test("„Prüfen & speichern“: Hintergrund-Klick und Zurück-Taste fragen nach; nach Neustart weitermachen samt Cover-Foto", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => openAdd());
  await page.click("text=Ganz von Hand eintragen");
  await page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field").first().fill("Das Parfum");
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".dtop > div > .covertools button:text-is('🖼 Bild wählen')").click();
  await (await chooser).setFiles(fixture("cover-b.jpg"));
  // Hintergrund (PC) → Nachfrage; „Abbrechen“ lässt alles offen
  await page.mouse.click(5, 300);
  await expect(page.locator(".confirm")).toContainText("„Das Parfum“ ist noch nicht gespeichert");
  await page.click(".confirm >> text=Abbrechen");
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  // Zurück-Taste → Nachfrage statt Verlust
  await page.evaluate(() => history.back());
  await expect(page.locator(".confirm")).toContainText("noch nicht gespeichert");
  await page.click(".confirm >> text=Abbrechen");
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  // Neustart (z. B. Android schließt die App, während die Kamera offen ist)
  await page.waitForTimeout(800);
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await expect(page.locator(".resumebar")).toContainText("Du warst gerade dabei, „Das Parfum“ zu erfassen");
  await page.click(".resumebar button:text-is('Weitermachen')");
  await expect(page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field").first()).toHaveValue("Das Parfum");
  await expect(page.locator(".dtop .cover img")).toHaveCount(1);
  await page.click(".actions .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(1);
  expect(await page.evaluate(() => !!S.books[0].coverBlob)).toBe(true);
  expect(await page.evaluate(() => DB.getMeta("reviewDraft"))).toBeNull();
  // Zurück-Taste mit „Verwerfen“ schließt
  await page.evaluate(() => openReview({ title: "Nur kurz" }, null));
  await page.evaluate(() => history.back());
  await page.click(".confirm .btn.primary");
  await expect(page.locator(".sheet")).toHaveCount(0);
});

test.describe("am Handy", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("Tippen auf den Hintergrund schließt nichts – nur ✕", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => openAdd());
    await page.mouse.click(195, 20); // oberhalb des Blatts
    await expect(page.locator(".sheet")).toHaveCount(1);
    await page.click(".sheet .x");
    await expect(page.locator(".sheet")).toHaveCount(0);
  });
});

test("Zwischenablage-Angebot ersetzt keine offene Prüfliste; ein Blatt mit Änderungen wird nie still ersetzt", async ({ page, context, catalog }) => {
  catalogFor(catalog);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await scanPhoto(page);
  await page.evaluate(async () => { WT.since = Date.now(); WT.before = ""; await navigator.clipboard.writeText("9783423000017"); await checkWebReturn(); });
  await expect(page.locator(".clipoffer")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("In der Zwischenablage: ISBN");
  await expect(rows(page)).toHaveCount(3);
  // Ein anderes Blatt öffnet sich über einem Entwurf mit Änderungen → der Entwurf bleibt erhalten und kommt zurück
  await page.evaluate(() => { closeSheet(); openReview({ title: "Bleibt" }, null); });
  await page.evaluate(() => openAdd());
  await expect(page.locator(".sheet h2:visible")).toHaveText("Buch hinzufügen");
  await page.click(".sheet:visible .x");
  await expect(page.locator(".sheet h2:visible")).toHaveText("Prüfen & speichern");
  await expect(page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field").first()).toHaveValue("Bleibt");
});

test("„Der Reihe nach prüfen“ geht nach einem Neustart mit dem nächsten Fach weiter", async ({ page, catalog }) => {
  catalogFor(catalog);
  await openApp(page);
  await page.evaluate(async scan => {
    const c = document.createElement("canvas"); c.width = 400; c.height = 300; c.getContext("2d").fillRect(0, 0, 400, 300);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg"));
    for (const id of ["f1", "f2"]) await putPhoto({ id, createdAt: new Date().toISOString(), fachKey: "", blob, w: 400, h: 300, scan, scanAt: new Date().toISOString() });
    S.reviewChain = true; S.chainNoCov = []; chainSave();
  }, SCAN);
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await expect(rows(page)).toHaveCount(3, { timeout: 15_000 });
  expect(await page.evaluate(() => S.reviewChain)).toBe(true);
  await expect(page.locator(".sheet .note.info").first()).toContainText("Danach geht es direkt mit dem nächsten Fach weiter");
});

test("Kompatibilität: Fach-Foto mit gemerkter Prüfliste geht durch Sicherung; alte Fotos ohne „review“ funktionieren", async ({ page, browser }) => {
  await openApp(page);
  const backup = await page.evaluate(async scan => {
    const c = document.createElement("canvas"); c.width = 400; c.height = 300; c.getContext("2d").fillRect(0, 0, 400, 300);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg"));
    await putPhoto({ id: "neu", createdAt: new Date().toISOString(), fachKey: "", blob, w: 400, h: 300, scan, review: { at: new Date().toISOString(), fachKey: "", opts: { status: "read" }, items: [{ ...scan.items[0], include: true, cands: [], choice: -1, confirmed: true, title: "Gemerkt" }] } });
    await putPhoto({ id: "alt", createdAt: "2024-01-01T00:00:00.000Z", fachKey: "", blob, w: 400, h: 300, scan });
    return buildBackup();
  }, SCAN);
  const ctx2 = await browser.newContext();
  await ctx2.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  const p2 = await ctx2.newPage();
  await openApp(p2);
  await p2.evaluate(d => importData(d), backup);
  const r = await p2.evaluate(() => ({ neu: S.photos.find(p => p.id === "neu").review?.items?.[0]?.title, alt: S.photos.find(p => p.id === "alt").review }));
  expect(r).toEqual({ neu: "Gemerkt", alt: undefined });
  // gemerkte Prüfliste öffnet ohne neue Suche genau so
  await p2.evaluate(() => runShelfScan(S.photos.find(p => p.id === "neu"), "stored"));
  await expect(p2.locator(".scanrow")).toHaveCount(1);
  await expect(p2.locator(".scanrow .scanin input").first()).toHaveValue("Gemerkt");
  await ctx2.close();
});
