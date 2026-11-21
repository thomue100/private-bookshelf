// Bibliothek: kompakte Werkzeugleiste (Handy: Filter-Knopf), „Gerade dabei“, Cover/Liste, Hinweis „ohne Cover“.
import { test, expect, openApp, seedBooks } from "./helpers.js";

test("Handy: Suche und Filter in einer Zeile; Schlagwort, Reihe und Sortierung im Filter-Bereich, aktive Filter gezählt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => { await patchBook("b1", { tags: ["Fantasy"] }); renderAll(); });
  await expect(page.locator("#fpanel")).toBeHidden();
  // Das erste Buch beginnt im oberen Drittel (früher erst in der Bildschirmmitte)
  const top = await page.locator("#shelf .card").first().evaluate(e => e.getBoundingClientRect().top);
  expect(top).toBeLessThan(300);
  await page.click("#filterBtn");
  await expect(page.locator("#fpanel")).toBeVisible();
  await expect(page.locator("#sort")).toBeVisible();
  await page.selectOption("#tagSlot select", "Fantasy");
  await expect(page.locator("#fcount")).toHaveText("1");
  await expect(page.locator("#shelf .card")).toHaveCount(1);
});

test("„Gerade dabei“ steht oben; „Ausgelesen“ markiert als gelesen und lässt sich rückgängig machen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => { await patchBook("b2", statusPatch(S.books.find(b => b.id === "b2"), "reading")); });
  const sec = page.locator(".nowreading");
  await expect(sec.locator(".nrcard")).toHaveCount(1);
  await expect(sec).toContainText("Der Vorleser");
  await expect(sec).toContainText("seit ");
  await sec.getByRole("button", { name: "✓ Ausgelesen" }).click();
  await expect.poll(() => page.evaluate(() => S.books.find(b => b.id === "b2").status)).toBe("read");
  await expect(page.locator(".nowreading")).toHaveCount(0);
  expect(await page.evaluate(() => readsOf(S.books.find(b => b.id === "b2")).filter(r => r.end).length)).toBe(1);
  await page.click(".toast .tact");
  await expect.poll(() => page.evaluate(() => S.books.find(b => b.id === "b2").status)).toBe("reading");
  await expect(page.locator(".nowreading .nrcard")).toHaveCount(1);
  // nur ohne Filter/Suche
  await page.fill("#q", "Momo");
  await expect(page.locator(".nowreading")).toHaveCount(0);
});

test("Listenansicht zeigt Status und Standort und bleibt nach Neuladen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    S.shelves.walls.push({ id: "w1", name: "Flur", columns: [{ id: "c1", modules: [newModule("1112")] }] });
    await placeBook("b0", S.shelves.walls[0].columns[0].modules[0], "TL", 0); renderAll();
  });
  await page.click(".layoutsw [data-layout=list]");
  await expect(page.locator("#shelf")).toHaveClass(/list/);
  const momo = page.locator("#shelf .card", { hasText: "Momo" });
  await expect(momo.locator(".lo")).toContainText("Gelesen · Flur");
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await expect(page.locator("#shelf")).toHaveClass(/list/);
  await expect(page.locator(".layoutsw [data-layout=list]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#shelf .card")).toHaveCount(12);
});

test("Hinweis „ohne Cover“: „Später“ gilt dauerhaft, bis weitere Bücher ohne Cover dazukommen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await expect(page.locator(".hint")).toContainText("6 Bücher ohne Cover");
  await page.click(".hint >> text=Später");
  await expect(page.locator(".hint")).toHaveCount(0);
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await expect(page.locator("#shelf .card")).toHaveCount(12);
  await expect(page.locator(".hint")).toHaveCount(0);
  await page.evaluate(() => putBook({ id: "nx", title: "Neu", author: "A", status: "unread", rating: 0, addedAt: new Date().toISOString() }));
  await expect(page.locator(".hint")).toContainText("7 Bücher ohne Cover");
});

test("Plaketten auf dem Cover liegen unten und verdecken den Titel nicht", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  const card = page.locator("#shelf .card", { hasText: "Momo" }); // gelesen, Lieblingsbuch, Platzhalter-Cover
  const t = await card.locator(".ph .t").boundingBox(), bar = await card.locator(".cbar").boundingBox();
  expect(bar.y).toBeGreaterThan(t.y + t.height);
  await expect(card.locator(".badge")).toHaveText("✓ Gelesen");
  await expect(card.locator(".favbadge")).toBeVisible();
});
