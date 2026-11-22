// Gemeinsame Hilfen für die Tests. Alle Tests laufen ohne Internet: externe Anfragen werden blockiert
// oder mit festen Antworten beantwortet (Kataloge, KI, Bilder).
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
export const fixtureBytes = name => readFileSync(fixture(name));
const json = (route, body, status = 200) => route.fulfill({ status, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(body) });
const EMPTY_DNB = '<?xml version="1.0"?><searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>';

/** Gültige ISBN-13 aus 12 Ziffern bilden. */
export function isbn13(first12) {
  const s = [...first12].reduce((a, d, i) => a + (+d) * (i % 2 ? 3 : 1), 0);
  return first12 + ((10 - (s % 10)) % 10);
}
export function googleItem(title, author, isbn, img, publisher = "Verlag", year = "2001") {
  return { volumeInfo: { title, authors: [author], publisher, publishedDate: year, industryIdentifiers: [{ type: "ISBN_13", identifier: isbn }], imageLinks: img ? { thumbnail: img } : undefined } };
}

/**
 * Erweiterter Test: blockiert das Internet und stellt `catalog` bereit, um Google-Books-Antworten festzulegen:
 *   catalog.google = (q) => [items]   // q z. B. "isbn:978..." oder "Titel Autor"
 */
// catalog.dnb = (cql) => [{ title, part, author, publisher, year, isbn, series, seriesNo, extent, format }]  (wird zu MARC21-XML; extent/format = 300 $a/$c)
// catalog.lobid = (q) => [lobid-Datensätze]
// catalog.googleVolume = (id) => {volumeInfo:{dimensions:{height:"21.00 cm", thickness:"2.40 cm"}}} (Google-Books-Einzeldatensatz)
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const sf = (code, v) => v ? `<subfield code="${code}">${esc(v)}</subfield>` : "";
const df = (tag, subs) => `<datafield tag="${tag}" ind1=" " ind2=" ">${subs}</datafield>`;
export function dnbXml(recs) {
  const body = recs.map(r => `<record xmlns="http://www.loc.gov/MARC21/slim"><leader>     ${r.leader || "nam"}  22        4500</leader>${r.isbn ? df("020", sf("a", r.isbn)) : ""}${r.author ? df("100", sf("a", r.author) + sf("4", "aut")) : ""}${df("245", sf("a", r.title) + sf("n", r.part))}${df("264", sf("b", r.publisher) + sf("c", r.year))}${r.series ? df("490", sf("a", r.series) + sf("v", r.seriesNo)) : ""}${r.extent || r.format ? df("300", sf("a", r.extent) + sf("c", r.format)) : ""}</record>`).join("");
  return `<?xml version="1.0"?><searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><numberOfRecords>${recs.length}</numberOfRecords><records>${body}</records></searchRetrieveResponse>`;
}
/**
 * Nachgebildete Anthropic-API für das zweistufige Fach-Foto (spineread.js) aus einer Bücherliste im Erkennungsformat
 * ({compartment, items:[{kind, title, author, bbox, position, …}]}):
 *   - Übersicht (Schema mit „items“): Lage, Position, Rahmen – ohne Titel
 *   - Rücken lesen (Schema mit „spines“): je „Rücken Nr. n“ das n-te Buch (Felder title/author/…; books_in_image aus it.books_in_image)
 * Alle Anfragen landen in log (Anfrage-Körper). Antwort pro Anfrage über answer(body) überschreibbar (Rückgabe ≠ undefined).
 */
export function shelfAnswer(scan, body) {
  const props = body?.output_config?.format?.schema?.properties || {};
  const books = scan.items.filter(it => it.kind !== "other");
  if (props.items) return { compartment: scan.compartment || { x0: 0, y0: 0, x1: 1, y1: 1 }, items: scan.items.map((it, i) => ({
    n: i + 1, kind: it.kind === "other" ? "other" : "book", label: it.label || "", position: it.position || "standing", bbox: it.bbox, quad: it.quadFlat || null,
    text_direction: it.text_direction || "up", spine_color: it.spine_color || "", text_color: it.text_color || "", hint: "" })) };
  if (props.spines) {
    const ns = body.messages[0].content.filter(c => c.type === "text").map(c => (c.text.match(/^Rücken Nr\. (\d+):/) || [])[1]).filter(Boolean).map(Number);
    return { spines: ns.map(n => { const it = books[n - 1] || {}; return { n, books_in_image: it.books_in_image ?? 1, title: it.title || "", subtitle: it.subtitle || "", author: it.author || "",
      publisher: it.publisher || "", series: it.series || "", volume: it.volume || it.series_no || "", order_no: it.order_no || "", isbn: it.isbn || "", spine_text: it.spine_text_vertical || it.title || "", confidence: it.confidence || "high" }; }) };
  }
  return undefined;
}
export function claudeShelf(scan, { log = [], answer } = {}) {
  return async route => {
    const body = JSON.parse(route.request().postData() || "{}");
    log.push(body);
    const out = (answer && answer(body)) ?? shelfAnswer(scan, body) ?? scan;
    const text = typeof out === "string" ? out : JSON.stringify(out);
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ model: body.model, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: "text", text }] }) });
  };
}
export const test = base.extend({
  // catalog.k10 = (cql) => [Datensätze wie bei dnb] (K10plus/GBV per SRU; leader "ngm" = Film, wird von der App ausgefiltert)
  // catalog.amazon = (isbn10) => "a"|"b"|… (Testbild cover-<x>.jpg) oder null (wie Amazon: 1×1-GIF als Platzhalter)
  catalog: async ({}, use) => { await use({ google: () => [], dnb: () => [], lobid: () => [], k10: () => [], amazon: () => null }); },
  page: async ({ page, context, catalog }, use) => {
    await context.route(url => !url.href.startsWith("http://localhost") && !url.href.startsWith("http://127.0.0.1:8765/"), r => r.abort()); // 127.0.0.1: Offline-Tests mit Service Worker
    await context.route("https://www.googleapis.com/books/**", r => {
      const vol = new URL(r.request().url()).pathname.match(/\/volumes\/([^/]+)$/); // einzelner Datensatz (z. B. Maße)
      if (vol) return json(r, catalog.googleVolume ? catalog.googleVolume(decodeURIComponent(vol[1])) || {} : {});
      const q = new URL(r.request().url()).searchParams.get("q") || "";
      return json(r, { items: catalog.google(q) });
    });
    await context.route("https://services.dnb.de/**", r => {
      const recs = catalog.dnb(new URL(r.request().url()).searchParams.get("query") || "");
      return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/xml" }, body: recs.length ? dnbXml(recs) : EMPTY_DNB });
    });
    await context.route("https://sru.k10plus.de/**", r => {
      const recs = catalog.k10(new URL(r.request().url()).searchParams.get("query") || "");
      return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/xml" }, body: recs.length ? dnbXml(recs) : EMPTY_DNB });
    });
    await context.route("https://lobid.org/**", r => json(r, { totalItems: 0, member: catalog.lobid(new URL(r.request().url()).searchParams.get("q") || "") }));
    await context.route("https://openlibrary.org/**", r => json(r, { docs: [] }));
    await context.route("https://covers.openlibrary.org/**", r => r.fulfill({ status: 404 }));
    await context.route("https://images-na.ssl-images-amazon.com/**", r => {
      const n = catalog.amazon(new URL(r.request().url()).pathname.split("/").pop().split(".")[0]);
      return n ? r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "image/jpeg" }, body: fixtureBytes(`cover-${n}.jpg`) })
        : r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "image/gif" }, body: Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64") });
    });
    await context.route("https://img.test/**", r => {
      const n = new URL(r.request().url()).pathname.split("/").pop()[0];
      return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "image/jpeg" }, body: fixtureBytes(`cover-${n}.jpg`) });
    });
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await use(page);
    expect(errors, "JavaScript-Fehler auf der Seite").toEqual([]);
  },
});
export { expect };

/** App öffnen und warten, bis die Datenbank geladen ist. */
export async function openApp(page, hash = "") {
  await page.goto("/" + hash);
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded);
}

/** 12 Testbücher anlegen (b0 … b11); ungerade haben ein Cover-Bild, jedes vierte ist Lieblingsbuch. */
export async function seedBooks(page) {
  await page.evaluate(async () => {
    const titles = [["Momo", "Michael Ende", 304], ["Die unendliche Geschichte", "Michael Ende", 476], ["Der Vorleser", "Bernhard Schlink", 207], ["Die letzte Fahrt des Admirals", "The Detection Club", 384], ["Der Name der Rose", "Umberto Eco", 656], ["Tschick", "Wolfgang Herrndorf", 256], ["Krabat", "Otfried Preußler", 320], ["Der Steppenwolf", "Hermann Hesse", 280], ["Siddhartha", "Hermann Hesse", 128], ["Die Verwandlung", "Franz Kafka", 96], ["Buddenbrooks", "Thomas Mann", 760], ["Faust", "Johann Wolfgang von Goethe", 210]];
    let i = 0;
    for (const [t, a, p] of titles) {
      const c = document.createElement("canvas"); c.width = 60; c.height = 90;
      const x = c.getContext("2d"); x.fillStyle = `hsl(${(i * 37) % 360} 55% ${i % 3 ? 40 : 75}%)`; x.fillRect(0, 0, 60, 90);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg"));
      await putBook({ id: "b" + i, title: t, author: a, pages: String(p), year: "2000", summary: "x", status: i % 3 ? "unread" : "read", rating: 0, notes: "", favorite: i % 4 === 0, addedAt: new Date(Date.now() - i * 1000).toISOString(), coverBlob: i % 2 ? blob : undefined });
      i++;
    }
  });
}
