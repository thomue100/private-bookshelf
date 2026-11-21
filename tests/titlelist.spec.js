// „📋 Titelliste einfügen“: Liste verstehen (parseTitleList), Katalogsuche wie beim Fach-Foto, Prüfliste ohne Foto, Übernehmen, Weitermachen.
import { test, expect, openApp, seedBooks, googleItem, isbn13 } from "./helpers.js";

const I1 = isbn13("978342319001"), I2 = isbn13("978342319002");
const parse = (page, text, map) => page.evaluate(([t, m]) => parseTitleList(t, m || undefined), [text, map]);
const pick = (it, ...keys) => Object.fromEntries(keys.map(k => [k, it[k]]));

test("parseTitleList: Freitext, Nummern, Aufzählungen, Band, Verlag/Jahr, ISBN", async ({ page }) => {
  await openApp(page);
  const { items, table } = await parse(page, [
    "1. Momo – Michael Ende",
    "- Der Vorleser - Bernhard Schlink",
    "Michael Ende: Die unendliche Geschichte",
    "Krabat von Otfried Preußler",
    "Tschick (Wolfgang Herrndorf)",
    "",
    "Preußler, Otfried: Die kleine Hexe",
    "• Weihnachtsgeschichten am Kamin Bd. 27",
    "12) Harry Potter #3",
    "* Das Boot, Band 2",
    "Der Name der Rose (dtv, 1998)",
    "☐ Faust: Der Tragödie erster Teil",
    `Siddhartha, ISBN ${I1}`,
    I2.replace(/^(\d{3})(\d)(\d{3})(\d{5})(\d)$/, "$1-$2-$3-$4-$5"),
    "irgendwas über Katzen und Hunde im Sommer",
  ].join("\n"));
  expect(table).toBeNull();
  const r = items.map(it => pick(it, "title", "author", "volume", "publisher", "year", "isbn"));
  const e = (title, author = "", more = {}) => ({ title, author, volume: "", publisher: "", year: "", isbn: "", ...more });
  expect(r).toEqual([
    e("Momo", "Michael Ende"),
    e("Der Vorleser", "Bernhard Schlink"),
    e("Die unendliche Geschichte", "Michael Ende"),
    e("Krabat", "Otfried Preußler"),
    e("Tschick", "Wolfgang Herrndorf"),
    e("Die kleine Hexe", "Otfried Preußler"),
    e("Weihnachtsgeschichten am Kamin", "", { volume: "27" }),
    e("Harry Potter", "", { volume: "3" }),
    e("Das Boot", "", { volume: "2" }),
    e("Der Name der Rose", "", { publisher: "dtv", year: "1998" }),
    e("Faust: Der Tragödie erster Teil"),               // Doppelpunkt, aber links kein Name → ganze Zeile
    e("Siddhartha", "", { isbn: I1 }),
    e("", "", { isbn: I2 }),
    e("irgendwas über Katzen und Hunde im Sommer"),     // unklar → ganze Zeile als Suchtext
  ]);
  expect(items[0].line).toBe("1. Momo – Michael Ende"); // Originalzeile bleibt
});

test("parseTitleList: Excel (Tabs) mit und ohne Kopfzeile, CSV mit Anführungszeichen und Semikolon, englische Kopfzeile", async ({ page }) => {
  await openApp(page);
  const xl = await parse(page, "Titel\tAutor\tJahr\tISBN\tSchlagworte\nMomo\tMichael Ende\t1973\t\tKinderbuch, Klassiker\nKrabat\tPreußler, Otfried\t1971\t" + I1 + "\t\n");
  expect(xl.table).toMatchObject({ sep: "\t", header: true });
  expect(xl.items.map(it => pick(it, "title", "author", "year", "isbn", "tags"))).toEqual([
    { title: "Momo", author: "Michael Ende", year: "1973", isbn: "", tags: ["Kinderbuch", "Klassiker"] },
    { title: "Krabat", author: "Otfried Preußler", year: "1971", isbn: I1, tags: [] }]);
  // ohne Kopfzeile: Namen-Spalte ist der Autor, auch wenn sie vorne steht
  const raw = await parse(page, "Michael Ende\tDie unendliche Geschichte\t1979\nOtfried Preußler\tDer Räuber Hotzenplotz\t1962\nBernhard Schlink\tDer Vorleser\t1995");
  expect(raw.table).toMatchObject({ header: false, map: ["author", "title", "year"] });
  expect(raw.items[1]).toMatchObject({ title: "Der Räuber Hotzenplotz", author: "Otfried Preußler", year: "1962" });
  // Spalten von Hand anders zuordnen
  const fixed = await parse(page, "Michael Ende\tDie unendliche Geschichte\t1979\nOtfried Preußler\tDer Räuber Hotzenplotz\t1962", ["title", "", "year"]);
  expect(fixed.items[0]).toMatchObject({ title: "Michael Ende", author: "" });
  // CSV mit Semikolon, Anführungszeichen, verdoppelten Anführungszeichen
  const csv = await parse(page, 'Titel;Autor;Verlag\n"Ich; du und er";"Ende, Michael";dtv\n"Der ""große"" Gatsby";F. Scott Fitzgerald;Diogenes\n');
  expect(csv.items.map(it => pick(it, "title", "author", "publisher"))).toEqual([
    { title: "Ich; du und er", author: "Michael Ende", publisher: "dtv" }, { title: 'Der "große" Gatsby', author: "F. Scott Fitzgerald", publisher: "Diogenes" }]);
  // Komma-CSV nur mit Kopfzeile als Tabelle
  const en = await parse(page, 'Title,Author,Year\n"Momo, the book",Michael Ende,1973\n');
  expect(en.items[0]).toMatchObject({ title: "Momo, the book", author: "Michael Ende", year: "1973" });
});

test("parseTitleList: der eigene CSV-Export lässt sich vollständig wieder einlesen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(i => Promise.all([
    patchBook("b0", { isbn: i, tags: ["Kinderbuch", "Klassiker"], series: "Reihe X", seriesNo: "3", notes: "Zeile 1\nZeile 2; mit \"Zitat\"", publisher: "Thienemann" }),
    patchBook("b1", { dedication: "Für dich;\nalles Gute" }),
  ]), I1);
  const text = await page.evaluate(async () => { let blob; const orig = saveFile; saveFile = (n, b) => { blob = b; }; exportCsv(); saveFile = orig; return await blob.text(); });
  const { items, table } = await parse(page, text);
  expect(table).toMatchObject({ sep: ";", header: true });
  expect(items).toHaveLength(12);
  const momo = items.find(it => it.title === "Momo");
  expect(pick(momo, "author", "isbn", "publisher", "year", "series", "volume", "tags")).toEqual({ author: "Michael Ende", isbn: I1, publisher: "Thienemann", year: "2000", series: "Reihe X", volume: "3", tags: ["Kinderbuch", "Klassiker"] });
  expect(items.map(it => it.title).sort()).toEqual(await page.evaluate(() => S.books.map(b => b.title).sort()));
});

/* ---------- Ablauf ---------- */
const LIST = [
  I1,                                           // ISBN → sicher
  "Der Vorleser – Bernhard Schlink",            // eindeutiger Titel → automatisch
  "Weihnachtsgeschichten am Kamin Bd. 27",      // Reihe mit Band
  "Faust",                                      // mehrdeutig → gelb
  "Gibt es nicht – Erika Mustermann",           // nicht gefunden → gelb, nur eigene Angaben
  "Momo – Michael Ende",                        // schon vorhanden → übersprungen
].join("\n");
function catalogFor(catalog) {
  catalog.dnb = cql => cql.includes(I1) ? [{ title: "Siddhartha", author: "Hesse, Hermann", publisher: "Suhrkamp", year: "1974", isbn: I1 }] : [];
  catalog.google = q => {
    q = q.toLowerCase();
    if (q.includes("vorleser")) return [googleItem("Der Vorleser", "Bernhard Schlink", isbn13("978325722953"), null, "Diogenes", "1997")];
    if (q.includes("weihnachtsgeschichten")) return [googleItem("Weihnachtsgeschichten am Kamin 27", "Barbara Mürmann", isbn13("978349927123"), null, "Rowohlt"), googleItem("Weihnachtsgeschichten am Kamin 26", "Barbara Mürmann", isbn13("978349927122"), null, "Rowohlt")];
    if (q.includes("faust")) return [googleItem("Faust. Der Tragödie erster Teil", "Johann Wolfgang von Goethe", isbn13("978315000001"), null, "Reclam"), googleItem("Faust. Der Tragödie zweiter Teil", "Johann Wolfgang von Goethe", isbn13("978315000002"), null, "Reclam")];
    if (q.includes("momo")) return [googleItem("Momo", "Michael Ende", isbn13("978352220210"), null, "Thienemann")];
    return [];
  };
}
async function wall(page) {
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  await page.click("text=Ein 4er-Würfel (1112)");
  await page.click(".confirm .btn.primary");
  await expect(page.locator(".wall .fach").first()).toBeVisible();
}
async function pasteAndSearch(page, text) {
  await page.click("#addTitleList");
  await page.fill(".tltext", text);
  await page.click("text=Weiter: Liste prüfen");
  await expect(page.locator(".tlrow")).toHaveCount(text.split("\n").filter(Boolean).length);
  await page.click(".actions.sticky .btn.primary"); // „🔎 … suchen“
  await expect(page.locator(".scanlist")).toBeVisible({ timeout: 30_000 });
}

test("Titelliste: 6 Zeilen – sicher, automatisch, Band, mehrdeutig, nicht gefunden, schon vorhanden; mit Schlagwort ins Fach", async ({ page, catalog }) => {
  catalogFor(catalog);
  await openApp(page);
  await page.evaluate(() => putBook({ id: "momo", title: "Momo", author: "Michael Ende", status: "read", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z" }));
  await wall(page);
  await page.evaluate(() => openAdd());
  await pasteAndSearch(page, LIST);
  const rows = page.locator(".scanrow");
  await expect(rows).toHaveCount(6);
  await expect(page.locator(".scanphoto")).toHaveCount(0);                       // kein Fotobereich
  await expect(rows.nth(0).locator(".tlline")).toHaveText(I1);                    // Originalzeile
  const unsure = await rows.evaluateAll(rs => rs.map(r => r.classList.contains("unsure")));
  expect(unsure).toEqual([false, false, false, true, true, false]);
  await expect(rows.nth(3).locator(".scanwhy")).toContainText("Titel aus der Liste nicht eindeutig");
  expect(await rows.nth(3).locator("select option").count()).toBe(3);             // beide Faust-Treffer zur Auswahl
  await expect(rows.nth(4).locator(".scanwhy")).toContainText("deine Angaben aus der Liste");
  await expect(rows.nth(5)).toHaveClass(/off/);                                   // schon vorhanden → nicht angehakt
  await expect(rows.nth(5)).toContainText("wird übersprungen");
  expect(await rows.nth(2).locator("select").inputValue()).toBe("0");             // richtiger Band gewählt
  // Optionen: Schlagwort dazu, Ziel-Fach
  await page.locator(".scanopts .taginput").fill("Kiste 3"); await page.locator(".scanopts .taginput").press("Enter");
  await page.locator(".scanopts select").nth(1).selectOption({ index: 1 });
  await page.click(".actions.sticky .btn.primary");
  await page.click(".confirm .btn.primary");                                      // 2 noch ungeprüft – trotzdem
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(6);
  const r = await page.evaluate(() => {
    const f = fachOptions()[0];
    return {
      order: layerList(f.m, f.k, "front").map(id => S.books.find(b => b.id === id).title),
      tags: [...new Set(S.books.filter(b => b.source === "liste").map(b => b.tags.join("|")))],
      vol: (b => [b.series, b.seriesNo])(S.books.find(b => b.title.startsWith("Weihnachts"))),
      own: (b => [b.author, b.isbn])(S.books.find(b => b.title === "Gibt es nicht")),
      momos: S.books.filter(b => b.title === "Momo").length,
    };
  });
  expect(r.order).toEqual(["Siddhartha", "Der Vorleser", "Weihnachtsgeschichten am Kamin 27", "Faust", "Gibt es nicht"]);
  expect(r.tags).toEqual(["Liste-Import|Kiste 3"]);
  expect(r.vol[1]).toBe("27");
  expect(r.own).toEqual(["Erika Mustermann", ""]);
  expect(r.momos).toBe(1);
  expect(await page.evaluate(() => DB.getMeta("titleListRun"))).toBeNull();          // gemerkter Lauf gelöscht
});

test("Titelliste: Wunschlisten-Modus legt Wünsche an; im Bestand-Modus wird ein Wunsch als gekauft übernommen", async ({ page, catalog }) => {
  catalog.google = q => q.toLowerCase().includes("tschick") ? [googleItem("Tschick", "Wolfgang Herrndorf", isbn13("978349927001"))]
    : q.toLowerCase().includes("krabat") ? [googleItem("Krabat", "Otfried Preußler", isbn13("978352217520"))] : [];
  await openApp(page);
  await page.evaluate(() => putBook({ id: "kra", title: "Krabat", author: "Otfried Preußler", status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z", wish: true }));
  await page.evaluate(() => openAdd(true));
  await pasteAndSearch(page, "Tschick – Wolfgang Herrndorf");
  await expect(page.locator(".scanopts .seg .on")).toContainText("Wunschliste");
  await page.click(".actions.sticky .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(2);
  expect(await page.evaluate(() => isWish(S.books.find(b => b.title === "Tschick")))).toBe(true);

  await page.evaluate(() => openAdd(false));
  await pasteAndSearch(page, "Krabat – Otfried Preußler");
  await expect(page.locator(".scanrow")).toContainText("Wunschliste");
  await page.click(".actions.sticky .btn.primary");
  await expect.poll(() => page.evaluate(() => isWish(S.books.find(b => b.id === "kra")))).toBe(false);
  expect(await page.evaluate(() => S.books.filter(b => b.title === "Krabat").length)).toBe(1);
});

test("Titelliste: Neustart mitten in der Suche → „Titelliste weiter prüfen“; Google-Limit stört nicht", async ({ page, catalog }) => {
  catalogFor(catalog);
  let slow = true;
  await page.route("https://www.googleapis.com/books/**", async r => {
    const q = new URL(r.request().url()).searchParams.get("q") || "";
    if (/faust/i.test(q) && slow) { await new Promise(res => setTimeout(res, 4000)); return r.abort().catch(() => {}); }
    if (/gibt es nicht/i.test(q)) return r.fulfill({ status: 429, body: "{}" }); // Kontingent erschöpft
    return r.fallback();
  });
  await openApp(page);
  await page.evaluate(() => openAdd());
  await page.click("#addTitleList");
  await page.fill(".tltext", LIST);
  await page.click("text=Weiter: Liste prüfen");
  await page.click(".actions.sticky .btn.primary");
  await expect.poll(() => page.evaluate(async () => (await DB.getMeta("titleListRun"))?.items.filter(i => i.searched).length || 0)).toBeGreaterThanOrEqual(3);
  await page.reload();                                                               // Android schließt die App
  await page.waitForFunction(() => S.loaded);
  slow = false;
  await expect(page.locator(".tlresume")).toContainText("Angefangene Titelliste (6 Bücher)");
  await page.click(".tlresume >> text=Titelliste weiter prüfen");
  await expect(page.locator(".scanrow")).toHaveCount(6, { timeout: 30_000 });
  await expect(page.locator(".scanrow").nth(1)).not.toHaveClass(/unsure/);         // Ergebnis von vorher ist da
  await expect(page.locator(".scanrow").nth(4).locator(".scanwhy")).toContainText("Nicht im Katalog gefunden"); // 429 → kein Abbruch
  // „Später weiter“ und wieder öffnen: Auswahl bleibt
  await page.locator(".scanrow").nth(3).locator("select").selectOption("1");
  await page.click("text=Später weiter");
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await page.click(".tlresume >> text=Titelliste weiter prüfen");
  expect(await page.locator(".scanrow").nth(3).locator("select").inputValue()).toBe("1");
  // verwerfen
  await page.evaluate(() => closeSheet());
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await page.click(".tlresume >> text=verwerfen");
  await page.click(".confirm .btn.primary");
  await expect(page.locator(".tlresume")).toHaveCount(0);
  expect(await page.evaluate(() => DB.getMeta("titleListRun"))).toBeNull();
});

test("Fach-Foto-Texte bleiben wörtlich wie bisher", async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const it = { kind: "book", include: true, title: "X", author: "", cands: [], choice: -1, confidence: "low" };
    assessScan([it]); return it.reasons;
  });
  expect(r).toEqual(["Rücken schlecht lesbar – Titel bitte prüfen", "Nicht im Katalog gefunden – es werden die erkannten Angaben übernommen"]);
});
