// Cover-Suche: sichere Treffer automatisch, bei Unsicherheit nachfragen, Pseudo-Cover erkennen,
// Bilder aus der Google-Bildersuche per Strg+V / Ziehen / Zwischenablage-Knopf übernehmen.
import { test, expect, openApp, seedBooks, googleItem, fixtureBytes } from "./helpers.js";

const B64 = fixtureBytes("cover-a.jpg").toString("base64");
const state = (page, id) => page.evaluate(id => { const b = S.books.find(x => x.id === id); return [!!b.coverBlob, b.coverUrl || ""]; }, id);

function krabatCatalog(catalog) {
  catalog.google = q => {
    if (q === "isbn:9783423000000") return [googleItem("Momo", "Michael Ende", "9783423000000", "https://img.test/a.jpg", "dtv")];
    if (q.startsWith("isbn:")) return [];
    if (q.includes("Krabat")) return [
      googleItem("Krabat", "Otfried Preußler", "9783522000000", "https://img.test/b.jpg", "Thienemann", "1971"),
      googleItem("Krabat", "Otfried Preußler", "9783423000017", "https://img.test/c.jpg", "dtv", "1999"),
      googleItem("Krabat (English)", "Otfried Preussler", "9780000000003", "https://img.test/d.jpg", "Penguin", "2012"),
    ];
    return [];
  };
}

test("Suchlauf: per ISBN sicher → automatisch; mehrere Ausgaben → Nachfrage", async ({ page, catalog }) => {
  krabatCatalog(catalog);
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(() => patchBook("b0", { isbn: "9783423000000" }));
  expect(await page.evaluate(() => S.books.filter(needsCover).map(b => b.id))).toEqual(["b0", "b2", "b4", "b6", "b8", "b10"]);

  await page.click("text=🖼 Cover online nachtragen");
  const ask = page.locator(".sheet .actions .btn.primary");
  await expect(ask).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => state(page, "b0")).toEqual([true, expect.any(String)]);
  await ask.click();
  await expect(page.locator(".covcand")).toHaveCount(3);
  await page.locator(".covcand").nth(1).click();
  await expect.poll(async () => { const [blob, url] = await state(page, "b6"); return blob || !!url; }).toBe(true);
  expect((await state(page, "b2"))[0]).toBe(false);
});

test("Pseudo-Cover (tote Bildadresse) zählt als „kein Cover“ und wird bereinigt", async ({ page, catalog }) => {
  krabatCatalog(catalog);
  await page.context().route("https://dead.test/**", r => r.fulfill({ status: 404 }));
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    await patchBook("b0", { coverUrl: "https://dead.test/momo.jpg", isbn: "9783423000000" });
    await patchBook("b4", { coverUrl: "https://img.test/c.jpg" });
  });
  // Regalansicht lädt die Bilder → kaputte werden markiert
  await expect.poll(() => page.evaluate(() => [...S.badCover])).toContain("b0");
  expect(await page.evaluate(() => needsCover(S.books.find(b => b.id === "b0")))).toBe(true);
  // Hintergrundprüfung nach dem Start: tote Adresse weg, echte Adresse als Bild gespeichert
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  await expect.poll(() => state(page, "b0"), { timeout: 15_000 }).toEqual([false, ""]);
  await expect.poll(() => state(page, "b4")).toEqual([true, expect.any(String)]);
});

// Ereignisse wie beim echten Einfügen/Ziehen erzeugen
async function paste(page, kind, val, target) {
  await page.evaluate(([kind, val, target]) => {
    const dt = new DataTransfer();
    if (kind === "file") {
      const bin = atob(val); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      dt.items.add(new File([u], "image.jpg", { type: "image/jpeg" }));
      dt.setData("text/html", '<img src="https://encrypted-tbn0.gstatic.com/x">');
    } else if (kind === "html") dt.setData("text/html", val);
    else dt.setData("text/plain", val);
    (target ? document.querySelector(target) : document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [kind, val, target]);
}
async function openFinder(page, id) {
  await page.evaluate(id => { findCoverFor(id); }, id); // nicht abwarten: wartet auf den Dialog
  await expect(page.locator(".confirm .gsec")).toBeVisible({ timeout: 20_000 });
}
const dialogs = page => page.locator(".confirm .gsec");

test.describe("Bild aus der Google-Bildersuche übernehmen", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().route("https://nocors.test/**", r => r.fulfill({ status: 200, headers: { "content-type": "image/jpeg" }, body: fixtureBytes("cover-c.jpg") }));
    await page.context().route("https://encrypted-tbn0.gstatic.com/**", r => r.fulfill({ status: 404 }));
    await openApp(page);
    await seedBooks(page);
  });

  test("Strg+V mit kopiertem Bild", async ({ page }) => {
    await openFinder(page, "b0");
    await paste(page, "file", B64);
    await expect.poll(() => state(page, "b0")).toEqual([true, ""]);
    await expect(dialogs(page)).toHaveCount(0);
  });

  test("Strg+V mit HTML, das ein eingebettetes Bild enthält", async ({ page }) => {
    await openFinder(page, "b2");
    await paste(page, "html", `<meta charset="utf-8"><img src="data:image/jpeg;base64,${B64}">`);
    await expect.poll(() => state(page, "b2")).toEqual([true, ""]);
  });

  test("Strg+V mit Google-Link (imgres) lädt das Originalbild", async ({ page }) => {
    await openFinder(page, "b4");
    await paste(page, "text", "https://www.google.com/imgres?imgurl=https%3A%2F%2Fimg.test%2Fb.jpg&imgrefurl=https%3A%2F%2Fthalia.de&tbnid=x");
    await expect.poll(() => state(page, "b4")).toEqual([true, expect.any(String)]);
  });

  test("Bildadresse ohne CORS-Freigabe wird übernommen (gespeichert oder verlinkt)", async ({ page }) => {
    await openFinder(page, "b6");
    await paste(page, "text", "https://nocors.test/k.jpg");
    await expect.poll(async () => { const [blob, url] = await state(page, "b6"); return blob || url === "https://nocors.test/k.jpg"; }).toBe(true);
    await expect(dialogs(page)).toHaveCount(0);
  });

  test("Einfügen ins Suchfeld wird nicht abgefangen; Ziehen aus Google-Tab funktioniert", async ({ page }) => {
    await openFinder(page, "b8");
    await paste(page, "text", "https://img.test/a.jpg", ".gsec input.field");
    await page.waitForTimeout(500);
    expect(await state(page, "b8")).toEqual([false, ""]);
    await expect(dialogs(page)).toHaveCount(1);
    await page.evaluate(([html, uri]) => {
      const dt = new DataTransfer(); dt.setData("text/html", html); dt.setData("text/uri-list", uri);
      const z = document.querySelector(".gsec .pastebox");
      z.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      z.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [`<a href="/imgres?imgurl=https://img.test/c.jpg&tbnid=1"><img src="data:image/jpeg;base64,${B64}"></a>`, "https://www.google.com/imgres?imgurl=https://img.test/c.jpg"]);
    await expect.poll(() => state(page, "b8")).toEqual([true, expect.any(String)]);
    await expect(dialogs(page)).toHaveCount(0);
  });

  test("Kaputtes Bild: klare Meldung, Dialog bleibt offen", async ({ page }) => {
    await openFinder(page, "b10");
    await paste(page, "text", "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc");
    await expect(page.locator(".toast")).toBeVisible();
    expect(await state(page, "b10")).toEqual([false, ""]);
    await expect(dialogs(page)).toHaveCount(1);
  });

  test("Knopf „Aus Zwischenablage“", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8765" });
    await openFinder(page, "b10");
    await page.evaluate(async b64 => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const png = await new Promise(r => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; c.getContext("2d").drawImage(i, 0, 0); c.toBlob(r, "image/png"); }; i.src = URL.createObjectURL(new Blob([u], { type: "image/jpeg" })); });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    }, B64);
    await page.click(".gsec >> text=📋 Aus Zwischenablage");
    await expect.poll(() => state(page, "b10")).toEqual([true, ""]);
  });

  test("Einfügen im Bearbeiten-Modus macht die Änderung speicherbar", async ({ page }) => {
    await page.evaluate(() => openDetail("b1", true));
    await page.click("text=🔍 Bildersuche");
    await expect(page.locator(".gsec")).toBeVisible();
    await paste(page, "text", "https://www.google.com/imgres?imgurl=https://img.test/a.jpg");
    await expect(page.locator("text=💾 Speichern")).toBeEnabled();
  });
});
