// Titelsuche beim Hinzufügen: „Band 27“ wird verstanden, der richtige Band steht oben, ein Katalog allein reicht für Treffer.
import { test, expect, openApp } from "./helpers.js";

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
