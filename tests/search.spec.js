// Titelsuche beim Hinzufügen: „Band 27“ wird verstanden, der richtige Band steht oben, ein Katalog allein reicht für Treffer.
import { deflateSync } from "node:zlib";
import { test, expect, openApp, fixtureBytes } from "./helpers.js";

const KAMIN = "Weihnachtsgeschichten am Kamin";
const band = (n, isbn, year = "2012") => ({ title: KAMIN, part: n + ".", author: "Mürmann, Barbara", publisher: "Rowohlt Taschenbuch Verlag", year, isbn, series: "Rororo", seriesNo: String(25700 + n) });
const lobidBand = (n, isbn) => ({ title: KAMIN, otherTitleInformation: ["gesammelt von Barbara Mürmann"], isbn: [isbn],
  contribution: [{ agent: { label: "Mürmann, Barbara", type: ["Person"] }, role: { id: "http://id.loc.gov/vocabulary/relators/edt" } }],
  publication: [{ startDate: "2021", publishedBy: ["Rowohlt Taschenbuch Verlag"] }], extent: "230 Seiten", language: [{ label: "Deutsch" }],
  isPartOf: [{ hasSuperordinate: [{ label: KAMIN }], numbering: String(n) }], medium: [{ label: "Print" }] });

async function search(page, q) {
  await page.evaluate(q => showSearch(q), q);
  await expect(page.locator(".cand").first()).toBeVisible();
}

test("„Band 27“: DNB findet den Band ohne das Wort „Band“, er steht oben und Reihe/Band werden übernommen", async ({ page, catalog }) => {
  const asked = [];
  catalog.dnb = cql => {
    asked.push(cql);
    if (/band/i.test(cql)) return []; // wie die echte DNB: das Wort „Band“ steht nicht im Datensatz
    if (cql === `tit all "${KAMIN} 27"` || cql === "num=9783499257957") return [band(27, "9783499257957")];
    return [];
  };
  catalog.lobid = () => [lobidBand(36, "9783499007347")];
  await page.route("https://www.googleapis.com/**", r => r.fulfill({ status: 429, body: "{}" })); // Google-Kontingent erschöpft
  await openApp(page);
  await search(page, `${KAMIN} Band 27`);
  expect(asked[0]).toBe(`tit all "${KAMIN} 27"`); // mit Band genau im Titel suchen
  const first = page.locator(".cand").first();
  await expect(first.locator("b")).toHaveText(`${KAMIN} · Band 27`);
  await expect(first).toContainText("ISBN 9783499257957");
  await expect(page.locator(".cand").nth(1)).toContainText("Band 36"); // anderer Band aus lobid erst danach
  await first.click();
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  expect(await page.evaluate(() => [...document.querySelectorAll(".sheet input")].map(i => i.value))).toEqual(expect.arrayContaining([KAMIN, "27", "Barbara Mürmann"]));
});

test("Fehlt der Band in der ersten Runde, wird nach dem Reihentitel gesucht und nach Band sortiert", async ({ page, catalog }) => {
  catalog.dnb = cql => cql === `tit all "${KAMIN}"` ? [band(3, "9783499123931", "1988"), band(12, "9783499135422", "1995"), band(30, "9783499271885", "2015")] : [];
  catalog.lobid = q => q.includes("12") ? [lobidBand(36, "9783499007347")] : [];
  await openApp(page);
  await search(page, `${KAMIN} 12`);
  await expect(page.locator(".cand").first().locator("b")).toHaveText(`${KAMIN} · Band 12`);
  await expect(page.locator(".cand")).toHaveCount(4);
});

test("DNB-Bandzählung „8. / Ges. von …“: Band und Herausgeberin werden erkannt, Hörbücher und Übersetzungen nach hinten", async ({ page, catalog }) => {
  catalog.dnb = cql => cql.startsWith("tit all") ? [
    { title: KAMIN + " – Hörbuch", part: "8", publisher: "Argon", year: "2020", isbn: "9783839800001" },
    { title: KAMIN, part: "8. / Ges. von Ursula Richter", publisher: "Rowohlt", year: "1993", isbn: "9783499133572" },
  ] : [];
  await openApp(page);
  await search(page, `${KAMIN} Bd. 8`);
  const first = page.locator(".cand").first();
  await expect(first.locator("b")).toHaveText(`${KAMIN} · Band 8`);
  await expect(first).toContainText("Ursula Richter · Rowohlt 1993");
  await expect(page.locator(".cand").nth(1)).toContainText("Hörbuch");
});

test("Ohne Google und DNB reicht der Bibliotheksverbund (lobid) für Treffer", async ({ page, catalog }) => {
  catalog.lobid = q => q === "Momo AND Ende" ? [{ title: "Momo", otherTitleInformation: ["Roman"], isbn: ["3522202600"], contribution: [{ agent: { label: "Ende, Michael", type: ["Person"] }, role: { id: "http://id.loc.gov/vocabulary/relators/aut" } }], publication: [{ startDate: "2005", publishedBy: ["Thienemann"] }], extent: "304 S.", language: [{ label: "Deutsch" }] }] : [];
  await page.route("https://www.googleapis.com/**", r => r.fulfill({ status: 429, body: "{}" }));
  await openApp(page);
  await search(page, "Momo Ende");
  const first = page.locator(".cand").first();
  await expect(first.locator("b")).toHaveText("Momo – Roman");
  await expect(first).toContainText("Michael Ende · Thienemann 2005 · 304 S.");
  await expect(first).toContainText("ISBN 9783522202602");
  await expect(first).toContainText("Bibliotheksverbund (lobid)");
});

test("Suchbegriff aufbereiten", async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => ["Weihnachtsgeschichten am Kamin Band 27", "Harry Potter Bd. 3", "Fahrenheit 451", "Momo Michael Ende", "Die Chroniken von Narnia Teil 2 Lewis"].map(parseQuery));
  expect(r.map(x => [x.core, x.base, x.vol])).toEqual([
    ["Weihnachtsgeschichten am Kamin 27", "Weihnachtsgeschichten am Kamin", "27"],
    ["Harry Potter 3", "Harry Potter", "3"],
    ["Fahrenheit 451", "Fahrenheit", "451"],
    ["Momo Michael Ende", "Momo Michael Ende", ""],
    ["Die Chroniken von Narnia 2 Lewis", "Die Chroniken von Narnia Lewis", "2"],
  ]);
});

// einfarbiges PNG in beliebiger Größe (für Googles „Kein Bild verfügbar“-Platzhalter, 128×170)
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 200); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("Bester Treffer groß mit Bild oben, weitere Treffer eingeklappt; Google-Cover zur ISBN, Platzhalter übersprungen", async ({ page, catalog }) => {
  catalog.dnb = cql => cql.startsWith("tit all") ? [band(27, "9783499257957"), band(28, "9783499258282")] : [];
  catalog.lobid = () => [lobidBand(36, "9783499007347")];
  // Google-Cover zur ISBN nachbilden: Band 27 hat ein Bild, sonst kommt der Platzhalter
  await page.route("https://books.google.com/books/content**", r => new URL(r.request().url()).searchParams.get("vid") === "ISBN9783499257957"
    ? r.fulfill({ status: 200, contentType: "image/jpeg", body: fixtureBytes("cover-a.jpg") }) : r.fulfill({ status: 200, contentType: "image/png", body: png(128, 170) }));
  await openApp(page);
  await search(page, `${KAMIN} 27`);
  const best = page.locator(".cand.best");
  await expect(best).toHaveCount(1);
  await expect(best).toContainText("★ Bester Treffer");
  await expect(best.locator("b")).toHaveText(`${KAMIN} · Band 27`);
  await expect(best.locator(".cv img")).toHaveAttribute("src", "https://books.google.com/books/content?vid=ISBN9783499257957&printsec=frontcover&img=1&zoom=1");
  await expect.poll(() => best.locator(".cv img").evaluate(i => i.naturalWidth)).toBeGreaterThan(0);
  // Band 28 hat nur den Platzhalter → zählt als „kein Bild“
  expect(await page.evaluate(() => imgOk("https://books.google.com/books/content?vid=ISBN9783499258282&printsec=frontcover&img=1&zoom=1"))).toBe(false);
  // weitere Treffer erst nach Aufklappen sichtbar
  const more = page.locator("details.morecands");
  await expect(more.locator("summary")).toHaveText("Andere Ausgabe? 2 weitere Treffer anzeigen");
  await expect(more.locator(".cand").first()).toBeHidden();
  await more.locator("summary").click();
  await expect(more.locator(".cand").first()).toBeVisible();
  await expect(more.locator(".cand", { hasText: "Band 28" }).locator("img")).toHaveCount(0);
});
