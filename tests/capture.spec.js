// Weniger Arbeit beim Erfassen: Rückenfoto gleich in „Prüfen & speichern“ und beim Bearbeiten.
import { test, expect, openApp, seedBooks, fixture } from "./helpers.js";

/** PNG im Querformat (wie ein liegend fotografierter Buchrücken) als Datei für den Dateiauswahl-Dialog. */
async function landscapePng(page, w = 300, h = 40) {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.fillStyle = "#5a2"; x.fillRect(0, 0, w, h); x.fillStyle = "#fff"; x.fillRect(0, 0, 20, h);
    return c.toDataURL("image/png").split(",")[1];
  }, [w, h]);
  return { name: "ruecken.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
}
async function choose(page, click, files) {
  const chooser = page.waitForEvent("filechooser");
  await click();
  await (await chooser).setFiles(files);
}
const imgSize = (page, id) => page.evaluate(async id => {
  const sp = S.books.find(b => b.id === id).spine; const i = await loadImage(sp.imageBlob); return { w: i.naturalWidth, h: i.naturalHeight, thick: sp.thickCm };
}, id);

test("Neues Buch mit Cover- und Rückenfoto: Rücken steht im echten Regal und bleibt in der Sicherung", async ({ page, browser }) => {
  await openApp(page);
  await page.click(".addtop");
  await page.click("text=Ganz von Hand eintragen");
  const f = page.locator(".sec:has(h3:text-is('Buchdaten')) .fgrid input.field");
  await f.nth(0).fill("Der Seewolf");
  await f.nth(1).fill("Jack London");
  await choose(page, () => page.locator(".dtop > div > .covertools button:text-is('🖼 Bild wählen')").click(), fixture("cover-a.jpg"));
  await choose(page, () => page.click(".spphoto button:text-is('🖼 Bild wählen')"), await landscapePng(page));
  await expect(page.locator(".spphoto .spmini .face.img")).toHaveCount(1);
  await page.click(".actions .btn.primary");
  await expect(page.locator("#shelf .card .ti")).toHaveText(["Der Seewolf"]);
  const id = await page.evaluate(() => S.books[0].id);
  expect(await page.evaluate(() => !!S.books[0].coverBlob)).toBe(true);
  // Querformat wird aufgerichtet, Dicke aus dem Seitenverhältnis berechnet
  const sz = await imgSize(page, id);
  expect(sz.h).toBeGreaterThan(sz.w);
  expect(sz.thick).toBeGreaterThan(1.5);
  expect(sz.thick).toBeLessThan(4);

  // Im echten Regal einräumen: Rücken zeigt das Foto
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  await page.click(".confirm .btn.primary");
  await page.locator(".witem").first().click();
  await page.locator(".fach").first().click({ position: { x: 200, y: 20 } });
  await expect(page.locator(".fach .spine .face.img")).toHaveCount(1);

  // Sicherung auf ein zweites „Gerät“
  const data = await page.evaluate(() => buildBackup());
  const ctx2 = await browser.newContext();
  await ctx2.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  const p2 = await ctx2.newPage();
  await openApp(p2);
  await p2.evaluate(d => importData(d), data);
  const sz2 = await imgSize(p2, id);
  expect(sz2).toEqual(sz);
  await ctx2.close();
});

test("Strg+V in „Prüfen & speichern“: Bild geht ans Cover, in der Rücken-Fläche an den Rücken", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => openReview({ title: "Momo" }, null));
  const paste = (sel) => page.evaluate(sel => new Promise(async res => {
    const c = document.createElement("canvas"); c.width = 200; c.height = 30;
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "x.png", { type: "image/png" }));
    const t = sel ? document.querySelector(sel) : document.body;
    if (sel) t.focus();
    t.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    res();
  }), sel);
  await paste(null);
  await expect(page.locator(".dtop .cover img")).toHaveCount(1);
  await expect(page.locator(".spphoto .spmini")).toHaveCount(0);
  await paste(".spphoto .pastebox");
  await expect(page.locator(".spphoto .spmini .face.img")).toHaveCount(1);
  // „entfernen“ nimmt das Rückenfoto wieder weg
  await page.click(".spphoto button:text-is('entfernen')");
  await expect(page.locator(".spphoto .spmini")).toHaveCount(0);
});

test("Bearbeiten: „📷 Rückenfoto“ direkt, ohne Editor – vorhandene Dicke bleibt", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(() => patchBook("b2", { spine: { thickCm: 1.2, color: "#123456" } }));
  await page.evaluate(() => openDetail("b2", true));
  await choose(page, () => page.click(".sec:has(h3:text-is('Buchrücken (echtes Regal)')) button:text-is('📷 Rückenfoto')"), await landscapePng(page));
  await expect(page.locator(".spmini .face.img")).toHaveCount(1);
  await page.click("text=💾 Speichern");
  await expect.poll(() => page.evaluate(() => !!S.books.find(b => b.id === "b2").spine?.imageBlob)).toBe(true);
  expect(await page.evaluate(() => { const sp = S.books.find(b => b.id === "b2").spine; return [sp.thickCm, sp.color]; })).toEqual([1.2, "#123456"]);
});
