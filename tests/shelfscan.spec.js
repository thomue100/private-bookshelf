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

// Reihe mit Bänden: der Katalog kennt nur Band 8 und einen Eintrag ohne Band – früher landeten alle Bände auf demselben Treffer
const ISBN8 = isbn13("978349913427"), ISBN_ALL = isbn13("978349901560");
const vol = (v, no, x0, x1) => ({ ...item("Weihnachtsgeschichten am Kamin", "Ursula Richter (Hg.)", x0, x1, 250, 780), series: "Weihnachtsgeschichten am Kamin", volume: v, order_no: no, series_no: v,
  spine_text_vertical: `URSULA RICHTER (HG.). Weihnachtsgeschichten am Kamin ${v} ${no}` });
const SERIES_SCAN = { compartment: SCAN.compartment, items: [
  vol("8", "13427", 40, 100), vol("9", "13541", 104, 194), vol("10", "13697", 198, 248),
  item("Momo", "Michael Ende", 252, 362, 250, 780), item("Momo", "Michael Ende", 366, 436, 250, 780),
  { ...item("Krabat", "Otfried Preußler", 440, 520, 250, 780), confidence: "low" }] };

test("Reihen-Bände, zweites Exemplar, schlecht lesbarer Rücken: Nachfrage statt falscher Treffer", async ({ page, catalog }) => {
  catalog.google = q => {
    q = q.toLowerCase();
    if (q.includes("weihnachtsgeschichten")) return [googleItem("Weihnachtsgeschichten am Kamin 8", "Ursula Richter", ISBN8, null, "Rowohlt"), googleItem("Weihnachtsgeschichten am Kamin", "Ursula Richter", ISBN_ALL, null, "Rowohlt")];
    if (q.includes("momo")) return [googleItem("Momo", "Michael Ende", isbn13("978352220210"))];
    if (q.includes("krabat")) return [googleItem("Krabat", "Otfried Preußler", isbn13("978352217520"))];
    return [];
  };
  let prompt = "";
  await page.context().route("https://api.anthropic.com/**", async r => {
    prompt = JSON.parse(r.request().postData()).messages[0].content.find(c => c.type === "text").text;
    await r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(SERIES_SCAN) }] }) });
  });
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("aiKey", "sk-ant-test"));
  await wallWith4er(page);
  await page.click("text=📷 Fach-Foto einlesen");
  await page.selectOption(".sheet select", { index: 1 });
  const chooser = page.waitForEvent("filechooser");
  await page.click(".sheet >> text=🖼 Foto wählen");
  await (await chooser).setFiles(fixture("shelf.jpg"));
  await expect(page.locator(".scanlist")).toBeVisible({ timeout: 30_000 });
  expect(prompt).toContain('"volume"'); // die KI wird nach der Band-Nummer gefragt

  const rows = page.locator(".scanrow");
  await expect(rows).toHaveCount(6);
  // Band 8 passt sicher zum Katalogeintrag „… 8“; Bände 9 und 10 bekommen NICHT denselben Treffer
  await expect(rows.nth(0)).not.toHaveClass(/unsure/);
  await expect(rows.nth(0).locator(".scanpick select")).toHaveValue("0");
  for (const [i, band] of [[1, 9], [2, 10]]) {
    await expect(rows.nth(i)).toHaveClass(/unsure/);
    await expect(rows.nth(i).locator(".scanpick select")).toHaveValue("-1");
    await expect(rows.nth(i).locator(".scanwhy")).toContainText(`Band ${band} nicht im Katalog gefunden`);
  }
  await expect(rows.nth(3).locator(".scanwhy")).toContainText("Gleiches Buch wie Nr. 5");
  await expect(rows.nth(5).locator(".scanwhy")).toContainText("schlecht lesbar");
  await expect(page.locator(".warnnote")).toContainText("5 Bücher sind unsicher erkannt");
  await expect(page.locator(".scanbox.unsure")).toHaveCount(5);

  // Band von Hand korrigieren und neu suchen (der Katalog kennt Band 11 nicht → bleibt unsicher)
  await expect(rows.nth(2).getByLabel("Band")).toHaveValue("10");
  await rows.nth(2).getByLabel("Band").fill("11");
  await rows.nth(2).getByRole("button", { name: "🔎 Neu suchen" }).click();
  await expect(rows.nth(2).getByRole("button", { name: "🔎 Neu suchen" })).toBeEnabled();
  await expect(rows.nth(2)).toHaveClass(/unsure/);

  // Momo ist wirklich zweimal da; Krabat stimmt
  for (const i of [3, 4, 5]) await rows.nth(i).getByRole("button", { name: "✓ Passt so" }).click();
  await expect(page.locator(".warnnote")).toContainText("2 Bücher sind unsicher erkannt");
  await page.locator(".warnnote").getByText("Nur unsichere zeigen").click();
  await expect(page.locator(".scanrow:visible")).toHaveCount(2);

  // Übernehmen fragt nach, solange noch etwas ungeprüft ist
  await page.click(".actions.sticky .btn.primary");
  await expect(page.locator(".overlay.confirm")).toContainText("2 Bücher sind noch nicht geprüft");
  await page.locator(".overlay.confirm").getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.locator(".scanlist")).toBeVisible();
  await page.click(".actions.sticky .btn.primary");
  await page.locator(".overlay.confirm").getByRole("button", { name: "Trotzdem übernehmen" }).click();
  await page.locator(".confirm >> text=Abbrechen").click({ timeout: 5000 }).catch(() => {}); // „Cover suchen?“ überspringen
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(6);

  const r = await page.evaluate(() => ({
    bands: S.books.filter(b => /Weihnachts/.test(b.title)).map(b => [b.seriesNo, b.series, b.isbn]).sort((a, b) => +a[0] - +b[0]),
    copies: S.books.filter(b => b.notes === "Weiteres Exemplar").map(b => b.title),
    dups: dupGroups().length,
  }));
  expect(r.bands).toEqual([["8", "Weihnachtsgeschichten am Kamin", ISBN8], ["9", "Weihnachtsgeschichten am Kamin", ""], ["11", "Weihnachtsgeschichten am Kamin", ""]]);
  expect(r.copies).toEqual(["Momo"]);
  expect(r.dups).toBe(0); // bestätigtes zweites Exemplar gilt nicht als Dublette
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
