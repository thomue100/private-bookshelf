/* Mein Bücherregal – automatische Sicherung in einen Ordner auf diesem Computer (Chrome/Edge).
   Es wird nichts ins Internet übertragen: Chrome schreibt die Dateien direkt in den gewählten Ordner. */
"use strict";

const AB = { handle: null, timer: null, running: false, lastError: "" };
const abSupported = () => typeof window.showDirectoryPicker === "function";
const AUTO_RE = /^buecherregal-auto-\d{4}-\d{2}-\d{2}\.json$/;
const KEEP_AUTO = 14; // so viele Tagesstände bleiben im Ordner
const fileKey = f => `${String(f.id).slice(0, 8)}__${String(f.name || "datei").replace(/[\\/:*?"<>|]/g, "_")}`;

/* Bilder (Cover, Buchrücken, weitere Bilder, offene Fach-Fotos) liegen einzeln im Unterordner „Bilder“, benannt nach ihrem Inhalt:
   Jedes Bild wird nur einmal geschrieben, die Tagesdateien verweisen nur darauf und bleiben klein. */
const IMG_DIR = "Bilder";
const IMG_REF_RE = /"Bilder\/([0-9a-f]{32}\.[a-z0-9]{2,5})"/g;
const IMG_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg" };
const IMG_TYPE = Object.fromEntries(Object.entries(IMG_EXT).map(([t, e]) => [e, t]));
const abNames = new WeakMap(); // Blob → Dateiname (Prüfsumme nur einmal je Sitzung)
async function abImageName(blob) {
  let n = abNames.get(blob); if (n) return n;
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  n = [...h.slice(0, 16)].map(x => x.toString(16).padStart(2, "0")).join("") + "." + (IMG_EXT[blob.type] || "bin");
  abNames.set(blob, n); return n;
}
async function abReadImage(dir, path) {
  const [sub, name] = String(path).split("/");
  if (sub !== IMG_DIR || !name) return null;
  const file = await (await (await dir.getDirectoryHandle(IMG_DIR)).getFileHandle(name)).getFile();
  const type = IMG_TYPE[name.split(".").pop()] || file.type;
  return file.type === type ? file : new Blob([file], { type });
}
async function abWrite(dir, name, blob) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
async function abPerm(ask) {
  if (!AB.handle) return false;
  try {
    let p = AB.handle.queryPermission ? await AB.handle.queryPermission({ mode: "readwrite" }) : "granted";
    if (p === "granted") return true;
    if (!ask || !AB.handle.requestPermission) return false;
    p = await AB.handle.requestPermission({ mode: "readwrite" });
    return p === "granted";
  } catch { return false; }
}
async function autoBackupActive() { return !!AB.handle && await abPerm(false); }
function scheduleAutoBackup(ms = 60000) { if (!AB.handle) return; clearTimeout(AB.timer); AB.timer = setTimeout(() => runAutoBackup(false), ms); }

async function runAutoBackup(manual) {
  if (!AB.handle) return false;
  if (AB.running) { scheduleAutoBackup(15000); return false; }
  if (!(await abPerm(manual))) { if (manual) toast("Kein Zugriff auf den Sicherungsordner – bitte erlauben."); else abAskBanner(); return false; }
  AB.running = true;
  try {
    // 1) Bücher und Regal-Aufstellung → eine JSON-Datei pro Tag; Bilder einzeln in „Bilder“ (nur neue werden geschrieben)
    const opt = { images: true, files: false };
    let idir = null; const haveImg = new Set();
    if (globalThis.crypto?.subtle) {
      idir = await AB.handle.getDirectoryHandle(IMG_DIR, { create: true });
      for await (const [n] of idir.entries()) haveImg.add(n);
      opt.imageOut = async blob => { const n = await abImageName(blob); if (!haveImg.has(n)) { await abWrite(idir, n, blob); haveImg.add(n); } return IMG_DIR + "/" + n; };
    }
    const data = await buildBackup(opt);
    data.filesInFolder = "Dateien";
    if (idir) data.imagesInFolder = IMG_DIR;
    const name = `buecherregal-auto-${today()}.json`;
    await abWrite(AB.handle, name, new Blob([JSON.stringify(data)], { type: "application/json" }));
    // 2) E-Books/PDFs einzeln in den Unterordner „Dateien“ (nur neue werden geschrieben)
    const all = S.books.flatMap(b => (b.files || []).map(f => ({ b, f })));
    if (all.length) {
      const fdir = await AB.handle.getDirectoryHandle("Dateien", { create: true });
      const have = new Set(); for await (const [n] of fdir.entries()) have.add(n);
      for (const { f } of all) { const k = fileKey(f); if (have.has(k)) continue; const r = await DB.getBlob(f.id).catch(() => null); if (r) await abWrite(fdir, k, r.blob); }
    }
    // 3) ältere Tagesstände aufräumen
    const autos = []; for await (const [n, h] of AB.handle.entries()) if (h.kind === "file" && AUTO_RE.test(n)) autos.push(n);
    autos.sort(); for (const n of autos.slice(0, Math.max(0, autos.length - KEEP_AUTO))) await AB.handle.removeEntry(n).catch(() => {});
    // 4) Bilder, auf die kein aufgehobener Tagesstand mehr verweist, löschen (nur wenn alle Stände lesbar waren)
    if (idir) await abPruneImages(idir, haveImg, autos.slice(-KEEP_AUTO)).catch(e => console.warn(e));
    const now = new Date().toISOString();
    await DB.setMeta("autoBackupAt", now); await DB.setMeta("lastBackup", now);
    AB.lastError = "";
    if (manual) toast("✓ Gesichert: " + name);
    abRefresh();
    return true;
  } catch (e) {
    console.warn(e); AB.lastError = e.message || String(e);
    if (manual) toast("Sicherung fehlgeschlagen: " + AB.lastError, 5000);
    abRefresh();
    return false;
  } finally { AB.running = false; }
}
async function abPruneImages(idir, have, autoNames) {
  const used = new Set();
  for (const n of autoNames) {
    const text = await (await (await AB.handle.getFileHandle(n)).getFile()).text(); // Fehler → abbrechen, nichts löschen
    for (const m of text.matchAll(IMG_REF_RE)) used.add(m[1]);
  }
  for (const n of have) if (!used.has(n)) { await idir.removeEntry(n).catch(() => {}); have.delete(n); }
}
function abAskBanner() {
  setBanner("Automatische Sicherung: Chrome möchte einmal bestätigt haben, dass die App in deinen Sicherungsordner schreiben darf.",
    el("button", { class: "btn sm", style: "margin-left:8px", onclick: async () => { if (await abPerm(true)) { $("#banner").replaceChildren(); runAutoBackup(true); } } }, "Erlauben"));
}
async function chooseBackupDir() {
  try {
    const h = await window.showDirectoryPicker({ id: "buecherregal-sicherung", mode: "readwrite", startIn: "documents" });
    AB.handle = h; await DB.setMeta("backupDir", h);
    await runAutoBackup(true);
    return true;
  } catch (e) { if (e.name !== "AbortError") toast("Ordner konnte nicht gewählt werden: " + (e.message || e)); return false; }
}
async function disableAutoBackup() {
  if (!(await confirmBox("Automatische Sicherung ausschalten?\nDie bisherigen Sicherungsdateien bleiben im Ordner.", "Ausschalten"))) return;
  AB.handle = null; clearTimeout(AB.timer); await DB.setMeta("backupDir", null); abRefresh(); toast("Automatische Sicherung ausgeschaltet.");
}
async function restoreFromFolder() {
  let dir = AB.handle && await abPerm(true) ? AB.handle : null;
  try { if (!dir) dir = await window.showDirectoryPicker({ id: "buecherregal-sicherung", mode: "read" }); } catch { return; }
  const found = []; for await (const [n, h] of dir.entries()) if (h.kind === "file" && /^buecherregal-.*\.json$/i.test(n)) found.push(n);
  if (!found.length) { toast("In diesem Ordner liegt keine Bücherregal-Sicherung."); return; }
  found.sort();
  const newest = found.filter(n => AUTO_RE.test(n)).pop() || found.pop();
  if (!(await confirmBox(`Sicherung „${newest}“ einlesen?\nBücher, die du auf diesem Gerät inzwischen geändert hast, bleiben in ihrer neueren Fassung erhalten.`, "Einlesen"))) return;
  let data; try { data = JSON.parse(await (await (await dir.getFileHandle(newest)).getFile()).text()); } catch { toast("Die Sicherung konnte nicht gelesen werden."); return; }
  if (data?.app !== "buecherregal" || !Array.isArray(data.books)) { toast("Die Datei ist keine Bücherregal-Sicherung."); return; }
  const msg = await importData(data, { readFile: path => abReadImage(dir, path) });
  let restored = 0;
  try {
    const fdir = await dir.getDirectoryHandle("Dateien");
    for (const b of S.books) for (const f of b.files || []) {
      if (await DB.getBlob(f.id).catch(() => null)) continue;
      try { const file = await (await fdir.getFileHandle(fileKey(f))).getFile(); await DB.putBlob({ id: f.id, bookId: b.id, blob: file }); restored++; } catch {}
    }
  } catch {}
  toast(msg + (restored ? ` ${restored} Dateien wiederhergestellt.` : ""), 6000);
}

/* ---------- Oberfläche ---------- */
const abBoxes = new Set();
function abRefresh() { for (const f of [...abBoxes]) { if (!f.box?.isConnected) abBoxes.delete(f); else f(); } }
function autoBackupBox(noTitle) {
  const box = el("div", { class: "sec abbox" });
  const draw = async () => {
    if (!abSupported()) {
      fillNode(box, el("h3", { text: "💾 Automatische Sicherung" }),
        el("p", { class: "saved", text: "Die automatische Sicherung in einen Ordner gibt es nur in Chrome oder Edge am Computer. Hier bitte ab und zu „Sicherung exportieren“ nutzen." }));
      return;
    }
    const active = !!AB.handle, ok = active && await abPerm(false);
    const at = await DB.getMeta("autoBackupAt").catch(() => null);
    fillNode(box, noTitle ? null : el("h3", { text: "💾 Automatische Sicherung" }),
      el("p", { class: "saved", style: "margin-top:0", text: "Chrome speichert deine Bibliothek automatisch in einen Ordner auf diesem Computer – etwa eine Minute nach jeder Änderung, ein Stand pro Tag, die letzten 14 Tage bleiben erhalten. Bilder liegen einzeln im Unterordner „Bilder“, E-Books und PDFs im Unterordner „Dateien“ – so bleiben die Tagesdateien klein. Es geht nichts ins Internet." }),
      active ? el("div", { class: "note" + (ok && !AB.lastError ? " info" : "") },
        el("div", {}, el("b", { text: ok ? "Aktiv" : "Wartet auf deine Erlaubnis" }), " · Ordner „", el("b", { text: AB.handle.name }), "“"),
        el("div", { class: "saved", style: "margin-top:2px", text: at ? "Letzte Sicherung: " + new Date(at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "Noch keine Sicherung geschrieben." }),
        AB.lastError ? el("div", { class: "saved", style: "color:#b3261e", text: "Letzter Fehler: " + AB.lastError }) : null) : null,
      el("div", { class: "covertools", style: "margin-top:8px" },
        active ? el("button", { class: "btn primary", onclick: () => runAutoBackup(true) }, ok ? "Jetzt sichern" : "Erlauben & sichern") : el("button", { class: "btn primary", onclick: chooseBackupDir }, "Ordner wählen & einschalten"),
        active ? el("button", { class: "btn", onclick: chooseBackupDir }, "Anderen Ordner wählen") : null,
        el("button", { class: "btn", onclick: restoreFromFolder }, "Aus Sicherungsordner wiederherstellen"),
        active ? el("button", { class: "btn ghost danger", onclick: disableAutoBackup }, "Ausschalten") : null),
      el("p", { class: "saved", text: "Wichtig: Wähle einen Ordner, der nicht mit einer Cloud abgeglichen wird (unter Windows ist „Dokumente“ manchmal mit OneDrive verbunden) – z. B. einen neuen Ordner „Bücherregal-Sicherung“ direkt auf Laufwerk C: oder auf einer externen Festplatte." }));
  };
  draw.box = box; draw(); abBoxes.add(draw);
  return box;
}
function openAutoBackup() { const sh = sheet("💾 Automatische Sicherung"); const bx = autoBackupBox(true); bx.style.marginTop = "0"; fillNode(sh.body, bx); }

/* ---------- Start ---------- */
(async () => {
  if (!abSupported()) return;
  try { AB.handle = await DB.getMeta("backupDir") || null; } catch { AB.handle = null; }
  if (!AB.handle) return;
  const at = await DB.getMeta("autoBackupAt").catch(() => null);
  if (await abPerm(false)) { if (!at || Date.now() - new Date(at) > 6 * 3600e3) scheduleAutoBackup(8000); }
  else abAskBanner();
})();
