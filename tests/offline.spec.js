// Offline: Nach einem Besuch mit Internet muss die App ohne Netz starten und die Bücher zeigen.
// Über 127.0.0.1 statt localhost: Dort arbeitet der Service Worker wie in der echten App (App-Dateien sofort aus dem Zwischenspeicher).
import { test, expect, seedBooks } from "./helpers.js";

test.use({ serviceWorkers: "allow" });
const APP = "http://127.0.0.1:8765/";
const cdn = context => context.route("https://cdn.jsdelivr.net/**", r => r.fulfill({ status: 200, headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" }, body: "window.ZXing = {};" }));
async function installed(page) {
  await page.goto(APP);
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // jetzt steuert der Service Worker die Seite
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded && !!navigator.serviceWorker.controller);
}

test("App startet offline aus dem Zwischenspeicher und zeigt die Bücher", async ({ page, context }) => {
  await cdn(context);
  await installed(page);
  await seedBooks(page);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded, null, { timeout: 15_000 });
  expect(await page.evaluate(() => S.books.length)).toBe(12);
  await expect(page.getByText("Krabat").first()).toBeVisible();
  // auch mit Suchparameter (z. B. „Teilen“) und anderen Ansichten
  await page.goto(APP + "?share=1#verwaltung");
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded, null, { timeout: 15_000 });
  expect(await page.evaluate(() => S.books.length)).toBe(12);
});

test("Ohne CDN (ZXing nicht erreichbar) wird die App trotzdem offline-fähig", async ({ page, context }) => {
  await installed(page); // CDN ist in den Tests gesperrt
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded, null, { timeout: 15_000 });
});

test("Verlinkte Cover werden bei schlechtem Netz nicht als tot gelöscht", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded);
  await page.evaluate(() => Promise.all([
    putBook({ id: "a", title: "Momo", status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z", coverUrl: "https://books.google.com/books/content?id=x&img=1" }),
    putBook({ id: "b", title: "Krabat", status: "unread", rating: 0, notes: "", addedAt: "2020-01-01T00:00:00.000Z", coverUrl: "https://books.google.com/books/content?id=y&img=1" }),
  ]));
  // In den Tests ist das Internet gesperrt → nichts erreichbar, auch die Gegenprobe nicht
  const r = await page.evaluate(() => verifyCoverLinks());
  expect(r.bad).toBe(0);
  expect(await page.evaluate(() => S.books.map(b => b.coverUrl).filter(Boolean).length)).toBe(2);
});
