// Mehrere Anwendungen über Tailscale auf demselben PC: CouchDB liegt unter eigenem Pfad (oder Port),
// unter der reinen Adresse antwortet eine andere Anwendung.
import { test, expect, openApp, seedBooks } from "./helpers.js";
import { FakeCouch, COUCH_URL } from "./fake-couch.js";

async function fill(page, url) {
  await page.evaluate(() => openSyncSettings());
  await page.fill("input[aria-label='Serveradresse']", url);
  await page.fill("input[aria-label='Benutzer']", "buecher");
  await page.fill("input[aria-label='Passwort']", "geheim");
  await page.click(".sybox .btn.primary");
}

test("Andere Anwendung unter der Adresse: verständliche Meldung; mit Pfad klappt der Abgleich", async ({ page }) => {
  const couch = new FakeCouch({ prefix: "/couchdb" });
  await couch.attach(page.context());
  await openApp(page);
  await seedBooks(page);

  await fill(page, COUCH_URL);
  await expect(page.locator(".toast")).toContainText("andere Anwendung");
  expect(await page.evaluate(() => SY.conf?.on || false)).toBe(false);
  expect(couch.docCount).toBe(0);

  // aus Fauxton kopierte Adresse wird gekürzt
  await page.fill("input[aria-label='Serveradresse']", COUCH_URL + "/couchdb/_utils/#database/buecherregal/_all_docs");
  await page.click(".sybox .btn.primary");
  await expect(page.locator(".sybox .note")).toContainText("Zuletzt abgeglichen");
  await expect(page.locator(".sybox .note")).toContainText("couch.test/couchdb · Datenbank: buecherregal");
  expect(await page.evaluate(() => SY.conf.url)).toBe(COUCH_URL + "/couchdb");
  expect(couch.docCount).toBe(12);
});

test("Fehlende Datenbank wird bei Pfad-Adresse richtig erkannt (nicht als andere Anwendung)", async ({ page }) => {
  const couch = new FakeCouch({ prefix: "/couchdb", create: false });
  await couch.attach(page.context());
  await openApp(page);
  const info = await page.evaluate(c => testSyncConf(c).then(i => i.db_name), { url: COUCH_URL + "/couchdb/", db: "buecherregal", user: "buecher", pass: "geheim" });
  expect(info).toBe("buecherregal");
});

test("Bisherige Adresse ohne Pfad bleibt gleich – kein neuer Komplett-Abgleich", async ({ page }) => {
  await openApp(page);
  expect(await page.evaluate(u => [syNormUrl(u), syNormUrl(u + "/"), syNormUrl(" " + u + "/_utils/ "), syNormUrl(u + ":8443/")], COUCH_URL))
    .toEqual([COUCH_URL, COUCH_URL, COUCH_URL, COUCH_URL + ":8443"]);
  expect(await page.evaluate(u => syStateKey({ url: u, db: "buecherregal", user: "buecher" }), COUCH_URL)).toBe(COUCH_URL + "/buecherregal|buecher");
});
