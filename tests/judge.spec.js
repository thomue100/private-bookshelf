// Stufe 4 – Claude wählt den Katalogtreffer: Rücken-Foto + Kandidaten (mit kleinem Cover) → Wahl, Sicherheit, Grund.
// Sicher → automatisch; sonst gelb mit Vorschlag; abschaltbar; optionale Websuche (ISBN im Katalog bestätigt).
import { test, expect, openApp, fixture, googleItem, isbn13, claudeShelf } from "./helpers.js";

const item = (title, author, x0, x1) => ({ kind: "book", position: "standing", title, author, text_direction: "up", bbox: { x0, x1, y0: 0.3, y1: 0.95 }, confidence: "high" });
const SCAN = { compartment: { x0: 0, y0: 0, x1: 1, y1: 1 }, items: [item("Momo", "Michael Ende", 0.04, 0.12), item("Krabat", "Otfried Preußler", 0.14, 0.22), item("Tschick", "Wolfgang Herrndorf", 0.3, 0.38)] };
const ISBN = { momo: isbn13("978342000001"), momoHeft: isbn13("978342000002"), krabat: isbn13("978342000003"), krabatEn: isbn13("978342000004"), tschick: isbn13("978342000005") };
// Je Titel zwei Kandidaten: die Lektürehilfe bzw. Übersetzung steht nach Punkten vorne
function catalogFor(catalog) {
  catalog.google = q => {
    q = q.toLowerCase();
    if (q.includes("isbn:" + ISBN.tschick)) return [googleItem("Tschick", "Wolfgang Herrndorf", ISBN.tschick, "https://img.test/c.jpg", "Rowohlt", "2010")];
    if (q.includes("momo")) return [googleItem("Momo", "Michael Ende", ISBN.momoHeft, "https://img.test/a.jpg", "Lernhilfe-Verlag"), googleItem("Momo", "Michael Ende", ISBN.momo, "https://img.test/b.jpg", "Thienemann", "1973")];
    if (q.includes("krabat")) return [googleItem("Krabat", "Otfried Preußler", ISBN.krabatEn, "https://img.test/c.jpg"), googleItem("Krabat", "Otfried Preußler", ISBN.krabat, "https://img.test/d.jpg", "Thienemann")];
    return [];
  };
}
// Nachbildung der Treffer-Wahl: Momo → Kandidat mit Verlag Thienemann (sicher), Krabat → Kandidat 2 (nur „medium“), Tschick → keiner
const judgeRe = /^Kandidat (\d+)\.(\d+): (.*)$/;
function judgeAnswer(body) {
  if (!body.output_config?.format?.schema?.properties?.books) return undefined;
  const texts = body.messages[0].content.filter(c => c.type === "text").map(c => c.text);
  const books = [];
  for (const t of texts) {
    const b = t.match(/^Buch (\d+) – Foto:$/); if (b) books.push({ n: +b[1], cands: [] });
    const k = t.match(judgeRe); if (k) books[books.length - 1].cands.push(k[3]);
  }
  return { books: books.map(({ n, cands }) => {
    if (n === 1) return { n, choice: cands.findIndex(c => c.includes("Thienemann")) + 1, confidence: "high", reason: "Verlag und Cover passen" };
    if (n === 2) return { n, choice: 2, confidence: "medium", reason: "Cover nur ähnlich" };
    return { n, choice: 0, confidence: "high", reason: "keiner passt" };
  }) };
}
async function scan(page, handler, before) {
  await page.context().route("https://api.anthropic.com/**", handler);
  await openApp(page);
  await page.evaluate(before || (() => {}));
  await page.evaluate(() => { localStorage.setItem("aiKey", "sk-ant-test"); openShelfScan(); });
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  await expect(page.locator(".scanrow")).toHaveCount(3, { timeout: 30_000 });
}
const judgeReqs = log => log.filter(b => b.output_config?.format?.schema?.properties?.books);
const picked = (page, n) => page.locator(".scanrow").nth(n).locator(".scanpick select option:checked");

test("Claude vergleicht Rücken und Kandidaten-Cover: sicher → übernommen, unsicher → gelb mit Vorschlag", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  await scan(page, claudeShelf(SCAN, { log, answer: judgeAnswer }));
  const jr = judgeReqs(log);
  expect(jr).toHaveLength(1);                                                           // 3 Bücher → eine Anfrage
  expect(jr[0]).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low", format: { type: "json_schema" } } });
  const content = jr[0].messages[0].content;
  expect(content.filter(c => c.type === "image")).toHaveLength(2 + 4);                 // 2 Rücken (Tschick hat keine Kandidaten) + 4 Kandidaten-Cover
  expect(content.filter(c => c.type === "text" && judgeRe.test(c.text))).toHaveLength(4); // Momo 2 + Krabat 2 (Tschick hat keine Kandidaten)
  // Momo: Claude wählt die Thienemann-Ausgabe, obwohl die Lernhilfe vorne stand – nicht gelb
  await expect(picked(page, 0)).toContainText("🤖 Momo");
  await expect(picked(page, 0)).toContainText(ISBN.momo);
  await expect(page.locator(".scanrow").nth(0)).not.toHaveClass(/unsure/);
  // Krabat: nur ein Vorschlag – gelb, mit Grund und Knopf
  const kr = page.locator(".scanrow").nth(1);
  await expect(kr).toHaveClass(/unsure/);
  await expect(kr).toContainText("Claude vermutet „Krabat“ – Cover nur ähnlich");
  await kr.locator("text=🤖 Vorschlag übernehmen").click();
  await expect(picked(page, 1)).toContainText(ISBN.krabat);
  await expect(kr).not.toHaveClass(/unsure/);
  // Protokoll: Claudes Urteil steht beim Buch
  const rec = await page.evaluate(async () => (await recLogAll())[0].books.map(b => b.warum));
  expect(rec[0]).toContain("gewählt von Claude (high): Verlag und Cover passen");
  expect(rec[1]).toContain("nur Vorschlag 2");
  // Übernehmen: richtige ISBN im Bestand
  await page.click(".actions.sticky .btn.primary");
  await page.locator(".confirm >> text=Trotzdem übernehmen").click({ timeout: 3000 }).catch(() => {});
  await expect.poll(() => page.evaluate(() => S.books.map(b => b.isbn).sort())).toEqual(["", ISBN.krabat, ISBN.momo].sort()); // Tschick ohne Katalogtreffer
});

test("Band passt nicht → auch bei „sicher“ nur Vorschlag; abgeschaltet → keine Anfrage, Punkte wie bisher", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  await scan(page, claudeShelf(SCAN, { log, answer: judgeAnswer }), () => localStorage.setItem("aiJudge", "0"));
  expect(judgeReqs(log)).toHaveLength(0);
  // Band-Regel direkt geprüft
  const r = await page.evaluate(() => {
    const it = { title: "Harry Potter", volume: "3", cands: [{ title: "Harry Potter", seriesNo: "2", isbn: "x" }], choice: -1 };
    applyJudge(it, { choice: 1, confidence: "high", reason: "Titel passt" }, [0]);
    return { choice: it.choice, suggest: it.suggest, conflict: it.judge.volConflict };
  });
  expect(r).toEqual({ choice: -1, suggest: 0, conflict: true });
  // Einstellung: Schalter in den Einstellungen
  await page.evaluate(() => { closeSheet(); document.body.append(Object.assign(judgeSettingsBox(), { id: "jbox" })); });
  const cb = page.locator("#jbox input[type=checkbox]").first();
  await expect(cb).not.toBeChecked();
  await cb.check();
  expect(await page.evaluate(() => localStorage.getItem("aiJudge"))).toBe("1");
});

test("Websuche (eingeschaltet): findet die ISBN, der Katalog bestätigt sie", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  const answer = body => {
    if (body.tools?.some(t => t.name === "web_search")) return { found: true, isbn: ISBN.tschick, title: "Tschick", author: "Wolfgang Herrndorf", publisher: "Rowohlt", year: "2010", confidence: "high" };
    return judgeAnswer(body);
  };
  await scan(page, claudeShelf(SCAN, { log, answer }), () => localStorage.setItem("aiWebSearch", "1"));
  const ws = log.filter(b => b.tools?.some(t => t.name === "web_search"));
  expect(ws).toHaveLength(1);                                                           // nur Tschick (ohne Kandidaten)
  expect(ws[0].messages[0].content[0].text).toContain("Tschick");
  await expect(picked(page, 2)).toContainText(ISBN.tschick);
  await expect(page.locator(".scanrow").nth(2)).not.toHaveClass(/unsure/);
});
