// Automatische Sicherung in einen lokalen Ordner. Statt eines echten Ordners nutzt der Test das private
// Browser-Dateisystem (OPFS); der Ordner-Zugriff wird nur im Speicher gehalten (headless Chrome kann ihn nicht in IndexedDB ablegen).
import { test, expect, openApp, seedBooks } from "./helpers.js";

test("Sicherung schreibt Tagesdatei + Dateien-Ordner und stellt nach Datenverlust alles wieder her", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  await page.evaluate(async () => {
    AB.handle = await navigator.storage.getDirectory();
    const id = uid();
    await DB.putBlob({ id, bookId: "b2", blob: new Blob(["%PDF-1.4 test"], { type: "application/pdf" }) });
    await patchBook("b2", { files: [{ id, name: "Vorleser.pdf", type: "application/pdf", size: 13 }], tags: ["Klassiker"] });
  });
  await page.evaluate(() => openAutoBackup());
  await expect(page.locator(".abbox")).toContainText("Noch keine Sicherung geschrieben");
  await page.click(".abbox >> text=Jetzt sichern");
  await expect(page.locator(".abbox")).toContainText("Letzte Sicherung:"); // Anzeige aktualisiert sich
  await page.click(".sheet-h .x");
  const files = await page.evaluate(async () => {
    const out = []; for await (const [n, h] of AB.handle.entries()) out.push(n + (h.kind === "directory" ? "/" : ""));
    const f = await AB.handle.getDirectoryHandle("Dateien"); for await (const [n] of f.entries()) out.push("Dateien/" + n);
    return out.sort();
  });
  expect(files).toContain("Dateien/");
  expect(files.some(n => /^buecherregal-auto-\d{4}-\d{2}-\d{2}\.json$/.test(n))).toBe(true);
  expect(files.some(n => n.startsWith("Dateien/") && n.endsWith("Vorleser.pdf"))).toBe(true);

  // Jede Änderung plant eine Sicherung ein
  expect(await page.evaluate(async () => { clearTimeout(AB.timer); AB.timer = null; await patchBook("b3", { value: "5" }); return !!AB.timer; })).toBe(true);

  // Datenverlust simulieren: alle Bücher und die PDF-Datei weg
  await page.evaluate(async () => {
    clearTimeout(AB.timer);
    await DB.delBlob(S.books.find(b => b.id === "b2").files[0].id);
    for (const b of [...S.books]) await DB.del(b.id);
    await DB.setMeta("deleted", {});
  });
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  expect(await page.evaluate(() => S.books.length)).toBe(0);

  await page.evaluate(async () => { AB.handle = await navigator.storage.getDirectory(); openAutoBackup(); });
  await page.click("text=Aus Sicherungsordner wiederherstellen");
  await page.click(".confirm .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(12);
  expect(await page.evaluate(async () => { const b = S.books.find(x => x.id === "b2"); return [b.tags, !!(await DB.getBlob(b.files[0].id))]; })).toEqual([["Klassiker"], true]);
  await expect(page.locator(".toast")).toContainText("1 Dateien wiederhergestellt");
});

test("Bilder liegen einzeln im Ordner „Bilder“: nur einmal geschrieben, Tagesdatei klein, Wiederherstellen holt sie zurück", async ({ page }) => {
  await openApp(page);
  await seedBooks(page); // b1, b3, … haben ein Cover
  const before = await page.evaluate(async () => {
    AB.handle = await navigator.storage.getDirectory();
    const png = t => new Blob([t], { type: "image/png" });
    await patchBook("b3", { coverBlob: S.books.find(b => b.id === "b1").coverBlob }); // gleiches Bild zweimal → eine Datei
    await patchBook("b2", { spine: { heightCm: 20, imageBlob: png("ruecken") } });
    const imgId = uid(); await DB.putBlob({ id: imgId, bookId: "b4", blob: png("widmung") });
    await patchBook("b4", { images: [{ id: imgId, caption: "Widmung", size: 7 }] });
    await storePhotoLocal({ id: "ph1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", fachKey: "", blob: png("fachfoto"), w: 1, h: 1 });
    clearTimeout(AB.timer);
    return { covers: S.books.filter(b => b.coverBlob).map(b => [b.id, b.coverBlob.size]).sort() };
  });
  // Ein Bild der App, auf das niemand verweist, wird aufgeräumt – eine eigene Datei im Ordner bleibt
  await page.evaluate(async () => { const d = await AB.handle.getDirectoryHandle("Bilder", { create: true }); await abWrite(d, "0123456789abcdef0123456789abcdef.jpg", new Blob(["alt"])); await abWrite(d, "Urlaub.jpg", new Blob(["meins"])); });
  expect(await page.evaluate(() => runAutoBackup(true))).toBe(true);
  const r = await page.evaluate(async () => {
    const names = []; for await (const [n, h] of AB.handle.entries()) if (h.kind === "file") names.push(n);
    const json = await (await (await AB.handle.getFileHandle(names.find(n => AUTO_RE.test(n)))).getFile()).text();
    const imgs = []; for await (const [n] of (await AB.handle.getDirectoryHandle("Bilder")).entries()) imgs.push(n);
    const d = JSON.parse(json);
    return { json, imgs, d, b1: d.books.find(b => b.id === "b1").coverFile, b3: d.books.find(b => b.id === "b3").coverFile };
  });
  expect(r.json).not.toContain("data:");
  expect(r.d.imagesInFolder).toBe("Bilder");
  expect(r.b1).toMatch(/^Bilder\/[0-9a-f]{32}\.jpg$/);
  expect(r.b3).toBe(r.b1);
  expect(r.d.books.find(b => b.id === "b2").spine).toMatchObject({ heightCm: 20, imageFile: expect.stringMatching(/\.png$/) });
  expect(r.d.books.find(b => b.id === "b4").images[0].file).toMatch(/^Bilder\//);
  expect(r.d.photos[0].imageFile).toMatch(/^Bilder\//);
  // 5 verschiedene Cover (b1 = b3) + Rücken + Widmung + Fach-Foto + eigene Datei; das verwaiste Bild ist weg
  expect(r.imgs).toHaveLength(9);
  expect(r.imgs).toContain("Urlaub.jpg");
  expect(r.imgs).not.toContain("0123456789abcdef0123456789abcdef.jpg");

  // Zweiter Lauf schreibt keine Bilder neu
  const written = await page.evaluate(async () => {
    let n = 0; const orig = abWrite; abWrite = async (d, name, blob) => { if (!AUTO_RE.test(name)) n++; return orig(d, name, blob); };
    await runAutoBackup(true); abWrite = orig; return n;
  });
  expect(written).toBe(0);

  // Datenverlust → Wiederherstellen aus dem Ordner bringt alle Bilder zurück
  await page.evaluate(async () => {
    clearTimeout(AB.timer);
    for (const b of [...S.books]) { for (const x of b.images || []) await DB.delBlob(x.id); await DB.del(b.id); }
    await DB.putPhoto({ id: "ph1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2000-01-01T00:00:00Z", fachKey: "" }); await DB.setMeta("deleted", {}); // Foto ohne Bild, älter
  });
  await page.reload();
  await page.waitForFunction(() => S.loaded);
  await page.evaluate(async () => { AB.handle = await navigator.storage.getDirectory(); openAutoBackup(); });
  await page.click("text=Aus Sicherungsordner wiederherstellen");
  await page.click(".confirm .btn.primary");
  await expect.poll(() => page.evaluate(() => S.books.length)).toBe(12);
  const after = await page.evaluate(async () => {
    const b2 = S.books.find(b => b.id === "b2"), b4 = S.books.find(b => b.id === "b4");
    const w = (await DB.getBlob(b4.images[0].id))?.blob;
    return {
      covers: S.books.filter(b => b.coverBlob).map(b => [b.id, b.coverBlob.size]).sort(),
      coverType: S.books.find(b => b.id === "b1").coverBlob.type,
      spine: [b2.spine.heightCm, await b2.spine.imageBlob?.text(), b2.spine.imageBlob?.type, "imageFile" in b2.spine],
      widmung: w && await w.text(), photo: await S.photos.find(p => p.id === "ph1")?.blob?.text(),
      leftover: S.books.some(b => "coverFile" in b),
    };
  });
  expect(after).toEqual({ covers: before.covers, coverType: "image/jpeg", spine: [20, "ruecken", "image/png", false], widmung: "widmung", photo: "fachfoto", leftover: false });
});

test("Tagesdatei mit Bild-Verweisen ohne Ordner eingelesen: vorhandene Bilder auf dem Gerät bleiben erhalten", async ({ page }) => {
  await openApp(page);
  await seedBooks(page);
  const r = await page.evaluate(async () => {
    const b1 = S.books.find(b => b.id === "b1"), size = b1.coverBlob.size;
    const data = { app: "buecherregal", version: 2, imagesInFolder: "Bilder", books: [{ ...b1, coverBlob: undefined, coverFile: "Bilder/ffffffffffffffffffffffffffffffff.jpg", notes: "neu", updatedAt: "2099-01-01T00:00:00Z" }], deleted: {}, shelves: S.shelves };
    await importData(data);
    const b = S.books.find(x => x.id === "b1");
    return [b.notes, b.coverBlob?.size === size, "coverFile" in b];
  });
  expect(r).toEqual(["neu", true, false]);
});
