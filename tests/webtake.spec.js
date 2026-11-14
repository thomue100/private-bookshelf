// Bücher aus dem Web übernehmen: Link, kopierter Text oder ISBN – im Feld, aus der Zwischenablage und über „Teilen“.
import { test, expect, openApp } from "./helpers.js";

const B27 = { title: "Weihnachtsgeschichten am Kamin", part: "27. / Ges. von Barbara Mürmann", publisher: "Rowohlt Taschenbuch Verlag", year: "2012", isbn: "9783499257957" };
const ZVAB = "https://www.zvab.com/9783499257957/Weihnachtsgeschichten-Kamin-27-M%C3%BCrmann-Barbara-3499257955/plp";
const dnbByIsbn = cql => cql === "num=9783499257957" ? [B27] : [];
const reviewTitle = page => page.locator(".sheet input").first();

test("ISBN, Links und kopierter Text werden erkannt", async ({ page, catalog }) => {
  catalog.dnb = cql => cql === "idn=1021984779" ? [B27] : [];
  await openApp(page);
  const r = await page.evaluate(async zvab => {
    const t = [
      zvab,
      "https://www.booklooker.de/B%C3%BCcher/Barbara-M%C3%BCrmann+Weihnachtsgeschichten-am-Kamin-27/isbn/9783499257957/id/A02xyz",
      "https://www.amazon.de/Weihnachtsgeschichten-Kamin-27-Barbara-M%C3%BCrmann/dp/3499257955/ref=sr_1_1",
      "Taschenbuch, 212 Seiten\nISBN-10: 3-499-25795-5\nVerlag: Rowohlt",
      "Bestellnummer 1234567890, Tel. 0301234567", // keine gültige ISBN
      "https://d-nb.info/1021984779",
      "https://www.thalia.de/shop/home/artikeldetails/A1012345678/weihnachtsgeschichten-am-kamin-27",
      "Weihnachtsgeschichten am Kamin 27\nGesammelt von Barbara Mürmann",
    ];
    const out = [];
    for (const x of t) out.push(await bookFromWeb(x));
    return out.map(o => o && (o.isbn || (o.rec && "rec:" + o.rec.title) || "query:" + o.query));
  }, ZVAB);
  expect(r).toEqual([
    "9783499257957", "9783499257957", "9783499257957", "9783499257957",
    "query:Bestellnummer 1234567890, Tel. 0301234567",
    "9783499257957",
    "query:weihnachtsgeschichten am kamin 27",
    "query:Weihnachtsgeschichten am Kamin 27",
  ]);
});

test("Buch hinzufügen: Link einfügen genügt", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await openApp(page);
  await page.evaluate(() => openAdd());
  const inp = page.getByPlaceholder("ISBN eintippen oder Link einfügen");
  await inp.fill(ZVAB);
  await inp.press("Enter");
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  await expect(reviewTitle(page)).toHaveValue("Weihnachtsgeschichten am Kamin");
  expect(await page.evaluate(() => [...document.querySelectorAll(".sheet input")].map(i => i.value))).toEqual(expect.arrayContaining(["9783499257957", "27", "Barbara Mürmann"]));
});

test("Zurück aus dem Web: Link aus der Zwischenablage wird angeboten und übernommen", async ({ page, context, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8765" });
  await openApp(page);
  await page.evaluate(() => navigator.clipboard.writeText("vorher kopiert"));
  await page.evaluate(() => showSearch("Kamin Weihnachten"));
  await expect(page.locator(".webtake")).toBeVisible();
  // Klick auf einen Such-Link (öffnet ein neues Fenster)
  const popup = page.waitForEvent("popup");
  await page.locator(".weblinks a[target=_blank]").first().click();
  await (await popup).close();
  // im Shop die Adresse kopiert, zurück in die App
  await page.evaluate(z => navigator.clipboard.writeText(z), ZVAB);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".clipoffer")).toContainText("ISBN 9783499257957");
  await page.locator(".clipoffer >> text=Übernehmen").click();
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  await expect(reviewTitle(page)).toHaveValue("Weihnachtsgeschichten am Kamin");
  // dasselbe wird nicht noch einmal angeboten
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(600);
  await expect(page.locator(".clipoffer")).toHaveCount(0);
});

test("Ohne Klick auf einen Such-Link wird die Zwischenablage nicht angeboten", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8765" });
  await openApp(page);
  await page.evaluate(z => navigator.clipboard.writeText(z), ZVAB);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(600);
  await expect(page.locator(".clipoffer")).toHaveCount(0);
});

test("„Teilen → Bücherregal“ mit einer Shop-Seite übernimmt das Buch", async ({ page, catalog }) => {
  catalog.dnb = dnbByIsbn;
  await openApp(page);
  await page.evaluate(async z => (await caches.open("share-inbox")).put("share/7/text", new Response("Weihnachtsgeschichten am Kamin 27 | ZVAB\n" + z)), ZVAB);
  await page.goto("/?share=7");
  await page.waitForFunction(() => S.loaded);
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  await expect(reviewTitle(page)).toHaveValue("Weihnachtsgeschichten am Kamin");
});
