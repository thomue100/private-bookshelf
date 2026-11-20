// Stufe 7 – Cover-Foto: Claude vergleicht das Foto mit den Covern der Suchtreffer (judge.js → judgeCover).
// Sicher → diese Ausgabe steht oben; Vermutung → Hinweis an der Karte (weitere Treffer aufgeklappt); keiner → Hinweis; abschaltbar.
import { test, expect, openApp, fixture, googleItem, isbn13 } from "./helpers.js";

const EN = isbn13("978014031001"), DE = isbn13("978352217521");
function catalogFor(catalog) {
  catalog.google = q => q.toLowerCase().includes("krabat")
    ? [googleItem("Krabat", "Otfried Preußler", EN, "https://img.test/a.jpg", "Puffin", "2000"), googleItem("Krabat", "Otfried Preußler", DE, "https://img.test/b.jpg", "Thienemann", "1971")] : [];
}
// Cover-Erkennung liefert Titel/Autor ohne ISBN; die Treffer-Wahl antwortet je nach verdict
async function claude(page, verdict, log) {
  await page.context().route("https://api.anthropic.com/**", r => {
    const body = JSON.parse(r.request().postData() || "{}"); log.push(body);
    const isJudge = !!body.output_config?.format?.schema?.properties?.books;
    const out = isJudge ? { books: [{ n: 1, ...verdict }] } : { title: "Krabat", author: "Otfried Preußler", isbn: "", confidence: "high" };
    return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] }) });
  });
}
async function coverPhoto(page, setup) {
  await openApp(page);
  await page.evaluate(setup || (() => {}));
  await page.evaluate(() => { localStorage.setItem("aiKey", "sk-ant-test"); openAdd(); });
  const chooser = page.waitForEvent("filechooser");
  await page.click("text=🖼 Cover-Bild wählen");
  await (await chooser).setFiles(fixture("cover-c.jpg"));
  await expect(page.locator(".sheet h2")).toHaveText("Welches Buch ist es?");
}
const judgeReqs = log => log.filter(b => b.output_config?.format?.schema?.properties?.books);

test("Claude ist sicher: die passende Ausgabe rückt nach oben, mit Begründung", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  await claude(page, { choice: 2, confidence: "high", reason: "Puffin-Cover passt zum Foto" }, log);
  await coverPhoto(page);
  await expect(page.locator(".judgewait")).toHaveCount(0);
  const best = page.locator(".cand.best");
  await expect(best).toContainText("ISBN " + EN);                                     // nach Punkten stand die deutsche Ausgabe oben
  await expect(best.locator(".judgetag")).toHaveText("🤖 Claude: das ist diese Ausgabe – Puffin-Cover passt zum Foto");
  const j = judgeReqs(log);
  expect(j).toHaveLength(1);
  const imgs = j[0].messages[0].content.filter(c => c.type === "image");
  expect(imgs).toHaveLength(3);                                                       // Foto + 2 Kandidaten-Cover
  expect(j[0].messages[0].content.filter(c => c.type === "text" && /^Kandidat 1\.\d/.test(c.text)).map(c => c.text.includes("Thienemann"))).toEqual([true, false]);
  await best.click();                                                                 // „Das ist es“
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
});

test("Claude vermutet nur: Reihenfolge bleibt, Hinweis an der vermuteten Ausgabe; keiner passt → Hinweis oben", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  const verdict = { choice: 2, confidence: "medium", reason: "Farben ähnlich" };
  await claude(page, verdict, log);
  await coverPhoto(page);
  await expect(page.locator(".judgewait")).toHaveCount(0);
  await expect(page.locator(".cand.best")).toContainText("ISBN " + DE);              // Punkte-Reihenfolge bleibt
  const more = page.locator("details.morecands");
  await expect(more).toHaveAttribute("open", "");
  await expect(more.locator(".cand").first().locator(".judgetag")).toHaveText("🤖 Claude vermutet diese Ausgabe – Farben ähnlich");
  // neue Suche, jetzt passt keiner
  Object.assign(verdict, { choice: 0, confidence: "high", reason: "Foto zeigt eine andere Ausgabe" });
  await page.locator(".manual input[type=search]").fill("Krabat Preußler");
  await page.locator(".manual button:text-is('Suchen')").click();
  await expect(page.locator(".cands .note.info")).toHaveText("🤖 Claude: keiner der Treffer passt sicher zu deinem Foto – Foto zeigt eine andere Ausgabe");
});

test("Abgeschaltet: keine Anfrage, Treffer wie bisher", async ({ page, catalog }) => {
  catalogFor(catalog);
  const log = [];
  await claude(page, { choice: 2, confidence: "high", reason: "x" }, log);
  await coverPhoto(page, () => localStorage.setItem("aiJudge", "0"));
  await expect(page.locator(".cand.best")).toContainText("ISBN " + DE);
  await expect(page.locator(".judgetag")).toHaveCount(0);
  await expect(page.locator(".judgewait")).toHaveCount(0);
  expect(judgeReqs(log)).toHaveLength(0);
});
