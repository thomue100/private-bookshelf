// Ein Foto für Cover und Rücken: Perspektive entzerren (perspective.js), Ecken von der KI oder von Hand.
import { test, expect, openApp, googleItem, isbn13 } from "./helpers.js";

const COVER_Q = [[0.3, 0.12], [0.85, 0.2], [0.82, 0.9], [0.32, 0.84]];
const SPINE_Q = [[0.1, 0.16], [0.3, 0.12], [0.32, 0.84], [0.12, 0.8]];

/** Erzeugt im Browser ein „schräg fotografiertes“ Buch (800 × 600): Cover mit vier farbigen Vierteln, grüner Rücken, weißer Hintergrund.
 *  Gezeichnet wird pixelgenau über die App-eigene Homographie (umgekehrt), damit der Test weiß, was herauskommen muss. */
async function slantedBookPng(page) {
  const b64 = await page.evaluate(([cq, sq]) => {
    const W = 800, H = 600, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), id = g.createImageData(W, H), d = id.data;
    const px = q => q.map(([x, y]) => [x * W, y * H]);
    const hc = homography(px(cq), [[0, 0], [1, 0], [1, 1], [0, 1]]), hs = homography(px(sq), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let col = [255, 255, 255];
      const [u, v] = applyH(hc, x + .5, y + .5), [s, t] = applyH(hs, x + .5, y + .5);
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) col = u < .5 ? (v < .5 ? [220, 30, 30] : [230, 200, 20]) : (v < .5 ? [30, 170, 40] : [30, 60, 220]);
      else if (s >= 0 && s <= 1 && t >= 0 && t <= 1) col = [20, 140, 90];
      const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  }, [COVER_Q, SPINE_Q]);
  return { name: "buch.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") };
}
/** Größe und Farben an relativen Stellen eines Bilds (Blob) */
const probe = (page, expr, pts) => page.evaluate(async ([expr, pts]) => {
  const blob = await eval(expr); const img = await loadImage(blob);
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, px: pts.map(([x, y]) => [...g.getImageData(Math.floor(x * c.width), Math.floor(y * c.height), 1, 1).data.slice(0, 3)]) };
}, [expr, pts]);
const near = (a, b, tol = 45) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const QUARTERS = [[.25, .25], [.75, .25], [.75, .75], [.25, .75]];
const COLORS = [[220, 30, 30], [30, 170, 40], [30, 60, 220], [230, 200, 20]];

test("Homographie und Viereck-Prüfung", async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const src = [[0, 0], [100, 0], [100, 50], [0, 50]], dst = [[10, 20], [90, 5], [120, 70], [3, 60]];
    const h = homography(src, dst);
    return {
      exact: src.map(([x, y], i) => { const [u, v] = applyH(h, x, y); return Math.hypot(u - dst[i][0], v - dst[i][1]) < 1e-6; }),
      ok: !!validQuad([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]),
      ccw: validQuad([[0.1, 0.1], [0.1, 0.9], [0.9, 0.9], [0.9, 0.1]]),           // gegen den Uhrzeigersinn
      twisted: validQuad([[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]]),       // verdreht
      tiny: validQuad([[0.5, 0.5], [0.51, 0.5], [0.51, 0.51], [0.5, 0.51]]),
      outside: validQuad([[0.1, 0.1], [1.5, 0.1], [0.9, 0.9], [0.1, 0.9]]),
      short: validQuad([[0, 0], [1, 0], [1, 1]]),
      none: quadsFromAnswer({ title: "Alt" }),                                      // alte Antwort ohne Ecken
      prompt: COVER_PROMPT.includes("cover_quad") && COVER_PROMPT.includes("spine_quad"),
    };
  });
  expect(r).toEqual({ exact: [true, true, true, true], ok: true, ccw: null, twisted: null, tiny: null, outside: null, short: null, none: null, prompt: true });
});

test("Entzerren: das schräge Cover wird wieder gerade, die Farbviertel liegen richtig", async ({ page }) => {
  await openApp(page);
  const file = await slantedBookPng(page);
  await page.evaluate(b64 => { window._src = fetch("data:image/png;base64," + b64).then(r => r.blob()); }, file.buffer.toString("base64"));
  const r = await probe(page, `(async () => warpQuad(await window._src, ${JSON.stringify(COVER_Q)}, 1600))()`, QUARTERS);
  QUARTERS.forEach((_, i) => expect(near(r.px[i], COLORS[i]), `Viertel ${i}: ${r.px[i]}`).toBe(true));
  // Größe aus den Kantenlängen im 800×600-Foto: oben 443 px, links 432 px (jeweils die längere Kante)
  expect(Math.abs(r.w - 443)).toBeLessThanOrEqual(2);
  expect(Math.abs(r.h - 432)).toBeLessThanOrEqual(2);
  const s = await probe(page, `(async () => warpQuad(await window._src, ${JSON.stringify(SPINE_Q)}, 1600))()`, [[.5, .5]]);
  expect(s.h).toBeGreaterThan(s.w * 2.5);
  expect(near(s.px[0], [20, 140, 90])).toBe(true);
});

test("KI liefert Ecken: Cover und Rücken werden aus einem Foto zugeschnitten und gespeichert", async ({ page, catalog }) => {
  const I = isbn13("978352220210");
  catalog.google = q => q.includes(I) ? [googleItem("Momo", "Michael Ende", I)] : [];
  await page.context().route("https://api.anthropic.com/**", r => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
    body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ title: "Momo", author: "Michael Ende", isbn: I, confidence: "high", cover_quad: COVER_Q, spine_quad: SPINE_Q }) }] }) }));
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("aiKey", "sk-ant-test"));
  const file = await slantedBookPng(page);
  await page.evaluate(() => openAdd());
  const chooser = page.waitForEvent("filechooser");
  await page.click("#addCover");
  await (await chooser).setFiles(file);
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  await expect(page.locator(".spphoto .spmini .face.img")).toHaveCount(1);
  await expect(page.locator(".dtop button:text-is('✂ Zuschneiden')")).toBeVisible();
  await page.click(".actions .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(1);
  const cov = await probe(page, "S.books[0].coverBlob", QUARTERS);
  QUARTERS.forEach((_, i) => expect(near(cov.px[i], COLORS[i]), `Viertel ${i}: ${cov.px[i]}`).toBe(true));
  const sp = await probe(page, "S.books[0].spine.imageBlob", [[.5, .5]]);
  expect(near(sp.px[0], [20, 140, 90])).toBe(true);
  expect(await page.evaluate(() => S.books[0].spine.thickCm)).toBeGreaterThan(0);
});

test("Alte KI-Antwort ohne Ecken: das ganze Foto bleibt Cover, kein Rücken", async ({ page, catalog }) => {
  await page.context().route("https://api.anthropic.com/**", r => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
    body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ title: "Momo", author: "Michael Ende", isbn: "", confidence: "high" }) }] }) }));
  catalog.google = q => q.toLowerCase().includes("momo") ? [googleItem("Momo", "Michael Ende", isbn13("978352220210"))] : [];
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("aiKey", "sk-ant-test"));
  const file = await slantedBookPng(page);
  await page.evaluate(() => openAdd());
  const chooser = page.waitForEvent("filechooser");
  await page.click("#addCover");
  await (await chooser).setFiles(file);
  await page.locator(".cand").first().click();
  await expect(page.locator(".sheet h2")).toHaveText("Prüfen & speichern");
  await expect(page.locator(".spphoto .spmini")).toHaveCount(0);
  await page.click(".actions .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(1);
  const cov = await probe(page, "S.books[0].coverBlob", []);
  expect([cov.w, cov.h]).toEqual([800, 600]);
});

test("Ohne KI: Ecken von Hand ziehen (Lupe), Cover und Rücken zuschneiden – auch beim Bearbeiten", async ({ page }) => {
  await openApp(page);
  const file = await slantedBookPng(page);
  await page.evaluate(b64 => fetch("data:image/png;base64," + b64).then(r => r.blob()).then(b => openReview({ title: "Momo" }, new File([b], "buch.png", { type: "image/png" }))), file.buffer.toString("base64"));
  await page.click(".dtop button:text-is('✂ Zuschneiden')");
  await expect(page.locator(".qedit .qh")).toHaveCount(4);
  // Ecken auf das Cover ziehen
  const stage = await page.locator(".qstage").boundingBox();
  const drag = async (i, [x, y]) => {
    const h = await page.locator(".qedit .qh").nth(i).boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
    await page.mouse.move(stage.x + x * stage.width, stage.y + y * stage.height, { steps: 4 });
    if (i === 0) await expect(page.locator(".qlens")).toBeVisible();
    await page.mouse.up();
  };
  for (let i = 0; i < 4; i++) await drag(i, COVER_Q[i]);
  await page.click(".qedit button:text-is('📗 Rücken')");
  for (let i = 0; i < 4; i++) await drag(i, SPINE_Q[i]);
  await page.click(".qedit .btn.primary");
  await expect(page.locator(".qedit")).toHaveCount(0);
  await expect(page.locator(".spphoto .spmini .face.img")).toHaveCount(1);
  await page.click(".actions .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(1);
  const cov = await probe(page, "S.books[0].coverBlob", QUARTERS);
  QUARTERS.forEach((_, i) => expect(near(cov.px[i], COLORS[i], 60), `Viertel ${i}: ${cov.px[i]}`).toBe(true));
  expect(await page.evaluate(() => !!S.books[0].spine?.imageBlob)).toBe(true);

  // Beim Bearbeiten: vorhandenes Cover zuschneiden (Standard-Ecken übernehmen) verkleinert das Bild
  const id = await page.evaluate(() => S.books[0].id);
  await page.evaluate(id => openDetail(id, true), id);
  await page.click(".dtop button:text-is('✂ Zuschneiden')");
  await page.click(".qedit .btn.primary");
  await expect(page.locator("text=💾 Speichern")).toBeEnabled();
  await page.click("text=💾 Speichern");
  await expect.poll(async () => (await probe(page, "S.books[0].coverBlob", [])).w).toBeLessThan(cov.w);
});
