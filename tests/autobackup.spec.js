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
  expect(await page.evaluate(() => runAutoBackup(true))).toBe(true);
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
