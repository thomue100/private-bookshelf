// Gemeinsame Hilfen für die Tests. Alle Tests laufen ohne Internet: externe Anfragen werden blockiert
// oder mit festen Antworten beantwortet (Kataloge, KI, Bilder).
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

export const fixture = name => new URL(`./fixtures/${name}`, import.meta.url).pathname;
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
export const test = base.extend({
  catalog: async ({}, use) => { await use({ google: () => [] }); },
  page: async ({ page, context, catalog }, use) => {
    await context.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
    await context.route("https://www.googleapis.com/books/**", r => {
      const q = new URL(r.request().url()).searchParams.get("q") || "";
      return json(r, { items: catalog.google(q) });
    });
    await context.route("https://services.dnb.de/**", r => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/xml" }, body: EMPTY_DNB }));
    await context.route("https://openlibrary.org/**", r => json(r, { docs: [] }));
    await context.route("https://covers.openlibrary.org/**", r => r.fulfill({ status: 404 }));
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
