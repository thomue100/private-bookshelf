// Stufe 3 – Katalogsuche, die findet: gezielt nach Titel- und Personen-Index, schrittweise lockern, Verlagsnummer, K10plus,
// Zwischenspeicher, DNB nacheinander und Pause nach „zu viele Anfragen“, Hinweis auf eigenen Google-Schlüssel.
import { test, expect, openApp, googleItem, isbn13 } from "./helpers.js";

const I = isbn13("978352220210");
function record(catalog) {
  const q = { dnb: [], k10: [], lobid: [], google: [] };
  const wrap = (k, fn) => x => { q[k].push(x); return fn(x); };
  catalog.dnb = wrap("dnb", catalog.dnb); catalog.k10 = wrap("k10", catalog.k10); catalog.lobid = wrap("lobid", catalog.lobid); catalog.google = wrap("google", catalog.google);
  return q;
}
const match = (page, it) => page.evaluate(async it => { const log = []; const c = await matchItem({ kind: "book", cands: [], choice: -1, ...it }, log); return { titles: c.map(x => x.title), log }; }, it);

test("Gezielt nach Titel und Autor – ohne Artikel, Untertitel nicht erzwungen; alle fünf Kataloge", async ({ page, catalog }) => {
  catalog.k10 = cql => /unendliche Geschichte/.test(cql) ? [{ title: "Die unendliche Geschichte", author: "Ende, Michael", publisher: "Thienemann", year: "1979", isbn: I }] : [];
  const q = record(catalog);
  await openApp(page);
  const r = await match(page, { title: "Die unendliche Geschichte: Von A bis Z", author: "Michael Ende" });
  expect(r.titles).toContain("Die unendliche Geschichte");
  expect(q.dnb[0]).toBe('tit all "unendliche Geschichte" and per all "Ende"');
  expect(q.k10[0]).toBe('pica.tit="unendliche Geschichte" and pica.per="Ende"');
  expect(q.lobid[0]).toBe("title:(unendliche AND Geschichte) AND contribution.agent.label:(Ende)");
  expect(q.google[0]).toBe("intitle:unendliche Geschichte inauthor:Ende");
  expect(r.log.map(x => x.src).sort()).toEqual(["DNB", "Google Books", "K10plus", "Open Library", "lobid"]);
  expect(r.log.find(x => x.src === "K10plus").n).toBe(1);
});

test("Null Treffer → schrittweise lockern: Kernwörter + Nachname, dann nur Titel; Verlagsnummer; Filme aus K10plus fallen weg", async ({ page, catalog }) => {
  catalog.dnb = cql => cql === 'woe all "rororo 13427"' ? [{ title: "Weihnachtsgeschichten am Kamin", part: "8", author: "Richter, Ursula", isbn: isbn13("978349913427") }] : [];
  catalog.k10 = cql => /Gespenst/.test(cql) && !/pica\.per/.test(cql) ? [{ title: "Das kleine Gespenst", author: "Preußler, Otfried", isbn: I }, { title: "Das kleine Gespenst (Film)", leader: "ngm" }] : [];
  const q = record(catalog);
  await openApp(page);
  const r = await match(page, { title: "Das kleine Gespenst – Ein Kinderbuch-Klassiker", author: "O. Preussler" });
  expect(r.titles).toEqual(["Das kleine Gespenst"]);                                       // Film ausgefiltert
  expect(q.dnb).toEqual(['tit all "kleine Gespenst" and per all "Preussler"', 'tit all "kleine Gespenst"']); // Kernwörter = Haupttitel → kein doppelter Schritt
  // langer Titel: die längsten Wörter (in Reihenfolge) als eigener, lockerer Schritt
  await match(page, { title: "Die Geschichte vom kleinen Muck und seinem Zauberstab", author: "Wilhelm Hauff" });
  expect(q.dnb).toContain('tit all "Geschichte kleinen Zauberstab" and per all "Hauff"');
  const v = await match(page, { title: "Weihnachtsgeschichten", author: "", publisher: "rororo", order_no: "13427" });
  expect(v.titles[0]).toBe("Weihnachtsgeschichten am Kamin");
  expect(q.dnb).toContain('woe all "rororo 13427"');
});

test("Zwischenspeicher: dieselbe Suche fragt nicht doppelt; DNB-Sperre → Pause; Google-Kontingent → Hinweis auf eigenen Schlüssel", async ({ page, catalog }) => {
  catalog.google = () => [googleItem("Momo", "Michael Ende", I)];
  const q = record(catalog);
  let dnbCalls = 0;
  await page.route("https://services.dnb.de/**", r => { dnbCalls++; return r.fulfill({ status: 429, body: "zu viele" }); });
  await openApp(page);
  await match(page, { title: "Momo", author: "Michael Ende" });
  const google1 = q.google.length;
  const again = await match(page, { title: "Momo", author: "Michael Ende" });               // „Neu suchen“ mit gleichen Angaben
  expect(q.google.length).toBe(google1);
  expect(again.titles).toContain("Momo");
  expect(dnbCalls).toBe(1);                                                                  // nach der Sperre nicht mehr gefragt
  await match(page, { title: "Krabat", author: "Otfried Preußler" });
  expect(dnbCalls).toBe(1);
  const log = (await match(page, { title: "Tschick", author: "Herrndorf" })).log;
  expect(log.find(x => x.src === "DNB").err).toBe("pausiert");
  // Google: Kontingent erschöpft → Hinweis mit Weg zum eigenen Schlüssel
  await page.route("https://www.googleapis.com/books/**", r => r.fulfill({ status: 429, headers: { "access-control-allow-origin": "*" }, body: "{}" }));
  await match(page, { title: "Der Vorleser", author: "Schlink" });
  await expect(page.locator("#banner")).toContainText("Google Books antwortet gerade nicht");
  await expect(page.locator("#banner button")).toHaveText("Schlüssel eintragen");
});

test("ISBN: K10plus springt ein, wenn DNB und Google nichts liefern", async ({ page, catalog }) => {
  catalog.k10 = cql => cql === `pica.isb=${I}` ? [{ title: "Momo", author: "Ende, Michael", publisher: "Thienemann", year: "1973", isbn: I }] : [];
  await openApp(page);
  const r = await page.evaluate(i => lookupIsbn(i), I);
  expect(r).toMatchObject({ title: "Momo", author: "Michael Ende", publisher: "Thienemann" });
  expect(r.src).toContain("K10plus");
});
