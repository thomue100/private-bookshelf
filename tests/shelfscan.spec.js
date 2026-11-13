// Fach-Foto einlesen: Erkennung über die Anthropic-API (nachgebildet) und über die Claude-Chat-Brücke.
// Das Testbild fixtures/shelf.jpg (1000×800) zeigt 6 stehende Buchrücken und ein liegendes Buch.
import { test, expect, openApp, fixture, googleItem, isbn13 } from "./helpers.js";

const BOOKS = [
  ["Momo", "Michael Ende", 40, 100], ["Krabat", "Otfried Preußler", 104, 194], ["Siddhartha", "Hermann Hesse", 198, 248],
  ["Buddenbrooks", "Thomas Mann", 252, 362], ["Tschick", "Wolfgang Herrndorf", 366, 436], ["Faust", "Johann Wolfgang von Goethe", 440, 520],
];
const item = (title, author, x0, x1, y0, y1, position = "standing") => ({
  kind: "book", label: "", position, title, subtitle: "", author, publisher: "", series_no: "", isbn: "",
  spine_text_vertical: `${author.split(" ").pop()}  ${title}`, spine_text_horizontal: "", text_direction: "up",
  spine_color: "#8b1e2d", text_color: "#f3e9dc", bbox: { x0: x0 / 1000, x1: x1 / 1000, y0: y0 / 800, y1: y1 / 800 }, confidence: "high",
});
const SCAN = {
  compartment: { x0: 0.02, y0: 0.0, x1: 0.99, y1: 0.99 },
  items: [...BOOKS.map(([t, a, x0, x1]) => item(t, a, x0, x1, 250, 780)), item("Der Steppenwolf", "Hermann Hesse", 60, 560, 180, 240, "lying_on_top")],
};
const ALL = [...BOOKS.map(([t, a]) => [t, a]), ["Der Steppenwolf", "Hermann Hesse"]];

function catalogFor(catalog) {
  catalog.google = q => {
    const hit = ALL.find(([t]) => q.toLowerCase().includes(t.toLowerCase()));
    return hit ? [googleItem(hit[0], hit[1], isbn13("978342" + String(ALL.indexOf(hit)).padStart(6, "0")))] : [];
  };
}
async function wallWith4er(page) {
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  await page.click("text=Ein 4er-Würfel (1112)");
  await page.click(".confirm .btn.primary");
}
async function importReview(page) {
  await expect(page.locator(".scanlist")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".scanrow")).toHaveCount(7);
  await page.click(".actions.sticky .btn.primary");
  const cancel = page.locator(".confirm >> text=Abbrechen"); // Nachfrage „Cover suchen?“ überspringen
  await cancel.click({ timeout: 5000 }).catch(() => {});
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(7);
}

test("Fach-Foto über die Anthropic-API: 7 Bücher erkannt, angelegt und ins Fach gestellt", async ({ page, catalog }) => {
  catalogFor(catalog);
  let sentImage = false;
  await page.context().route("https://api.anthropic.com/**", async r => {
    const body = JSON.parse(r.request().postData());
    sentImage = body.messages[0].content.some(c => c.type === "image");
    await r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(SCAN) }] }) });
  });
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("aiKey", "sk-ant-test"));
  await wallWith4er(page);
  await page.click("text=📷 Fach-Foto einlesen");
  await page.selectOption(".sheet select", { index: 1 });
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  await importReview(page);
  expect(sentImage).toBe(true);
  const r = await page.evaluate(() => ({
    placed: S.books.filter(b => locationOf(b.id)).length,
    top: S.books.filter(b => locationOf(b.id)?.layer === "top").map(b => b.title),
    order: (() => { const l = locationOf(S.books.find(b => b.title === "Momo").id); return l.list.map(id => S.books.find(b => b.id === id).title); })(),
  }));
  expect(r.placed).toBe(7);
  expect(r.top).toEqual(["Der Steppenwolf"]);
  expect(r.order).toEqual(["Momo", "Krabat", "Siddhartha", "Buddenbrooks", "Tschick", "Faust"]);
});

test("Fach-Foto über die Claude-Chat-Brücke (Antwort einfügen)", async ({ page, catalog }) => {
  catalogFor(catalog);
  await openApp(page);
  await wallWith4er(page);
  await page.click("text=📷 Fach-Foto einlesen");
  await page.click("text=💬 Über deinen Claude-Chat");
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  const answer = page.locator(".bridge textarea:not([readonly])");
  await expect(answer).toBeVisible();
  await expect(page.locator(".bridge textarea[readonly]")).toHaveValue(/JSON/); // der Auftrag für Claude
  await answer.fill("Hier ist das Ergebnis:\n```json\n" + JSON.stringify(SCAN) + "\n```");
  await page.click(".actions >> text=Weiter");
  await importReview(page);
});
