// Bücher erfassen, bearbeiten, Lesezeiträume, „Hatte ich mal“, Wunschliste, Reihe und Schlagworte.
import { test, expect, openApp, seedBooks } from "./helpers.js";

const book = (page, id) => page.evaluate(id => S.books.find(b => b.id === id), id);

test("Buch von Hand erfassen erscheint im Regal", async ({ page }) => {
  await openApp(page);
  await page.click(".addtop");
  await page.click("text=Ganz von Hand eintragen");
  const f = page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field");
  await f.nth(0).fill("Der Seewolf");
  await f.nth(1).fill("Jack London");
  await page.click(".actions .btn.primary");
  await expect(page.locator("#shelf .card .ti")).toHaveText(["Der Seewolf"]);
  expect(await page.evaluate(() => S.books[0].author)).toBe("Jack London");
});

test("Bearbeiten: Speichern erst nach Änderung aktiv, Schlagworte und Wert werden gespeichert", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(() => openDetail("b0", true));
  const save = page.locator("text=💾 Speichern");
  await expect(save).toBeDisabled();
  const ti = page.locator(".taginput");
  await ti.fill("Kinderbuch"); await ti.press("Enter");
  await ti.fill("fantasy, Lieblingsautor"); await ti.press("Enter");
  await page.fill("input[placeholder='z. B. 25']", "40");
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(async () => (await book(page, "b0")).value).toBe("40");
  expect((await book(page, "b0")).tags).toEqual(["Kinderbuch", "fantasy", "Lieblingsautor"]);
});

test("Mehrere Lesezeiträume; alte Start/Ende-Felder werden übernommen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(() => patchBook("b3", { startedAt: "2019-03-01", finishedAt: "2019-03-20", status: "read" }));
  await page.evaluate(() => openDetail("b3"));
  await page.click(".actions >> text=Bearbeiten");
  await page.click("text=＋ Noch einmal gelesen");
  await page.locator(".readnote input").last().fill("Hörbuch");
  await page.locator(".readnote input").last().dispatchEvent("change");
  await page.click("text=💾 Speichern");
  await expect.poll(() => page.evaluate(() => readsOf(S.books.find(x => x.id === "b3")).map(r => r.note || ""))).toEqual(["", "Hörbuch"]);
  expect(await page.evaluate(() => readsOf(S.books.find(x => x.id === "b3"))[0].start)).toBe("2019-03-01");
});

test("„Hatte ich mal“ nimmt das Buch aus dem Bestand und zeigt es ausgegraut gesondert", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(() => openDetail("b3"));
  await page.click("text=📦 Hatte ich mal …");
  await page.fill(".confirm input[placeholder^='z. B. Anna']", "Anna");
  await page.fill(".confirm textarea", "zum Geburtstag");
  await page.click(".confirm .btn.primary");
  await expect.poll(async () => (await book(page, "b3")).gone?.to).toBe("Anna");
  expect(await page.evaluate(() => inStock(S.books.find(b => b.id === "b3")))).toBe(false);
});

test("Wunschliste ist vom Bestand getrennt; doppelt Erfassen übernimmt den Wunsch als gekauft", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.goto("/#wunsch");
  await page.click("#v-wunsch >> text=＋ Wunsch hinzufügen");
  await page.click("text=Ganz von Hand eintragen");
  let f = page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field");
  await f.nth(0).fill("Der Seewolf"); await f.nth(1).fill("Jack London");
  await page.fill("input[placeholder='z. B. 12,90']", "14,00");
  await page.click(".actions .btn.primary");
  await expect(page.locator("#v-wunsch .card .ti")).toHaveText(["Der Seewolf"]);

  await page.goto("/#regal");
  await page.fill("#q", "Seewolf");
  await expect(page.locator("#shelf .card")).toHaveCount(0);
  await page.fill("#q", "");

  await page.click(".addtop");
  await page.click("text=Ganz von Hand eintragen");
  f = page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field");
  await f.nth(0).fill("Der Seewolf"); await f.nth(1).fill("Jack London");
  await page.click(".actions .btn.primary");
  await expect(page.locator(".confirm p")).toContainText("Wunschliste");
  await page.click(".confirm .btn.primary");
  await expect.poll(() => page.evaluate(() => [S.books.filter(isWish).length, S.books.filter(b => b.title === "Der Seewolf").length])).toEqual([0, 1]);
});

test("Reihe und Schlagworte filtern das Regal", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    await patchBook("b7", { series: "Hesse-Werkausgabe", seriesNo: "2" });
    await patchBook("b8", { series: "hesse-werkausgabe", seriesNo: "1" });
    await patchBook("b0", { tags: ["Fantasy"] }); await patchBook("b1", { tags: ["fantasy", "Kinderbuch"] });
  });
  await page.selectOption("#seriesSlot select", { index: 1 });
  await expect(page.locator("#shelf .card .ti")).toHaveText(["Siddhartha", "Der Steppenwolf"]);
  await page.selectOption("#seriesSlot select", "");
  await page.selectOption("#tagSlot select", "Fantasy");
  await expect(page.locator("#shelf .card")).toHaveCount(2);
  await page.selectOption("#tagSlot select", "");
  await page.fill("#q", "kinderbuch");
  await expect(page.locator("#shelf .card")).toHaveCount(1);
});
