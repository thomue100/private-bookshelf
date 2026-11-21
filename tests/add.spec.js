// Hinzufügen-Blatt: zwei Schnellwege, ein Feld für Titel/Autor/ISBN/Link, „Viele Bücher auf einmal“ kompakt.
import { test, expect, openApp, googleItem, isbn13 } from "./helpers.js";

const ISBN = isbn13("978352220210");

test("Ein Feld für alles: Titel sucht im Katalog, ISBN lädt das Buch direkt", async ({ page, catalog }) => {
  catalog.google = q => q.includes(ISBN) || /momo/i.test(q) ? [googleItem("Momo", "Michael Ende", ISBN)] : [];
  await openApp(page);
  await page.click(".addtop");
  await expect(page.locator("#addScan")).toContainText("Barcode scannen");
  await expect(page.locator("#addCover")).toContainText("Cover-Bild wählen");
  for (const id of ["addStack", "addShelfScan", "addTitleList"]) await expect(page.locator("#" + id)).toBeVisible();
  const inp = page.getByPlaceholder("Titel, Autor, ISBN oder Link");
  await expect(inp).toBeFocused(); // am PC gleich lostippen
  await inp.fill("Momo Ende");
  await inp.press("Enter");
  await expect(page.locator(".sheet h2")).toHaveText("Suchergebnisse");
  await expect(page.locator(".cand").first()).toContainText("Momo");

  await page.click(".sheet .x");
  await page.click(".addtop");
  await page.getByPlaceholder("Titel, Autor, ISBN oder Link").fill(ISBN.replace(/^(\d{3})(\d)/, "$1-$2"));
  await page.locator(".qsearch").getByRole("button", { name: "Suchen" }).click();
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
});

test("Handy: Hinzufügen passt ohne langes Rollen – Schnellwege und Suchfeld im ersten Bildschirm", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  const page = await ctx.newPage();
  await openApp(page);
  await page.click(".bottomnav .bn-add");
  await expect(page.locator("#addCover")).toContainText("Cover fotografieren");
  for (const sel of ["#addScan", "#addCover", ".qsearch input"]) {
    const b = await page.locator(sel).boundingBox();
    expect(b.y + b.height, sel).toBeLessThan(844);
  }
  expect(await page.evaluate(() => document.querySelector(".sheet").scrollWidth <= document.querySelector(".sheet").clientWidth)).toBe(true);
  await ctx.close();
});
