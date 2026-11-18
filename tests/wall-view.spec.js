// Echtes Regal: Ansicht bleibt beim Einsortieren stehen, hintere Bücher antippen, Schriftgröße der Rücken, Gesamtansicht mit Zoom.
import { test, expect, openApp, seedBooks } from "./helpers.js";

async function newWall(page, preset) {
  await page.goto("/#wand");
  await page.waitForFunction(() => S.loaded);
  await page.click("text=＋ Regalwand anlegen");
  if (preset) await page.click(`text=${preset}`);
  await page.click(".confirm .btn.primary");
}

// Hohe Wand (drei 4er-Würfel übereinander) am Handy: die Wand rollt in ihrem eigenen Bereich
async function tallWall(page) {
  await page.setViewportSize({ width: 390, height: 760 });
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.evaluate(async () => {
    const c = S.shelves.walls[0].columns[0];
    c.modules.unshift(newModule("1112"), newModule("1112"));
    const bottom = c.modules[2];
    for (const id of ["b0", "b1", "b2"]) await placeBook(id, bottom, "BL");
    renderAll();
  });
  await page.waitForTimeout(200); // Farben aus den Covern sind nachgezeichnet
  const fid = await page.evaluate(() => S.shelves.walls[0].columns[0].modules[2].id + ":BL");
  await page.evaluate(() => { const sc = document.querySelector(".wallscroll"); sc.scrollTop = sc.scrollHeight; });
  return page.locator(`.wall .fach[data-fid="${fid}"]`);
}
// Lage direkt im Browser messen (das Fach wird beim Neuzeichnen ersetzt)
const topOf = loc => loc.evaluate(e => e.getBoundingClientRect().top);

test("Einsortieren, Auswählen und Lupe: das Fach bleibt auf seiner Höhe stehen", async ({ page }) => {
  const fach = await tallWall(page);
  expect(await page.evaluate(() => document.querySelector(".wallscroll").scrollTop)).toBeGreaterThan(100);
  const y0 = await topOf(fach);

  // Buch wählen (Hinweiszeile erscheint oben) und ins Fach tippen (Hinweiszeile verschwindet wieder)
  await page.evaluate(() => { S.pick = "b5"; renderWall(); });
  await expect(page.locator(".pickbar")).toHaveCount(1);
  expect(Math.abs(await topOf(fach) - y0)).toBeLessThan(3);
  await fach.click({ position: { x: 20, y: 10 } });
  await expect(page.locator(".pickbar")).toHaveCount(0);
  expect(await page.evaluate(() => locationOf("b5")?.k)).toBe("BL");
  expect(Math.abs(await topOf(fach) - y0)).toBeLessThan(3);

  // Lupe ein- und ausschalten (Knopf erst sichtbar machen – dabei rollt ggf. die Seite)
  await page.waitForTimeout(200); // Farbe aus dem Cover des neuen Buchs ist nachgezeichnet
  await page.evaluate(() => window.scrollTo(0, 0)); // wie am Handy: nach oben, damit die Knöpfe zu sehen sind
  const y1 = await topOf(fach);
  await page.click(".lensbtn");
  await expect(page.locator(".wall.lensing")).toHaveCount(1);
  expect(Math.abs(await topOf(fach) - y1)).toBeLessThan(3);
  await page.click(".lensbtn");
  expect(Math.abs(await topOf(fach) - y1)).toBeLessThan(3);

  // Auswählen: jedes Antippen zeichnet neu, die Stelle bleibt
  await page.click(".selbtn");
  await fach.locator(".spine[data-id=b1]").scrollIntoViewIfNeeded();
  const y2 = await topOf(fach);
  await fach.locator(".spine[data-id=b1]").click();
  await fach.locator(".spine[data-id=b2]").click();
  await expect(page.locator(".spine.sel")).toHaveCount(2);
  expect(Math.abs(await topOf(fach) - y2)).toBeLessThan(3);
});

test("Hintere Bücher: oben herausschauende lassen sich antippen und auswählen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.evaluate(async () => {
    await patchBook("b0", { spine: { heightCm: 14 } }); await patchBook("b1", { spine: { heightCm: 14 } }); await patchBook("b2", { spine: { heightCm: 30 } });
    const m = S.shelves.walls[0].columns[0].modules[0];
    for (const id of ["b0", "b1"]) await placeBook(id, m, "TL");
    await placeBook("b2", m, "TL", null, "back");
    renderAll();
  });
  await page.waitForTimeout(200); // Farben aus den Covern sind nachgezeichnet
  const tap = async () => { // oberer Teil des hinteren Buchs – über der vorderen Reihe
    const r = await page.evaluate(() => { const b = document.querySelector(".wall .layer.back .spine[data-id=b2]").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 6 }; });
    await page.mouse.click(r.x, r.y);
  };
  await tap();
  await expect(page.locator(".confirm")).toContainText("Der Vorleser");
  await expect(page.locator(".confirm")).toContainText("hintere Reihe");
  await page.click(".confirm >> text=Schließen");

  await page.click("text=☑ Auswählen");
  await tap();
  await expect(page.locator(".selbar")).toContainText("1 Buch ausgewählt");
  await expect(page.locator(".spine.sel[data-id=b2]")).toHaveCount(1);
  // mit „⇅ hinten“ eingeblendet: ganz normal antippen
  await page.click("text=⇅ hinten (1)");
  await page.locator(".spine[data-id=b2]").click();
  await expect(page.locator(".spine.sel")).toHaveCount(0);
});

test("Hintere Reihe: steht erhöht; eingeblendet nicht ausgegraut, vorne eingeblendet abgedunkelt", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.evaluate(async () => {
    const m = S.shelves.walls[0].columns[0].modules[0];
    await placeBook("b0", m, "TL"); await placeBook("b1", m, "TL", null, "back");
    renderAll();
  });
  const look = () => page.evaluate(() => {
    const back = document.querySelector(".wall .layer.back"), cs = getComputedStyle(back);
    const fach = back.closest(".fach").getBoundingClientRect(), r = back.getBoundingClientRect();
    return { opacity: +cs.opacity, gray: /saturate|brightness|grayscale/.test(cs.filter), lift: fach.bottom - r.bottom };
  });
  const v = await look();
  // vorne eingeblendet: hintere Reihe abgedunkelt, damit man die Reihen unterscheiden kann
  expect(v.opacity).toBeLessThan(1); expect(v.gray).toBe(true); expect(v.lift).toBeGreaterThan(2);
  await page.click("text=⇅ hinten (1)");
  const h = await look();
  expect(h.opacity).toBe(1); expect(h.gray).toBe(false); expect(Math.abs(h.lift - v.lift)).toBeLessThan(1);
  // und wieder zurück
  await page.click("text=⇅ vorne");
  const v2 = await look();
  expect(v2.opacity).toBeLessThan(1); expect(v2.gray).toBe(true);
});

test("Schriftgröße der Buchrücken: stufenlos, wirkt bei dicken und dünnen Büchern, ausgegraut ohne Text", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  // dick (Obergrenze) und dünn (Mindestgröße): der Regler verändert trotzdem jedes Mal etwas
  const sizes = await page.evaluate(() => [[60, [40, 80, 100, 120, 160, 200]], [7, [40, 70, 100, 110]]].map(([t, l]) => l.map(sc => spineFontPx(t, 0.6, 18, sc / 100))));
  for (const row of sizes) for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThan(row[i - 1]);
  expect(await page.evaluate(() => spineFontPx(7, 0.6, 18, 2))).toBeLessThanOrEqual(7); // nie breiter als der Rücken
  // bei 100 % sieht alles aus wie bisher
  expect(await page.evaluate(() => [spineFontPx(20, 0.6, 18, 1), spineFontPx(60, 0.6, 18, 1), spineFontPx(8, 0.6, 18, 1)])).toEqual([12, 18, 6]);

  await page.evaluate(() => editSpineDirect(S.books.find(b => b.id === "b4")));
  const slider = page.locator(".spedit input[type=range]");
  await expect(slider).toHaveAttribute("step", "1");
  const fs = () => page.locator(".spprev .spine:not(.lie) .vt").evaluate(e => parseFloat(e.style.fontSize));
  const before = await fs();
  await slider.fill("137");
  await expect(page.locator(".spedit")).toContainText("137 %");
  expect(await fs()).toBeGreaterThan(before);
  await page.click(".spedit .seg >> text=Kein Text");
  await expect(slider).toBeDisabled();
  await expect(page.locator(".spedit")).toContainText("keine Schrift");
  await page.click(".spedit .seg >> text=Hochkant");
  await expect(slider).toBeEnabled();
  await page.click(".spedit >> text=Übernehmen");
  await expect.poll(() => page.evaluate(() => S.books.find(b => b.id === "b4").spine?.size)).toBe(137);
});

test("Gesamtansicht: alle Wände nebeneinander, stufenlos vergrößern, Wand antippen zeigt nur diese", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.click("text=＋ Weitere Wand");
  await page.fill(".confirm input.field", "Flur");
  await page.click(".confirm >> text=Zwei 2er-Würfel nebeneinander");
  await page.click(".confirm .btn.primary");
  await page.evaluate(async () => { await placeBook("b0", S.shelves.walls[0].columns[0].modules[0], "TL"); await placeBook("b1", S.shelves.walls[1].columns[0].modules[0], "L"); renderAll(); });
  await expect(page.locator(".wall")).toHaveCount(1);

  await page.click("text=🗺 Gesamtansicht");
  await expect(page.locator(".wall")).toHaveCount(2);
  await expect(page.locator(".ovname")).toHaveText(["Wohnzimmer", "Flur"]);
  await expect(page.locator(".spine[data-id=b0]")).toBeVisible();
  await expect(page.locator(".spine[data-id=b1]")).toBeVisible();
  // alles passt ohne Rollen in die Breite
  expect(await page.evaluate(() => { const sc = document.querySelector(".wallscroll"); return sc.scrollWidth <= sc.clientWidth + 1; })).toBe(true);

  const w0 = (await page.locator(".spine[data-id=b0]").boundingBox()).width;
  await page.locator(".zoomrange").fill("250");
  await expect(page.locator(".zoomtxt")).toHaveText("250 %");
  const w1 = (await page.locator(".spine[data-id=b0]").boundingBox()).width;
  expect(w1 / w0).toBeCloseTo(2.5, 1);
  // Strg + Mausrad vergrößert ebenfalls
  const sc = await page.locator(".wallscroll").boundingBox();
  await page.mouse.move(sc.x + 50, sc.y + 50);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -200); await page.keyboard.up("Control");
  await expect.poll(() => page.evaluate(() => S.ovZoom)).toBeGreaterThan(2.6);

  // Einräumen klappt auch in der Gesamtansicht
  await page.evaluate(() => { S.pick = "b2"; renderWall(); });
  await page.locator(".spine[data-id=b1]").click();
  await expect.poll(() => page.evaluate(() => locationOf("b2")?.w.name)).toBe("Flur");

  // bleibt nach Neuladen; Wandname antippen → nur diese Wand
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await expect(page.locator(".wall")).toHaveCount(2);
  await page.click(".ovname >> text=Flur");
  await expect(page.locator(".wall")).toHaveCount(1);
  await expect(page.locator(".spine[data-id=b1]")).toBeVisible();
  await expect(page.locator(".spine[data-id=b0]")).toHaveCount(0);
});

test("Gesamtansicht am Handy: zwei Finger vergrößern, Seite bleibt schmal", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.route(url => !url.href.startsWith("http://localhost"), r => r.abort());
  const page = await ctx.newPage();
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.click("text=🗺 Gesamtansicht");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Zwei-Finger-Geste nachbilden
  await page.evaluate(() => {
    const sc = document.querySelector(".wallscroll"), r = sc.getBoundingClientRect();
    const t = (id, x) => new Touch({ identifier: id, target: sc, clientX: r.left + x, clientY: r.top + 80 });
    const fire = (type, list) => sc.dispatchEvent(new TouchEvent(type, { touches: list, targetTouches: list, changedTouches: list, bubbles: true, cancelable: true }));
    fire("touchstart", [t(1, 100), t(2, 140)]);
    fire("touchmove", [t(1, 60), t(2, 180)]);
    fire("touchend", []);
  });
  await expect.poll(() => page.evaluate(() => S.ovZoom)).toBeCloseTo(3, 1);
  await ctx.close();
});

for (const vp of [{ width: 1300, height: 950 }, { width: 390, height: 800 }]) test(`Aufbau ändern: Leisten liegen nicht auf den Fächern, keine Bücherliste (${vp.width} px)`, async ({ page }) => {
  await page.setViewportSize(vp);
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "4er-Würfel + 2er-Würfel nebeneinander");
  await page.evaluate(async () => { const w = S.shelves.walls[0]; const m = newModule("6112"); rotateModule(m); w.columns[0].modules.unshift(m); w.columns[1].modules.unshift(newModule("6112")); await saveShelves(); renderAll(); });
  await expect(page.locator(".wside")).toHaveCount(1);
  await page.click("text=🧱 Aufbau ändern");
  await expect(page.locator(".modbar")).toHaveCount(4);
  await expect(page.locator(".wside")).toHaveCount(0);
  await expect(page.locator(".selbtn, .lensbtn")).toHaveCount(0);
  const overlap = await page.evaluate(() => {
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const bars = [...document.querySelectorAll(".modbar, .colbar")].map(e => e.getBoundingClientRect());
    return [...document.querySelectorAll(".wall .fach")].map(e => e.getBoundingClientRect()).some(f => bars.some(b => hit(b, f)));
  });
  expect(overlap).toBe(false);
  // Leiste wirkt noch: Würfel nach unten schieben
  const ids = () => page.evaluate(() => S.shelves.walls[0].columns[1].modules.map(m => m.id));
  const before = await ids();
  await page.locator(".wcol").nth(1).locator(".modbar").first().locator("button[title='Nach unten']").click();
  await expect.poll(ids).toEqual([before[1], before[0]]);
  await page.click(".editinfo >> text=✓ Fertig");
  await expect(page.locator(".wside")).toHaveCount(1);
  await expect(page.locator(".modbar")).toHaveCount(0);
});

test("„Noch nicht eingeräumt“: zeigt alle Bücher (lädt beim Rollen nach) und aktualisiert sich bei neuen Büchern", async ({ page }) => {
  await openApp(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.evaluate(async () => {
    for (let i = 0; i < 320; i++) await DB.put({ id: "m" + i, title: "Band " + i, author: "Autor " + String(i).padStart(3, "0"), status: "unread", rating: 0, notes: "", addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    S.books = await DB.all(); renderAll();
  });
  const side = page.locator(".wside");
  await expect(side.locator("h3")).toHaveText("Noch nicht eingeräumt (320)");
  await expect(side.locator(".witem")).toHaveCount(150);
  // herunterrollen lädt weitere
  await side.locator(".wlist").evaluate(e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event("scroll")); });
  await expect(side.locator(".witem")).toHaveCount(300);
  await expect(side.locator(".wmore")).toHaveText("Weitere 20 von 20 anzeigen");
  await side.locator(".wmore").evaluate(b => b.click()); // Knopf (ohne Rollen) holt den Rest
  await expect(side.locator(".witem")).toHaveCount(320);
  // neues Buch ganz hinten im Alphabet erscheint ohne Neuladen; die geladene Länge bleibt erhalten
  await page.evaluate(() => putBook({ id: "neu", title: "Ganz neu", author: "Zuletzt", status: "unread", rating: 0, notes: "", addedAt: new Date().toISOString() }));
  await expect(side.locator("h3")).toHaveText("Noch nicht eingeräumt (321)");
  await expect(side.locator('.witem[data-id="neu"]')).toHaveCount(1);
  // einräumen nimmt es sofort aus der Liste
  await page.evaluate(async () => { await placeBook("neu", S.shelves.walls[0].columns[0].modules[0], "TL"); renderAll(); });
  await expect(side.locator("h3")).toHaveText("Noch nicht eingeräumt (320)");
  await expect(side.locator('.witem[data-id="neu"]')).toHaveCount(0);
});

test("Ausgewählte Bücher auf dieselbe Höhe bringen", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.evaluate(async () => {
    const m = S.shelves.walls[0].columns[0].modules[0];
    const h = { b0: 18, b1: 21.5, b2: 19 };
    for (const id of ["b0", "b1", "b2", "b3"]) { if (h[id]) await patchBook(id, { spine: { heightCm: h[id], color: "#336699" } }); await placeBook(id, m, "TL"); }
    renderAll();
  });
  await page.click("text=☑ Auswählen");
  for (const id of ["b0", "b1", "b2"]) await page.locator(`.wall .spine[data-id=${id}]`).click();
  await page.click("text=↕ Gleiche Höhe");
  await page.click(".confirm >> text=Höchstes (21,5 cm)");
  await page.click(".confirm .samehbtn");
  await expect(page.locator(".toast").last()).toContainText("3 Bücher sind jetzt 21,5 cm hoch");
  const r = await page.evaluate(() => ["b0", "b1", "b2", "b3"].map(id => { const b = S.books.find(x => x.id === id); return [b.spine?.heightCm ?? null, b.spine?.color ?? null]; }));
  expect(r).toEqual([[21.5, "#336699"], [21.5, "#336699"], [21.5, "#336699"], [null, null]]); // andere Angaben bleiben, nicht ausgewählte unverändert
  // auch die Darstellung: gleich hohe Rücken
  const hs = await page.evaluate(() => ["b0", "b1", "b2"].map(id => Math.round(document.querySelector(`.wall .spine[data-id=${id}]`).getBoundingClientRect().height)));
  expect(new Set(hs).size).toBe(1);
});

// zweite Wand „Arbeitszimmer“ neben der ersten („Wohnzimmer“)
async function twoWalls(page) {
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.evaluate(async () => {
    S.shelves.walls.push({ id: "w2", name: "Arbeitszimmer", columns: [{ id: "c2", modules: [newModule("6112")] }] });
    await saveShelves(); renderAll();
  });
}
const wallNames = page => page.evaluate(() => S.shelves.walls.map(w => w.name));

test("Ganze Wände tauschen: im Aufbau und in der Gesamtansicht", async ({ page }) => {
  await openApp(page);
  await twoWalls(page);
  expect(await wallNames(page)).toEqual(["Wohnzimmer", "Arbeitszimmer"]);
  await page.evaluate(() => { S.wallId = S.shelves.walls[0].id; renderWall(); });
  await page.click("text=🧱 Aufbau ändern");
  await expect(page.locator("text=◀ Wand nach vorne")).toBeDisabled();
  await page.click("text=Wand nach hinten ▶");
  expect(await wallNames(page)).toEqual(["Arbeitszimmer", "Wohnzimmer"]);
  await page.click("text=✓ Aufbau fertig");
  // Gesamtansicht: Pfeil neben dem Namen tauscht zurück; die Reihenfolge wird gespeichert
  await page.click("text=🗺 Gesamtansicht");
  await expect(page.locator(".ovname")).toHaveText(["Arbeitszimmer", "Wohnzimmer"]);
  await page.locator(".ovhead").nth(1).getByLabel("Wand nach links").click();
  await expect(page.locator(".ovname")).toHaveText(["Wohnzimmer", "Arbeitszimmer"]);
  await page.reload(); await page.waitForFunction(() => S.loaded);
  expect(await wallNames(page)).toEqual(["Wohnzimmer", "Arbeitszimmer"]);
});

test("Bücherliste einklappen und Großansicht: die Wand wird größer, die Einstellung bleibt", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  const wallW = () => page.evaluate(() => Math.round(document.querySelector(".wall").getBoundingClientRect().width));
  const w0 = await wallW();
  await expect(page.locator(".wside .witem").first()).toBeVisible();
  // einklappen: nur noch die Leiste, mehr Platz für das Regal
  await page.click(".wsidehead");
  await expect(page.locator(".wside.closed")).toHaveCount(1);
  await expect(page.locator(".wside .witem")).toHaveCount(0);
  const w1 = await wallW();
  expect(w1).toBeGreaterThan(w0); // ein einzelner Würfel füllt jetzt die Breite
  await page.reload(); await page.waitForFunction(() => S.loaded);
  await expect(page.locator(".wside.closed")).toHaveCount(1);
  await page.click(".wsidehead");
  await expect(page.locator(".wside .witem").first()).toBeVisible();
  // Großansicht: ganze Fensterbreite (statt höchstens 1280 px), Liste eingeklappt
  await page.click("text=⛶ Großansicht");
  await expect(page.locator("body.wandbig")).toHaveCount(1);
  await expect(page.locator(".wside.closed")).toHaveCount(1);
  const w2 = await wallW();
  expect(w2).toBeGreaterThan(w0 * 1.3);
  expect(w2).toBeLessThanOrEqual(1800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1800); // kein seitliches Rollen der Seite
  // andere Ansichten bleiben normal breit
  await page.goto("/#regal"); await expect(page.locator("body.wandbig")).toHaveCount(0);
  await page.goto("/#wand"); await expect(page.locator("body.wandbig")).toHaveCount(1);
  await page.click("text=✓ Großansicht");
  await expect(page.locator("body.wandbig")).toHaveCount(0);
});

test("Rückentitel maximieren: ausgewählte Bücher, passt in den Rücken, zurück auf normal, in der Sicherung", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await newWall(page, "Ein 4er-Würfel (1112)");
  await page.evaluate(async () => { const m = S.shelves.walls[0].columns[0].modules[0]; for (const id of ["b0", "b2", "b5"]) await placeBook(id, m, "TL"); renderAll(); });
  const font = id => page.evaluate(id => parseFloat(document.querySelector(`.wall .spine[data-id=${id}] .vt`).style.fontSize), id);
  const before = { b0: await font("b0"), b2: await font("b2"), b5: await font("b5") };
  await page.click("text=☑ Auswählen");
  await page.locator(".wall .spine[data-id=b0]").click();
  await page.locator(".wall .spine[data-id=b2]").click();
  await page.click("text=🔠 Rückentitel maximieren");
  await expect(page.locator(".toast").last()).toContainText("Rückentitel von 2 Büchern maximiert");
  expect(await font("b0")).toBeGreaterThan(before.b0);
  expect(await font("b2")).toBeGreaterThan(before.b2);
  expect(await font("b5")).toBe(before.b5); // nicht ausgewählt
  // Text passt längs und quer in den Rücken (nicht abgeschnitten)
  const fits = await page.evaluate(() => ["b0", "b2"].map(id => { const vt = document.querySelector(`.wall .spine[data-id=${id}] .vt`), f = vt.parentElement; return vt.scrollHeight <= f.clientHeight + 1 && vt.getBoundingClientRect().width <= f.clientWidth + 1; }));
  expect(fits).toEqual([true, true]);
  // gespeichert und in der Sicherung (zusätzliches, optionales Feld)
  const bk = await page.evaluate(async () => (await buildBackup()).books.filter(b => b.spine?.maxText).map(b => b.id).sort());
  expect(bk).toEqual(["b0", "b2"]);
  // die Auswahl bleibt bestehen – derselbe Knopf stellt wieder auf normal
  await expect(page.locator(".spine.sel")).toHaveCount(2);
  await page.click("text=🔡 Rückentitel normal");
  expect(await font("b0")).toBe(before.b0);
  expect(await page.evaluate(() => S.books.filter(b => b.spine && "maxText" in b.spine).length)).toBe(0);
});
