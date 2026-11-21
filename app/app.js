/* Mein Bücherregal – eigenständige Web-App, Daten bleiben im Browser (IndexedDB). */
"use strict";

/* ================= Grundlagen ================= */
const S = {
  books: [], deleted: {}, loaded: false,
  filter: "all", sort: "added-desc", q: "",
  tFilter: "all", tq: "", tSort: { key: "addedAt", dir: -1 },
  urls: new Map(), // id -> objectURL des Covers
  photos: [], // gespeicherte Fach-Fotos (siehe shelfphotos.js)
  stack: [],  // Stapel-Erfassung, nur auf diesem Gerät (siehe stackscan.js)
};
const STATUS = { unread: "Ungelesen", reading: "Gerade dabei", read: "Gelesen" };
const STATUS_COLOR = { unread: "var(--s-unread)", reading: "var(--s-reading)", read: "var(--s-read)" };
const FIELDS = [
  { k: "title", l: "Titel", req: true }, { k: "author", l: "Autor", req: true }, { k: "year", l: "Jahr", req: true },
  { k: "isbn", l: "ISBN" }, { k: "publisher", l: "Verlag" }, { k: "series", l: "Reihe" }, { k: "seriesNo", l: "Band-Nr." }, { k: "pages", l: "Seiten" },
  { k: "genre", l: "Genre" }, { k: "language", l: "Sprache" }, { k: "price", l: "Preis (€)" }, { k: "value", l: "Heutiger Wert (€)" }, { k: "summary", l: "Zusammenfassung", req: true },
];
const $ = (s, el = document) => el.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
};
const fillNode = (node, ...kids) => node.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const isMobile = () => matchMedia("(pointer:coarse)").matches;
/** Symbol aus dem SVG-Satz in index.html (#i-…): library, shelf, star, more, plus, table, search, filter, chevron, camera, barcode */
const icon = name => { const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg"), u = document.createElementNS(ns, "use"); s.setAttribute("class", "ico"); s.setAttribute("aria-hidden", "true"); u.setAttribute("href", "#i-" + name); s.append(u); return s; };
function toast(msg, ms = 2800) { document.querySelectorAll(".toast").forEach(x => x.remove()); const t = el("div", { class: "toast", text: msg }); document.body.append(t); setTimeout(() => t.remove(), ms); return t; }
function toastAction(msg, label, fn, ms = 6000) { const t = toast(msg, ms); t.classList.add("act"); t.append(el("button", { class: "tact", onclick: () => { t.remove(); fn(); } }, label)); return t; }
function setBanner(t, btn) { $("#banner").replaceChildren(el("div", { class: "banner" }, t, btn || null)); }

/* ================= Speicher (IndexedDB) ================= */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("buecherregal", 4);
    // Version 1 → 2: zusätzlicher Speicher für Bilder & Dateien; 2 → 3: Speicher für Fach-Fotos; 3 → 4: Stapel (stackscan.js).
    // Vorhandene Daten bleiben unverändert.
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("books")) d.createObjectStore("books", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs", { keyPath: "id" }).createIndex("bookId", "bookId");
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath: "id" });
      if (!d.objectStoreNames.contains("stack")) d.createObjectStore("stack", { keyPath: "id" });
    };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); res(db); }; // neuere App-Version in anderem Fenster nicht blockieren
    r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const s = t.objectStore(store);
      let out; const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    all: () => tx("books", "readonly", s => s.getAll()),
    put: b => tx("books", "readwrite", s => s.put(b)),
    del: id => tx("books", "readwrite", s => s.delete(id)),
    getMeta: async k => (await tx("meta", "readonly", s => s.get(k)))?.value,
    setMeta: (k, value) => tx("meta", "readwrite", s => s.put({ key: k, value })),
    getBlob: id => tx("blobs", "readonly", s => s.get(id)),
    putBlob: rec => tx("blobs", "readwrite", s => s.put(rec)),
    delBlob: id => tx("blobs", "readwrite", s => s.delete(id)),
    allPhotos: () => tx("photos", "readonly", s => s.getAll()),
    putPhoto: p => tx("photos", "readwrite", s => s.put(p)),
    allStack: () => tx("stack", "readonly", s => s.getAll()),
    putStack: e => tx("stack", "readwrite", s => s.put(e)),
    delStack: id => tx("stack", "readwrite", s => s.delete(id)),
  };
})();

async function loadAll() {
  try {
    S.books = await DB.all();
    S.deleted = (await DB.getMeta("deleted")) || {};
    S.shelves = (await DB.getMeta("shelves")) || { walls: [], updatedAt: "" };
    S.photos = await DB.allPhotos().catch(() => []);
    S.stack = await DB.allStack().catch(() => []); // Stapel-Erfassung (nur auf diesem Gerät)
  } catch (e) {
    setBanner("Der Browser erlaubt hier keinen Speicher (z. B. im privaten Modus). Bitte im normalen Modus öffnen.");
  }
  S.loaded = true; renderAll();
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
  remindBackup();
}
async function putBook(b) {
  b.updatedAt = new Date().toISOString();
  await DB.put(b);
  const i = S.books.findIndex(x => x.id === b.id);
  if (i >= 0) S.books[i] = b; else S.books.push(b);
  if (S.urls.has(b.id)) { URL.revokeObjectURL(S.urls.get(b.id)); S.urls.delete(b.id); }
  spineCol.delete(b.id);
  dataChanged();
  if (!b.spine?.imageBlob && spineImg.has(b.id)) { URL.revokeObjectURL(spineImg.get(b.id).url); spineImg.delete(b.id); }
  scheduleRender();
}
async function patchBook(id, patch) {
  const b = S.books.find(x => x.id === id); if (!b) return;
  await putBook({ ...b, ...patch });
}
async function removeBook(id) {
  if (unshelve(id)) await saveShelves();
  const old = S.books.find(b => b.id === id); if (old) await deleteBookBlobs(old);
  await DB.del(id);
  S.books = S.books.filter(b => b.id !== id);
  S.deleted[id] = new Date().toISOString();
  dataChanged();
  await DB.setMeta("deleted", S.deleted);
  scheduleRender();
}
/* Fach-Fotos: { id, createdAt, updatedAt, fachKey, blob, w, h, scan?, doneAt?, deletedAt? }.
   Gelöschte Fotos bleiben als Grabstein ohne Bild stehen (deletedAt), damit Abgleich und Sicherung die Löschung weitergeben. */
const photoUrls = new Map();
function photoUrl(p) { if (!p?.blob) return null; if (!photoUrls.has(p.id)) photoUrls.set(p.id, URL.createObjectURL(p.blob)); return photoUrls.get(p.id); }
function forgetPhotoUrl(id) { if (photoUrls.has(id)) { URL.revokeObjectURL(photoUrls.get(id)); photoUrls.delete(id); } }
async function storePhotoLocal(p) { // ohne neuen Zeitstempel – für Abgleich und Import
  await DB.putPhoto(p);
  const i = S.photos.findIndex(x => x.id === p.id); if (i >= 0) S.photos[i] = p; else S.photos.push(p);
  forgetPhotoUrl(p.id);
}
async function putPhoto(p) { p.updatedAt = new Date().toISOString(); await storePhotoLocal(p); dataChanged(); scheduleRender(); return p; }
async function patchPhoto(id, patch) { const p = S.photos.find(x => x.id === id); if (p) return putPhoto({ ...p, ...patch }); }
const openPhotos = () => S.photos.filter(p => !p.deletedAt && !p.doneAt).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
// Ein Fach in mehreren Fotos (links → rechts): weitere Fotos tragen partOf (Id des ersten) und part (2, 3 …) – optional, ältere Versionen sehen Einzelfotos
// immer der aktuelle Stand aus S.photos (nach patchPhoto ist das alte Objekt veraltet)
const photoRoot = p => { const cur = p && (S.photos.find(x => x.id === p.id) || p); return (cur?.partOf && S.photos.find(x => x.id === cur.partOf && !x.deletedAt)) || cur; };
function photoGroup(p) {
  const r = photoRoot(p);
  return [r, ...S.photos.filter(x => x.id !== r.id && x.partOf === r.id && !x.deletedAt).sort((a, b) => (a.part || 0) - (b.part || 0) || (a.createdAt || "").localeCompare(b.createdAt || ""))];
}
// Nach jeder Änderung: lokale Ordner-Sicherung und (falls eingerichtet) Server-Abgleich einplanen
function dataChanged() { if (typeof scheduleAutoBackup === "function") scheduleAutoBackup(); if (typeof scheduleSync === "function") scheduleSync(); }
let rT; function scheduleRender() { clearTimeout(rT); rT = setTimeout(renderAll, 30); }

/* ================= Hilfen ================= */
function coverSrc(b) {
  if (b.coverBlob) {
    if (!S.urls.has(b.id)) S.urls.set(b.id, URL.createObjectURL(b.coverBlob));
    return S.urls.get(b.id);
  }
  return b.coverUrl || null;
}
function hue(str) { let h = 0; for (const c of (str || "?")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function coverEl(b, { badge = false, src } = {}) {
  src = src !== undefined ? src : coverSrc(b);
  const c = el("div", { class: "cover" });
  const ph = () => {
    const h = hue((b.title || "") + (b.author || ""));
    return el("div", { class: "ph", style: `background:linear-gradient(160deg,hsl(${h} 35% 38%),hsl(${(h + 30) % 360} 40% 24%))` },
      el("div", { class: "t", text: b.title || "Ohne Titel" }), el("div", { class: "a", text: b.author || "" }));
  };
  if (src) { const img = el("img", { src, alt: "", loading: "lazy" }); img.onerror = () => { img.replaceWith(ph()); if (b.id && !b.coverBlob && src === b.coverUrl && !S.badCover.has(b.id)) { S.badCover.add(b.id); scheduleRender(); } }; c.append(img); }
  else c.append(ph());
  const st = badge && b.status && b.status !== "unread" ? el("span", { class: "badge " + b.status, text: b.status === "read" ? "✓ Gelesen" : "📖 Lese ich" }) : null;
  const fav = b.favorite ? el("span", { class: "favbadge", title: "Lieblingsbuch", "aria-label": "Lieblingsbuch", text: "♥" }) : null;
  if (st || fav) { c.classList.add("hasbar"); c.append(el("span", { class: "cbar" }, st, fav)); }
  return c;
}
function lastName(a) { const first = (a || "").split(/[,;&]| und /)[0].trim(); const p = first.split(/\s+/); return (p[p.length - 1] || "").toLowerCase(); }
function missingOf(b) { const m = []; for (const f of FIELDS) if (f.req && !String(b[f.k] ?? "").trim()) m.push(f.l); if (!b.coverBlob && !b.coverUrl) m.push("Cover"); return m; }
function matchQ(b, q) { if (!q) return true; q = q.toLowerCase(); return [...(b.tags || []), b.series, b.title, b.author, b.isbn, b.publisher, b.genre, b.notes, b.summary, b.year, b.dedication, b.signedBy, ...(b.images || []).map(x => x.caption), ...(b.files || []).map(x => x.name)].some(v => String(v ?? "").toLowerCase().includes(q)); }
function cleanIsbn(s) { return String(s || "").replace(/[^0-9Xx]/g, "").toUpperCase(); }
function isbn13ok(s) { if (!/^\d{13}$/.test(s)) return false; let t = 0; for (let i = 0; i < 12; i++) t += (+s[i]) * (i % 2 ? 3 : 1); return (10 - t % 10) % 10 === +s[12]; }
function isbn10ok(s) { if (!/^\d{9}[\dX]$/.test(s)) return false; let t = 0; for (let i = 0; i < 10; i++) t += (s[i] === "X" ? 10 : +s[i]) * (10 - i); return t % 11 === 0; }
function toIsbn13(s) { s = cleanIsbn(s); if (isbn13ok(s)) return s; if (isbn10ok(s)) { const b = "978" + s.slice(0, 9); let t = 0; for (let i = 0; i < 12; i++) t += (+b[i]) * (i % 2 ? 3 : 1); return b + ((10 - t % 10) % 10); } return null; }
function isbn10of(i13) { if (!i13 || !i13.startsWith("978")) return null; const b = i13.slice(3, 12); let t = 0; for (let i = 0; i < 9; i++) t += (+b[i]) * (10 - i); const c = (11 - t % 11) % 11; return b + (c === 10 ? "X" : c); }
function findDuplicate(d, exceptId) {
  const i = toIsbn13(d.isbn);
  return S.books.find(b => b.id !== exceptId && !dupConflict(d, b) && ((i && toIsbn13(b.isbn) === i) || (d.title && b.title && b.title.trim().toLowerCase() === d.title.trim().toLowerCase() && (b.author || "").toLowerCase() === (d.author || "").toLowerCase())));
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Skript nicht ladbar: " + src)); document.head.append(s); }); }
const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }

/* ================= Bilder ================= */
function loadImage(blob) { return new Promise((res, rej) => { const u = URL.createObjectURL(blob); const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Bild nicht lesbar")); i.src = u; }); }
function toCanvas(img, max) { const w = img.naturalWidth || img.videoWidth, h = img.naturalHeight || img.videoHeight; const s = Math.min(1, max / Math.max(w, h)); const c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c; }
const canvasBlob = (c, q = .85) => new Promise(r => c.toBlob(r, "image/jpeg", q));
async function coverBlobFromFile(file) { const img = await loadImage(file); return canvasBlob(toCanvas(img, 900), .82); }
// Kein brauchbares Cover: winzig (Amazon/Open Library liefern 1×1) oder Googles „Kein Bild verfügbar“ (128×170)
const placeholderImg = (img, url) => img.naturalWidth < 60 || img.naturalHeight < 60 || (/books\.google\./.test(url || img.src) && img.naturalWidth === 128 && img.naturalHeight === 170);
/* Lädt ein Bild nur zur Anzeige (ohne CORS) und prüft, ob es wirklich ein brauchbares Bild ist. */
function imgOk(url, ms = 8000) {
  return new Promise(res => {
    if (!url) return res(false);
    const i = new Image(); const t = setTimeout(() => { i.src = ""; res(false); }, ms);
    i.onload = () => { clearTimeout(t); res(!placeholderImg(i, url)); };
    i.onerror = () => { clearTimeout(t); res(false); };
    i.referrerPolicy = "no-referrer"; i.src = url;
  });
}
async function fetchCoverBlob(url) {
  try {
    const r = await fetch(url, { mode: "cors" }); if (!r.ok) return null;
    const b = await r.blob(); if (!b.type.startsWith("image/") || b.size < 1500) return null; // Platzhalter-Bilder ignorieren
    return b;
  } catch { return null; }
}

/* ================= Buchdaten aus dem Internet ================= */
function gKey() { try { const k = localStorage.getItem("gbooksKey"); return k ? "&key=" + encodeURIComponent(k) : ""; } catch { return ""; } }
/* Erkennungsprotokoll (reclog.js): jede Katalogabfrage mit Quelle, Suchbegriff, Trefferzahl bzw. Fehlerart und Dauer.
   log ist ein Array (oder nichts). Es wird nur der Suchbegriff gemerkt, nie die Adresse (Google-Schlüssel steht in der Adresse). */
function catErr(e) {
  if (e?.name === "AbortError") return "Zeitüberschreitung";
  const s = String(e?.message || e || "");
  if (/^(429|403)$/.test(s)) return `gesperrt/Kontingent (${s})`;
  if (/^\d{3}$/.test(s)) return "HTTP " + s;
  if (e instanceof TypeError) return "nicht erreichbar (Netz/CORS)";
  return s.slice(0, 120) || "Fehler";
}
function catTrack(log, src, q, p) {
  if (!Array.isArray(log)) return p;
  const t0 = performance.now(), e = { src, q: String(q || "").slice(0, 200) }; log.push(e);
  const cnt = v => Array.isArray(v) ? v.length : Array.isArray(v?.items) ? v.items.length : Array.isArray(v?.docs) ? v.docs.length : v ? 1 : 0;
  return p.then(v => { e.ms = Math.round(performance.now() - t0); e.n = cnt(v); return v; },
    err => { e.ms = Math.round(performance.now() - t0); e.err = catErr(err); throw err; });
}
async function getJSON(url, ms = 9000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
function stripHtml(s) { const d = document.createElement("div"); d.innerHTML = s || ""; return (d.textContent || "").trim(); }
const LANG = { de: "Deutsch", en: "Englisch", fr: "Französisch", es: "Spanisch", it: "Italienisch", nl: "Niederländisch", ger: "Deutsch", eng: "Englisch", fre: "Französisch", spa: "Spanisch", ita: "Italienisch", dut: "Niederländisch", rus: "Russisch", ukr: "Ukrainisch", pol: "Polnisch", cze: "Tschechisch", tur: "Türkisch", por: "Portugiesisch", swe: "Schwedisch", dan: "Dänisch", nor: "Norwegisch", lat: "Latein", gre: "Griechisch", jpn: "Japanisch", chi: "Chinesisch", ara: "Arabisch" };
function fromGoogle(item) {
  const v = item.volumeInfo || {};
  const ids = v.industryIdentifiers || [];
  const isbn = toIsbn13((ids.find(i => i.type === "ISBN_13") || ids.find(i => i.type === "ISBN_10") || {}).identifier) || "";
  let img = v.imageLinks?.extraLarge || v.imageLinks?.large || v.imageLinks?.medium || v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "";
  img = img.replace(/^http:/, "https:").replace("&edge=curl", "");
  return {
    title: [v.title, v.subtitle].filter(Boolean).join(" – "), author: (v.authors || []).join(", "),
    year: (v.publishedDate || "").slice(0, 4), publisher: v.publisher || "", pages: v.pageCount ? String(v.pageCount) : "",
    genre: (v.categories || [])[0] || "", language: LANG[v.language] || v.language || "", summary: stripHtml(v.description),
    isbn, coverUrl: img, src: "Google Books",
  };
}
function fromOLSearch(d) {
  const isbn = toIsbn13((d.isbn || []).find(i => toIsbn13(i))) || "";
  return {
    title: [d.title, d.subtitle].filter(Boolean).join(" – "), author: (d.author_name || []).join(", "),
    year: d.first_publish_year ? String(d.first_publish_year) : "", publisher: (d.publisher || [])[0] || "",
    pages: d.number_of_pages_median ? String(d.number_of_pages_median) : "", genre: (d.subject || [])[0] || "",
    language: LANG[(d.language || [])[0]] || "", summary: "", isbn,
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : "", src: "Open Library", olKey: d.key,
  };
}
async function olDescription(key) {
  if (!key) return "";
  try { const w = await getJSON("https://openlibrary.org" + key + ".json"); const d = w.description; return typeof d === "string" ? d : (d?.value || ""); } catch { return ""; }
}
function merge(a, b) { const o = { ...a }; for (const k in b) if (!String(o[k] ?? "").trim() && b[k]) o[k] = b[k]; return o; }

/* ---- Deutsche Nationalbibliothek (DNB): sehr vollständig für deutschsprachige und aktuelle Ausgaben ---- */
const MARC = "http://www.loc.gov/MARC21/slim";
function dnbFields(r, tag) { return [...r.getElementsByTagNameNS(MARC, "datafield")].filter(d => d.getAttribute("tag") === tag); }
function dnbSub(d, code) { const s = [...d.getElementsByTagNameNS(MARC, "subfield")].find(x => x.getAttribute("code") === code); return s ? s.textContent.trim() : ""; }
function dnbFirst(r, tag, code) { for (const d of dnbFields(r, tag)) { const v = dnbSub(d, code); if (v) return v; } return ""; }
const trimPunct = s => (s || "").replace(/[\s\/:;,.=]+$/, "").replace(/^[\s\/:;,.=]+/, "").trim();
function flipName(n) { n = trimPunct(n); const m = n.match(/^([^,]+),\s*(.+)$/); return m ? `${m[2]} ${m[1]}` : n; }
/* Buchhöhe aus der Formatangabe der Kataloge („21 cm“, „24 x 17 cm“, „21 x 13,5 cm“): die erste Zahl ist die Höhe.
   Nur 8–33 cm (wie die Fächer), sonst 0. */
function heightFromFormat(s) {
  const m = String(s || "").match(/(?:^|[^\d,.])(\d{1,2}(?:[,.]\d{1,2})?)\s*(?:[x×]\s*\d{1,2}(?:[,.]\d{1,2})?\s*)?cm\b/i);
  if (!m) return 0;
  const h = parseFloat(m[1].replace(",", "."));
  return h >= 8 && h <= 33 ? Math.round(h * 10) / 10 : 0;
}
/* Höhe aus einem Katalog-Datensatz übernehmen – nur wenn das Buch noch keine hat (gemessen, Fach-Foto, Editor bleiben).
   Gibt das neue spine-Objekt zurück oder null. */
function spineWithHeight(b, rec) {
  if (!+rec?.heightCm || +b.spine?.heightCm) return null;
  return { ...(b.spine || {}), heightCm: +rec.heightCm };
}
function fromDNB(r) {
  const names = [], editors = [];
  for (const tag of ["100", "700"]) for (const d of dnbFields(r, tag)) {
    const role = [...d.getElementsByTagNameNS(MARC, "subfield")].filter(x => x.getAttribute("code") === "4").map(x => x.textContent);
    const n = flipName(dnbSub(d, "a"));
    if (n.length <= 3 || /^(the|der|die|das|a|an)$/i.test(n)) continue;
    if (role.includes("edt")) editors.push(n); // Herausgeber – bei Sammelbänden besser als nichts
    if (tag === "700" && !role.includes("aut")) continue;
    if (role.length && !role.includes("aut")) continue;
    names.push(n);
  }
  // 245 n: Bandzählung, oft mit Verantwortlichen dahinter: „27. / Ges. von Barbara Mürmann“
  const partRaw = dnbFirst(r, "245", "n"), pm = partRaw.match(/^\s*(\d{1,3})\.?\s*(?:\/\s*(.*))?$/);
  const part = pm ? pm[1] : trimPunct(partRaw);
  let author = [...new Set(names.length ? names : editors)].join(", ");
  if (!author) {
    let c = dnbFirst(r, "245", "c") || (pm && pm[2]) || "";
    c = c.split(/\s;\s|\b(Aus d(em|\.)|Übers|übers|Deutsch von|Mit Ill)/)[0];
    author = trimPunct(c.replace(/\[|\]|\(|\)|\bu\.\s?a\.|\bvon\b|\.\.\./g, " ").replace(/\s+/g, " ")
      .replace(/^(ges\.|gesammelt|hrsg\.?|herausgegeben|ausgew(ählt|\.)?(\s+und\s+zusammengestellt)?|zusammengestellt)\s+/i, ""));
  }
  const nosort = s => trimPunct(String(s).replace(/[\u0098\u009c]/g, "")); // Nichtsortier-Zeichen um „Die“
  const sub245 = nosort(dnbFirst(r, "245", "b"));
  const title = [nosort(dnbFirst(r, "245", "a")), /^(gesammelt|ges\.|hrsg|herausgegeben|ausgew|zusammengest)/i.test(sub245) ? "" : sub245].filter(Boolean).join(" – ");
  const pubF = dnbFields(r, "264")[0] || dnbFields(r, "260")[0];
  const publisher = pubF ? trimPunct(dnbSub(pubF, "b")) : "";
  const year = pubF ? ((dnbSub(pubF, "c").match(/\d{4}/) || [""])[0]) : "";
  const ext = dnbFirst(r, "300", "a");
  const pages = (ext.match(/(\d+)\s*(Seiten|S\.)/) || [, ""])[1];
  const isbn = dnbFields(r, "020").map(d => toIsbn13(dnbSub(d, "a"))).find(Boolean) || "";
  const lang = dnbFirst(r, "041", "a");
  const ebook = /Online-Ressource|E-Book|eBook/i.test(ext + " " + publisher);
  const av = /\b(CDs?|DVD|Audio|Tonträger|MP3|Hörbuch|Hörspiel|Lesung)\b/i.test(ext + " " + title);
  const edition = trimPunct(dnbFirst(r, "250", "a"));
  const serF = dnbFields(r, "490")[0];
  let series = serF ? trimPunct(dnbSub(serF, "a")) : "", seriesNo = serF ? trimPunct(dnbSub(serF, "v")) : "", orderNo = "";
  // „Weihnachtsgeschichten am Kamin 27.“ – der Band zählt mehr als die Verlagsreihe („Rororo 25795“, eine Bestellnummer)
  if (/^\d{1,3}$/.test(part) && !/^\d{1,3}$/.test(seriesNo)) { orderNo = seriesNo; series = nosort(dnbFirst(r, "245", "a")); seriesNo = String(+part); }
  const heightCm = av ? 0 : heightFromFormat(dnbFirst(r, "300", "c")); // 300 $c: Format, z. B. „21 cm“
  return { title, author, year, publisher, pages, genre: "", language: LANG[lang] || lang || "", summary: "", isbn, coverUrl: "", src: "Deutsche Nationalbibliothek", ebook, av, edition, series, seriesNo, part, orderNo, ...(heightCm ? { heightCm } : {}) };
}
/* ---- Schonende Katalogabfragen: Zwischenspeicher je Suchbegriff (30 Min., gleichzeitige gleiche Anfragen nur einmal),
   DNB höchstens eine Anfrage zur Zeit mit kurzer Pause, und eine Quelle, die „gesperrt/Kontingent“ meldet (429/403), wird
   eine Weile ausgelassen (DNB 10 Min., Google 1 Std.) – sonst verlängert die App die Sperre selbst. ---- */
const CAT = { cache: new Map(), blocked: {}, dnbQ: Promise.resolve(), dnbGap: 150, hinted: false };
function catFetch(src, key, fn) {
  if ((CAT.blocked[src] || 0) > Date.now()) return Promise.reject(Object.assign(new Error("pausiert"), { paused: true }));
  const hit = CAT.cache.get(key);
  if (hit && hit.until > Date.now()) return hit.p;
  const run = src === "DNB" ? (CAT.dnbQ = CAT.dnbQ.catch(() => {}).then(() => new Promise(r => setTimeout(r, CAT.dnbGap)))).then(fn) : fn();
  const p = run.catch(e => {
    CAT.cache.delete(key);
    if (/^(429|403)$/.test(String(e?.message))) { CAT.blocked[src] = Date.now() + (src === "Google Books" ? 3600e3 : 600e3); if (src === "Google Books") googleQuotaHint(); }
    throw e;
  });
  CAT.cache.set(key, { p, until: Date.now() + 30 * 60e3 });
  return p;
}
// Google Books ohne eigenen Schlüssel teilt ein kleines Tageskontingent mit allen – dann deutlich auf den eigenen Schlüssel hinweisen
function googleQuotaHint() {
  if (CAT.hinted || gKey()) return; CAT.hinted = true;
  setBanner("Google Books antwortet gerade nicht (das gemeinsame Tageskontingent ist erschöpft). Mit einem eigenen kostenlosen Schlüssel klappt die Suche wieder zuverlässig. ",
    el("button", { class: "btn sm", onclick: () => { $("#banner").replaceChildren(); aboutBox(); } }, "Schlüssel eintragen"));
}
async function sruQuery(base, cql, max, src, parse) {
  const url = `${base}?version=1.1&operation=searchRetrieve&maximumRecords=${max}&query=${encodeURIComponent(cql)}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status);
    const x = new DOMParser().parseFromString(await r.text(), "application/xml");
    return [...x.getElementsByTagNameNS(MARC, "record")].map(parse).filter(b => b && b.title);
  } finally { clearTimeout(t); }
}
function dnbQuery(cql, max = 15) {
  return catFetch("DNB", `dnb|${max}|${cql}`, () => sruQuery("https://services.dnb.de/sru/dnb", cql, max + "&recordSchema=MARC21-xml", "DNB", fromDNB));
}
/* ---- K10plus (Verbundkatalog GBV/SWB, SRU, frei, CORS erlaubt): viele ältere deutsche Bücher ohne ISBN. Nur Textmaterial (Leader 06 a/t). ---- */
function fromK10(r) {
  const lead = (r.getElementsByTagNameNS(MARC, "leader")[0]?.textContent || "").padEnd(8, " ");
  if (!/[at]/.test(lead[6])) return null; // Film, Tonträger, Noten … sind keine Bücher
  return { ...fromDNB(r), src: "K10plus (Bibliotheksverbund)" };
}
function k10Query(cql, max = 10) {
  return catFetch("K10plus", `k10|${max}|${cql}`, () => sruQuery("https://sru.k10plus.de/opac-de-627", cql, max + "&recordSchema=marcxml", "K10plus", fromK10));
}
// Weitere Bildquellen zur ISBN: Open Library, dann das Google-Books-Cover zur ISBN (ohne Schlüssel, hat viele deutsche Ausgaben)
const gIsbnCover = isbn => `https://books.google.com/books/content?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=1`;
const olCovers = isbn => { const i10 = isbn10of(isbn); return [`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, i10 ? `https://covers.openlibrary.org/b/isbn/${i10}-L.jpg?default=false` : null, gIsbnCover(isbn)].filter(Boolean); };

async function lookupIsbn(isbn, log) {
  const [g, ol, dnb, k10] = await Promise.allSettled([
    catTrack(log, "Google Books", "isbn:" + isbn, gJSON("isbn:" + isbn)),
    catTrack(log, "Open Library", "isbn:" + isbn, olJSON(`q=isbn:${isbn}`)),
    catTrack(log, "DNB", "num=" + isbn, dnbQuery(`num=${isbn}`, 3)),
    catTrack(log, "K10plus", "isb=" + isbn, k10Query(`pica.isb=${isbn}`, 3)),
  ]);
  let rec = {};
  if (g.status === "fulfilled" && g.value.items?.length) rec = fromGoogle(g.value.items[0]);
  if (dnb.status === "fulfilled" && dnb.value.length) {
    const d = dnb.value.find(x => x.isbn === isbn) || dnb.value[0];
    // Für Verlag/Jahr/Seiten ist die DNB verlässlicher (genau diese Ausgabe)
    rec = rec.title ? merge({ ...rec, publisher: d.publisher || rec.publisher, year: d.year || rec.year, pages: d.pages || rec.pages }, d) : d;
  }
  if (k10.status === "fulfilled" && k10.value.length) { // K10plus: gleiche Genauigkeit wie die DNB, springt ein, wenn die DNB pausiert
    const k = k10.value.find(x => x.isbn === isbn) || k10.value[0];
    rec = rec.title ? merge(rec, k) : k;
  }
  if (ol.status === "fulfilled" && ol.value.docs?.length) {
    const o = fromOLSearch(ol.value.docs[0]); o.isbn = isbn;
    rec = merge(rec, o);
    if (!rec.summary) rec.summary = await olDescription(o.olKey);
  }
  if (!rec.title && [g, ol, dnb, k10].every(x => x.status === "rejected")) throw new Error("offline");
  rec.isbn = isbn;
  rec.src = [g.status === "fulfilled" && g.value.items?.length ? "Google Books" : null, dnb.status === "fulfilled" && dnb.value.length ? "Deutsche Nationalbibliothek" : null, ol.status === "fulfilled" && ol.value.docs?.length ? "Open Library" : null, k10.status === "fulfilled" && k10.value.length ? "K10plus" : null].filter(Boolean).join(", ");
  rec.altCovers = [rec.coverUrl, ...olCovers(isbn)].filter((v, i, a) => v && a.indexOf(v) === i);
  rec.coverUrl = rec.altCovers[0];
  return rec.title ? rec : null;
}
/* ---- lobid (hbz-Verbundkatalog der deutschen Bibliotheken): frei, ohne Schlüssel, gut für deutsche Ausgaben und Reihen ---- */
function fromLobid(m) {
  const contrib = m.contribution || [];
  const role = c => (c.role?.id || "").split("/").pop();
  const pick = r => contrib.filter(c => role(c) === r && (c.agent?.type || []).includes("Person")).map(c => flipName(c.agent.label || ""));
  const author = [...new Set(pick("aut").length ? pick("aut") : pick("edt"))].filter(Boolean).join(", ");
  const sub = (m.otherTitleInformation || [])[0] || "";
  const title = [trimPunct(m.title), /^(gesammelt|hrsg|herausgegeben|ausgew|übers|aus dem|mit )/i.test(sub) ? "" : trimPunct(sub)].filter(Boolean).join(" – ");
  const pub = (m.publication || [])[0] || {};
  const isbn = (m.isbn || []).map(toIsbn13).find(Boolean) || "";
  const rel = (m.isPartOf || [])[0] || {}, sup = (rel.hasSuperordinate || [])[0] || {};
  const lbl = String(sup.label || ""), lm = lbl.match(/^(.*?)\s*;\s*(\S+)\s*$/);
  const series = trimPunct(lm ? lm[1] : lbl), seriesNo = trimPunct(rel.numbering || (lm ? lm[2] : ""));
  const ebook = /online|elektron|e-book/i.test(JSON.stringify(m.medium || "") + " " + (m.type || []).join(" "));
  const av = /audio|tonträger|hörbuch|hörspiel|\bCD\b|DVD/i.test(JSON.stringify(m.medium || "") + " " + (m.type || []).join(" ") + " " + (m.extent || "") + " " + m.title);
  const heightCm = av ? 0 : heightFromFormat(m.extent); // „317 S. ; 21 cm“
  return {
    ...(heightCm ? { heightCm } : {}),
    title, author, year: String(pub.startDate || "").slice(0, 4), publisher: (pub.publishedBy || [])[0] || "",
    pages: (String(m.extent || "").match(/(\d+)\s*(Seiten|S\.)/) || [, ""])[1], genre: "", language: ((m.language || [])[0] || {}).label || "",
    summary: "", isbn, coverUrl: "", src: "Bibliotheksverbund (lobid)", ebook, av, edition: (m.edition || [])[0] || "", series, seriesNo, part: /^\d{1,3}$/.test(seriesNo) ? seriesNo : "",
  };
}
async function lobidQuery(words, size = 15, all = true) {
  const t = words.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!t.length) return [];
  return lobidRaw(t.join(all ? " AND " : " "), size);
}
async function lobidRaw(q, size = 15) {
  const j = await catFetch("lobid", `lobid|${size}|${q}`, () => getJSON(`https://lobid.org/resources/search?q=${encodeURIComponent(q)}&format=json&size=${size}`));
  return (j.member || []).map(fromLobid).filter(b => b.title);
}
const gJSON = (q, extra = "") => catFetch("Google Books", `g|${q}|${extra}`, () => getJSON(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}${extra}${gKey()}`));
const olJSON = query => catFetch("Open Library", `ol|${query}`, () => getJSON(`https://openlibrary.org/search.json?${query}&limit=6&fields=key,title,subtitle,author_name,first_publish_year,publisher,number_of_pages_median,subject,language,isbn,cover_i`));

/* ---- Gezielte Suche nach Titel + Autor (für erkannte Rücken, Titellisten, Cover): Titel- und Personen-Index statt „alle Wörter“.
   Bei null Treffern schrittweise lockern: Haupttitel + Nachname → Kernwörter + Nachname → nur Titel; dazu, wo der Katalog es kann,
   die Verlagsnummer (rororo, dtv …). Untertitel werden nie erzwungen. ---- */
const ARTICLE = /^(der|die|das|ein|eine|einer|the|a|an|le|la|les|il|lo|el)\s+/i;
const FIELD_STOP = new Set(["der", "die", "das", "und", "oder", "the", "and", "von", "vom", "zum", "zur", "mit", "für", "auf", "aus", "ein", "eine", "einer", "des", "dem", "den", "im", "in", "of", "to", "a", "an"]);
const catNorm = s => String(s || "").replace(/[„“"»«'’()[\]!?.,:;–—\-/&+*#]/g, " ").replace(/\s+/g, " ").trim();
const mainTitle = t => String(t || "").split(/\s[:–—-]\s|:\s|\.\s/)[0].trim();
const lastNameOf = a => { a = String(a || "").split(/[;&]| und | and |\//)[0].trim(); if (/^[^,]+,/.test(a)) return a.split(",")[0].trim(); const w = a.split(/\s+/).filter(Boolean); return w.length ? w[w.length - 1].replace(/[.()]/g, "") : ""; };
// die n längsten Wörter des Haupttitels, in ihrer ursprünglichen Reihenfolge
function coreWords(t, n = 3) {
  const w = catNorm(mainTitle(t)).replace(ARTICLE, "").split(" ").filter(x => x.length > 2 && !FIELD_STOP.has(x.toLowerCase()) && !/^\d+$/.test(x));
  const keep = new Set([...w].sort((a, b) => b.length - a.length).slice(0, n));
  return w.filter(x => keep.has(x));
}
async function fieldWave({ t, a, vol }, log) {
  const tv = vol ? `${t} ${vol}` : t, words = catNorm(t).split(" ").filter(Boolean);
  const res = await Promise.allSettled([
    catTrack(log, "DNB", "tit+per", dnbQuery(`tit all "${tv}"` + (a ? ` and per all "${a}"` : ""), 20)),
    catTrack(log, "K10plus", "tit+per", k10Query(`pica.tit="${tv}"` + (a ? ` and pica.per="${a}"` : ""), 10)),
    catTrack(log, "lobid", "title+agent", lobidRaw(`title:(${words.join(" AND ")})` + (a ? ` AND contribution.agent.label:(${a})` : ""), 15)),
    catTrack(log, "Google Books", "intitle+inauthor", gJSON(`intitle:${t}` + (vol ? ` ${vol}` : "") + (a ? ` inauthor:${a}` : ""), "&maxResults=10&printType=books")).then(j => (j.items || []).map(fromGoogle)),
    catTrack(log, "Open Library", "title+author", olJSON(`title=${encodeURIComponent(t)}` + (a ? `&author=${encodeURIComponent(a)}` : ""))).then(j => (j.docs || []).map(fromOLSearch)),
  ]);
  return { ok: res.some(r => r.status === "fulfilled"), list: res.flatMap(r => r.status === "fulfilled" ? r.value : []) };
}
async function searchFields({ title, author, vol, publisher, orderNo }, log) {
  const last = catNorm(lastNameOf(author)), t1 = catNorm(mainTitle(title)).replace(ARTICLE, ""), core = coreWords(title).join(" ");
  const steps = [];
  if (t1) steps.push({ t: t1, a: last, vol });
  if (core && core.split(" ").length < t1.split(" ").length) steps.push({ t: core, a: last, vol }); // nur, wenn es wirklich weniger Wörter sind
  if (t1 && last) steps.push({ t: t1, a: "", vol });
  let ok = false;
  for (const st of steps) { const w = await fieldWave(st, log); ok = ok || w.ok; if (w.list.length) return w.list; }
  const on = String(orderNo || "").replace(/\D/g, "");
  if (on.length >= 4 && publisher) { // Verlagsnummer, z. B. „rororo 13427“ (steht bei DNB und K10plus in der Reihenangabe)
    const p = catNorm(publisher).split(" ")[0];
    const res = await Promise.allSettled([catTrack(log, "DNB", "verlagsnummer", dnbQuery(`woe all "${p} ${on}"`, 10)), catTrack(log, "K10plus", "verlagsnummer", k10Query(`pica.all="${p} ${on}"`, 10))]);
    ok = ok || res.some(r => r.status === "fulfilled");
    const list = res.flatMap(r => r.status === "fulfilled" ? r.value : []);
    if (list.length) return list;
  }
  if (steps.length && !ok) throw new Error("offline");
  return [];
}
// Suchbegriff aufbereiten: „Band 27“, „Bd. 27“, „Nr. 27“ → nur die Zahl (die Kataloge kennen das Wort „Band“ meist nicht)
function parseQuery(q) {
  const words = String(q || "").replace(/["“”„]/g, " ").replace(/\s+/g, " ").trim();
  const vol = volFromText(words);
  const core = words.replace(/(^|\s)(?:band|bd|nr|no|teil|folge|vol|volume|tome)\.?\s*(?=\d)/gi, "$1").replace(/\s+/g, " ").trim();
  const base = vol ? core.replace(new RegExp("(^|\\s)0*" + vol + "\\.?(?=\\s|$)"), " ").replace(/\s+/g, " ").trim() : core;
  return { words, core, base: base || core, vol };
}
const qTok = s => normS(s).replace(/[^a-z0-9äöü ]/g, " ").split(" ").filter(w => w.length > 1 && !["der", "die", "das", "und", "am", "im", "the", "of", "von", "ein", "eine"].includes(w));
// Band eines Treffers: Bandzählung, kurze Band-Nr. oder Zahl am Titelende
function hitVol(r) { const p = String(r.part ?? "").replace(/\D/g, ""); if (p && p.length <= 3) return String(+p); const s = String(r.seriesNo ?? "").trim(); return /^\d{1,3}$/.test(s) ? String(+s) : volFromText(r.title); }
async function searchWave(text, opts = {}) {
  const enc = encodeURIComponent(text);
  const res = await Promise.allSettled([
    Promise.allSettled((opts.dnb || [`woe all "${text}"`]).map(c => catTrack(opts.log, "DNB", c, dnbQuery(c, opts.dnbMax || 20)))).then(rs => { if (rs.every(x => x.status === "rejected")) throw rs[0].reason; return rs.flatMap(x => x.status === "fulfilled" ? x.value : []); }),
    catTrack(opts.log, "Google Books", text, gJSON(text, "&maxResults=10&printType=books")).then(j => (j.items || []).map(fromGoogle)),
    catTrack(opts.log, "lobid", text, lobidQuery(text, 15, opts.all !== false)),
    catTrack(opts.log, "Open Library", text, olJSON(`q=${enc}`)).then(j => (j.docs || []).map(fromOLSearch)),
    catTrack(opts.log, "K10plus", text, k10Query(`pica.all="${catNorm(text)}"`, 10)),
  ]);
  return { ok: res.some(r => r.status === "fulfilled"), lists: res.map(r => r.status === "fulfilled" ? r.value : []) }; // [DNB, Google, lobid, OL, K10plus]
}
async function searchBooks(q, log) {
  const P = parseQuery(q);
  if (!P.words) return [];
  // 1. Runde: Suchbegriff ohne „Band“; 2. Runde ohne Bandnummer bzw. lockerer, wenn der Band fehlt oder kaum etwas kommt
  // „woe“ (alle Wörter) findet bei kurzen Zahlen fast alles – mit Band daher genau im Titel suchen („Kamin 8.“)
  const waves = [await searchWave(P.core, P.vol ? { dnb: [`tit all "${P.core}"`], log } : { log })];
  let all = waves[0].lists.flat();
  const volHit = () => P.vol && all.some(r => hitVol(r) === P.vol);
  if (all.length < 3 || (P.vol && !volHit())) {
    if (P.base !== P.core) waves.push(await searchWave(P.base, { dnb: [`tit all "${P.base}"`, `woe all "${P.core}"`], dnbMax: 50, log }));
    else if (!all.length) waves.push(await searchWave(P.core, { dnb: [`woe any "${P.core}"`], all: false, log }));
    all = waves.flatMap(w => w.lists).flat();
  }
  if (!waves.some(w => w.ok)) throw new Error("offline");
  // Doppelte Ausgaben zusammenführen (gleiche ISBN oder Titel/Autor/Jahr)
  const seen = new Map();
  for (const r of all) {
    if (!r.title) continue;
    const key = r.isbn || (r.title + "|" + r.author + "|" + r.year).toLowerCase();
    if (seen.has(key)) { const a = seen.get(key); seen.set(key, merge(a, r)); if (!a.src.includes(r.src)) seen.get(key).src = a.src + ", " + r.src; } else seen.set(key, { ...r });
  }
  // Reihenfolge: richtiger Band zuerst, dann wie gut Titel/Autor passen, deutsch vor Übersetzung, gedruckt vor E-Book, neuere zuerst
  const qt = qTok(P.base);
  // Titel ist genau das Gesuchte (Rest der Suche = Autor/Band) – „Der Vorleser“ vor „Bernhard Schlink: Der Vorleser – Interpretation“
  const exact = r => { const tt = qTok(String(r.title || "").split(" – ")[0]); if (!tt.length || !qt.length) return 0; const rest = new Set(qTok(r.author + " " + (r.series || ""))); return tt.every(w => qt.includes(w)) && qt.every(w => tt.includes(w) || rest.has(w)) ? 1 : 0; };
  // Lernhilfen/Interpretationen nach hinten – außer man sucht danach
  const AID = /lehrerheft|schülerheft|interpretation|lektürehilfe|lektüreschlüssel|erläuterungen|unterrichtsmaterial|arbeitsheft|lernmittel|abiturwissen|textanalyse|literaturkartei|study guide|lösungen/i;
  const aid = r => !AID.test(P.words) && AID.test(r.title + " " + r.publisher) ? 1 : 0;
  const fit = r => { if (!qt.length) return 0; const t = new Set(qTok(r.title + " " + r.author + " " + (r.series || ""))); return Math.round(qt.filter(w => t.has(w)).length / qt.length * 4) / 4; };
  const volRank = r => !P.vol ? 0 : hitVol(r) === P.vol ? 0 : hitVol(r) ? 2 : 1;
  // deutsch: Sprache „Deutsch“ oder ohne Sprachangabe mit deutscher ISBN (978-3 …); ohne Angabe vor fremdsprachig
  const deRank = r => r.language === "Deutsch" || (!r.language && /^9783/.test(r.isbn || "")) ? 0 : !r.language ? 1 : 2;
  const list = [...seen.values()].map((r, i) => ({ r, i, v: volRank(r), aid: aid(r), x: exact(r), f: fit(r), de: deRank(r) }));
  list.sort((a, b) => (a.v - b.v) || (a.aid - b.aid) || (b.x - a.x) || (b.f - a.f) || (a.de - b.de) || ((a.r.isbn ? 0 : 1) - (b.r.isbn ? 0 : 1)) || ((a.r.ebook || a.r.av ? 1 : 0) - (b.r.ebook || b.r.av ? 1 : 0)) || (+b.r.year || 0) - (+a.r.year || 0) || (a.i - b.i));
  return list.slice(0, 25).map(({ r }) => {
    if (r.isbn) { r.altCovers = [r.coverUrl, ...olCovers(r.isbn)].filter((v, i, a) => v && a.indexOf(v) === i); r.coverUrl = r.altCovers[0]; }
    return r;
  });
}
/* ================= Internetsuche: frei wählbare Suchseiten ================= */
// {q} = Suchbegriff (ISBN, falls vorhanden, sonst Titel + Autor), {title} = Titel + Autor, {isbn} = ISBN
const PROVIDERS = [
  { id: "google", name: "Google", url: "https://www.google.com/search?q={title}+{isbn}+Buch", on: true },
  { id: "zvab", name: "ZVAB", url: "https://www.zvab.com/servlet/SearchResults?kn={title}", on: true },
  { id: "slub", name: "SLUB Dresden", url: "https://katalog.slub-dresden.de/?tx_find_find%5Bq%5D%5Bdefault%5D={q}", on: true },
  { id: "dnb", name: "DNB-Katalog", url: "https://portal.dnb.de/opac/simpleSearch?query={q}", on: true },
  { id: "booklooker", name: "booklooker", url: "https://www.booklooker.de/B%C3%BCcher/Angebote/titel={title}", on: true },
  { id: "thalia", name: "Thalia", url: "https://www.thalia.de/suche?sq={q}", on: false },
  { id: "amazon", name: "Amazon", url: "https://www.amazon.de/s?k={q}&i=stripbooks", on: false },
  { id: "abebooks", name: "AbeBooks", url: "https://www.abebooks.de/servlet/SearchResults?kn={title}", on: false },
  { id: "googlebooks", name: "Google Books", url: "https://www.google.com/search?tbm=bks&q={q}", on: false },
  { id: "googleimg", name: "Google Bilder", url: "https://www.google.com/search?tbm=isch&q={title}+Buch+Cover", on: false },
  { id: "openlibrary", name: "Open Library", url: "https://openlibrary.org/search?q={q}", on: false },
];
function providerConfig() {
  let c = null; try { c = JSON.parse(localStorage.getItem("searchProviders") || "null"); } catch {}
  return c && Array.isArray(c.enabled) ? c : { enabled: PROVIDERS.filter(p => p.on).map(p => p.id), custom: [] };
}
function saveProviderConfig(c) { try { localStorage.setItem("searchProviders", JSON.stringify(c)); } catch {} }
function allProviders() { const c = providerConfig(); return [...PROVIDERS, ...(c.custom || []).map(x => ({ ...x, custom: true }))]; }
function fillTemplate(url, p) {
  const enc = v => encodeURIComponent((v || "").trim()).replace(/%20/g, "+");
  return url.replace(/\{q\}/g, enc(p.isbn || p.title)).replace(/\{title\}/g, enc(p.title)).replace(/\{isbn\}/g, enc(p.isbn))
    .replace(/\{titleOnly\}/g, enc(p.titleOnly)).replace(/\{author\}/g, enc(p.author)).replace(/\+\+|\+$/g, m => m === "++" ? "+" : "");
}
function webSearchLinks(q, isbn, titleOnly, author) {
  const p = { title: (q || "").trim(), isbn: toIsbn13(isbn) || "", titleOnly: titleOnly || q || "", author: author || "" };
  if (!p.title && !p.isbn) return null;
  const box = el("div", { class: "weblinks" });
  const build = () => {
    const c = providerConfig();
    const list = allProviders().filter(x => c.enabled.includes(x.id) && (!x.needsIsbn || p.isbn));
    fillNode(box, el("span", { text: "Im Internet suchen:" }),
      ...list.map(x => el("a", { href: fillTemplate(x.url, p), target: "_blank", rel: "noopener" }, x.name + " ↗")),
      el("a", { href: "#", class: "cfg", title: "Suchseiten auswählen", onclick: e => { e.preventDefault(); providerSettings(); } }, list.length ? "⚙︎ anpassen" : "⚙︎ Suchseiten wählen"));
  };
  build(); box.addEventListener("refresh", build);
  return box;
}
function providerSettings() {
  const box = el("div", { class: "overlay confirm", style: "z-index:72;align-items:center", onclick: e => { if (e.target === box) close(); } });
  const close = () => { box.remove(); document.querySelectorAll(".weblinks").forEach(w => w.dispatchEvent(new Event("refresh"))); };
  const draw = () => {
    const c = providerConfig();
    const rows = allProviders().map(p => {
      const cb = el("input", { type: "checkbox", checked: c.enabled.includes(p.id) || null });
      cb.addEventListener("change", () => { const cc = providerConfig(); cc.enabled = cb.checked ? [...new Set([...cc.enabled, p.id])] : cc.enabled.filter(x => x !== p.id); saveProviderConfig(cc); });
      return el("label", { class: "prow" }, cb, el("span", { text: p.name }),
        p.custom ? el("button", { class: "btn sm ghost danger", type: "button", onclick: e => { e.preventDefault(); const cc = providerConfig(); cc.custom = cc.custom.filter(x => x.id !== p.id); cc.enabled = cc.enabled.filter(x => x !== p.id); saveProviderConfig(cc); draw(); } }, "Entfernen") : null);
    });
    const nName = el("input", { class: "field", placeholder: "Name, z. B. Stadtbibliothek" });
    const nUrl = el("input", { class: "field", placeholder: "https://…suche?q={q}" });
    const add = () => {
      const name = nName.value.trim(), url = nUrl.value.trim();
      if (!name || !/^https?:\/\//.test(url) || !/\{(q|title|isbn)\}/.test(url)) { toast("Bitte Name und eine Adresse mit {q} eintragen."); return; }
      const cc = providerConfig(); const id = "c-" + uid().slice(0, 8);
      cc.custom = [...(cc.custom || []), { id, name, url }]; cc.enabled = [...cc.enabled, id]; saveProviderConfig(cc); draw();
    };
    fillNode(box, el("div", { class: "sheet", style: "max-width:460px;border-radius:16px" },
      el("div", { class: "sheet-h" }, el("h2", { text: "Suchseiten wählen" }), el("button", { class: "x", onclick: close }, "✕")),
      el("div", { class: "sheet-b" },
        el("p", { class: "saved", style: "margin-top:0", text: "Angehakte Seiten erscheinen als Links bei Suche, Prüfen und auf jeder Buchseite. Gesucht wird mit der ISBN, falls vorhanden, sonst mit Titel und Autor." }),
        el("div", { class: "plist" }, ...rows),
        el("div", { class: "sec" }, el("h3", { text: "Eigene Suchseite hinzufügen" }),
          el("p", { class: "saved", style: "margin-top:0", text: "Auf der Seite einmal suchen, die Adresse aus der Adresszeile kopieren und den Suchbegriff durch {q} ersetzen. Möglich sind auch {title} (Titel + Autor) und {isbn}." }),
          el("div", { style: "display:grid;gap:8px" }, nName, nUrl, el("button", { class: "btn", onclick: add }, "＋ Hinzufügen"))),
        el("div", { class: "actions" }, el("span"), el("button", { class: "btn primary", onclick: close }, "Fertig")))));
  };
  draw(); document.body.append(box);
}

/* ================= Barcode ================= */
function zxingReader() {
  const Z = window.ZXing; if (!Z) return null;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  return hints;
}
/* ISBN aus einem gelesenen Barcode: nur EAN-13 mit 978/979 und stimmender Prüfziffer. Ein angehängter Preis-Zusatzcode (2 oder 5 Ziffern)
   wird abgeschnitten. Andere Strichcodes (Lebensmittel, Preis-EAN, ISBN-10 gibt es als Strichcode nicht) → null. */
function isbnFromBarcode(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 15 || d.length === 18) d = d.slice(0, 13);
  return d.length === 13 && /^97[89]/.test(d) && isbn13ok(d) ? d : null;
}
const turnCanvas = c => { const r = document.createElement("canvas"); r.width = c.height; r.height = c.width; const x = r.getContext("2d"); x.translate(r.width / 2, r.height / 2); x.rotate(Math.PI / 2); x.drawImage(c, -c.width / 2, -c.height / 2); return r; };
// Ausschnitte eines Fotos (relativ): ganz, Hälften und überlappende Drittel – kleine Barcodes werden im Ausschnitt größer
const BARCODE_CROPS = [[0, 0, 1, 1], [0, 0, 1, .55], [0, .45, 1, 1], [0, 0, .55, 1], [.45, 0, 1, 1],
  ...[0, 1, 2].flatMap(r => [0, 1].map(k => [k * .45, r * .3, k * .45 + .55, r * .3 + .4]))];
function cropCanvas(img, [x0, y0, x1, y1], max) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const sw = (x1 - x0) * W, sh = (y1 - y0) * H, s = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
  c.getContext("2d").drawImage(img, x0 * W, y0 * H, sw, sh, 0, 0, c.width, c.height);
  return c;
}
async function decodeFromImage(img) {
  if ("BarcodeDetector" in window) {
    try {
      const det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] });
      for (const crop of BARCODE_CROPS) for (const r of await det.detect(crop === BARCODE_CROPS[0] ? img : cropCanvas(img, crop, 2000))) { const i = isbnFromBarcode(r.rawValue); if (i) return i; }
    } catch {}
  }
  const Z = window.ZXing; if (!Z) return null;
  const reader = new Z.MultiFormatReader(); reader.setHints(zxingReader());
  const tryC = c => { try { return isbnFromBarcode(reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(c)))).getText()); } catch { return null; } };
  for (const size of [1400, 900, 2200]) for (const rot of [0, 90]) { const c = toCanvas(img, size); const i = tryC(rot ? turnCanvas(c) : c); if (i) return i; }
  for (const crop of BARCODE_CROPS.slice(1)) for (const rot of [0, 90]) { const c = cropCanvas(img, crop, 1400); const i = tryC(rot ? turnCanvas(c) : c); if (i) return i; }
  return null;
}
/* Kamera öffnen: hohe Auflösung, Dauer-Fokus und Taschenlampe, wo der Browser es kann. → { stream, track, torch(an) | null } */
async function openCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
  const track = stream.getVideoTracks()[0];
  let caps = {}; try { caps = track?.getCapabilities?.() || {}; } catch {}
  if ((caps.focusMode || []).includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
  const torch = caps.torch ? on => track.applyConstraints({ advanced: [{ torch: !!on }] }) : null;
  return { stream, track, torch };
}
function torchButton(cam) {
  if (!cam?.torch) return null;
  let on = false;
  const b = el("button", { class: "btn sm torch", type: "button", title: "Taschenlampe ein/aus" }, "🔦 Licht");
  b.addEventListener("click", async e => { e.stopPropagation(); on = !on; try { await cam.torch(on); b.classList.toggle("on", on); } catch { on = false; toast("Licht lässt sich hier nicht einschalten."); } });
  return b;
}
/* Rahmen dort zeigen, wo der Barcode im Bild gesehen wurde (box in Video-Pixeln; Video mit object-fit: cover) */
function seenMarker(video) {
  const m = el("div", { class: "seen" });
  let t = null;
  m.show = box => {
    const r = video.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
    if (!box || !vw || !vh || !r.width) return;
    const s = Math.max(r.width / vw, r.height / vh), ox = (r.width - vw * s) / 2, oy = (r.height - vh * s) / 2;
    Object.assign(m.style, { left: ox + box.x * s + "px", top: oy + box.y * s + "px", width: Math.max(24, box.width * s) + "px", height: Math.max(24, box.height * s) + "px" });
    m.classList.add("on"); clearTimeout(t); t = setTimeout(() => m.classList.remove("on"), 700);
  };
  return m;
}
/* Live-Scanner mit der Kamera. Liefert ISBN oder null (abgebrochen). */
function liveScan() {
  return new Promise(async resolve => {
    if (!navigator.mediaDevices?.getUserMedia) { toast("Live-Kamera ist hier nicht verfügbar – nimm ein Foto."); return resolve(undefined); }
    const video = el("video", { playsinline: true, muted: true, autoplay: true }); video.muted = true;
    const info = el("p", { text: "Halte den Barcode auf der Rückseite in den Rahmen." });
    const seen = seenMarker(video), tools = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });
    let cam = null, stopped = false, stopLoop = () => {};
    const finish = v => {
      if (stopped) return; stopped = true; stopLoop();
      cam && cam.stream.getTracks().forEach(t => t.stop());
      ov.remove(); resolve(v);
    };
    const ov = el("div", { class: "scan" }, video, el("div", { class: "frame" }), seen,
      el("div", { class: "bottom" }, info, tools));
    const drawTools = () => fillNode(tools, torchButton(cam),
      el("button", { class: "btn", onclick: () => finish(null) }, "Abbrechen"),
      el("button", { class: "btn", onclick: () => finish("photo") }, "Lieber ein Foto"));
    drawTools();
    document.body.append(ov);
    try { cam = await openCamera(); }
    catch (e) { ov.remove(); toast(e.name === "NotAllowedError" ? "Kamera-Zugriff wurde nicht erlaubt." : "Kamera nicht verfügbar – nimm ein Foto."); return resolve(undefined); }
    if (stopped) { cam.stream.getTracks().forEach(t => t.stop()); return; }
    drawTools();
    video.srcObject = cam.stream; await video.play().catch(() => {});
    const hit = isbn => { if (navigator.vibrate) navigator.vibrate(80); finish(isbn); };
    const stop = await barcodeLoop(video, hit, t => { info.textContent = t; }, seen.show);
    if (stopped) stop(); else stopLoop = stop;
  });
}
/* Liest laufend Barcodes aus dem Video (BarcodeDetector, sonst ZXing) – für „Barcode scannen“ und den Stapel-Modus.
   onIsbn bekommt die ISBN-13, onInfo Hinweise, onSeen(box) die Lage im Video (Pixel). Gibt eine Funktion zum Anhalten zurück.
   ZXing: abwechselnd mittlerer Streifen, ganzes Bild und gedreht (Barcode hochkant); ein Wert zählt erst, wenn er zweimal gelesen wurde. */
async function barcodeLoop(video, onIsbn, onInfo = () => {}, onSeen = () => {}) {
  let timer = null, stopped = false;
  const stop = () => { stopped = true; clearInterval(timer); };
  const other = raw => onInfo("Das ist kein ISBN-Barcode (" + raw + ") – ein Buch hat ihn meist auf der Rückseite, Nummer beginnt mit 978 oder 979.");
  let det = null;
  if ("BarcodeDetector" in window) { try { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes("ean_13")) det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] }); } catch {} }
  if (det) {
    timer = setInterval(async () => {
      if (stopped || video.readyState < 2) return;
      try {
        for (const r of await det.detect(video)) {
          if (r.boundingBox) onSeen(r.boundingBox);
          const i = isbnFromBarcode(r.rawValue); if (i) { if (!stopped) onIsbn(i); return; }
          other(r.rawValue);
        }
      } catch {}
    }, 180);
  } else if (window.ZXing) {
    const Z = window.ZXing; const reader = new Z.MultiFormatReader(); reader.setHints(zxingReader());
    const c = document.createElement("canvas"); const ctx = c.getContext("2d", { willReadFrequently: true });
    let mode = 0, last = null, lastAt = 0;
    timer = setInterval(() => {
      if (stopped || video.readyState < 2) return;
      const w = video.videoWidth, h = video.videoHeight; mode = (mode + 1) % 3;
      const strip = mode === 0, sh = strip ? Math.round(h * .45) : h, y0 = Math.round((h - sh) / 2);
      c.width = Math.min(1280, w); c.height = Math.round(sh * c.width / w);
      ctx.drawImage(video, 0, y0, w, sh, 0, 0, c.width, c.height);
      const s = c.width / w;
      try {
        const res = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(mode === 2 ? turnCanvas(c) : c))));
        const raw = res.getText(), i = isbnFromBarcode(raw);
        if (mode !== 2) { const pts = res.getResultPoints() || []; if (pts.length) { const xs = pts.map(p => p.getX() / s), ys = pts.map(p => p.getY() / s + y0); const x = Math.min(...xs), y = Math.min(...ys); onSeen({ x: x - 10, y: y - 30, width: Math.max(...xs) - x + 20, height: Math.max(...ys) - y + 60 }); } }
        if (!i) { other(raw); return; }
        const now = Date.now();
        if (i === last && now - lastAt < 2500) { if (!stopped) onIsbn(i); }
        else onInfo("Barcode gesehen – kurz ruhig halten …");
        last = i; lastAt = now;
      } catch {}
    }, 200);
  } else onInfo("Barcode-Erkennung lädt nicht – bitte Foto verwenden.");
  return stop;
}


/* ================= Diktieren (Web Speech API) ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function micButton(textarea, onChange) {
  if (!SR) return null;
  const b = el("button", { class: "btn sm mic", type: "button", title: "Notiz diktieren" }, "🎙 Diktieren");
  let rec = null;
  b.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = "de-DE"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) {
        const t = e.results[i][0].transcript.trim(); if (!t) continue;
        const sep = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
        textarea.value += sep + t; onChange(textarea.value);
      }
    };
    rec.onend = () => { rec = null; b.classList.remove("live"); b.textContent = "🎙 Diktieren"; };
    rec.onerror = e => { if (e.error === "not-allowed") toast("Mikrofon wurde nicht erlaubt."); };
    try { rec.start(); b.classList.add("live"); b.textContent = "⏹ Stopp"; } catch { rec = null; }
  });
  return b;
}


/* ================= Schlagworte ================= */
function allTags(list = S.books) {
  const m = new Map();
  for (const b of list) for (const t of b.tags || []) { const k = t.toLowerCase(); const e = m.get(k) || { name: t, n: 0 }; e.n++; m.set(k, e); }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
}
function normTags(input) {
  const known = allTags();
  const out = [];
  for (let p of (Array.isArray(input) ? input : String(input || "").split(/[,;]/))) {
    p = String(p).trim().replace(/\s+/g, " "); if (!p) continue;
    const ex = known.find(t => t.name.toLowerCase() === p.toLowerCase()); if (ex) p = ex.name;
    if (!out.some(t => t.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out;
}
const hasTag = (b, t) => (b.tags || []).some(x => x.toLowerCase() === String(t).toLowerCase());
function tagDatalist() {
  let dl = document.getElementById("taglist");
  if (!dl) { dl = el("datalist", { id: "taglist" }); document.body.append(dl); }
  fillNode(dl, ...allTags().map(t => el("option", { value: t.name })));
}
function tagEditor(book, onChange) {
  tagDatalist();
  const wrap = el("div", { class: "tagedit" });
  const inp = el("input", { class: "taginput", placeholder: "Schlagwort eingeben + Enter", list: "taglist", autocomplete: "off" });
  const changed = () => { onChange({ tags: book.tags }); wrap.dispatchEvent(new Event("input", { bubbles: true })); };
  const draw = () => fillNode(wrap, ...(book.tags || []).map((t, i) => el("span", { class: "tag" }, t,
    el("button", { type: "button", title: "Entfernen", onclick: () => { book.tags = book.tags.filter((_, j) => j !== i); changed(); draw(); } }, "×"))), inp);
  const add = (v, refocus) => { const n = normTags([...(book.tags || []), ...String(v).split(/[,;]/)]); inp.value = ""; if (n.length !== (book.tags || []).length) { book.tags = n; changed(); } draw(); if (refocus) inp.focus(); };
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); if (inp.value.trim()) add(inp.value, true); }
    else if (e.key === "Backspace" && !inp.value && (book.tags || []).length) { book.tags = book.tags.slice(0, -1); changed(); draw(); inp.focus(); }
  });
  inp.addEventListener("change", () => { if (inp.value.trim() && allTags().some(t => t.name === inp.value)) add(inp.value, true); });
  inp.addEventListener("blur", () => { if (inp.value.trim()) add(inp.value, false); });
  wrap.addEventListener("click", e => { if (e.target === wrap) inp.focus(); });
  draw();
  return wrap;
}
function tagChips(b, onPick) {
  if (!(b.tags || []).length) return null;
  return el("div", { class: "tagrow" }, ...b.tags.map(t => el("button", { class: "tag link", title: `Alle Bücher mit „${t}“ zeigen`, onclick: () => onPick(t) }, "# " + t)));
}
function tagFilterSelect(cur, onPick, list) {
  const tags = allTags(list);
  const sel = el("select", { class: "field", "aria-label": "Schlagwort" },
    el("option", { value: "" }, tags.length ? "Alle Schlagworte" : "Keine Schlagworte"),
    ...tags.map(t => el("option", { value: t.name, selected: cur && cur.toLowerCase() === t.name.toLowerCase() || null }, `# ${t.name} (${t.n})`)));
  sel.addEventListener("change", () => onPick(sel.value));
  if (!tags.length) sel.disabled = true;
  return sel;
}


/* ================= Reihen ================= */
function allSeries(list = S.books) {
  const m = new Map();
  for (const b of list) { const s = String(b.series || "").trim(); if (!s) continue; const k = s.toLowerCase(); const e = m.get(k) || { name: s, n: 0 }; e.n++; m.set(k, e); }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
}
const inSeries = (b, s) => String(b.series || "").trim().toLowerCase() === String(s).trim().toLowerCase();
const seriesNum = b => { const n = parseFloat(String(b.seriesNo || "").replace(",", ".")); return isFinite(n) ? n : 1e9; };
function seriesText(b) { return b.series ? b.series + (b.seriesNo ? " · Band " + b.seriesNo : "") : ""; }
function seriesDatalist() {
  let dl = document.getElementById("serieslist");
  if (!dl) { dl = el("datalist", { id: "serieslist" }); document.body.append(dl); }
  fillNode(dl, ...allSeries().map(t => el("option", { value: t.name })));
}
function seriesFilterSelect(cur, onPick, list) {
  const ser = allSeries(list);
  if (!ser.length) return null;
  const sel = el("select", { class: "field", "aria-label": "Reihe" },
    el("option", { value: "" }, "Alle Reihen"),
    ...ser.map(t => el("option", { value: t.name, selected: cur && cur.toLowerCase() === t.name.toLowerCase() || null }, `📚 ${t.name} (${t.n})`)));
  sel.addEventListener("change", () => onPick(sel.value));
  return sel;
}
const bySeries = (a, b) => String(a.series || "~").localeCompare(String(b.series || "~"), "de", { sensitivity: "base" }) || seriesNum(a) - seriesNum(b) || (a.title || "").localeCompare(b.title || "", "de");

/* ================= Wunschliste (getrennt vom Bestand) ================= */
const isWish = b => !!(b && b.wish);
const inStock = b => !isWish(b) && !isGone(b);
S.badCover = new Set(); // Bücher, deren Cover-Adresse kein Bild liefert (Pseudo-Cover) – gelten als „ohne Cover“
const needsCover = b => inStock(b) && !b.coverBlob && (!b.coverUrl || S.badCover.has(b.id));
function dupText(d) { return isWish(d) ? `„${d.title}“ steht auf deiner Wunschliste.` : `„${d.title}“ steht schon in deinem Regal.`; }
async function wishBought(id) {
  await patchBook(id, { wish: false, addedAt: new Date().toISOString() });
  toast("In den Bestand übernommen – jetzt ggf. ins echte Regal einräumen.", 3500);
}

/* ================= Darstellung: Regal ================= */
// Nur die sichtbare Ansicht zeichnen – beim Wechsel (hashchange → renderAll) wird die neue frisch gezeichnet.
// Spart bei großen Sammlungen viel Zeit, weil sonst jede Änderung auch die ganze Tabelle neu aufbaut.
function renderAll() {
  if (openSheet?.redraw) openSheet.redraw(); // offene Übersicht (z. B. Fach-Fotos) nach Abgleich/Import aktualisieren
  renderNav();
  const v = view();
  if (v === "verwaltung") renderTable(); else if (v === "wand") renderWall(); else if (v === "wunsch") renderWish(); else if (v === "mehr") renderMore(); else renderShelf();
}
const VIEWS = ["regal", "wand", "wunsch", "mehr", "verwaltung"];
function view() { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : "regal"; }
function renderNav() {
  const v = view();
  document.querySelectorAll("nav a").forEach(a => {
    const on = a.dataset.view === v || (a.dataset.also || "").split(" ").includes(v);
    a.classList.toggle("on", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  for (const k of VIEWS) $("#v-" + k).classList.toggle("hidden", v !== k);
  document.body.classList.toggle("wandbig", v === "wand" && !!S.wallBig);
}
function counts(list = S.books) { const c = { all: list.length, unread: 0, reading: 0, read: 0 }; for (const b of list) c[b.status || "unread"]++; return c; }
function renderFilters(host, cur, onPick, extra, list) {
  const c = counts(list);
  const items = [["all", "Alle", null], ["unread", "Ungelesen", "var(--s-unread)"], ["reading", "Gerade dabei", "var(--s-reading)"], ["read", "Gelesen", "var(--s-read)"], ...(extra || [])];
  host.replaceChildren(...items.map(([k, l, col, n]) => el("button", { class: "chip" + (cur === k ? " on" : ""), onclick: () => onPick(k) },
    col ? el("span", { class: "dot", style: `background:${col}` }) : null, l, el("span", { class: "n", text: n ?? c[k] ?? 0 }))));
}
function renderShelf() {
  const owned = S.books.filter(inStock);
  const serSlot = $("#seriesSlot"); if (serSlot) fillNode(serSlot, seriesFilterSelect(S.series, v => { S.series = v; renderShelf(); }, owned));
  if (S.series && !allSeries(owned).some(t => t.name.toLowerCase() === S.series.toLowerCase())) S.series = "";
  renderFilters($("#filters"), S.filter, k => { S.filter = k; renderShelf(); }, null, owned);
  const nFav = owned.filter(b => b.favorite).length;
  $("#filters").append(el("button", { class: "chip fav" + (S.favOnly ? " on" : ""), title: "Nur Lieblingsbücher (zusätzlich zum Status-Filter)", onclick: () => { S.favOnly = !S.favOnly; renderShelf(); } }, "♥ Lieblingsbücher", el("span", { class: "n", text: nFav })));
  const host = $("#shelf");
  host.classList.toggle("list", S.layout === "list");
  document.querySelectorAll(".layoutsw [data-layout]").forEach(x => { const on = x.dataset.layout === (S.layout || "grid"); x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
  if (!S.loaded) { host.replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" }, el("div", { class: "spin", style: "margin:0 auto" }))); return; }
  const tagSlot = $("#tagSlot"); if (tagSlot) fillNode(tagSlot, tagFilterSelect(S.tag, t => { S.tag = t; renderShelf(); }, S.books));
  if (S.tag && !allTags().some(t => t.name.toLowerCase() === S.tag.toLowerCase())) S.tag = "";
  // Filter-Knopf (Handy): Zahl der aktiven Zusatzfilter
  const nExtra = (S.tag ? 1 : 0) + (S.series ? 1 : 0);
  $("#fcount").textContent = nExtra || ""; $("#filterBtn").classList.toggle("on", !!nExtra);
  const list = owned.filter(b => (S.filter === "all" || (b.status || "unread") === S.filter) && (!S.favOnly || b.favorite) && (!S.tag || hasTag(b, S.tag)) && (!S.series || inSeries(b, S.series)) && matchQ(b, S.q));
  const goneList = S.books.filter(b => isGone(b) && matchQ(b, S.q) && (!S.favOnly || b.favorite) && (!S.tag || hasTag(b, S.tag))).sort((a, b) => (b.gone.date || "").localeCompare(a.gone.date || ""));
  const cmp = {
    "added-desc": (a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""),
    "added-asc": (a, b) => (a.addedAt || "").localeCompare(b.addedAt || ""),
    "title": (a, b) => (a.title || "").localeCompare(b.title || "", "de", { sensitivity: "base" }),
    "author": (a, b) => lastName(a.author).localeCompare(lastName(b.author), "de") || (a.title || "").localeCompare(b.title || "", "de"),
    "series": bySeries,
  }[S.sort];
  list.sort(S.series ? bySeries : cmp);
  const plain = !S.q && S.filter === "all" && !S.favOnly && !S.tag && !S.series;
  const goneSec = goneList.length ? el("div", { class: "gonesec", style: "grid-column:1/-1" },
    el("button", { class: "gonehead", onclick: () => { S.hideGone = !S.hideGone; try { localStorage.setItem("hideGone", S.hideGone ? "1" : ""); } catch {} renderShelf(); } },
      el("span", { text: (S.hideGone ? "▸ " : "▾ ") + "📦 Hatte ich mal" }), el("span", { class: "n", text: goneList.length })),
    S.hideGone ? null : el("div", { class: "grid gonegrid" }, ...goneList.map(b => el("button", { class: "card gone", onclick: () => openDetail(b.id) },
      coverEl(b), el("div", { class: "ti", text: b.title || "Ohne Titel" }), el("div", { class: "au", text: b.author || "—" }), el("div", { class: "gt", text: goneText(b.gone) }))))) : null;
  // Hinweis „ohne Cover“: einzeilig; „Später“ gilt, bis neue Bücher ohne Cover dazukommen
  const noCov = S.books.filter(needsCover).length;
  let covSeen = 0; try { covSeen = +localStorage.getItem("covNoteSeen") || 0; } catch {}
  const covNote = noCov && plain && !S.hideCovNote && noCov > covSeen ? el("div", { class: "hint", style: "grid-column:1/-1" },
    el("span", { class: "grow", text: `${noCov} ${noCov === 1 ? "Buch" : "Bücher"} ohne Cover` }),
    el("button", { class: "btn sm primary", onclick: () => coverRun() }, "🖼 Cover nachtragen"),
    el("button", { class: "btn sm ghost", onclick: () => { S.hideCovNote = true; try { localStorage.setItem("covNoteSeen", String(noCov)); } catch {} renderShelf(); } }, "Später")) : null;
  // Gerade dabei: aktuelle Bücher oben, mit „Ausgelesen“ in einem Tipp
  const reading = plain ? owned.filter(b => b.status === "reading").sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")) : [];
  const nowSec = reading.length ? el("section", { class: "nowreading", style: "grid-column:1/-1", "aria-label": "Gerade dabei" },
    el("h2", { text: "Gerade dabei" }),
    el("div", { class: "nrrow" }, ...reading.map(b => {
      const open = [...readsOf(b)].reverse().find(r => r.start && !r.end);
      return el("div", { class: "nrcard" },
        el("button", { class: "nrmain", onclick: () => openDetail(b.id) }, coverEl(b),
          el("span", { class: "nrtxt" }, el("b", { text: b.title || "Ohne Titel" }), el("span", { text: b.author || "" }), open ? el("small", { text: "seit " + fmtD(open.start) }) : null)),
        el("button", { class: "btn sm nrdone", title: "Als gelesen markieren", onclick: async () => {
          const before = { status: b.status, reads: b.reads };
          await patchBook(b.id, statusPatch(b, "read"));
          toastAction(`„${b.title || "Ohne Titel"}“ ist gelesen.`, "Rückgängig", () => patchBook(b.id, before));
        } }, "✓ Ausgelesen"));
    }))) : null;
  const wishHits = S.q ? S.books.filter(b => isWish(b) && matchQ(b, S.q)).length : 0;
  const wishNote = wishHits ? el("div", { class: "saved", style: "grid-column:1/-1" }, `Auch auf deiner Wunschliste: ${wishHits} Treffer – `, el("a", { href: "#wunsch", onclick: () => { S.wishQ = S.q; } }, "anzeigen")) : null;
  if (!list.length && goneSec && S.books.some(b => !isGone(b)) === false) { host.replaceChildren(goneSec); return; }
  if (!list.length) {
    host.replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" },
      S.books.length ? el("div", {}, el("h2", { text: "Nichts gefunden" }), el("p", { text: "Kein Buch passt zu Filter oder Suche." }),
        !plain ? el("button", { class: "btn", onclick: () => { S.q = ""; $("#q").value = ""; S.filter = "all"; S.favOnly = false; S.tag = ""; S.series = ""; renderShelf(); } }, "Filter zurücksetzen") : null)
        : el("div", {}, el("div", { class: "emptyart", "aria-hidden": "true", text: "📚" }), el("h2", { text: "Dein Regal ist noch leer" }), el("p", { text: "Scanne den Barcode eines Buches, fotografiere das Cover oder suche nach Titel." }),
          el("button", { class: "btn primary", onclick: openAdd }, "＋ Erstes Buch hinzufügen"),
          el("p", { style: "margin-top:18px;font-size:13px" }, "Du hast schon Bücher auf einem anderen Gerät? ", el("a", { href: "#", onclick: e => { e.preventDefault(); importFlow(); } }, "Sicherung importieren")))), wishNote || "", goneSec || "");
    return;
  }
  // Liste: Standort einmal für alle nachschlagen (statt je Buch durch alle Fächer)
  const locs = new Map();
  if (S.layout === "list") for (const f of allFachs()) f.list.forEach((id, i) => { if (!locs.has(id)) locs.set(id, { ...f, pos: i }); });
  const nReads = b => readsOf(b).filter(r => r.end).length;
  fillNode(host, covNote, nowSec, ...list.map(b => el("button", { class: "card", onclick: () => openDetail(b.id) },
    coverEl(b, { badge: true }), el("div", { class: "ti", text: b.title || "Ohne Titel" }), el("div", { class: "au", text: b.author || "—" }),
    b.series && (S.series || S.sort === "series" || S.layout === "list") ? el("div", { class: "st", style: "color:var(--muted);letter-spacing:0", text: seriesText(b) }) : null,
    b.rating ? el("div", { class: "st", text: "★".repeat(b.rating) + (nReads(b) > 1 ? "  ·  " + readsSummary(b) : "") }) : (nReads(b) > 1 ? el("div", { class: "st", style: "color:var(--muted);letter-spacing:0", text: readsSummary(b) }) : null),
    S.layout === "list" ? el("div", { class: "lo" }, el("span", { class: "dot", style: `background:${STATUS_COLOR[b.status || "unread"]}` }), { unread: "Ungelesen", reading: "Gerade dabei", read: "Gelesen" }[b.status || "unread"],
      locs.get(b.id) ? " · " + locationShort(locs.get(b.id)) : "") : null)), wishNote, goneSec);
}
try { S.hideGone = !!localStorage.getItem("hideGone"); } catch {}

/* ================= Ansicht: Wunschliste ================= */
function renderWish() {
  const host = $("#v-wunsch"); if (!host || host.classList.contains("hidden")) return;
  const q = el("input", { class: "field search", type: "search", placeholder: "In der Wunschliste suchen …", value: S.wishQ || "", "aria-label": "Wunschliste durchsuchen" });
  const sort = el("select", { class: "field", "aria-label": "Sortierung" }, ...[["added-desc", "Zuletzt hinzugefügt"], ["title", "Titel A–Z"], ["author", "Autor A–Z"], ["series", "Reihe & Band"], ["price", "Preis aufsteigend"]].map(([v, l]) => el("option", { value: v, selected: (S.wishSort || "added-desc") === v || null }, l)));
  const grid = el("div", { class: "grid" });
  const sumEl = el("span", { class: "saved" });
  const draw = () => {
    const all = S.books.filter(isWish);
    const list = all.filter(b => matchQ(b, S.wishQ || ""));
    const cmp = { "added-desc": (a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""), "title": (a, b) => (a.title || "").localeCompare(b.title || "", "de"), "author": (a, b) => lastName(a.author).localeCompare(lastName(b.author), "de"), "series": bySeries, "price": (a, b) => (priceNum(a.price) ?? 1e9) - (priceNum(b.price) ?? 1e9) }[S.wishSort || "added-desc"];
    list.sort(cmp);
    const sum = all.reduce((a, b) => a + (priceNum(b.price) || 0), 0);
    sumEl.textContent = all.length ? `${all.length} ${all.length === 1 ? "Wunsch" : "Wünsche"}${sum ? " · zusammen ca. " + fmtPrice(sum) : ""}` : "";
    if (!list.length) { fillNode(grid, el("div", { class: "empty", style: "grid-column:1/-1" }, all.length ? el("h2", { text: "Nichts gefunden" }) : el("div", {}, el("h2", { text: "Deine Wunschliste ist leer" }), el("p", { text: "Bücher, die du (noch) nicht besitzt, aber haben möchtest. Sie zählen nicht zu deinem Bestand." }), el("button", { class: "btn primary", onclick: () => openAdd(true) }, "＋ Ersten Wunsch hinzufügen")))); return; }
    fillNode(grid, ...list.map(b => el("button", { class: "card wish", onclick: () => openDetail(b.id) },
      coverEl(b), el("div", { class: "ti", text: b.title || "Ohne Titel" }), el("div", { class: "au", text: b.author || "—" }),
      (b.price || b.series) ? el("div", { class: "st", style: "color:var(--muted);letter-spacing:0", text: [b.price ? fmtPrice(b.price) : "", seriesText(b)].filter(Boolean).join(" · ") }) : null)));
  };
  q.addEventListener("input", () => { S.wishQ = q.value; draw(); });
  sort.addEventListener("change", () => { S.wishSort = sort.value; draw(); });
  fillNode(host,
    el("div", { class: "vhead" }, el("h2", { text: "Wunschliste" }), sumEl),
    el("div", { class: "tools libtools wishtools" },
      el("div", { class: "searchrow" }, el("label", { class: "searchbox" }, icon("search"), q)),
      el("div", { class: "fpanel wishpanel" }, sort, el("button", { class: "btn primary", onclick: () => openAdd(true) }, "＋ Wunsch hinzufügen"))),
    el("p", { class: "saved vnote", text: "Wünsche zählen nicht zu deinem Bestand. Gekauft? Buch öffnen → „✓ Gekauft“." }),
    grid);
  draw();
}
/* ================= Ansicht: Mehr ================= */
/* Alles, was nicht täglich gebraucht wird, an genau einer Stelle – in Gruppen. Funktionen aus den Zusatzdateien werden erst beim Antippen
   aufgerufen (die Seite kann schon vor dem Laden aller Skripte gezeichnet werden). */
const call = (name, ...a) => () => { const f = globalThis[name]; if (typeof f === "function") f(...a); };
function renderMore() {
  const host = $("#v-mehr"); if (!host || host.classList.contains("hidden")) return;
  const owned = S.books.filter(inStock), c = counts(owned);
  const nPhotos = openPhotos().length, nStack = (S.stack || []).length;
  const nCover = S.books.filter(needsCover).length;
  const nDup = S.loaded ? dupGroups().reduce((n, g) => n + g.length, 0) : 0;
  const row = (id, ico, label, sub, fn, n, warn) => el("button", { class: "mrow", id, onclick: fn },
    el("span", { class: "mico", "aria-hidden": "true", text: ico }),
    el("span", { class: "mtxt" }, el("b", { text: label }), sub ? el("small", { text: sub }) : null),
    n ? el("span", { class: "mcount" + (warn ? " warn" : ""), text: n }) : null,
    icon("chevron"));
  const group = (title, ...rows) => el("section", { class: "mgroup" }, el("h3", { text: title }), el("div", { class: "mlist" }, ...rows));
  const stat = (n, l) => el("span", {}, el("b", { text: n }), l);
  fillNode(host,
    el("div", { class: "mhead" }, el("h2", { text: "Mehr" }),
      el("div", { class: "mstats" }, stat(c.all, "im Bestand"), stat(c.read, "gelesen"), stat(c.reading, "gerade dabei"), stat(S.books.filter(isWish).length, "Wünsche"))),
    el("div", { class: "mgrid" },
      group("Viele Bücher erfassen",
        row("stackRun", "📚", "Stapel erfassen", nStack ? `${nStack} im Stapel – weiter erfassen oder prüfen` : "Kamera bleibt offen, ein Buch nach dem anderen", call("openStackCapture"), nStack),
        row("shelfScanRun", "📷", "Fach-Foto einlesen", "Ein ganzes Regalfach fotografieren", call("openShelfScan")),
        row("photoInboxRun", "📥", "Gespeicherte Fach-Fotos", nPhotos ? `${nPhotos} noch nicht übernommen` : "Später erkennen und einsortieren", call("openPhotoInbox"), nPhotos),
        row("titleListRun", "📋", "Titelliste einfügen", S.titleRun ? "Angefangene Liste weiter prüfen" : "Aus Excel, einer Notiz oder Mail", S.titleRun ? call("resumeTitleList") : call("openTitleList"))),
      group("Bestand pflegen",
        row("tableRun", "▦", "Tabelle", "Alle Bücher als Liste bearbeiten, filtern, auswählen", () => { location.hash = "#verwaltung"; }),
        row("coverRun", "🖼", "Fehlende Cover nachtragen", nCover ? `${nCover} ${nCover === 1 ? "Buch" : "Bücher"} ohne Cover` : "Alle Bücher haben ein Cover", call("coverRun"), nCover),
        row("dupRun", "🧩", "Dubletten prüfen", nDup ? `${nDup} Bücher sehen doppelt aus` : "Keine möglichen Dubletten", call("openDuplicates"), nDup, true),
        row("heightRun", "📏", "Buchhöhen nachtragen", "Aus der Deutschen Nationalbibliothek, für das echte Regal", () => heightRun())),
      group("Daten & Sicherung",
        row("exportRun", "⬆", "Sicherung exportieren", "Als Datei speichern oder an den PC senden", exportFlow),
        row("importRun", "⬇", "Sicherung importieren", "Datei von einem anderen Gerät übernehmen und abgleichen", importFlow),
        row("autoBackupRun", "💾", "Automatische Sicherung", "Regelmäßig in einen Ordner auf diesem Gerät", call("openAutoBackup")),
        row("syncRun", "🔄", "Abgleich mit eigenem Server", "Handy und PC über deinen CouchDB-Server", call("openSyncSettings")),
        row("exportCsv", "📊", "Als CSV für Excel exportieren", "", exportCsv)),
      group("Einstellungen & Hilfe",
        row("aboutRun", "⚙️", "Einstellungen & Über die App", "Schlüssel für Google und KI, Hinweise zu deinen Daten", aboutBox),
        row("providerRun", "🔗", "Suchseiten wählen", "ZVAB, SLUB, booklooker …", providerSettings),
        row("recLogRun", "🧾", "Erkennungsprotokoll", "Was die Erkennung zuletzt gemacht hat", call("openRecLog")))),
    el("p", { class: "mfoot", text: "Deine Bücher liegen nur in diesem Browser auf diesem Gerät. Abgleich zwischen Geräten: hier exportieren, dort importieren – neuere Änderungen gewinnen." }));
}

document.addEventListener("click", e => { document.querySelectorAll("details.wmenu[open]").forEach(d => { if (!d.contains(e.target) || e.target.closest(".wmenu-list button")) d.open = false; }); });

/* Tastenkürzel am PC: / = suchen, N = Buch hinzufügen */
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey || openSheet || $(".scan") || $(".confirm")) return;
  const t = e.target; if (t.closest && t.closest("input,textarea,select,[contenteditable]")) return;
  if (e.key === "/") { e.preventDefault(); if (view() !== "regal") location.hash = "#regal"; setTimeout(() => $("#q").focus(), 0); }
  else if (e.key === "n" || e.key === "N") { e.preventDefault(); openAdd(view() === "wunsch"); }
});

$("#q").addEventListener("input", e => { S.q = e.target.value; renderShelf(); });
$("#filterBtn").addEventListener("click", () => { const p = $("#fpanel"), open = !p.classList.contains("open"); p.classList.toggle("open", open); $("#filterBtn").setAttribute("aria-expanded", open); });
try { S.layout = localStorage.getItem("libLayout") || "grid"; } catch { S.layout = "grid"; }
document.querySelectorAll(".layoutsw [data-layout]").forEach(x => x.addEventListener("click", () => { S.layout = x.dataset.layout; try { localStorage.setItem("libLayout", S.layout); } catch {} renderShelf(); }));
try { const s = localStorage.getItem("shelfSort"); if (s) { S.sort = s; $("#sort").value = s; } } catch {}
$("#sort").addEventListener("change", e => { S.sort = e.target.value; try { localStorage.setItem("shelfSort", S.sort); } catch {} renderShelf(); });
window.addEventListener("hashchange", renderAll);
document.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => openAdd(view() === "wunsch")));

/* ================= Dialoge ================= */
/* Blätter (Dialoge) – nichts geht still verloren:
   - Am Handy schließt nur ✕ (kein versehentliches Tippen auf den Hintergrund); am PC schließt der Hintergrund, bei Änderungen mit Nachfrage (guard).
   - Ein Blatt mit guard (ungespeicherte Änderungen) wird nie still ersetzt: es bleibt versteckt erhalten und kommt zurück,
     wenn das neue Blatt geschlossen wird.
   - Android-Zurück-Taste: Beim Öffnen gibt es einen History-Eintrag; Zurück schließt das Blatt (mit Nachfrage) statt die App zu verlassen.
     Programmatisches Schließen lässt den Eintrag stehen (history.back() würde mit Ansichtswechseln über location.hash kollidieren);
     das nächste Blatt verwendet ihn wieder. */
let openSheet = null;
const sheetStack = [];
function sheetHistPush() { try { history.pushState({ ...(history.state || {}), sheet: true }, ""); } catch {} }
function sheet(title, { onClose } = {}) {
  if (openSheet?.guard) { const prev = openSheet; prev.paste = S.pasteHandler; prev.ov.style.display = "none"; sheetStack.push(prev); openSheet = null; sheetHistPush(); }
  else closeSheet();
  const body = el("div", { class: "sheet-b" });
  const h2 = el("h2", { text: title });
  const head = el("div", { class: "sheet-h" }, h2, el("button", { class: "x", "aria-label": "Schließen", onclick: requestClose }, "✕"));
  const sh = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, head, body);
  const ov = el("div", { class: "overlay", onclick: e => { if (e.target === ov && !isMobile()) requestClose(); } }, sh);
  document.body.append(ov); document.body.style.overflow = "hidden";
  openSheet = { ov, body, h2, onClose };
  if (!history.state?.sheet) sheetHistPush();
  return openSheet;
}
async function requestClose() { if (!openSheet) return; const s = openSheet; if (s.guard && !(await s.guard())) return; if (openSheet === s) closeSheet(); }
function closeSheet() {
  if (!openSheet) return; const s = openSheet; openSheet = null; s.onClose && s.onClose(); s.ov.remove(); S.pasteHandler = null;
  const prev = sheetStack.pop();
  if (prev) { prev.ov.style.display = ""; openSheet = prev; S.pasteHandler = prev.paste || null; return; }
  document.body.style.overflow = "";
}
// Zurück-Taste (Android) bzw. Browser-Zurück: offenes Blatt schließen – bei Änderungen erst fragen
window.addEventListener("popstate", async () => {
  if (!openSheet || document.querySelector(".scan")) return;
  const s = openSheet;
  if (s.guard && !(await s.guard())) { if (openSheet === s && !history.state?.sheet) sheetHistPush(); return; }
  if (openSheet === s) closeSheet();
  if (openSheet && !history.state?.sheet) sheetHistPush(); // darunter liegt noch ein Blatt
});
document.addEventListener("keydown", e => { if (e.key === "Escape") { if ($(".lightbox")) $(".lightbox").remove(); else if ($(".confirm")) $(".confirm").remove(); else if (!$(".scan")) requestClose(); } else if (openSheet?.onKey) openSheet.onKey(e); });
function confirmBox(text, okLabel = "Löschen") {
  return new Promise(res => {
    const done = v => { box.remove(); res(v); };
    const box = el("div", { class: "overlay confirm", style: "z-index:70;align-items:center", onclick: e => { if (e.target === box) done(false); } },
      el("div", { class: "sheet", style: "max-width:420px;border-radius:16px" }, el("div", { class: "sheet-b" },
        el("p", { style: "margin:0 0 16px;font-size:15px;white-space:pre-line", text }),
        el("div", { style: "display:flex;gap:8px;justify-content:flex-end" },
          el("button", { class: "btn", onclick: () => done(false) }, "Abbrechen"),
          el("button", { class: "btn primary", onclick: () => done(true) }, okLabel)))));
    document.body.append(box);
  });
}
function lightbox(src) { document.body.append(el("div", { class: "lightbox", onclick: e => e.currentTarget.remove() }, el("img", { src }))); }

/* ================= Bild wählen: Kamera / Datei / Ziehen / Einfügen ================= */
function pickFile(inputSel) {
  return new Promise(res => {
    const inp = $(inputSel); inp.value = "";
    const on = () => { inp.removeEventListener("change", on); res(inp.files[0] || null); };
    inp.addEventListener("change", on); inp.click();
  });
}
const pickImage = camera => pickFile(camera ? "#fileCam" : "#filePick");
/* ---------- Bilder aus Zwischenablage / Drag & Drop übernehmen ----------
   Versteht: echte Bilddaten, eingebettete Bilder (data:…), Bildadressen, Google-Weiterleitungen (imgres?imgurl=…)
   und kopiertes HTML mit <img>. Ergebnis: { blob } (gespeichert) oder { url } (nur verlinkt) oder { failed } / null. */
function unwrapImgUrl(u) {
  try {
    if (u.startsWith("/imgres") || u.startsWith("/url")) u = "https://www.google.com" + u;
    const x = new URL(u);
    if (/(^|\.)google\.[a-z.]+$/.test(x.hostname) && /^\/(imgres|url)$/.test(x.pathname)) return x.searchParams.get("imgurl") || x.searchParams.get("url") || x.searchParams.get("q") || u;
  } catch {}
  return u;
}
function imgUrlFrom(t) {
  t = String(t || "").trim().split(/\s+/)[0].replace(/&amp;/g, "&");
  if (/^data:image\//i.test(t)) return t;
  if (/^(https?:\/\/|\/imgres|\/url)/i.test(t)) return unwrapImgUrl(t);
  return null;
}
async function blobFromUrl(u) {
  try {
    const r = await fetch(u, u.startsWith("data:") ? {} : { mode: "cors", referrerPolicy: "no-referrer" });
    if (!r.ok) return null;
    const b = await r.blob();
    return b.type.startsWith("image/") && b.size > 300 ? b : null;
  } catch { return null; }
}
function transferData(dt) {
  if (!dt) return { files: [], html: "", text: "" };
  const files = [...(dt.files || [])];
  for (const it of dt.items || []) if (it.kind === "file") { const f = it.getAsFile(); if (f && !files.includes(f)) files.push(f); }
  let html = "", text = "";
  try { html = dt.getData("text/html") || ""; } catch {}
  try { text = dt.getData("text/uri-list") || dt.getData("text/plain") || ""; } catch {}
  return { files, html, text };
}
const hasImageData = d => d.files.some(f => f && f.type && f.type.startsWith("image/")) || /<img/i.test(d.html) || !!imgUrlFrom(d.text);
async function imageFromData({ files = [], html = "", text = "" }) {
  const f = files.find(f => f && f.type && f.type.startsWith("image/"));
  if (f) return { blob: f };
  const cands = [];
  for (const m of html.matchAll(/href=["']([^"']*imgres[^"']*)["']/gi)) cands.push(m[1]);   // Original hinter Google-Vorschau
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) cands.push(m[1]);
  for (const l of String(text).split(/\r?\n/)) if (l && !l.startsWith("#")) cands.push(l);
  const urls = [...new Set(cands.map(imgUrlFrom).filter(Boolean))];
  if (!urls.length) return null;
  for (const u of urls) { const b = await blobFromUrl(u); if (b) return { blob: b, url: u.startsWith("data:") ? "" : u }; }
  for (const u of urls) if (!u.startsWith("data:") && await imgOk(u)) return { url: u };   // nur anzeigbar, nicht speicherbar
  return { failed: true };
}
/* Übergibt das Ergebnis an den aktuellen Empfänger. Empfänger mit .urlOk bekommen {blob,url}|{url}, alle anderen eine Bilddatei. */
function deliverImage(res, handler) {
  if (!handler) return false;
  if (res?.blob) { if (handler.urlOk) handler({ blob: res.blob, url: res.url || "" }); else handler(res.blob); return true; }
  if (res?.url && handler.urlOk) { handler({ url: res.url }); return true; }
  if (res?.url || res?.failed) toast("Diese Webseite gibt ihr Bild nicht heraus. Bitte im Google-Tab mit Rechtsklick auf das Bild → „Bild kopieren“ (nicht „Bildadresse kopieren“) und erneut einfügen – oder das Bild speichern und als Datei wählen.", 7000);
  else toast("In der Zwischenablage ist kein Bild.", 3000);
  return false;
}
async function handleImageTransfer(d, handler) {
  const quick = d.files.find(f => f && f.type && f.type.startsWith("image/"));
  if (quick) return deliverImage({ blob: quick }, handler);
  const busy = toast("Bild wird geladen …", 15000);
  const res = await imageFromData(d);
  busy.remove();
  if (S.pasteHandler && handler !== S.pasteHandler && !handler.fixed) return false; // Dialog inzwischen geschlossen
  return deliverImage(res, handler);
}
document.addEventListener("paste", e => {
  const h = S.pasteHandler; if (!h) return;
  const d = transferData(e.clipboardData);
  const t = e.target;
  const inBox = t && t.closest && t.closest(".pastebox");
  const inField = !inBox && t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  const img = d.files.some(f => f && f.type && f.type.startsWith("image/"));
  if (inBox) e.preventDefault();                       // in der Einfüge-Fläche nie Text einfügen
  if (!img && (inField || !hasImageData(d))) { if (inBox) toast("In der Zwischenablage ist kein Bild.", 3000); return; }
  e.preventDefault();
  handleImageTransfer(d, h);
});
/* Liest die Zwischenablage per Knopf (auch am Handy; der Browser fragt ggf. um Erlaubnis). */
async function pasteFromClipboard(handler) {
  if (!navigator.clipboard) { toast("Dein Browser erlaubt hier kein Lesen der Zwischenablage – bitte Strg+V benutzen."); return; }
  try {
    if (navigator.clipboard.read) {
      const files = [], html = [], text = [];
      for (const it of await navigator.clipboard.read()) for (const ty of it.types) {
        const b = await it.getType(ty);
        if (ty.startsWith("image/")) files.push(b); else if (ty === "text/html") html.push(await b.text()); else if (ty === "text/plain") text.push(await b.text());
      }
      return handleImageTransfer({ files, html: html.join("\n"), text: text.join("\n") }, handler);
    }
    return handleImageTransfer({ files: [], html: "", text: await navigator.clipboard.readText() }, handler);
  } catch (e) {
    toast(e && e.name === "NotAllowedError" ? "Zugriff auf die Zwischenablage wurde nicht erlaubt. Alternativ: in die gestrichelte Fläche tippen und „Einfügen“ wählen bzw. Strg+V." : "Die Zwischenablage konnte nicht gelesen werden – bitte Strg+V benutzen.", 6000);
  }
}
/* Ablage-Fläche: Ziehen & Ablegen, Strg+V und (am Handy) lange tippen → Einfügen. */
function dropZone(text, onFile, { urlOk = false, paste = true } = {}) {
  const handler = x => onFile(x); handler.urlOk = urlOk; handler.fixed = true;
  const z = el("div", { class: "drop pastebox", tabindex: "0", role: "button", title: "Bild hierher ziehen oder hier einfügen" }, text);
  if (paste) { z.contentEditable = "true"; z.setAttribute("inputmode", "none"); z.spellcheck = false; z.addEventListener("beforeinput", e => e.preventDefault()); z.addEventListener("input", () => { z.textContent = text; }); }
  z.addEventListener("focus", () => { if (paste) { z._prev = S.pasteHandler; S.pasteHandler = handler; } });
  z.addEventListener("blur", () => { if (paste && S.pasteHandler === handler) S.pasteHandler = z._prev || null; });
  z.addEventListener("dragover", e => { e.preventDefault(); z.classList.add("hot"); });
  z.addEventListener("dragleave", () => z.classList.remove("hot"));
  z.addEventListener("drop", e => {
    e.preventDefault(); z.classList.remove("hot");
    const d = transferData(e.dataTransfer);
    if (!hasImageData(d)) { toast("Bitte ein Bild ablegen."); return; }
    handleImageTransfer(d, handler);
  });
  return z;
}

/* ================= Buch hinzufügen ================= */
function openAdd(asWish) {
  if (asWish !== undefined) S.addAsWish = asWish === true;
  const sh = sheet(S.addAsWish ? "⭐ Wunsch hinzufügen" : "Buch hinzufügen");
  sh.webTake = true; // Zwischenablage-Angebot darf hier ein Buch übernehmen
  const m = isMobile();
  // Ein Feld für alles: ISBN → Buchdaten, Link/kopierter Text → ISBN oder Titel daraus, sonst Katalogsuche
  const qIn = el("input", { class: "field", type: "search", placeholder: "Titel, Autor, ISBN oder Link", autocomplete: "off", "aria-label": "Titel, Autor, ISBN oder Link", enterkeyhint: "search" });
  const qGo = () => {
    const v = qIn.value.trim(); if (!v) { qIn.focus(); return; }
    const i = toIsbn13(v); if (i) { handleIsbn(i); return; }
    if (/https?:\/\//.test(v) || (typeof isbnsIn === "function" && isbnsIn(v).length)) { takeFromWeb(v); return; }
    showSearch(v, null);
  };
  qIn.addEventListener("keydown", e => { if (e.key === "Enter") qGo(); });
  qIn.addEventListener("paste", () => setTimeout(() => { if (/https?:\/\/|97[89]/.test(qIn.value)) qGo(); }, 50)); // eingefügter Link: gleich los
  const coverPick = async cam => { const f = await pickImage(cam); if (f) coverFlow(f); };
  const way = (id, ico, title, sub, fn, primary) => el("button", { class: "qway" + (primary ? " primary" : ""), id, onclick: fn }, icon(ico), el("b", { text: title }), el("small", { text: sub }));
  const many = (id, ico, label, sub, fn) => el("button", { class: "mrow", id, onclick: fn },
    el("span", { class: "mico", "aria-hidden": "true", text: ico }), el("span", { class: "mtxt" }, el("b", { text: label }), el("small", { text: sub })), icon("chevron"));
  const nStack = (S.stack || []).length;
  fillNode(sh.body,
    presetBarEl(), // Vorgaben für Stapel und „Speichern & nächstes“
    el("div", { class: "qways" },
      way("addScan", "barcode", "Barcode scannen", "ISBN auf der Rückseite – Daten und Cover kommen von selbst", startLiveScan, true),
      m ? way("addCover", "camera", "Cover fotografieren", "Für Bücher ohne Barcode", () => coverPick(true))
        : way("addCover", "camera", "Cover-Bild wählen", "Für Bücher ohne Barcode – oder Bild hierher ziehen", () => coverPick(false))),
    el("div", { class: "qalt" },
      el("button", { class: "btn sm ghost", onclick: async () => { const f = await pickImage(m); if (f) barcodeFromPhoto(f); } }, m ? "Barcode aus einem Foto lesen" : "🖼 Bild mit Barcode"),
      m ? el("button", { class: "btn sm ghost", onclick: () => coverPick(false) }, "Cover aus der Galerie") : null),
    m ? null : dropZone("Cover-Bild hierher ziehen oder mit Strg+V einfügen", f => coverFlow(f)),
    el("div", { class: "qsearch" },
      el("div", { class: "manual" }, qIn, el("button", { class: "btn primary", onclick: qGo }, "Suchen"),
        navigator.clipboard?.readText ? el("button", { class: "btn", title: "Link oder ISBN aus der Zwischenablage übernehmen", onclick: () => takeFromClipboard() }, "📋 Einfügen") : null),
      el("div", { class: "saved", text: "Auch ein Link aus einem Shop oder Katalog (ZVAB, booklooker, Amazon, DNB …) – die App holt sich die ISBN selbst." })),
    el("h3", { class: "qhead", text: "Viele Bücher auf einmal" }),
    el("div", { class: "mlist" },
      many("addStack", "📚", "Stapel erfassen", "Kamera bleibt offen – ein Buch nach dem anderen, am Ende alles prüfen", () => openStackCapture()),
      many("addShelfScan", "📷", "Fach-Foto einlesen", "Ein ganzes Regalfach fotografieren – Bücher landen gleich im echten Regal", () => openShelfScan()),
      many("addTitleList", "📋", "Titelliste einfügen", S.addAsWish ? "Liste aus Excel, Notiz oder Mail – auf die Wunschliste" : "Liste aus Excel, Notiz oder Mail – nur unsichere Treffer prüfen", () => openTitleList())),
    nStack || S.titleRun ? el("div", { class: "hstack mt-2" },
      nStack ? el("button", { class: "btn sm", onclick: () => openStackReview() }, `Stapel prüfen (${nStack})`) : null,
      S.titleRun ? el("button", { class: "btn sm", onclick: () => resumeTitleList() }, "Titelliste weiter prüfen") : null) : null,
    el("div", { class: "mt-4" }, el("button", { class: "btn ghost", onclick: () => openReview({}, null) }, "✏️ Ganz von Hand eintragen"))
  );
  S.pasteHandler = f => coverFlow(f);
  if (!m) setTimeout(() => { if (qIn.isConnected && !sh.body.contains(document.activeElement)) qIn.focus(); }, 50); // am PC gleich lostippen
}
function busyView(title, img, msg) {
  const sh = openSheet || sheet(title);
  sh.h2.textContent = title; S.pasteHandler = null; sh.redraw = null; sh.webTake = false;
  const m = el("div", { text: msg });
  fillNode(sh.body, el("div", { class: "busy" }, img ? el("img", { src: URL.createObjectURL(img) }) : null, el("div", { class: "spin" }), m));
  return m;
}
async function startLiveScan() {
  const r = await liveScan();
  if (r === "photo" || r === undefined) { const f = await pickImage(true); if (f) barcodeFromPhoto(f); return; }
  if (r) handleIsbn(r);
}
async function barcodeFromPhoto(file) {
  busyView("Barcode wird gelesen", file, "Suche den Barcode im Bild …");
  let isbn = null;
  try { isbn = await decodeFromImage(await loadImage(file)); } catch {}
  if (!isbn) {
    const sh = openSheet; sh.h2.textContent = "Kein Barcode erkannt";
    const isbnIn = el("input", { class: "field", placeholder: "ISBN von der Rückseite abtippen", inputmode: "numeric" });
    const go = () => { const i = toIsbn13(isbnIn.value); if (i) handleIsbn(i); else toast("Keine gültige ISBN."); };
    isbnIn.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    fillNode(sh.body, el("div", { class: "note", text: "Im Foto war kein lesbarer Barcode. Tipp: näher ran, gerade halten, auf gutes Licht achten – oder die Ziffern unter dem Barcode eintippen." }),
      el("div", { class: "manual" }, isbnIn, el("button", { class: "btn primary", onclick: go }, "Laden")),
      el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: openAdd }, "← Zurück"), el("button", { class: "btn", onclick: startLiveScan }, "Nochmal scannen")));
    isbnIn.focus();
    return;
  }
  handleIsbn(isbn);
}
async function handleIsbn(isbn) {
  const dup = S.books.find(b => toIsbn13(b.isbn) === isbn);
  if (dup && !(await confirmBox(`${dupText(dup)}\nTrotzdem noch einmal hinzufügen?`, "Trotzdem"))) { openDetail(dup.id); return; }
  busyView("Buchdaten werden geladen", null, `ISBN ${isbn} – suche bei Google Books und Open Library …`);
  let rec = null, err = null;
  const run = recRun("barcode", { isbn }), log = [];
  try { rec = await lookupIsbn(isbn, log); } catch (e) { err = e; }
  recSearch(run, "isbn:" + isbn, log, rec ? 1 : 0, err ? catErr(err) : rec ? "" : "nichts gefunden");
  if (!rec) {
    openReview({ isbn }, null, err ? "Keine Internetverbindung – trag die Daten von Hand ein oder versuch es später mit „Daten suchen“." : "Zu dieser ISBN wurde online nichts gefunden. Trag die Daten von Hand ein oder fotografiere das Cover.");
    return;
  }
  openReview(rec, null);
}
async function coverFlow(file) {
  if (aiKey()) {
    busyView("Cover wird erkannt", file, "KI liest das Cover …");
    const run = recRun("cover");
    try { coverResult(await aiRecognizeCover(file, run), file, run); return; } catch (e) { toast("KI-Erkennung nicht möglich: " + (e.message || e), 4000); }
  }
  showSearch("", file); // ohne KI: Titel eintippen oder „💬 Mit Claude-Chat erkennen“
}
async function showSearch(query, coverFile, recognized, recRunCover) {
  const sh = openSheet || sheet("Suche");
  sh.h2.textContent = coverFile ? "Welches Buch ist es?" : "Suchergebnisse";
  sh.webTake = true; sh.redraw = null;
  S.pasteHandler = null;
  const qIn = el("input", { class: "field", type: "search", value: query || "", placeholder: "Titel und/oder Autor" });
  const results = el("div", { class: "cands" });
  const run = async () => {
    const q = qIn.value.trim(), my = ++searchToken; // neuere Suche gewinnt (Claudes Urteil zu einer älteren wird verworfen)
    if (!q) { results.replaceChildren(el("div", { class: "note", text: coverFile ? "Titel und/oder Autor oben eintippen – oder das Cover mit Claude erkennen lassen." : "Titel und/oder Autor oben eintippen." })); return; }
    results.replaceChildren(el("div", { class: "busy", style: "padding:14px" }, el("div", { class: "spin" })));
    links.replaceChildren(webSearchLinks(q) || ""); // auch (gerade) bei „Nichts gefunden“
    let list = [];
    const R = recRunCover || recRun("titelsuche"), log = []; recRunCover = null; // erste Suche zum Cover gehört zu dessen Lauf
    try { list = await searchBooks(q, log); recSearch(R, q, log, list.length); } catch (e) { recSearch(R, q, log, 0, catErr(e)); results.replaceChildren(el("div", { class: "note", text: "Keine Internetverbindung. Du kannst das Buch trotzdem von Hand anlegen." })); return; }
    if (!list.length) { results.replaceChildren(el("div", { class: "note", text: "In den Katalogen nichts gefunden. Suchbegriff kürzen oder anpassen – oder unten über „Im Internet suchen“ die Buchseite finden und ihren Link einfügen." })); return; }
    const nextCover = img => { const r = img._r, n = (r.altCovers || []).indexOf(img.getAttribute("src")), nx = (r.altCovers || [])[n + 1]; if (nx) img.src = nx; else img.remove(); };
    const card = (r, best, tag) => el("button", { class: "cand" + (best ? " best" : ""), onclick: () => pickCandidate(r, coverFile) },
      el("div", { class: "cv" }, r.coverUrl ? Object.assign(el("img", { src: r.coverUrl, alt: "", loading: best ? null : "lazy", referrerpolicy: "no-referrer", onerror: e => nextCover(e.target), onload: e => { if (placeholderImg(e.target)) nextCover(e.target); } }), { _r: r }) : null),
      el("div", {}, best ? el("div", { class: "besttag", text: "★ Bester Treffer" }) : null, tag ? el("div", { class: "judgetag", text: tag }) : null, el("b", { text: bookLabel(r) }),
        el("span", { text: [r.author, [r.publisher, r.year].filter(Boolean).join(" "), r.pages ? r.pages + " S." : ""].filter(Boolean).join(" · ") }),
        el("div", { class: "candmeta" }, r.ebook ? el("span", { class: "mtag", text: "E-Book" }) : null, r.av ? el("span", { class: "mtag", text: "Hörbuch/CD" }) : null, r.edition ? el("span", { text: r.edition }) : null, r.isbn ? el("span", { text: "ISBN " + r.isbn }) : null, el("span", { text: r.src }))),
      el("span", { class: "pick", text: best ? "Das ist es" : "Wählen" }));
    // v: Claudes Bildvergleich (judge.js) – sicher → Treffer nach oben; Vermutung → Hinweis an der Karte; keiner → Hinweis oben
    const show = v => {
      const order = v && v.sure ? [list[v.i], ...list.filter((_, k) => k !== v.i)] : list;
      const tagOf = r => !v || v.i < 0 || r !== list[v.i] ? null : v.sure ? `🤖 Claude: das ist diese Ausgabe – ${v.reason}` : `🤖 Claude vermutet diese Ausgabe – ${v.reason}`;
      const [top, ...rest] = order, open = !!(v && !v.sure && v.i > 0);
      results.replaceChildren(
        v === undefined ? el("div", { class: "saved judgewait", text: "🤖 Claude vergleicht dein Foto mit den Covern der Treffer …" }) : null,
        v && v.i < 0 && v.reason ? el("div", { class: "note info", text: `🤖 Claude: keiner der Treffer passt sicher zu deinem Foto – ${v.reason}` }) : null,
        card(top, true, tagOf(top)),
        rest.length ? el("details", { class: "morecands", open: open || null }, el("summary", { text: `Andere Ausgabe? ${rest.length} weitere Treffer anzeigen` }),
          el("div", { class: "saved", style: "margin:6px 0", text: "Am besten passende zuerst. Die ISBN zeigt, welche Ausgabe es ist." }), ...rest.map(r => card(r, false, tagOf(r)))) : null);
    };
    const judging = coverFile && typeof judgeCover === "function" && judgeOn() && aiKey();
    show(judging ? undefined : null);
    if (judging) {
      const v = await judgeCover(coverFile, { ...(recognized || {}), title: recognized?.title || q }, list, R).catch(() => null);
      if (my === searchToken) show(v);
    }
  };
  let searchToken = 0;
  const links = el("div", {});
  qIn.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  fillNode(sh.body, 
    coverFile ? el("div", { style: "display:flex;gap:14px;align-items:flex-start;margin-bottom:12px" },
      el("img", { src: URL.createObjectURL(coverFile), style: "width:70px;border-radius:4px;box-shadow:var(--shadow)" }),
      el("div", { style: "font-size:14px;color:var(--muted)" }, query ? "Vom Cover gelesen – bei Bedarf korrigieren und erneut suchen:" : "Text konnte nicht gelesen werden – bitte Titel/Autor eintippen:")) : null,
    el("div", { class: "manual", style: "margin-top:0" }, qIn, el("button", { class: "btn primary", onclick: run }, "Suchen")),
    results,
    links,
    el("div", { class: "sec webtake" }, el("label", { class: "lbl", text: "Im Web gefunden? Link oder ISBN hier einfügen" }), webTakeField("Link der Buchseite oder ISBN"),
      el("div", { class: "saved", style: "margin-top:6px", text: "Tipp: Über die Links oben suchen, auf der Buchseite die Adresse kopieren und zurückkommen – die App bietet sie dann von selbst zur Übernahme an." })),
    el("div", { class: "actions" },
      el("button", { class: "btn ghost", onclick: openAdd }, "← Zurück"),
      el("div", { class: "covertools" },
        coverFile && !recognized ? el("button", { class: "btn", onclick: () => coverViaChat(coverFile) }, "💬 Mit Claude-Chat erkennen") : null,
        el("button", { class: "btn", onclick: () => openReview(recognized ? { title: recognized.title || qIn.value.trim(), author: recognized.author || "", publisher: recognized.publisher || "", year: recognized.year || "", language: recognized.language || "" } : { title: qIn.value.trim() }, coverFile) }, recognized ? "Erkanntes übernehmen" : "Nicht dabei – von Hand anlegen")))
  );
  if (query) run(); else qIn.focus();
}

async function pickCandidate(r, coverFile) {
  if (!r.isbn) { openReview(r, coverFile); return; }
  const dup = S.books.find(b => toIsbn13(b.isbn) === r.isbn);
  if (dup && !(await confirmBox(`${dupText(dup)} (diese Ausgabe)\nTrotzdem noch einmal hinzufügen?`, "Trotzdem"))) { openDetail(dup.id); return; }
  busyView("Buchdaten werden ergänzt", coverFile, "Lade Klappentext und Cover zu dieser Ausgabe …");
  let full = null; try { full = await lookupIsbn(r.isbn); } catch {}
  // Die gewählte Ausgabe hat Vorrang; fehlende Felder (z. B. Klappentext, Cover) kommen aus der ISBN-Suche
  const rec = full ? merge(r, full) : r;
  if (full) { rec.altCovers = [...new Set([...(r.altCovers || []), ...(full.altCovers || [])])]; rec.coverUrl = rec.altCovers[0]; rec.src = [...new Set([r.src, ...(full.src || "").split(", ")])].filter(Boolean).join(", "); }
  openReview(rec, coverFile);
}

/* ================= Formular-Bausteine ================= */
function fieldInput(f, val, onInput) {
  const inp = f.k === "summary" ? el("textarea", { class: "field", rows: 5 })
    : el("input", { class: "field", type: "text", inputmode: (f.k === "year" || f.k === "pages" || f.k === "isbn") ? "numeric" : (f.k === "price" || f.k === "value") ? "decimal" : null, placeholder: f.k === "price" ? "z. B. 12,90" : f.k === "value" ? "z. B. 25" : null });
  inp.value = val ?? ""; inp.addEventListener("input", () => onInput(inp.value));
  return inp;
}
function dataForm(book, onChange) {
  const span = { title: "c6", author: "c4", year: "c2", isbn: "c3", publisher: "c3", pages: "c2", genre: "c2", language: "c2", price: "c2", value: "c2", series: "c4", seriesNo: "c2", summary: "c6" };
  const g = el("div", { class: "fgrid" });
  for (const f of FIELDS) {
    const wrap = el("div", { class: span[f.k] });
    const inp = fieldInput(f, book[f.k], v => { onChange(f.k, v); wrap.classList.toggle("missing", !!(f.req && !v.trim())); });
    if (f.k === "series") { seriesDatalist(); inp.setAttribute("list", "serieslist"); inp.placeholder = "z. B. Harry Potter, dtv, Fischer Klassik"; }
    if (f.k === "seriesNo") inp.placeholder = "z. B. 3";
    if (f.req && !String(book[f.k] ?? "").trim()) wrap.classList.add("missing");
    wrap.append(el("label", { class: "lbl", text: f.l }), inp);
    g.append(wrap);
  }
  return g;
}
function personalSection(book, onChange) {
  const frag = el("div", {});
  const seg = el("div", { class: "seg" });
  const dates = readsEditor(book, onChange); dates.style.marginTop = "14px";
  const setStatus = s => {
    const patch = statusPatch(book, s);
    Object.assign(book, patch); onChange(patch); drawSeg(); dates._redraw();
  };
  const drawSeg = () => seg.replaceChildren(...Object.entries(STATUS).map(([k, l]) => el("button", { class: (book.status || "unread") === k ? "on" : "", type: "button", onclick: () => setStatus(k) }, el("span", { class: "dot", style: `background:${STATUS_COLOR[k]};margin-right:6px` }), l)));
  drawSeg();
  const stars = el("div", { class: "stars", "aria-label": "Bewertung" });
  const drawStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map(n => el("button", { type: "button", class: n <= (book.rating || 0) ? "on" : "", title: n + " Sterne", onclick: () => { book.rating = (book.rating === n ? 0 : n); onChange({ rating: book.rating }); drawStars(); } }, "★")));
  drawStars();
  const fav = el("button", { type: "button", class: "favbtn" + (book.favorite ? " on" : ""), title: "Bücher, von denen du dich niemals trennen würdest" });
  const drawFav = () => { fav.className = "favbtn" + (book.favorite ? " on" : ""); fav.textContent = book.favorite ? "♥ Lieblingsbuch" : "♡ Als Lieblingsbuch markieren"; };
  fav.addEventListener("click", () => { book.favorite = !book.favorite; onChange({ favorite: book.favorite }); drawFav(); fav.dispatchEvent(new Event("input", { bubbles: true })); });
  drawFav();
  const ta = el("textarea", { class: "field", rows: 6, placeholder: "Gedanken, Lieblingszitate, von wem geschenkt, wo gekauft …" });
  ta.value = book.notes || "";
  let t; const push = () => { clearTimeout(t); if (ta.value !== (book.notes || "")) { book.notes = ta.value; onChange({ notes: ta.value }); } };
  ta.addEventListener("input", () => { clearTimeout(t); t = setTimeout(push, 800); });
  ta.addEventListener("blur", push);
  frag._flush = push;
  const mic = micButton(ta, () => push());
  frag.append(
    el("label", { class: "lbl", text: "Lesestatus" }), seg,
    el("label", { class: "lbl", style: "margin-top:14px", text: "Deine Bewertung" }), stars,
    el("div", { style: "margin-top:10px" }, fav),
    dates,
    el("div", { class: "sec" },
      el("div", { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px" }, el("label", { class: "lbl", style: "margin:0", text: "Notizen & Zitate" }), mic),
      ta, !mic ? el("div", { class: "saved", style: "margin-top:4px", text: "Tipp: Über das Mikrofon der Handy-Tastatur kannst du diktieren." }) : null)
  );
  return frag;
}
function coverTools(onFile) {
  const m = isMobile();
  return el("div", { class: "covertools" },
    m ? el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(true); if (f) onFile(f); } }, "📷 Foto") : null,
    el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(false); if (f) onFile(f); } }, m ? "Galerie" : "🖼 Bild wählen"));
}

/* ================= Prüfen & speichern (neues Buch) ================= */
/* restore: gesicherter Entwurf (Meta „reviewDraft“) – nach einem Neustart genau dort weitermachen */
function openReview(rec, coverFile, noteText, restore) {
  const sh = openSheet || sheet("Prüfen & speichern");
  sh.h2.textContent = "Prüfen & speichern";
  sh.webTake = false; sh.redraw = null;
  const draft = { status: "unread", rating: 0, notes: "", wish: !!S.addAsWish };
  for (const f of FIELDS) draft[f.k] = rec[f.k] || "";
  const hsp = spineWithHeight(draft, rec); if (hsp) draft.spine = hsp; // Buchhöhe aus dem Katalog (DNB/lobid)
  // Vorgaben (stackscan.js): Status, Schlagworte, Bestand/Wunschliste vorbelegen – pro Buch änderbar; das Fach gilt beim Speichern
  const pre = capturePreset();
  if (pre && !restore) { Object.assign(draft, statusPatch(draft, pre.status)); draft.wish = pre.wish; if (pre.tags.length) draft.tags = [...pre.tags]; }
  if (restore?.draft) Object.assign(draft, restore.draft);
  let coverMode = restore ? restore.coverMode || "none" : coverFile ? "photo" : (rec.coverUrl ? "web" : "none");
  let photo = (restore ? restore.photo : coverFile) || null, photoUrl = photo ? URL.createObjectURL(photo) : null;
  let orig = (restore ? restore.orig : coverFile) || null, quads = (restore ? restore.quads : coverFile?.quads) || null, spineFromQuad = !!restore?.spineFromQuad; // Originalfoto + Ecken (KI oder von Hand) zum Zuschneiden
  const webCovers = rec.altCovers || (rec.coverUrl ? [rec.coverUrl] : []);
  let webIdx = restore?.webIdx || 0;
  // Entwurf laufend sichern (Meta „reviewDraft“, nur auf diesem Gerät, samt Cover- und Rückenfoto): schließt Android die App,
  // während die Kamera offen ist, geht nichts verloren
  let draftT = null, draftGone = false;
  const keepDraft = () => {
    if (draftGone) return; clearTimeout(draftT);
    draftT = setTimeout(() => { if (!draftGone) DB.setMeta("reviewDraft", { at: new Date().toISOString(), rec, note: noteText || "", draft: { ...draft }, coverMode, webIdx, photo, orig, quads, spBase, spineFromQuad }).catch(() => {}); }, 400);
  };
  const dropDraft = () => { draftGone = true; clearTimeout(draftT); DB.setMeta("reviewDraft", null).catch(() => {}); };
  const coverBox = el("div", {});
  const coverChoice = el("div", { class: "covertools" });
  const drawCover = () => {
    const src = coverMode === "photo" ? photoUrl : coverMode === "web" ? webCovers[webIdx] : null;
    const c = coverEl(draft, { src });
    const img = c.querySelector("img");
    if (img && coverMode === "web") { img.onerror = () => { if (webIdx < webCovers.length - 1) { webIdx++; drawCover(); } else { coverMode = photo ? "photo" : "none"; drawCover(); } }; img.addEventListener("load", () => { if (placeholderImg(img)) img.onerror(); }); }
    if (src) c.addEventListener("click", () => lightbox(src));
    coverBox.replaceChildren(c);
    coverChoice.replaceChildren(...[
      orig && coverMode === "photo" ? el("button", { class: "btn sm", type: "button", title: "Ecken des Buchs setzen: Hintergrund weg, schräg Fotografiertes wird gerade – auch den Rücken", onclick: cropDialog }, "✂ Zuschneiden") : null,
      photo && webCovers.length ? el("button", { class: "btn sm", type: "button", onclick: () => { coverMode = coverMode === "photo" ? "web" : "photo"; drawCover(); } }, coverMode === "photo" ? "Online-Cover nehmen" : "Mein Foto nehmen") : null].filter(Boolean));
    keepDraft();
  };
  const showPhoto = f => { photo = f; photoUrl = URL.createObjectURL(f); coverMode = "photo"; drawCover(); };
  const setPhoto = f => { orig = f; quads = f.quads || null; showPhoto(f); if (quads) applyQuads(quads); };
  drawCover();
  S.pasteHandler = setPhoto; // Strg+V geht ans Cover – außer die Rücken-Fläche ist gerade fokussiert (dropZone)
  // --- Rückenfoto gleich beim Erfassen
  const spBase = restore ? restore.spBase || null : draft.spine ? { ...draft.spine } : null;
  const spBox = el("div", { class: "spphoto" });
  const setSpine = async (f, quiet) => {
    try { draft.spine = await spineWithPhoto(draft, f, spBase); spineFromQuad = false; drawSpine(); if (quiet !== true) toast("Rückenfoto übernommen.", 1800); }
    catch { toast("Bild konnte nicht gelesen werden."); }
  };
  const spZone = isMobile() ? null : dropZone("Rücken hierher ziehen – oder hier klicken und Strg+V", setSpine);
  if (spZone) spZone.style.cssText = "padding:8px;font-size:12px;margin-top:6px";
  const drawSpine = () => {
    const has = !!draft.spine?.imageBlob;
    fillNode(spBox, el("label", { class: "lbl", text: "📷 Rücken" }),
      has ? el("div", { class: "spmini" }, spineMini(draft, "review", 5)) : el("div", { class: "saved", text: "Optional – fürs echte Regal." }),
      el("div", { class: "covertools" }, ...spinePhotoButtons(setSpine, isMobile() ? "📷 Foto" : "🖼 Bild wählen"),
        has ? el("button", { class: "btn sm ghost danger", type: "button", onclick: () => { draft.spine = spBase ? { ...spBase } : null; drawSpine(); } }, "entfernen") : null),
      spZone);
    keepDraft();
  };
  drawSpine();
  // --- Zuschneiden / Entzerren: Cover und Rücken aus einem (schräg aufgenommenen) Foto (perspective.js)
  async function applyQuads(q, auto = true) {
    const src = orig;
    try {
      if (q.cover) { const b = await warpQuad(src, q.cover, 1200); if (orig === src) showPhoto(b); }
      if (q.spine && orig === src) { await setSpine(await warpQuad(src, q.spine, SPINE_MAX), true); spineFromQuad = true; }
      else if (!q.spine && spineFromQuad) { draft.spine = spBase ? { ...spBase } : null; spineFromQuad = false; drawSpine(); }
      if (auto) toast(q.spine ? "Cover und Rücken aus dem Foto zugeschnitten – mit „✂ Zuschneiden“ anpassen." : "Cover zugeschnitten – mit „✂ Zuschneiden“ anpassen.", 3500);
    } catch { toast("Zuschneiden hat nicht geklappt – das ganze Foto bleibt."); }
  }
  async function cropDialog() {
    const r = await quadEditor(orig, { cover: quads?.cover, spine: quads?.spine, withSpine: true });
    if (!r) return;
    quads = r; await applyQuads(r, false);
  }
  if (quads && !restore) applyQuads(quads);
  const notes = [];
  if (noteText) notes.push(el("div", { class: "note", text: noteText }));
  else if (rec.src) notes.push(el("div", { class: "note info", text: `Gefunden über ${rec.src}. Kurz drüberschauen – fehlende Felder sind gelb markiert.` }));
  const form = dataForm(draft, (k, v) => { draft[k] = v; if ((k === "title" || k === "author") && coverMode === "none") drawCover(); });
  const personal = personalSection(draft, patch => Object.assign(draft, patch));
  const saveBtn = el("button", { class: "btn primary" });
  const label = () => draft.wish ? "Auf die Wunschliste" : "Ins Regal stellen";
  saveBtn.textContent = label();
  const whereSeg = el("div", { class: "seg", style: "margin:0 0 14px" });
  const drawWhere = () => whereSeg.replaceChildren(
    el("button", { type: "button", class: draft.wish ? "" : "on", onclick: () => { draft.wish = false; drawWhere(); saveBtn.textContent = label(); } }, "📚 In meinen Bestand"),
    el("button", { type: "button", class: draft.wish ? "on" : "", onclick: () => { draft.wish = true; drawWhere(); saveBtn.textContent = label(); } }, "⭐ Auf die Wunschliste"));
  drawWhere();
  const doSave = async next => {
    personal._flush && personal._flush();
    if (!String(draft.title || "").trim()) { toast("Bitte mindestens einen Titel eintragen."); return; }
    const dup = findDuplicate(draft);
    if (dup && isWish(dup) && !draft.wish) {
      if (await confirmBox(`„${dup.title}“ steht auf deiner Wunschliste.\nAls gekauft in den Bestand übernehmen?`, "Übernehmen")) { dropDraft(); sh.guard = null; await wishBought(dup.id); if (next) openAdd(); else openDetail(dup.id); }
      return;
    }
    if (dup && !(await confirmBox(`${dupText(dup)}\nTrotzdem noch einmal anlegen?`, "Trotzdem anlegen"))) return;
    saveBtn.disabled = true; saveBtn.textContent = "Speichere …";
    try {
      const now = new Date().toISOString();
      const b = { id: uid(), ...draft, isbn: toIsbn13(draft.isbn) || draft.isbn.trim(), addedAt: now };
      if (coverMode === "photo" && photo) b.coverBlob = await coverBlobFromFile(photo);
      else if (coverMode === "web" && webCovers[webIdx]) {
        const url = webCovers[webIdx];
        const blob = await fetchCoverBlob(url);
        if (blob) { b.coverUrl = url; b.coverBlob = blob; } else if (await imgOk(url)) b.coverUrl = url; // sonst: kein Cover
      }
      if (!b.wish) delete b.wish;
      if (!b.spine) delete b.spine;
      await putBook(b);
      const fach = !b.wish && capturePreset()?.fach;
      if (fach) await placePresetBooks([b.id]); // Vorgabe-Fach: ans Ende stellen
      toast(b.wish ? `„${b.title}“ steht auf der Wunschliste.` : fach ? `„${b.title}“ steht jetzt in ${fach.label}.` : `„${b.title}“ ist im Regal.`);
      dropDraft(); sh.guard = null;
      if (next) openAdd(); else closeSheet();
    } catch (e) { console.error(e); toast("Speichern fehlgeschlagen."); saveBtn.disabled = false; saveBtn.textContent = label(); }
  };
  saveBtn.addEventListener("click", () => doSave(false));
  fillNode(sh.body,
    presetBarEl({ onChange: () => toast("Vorgaben gespeichert – Status, Schlagworte und Besitz gelten ab dem nächsten Buch, das Fach schon für dieses.", 4000) }),
    ...notes,
    whereSeg,
    el("div", { class: "dtop" }, el("div", {}, coverBox, coverChoice, coverTools(setPhoto), spBox), el("div", {}, personal)),
    el("div", { class: "sec" }, el("h3", { text: "Buchdaten" }), form,
      el("label", { class: "lbl", style: "margin-top:12px", text: "Schlagworte" }), tagEditor(draft, () => {}),
      webSearchLinks([draft.title, draft.author].filter(Boolean).join(" "), draft.isbn, draft.title, draft.author)),
    el("div", { class: "actions" },
      el("button", { class: "btn ghost", onclick: async () => { if (await sh.guard()) { sh.guard = null; openAdd(); } } }, "← Zurück"),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, el("button", { class: "btn", onclick: () => doSave(true) }, "Speichern & nächstes"), saveBtn))
  );
  // Noch nicht gespeichert: Schließen, Zurück-Taste und „← Zurück“ fragen nach
  sh.guard = async () => { const ok = await confirmBox(`${draft.title ? `„${draft.title}“` : "Das Buch"} ist noch nicht gespeichert.\nWirklich verwerfen?`, "Verwerfen"); if (ok) dropDraft(); return ok; };
  for (const ev of ["input", "change", "click"]) sh.body.addEventListener(ev, keepDraft);
  keepDraft();
  sh.body.parentElement.scrollTop = 0;
}
/* Leiste unten „… weitermachen?“ (Entwurf, Titelliste …). Mehrere stehen untereinander. */
function resumeBar(id, text, onGo, onDrop, { goLabel = "Weitermachen", cls = "", ask = "Wirklich verwerfen?" } = {}) {
  let box = $(".resumebox"); if (!box) { box = el("div", { class: "resumebox" }); document.body.append(box); }
  box.querySelector(`[data-id="${id}"]`)?.remove();
  const bar = el("div", { class: "resumebar " + cls, "data-id": id }, el("span", { text }),
    el("button", { class: "btn sm primary", onclick: () => { if (openSheet) { toast("Bitte zuerst das offene Fenster schließen."); return; } bar.remove(); onGo(); } }, goLabel),
    el("button", { class: "btn sm ghost", onclick: async () => { if (await confirmBox(ask, "Verwerfen")) { bar.remove(); onDrop && await onDrop(); } } }, "verwerfen"));
  box.append(bar);
  return bar;
}
async function offerReviewDraft() {
  let d = null; try { d = await DB.getMeta("reviewDraft"); } catch {}
  if (!d?.draft) return;
  if (Date.now() - Date.parse(d.at) > 14 * 864e5) { DB.setMeta("reviewDraft", null).catch(() => {}); return; }
  const t = d.draft.title ? `„${d.draft.title}“` : "ein Buch";
  resumeBar("reviewDraft", `✏️ Du warst gerade dabei, ${t} zu erfassen – weitermachen?`, () => openReview(d.rec || {}, null, d.note || null, d),
    () => DB.setMeta("reviewDraft", null).catch(() => {}), { ask: `Den angefangenen Eintrag ${t} verwerfen?` });
}

/* ================= Detailseite: Ansicht ================= */
let detailId = null;
function openDetail(id, edit) {
  const b = S.books.find(x => x.id === id); if (!b) return;
  detailId = id;
  const sh = sheet(b.title || "Buch", { onClose: () => { detailId = null; } });
  if (edit) drawDetailEdit(sh, b); else drawDetailView(sh, b);
}
function fillHead(h, b) {
  h.replaceChildren(el("h2", { text: b.title || "Ohne Titel" }),
    el("div", { class: "meta", text: [b.author, b.year].filter(Boolean).join(" · ") || "Autor unbekannt" }),
    el("div", { class: "meta", text: [b.publisher, b.pages ? b.pages + " Seiten" : "", b.genre].filter(Boolean).join(" · ") }));
}
const fmtDate = d => d ? new Date(d).toLocaleDateString("de-DE") : "";
const priceNum = p => { const n = parseFloat(String(p || "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return isFinite(n) ? n : null; };
const fmtPrice = p => { const n = priceNum(p); return n == null ? String(p || "") : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }); };
function drawDetailView(sh, b) {
  sh.guard = null; sh.h2.textContent = b.title || "Buch";
  S.pasteHandler = null;
  const book = { ...b };
  const quickSave = async patch => { Object.assign(book, patch); await patchBook(b.id, patch); toast("✓ Gespeichert", 1400); };
  // Schnellzugriff: Status & Sterne (speichern sofort)
  const seg = el("div", { class: "seg" });
  const drawSeg = () => seg.replaceChildren(...Object.entries(STATUS).map(([k, l]) => el("button", {
    class: (book.status || "unread") === k ? "on" : "", type: "button",
    onclick: () => { const p = statusPatch(book, k); quickSave(p).then(() => drawDetailView(sh, S.books.find(x => x.id === b.id))); }
  }, el("span", { class: "dot", style: `background:${STATUS_COLOR[k]};margin-right:6px` }), l)));
  drawSeg();
  const stars = el("div", { class: "stars" }, ...[1, 2, 3, 4, 5].map(n => el("button", { type: "button", class: n <= (book.rating || 0) ? "on" : "", title: n + " Sterne",
    onclick: () => quickSave({ rating: book.rating === n ? 0 : n }).then(() => drawDetailView(sh, S.books.find(x => x.id === b.id))) }, "★")));
  const cover = coverEl(book); const src = coverSrc(book); if (src) cover.addEventListener("click", () => lightbox(src));
  const head = el("div", {}); fillHead(head, book);
  const chips = tagChips(book, t => { S.tag = t; closeSheet(); if (location.hash === "#verwaltung") { S.tTag = t; renderAll(); } else if (location.hash !== "#regal" && location.hash !== "") location.hash = "#regal"; else renderAll(); });
  if (chips) head.append(chips);
  if (book.series) head.append(el("div", { class: "tagrow" }, el("button", { class: "tag link ser", title: "Alle Bände dieser Reihe im Bestand zeigen", onclick: () => { S.series = book.series; closeSheet(); if (location.hash !== "#regal" && location.hash !== "") location.hash = "#regal"; else renderAll(); } }, "📚 " + seriesText(book))));
  const reads = readsOf(book);
  const dates = reads.length ? el("div", { class: "readlist" }, el("b", { text: readsSummary(book) || "Lesedaten" }), ...reads.map((r, i) => el("div", { text: `${reads.length > 1 ? (i + 1) + ". " : ""}${readText(r)}${r.note ? " · " + r.note : ""}` }))) : null;
  const goneBox = isGone(book) ? el("div", { class: "note gonebox" },
    el("div", {}, el("b", { text: "📦 Hatte ich mal: " }), goneText(book.gone)),
    book.gone.note ? el("div", { style: "margin-top:4px;white-space:pre-wrap", text: book.gone.note }) : null,
    el("div", { class: "covertools", style: "margin-top:8px" },
      el("button", { class: "btn sm", onclick: async () => { const g = await goneDialog(book); if (g) { await patchBook(b.id, { gone: g }); drawDetailView(sh, S.books.find(x => x.id === b.id)); } } }, "Angaben ändern"),
      el("button", { class: "btn sm", onclick: async () => { await patchBook(b.id, { gone: null }); toast("Wieder in deinem Besitz."); drawDetailView(sh, S.books.find(x => x.id === b.id)); } }, "↩ Wieder in meinem Besitz"))) : null;
  const kv = [["ISBN", book.isbn], ["Verlag", book.publisher], ["Jahr", book.year], ["Seiten", book.pages], ["Genre", book.genre], ["Sprache", book.language], ["Reihe", seriesText(book)], ["Preis", book.price ? fmtPrice(book.price) : ""], ["Heutiger Wert", book.value ? fmtPrice(book.value) : ""], ["Hinzugefügt", fmtDate(book.addedAt)], ["Zuletzt geändert", fmtDate(book.updatedAt)]].filter(([, v]) => v);
  const miss = missingOf(book);
  fillNode(sh.body,
    el("div", { class: "dtop" }, el("div", {}, cover),
      el("div", {}, head,
        el("label", { class: "lbl", style: "margin-top:12px", text: "Lesestatus" }), seg,
        el("label", { class: "lbl", style: "margin-top:12px", text: "Deine Bewertung" }),
        el("div", { class: "rateRow" }, stars, el("button", { type: "button", class: "favbtn" + (book.favorite ? " on" : ""), "aria-pressed": !!book.favorite, onclick: () => quickSave({ favorite: !book.favorite }).then(() => drawDetailView(sh, S.books.find(x => x.id === b.id))) }, book.favorite ? "♥ Lieblingsbuch" : "♡ Lieblingsbuch")),
        dates)),
    miss.length ? el("div", { class: "note" }, "Es fehlen: " + miss.join(", ") + ". ", el("a", { href: "#", onclick: e => { e.preventDefault(); drawDetailEdit(sh, S.books.find(x => x.id === b.id)); } }, "Jetzt ergänzen"),
      needsCover(book) ? el("button", { class: "btn sm", style: "margin-left:10px", onclick: async e => { e.target.disabled = true; const r = await findCoverFor(b.id); if (r === "set") drawDetailView(sh, S.books.find(x => x.id === b.id)); else e.target.disabled = false; } }, "🖼 Cover online suchen") : null) : null,
    goneBox,
    isWish(book) ? el("div", { class: "note wishbox" },
      el("div", {}, el("b", { text: "⭐ Auf deiner Wunschliste" }), " – gehört (noch) nicht zu deinem Bestand."),
      el("div", { class: "covertools", style: "margin-top:8px" },
        el("button", { class: "btn sm primary", onclick: async () => { await wishBought(b.id); drawDetailView(sh, S.books.find(x => x.id === b.id)); } }, "✓ Gekauft – in den Bestand übernehmen"))) : null,
    isGone(book) || isWish(book) ? null : locationBlock(b.id),
    book.summary ? el("div", { class: "sec" }, el("h3", { text: "Zusammenfassung" }), el("div", { class: "summary-text", text: book.summary })) : null,
    book.notes ? el("div", { class: "sec" }, el("h3", { text: "Deine Notizen" }), el("div", { class: "summary-text", text: book.notes })) : null,
    extrasView(book),
    kv.length ? el("div", { class: "sec" }, el("h3", { text: "Details" }), el("dl", { class: "kv" }, ...kv.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]))) : null,
    webSearchLinks([book.title, book.author].filter(Boolean).join(" "), book.isbn, book.title, book.author),
    el("div", { class: "actions sticky" },
      el("div", { class: "covertools" },
        el("button", { class: "btn danger", onclick: async () => { if (await confirmBox(`„${book.title || "Dieses Buch"}“ endgültig löschen?\nTipp: Wenn du das Buch weggegeben hast, nimm lieber „Hatte ich mal“ – dann bleiben deine Notizen erhalten.`)) { await removeBook(b.id); closeSheet(); toast("Gelöscht."); } } }, "Löschen"),
        isGone(book) || isWish(book) ? null : el("button", { class: "btn", onclick: async () => { if (await markGone(S.books.find(x => x.id === b.id))) drawDetailView(sh, S.books.find(x => x.id === b.id)); } }, "📦 Hatte ich mal …")),
      el("button", { class: "btn primary", onclick: () => drawDetailEdit(sh, S.books.find(x => x.id === b.id)) }, "✏️ Bearbeiten"))
  );
  sh.body.parentElement.scrollTop = 0;
}


/* ================= Lesedurchgänge (ein Buch kann mehrfach gelesen werden) ================= */
function readsOf(b) {
  if (Array.isArray(b.reads)) return b.reads;
  return (b.startedAt || b.finishedAt) ? [{ start: b.startedAt || "", end: b.finishedAt || "", note: "" }] : [];
}
function statusPatch(b, s) {
  const reads = readsOf(b).map(x => ({ ...x }));
  const open = [...reads].reverse().find(x => x.start && !x.end);
  if (s === "reading" && !open) reads.push({ start: today(), end: "", note: "" });
  if (s === "read" && (b.status || "unread") !== "read") { if (open) open.end = today(); else reads.push({ start: "", end: today(), note: "" }); }
  return { status: s, reads };
}
const fmtD = d => d ? new Date(d + "T12:00:00").toLocaleDateString("de-DE") : "";
function readText(r) {
  if (r.start && r.end) return `${fmtD(r.start)} – ${fmtD(r.end)}`;
  if (r.start) return `seit ${fmtD(r.start)} (läuft)`;
  if (r.end) return `beendet ${fmtD(r.end)}`;
  return "ohne Datum";
}
function readsSummary(b) {
  const r = readsOf(b); if (!r.length) return "";
  const done = r.filter(x => x.end).length;
  return (done > 1 ? `${done}× gelesen` : done === 1 ? "1× gelesen" : "") ;
}
function lastReadDate(b) { return readsOf(b).map(x => x.end || x.start || "").sort().pop() || ""; }
function readsEditor(book, onChange) {
  const box = el("div", { class: "reads" });
  const draw = () => {
    const reads = readsOf(book);
    fillNode(box,
      el("label", { class: "lbl", text: "Gelesen (auch mehrfach)" }),
      ...reads.map((r, i) => {
        const upd = (k, v) => { const rr = readsOf(book).map(x => ({ ...x })); rr[i][k] = v; book.reads = rr; onChange({ reads: rr }); };
        const st = el("input", { class: "field", type: "date", value: r.start || "", title: "Angefangen" }); st.addEventListener("change", () => upd("start", st.value));
        const en = el("input", { class: "field", type: "date", value: r.end || "", title: "Beendet" }); en.addEventListener("change", () => upd("end", en.value));
        const nt = el("input", { class: "field", value: r.note || "", placeholder: "Notiz, z. B. im Urlaub, Hörbuch …" }); nt.addEventListener("change", () => upd("note", nt.value));
        return el("div", { class: "readrow" },
          el("span", { class: "readno", text: (i + 1) + "." }),
          el("div", { class: "readf" }, el("small", { text: "angefangen" }), st), el("div", { class: "readf" }, el("small", { text: "beendet" }), en),
          el("button", { class: "btn sm ghost danger", type: "button", title: "Diesen Durchgang entfernen", onclick: () => { const rr = readsOf(book).filter((_, j) => j !== i); book.reads = rr; onChange({ reads: rr }); box.dispatchEvent(new Event("input", { bubbles: true })); draw(); } }, "✕"),
          el("div", { class: "readnote" }, nt));
      }),
      el("button", { class: "btn sm", type: "button", onclick: () => { const rr = [...readsOf(book).map(x => ({ ...x })), { start: today(), end: "", note: "" }]; book.reads = rr; onChange({ reads: rr }); box.dispatchEvent(new Event("input", { bubbles: true })); draw(); } }, reads.length ? "＋ Noch einmal gelesen" : "＋ Lesedatum eintragen"));
  };
  draw(); box._redraw = draw;
  return box;
}

/* ================= „Hatte ich mal“ ================= */
const GONE = { verschenkt: "Verschenkt an", gespendet: "Gespendet an", verkauft: "Verkauft an", getauscht: "Getauscht mit", verloren: "Verloren", aussortiert: "Aussortiert", sonstiges: "Sonstiges" };
const GONE_TO = { verschenkt: true, gespendet: true, verkauft: true, getauscht: true };
const isGone = b => !!(b && b.gone);
function goneText(g) { if (!g) return ""; return [(GONE[g.how] || "Weg") + (GONE_TO[g.how] && g.to ? " " + g.to : ""), g.date ? fmtD(g.date) : ""].filter(Boolean).join(" · "); }
function goneFields(g, onChange) { // g wird direkt verändert
  const how = el("select", { class: "field", style: "width:100%" }, ...Object.entries(GONE).map(([k, l]) => el("option", { value: k, selected: g.how === k || null }, l.replace(/ (an|mit)$/, ""))));
  const to = el("input", { class: "field", value: g.to || "", placeholder: "z. B. Anna, Stadtbibliothek, Bücherschrank am Markt" });
  const toWrap = el("div", { class: "c4" }, el("label", { class: "lbl", text: "An wen / wohin?" }), to);
  const date = el("input", { class: "field", type: "date", value: g.date || "" });
  const note = el("textarea", { class: "field", rows: 2, placeholder: "Kommentar, z. B. „zum Geburtstag“, „Flohmarkt 5 €“" }); note.value = g.note || "";
  const sync = () => { g.how = how.value; g.to = to.value.trim(); g.date = date.value; g.note = note.value; toWrap.style.display = GONE_TO[g.how] ? "" : "none"; onChange && onChange(); };
  [how, to, date, note].forEach(x => x.addEventListener("input", sync)); how.addEventListener("change", sync);
  toWrap.style.display = GONE_TO[g.how] ? "" : "none";
  return el("div", { class: "fgrid" },
    el("div", { class: "c2" }, el("label", { class: "lbl", text: "Was ist passiert?" }), how), toWrap,
    el("div", { class: "c2" }, el("label", { class: "lbl", text: "Wann?" }), date),
    el("div", { class: "c4" }, el("label", { class: "lbl", text: "Kommentar" }), note));
}
function goneDialog(b) {
  return new Promise(res => {
    const g = { how: "verschenkt", to: "", date: today(), note: "", ...(b.gone || {}) };
    const loc = locationOf(b.id);
    const done = v => { box.remove(); res(v); };
    const box = el("div", { class: "overlay confirm", style: "z-index:70;align-items:center", onclick: e => { if (e.target === box) done(null); } },
      el("div", { class: "sheet", style: "max-width:520px;border-radius:16px" },
        el("div", { class: "sheet-h" }, el("h2", { text: "📦 Hatte ich mal" }), el("button", { class: "x", onclick: () => done(null) }, "✕")),
        el("div", { class: "sheet-b" },
          el("p", { class: "saved", style: "margin-top:0", text: `„${b.title}“ bleibt mit allen Notizen erhalten, erscheint aber ausgegraut in der Liste „Hatte ich mal“.` + (loc ? " Aus dem echten Regal wird es herausgenommen." : "") }),
          goneFields(g),
          el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: () => done(null) }, "Abbrechen"), el("button", { class: "btn primary", onclick: () => done(g) }, "Speichern")))));
    document.body.append(box);
  });
}
async function markGone(b) {
  const g = await goneDialog(b); if (!g) return false;
  if (unshelve(b.id)) await saveShelves();
  await patchBook(b.id, { gone: g });
  toast("Steht jetzt unter „Hatte ich mal“.");
  return true;
}

/* ================= Detailseite: Bearbeiten (mit Speichern-Knopf) ================= */
function drawDetailEdit(sh, b, keep) {
  const draft = keep ? keep.draft : { ...b };
  const st = keep ? keep.st : { dirty: false, coverChanged: false, previewUrl: null };
  sh.h2.textContent = "Bearbeiten: " + (b.title || "Buch");
  const saveBtn = el("button", { class: "btn primary", disabled: !st.dirty || null }, "💾 Speichern");
  const dirtyInfo = el("span", { class: "saved", text: st.dirty ? "Ungespeicherte Änderungen" : "" });
  const markDirty = () => { st.dirty = true; saveBtn.disabled = false; dirtyInfo.textContent = "Ungespeicherte Änderungen"; };
  sh.guard = async () => !st.dirty || await confirmBox("Du hast ungespeicherte Änderungen.\nWirklich verwerfen?", "Verwerfen");

  // --- Cover
  const coverBox = el("div", {});
  const curSrc = () => draft.coverBlob ? (st.previewUrl || (st.previewUrl = URL.createObjectURL(draft.coverBlob))) : (draft.coverUrl || null);
  const drawCover = () => { const src = curSrc(); const c = coverEl(draft, { src }); if (src) c.addEventListener("click", () => lightbox(src)); coverBox.replaceChildren(c); };
  const setPhoto = async (f, keepOrig) => {
    try {
      draft.coverBlob = await coverBlobFromFile(f);
      if (keepOrig !== true) { st.coverOrig = f; st.quads = null; }
      st.coverFrom = draft.coverBlob; // das Originalfoto gehört zu genau diesem Cover
      draft.coverUrl = ""; st.previewUrl = null; st.coverChanged = true; markDirty();
      personal._flush && personal._flush(); drawDetailEdit(sh, b, { draft, st });
    } catch { toast("Bild konnte nicht gelesen werden."); }
  };
  S.pasteHandler = setPhoto;
  // Zuschneiden/Entzerren aus dem zuletzt gewählten Foto (sonst aus dem vorhandenen Cover); auch den Rücken
  const cropCover = async () => {
    const own = st.coverOrig && st.coverFrom === draft.coverBlob;
    const src = own ? st.coverOrig : draft.coverBlob; if (!src) return;
    if (!own) st.quads = null;
    const r = await quadEditor(src, { cover: st.quads?.cover, spine: st.quads?.spine, withSpine: true }); if (!r) return;
    st.quads = r; st.coverOrig = src; // nochmal zuschneiden geht vom selben Ausgangsbild aus
    try {
      if (r.spine) { draft.spine = await spineWithPhoto(draft, await warpQuad(src, r.spine, SPINE_MAX)); }
      await setPhoto(await warpQuad(src, r.cover, 1200), true);
    } catch { toast("Zuschneiden hat nicht geklappt."); }
  };
  const onlineCover = async btn => {
    btn.disabled = true; btn.textContent = "Suche …";
    try {
      const cands = await coverCandidates(draft);
      const d = decideCover(cands);
      let pick = d.kind === "sure" ? d.c : await coverPickDialog(draft, cands, { skipLabel: "Keins davon" });
      if (!pick) return;
      if (pick.ownFile) { await setPhoto(pick.ownFile); return; }
      draft.coverBlob = pick.blob; draft.coverUrl = pick.url; st.previewUrl = null; st.coverChanged = true; markDirty(); drawCover();
      if (d.kind === "sure") toast("Cover gefunden (" + pick.reason + ") – mit Speichern übernehmen.");
    } catch { toast("Keine Internetverbindung."); }
    finally { btn.disabled = false; btn.textContent = "🌐 Online-Cover"; }
  };
  drawCover();
  const m = isMobile();
  const coverControls = el("div", { class: "covertools" },
    m ? el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(true); if (f) setPhoto(f); } }, "📷 Foto") : null,
    el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(false); if (f) setPhoto(f); } }, m ? "Galerie" : "🖼 Bild wählen"),
    el("button", { class: "btn sm", type: "button", onclick: e => onlineCover(e.currentTarget) }, "🌐 Online-Cover"),
    el("button", { class: "btn sm", type: "button", onclick: async () => { const pick = await coverPickDialog(draft, [], { skipLabel: "Keins davon", google: true, title: "Cover per Bildersuche" }); if (!pick) return; if (pick.ownFile) { setPhoto(pick.ownFile); return; } draft.coverBlob = pick.blob; draft.coverUrl = pick.url || ""; st.previewUrl = null; st.coverChanged = true; markDirty(); drawCover(); } }, "🔍 Bildersuche"),
    draft.coverBlob ? el("button", { class: "btn sm", type: "button", onclick: cropCover }, "✂ Zuschneiden") : null,
    (draft.coverBlob || draft.coverUrl) ? el("button", { class: "btn sm ghost danger", type: "button", onclick: () => { draft.coverBlob = null; draft.coverUrl = ""; st.previewUrl = null; st.coverChanged = true; markDirty(); drawDetailEdit(sh, b, { draft, st }); } }, "Entfernen") : null);
  const coverDrop = m ? null : dropZone("Bild hierher ziehen oder Strg+V", setPhoto);
  if (coverDrop) coverDrop.style.cssText = "padding:8px;font-size:12px;margin-top:8px";

  // --- Persönliches & Buchdaten (ändern nur den Entwurf)
  const personal = personalSection(draft, patch => { Object.assign(draft, patch); markDirty(); });
  personal.addEventListener("input", markDirty);
  const form = dataForm(draft, (k, v) => { draft[k] = v; markDirty(); });

  const fillBtn = el("button", { class: "btn sm", type: "button" }, "🔎 Leere Felder online ergänzen");
  fillBtn.addEventListener("click", async () => {
    personal._flush && personal._flush();
    fillBtn.disabled = true; fillBtn.textContent = "Suche …";
    const rec = await findOnline(draft).catch(() => "offline");
    if (rec === "offline") { toast("Keine Internetverbindung."); fillBtn.disabled = false; fillBtn.textContent = "🔎 Leere Felder online ergänzen"; return; }
    if (!rec) { toast("Online nichts Passendes gefunden."); fillBtn.disabled = false; fillBtn.textContent = "🔎 Leere Felder online ergänzen"; return; }
    const got = [];
    for (const f of FIELDS) if (!String(draft[f.k] ?? "").trim() && rec[f.k]) { draft[f.k] = rec[f.k]; got.push(f.l); }
    if (!draft.coverBlob && !draft.coverUrl && rec.coverUrl) { draft.coverUrl = rec.coverUrl; st.coverChanged = true; got.push("Cover"); }
    const hsp = spineWithHeight(draft, rec); if (hsp) { draft.spine = hsp; got.push(`Höhe (${String(hsp.heightCm).replace(".", ",")} cm)`); }
    if (got.length) { markDirty(); toast("Ergänzt (noch nicht gespeichert): " + got.join(", "), 4000); drawDetailEdit(sh, b, { draft, st }); }
    else { toast("Nichts Neues gefunden."); fillBtn.disabled = false; fillBtn.textContent = "🔎 Leere Felder online ergänzen"; }
  });
  const reloadBtn = el("button", { class: "btn sm", type: "button" }, "↻ Alles per ISBN neu laden");
  reloadBtn.addEventListener("click", async () => {
    const i = toIsbn13(draft.isbn);
    if (!i) { toast("Dafür braucht es eine gültige ISBN."); return; }
    if (!(await confirmBox("Titel, Autor, Jahr, Verlag, Seiten, Genre, Sprache und Zusammenfassung werden mit den Online-Daten zu dieser ISBN überschrieben (nur wo online etwas vorhanden ist).\nDeine Notizen, Bewertung und dein Lesestatus bleiben.", "Überschreiben"))) return;
    personal._flush && personal._flush();
    let rec = null; try { rec = await lookupIsbn(i); } catch { toast("Keine Internetverbindung."); return; }
    if (!rec) { toast("Zu dieser ISBN wurde online nichts gefunden."); return; }
    for (const f of FIELDS) if (rec[f.k]) draft[f.k] = rec[f.k];
    const hsp = spineWithHeight(draft, rec); if (hsp) draft.spine = hsp; // Höhe nur, wenn noch keine eingetragen ist
    markDirty(); toast("Übernommen – prüfen und speichern.", 3000); drawDetailEdit(sh, b, { draft, st });
  });

  // --- Speichern / Abbrechen
  const doSave = async () => {
    personal._flush && personal._flush();
    if (!String(draft.title || "").trim()) { toast("Bitte einen Titel eintragen."); return; }
    const dup = findDuplicate(draft, b.id);
    if (dup && !(await confirmBox(`„${dup.title}“ mit diesen Angaben steht schon in deinem Regal.\nTrotzdem speichern?`, "Speichern"))) return;
    saveBtn.disabled = true; saveBtn.textContent = "Speichere …";
    try {
      const out = { ...S.books.find(x => x.id === b.id), ...draft };
      out.isbn = toIsbn13(out.isbn) || String(out.isbn || "").trim();
      for (const f of FIELDS) if (typeof out[f.k] === "string") out[f.k] = out[f.k].trim();
      if (st.coverChanged && !out.coverBlob && out.coverUrl) { const blob = await fetchCoverBlob(out.coverUrl); if (blob) out.coverBlob = blob; }
      if (!out.coverBlob) delete out.coverBlob;
      if ((out.gone || out.wish) && unshelve(out.id)) await saveShelves();
      if (!out.wish) delete out.wish;
      await commitAttachments(out.id, st);
      await putBook(out);
      st.dirty = false; sh.guard = null;
      toast("✓ Gespeichert");
      drawDetailView(sh, S.books.find(x => x.id === b.id));
    } catch (e) { console.error(e); toast("Speichern fehlgeschlagen."); saveBtn.disabled = false; saveBtn.textContent = "💾 Speichern"; }
  };
  saveBtn.addEventListener("click", doSave);
  const cancel = async () => { if (await sh.guard()) { st.dirty = false; drawDetailView(sh, S.books.find(x => x.id === b.id)); } };
  sh.onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (st.dirty) doSave(); } };

  const goneState = { on: isGone(draft), g: { how: "verschenkt", to: "", date: today(), note: "", ...(draft.gone || {}) } };
  const goneBody = el("div", { style: "margin-top:10px" }, goneFields(goneState.g, () => { draft.gone = goneState.on ? { ...goneState.g } : null; markDirty(); }));
  const goneCb = el("input", { type: "checkbox", checked: goneState.on || null, style: "width:18px;height:18px;accent-color:var(--accent)" });
  const syncGone = () => { goneState.on = goneCb.checked; goneBody.style.display = goneState.on ? "" : "none"; draft.gone = goneState.on ? { ...goneState.g } : null; };
  goneCb.addEventListener("change", () => { syncGone(); markDirty(); });
  goneBody.style.display = goneState.on ? "" : "none";
  const spPrev = el("div", { class: "spmini" });
  const spInfo = el("p", { class: "saved", style: "margin:0 0 8px" });
  const drawSpPrev = () => { fillNode(spPrev, spineMini(draft, "draft-" + b.id)); spInfo.textContent = draft.spine?.imageBlob ? "Mit eigenem Foto." : draft.spine ? "Individuell gestaltet." : "Automatisch: Farbe aus dem Cover, Dicke aus der Seitenzahl."; };
  drawSpPrev();
  const setSpinePhoto = async f => {
    try { draft.spine = await spineWithPhoto(draft, f); markDirty(); drawSpPrev(); toast("Rückenfoto übernommen – mit Speichern sichern.", 2400); }
    catch { toast("Bild konnte nicht gelesen werden."); }
  };
  const spineSec = el("div", { class: "sec" }, el("h3", { text: "Buchrücken (echtes Regal)" }),
    el("div", { style: "display:flex;gap:14px;align-items:flex-end" }, spPrev,
      el("div", {}, spInfo,
        el("div", { class: "covertools" }, ...spinePhotoButtons(setSpinePhoto),
          el("button", { class: "btn sm", type: "button", onclick: () => spineEditor(draft, sp => { draft.spine = sp; markDirty(); drawSpPrev(); }) }, "🎨 Gestalten")))));
  const wishCb = el("input", { type: "checkbox", checked: isWish(draft) || null, style: "width:18px;height:18px;accent-color:var(--accent)" });
  wishCb.addEventListener("change", () => { draft.wish = wishCb.checked; if (draft.wish && goneCb.checked) { goneCb.checked = false; syncGone(); } markDirty(); });
  const goneSec = el("div", { class: "sec" }, el("h3", { text: "Besitz" }),
    el("label", { class: "prow", style: "border:1px solid var(--line);border-radius:10px;margin-bottom:8px" }, wishCb, el("span", {}, el("b", { text: "⭐ Wunschliste" }), el("div", { class: "saved", text: "Besitze ich (noch) nicht – getrennt vom Bestand, nicht im echten Regal." }))),
    el("label", { class: "prow", style: "border:1px solid var(--line);border-radius:10px" }, goneCb, el("span", {}, el("b", { text: "📦 Hatte ich mal" }), el("div", { class: "saved", text: "Verschenkt, gespendet, verkauft … – das Buch wird ausgegraut in einer eigenen Liste gezeigt und aus dem echten Regal genommen." }))),
    goneBody);
  const signSec = signEdit(draft, markDirty);
  const extrasSec = extrasEdit(draft, st, markDirty);
  fillNode(sh.body,
    el("div", { class: "dtop edit" }, el("div", { class: "dcover" }, coverBox, coverControls, coverDrop), el("div", {}, personal)),
    el("div", { class: "sec" }, el("h3", { text: "Buchdaten" }), form,
      el("label", { class: "lbl", style: "margin-top:12px", text: "Schlagworte" }), tagEditor(draft, () => markDirty()),
      el("div", { class: "covertools", style: "margin-top:12px" }, fillBtn, reloadBtn),
      webSearchLinks([draft.title, draft.author].filter(Boolean).join(" "), draft.isbn, draft.title, draft.author)),
    signSec,
    extrasSec,
    spineSec,
    goneSec,
    el("div", { class: "actions sticky" },
      el("button", { class: "btn ghost", onclick: cancel }, "Abbrechen"),
      el("div", { style: "display:flex;gap:12px;align-items:center" }, dirtyInfo, saveBtn))
  );
}
async function findOnline(b) {
  const i = toIsbn13(b.isbn);
  let rec = i ? await lookupIsbn(i) : null;
  if (!rec && b.title) {
    const list = await searchBooks([b.title, b.author].filter(Boolean).join(" "));
    const t = b.title.toLowerCase().slice(0, 12);
    rec = list.find(r => r.title.toLowerCase().startsWith(t)) || null;
    if (rec?.isbn) { const full = await lookupIsbn(rec.isbn).catch(() => null); if (full) rec = merge(rec, full); }
  }
  return rec;
}

/* ================= Fehlende Daten nachladen ================= */
async function fillMissing(id, btn) {
  const b = S.books.find(x => x.id === id); if (!b) return;
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  try {
    const rec = await findOnline(b);
    if (!rec) { toast("Online nichts Passendes gefunden."); return; }
    const patch = {};
    for (const f of FIELDS) if (!String(b[f.k] ?? "").trim() && rec[f.k]) patch[f.k] = rec[f.k];
    const hsp = spineWithHeight(b, rec); if (hsp) patch.spine = hsp;
    if (needsCover(b) && rec.coverUrl) { const blob = await fetchCoverBlob(rec.coverUrl); if (blob) { patch.coverUrl = rec.coverUrl; patch.coverBlob = blob; S.badCover.delete(b.id); } else if (await imgOk(rec.coverUrl)) { patch.coverUrl = rec.coverUrl; S.badCover.delete(b.id); } }
    if (!Object.keys(patch).length) { toast("Nichts Neues gefunden."); return; }
    await patchBook(id, patch);
    toast("Ergänzt: " + Object.keys(patch).filter(k => k !== "coverBlob").map(k => k === "coverUrl" ? "Cover" : k === "spine" ? "Höhe" : FIELDS.find(f => f.k === k).l).join(", "));
  } catch { toast("Keine Internetverbindung."); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "🔎"; } }
}
/* Sammellauf: Buchhöhen aus der DNB für Bücher mit ISBN und ohne Höhe – nacheinander, mit Pause, abbrechbar. */
async function heightRun() {
  const ids = S.books.filter(b => !isWish(b) && toIsbn13(b.isbn) && !+b.spine?.heightCm).map(b => b.id);
  if (!ids.length) { toast("Alle Bücher mit ISBN haben schon eine Höhe."); return; }
  const sh = sheet("📏 Buchhöhen aus der DNB");
  const bar = el("div", { class: "progress" }, el("div", {}));
  const status = el("div", { class: "saved" });
  const log = el("div", { class: "covlog" });
  let stop = false, set = 0, none = 0;
  const stopBtn = el("button", { class: "btn", onclick: () => { stop = true; stopBtn.disabled = true; stopBtn.textContent = "Wird beendet …"; } }, "Anhalten");
  fillNode(sh.body,
    el("p", { style: "margin-top:0", text: `${ids.length} ${ids.length === 1 ? "Buch" : "Bücher"} mit ISBN ohne Höhe. Die App fragt die Deutsche Nationalbibliothek nacheinander – selbst gemessene Höhen bleiben unverändert.` }),
    bar, status, log, el("div", { class: "actions" }, stopBtn, el("span")));
  sh.guard = async () => { stop = true; return true; };
  const row = (b, txt, cls) => log.prepend(el("div", { class: "covrow " + (cls || "") }, el("span", { text: txt }), el("b", { text: b.title || "Ohne Titel" })));
  for (let i = 0; i < ids.length && !stop; i++) {
    const b = S.books.find(x => x.id === ids[i]); if (!b || +b.spine?.heightCm) continue;
    bar.firstChild.style.width = Math.round(i / ids.length * 100) + "%";
    status.textContent = `${i + 1} / ${ids.length}: „${b.title}“`;
    const isbn = toIsbn13(b.isbn);
    let recs; try { recs = await dnbQuery(`num=${isbn}`, 3); } catch { row(b, "⚠ offline", "warn"); break; }
    const rec = recs.find(r => r.isbn === isbn) || recs[0];
    const cur = S.books.find(x => x.id === b.id); // kann sich inzwischen geändert haben
    const sp = cur && spineWithHeight(cur, rec);
    if (sp) { await patchBook(b.id, { spine: sp }); set++; row(b, `✓ ${String(sp.heightCm).replace(".", ",")} cm`, "ok"); }
    else { none++; row(b, "– keine Angabe", "none"); }
    if (!stop && i < ids.length - 1) await new Promise(r => setTimeout(r, S.heightPause ?? 400)); // schonend
  }
  bar.firstChild.style.width = "100%";
  sh.guard = null;
  status.textContent = `Fertig: ${set} Höhen nachgetragen, ${none} ohne Angabe.` + (stop ? " (angehalten)" : "");
  sh.body.querySelector(".actions").replaceWith(el("div", { class: "actions" }, el("span"), el("button", { class: "btn primary", onclick: closeSheet }, "Schließen")));
  renderAll();
}

/* ================= Echtes Regal (Montana-Würfel) ================= */
// Maße laut Montana: 6112 = B 69,6 × H 35,4 × T 30 cm (2 Fächer, auch hochkant), 1112 = B 69,6 × H 69,6 × T 38 cm (4 Fächer).
// Platten 12 mm → jedes Fach innen ca. 33 × 33 cm.
const MOD = {
  "6112": { name: "2er-Würfel", model: "Montana 6112", w: 69.6, h: 35.4, d: 30 },
  "1112": { name: "4er-Würfel", model: "Montana 1112", w: 69.6, h: 69.6, d: 38 },
  "gap": { name: "Lücke", w: 69.6, h: 35.4, d: 0 },
};
const FACH_LABEL = { L: "links", R: "rechts", T: "oben", B: "unten", TL: "oben links", TR: "oben rechts", BL: "unten links", BR: "unten rechts" };
const LAYER_LABEL = { front: "", back: "hintere Reihe", top: "liegt oben auf der Reihe" };
const BOARD = 1.2, FACH_W = 33.0, FACH_H = 33.0;
const BACK_RISE = 1.6; // hintere Reihe steht so viele cm höher als die vordere
const MOD_COLORS = [["Weiß", "#f3f2ee"], ["Hellgrau", "#d6d4cf"], ["Anthrazit", "#3a3a3a"], ["Ruby", "#7d2630"], ["Salbei", "#a7b4a0"], ["Blau", "#3f5d7d"], ["Senf", "#d9a640"]];
S.shelves = { walls: [], updatedAt: "" }; S.wallId = null; S.pick = null; S.wallEdit = false; S.zoom = 1; S.highlight = null; S.wq = ""; S.showBack = new Set(); S.pickMany = null; S.selMode = false; S.sel = new Set(); S.lens = false;
S.ovZoom = 1; S.anchor = null; S.zoomFocus = null; S.wallReset = false; // Gesamtansicht, Zoom, Ansicht beim Neuzeichnen halten
try { S.overview = localStorage.getItem("wallOverview") === "1"; } catch { S.overview = false; }
// Bücherliste eingeklappt (S.sideClosed) und Großansicht (S.wallBig: ganze Fensterbreite, Liste eingeklappt) – nur auf diesem Gerät
try { S.sideClosed = localStorage.getItem("wallSideClosed") === "1"; S.wallBig = localStorage.getItem("wallBig") === "1"; } catch { S.sideClosed = false; S.wallBig = false; }
const sideClosed = () => S.wallBig || S.sideClosed;
function setSideClosed(on) { S.sideClosed = on; if (!on) S.wallBig = false; try { localStorage.setItem("wallSideClosed", on ? "1" : ""); localStorage.setItem("wallBig", S.wallBig ? "1" : ""); } catch {} S.wallReset = true; renderAll(); }
function setWallBig(on) { S.wallBig = on; try { localStorage.setItem("wallBig", on ? "1" : ""); } catch {} S.wallReset = true; renderAll(); }
// Reihenfolge der Wände (Auswahlliste, Gesamtansicht) – ganze Wände mit der Nachbarwand tauschen
async function moveWall(w, d) {
  const a = S.shelves.walls, i = a.indexOf(w), j = i + d; if (i < 0 || j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  await saveShelves(); renderWall(); toast(`„${w.name}“ ist jetzt Wand ${j + 1} von ${a.length}.`, 2000);
}
function setOverview(on) { S.overview = on; S.wallReset = true; if (on) S.wallEdit = false; try { localStorage.setItem("wallOverview", on ? "1" : ""); } catch {} renderWall(); }

const upright = m => m.type !== "1112" && m.orient === "v";
function modDims(m) { const d = MOD[m.type]; return upright(m) ? { w: d.h, h: d.w } : { w: d.w, h: d.h }; }
function modLayout(m) {
  if (m.type === "gap") return { keys: [], cols: 0, rows: 0 };
  if (m.type === "1112") return { keys: ["TL", "TR", "BL", "BR"], cols: 2, rows: 2 };
  return upright(m) ? { keys: ["T", "B"], cols: 1, rows: 2 } : { keys: ["L", "R"], cols: 2, rows: 1 };
}
function modName(m) { return MOD[m.type].name + (m.type === "6112" && upright(m) ? " (hochkant)" : ""); }
function ensureLayers(m) { m.fachs = m.fachs || {}; m.back = m.back || {}; m.top = m.top || {}; for (const k of modLayout(m).keys) { m.fachs[k] = m.fachs[k] || []; m.back[k] = m.back[k] || []; m.top[k] = m.top[k] || []; } }
function layerList(m, k, layer) { ensureLayers(m); return layer === "back" ? m.back[k] : layer === "top" ? m.top[k] : m.fachs[k]; }
function modBookCount(m) { ensureLayers(m); return [m.fachs, m.back, m.top].reduce((a, o) => a + Object.values(o).flat().length, 0); }
const isLying = id => !!(S.shelves.lying && S.shelves.lying[id]);
function setLying(id, v) { S.shelves.lying = S.shelves.lying || {}; if (v) S.shelves.lying[id] = true; else delete S.shelves.lying[id]; }
// „Fach ist voll“: Reihe gleichmäßig auf die Fachbreite verteilen (m.fit = { L: true, "L:back": true }, optional)
const fitKey = (k, layer) => layer === "back" ? k + ":back" : k;
const isFit = (m, k, layer) => layer !== "top" && !!(m.fit && m.fit[fitKey(k, layer)]);
function setFit(m, k, layer, v) { m.fit = m.fit || {}; if (v) m.fit[fitKey(k, layer)] = true; else delete m.fit[fitKey(k, layer)]; if (!Object.keys(m.fit).length) delete m.fit; }
// Ausgewählte Bücher in Regal-Reihenfolge (danach nicht eingeräumte in Auswahl-Reihenfolge)
function orderedSel() {
  const seen = new Set(), out = [];
  for (const f of allFachs()) for (const id of f.list) if (S.sel.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  for (const id of S.sel) if (!seen.has(id) && bookOf(id)) out.push(id);
  return out;
}
const picking = () => S.pickMany?.length ? S.pickMany : S.pick ? [S.pick] : null;
const endPick = () => { S.pick = null; S.pickMany = null; };

async function saveShelves() { S.shelves.updatedAt = new Date().toISOString(); await DB.setMeta("shelves", S.shelves); dataChanged(); }
function curWall() { return S.shelves.walls.find(w => w.id === S.wallId) || S.shelves.walls[0] || null; }
function newModule(type, color) { const m = { id: uid().slice(0, 8), type, color: color || "#f3f2ee", orient: "h" }; ensureLayers(m); return m; }
function allFachs() {
  const out = [];
  for (const w of S.shelves.walls) w.columns.forEach((c, ci) => c.modules.forEach((m, mi) => {
    for (const k of modLayout(m).keys) for (const layer of ["front", "back", "top"]) out.push({ w, c, ci, m, mi, k, layer, list: layerList(m, k, layer) });
  }));
  return out;
}
function locationOf(id) { for (const f of allFachs()) { const i = f.list.indexOf(id); if (i >= 0) return { ...f, pos: i }; } return null; }
function locationText(loc) {
  const p = [loc.w.name];
  if (loc.w.columns.length > 1) p.push("Spalte " + (loc.ci + 1));
  if (loc.c.modules.length > 1) p.push((loc.mi + 1) + ". Würfel von oben");
  p.push(modName(loc.m) + ", Fach " + FACH_LABEL[loc.k]);
  if (loc.layer === "top") p.push("liegt oben auf der Reihe (" + (loc.list.length - loc.pos) + ". von oben)");
  else p.push((loc.layer === "back" ? "hintere Reihe, " : "") + (loc.pos + 1) + ". von links" + (isLying(loc.m && loc.list[loc.pos]) ? " (liegend)" : ""));
  return p.join(" · ");
}
function locationShort(loc) { return `${loc.w.name}${loc.w.columns.length > 1 ? " · Sp. " + (loc.ci + 1) : ""}${loc.c.modules.length > 1 ? " · W" + (loc.mi + 1) : ""} · ${FACH_LABEL[loc.k]}${loc.layer === "back" ? " · hinten" : loc.layer === "top" ? " · oben drauf" : ""} · #${loc.pos + 1}`; }
function unshelve(id) { let ch = false; for (const f of allFachs()) { let i; while ((i = f.list.indexOf(id)) >= 0) { f.list.splice(i, 1); ch = true; } } return ch; }
async function placeBook(id, mod, k, index, layer = "front") { return placeBooks([id], mod, k, index, layer); }
// Mehrere Bücher (in dieser Reihenfolge) vor das Buch an Stelle `index` stellen – oder ans Ende
async function placeBooks(ids, mod, k, index, layer = "front") {
  ids = [...new Set(ids)].filter(id => bookOf(id)); if (!ids.length) return;
  const list = layerList(mod, k, layer);
  if (index == null) index = list.length;
  let anchor = null; for (let i = Math.max(0, index); i < list.length; i++) if (!ids.includes(list[i])) { anchor = list[i]; break; }
  ids.forEach(unshelve);
  if (layer === "top") ids.forEach(id => setLying(id, false));
  list.splice(anchor ? list.indexOf(anchor) : list.length, 0, ...ids);
  await saveShelves();
  const b = bookOf(ids[0]);
  const u = fachUsage(mod, k);
  const what = layer === "top" ? "oben aufgelegt" : layer === "back" ? "in die hintere Reihe gestellt" : "eingeräumt";
  toast((ids.length === 1 ? `„${b?.title || "Buch"}“ ${what}` : `${ids.length} Bücher ${what}`) + (u.full ? " – das Fach ist rechnerisch voll." : "."), 2200);
}
function locationBlock(id) {
  const loc = locationOf(id);
  const go = (pick) => { closeSheet(); if (pick) S.pick = id; else { S.highlight = id; S.wallId = loc.w.id; if (loc.layer === "back") S.showBack.add(loc.m.id + ":" + loc.k); } if (location.hash === "#wand") renderAll(); else location.hash = "#wand"; };
  return el("div", { class: "sec" }, el("h3", { text: "Standort" }),
    el("div", { class: "meta", style: "margin-bottom:8px", text: loc ? locationText(loc) : "Noch nicht im echten Regal eingeräumt." }),
    el("div", { class: "covertools" },
      loc ? el("button", { class: "btn sm", onclick: () => go(false) }, "📍 Im Regal zeigen") : null,
      el("button", { class: "btn sm", onclick: () => go(true) }, loc ? "↔ Umstellen" : "📚 Einräumen"),
      el("button", { class: "btn sm", onclick: () => editSpineDirect(S.books.find(x => x.id === id)) }, "🎨 Buchrücken"),
      loc ? el("button", { class: "btn sm", onclick: async e => { unshelve(id); setLying(id, false); await saveShelves(); renderAll(); toast("Zurück in „Noch nicht eingeräumt“."); const blk = e.target.closest(".sec"); if (blk) blk.replaceWith(locationBlock(id)); } }, "↩ Aus dem Regal nehmen") : null));
}

/* Buchrücken: Dicke aus Seitenzahl geschätzt, Höhe variiert leicht, Farbe aus dem Cover */
function spineCm(b) { const p = +b.pages || 0; const sp = b.spine || {}; return { w: +sp.thickCm || (p ? Math.min(7, Math.max(0.8, p * 0.0058 + 0.35)) : 2.2), h: +sp.heightCm || 18 + (hue(b.id || b.title) % 60) / 10 }; }
const bookOf = id => S.books.find(x => x.id === id);
function rowGroups(ids) { // fasst aufeinanderfolgende liegende Bücher zu Stapeln zusammen
  const g = []; ids.forEach((id, i) => { const b = bookOf(id); if (!b) return; if (isLying(id) && g.length && g[g.length - 1].lying) g[g.length - 1].items.push({ b, i }); else g.push({ lying: isLying(id), items: [{ b, i }] }); });
  return g;
}
const fitF = (fit, b) => !fit ? 1 : (+b.spine?.thickCm ? fit.meas : fit.est);
function rowMetrics(ids, fit) { // Breite und größte Höhe einer Reihe in cm
  let w = 0, h = 0;
  for (const g of rowGroups(ids)) {
    if (g.lying) { w += Math.max(...g.items.map(x => spineCm(x.b).h)); h = Math.max(h, g.items.reduce((a, x) => a + spineCm(x.b).w, 0)); }
    else for (const x of g.items) { const c = spineCm(x.b); w += c.w * fitF(fit, x.b); h = Math.max(h, c.h); }
  }
  return { w, h };
}
// Streckfaktoren für eine „volle“ Reihe: selbst gemessene Dicken bleiben, geschätzte füllen den Rest
function rowFit(m, k, layer) {
  if (!isFit(m, k, layer)) return null;
  let lie = 0, est = 0, meas = 0;
  for (const g of rowGroups(layerList(m, k, layer))) {
    if (g.lying) lie += Math.max(...g.items.map(x => spineCm(x.b).h));
    else for (const x of g.items) { const w = spineCm(x.b).w; if (+x.b.spine?.thickCm) meas += w; else est += w; }
  }
  const room = FACH_W - 0.6 - lie, clamp = f => Math.max(0.25, Math.min(8, f));
  if (est > 0 && room - meas > 0) return { est: clamp((room - meas) / est), meas: 1 };
  if (est + meas > 0 && room > 0) { const f = clamp(room / (est + meas)); return { est: f, meas: f }; }
  return null;
}
function fachUsage(m, k) {
  const f = rowMetrics(layerList(m, k, "front"), rowFit(m, k, "front")), b = rowMetrics(layerList(m, k, "back"), rowFit(m, k, "back"));
  const topH = layerList(m, k, "top").reduce((a, id) => { const x = bookOf(id); return a + (x ? spineCm(x).w : 0); }, 0);
  return { front: f, back: b, topH, full: f.w > FACH_W || b.w > FACH_W || f.h + topH > FACH_H };
}
const spineCol = new Map();
function spineColor(b) {
  if (spineCol.has(b.id)) return spineCol.get(b.id);
  const h = hue((b.title || "") + (b.author || ""));
  const fb = { bg: `hsl(${h} 32% 38%)`, fg: "#fff" };
  spineCol.set(b.id, fb);
  if (b.coverBlob) avgColor(b.coverBlob).then(c => { if (c) { spineCol.set(b.id, c); scheduleWall(); } });
  return fb;
}
async function avgColor(blob) {
  try {
    const bm = await createImageBitmap(blob); const c = document.createElement("canvas"); c.width = c.height = 10;
    const x = c.getContext("2d"); x.drawImage(bm, 0, 0, 10, 10); const d = x.getImageData(0, 0, 10, 10).data;
    let r = 0, g = 0, bl = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; }
    r = r / n | 0; g = g / n | 0; bl = bl / n | 0;
    return { bg: `rgb(${r},${g},${bl})`, fg: (0.299 * r + 0.587 * g + 0.114 * bl) > 150 ? "#2a2420" : "#fff" };
  } catch { return null; }
}
let wT; function scheduleWall() { clearTimeout(wT); wT = setTimeout(renderWall, 60); }
window.addEventListener("resize", () => { if (view() === "wand") scheduleWall(); });

function renderWall() {
  const host = $("#v-wand"); if (!host || host.classList.contains("hidden")) return;
  const w = curWall(); if (w) S.wallId = w.id;
  if (!w) {
    fillNode(host, el("div", { class: "empty" }, el("h2", { text: "Baue dein echtes Regal nach" }),
      el("p", { text: "Lege deine Regalwand mit den Montana-Würfeln an und räume die Bücher so ein, wie sie bei dir stehen – als symbolische Buchrücken." }),
      el("button", { class: "btn primary", onclick: newWallDialog }, "＋ Regalwand anlegen")));
    return;
  }
  const ov = S.overview, walls = ov ? S.shelves.walls : [w];
  const st = S.wallReset ? null : wallViewSave(host); S.wallReset = false;
  // Maßstab: ganze Wand (Gesamtansicht: alle Wände nebeneinander) passt in die Breite – Zoom ändert das
  // verfügbare Breite: Seite − Rand − Seitenleiste (wie im CSS: clamp(290px, 28vw, 380px)) − Abstand; dann Innenabstände und Platz für einen Rollbalken
  // Großansicht: ganze Fensterbreite statt höchstens 1280 px; eingeklappte Liste braucht nur eine schmale Leiste
  const wide = innerWidth >= 900, sideW = Math.min(380, Math.max(290, innerWidth * 0.28)), closed = sideClosed();
  const pageW = S.wallBig ? innerWidth : Math.min(1280, innerWidth), maxS = closed ? 30 : 9; // Liste eingeklappt: Wand füllt die ganze Breite
  const avail = S.wallEdit ? (wide ? pageW : innerWidth) - 36 - 40 // Aufbau: ohne Bücherliste, ganze Breite
    : (wide ? pageW - 36 - (closed ? 44 + 18 : 310) : innerWidth - 36) - 32;
  const ovAvail = (wide ? pageW - 36 - (closed ? 44 : sideW) - 18 : innerWidth - 36) - 40 - 16 * (walls.length - 1);
  const s = ov ? Math.max(0.6, Math.min(maxS, ovAvail / Math.max(walls.reduce((a, x) => a + wallWidthCm(x), 0) + (walls.length - 1) * OV_GAP, 69.6))) * S.ovZoom
    : Math.max(S.wallEdit ? 1.8 : 2.6, Math.min(maxS, avail / Math.max(wallWidthCm(w), 69.6))) * S.zoom;
  const zKey = ov ? "ovZoom" : "zoom";

  const sel = el("select", { class: "field" }, ...S.shelves.walls.map(x => el("option", { value: x.id, selected: x.id === w.id || null }, x.name)));
  sel.addEventListener("change", () => { S.wallId = sel.value; S.wallReset = true; renderWall(); });
  const zoomIn = el("input", { type: "range", class: "zoomrange", min: 25, max: 600, step: 1, value: Math.round(S[zKey] * 100), title: "Vergrößerung (stufenlos) – am Handy auch mit zwei Fingern, am PC mit Strg + Mausrad", "aria-label": "Vergrößerung" });
  const zoomTxt = el("span", { class: "zoomtxt", text: Math.round(S[zKey] * 100) + " %" });
  zoomIn.addEventListener("input", () => { const z = +zoomIn.value / 100; zoomTxt.textContent = zoomIn.value + " %"; wallPreviewZoom(z / S[zKey]); });
  zoomIn.addEventListener("change", () => setWallZoom(+zoomIn.value / 100));
  // Werkzeugleiste: Häufiges direkt, Seltenes unter „⋯ Mehr“; eingeschaltete Ansichten bleiben als „✓ …“ sichtbar
  const ovBtn = () => el("button", { class: "btn sm ovbtn" + (ov ? " primary" : ""), title: "Gesamtansicht: alle Regalwände auf einen Blick, mit Vergrößerung", onclick: () => setOverview(!ov) }, ov ? "✓ Gesamtansicht" : "🗺 Gesamtansicht");
  const editBtn = () => el("button", { class: "btn sm" + (S.wallEdit ? " primary" : ""), onclick: () => { if (ov) { S.overview = false; try { localStorage.setItem("wallOverview", ""); } catch {} } S.wallEdit = !S.wallEdit; S.selMode = false; S.sel.clear(); renderWall(); } }, S.wallEdit ? "✓ Aufbau fertig" : "🧱 Aufbau ändern");
  const bigBtn = () => el("button", { class: "btn sm bigbtn" + (S.wallBig ? " primary" : ""), title: "Regalwand so groß wie möglich: ganze Fensterbreite, Bücherliste eingeklappt", onclick: () => setWallBig(!S.wallBig) }, S.wallBig ? "✓ Großansicht" : "⛶ Großansicht");
  const addWallBtn = () => el("button", { class: "btn sm", onclick: newWallDialog }, "＋ Weitere Wand");
  const more = (...items) => { const list = items.filter(Boolean); return list.length ? el("details", { class: "wmenu" }, el("summary", { class: "btn sm", title: "Weitere Regal-Funktionen" }, "⋯ Mehr"), el("div", { class: "wmenu-list" }, ...list)) : null; };
  const tools = el("div", { class: "tools walltools" },
    ov ? el("h2", { style: "font-size:20px", text: "Alle Regalwände" }) : S.shelves.walls.length > 1 ? sel : el("h2", { style: "font-size:20px", text: w.name }),
    ...(S.wallEdit ? [editBtn(), addWallBtn()]
      : [el("button", { class: "btn sm", onclick: () => openShelfScan() }, "📷 Fach-Foto einlesen"),
        el("button", { class: "btn sm selbtn" + (S.selMode ? " primary" : ""), title: "Mehrere Bücher markieren und gemeinsam umstellen", onclick: () => { S.selMode = !S.selMode; S.sel.clear(); endPick(); S.wallEdit = false; renderWall(); } }, S.selMode ? "✓ Auswahl beenden" : "☑ Auswählen"),
        el("button", { class: "btn sm lensbtn" + (S.lens ? " primary" : ""), title: "Lupe: Buchrücken vergrößert ansehen (Maus darüber bewegen bzw. Finger auflegen und ziehen)", onclick: () => { S.lens = !S.lens; renderWall(); } }, "🔍 Lupe"),
        ov ? ovBtn() : null,
        S.wallBig ? bigBtn() : null,
        more(ov ? null : ovBtn(), editBtn(), addWallBtn(), S.wallBig ? null : bigBtn())]),
    el("span", { style: "flex:1" }),
    el("div", { class: "zoombox" },
      el("button", { class: "btn sm", title: "Verkleinern", onclick: () => setWallZoom(S[zKey] / 1.25) }, "−"),
      zoomIn,
      el("button", { class: "btn sm", title: "Vergrößern", onclick: () => setWallZoom(S[zKey] * 1.25) }, "＋"),
      zoomTxt,
      el("button", { class: "btn sm ghost", title: "Wieder ganz zeigen", onclick: () => { S[zKey] = 1; S.wallReset = true; renderWall(); } }, "⤢")));

  const P = picking(), pickBook = P && P.length === 1 && bookOf(P[0]);
  const pickBar = !P ? null : el("div", { class: "note info pickbar" },
    pickBook ? el("span", {}, el("b", { text: `„${bookLabel(pickBook)}“${pickBook.author ? " (" + pickBook.author + ")" : ""} einräumen: ` }), "Tippe auf ein Fach (kommt ans Ende), auf das Buch, vor das es soll, oder auf „⇧ drauflegen“ in einem Fach.")
      : el("span", {}, el("b", { text: `${P.length} Bücher umstellen: ` }), "Tippe auf ein Fach (kommen ans Ende), auf das Buch, vor das sie sollen, oder auf „⇧ drauflegen“ bzw. „⇅ hinten“ in einem Fach."),
    el("button", { class: "btn sm", onclick: () => { endPick(); renderWall(); } }, "Abbrechen"));

  let selBar = null;
  if (S.selMode) {
    const ids = orderedSel(), locs = ids.map(id => locationOf(id)).filter(Boolean);
    const nm = n => n === 1 ? "1 Buch" : n + " Bücher";
    const toLayer = async (layer, msg) => { const n = await moveToLayer(locs.map(l => l.list[l.pos]), layer); S.sel.clear(); renderAll(); toast(nm(n) + " " + msg, 2000); };
    selBar = el("div", { class: "note info pickbar selbar" },
      el("span", {}, el("b", { text: ids.length ? nm(ids.length) + " ausgewählt. " : "Mehrere auswählen: " }),
        ids.length ? "Was soll damit passieren?" : "Tippe Bücher im Regal oder in der Liste an – „☑ alle“ im Fach wählt eine ganze Reihe."),
      el("div", { class: "covertools" },
        el("button", { class: "btn sm", disabled: !locs.some(l => l.layer !== "back") || null, onclick: () => toLayer("back", "in die hintere Reihe gestellt.") }, "⇅ Nach hinten"),
        el("button", { class: "btn sm", disabled: !locs.some(l => l.layer !== "front") || null, onclick: () => toLayer("front", "in die vordere Reihe gestellt.") }, "⇅ Nach vorne"),
        el("button", { class: "btn sm", disabled: !ids.length || null, onclick: () => { S.pickMany = ids; S.pick = null; S.selMode = false; S.sel.clear(); renderWall(); } }, "↔ In anderes Fach"),
        el("button", { class: "btn sm", disabled: ids.length < 2 || null, title: "Alle ausgewählten Bücher gleich hoch machen", onclick: () => sameHeightDialog(ids) }, "↕ Gleiche Höhe"),
        (() => { const all = ids.length && ids.every(id => bookOf(id)?.spine?.maxText); return el("button", { class: "btn sm maxbtn", disabled: !ids.length || null, title: all ? "Rückentitel wieder in normaler Größe" : "Rückentitel so groß wie möglich (so weit Breite und Länge des Rückens reichen)", onclick: () => maxTitles(ids, !all) }, all ? "🔡 Rückentitel normal" : "🔠 Rückentitel maximieren"); })(),
        el("button", { class: "btn sm danger", disabled: !locs.length || null, onclick: async () => { locs.forEach(l => { const id = l.list[l.pos]; unshelve(id); setLying(id, false); }); S.sel.clear(); await saveShelves(); renderAll(); toast(nm(locs.length) + " zurück in „Noch nicht eingeräumt“.", 2000); } }, "↩ Herausnehmen"),
        ids.length ? el("button", { class: "btn sm ghost", onclick: () => { S.sel.clear(); renderWall(); } }, "Auswahl aufheben") : null,
        el("button", { class: "btn sm primary", onclick: () => { S.selMode = false; S.sel.clear(); renderWall(); } }, "Fertig")));
  }

  const stage = el("div", { class: "wallstage" + (ov ? " overview" : ""), style: ov ? `gap:${OV_GAP * s}px` : "" },
    ...walls.map(x => !ov ? wallEl(x, s) : el("div", { class: "ovwall" },
      el("div", { class: "ovhead" },
        walls.length > 1 ? el("button", { class: "btn sm ghost ovmove", title: "Mit der linken Nachbarwand tauschen", "aria-label": "Wand nach links", disabled: walls[0] === x || null, onclick: () => moveWall(x, -1) }, "◀") : null,
        el("button", { class: "ovname", title: "Nur diese Wand zeigen", onclick: () => { S.wallId = x.id; setOverview(false); } }, x.name),
        walls.length > 1 ? el("button", { class: "btn sm ghost ovmove", title: "Mit der rechten Nachbarwand tauschen", "aria-label": "Wand nach rechts", disabled: walls.at(-1) === x || null, onclick: () => moveWall(x, 1) }, "▶") : null),
      wallEl(x, s))));
  // merken, wo zuletzt getippt wurde – dieses Fach bzw. Buch bleibt beim Neuzeichnen an seiner Stelle
  const remember = e => { const f = e.target.closest?.(".wall .fach"), it = e.target.closest?.(".witem"); if (f) S.anchor = `.wall .fach[data-fid="${f.dataset.fid}"]`; else if (it) S.anchor = `.witem[data-id="${it.dataset.id}"]`; };
  host.onpointerdown = remember;

  const editInfo = S.wallEdit ? el("div", { class: "note info editinfo" },
    el("span", {}, el("b", { text: "Aufbau ändern: " }), "Über jeder Spalte Würfel oben anfügen. Über jedem Würfel: ▲ ▼ verschieben, ◀ ▶ in die Nachbarspalte, ⟳ hochkant drehen, Farbe, ✕ entfernen."),
    el("div", { class: "covertools" },
      el("button", { class: "btn sm", onclick: () => renameWall(w) }, "✏️ Wand umbenennen"),
      S.shelves.walls.length > 1 ? el("button", { class: "btn sm", disabled: S.shelves.walls[0] === w || null, title: "Mit der Wand davor tauschen (Reihenfolge in der Auswahl und in der Gesamtansicht)", onclick: () => moveWall(w, -1) }, "◀ Wand nach vorne") : null,
      S.shelves.walls.length > 1 ? el("button", { class: "btn sm", disabled: S.shelves.walls.at(-1) === w || null, title: "Mit der Wand danach tauschen (Reihenfolge in der Auswahl und in der Gesamtansicht)", onclick: () => moveWall(w, 1) }, "Wand nach hinten ▶") : null,
      el("button", { class: "btn sm ghost danger", onclick: async () => { if (await confirmBox(`Regalwand „${w.name}“ löschen? Die Bücher bleiben in deiner Sammlung, gelten aber als nicht eingeräumt.`, "Löschen")) { S.shelves.walls = S.shelves.walls.filter(x => x !== w); S.wallId = null; S.wallEdit = false; await saveShelves(); renderAll(); } } }, "Wand löschen"),
      el("button", { class: "btn sm primary", onclick: () => { S.wallEdit = false; renderWall(); } }, "✓ Fertig"))) : null;

  const legend = el("details", { class: "saved wlegend" }, el("summary", { text: "ⓘ So geht’s" }),
    ov ? "Gesamtansicht: alle Wände nebeneinander. Vergrößern mit dem Regler, mit zwei Fingern oder Strg + Mausrad; Wandname antippen zeigt nur diese Wand. " : "",
    "Symbolisch: Dicke aus der Seitenzahl geschätzt, Farbe aus dem Cover. ♥ = Lieblingsbuch. ",
    "Buch antippen: hinlegen, stapeln, oben drauflegen oder in die hintere Reihe stellen. „⇅ hinten“ zeigt die hintere Reihe eines Fachs (oben herausschauende hintere Bücher lassen sich auch direkt antippen). Rot umrandet = rechnerisch voll. ",
    "Ist ein echtes Fach voll: Buch antippen → „Fach ist voll – auf ganze Breite verteilen“. „☑ Auswählen“ stellt mehrere Bücher auf einmal um, „🔍 Lupe“ vergrößert die Rücken.");

  const lens = S.lens && !S.wallEdit ? lensAttach(stage, s) : null;
  const scroller = el("div", { class: "wallscroll" }, stage, S.wallEdit ? null : legend);
  zoomAttach(scroller, stage);
  fillNode(host, tools, typeof photoInboxBar === "function" ? photoInboxBar() : null, pickBar, selBar, editInfo,
    el("div", { class: "wandlayout" + (S.wallEdit ? " solo" : sideClosed() ? " sideclosed" : "") }, scroller, S.wallEdit ? null : sidebarEl()), lens);
  wallViewRestore(host, st);
  fitMaxTitles(host); // maximierte Rückentitel: so groß wie möglich, aber ganz lesbar
  fitMaxTitlesSoon(host);
  if (S.highlight) {
    const sp = host.querySelector(`.spine[data-id="${S.highlight}"]`);
    if (sp) { sp.classList.add("hl"); sp.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }); }
    const id = S.highlight; setTimeout(() => { if (S.highlight === id) { S.highlight = null; host.querySelectorAll(".spine.hl").forEach(x => x.classList.remove("hl")); } }, 4000);
  }
}
const OV_GAP = 8; // Abstand der Wände in der Gesamtansicht (cm)
const colWidthCm = c => Math.max(35.4, ...c.modules.map(m => modDims(m).w));
const wallWidthCm = w => w.columns.reduce((a, c) => a + colWidthCm(c), 0) + (w.columns.length - 1) * 1.5 + 2;
function wallEl(w, s) {
  const colW = colWidthCm, P = picking();
  const wallEl = el("div", { class: "wall" + (S.wallEdit ? " editing" : "") + (P ? " picking" : "") + (S.selMode ? " selecting" : "") + (S.lens && !S.wallEdit ? " lensing" : ""), style: `gap:${1.5 * s}px`, "data-wall": w.id });
  w.columns.forEach((col, ci) => {
    const colEl = el("div", { class: "wcol", style: `min-width:${colW(col) * s}px` });
    if (S.wallEdit) colEl.append(el("div", { class: "colbar", style: `width:${Math.max(colW(col) * s, 110)}px` },
      el("b", { text: "Spalte " + (ci + 1) }),
      el("button", { class: "btn sm", title: "2er-Würfel oben anfügen", onclick: () => editWall(() => col.modules.unshift(newModule("6112", col.modules[0]?.color))) }, "＋2er"),
      el("button", { class: "btn sm", title: "4er-Würfel oben anfügen", onclick: () => editWall(() => col.modules.unshift(newModule("1112", col.modules[0]?.color))) }, "＋4er"),
      el("button", { class: "btn sm", title: "Lücke oben anfügen", onclick: () => editWall(() => col.modules.unshift(newModule("gap"))) }, "＋Lücke"),
      el("button", { class: "btn sm ghost danger", title: "Spalte entfernen", onclick: async () => { const n = col.modules.reduce((a, m) => a + modBookCount(m), 0); if (!n || await confirmBox(`In dieser Spalte stehen ${n} Bücher. Sie gelten danach als „nicht eingeräumt“.\nSpalte entfernen?`, "Entfernen")) editWall(() => w.columns.splice(ci, 1)); } }, "✕")));
    col.modules.forEach((m, mi) => colEl.append(moduleEl(w, col, ci, m, mi, s)));
    if (S.wallEdit && !col.modules.length) colEl.append(el("div", { class: "saved", style: "padding:8px", text: "Leer – oben Würfel anfügen." }));
    wallEl.append(colEl);
  });
  if (S.wallEdit) wallEl.append(el("div", { class: "wcol addcol", style: `width:${Math.max(120, 30 * s)}px` },
    el("button", { class: "btn", onclick: () => editWall(() => w.columns.push({ id: uid().slice(0, 8), modules: [newModule("6112")] })) }, "＋ Spalte")));
  return wallEl;
}
/* Ansicht beim Neuzeichnen halten: Rollposition der Wand, der Liste und der Seite – und das zuletzt angetippte Fach
   (bzw. Buch in der Liste) bleibt genau an seiner Stelle, auch wenn oben eine Hinweiszeile dazukommt oder verschwindet. */
function wallViewSave(host) {
  const sc = host.querySelector(".wallscroll"); if (!sc) return null;
  const st = { left: sc.scrollLeft, top: sc.scrollTop, win: scrollY, list: host.querySelector(".wlist")?.scrollTop || 0 };
  const vis = e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 0; };
  let a = S.anchor && host.querySelector(S.anchor);
  if (!a || !vis(a)) { const sr = sc.getBoundingClientRect(); a = [...host.querySelectorAll(".wall .fach")].find(f => { const r = f.getBoundingClientRect(); return vis(f) && r.bottom > sr.top && r.top < sr.bottom; }); }
  if (a) { const r = a.getBoundingClientRect(); st.sel = S.anchor && a.matches(S.anchor) ? S.anchor : `.wall .fach[data-fid="${a.dataset.fid}"]`; st.x = r.left; st.y = r.top; }
  return st;
}
function wallViewRestore(host, st) {
  const sc = host.querySelector(".wallscroll"); if (!sc) return;
  const z = S.zoomFocus; S.zoomFocus = null;
  if (!st) { sc.scrollLeft = 0; sc.scrollTop = 0; return; }
  const wl = host.querySelector(".wlist"); if (wl) wl.scrollTop = st.list;
  if (z) { // Zoom: der Punkt unter Finger/Maus bzw. die Mitte bleibt stehen
    const r = sc.getBoundingClientRect();
    sc.scrollLeft = z.cx * z.ratio - (z.fx - r.left); sc.scrollTop = z.cy * z.ratio - (z.fy - r.top);
    return;
  }
  sc.scrollLeft = st.left; sc.scrollTop = st.top;
  if (Math.abs(scrollY - st.win) > 1) window.scrollTo(scrollX, st.win);
  const a = st.sel && host.querySelector(st.sel); if (!a) return;
  const r = a.getBoundingClientRect(), dx = r.left - st.x, dy = r.top - st.y;
  if (sc.contains(a)) {
    if (Math.abs(dx) > 0.5) sc.scrollLeft += dx;
    if (Math.abs(dy) > 0.5) { const t0 = sc.scrollTop; sc.scrollTop += dy; const rest = dy - (sc.scrollTop - t0); if (Math.abs(rest) > 0.5) window.scrollBy(0, rest); }
  } else if (Math.abs(dy) > 0.5) window.scrollBy(0, dy);
}
/* Vergrößern: stufenlos per Regler, ＋/−, zwei Finger (Handy) oder Strg + Mausrad/Touchpad (PC).
   Während der Bewegung wird nur skaliert angezeigt, danach scharf neu gezeichnet. */
function wallZoomFocus(sc, fx, fy, ratio) {
  const r = sc.getBoundingClientRect();
  if (fx == null) { fx = r.left + r.width / 2; fy = r.top + Math.min(r.height, innerHeight - Math.max(0, r.top)) / 2; }
  return { fx, fy, cx: sc.scrollLeft + fx - r.left, cy: sc.scrollTop + fy - r.top, ratio };
}
function setWallZoom(z, fx, fy, focus) {
  const key = S.overview ? "ovZoom" : "zoom";
  z = Math.max(0.25, Math.min(6, z));
  const sc = document.querySelector("#v-wand .wallscroll");
  if (Math.abs(z - S[key]) < 1e-3) { wallPreviewZoom(1); return; }
  if (sc) S.zoomFocus = focus ? { ...focus, ratio: z / S[key] } : wallZoomFocus(sc, fx, fy, z / S[key]);
  S[key] = z; renderWall();
}
function wallPreviewZoom(r) { const stg = document.querySelector("#v-wand .wallstage"); if (stg) stg.style.zoom = Math.abs(r - 1) < 1e-3 ? "" : r; }
function zoomAttach(sc, stage) {
  const cur = () => S.overview ? S.ovZoom : S.zoom;
  // zwei Finger
  let pin = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  sc.addEventListener("touchstart", e => {
    if (e.touches.length !== 2 || S.lens) return;
    const fx = (e.touches[0].clientX + e.touches[1].clientX) / 2, fy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    pin = { d: dist(e.touches), r: 1, focus: wallZoomFocus(sc, fx, fy, 1) };
  }, { passive: true });
  sc.addEventListener("touchmove", e => {
    if (!pin || e.touches.length !== 2) return;
    e.preventDefault();
    pin.r = Math.max(0.25 / cur(), Math.min(6 / cur(), dist(e.touches) / pin.d));
    wallPreviewZoom(pin.r);
  }, { passive: false });
  const end = e => { if (!pin || e.touches.length >= 2) return; const p = pin; pin = null; if (Math.abs(p.r - 1) > 0.03) setWallZoom(cur() * p.r, null, null, p.focus); else wallPreviewZoom(1); };
  sc.addEventListener("touchend", end); sc.addEventListener("touchcancel", end);
  // Strg + Mausrad, Touchpad-Spreizen
  let wz = null;
  sc.addEventListener("wheel", e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (!wz) wz = { r: 1, focus: wallZoomFocus(sc, e.clientX, e.clientY, 1) };
    wz.r = Math.max(0.25 / cur(), Math.min(6 / cur(), wz.r * Math.exp(-e.deltaY / 300)));
    wallPreviewZoom(wz.r);
    clearTimeout(wz.t); wz.t = setTimeout(() => { const w = wz; wz = null; setWallZoom(cur() * w.r, null, null, w.focus); }, 220);
  }, { passive: false });
}
async function editWall(fn) { fn(); await saveShelves(); renderAll(); }
// Bücher im selben Fach in eine andere Reihe stellen (hinten anfügen, Reihenfolge bleibt)
async function moveToLayer(ids, layer) {
  let n = 0;
  for (const id of ids) {
    const loc = locationOf(id); if (!loc || loc.layer === layer) continue;
    unshelve(id); if (layer === "top") setLying(id, false);
    layerList(loc.m, loc.k, layer).push(id); n++;
    const fid = loc.m.id + ":" + loc.k; if (layer === "back") S.showBack.add(fid); else S.showBack.delete(fid);
  }
  await saveShelves(); return n;
}
const interiorOf = m => `color-mix(in srgb, ${m.color} 84%, #000)`;
function findModule(id) { for (const w of S.shelves.walls) for (const c of w.columns) for (const m of c.modules) if (m.id === id) return m; return null; }
/* Lupe: zeigt das Fach unter Maus/Finger stark vergrößert (neu gezeichnet, damit die Schrift scharf bleibt) */
let lensLast = null; // letzte Lupen-Position – übersteht ein Neuzeichnen der Wand
function lensAttach(wallEl, s) {
  const inner = el("div", { class: "lensin" }), lens = el("div", { class: "lens hidden" }, inner), cap = el("div", { class: "lenscap hidden" });
  const Z = Math.min(60, Math.max(16, s * 2.5));
  let cur = null, start = null, moved = false;
  const hide = () => { lensLast = null; lens.classList.add("hidden"); cap.classList.add("hidden"); };
  const show = (x, y, touch) => {
    const hit = document.elementFromPoint(x, y), fe = hit && hit.closest(".wall .fach");
    if (!fe) return hide();
    lensLast = { x, y, touch };
    if (!cur || cur.fid !== fe.dataset.fid) {
      const [mid, k] = fe.dataset.fid.split(":"), m = findModule(mid); if (!m) return hide();
      const big = fachEl(m, k, Z, interiorOf(m)); big.classList.add("big"); big.style.width = FACH_W * Z + "px"; big.style.height = FACH_H * Z + "px";
      fillNode(inner, big); cur = { fid: fe.dataset.fid };
    }
    const R = innerWidth < 600 ? 85 : 120, r = fe.getBoundingClientRect();
    const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
    inner.style.transform = `translate(${R - fx * FACH_W * Z}px,${R - fy * FACH_H * Z}px)`;
    let lx = x - R, ly = touch ? y - 2 * R - 40 : y - R;
    if (ly < 8) ly = touch ? y + 40 : 8;
    lx = Math.max(8, Math.min(innerWidth - 2 * R - 8, lx));
    Object.assign(lens.style, { width: 2 * R + "px", height: 2 * R + "px", left: lx + "px", top: ly + "px" });
    lens.classList.remove("hidden");
    if (!cur.fitted) { cur.fitted = true; fitMaxTitles(inner); }
    const sp = hit.closest(".spine"), b = sp && bookOf(sp.dataset.id);
    if (b) { cap.textContent = bookLabel(b) + (b.author ? " – " + b.author : ""); Object.assign(cap.style, { left: lx + R + "px", top: ly + 2 * R + 6 + "px" }); cap.classList.remove("hidden"); }
    else cap.classList.add("hidden");
  };
  wallEl.addEventListener("pointermove", e => {
    if (e.pointerType === "mouse") return show(e.clientX, e.clientY, false);
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) moved = true;
    show(e.clientX, e.clientY, true);
  });
  wallEl.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hide(); });
  wallEl.addEventListener("pointerdown", e => { if (e.pointerType === "mouse") return; start = { x: e.clientX, y: e.clientY }; moved = false; show(e.clientX, e.clientY, true); });
  const up = e => { if (e.pointerType === "mouse") return; start = null; hide(); };
  wallEl.addEventListener("pointerup", up); wallEl.addEventListener("pointercancel", up);
  // nach dem Ziehen mit dem Finger kein versehentliches Antippen
  wallEl.addEventListener("click", e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  if (lensLast) { const l = lensLast; requestAnimationFrame(() => { if (lens.isConnected) show(l.x, l.y, l.touch); }); }
  return el("div", { class: "lenshost" }, lens, cap);
}
function moduleEl(w, col, ci, m, mi, s) {
  const d = modDims(m), lay = modLayout(m);
  const withBar = node => S.wallEdit ? el("div", { class: "modwrap", style: `width:${d.w * s}px` }, modBar(w, col, ci, m, mi), node) : node;
  if (m.type === "gap") return withBar(el("div", { class: "mod gap", style: `width:${d.w * s}px;height:${d.h * s}px` }));
  ensureLayers(m);
  const interior = `color-mix(in srgb, ${m.color} 84%, #000)`;
  const def = MOD[m.type];
  const mEl = el("div", { class: "mod", title: `${def.model}${upright(m) ? " hochkant" : ""} · B ${String(d.w).replace(".", ",")} × H ${String(d.h).replace(".", ",")} × T ${def.d} cm`,
    style: `width:${d.w * s}px;height:${d.h * s}px;padding:${BOARD * s}px;gap:${BOARD * s}px;background:${m.color};grid-template-columns:repeat(${lay.cols},1fr);grid-template-rows:repeat(${lay.rows},1fr)` });
  for (const k of lay.keys) mEl.append(fachEl(m, k, s, interior));
  return withBar(mEl);
}
function rotateModule(m) {
  ensureLayers(m);
  const map = upright(m) ? { T: "L", B: "R" } : { L: "T", R: "B" };
  for (const o of [m.fachs, m.back, m.top]) for (const [a, b] of Object.entries(map)) { o[b] = o[a] || []; delete o[a]; }
  if (m.fit) { const nf = {}; for (const [key, v] of Object.entries(m.fit)) { const [a, l] = key.split(":"); nf[(map[a] || a) + (l ? ":" + l : "")] = v; } m.fit = nf; }
  m.orient = upright(m) ? "h" : "v";
}
function modBar(w, col, ci, m, mi) {
  const colSel = el("select", { title: "Farbe" }, ...MOD_COLORS.map(([n, c]) => el("option", { value: c, selected: m.color === c || null }, n)));
  colSel.addEventListener("change", () => editWall(() => { m.color = colSel.value; }));
  const move = (dc) => editWall(() => { const t = w.columns[ci + dc]; if (!t) return; col.modules.splice(mi, 1); t.modules.splice(Math.min(mi, t.modules.length), 0, m); });
  const short = m.type === "gap" ? "Lücke" : m.type === "1112" ? "4er" : upright(m) ? "2er hoch" : "2er";
  colSel.style.background = m.color;
  return el("div", { class: "modbar", onclick: e => e.stopPropagation() },
    el("span", { title: MOD[m.type].name + (upright(m) ? " (hochkant)" : ""), text: short }),
    el("button", { title: "Nach oben", disabled: mi === 0 || null, onclick: () => editWall(() => { col.modules.splice(mi, 1); col.modules.splice(mi - 1, 0, m); }) }, "▲"),
    el("button", { title: "Nach unten", disabled: mi === col.modules.length - 1 || null, onclick: () => editWall(() => { col.modules.splice(mi, 1); col.modules.splice(mi + 1, 0, m); }) }, "▼"),
    el("button", { title: "In linke Spalte", disabled: ci === 0 || null, onclick: () => move(-1) }, "◀"),
    el("button", { title: "In rechte Spalte", disabled: ci === w.columns.length - 1 || null, onclick: () => move(1) }, "▶"),
    m.type !== "1112" ? el("button", { title: upright(m) ? "Quer stellen" : "Hochkant stellen", onclick: () => editWall(() => rotateModule(m)) }, "⟳") : null,
    m.type !== "gap" ? colSel : null,
    el("button", { title: "Entfernen", onclick: async () => { const n = modBookCount(m); if (!n || await confirmBox(`In diesem Würfel stehen ${n} Bücher. Sie gelten danach als „nicht eingeräumt“.\nWürfel entfernen?`, "Entfernen")) editWall(() => col.modules.splice(mi, 1)); } }, "✕"));
}
function bookEl(b, s, lying, onClick, f = 1) {
  const { w, h } = spineCm(b);
  const thick = w * s * (lying ? 1 : f), len = h * s;
  const sp = el("div", { class: "spine" + (lying ? " lie" : "") + (b.favorite ? " fav" : "") + (picking()?.includes(b.id) ? " picked" : "") + (S.selMode && S.sel.has(b.id) ? " sel" : ""), "data-id": b.id, draggable: S.wallEdit ? null : "true",
    title: `${bookLabel(b)}${b.author ? " – " + b.author : ""}${lying ? " (liegend)" : ""}`,
    style: lying ? `width:${len}px;height:${thick}px` : `width:${thick}px;height:${len}px` });
  const face = spineFace(b, thick, len);
  if (lying) face.style.cssText += ";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(90deg)";
  sp.append(face);
  sp.addEventListener("click", e => { e.stopPropagation(); if (S.wallEdit) return; if (S.selMode) { S.sel.has(b.id) ? S.sel.delete(b.id) : S.sel.add(b.id); renderWall(); } else onClick(b); });
  sp.addEventListener("dragstart", e => { e.stopPropagation(); e.dataTransfer.setData("text/plain", b.id); e.dataTransfer.effectAllowed = "move"; });
  return sp;
}
function rowEl(m, k, layer, s) {
  const ids = layerList(m, k, layer), fit = rowFit(m, k, layer);
  const row = el("div", { class: "layer " + layer, style: `padding:0 ${0.3 * s}px` });
  for (const g of rowGroups(ids)) {
    const click = b => { const P = picking(); if (P && !P.includes(b.id)) placeBooks(P, m, k, ids.indexOf(b.id), layer).then(() => { endPick(); renderAll(); }); else spineMenu(b); };
    if (g.lying) {
      const st = el("div", { class: "stack", "data-i": g.items[0].i });
      g.items.forEach(x => st.append(bookEl(x.b, s, true, click)));
      row.append(st);
    } else g.items.forEach(x => { const sp = bookEl(x.b, s, false, click, fitF(fit, x.b)); sp.dataset.i = x.i; row.append(sp); });
  }
  return row;
}
function fachEl(m, k, s, interior) {
  const fid = m.id + ":" + k;
  const back = layerList(m, k, "back"), top = layerList(m, k, "top"), front = layerList(m, k, "front");
  const showBack = S.showBack.has(fid) && back.length;
  const active = showBack ? "back" : "front";
  const u = fachUsage(m, k);
  const fitted = isFit(m, k, active);
  const f = el("div", { class: "fach" + (u.full ? " full" : "") + (showBack ? " showback" : "") + (fitted ? " fit" : ""), style: `background:${interior}`, "data-fid": fid,
    title: `Fach ${FACH_LABEL[k]} · vorne ${front.length}${back.length ? ", hinten " + back.length : ""}${top.length ? ", oben drauf " + top.length : ""} Bücher · ` + (fitted ? "Reihe auf ganze Fachbreite verteilt (Fach ist voll)" : `Reihe ca. ${Math.round(Math.min(u.front.w, 99) / FACH_W * 100)} % belegt`) });
  // hintere Reihe (erhöht, auch wenn eingeblendet), vordere Reihe, oben aufgelegte Bücher
  const backEl = rowEl(m, k, "back", s); backEl.style.bottom = BACK_RISE * s + "px";
  const frontEl = rowEl(m, k, "front", s);
  const topEl = el("div", { class: "stack top", style: `left:${0.3 * s}px;bottom:${u.front.h * s}px` });
  top.forEach(id => { const b = bookOf(id); if (b) topEl.append(bookEl(b, s, true, bb => { const P = picking(); if (P && !P.includes(bb.id)) placeBooks(P, m, k, top.indexOf(bb.id), "top").then(() => { endPick(); renderAll(); }); else spineMenu(bb); })); });
  f.append(backEl, frontEl);
  if (top.length && !showBack) f.append(topEl);
  // kleine Schalter im Fach
  const tg = el("div", { class: "fachbtns" });
  if (back.length) tg.append(el("button", { title: showBack ? "Vordere Reihe zeigen" : "Hintere Reihe zeigen", onclick: e => { e.stopPropagation(); S.showBack.has(fid) ? S.showBack.delete(fid) : S.showBack.add(fid); renderWall(); } }, showBack ? "⇅ vorne" : `⇅ hinten (${back.length})`));
  if (picking() && !S.wallEdit) {
    tg.append(el("button", { title: "Liegend oben auf die Reihe legen", onclick: e => { e.stopPropagation(); placeBooks(picking(), m, k, null, "top").then(() => { endPick(); renderAll(); }); } }, "⇧ drauflegen"));
    if (!back.length) tg.append(el("button", { title: "In eine zweite, hintere Reihe stellen", onclick: e => { e.stopPropagation(); placeBooks(picking(), m, k, null, "back").then(() => { S.showBack.add(fid); endPick(); renderAll(); }); } }, "⇅ hinten"));
  }
  const rowIds = layerList(m, k, active);
  if (S.selMode && !S.wallEdit && rowIds.length) {
    const allOn = rowIds.every(id => S.sel.has(id));
    tg.append(el("button", { class: "selall", title: allOn ? "Bücher dieser Reihe abwählen" : "Alle Bücher dieser Reihe auswählen", onclick: e => { e.stopPropagation(); rowIds.forEach(id => allOn ? S.sel.delete(id) : S.sel.add(id)); renderWall(); } }, allOn ? "☐ keins" : "☑ alle"));
  }
  if (tg.children.length) f.append(tg);

  // Einräumen per Tippen
  f.addEventListener("click", () => { const P = picking(); if (S.wallEdit || !P) return; placeBooks(P, m, k, null, active).then(() => { endPick(); renderAll(); }); });
  // Einräumen per Ziehen (PC)
  const rowNow = () => f.querySelector(".layer." + active);
  const idxAt = x => { const kids = [...rowNow().children]; for (const kd of kids) { const r = kd.getBoundingClientRect(); if (x < r.left + r.width / 2) return +kd.dataset.i; } return layerList(m, k, active).length; };
  const clearIns = () => { f.classList.remove("drop", "insend"); f.querySelectorAll(".ins").forEach(x => x.classList.remove("ins")); };
  f.addEventListener("dragover", e => { if (S.wallEdit) return; e.preventDefault(); clearIns(); f.classList.add("drop"); const i = idxAt(e.clientX); const kid = [...rowNow().children].find(kd => +kd.dataset.i === i); if (kid) kid.classList.add("ins"); else f.classList.add("insend"); });
  f.addEventListener("dragleave", clearIns);
  f.addEventListener("drop", e => {
    e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); const i = idxAt(e.clientX); clearIns(); if (!id || !bookOf(id)) return;
    const many = S.selMode && S.sel.has(id) && S.sel.size > 1; // ausgewählte Bücher wandern gemeinsam
    placeBooks(many ? orderedSel() : [id], m, k, i, active).then(() => { endPick(); if (many) S.sel.clear(); renderAll(); });
  });
  return f;
}
// Titel mit Band-Nummer – gleichnamige Bände einer Reihe („Weihnachtsgeschichten am Kamin“) sonst nicht zu unterscheiden
// Rückentitel der ausgewählten Bücher maximieren (spine.maxText, optional) bzw. wieder normal
async function maxTitles(ids, on) {
  const books = ids.map(id => S.books.find(b => b.id === id)).filter(Boolean);
  for (const b of books) {
    const { maxText, ...sp } = b.spine || {};
    if (!!maxText !== on) await patchBook(b.id, { spine: on ? { ...sp, maxText: true } : sp });
  }
  const photo = on ? books.filter(b => b.spine?.imageBlob && !b.spine?.textOnImage).length : 0;
  renderAll();
  toast(on ? `Rückentitel von ${books.length} Büchern maximiert.` + (photo ? ` ${photo} davon zeigen ein Foto als Rücken – dort bleibt das Foto.` : "") : `Rückentitel von ${books.length} Büchern wieder normal.`, 3500);
}
// Ausgewählte Bücher auf dieselbe Höhe bringen (Buchrücken-Höhe spine.heightCm, 8–33 cm wie beim Fach-Foto)
function sameHeightDialog(ids) {
  const books = ids.map(id => S.books.find(b => b.id === id)).filter(Boolean); if (books.length < 2) return;
  const hs = books.map(b => Math.round(spineCm(b).h * 10) / 10);
  const cnt = new Map(); hs.forEach(h => cnt.set(h, (cnt.get(h) || 0) + 1));
  const common = [...cnt].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]; // häufigste Höhe (bei Gleichstand die größere)
  const fmt = h => String(h).replace(".", ",") + " cm";
  const inp = el("input", { class: "field", type: "number", min: 8, max: 33, step: 0.1, value: common, inputmode: "decimal", style: "width:110px", "aria-label": "Höhe in cm" });
  const close = () => box.remove();
  const apply = async () => {
    const v = Math.round(Math.min(33, Math.max(8, parseFloat(String(inp.value).replace(",", ".")))) * 10) / 10;
    if (!isFinite(v)) { inp.focus(); return; }
    close();
    for (const b of books) if (spineCm(b).h !== v || +b.spine?.heightCm !== v) await patchBook(b.id, { spine: { ...(b.spine || {}), heightCm: v } });
    renderAll(); toast(`${books.length} Bücher sind jetzt ${fmt(v)} hoch.`, 2500);
  };
  const quick = (label, h) => el("button", { class: "btn sm", type: "button", onclick: () => { inp.value = h; } }, `${label} (${fmt(h)})`);
  const box = el("div", { class: "overlay confirm", style: "z-index:70;align-items:center", onclick: e => { if (e.target === box) close(); } },
    el("div", { class: "sheet", style: "max-width:420px;border-radius:16px" }, el("div", { class: "sheet-b" },
      el("p", { style: "margin:0 0 10px;font-size:15px", text: `${books.length} ausgewählte Bücher auf dieselbe Höhe bringen:` }),
      el("div", { class: "covertools", style: "margin-bottom:10px" }, quick("Häufigste", common), quick("Höchstes", Math.max(...hs)), quick("Niedrigstes", Math.min(...hs))),
      el("label", { class: "lbl", text: "Höhe in cm" }), inp,
      el("div", { style: "display:flex;gap:8px;justify-content:flex-end;margin-top:16px" },
        el("button", { class: "btn", onclick: close }, "Abbrechen"),
        el("button", { class: "btn primary samehbtn", onclick: apply }, "Übernehmen")))));
  inp.addEventListener("keydown", e => { if (e.key === "Enter") apply(); });
  document.body.append(box);
}
function bookLabel(b) { const v = volOf(b); return (b.title || "Ohne Titel") + (v && !new RegExp("\\b" + v + "\\s*\\)?\\s*$").test(b.title || "") ? " · Band " + v : ""); }
const WLIST_STEP = 150;
function sidebarEl() {
  const q = el("input", { class: "field", type: "search", placeholder: "Buch suchen (auch eingeräumte)", value: S.wq });
  const listEl = el("div", { class: "wlist" });
  // Eingeräumte Bücher einmal sammeln (statt je Buch alle Fächer zu durchsuchen) – wichtig bei Tausenden Büchern
  const shelved = new Set(); for (const f of allFachs()) for (const id of f.list) shelved.add(id);
  let list = [];
  const itemEl = b => {
      const loc = locationOf(b.id);
      const label = bookLabel(b);
      const it = el("div", { class: "witem" + (picking()?.includes(b.id) || (S.selMode && S.sel.has(b.id)) ? " on" : ""), "data-id": b.id, draggable: "true",title: `${label}${b.author ? " – " + b.author : ""}\nAntippen, dann auf ein Fach tippen – oder ins Regal ziehen` },
        el("div", { class: "wthumb" }, coverSrc(b) ? el("img", { src: coverSrc(b), alt: "", loading: "lazy", onerror: e => e.target.remove() }) : null),
        el("div", { style: "min-width:0" }, el("b", { text: (b.favorite ? "♥ " : "") + label }),
          b.author ? el("span", { text: b.author }) : null, loc ? el("span", { text: "📍 " + locationShort(loc) }) : null),
        loc ? el("button", { class: "btn sm ghost", title: "Zurück zu „Noch nicht eingeräumt“", onclick: async e => { e.stopPropagation(); unshelve(b.id); setLying(b.id, false); await saveShelves(); renderAll(); toast("Zurückgelegt."); } }, "↩") : null);
      it.addEventListener("click", () => { if (S.selMode) { S.sel.has(b.id) ? S.sel.delete(b.id) : S.sel.add(b.id); } else { S.pickMany = null; S.pick = S.pick === b.id ? null : b.id; } renderWall(); });
      it.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", b.id); e.dataTransfer.effectAllowed = "move"; });
      return it;
  };
  // Alle Bücher zeigen – in Stücken: beim Herunterrollen kommen weitere dazu (S.wShown bleibt beim Neuzeichnen erhalten)
  const more = () => {
    const have = listEl.querySelectorAll(".witem").length;
    if (have >= list.length) return;
    const next = list.slice(have, have + WLIST_STEP).map(itemEl);
    listEl.querySelector(".wmore")?.remove();
    listEl.append(...next);
    S.wShown = Math.max(S.wShown || 0, have + next.length);
    if (have + next.length < list.length) listEl.append(el("button", { class: "btn sm ghost wmore", onclick: more }, `Weitere ${Math.min(WLIST_STEP, list.length - have - next.length)} von ${list.length - have - next.length} anzeigen`));
  };
  const draw = (keep = true) => {
    const qq = S.wq.trim();
    list = (qq ? S.books.filter(b => inStock(b) && matchQ(b, qq)) : S.books.filter(b => inStock(b) && !shelved.has(b.id)))
      .sort((a, b) => lastName(a.author).localeCompare(lastName(b.author), "de") || coll.compare(a.title || "", b.title || "") || (+volOf(a) || 0) - (+volOf(b) || 0));
    if (!keep) S.wShown = 0;
    fillNode(listEl, list.length ? null : el("div", { class: "saved", style: "padding:10px", text: qq ? "Nichts gefunden." : "Alle Bücher sind eingeräumt. 🎉" }));
    const want = Math.max(WLIST_STEP, S.wShown || 0);
    while (listEl.querySelectorAll(".witem").length < Math.min(want, list.length)) more();
  };
  listEl.addEventListener("scroll", () => { if (listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 300) more(); });
  q.addEventListener("input", () => { S.wq = q.value; draw(false); });
  draw();
  const n = S.books.filter(b => inStock(b) && !shelved.has(b.id)).length;
  const closed = sideClosed();
  const head = el("button", { class: "wsidehead", type: "button", "aria-expanded": closed ? "false" : "true", title: closed ? "Bücherliste aufklappen" : "Bücherliste einklappen – mehr Platz für das Regal", onclick: () => setSideClosed(!closed) },
    el("h3", { text: `Noch nicht eingeräumt (${n})` }), el("span", { class: "wsidearrow", text: closed ? "▸" : "▾" }));
  const aside = closed ? el("aside", { class: "wside closed" }, head)
    : el("aside", { class: "wside" }, head, q, listEl,
      el("div", { class: "saved", text: "Tipp: Ein Buch aus dem Regal hierher ziehen (oder antippen → ↩), um es wieder herauszunehmen." }));
  aside.addEventListener("dragover", e => { e.preventDefault(); aside.classList.add("hot"); });
  aside.addEventListener("dragleave", e => { if (!aside.contains(e.relatedTarget)) aside.classList.remove("hot"); });
  aside.addEventListener("drop", async e => {
    e.preventDefault(); aside.classList.remove("hot"); const id = e.dataTransfer.getData("text/plain"); if (!id || !locationOf(id)) return;
    const ids = S.selMode && S.sel.has(id) ? orderedSel().filter(x => locationOf(x)) : [id];
    ids.forEach(x => { unshelve(x); setLying(x, false); }); if (ids.length > 1) S.sel.clear();
    await saveShelves(); renderAll(); toast(ids.length > 1 ? `${ids.length} Bücher zurück in „Noch nicht eingeräumt“.` : "Zurück in „Noch nicht eingeräumt“.");
  });
  return aside;
}
function spineMenu(b) {
  const loc = locationOf(b.id); if (!loc) return;
  const close = () => box.remove();
  const after = async (msg) => { await saveShelves(); close(); renderAll(); if (msg) toast(msg, 1800); };
  const mv = d => { const l = loc.list; const i = l.indexOf(b.id), j = i + d; if (j < 0 || j >= l.length) return; l.splice(i, 1); l.splice(j, 0, b.id); after().then(() => spineMenu(b)); };
  const toLayer = async (layer, msg) => { const fid = loc.m.id + ":" + loc.k; unshelve(b.id); layerList(loc.m, loc.k, layer).push(b.id); if (layer === "top") setLying(b.id, false); if (layer === "back") S.showBack.add(fid); else S.showBack.delete(fid); await after(msg); };
  const lying = isLying(b.id), top = loc.layer === "top";
  const fitLayer = loc.layer === "back" ? "back" : "front", fitted = isFit(loc.m, loc.k, fitLayer);
  const isFirst = loc.pos === 0, isLast = loc.pos === loc.list.length - 1;
  const box = el("div", { class: "overlay confirm", style: "z-index:70;align-items:center", onclick: e => { if (e.target === box) close(); } },
    el("div", { class: "sheet", style: "max-width:400px;border-radius:16px" }, el("div", { class: "sheet-b" },
      el("div", { style: "display:flex;gap:12px;margin-bottom:12px" },
        el("div", { style: "width:56px;flex:none" }, coverEl(b)),
        el("div", {}, el("b", { text: b.title || "Ohne Titel" }), el("div", { class: "meta", text: b.author || "" }), el("div", { class: "saved", style: "margin-top:4px", text: locationText(loc) }))),
      el("label", { class: "lbl", text: "Position" }),
      el("div", { class: "covertools", style: "margin-bottom:10px" },
        el("button", { class: "btn sm", disabled: isFirst || null, onclick: () => mv(-1) }, top ? "▲ höher" : "◀ nach links"),
        el("button", { class: "btn sm", disabled: isLast || null, onclick: () => mv(1) }, top ? "▼ tiefer" : "nach rechts ▶"),
        el("button", { class: "btn sm", onclick: () => { close(); S.pick = b.id; renderWall(); } }, "↔ Umstellen (anderes Fach)"),
        el("button", { class: "btn sm", onclick: () => { close(); editSpineDirect(b); } }, "🎨 Rücken gestalten"),
        el("button", { class: "btn sm", onclick: () => { close(); openShelfScan(loc.m.id + ":" + loc.k); } }, "📷 Dieses Fach per Foto einlesen")),
      el("label", { class: "lbl", text: "Wie liegt/steht das Buch?" }),
      el("div", { class: "covertools" },
        !top ? el("button", { class: "btn sm", onclick: () => { setLying(b.id, !lying); after(lying ? "Steht wieder." : "Liegt jetzt – liegende Nachbarn bilden einen Stapel."); } }, lying ? "▮ Aufstellen" : "▬ Hinlegen (stapeln)") : null,
        !top ? el("button", { class: "btn sm", onclick: () => toLayer("top", "Liegt jetzt oben auf der Reihe.") }, "⇧ Oben auf die Reihe legen") : el("button", { class: "btn sm", onclick: () => toLayer("front", "Steht wieder in der Reihe.") }, "▮ Wieder in die Reihe stellen"),
        loc.layer === "back" ? el("button", { class: "btn sm", onclick: () => toLayer("front", "Steht jetzt vorne.") }, "⇅ In die vordere Reihe") : el("button", { class: "btn sm", onclick: () => toLayer("back", "Steht jetzt in der hinteren Reihe.") }, "⇅ In die hintere Reihe"),
        el("button", { class: "btn sm danger", onclick: async () => { unshelve(b.id); setLying(b.id, false); await after("Zurück in „Noch nicht eingeräumt“."); } }, "↩ Zurück zu „Noch nicht eingeräumt“")),
      el("label", { class: "lbl", style: "margin-top:10px", text: "Ganzes Fach" }),
      el("div", { class: "covertools" },
        el("button", { class: "btn sm", title: "Wenn das echte Fach voll ist: die Bücher dieser Reihe gleichmäßig so breit zeichnen, dass sie das Fach füllen. Selbst gemessene Dicken bleiben.",
          onclick: () => { setFit(loc.m, loc.k, fitLayer, !fitted); after(fitted ? "Wieder mit geschätzter Dicke gezeichnet." : `Die ${fitLayer === "back" ? "hintere" : "vordere"} Reihe füllt jetzt das ganze Fach.`); } },
          fitted ? "↔ Wieder geschätzte Dicken" : "↔ Fach ist voll – auf ganze Breite verteilen"),
        el("button", { class: "btn sm", onclick: () => { close(); S.selMode = true; endPick(); layerList(loc.m, loc.k, fitLayer).forEach(id => S.sel.add(id)); renderWall(); } }, "☑ Bücher dieser Reihe auswählen"),
        el("button", { class: "btn sm ghost danger", onclick: async () => { const ids = [...layerList(loc.m, loc.k, "front"), ...layerList(loc.m, loc.k, "back"), ...layerList(loc.m, loc.k, "top")]; if (await confirmBox(`Alle ${ids.length} Bücher aus diesem Fach zurück in „Noch nicht eingeräumt“ legen?`, "Fach leeren")) { ids.forEach(id => { unshelve(id); setLying(id, false); }); await after("Fach geleert."); } } }, "Ganzes Fach leeren")),
      el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: close }, "Schließen"), el("button", { class: "btn primary", onclick: () => { close(); openDetail(b.id); } }, "Buch öffnen")))));
  document.body.append(box);
}
function newWallDialog() {
  const name = el("input", { class: "field", value: S.shelves.walls.length ? "" : "Wohnzimmer", placeholder: "z. B. Wohnzimmer, Arbeitszimmer" });
  let preset = "2x6112";
  const presets = [["6112", "Ein 2er-Würfel (6112)", "69,6 × 35,4 cm · 2 Fächer"], ["6112v", "Ein 2er-Würfel hochkant", "35,4 × 69,6 cm · 2 Fächer übereinander"], ["1112", "Ein 4er-Würfel (1112)", "69,6 × 69,6 cm · 4 Fächer"], ["2x6112", "Zwei 2er-Würfel nebeneinander", "139 × 35,4 cm · 4 Fächer"], ["mix", "4er-Würfel + 2er-Würfel nebeneinander", "2 Spalten"], ["empty", "Leer – selbst aufbauen", "Würfel danach unter „Aufbau ändern“ anfügen"]];
  const opts = el("div", { class: "plist" }, ...presets.map(([v, l, d]) => {
    const r = el("input", { type: "radio", name: "preset", value: v, checked: v === preset || null }); r.addEventListener("change", () => preset = v);
    return el("label", { class: "prow" }, r, el("span", {}, el("b", { text: l }), el("div", { class: "saved", text: d })));
  }));
  const close = () => box.remove();
  const create = async () => {
    const n = name.value.trim() || "Regalwand " + (S.shelves.walls.length + 1);
    const col = mods => ({ id: uid().slice(0, 8), modules: mods.map(t => { const m = newModule(t === "6112v" ? "6112" : t); if (t === "6112v") rotateModule(m); return m; }) });
    const columns = preset === "6112" ? [col(["6112"])] : preset === "6112v" ? [col(["6112v"])] : preset === "1112" ? [col(["1112"])] : preset === "2x6112" ? [col(["6112"]), col(["6112"])] : preset === "mix" ? [col(["1112"]), col(["6112"])] : [col([])];
    const w = { id: uid().slice(0, 8), name: n, columns };
    S.shelves.walls.push(w); S.wallId = w.id; S.wallEdit = preset === "empty";
    await saveShelves(); close(); if (location.hash !== "#wand") location.hash = "#wand"; else renderAll();
  };
  const box = el("div", { class: "overlay confirm", style: "z-index:70;align-items:center", onclick: e => { if (e.target === box) close(); } },
    el("div", { class: "sheet", style: "max-width:440px;border-radius:16px" },
      el("div", { class: "sheet-h" }, el("h2", { text: "Regalwand anlegen" }), el("button", { class: "x", onclick: close }, "✕")),
      el("div", { class: "sheet-b" }, el("label", { class: "lbl", text: "Name" }), name,
        el("label", { class: "lbl", style: "margin-top:14px", text: "Start-Aufbau" }), opts,
        el("p", { class: "saved", text: "Du kannst jederzeit weitere Würfel über- oder nebeneinander anfügen, 2er-Würfel hochkant drehen, umstellen und die Farbe ändern." }),
        el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: close }, "Abbrechen"), el("button", { class: "btn primary", onclick: create }, "Anlegen")))));
  document.body.append(box); name.focus();
}
function renameWall(w) {
  const inp = el("input", { class: "field", value: w.name });
  const close = () => box.remove();
  const box = el("div", { class: "overlay confirm", style: "z-index:70;align-items:center" },
    el("div", { class: "sheet", style: "max-width:380px;border-radius:16px" }, el("div", { class: "sheet-b" },
      el("label", { class: "lbl", text: "Name der Regalwand" }), inp,
      el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: close }, "Abbrechen"),
        el("button", { class: "btn primary", onclick: async () => { w.name = inp.value.trim() || w.name; await saveShelves(); close(); renderAll(); } }, "Speichern")))));
  document.body.append(box); inp.focus();
}

/* ================= Buchrücken gestalten ================= */
// b.spine = { color, fg, text, quer, mode: hoch|quer|beides|kein, dir: up|down, querPos: oben|unten, font: serif|sans|mono, size (%), thickCm, heightCm, imageBlob, textOnImage }
const spineImg = new Map();
function spineImgUrl(id, blob) { if (!blob) return null; const c = spineImg.get(id); if (c && c.blob === blob) return c.url; if (c) URL.revokeObjectURL(c.url); const url = URL.createObjectURL(blob); spineImg.set(id, { blob, url }); return url; }
function hexFg(hex) { const m = (hex || "").replace("#", ""); if (m.length < 6) return "#fff"; const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#2a2420" : "#fff"; }
function firstAuthorLast(a) { const first = (a || "").split(/[,;&]| und /)[0].trim().split(/\s+/); return first[first.length - 1] || ""; }
function spineFace(b, thick, len, spOverride, keyForImg) {
  const sp = spOverride || b.spine || {};
  const auto = spineColor(b);
  const bg = sp.color || auto.bg, fg = sp.fg || (sp.color ? hexFg(sp.color) : auto.fg);
  const face = el("div", { class: "face f-" + (sp.font || "serif"), style: `width:${thick}px;height:${len}px;background-color:${bg};color:${fg}` });
  const img = sp.imageBlob ? spineImgUrl(keyForImg || b.id, sp.imageBlob) : null;
  if (img) { face.style.backgroundImage = `url("${img}")`; face.classList.add("img"); }
  const mode = sp.mode || "hoch", scale = (sp.size || 100) / 100;
  const pxCm = len / (+sp.heightCm || spineCm(b).h || 20); // Maßstab der Zeichnung (Pixel je cm)
  const showText = (!img || sp.textOnImage) && mode !== "kein" && thick >= 5;
  const vText = sp.text || b.title || "", qText = sp.quer || (mode === "quer" ? (b.title || "") : firstAuthorLast(b.author));
  // „Rückentitel maximieren“: so groß, wie Breite und Länge des Rückens es erlauben (der Regler zählt dann nicht)
  // Startwert aus der Textbreite; nach dem Zeichnen misst fitMaxTitles im Regal nach und verkleinert, bis der ganze Text sichtbar ist
  const vN = spineFontPx(thick, 0.6, 2 * pxCm, scale), qN = spineFontPx(thick, 0.3, 1.55 * pxCm, scale, 0.6);
  const vPx = sp.maxText ? Math.max(vN, maxFontPx(vText, sp.font, thick * 0.9, len * (mode === "beides" ? 0.68 : 0.9))) : vN;
  const qPx = sp.maxText ? Math.max(qN, maxFontPx(qText, sp.font, len * (mode === "quer" ? 0.35 : 0.18), thick * 0.9)) : qN;
  // nie kleiner als lesbar (MAX_TITLE_MIN bzw. normal); zu lang → erst kurzer Titel (ohne Untertitel), sonst wie gewohnt mit „…“
  const mx = (px, normal, text) => { if (!sp.maxText) return {}; const sh = shortTitle(text); return { "data-min": Math.min(normal, MAX_TITLE_MIN), "data-start": px, ...(sh ? { "data-short": sh } : {}) }; };
  if (showText && (mode === "hoch" || mode === "beides")) face.append(el("span", { class: "vt" + (sp.dir === "down" ? " down" : "") + (sp.maxText ? " mx" : ""), style: `font-size:${vPx}px`, text: vText, ...mx(vPx, vN, vText) }));
  if (showText && (mode === "quer" || mode === "beides")) face.append(el("span", { class: "qt pos-" + (sp.querPos || "unten") + (sp.maxText ? " mx" : ""), style: `font-size:${qPx}px`, text: qText, ...mx(qPx, qN, qText) }));
  return face;
}
// Schriftgröße: Grundgröße wie bisher (Anteil der Rückenbreite, höchstens „cap“, mindestens 6 px), der Regler vergrößert bzw.
// verkleinert sie stufenlos – begrenzt nur durch die Breite des Rückens. Früher wurde erst danach auf 6–18 px gekappt,
// dadurch bewegte der Regler bei dicken und dünnen Büchern oft gar nichts.
function spineFontPx(thick, base, cap, scale, maxF = 0.95) {
  const normal = Math.max(Math.min(6, thick * 0.9), Math.min(thick * base, cap));
  return +Math.max(3, Math.min(thick * maxF, normal * scale)).toFixed(2);
}
// Textbreite bei 100 px Schrift (Canvas, je Schriftart des Rückens) – für „Rückentitel maximieren“
const FACE_FONT = { serif: "500 100px Fraunces, Georgia, serif", sans: "600 100px Inter, system-ui, sans-serif", bold: "800 100px Inter, system-ui, sans-serif", mono: "600 100px 'Courier New', monospace" };
let measureCtx = null; const measureCache = new Map();
function textW100(text, font) {
  const f = FACE_FONT[font] ? font : "serif", k = f + "|" + text;
  let w = measureCache.get(k);
  if (w == null) {
    measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
    measureCtx.font = FACE_FONT[f]; w = measureCtx.measureText(text).width * (f === "bold" ? 1.04 : 1);
    if (measureCache.size > 5000) measureCache.clear(); measureCache.set(k, w);
  }
  return w || 1;
}
// Maximierte Rückentitel nach dem Zeichnen nachmessen: verkleinern, bis nichts abgeschnitten ist und alles im Rücken liegt.
// Gemessen wird im Browser selbst – so stimmt es auch, wenn eine Schrift anders breit ist als vorausberechnet oder erst später lädt.
// Untergrenze: lesbare Mindestgröße (bzw. die normale, falls kleiner). Reicht das nicht, kommt der kurze Titel (data-short),
// danach kürzt das „…“ wie bei normalen Rücken.
const MAX_TITLE_MIN = 7; // px – kleiner ist auf dem Rücken nicht mehr gut lesbar
function shortTitle(t) { const s = String(t || "").split(/\s[–—-]\s|:\s|\.\s/)[0].trim(); return s && s.length >= 3 && s.length < String(t).trim().length ? s : ""; }
// Volle Größe des Textes ohne jede Begrenzung (unsichtbare Kopie im selben Rücken) – der Browser meldet ein „…“ bei
// senkrechter Schrift nicht zuverlässig über scrollHeight.
function titleNatural(t, f) {
  const probe = extra => {
    const c = t.cloneNode(true);
    c.style.cssText += ";position:absolute;left:0;top:0;visibility:hidden;max-height:none;max-width:none;min-height:0;overflow:visible;margin:0;" + extra;
    f.append(c); const r = { h: c.offsetHeight, w: c.offsetWidth }; c.remove(); return r;
  };
  if (!t.classList.contains("qt")) return probe("height:auto;width:auto"); // senkrecht: ganze Länge, Zeilenbreite
  // quer: Höhe bei Rückenbreite (umbrochen), Breite des längsten Wortes
  return { h: probe(`width:${f.clientWidth}px`).h, w: probe("width:min-content").w };
}
function fitMaxTitles(root) {
  if (!root) return;
  let todo = [...root.querySelectorAll(".face .mx")];
  for (let pass = 0; pass < 8 && todo.length; pass++) {
    const over = todo.map(t => {
      const f = t.parentElement, W = f.clientWidth, H = f.clientHeight;
      if (!W || !H) return null; // nicht sichtbar (z. B. ausgeblendet) – später
      const n = titleNatural(t, f);
      let r;
      if (t.classList.contains("vt")) { // senkrecht: Länge in den Rücken (ohne Querschrift, 94 % wie im CSS), Zeilenhöhe in die Breite
        const q = [...f.children].find(x => x !== t && x.classList.contains("qt"));
        const len = (H - (q ? q.offsetHeight : 0)) * 0.94 - 1;
        r = Math.min(len / n.h, (W - 1) / n.w);
      } else r = Math.min(H * 0.4 / n.h, W / n.w); // quer: höchstens 40 % der Höhe, kein Wort breiter als der Rücken
      return r < 0.995 ? [t, r] : null;
    }).filter(Boolean);
    todo = [];
    for (const [t, r] of over) {
      const px = parseFloat(t.style.fontSize), min = +t.dataset.min || 3;
      if (px <= min) { // ganzer Text passt nicht lesbar → kurzer Titel, neu einpassen
        if (t.dataset.short && t.textContent !== t.dataset.short) { t.textContent = t.dataset.short; t.style.fontSize = t.dataset.start + "px"; todo.push(t); }
        continue;
      }
      t.style.fontSize = Math.max(min, px * Math.min(0.95, r * 0.97)).toFixed(2) + "px";
      todo.push(t);
    }
  }
}
// Webschriften laden evtl. erst nach dem Zeichnen – dann einmal nachmessen
let fontsFitted = false;
function fitMaxTitlesSoon(root) {
  requestAnimationFrame(() => fitMaxTitles(root));
  if (!fontsFitted && document.fonts && document.fonts.status !== "loaded") { fontsFitted = true; document.fonts.ready.then(() => { if (root.isConnected) fitMaxTitles(root); }); }
}
// größte Schrift: quer zur Schreibrichtung höchstens „across“, längs passt der ganze Text in „along“
function maxFontPx(text, font, across, along) { return +Math.max(3, Math.min(across, text ? along / textW100(text, font) * 100 : across)).toFixed(2); }
async function rotateBlob(blob, deg = 90) {
  const img = await loadImage(blob); const c = document.createElement("canvas");
  c.width = img.naturalHeight; c.height = img.naturalWidth;
  const x = c.getContext("2d"); x.translate(c.width / 2, c.height / 2); x.rotate(deg * Math.PI / 180); x.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return canvasBlob(c, .88);
}
async function prepSpineImage(file) {
  let blob = file; let img = await loadImage(blob);
  if (img.naturalWidth > img.naturalHeight) { blob = await rotateBlob(blob, -90); img = await loadImage(blob); } // Rücken ist immer höher als breit
  const c = toCanvas(img, 900); return { blob: await canvasBlob(c, .86), ratio: c.width / c.height };
}
/* Rückenfoto übernehmen (Editor, Prüfen & speichern, Bearbeiten): aufrichten, verkleinern und – nur wenn noch keine Dicke
   gesetzt ist – die Dicke aus Seitenverhältnis und Höhe berechnen. Gibt ein neues spine-Objekt zurück, b bleibt unverändert. */
async function spineWithPhoto(b, file, sp = b.spine) {
  const { blob, ratio } = await prepSpineImage(file);
  const out = { ...(sp || {}), imageBlob: blob };
  if (!+out.thickCm) out.thickCm = Math.round(spineCm({ ...b, spine: out }).h * ratio * 10) / 10;
  return out;
}
/* Knöpfe für ein Rückenfoto ohne Umweg über den Editor. Am Handy öffnet „📷 Rückenfoto“ direkt die Kamera. */
function spinePhotoButtons(onFile, label = "📷 Rückenfoto") {
  const m = isMobile();
  return [
    el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(m); if (f) onFile(f); } }, label),
    m ? el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(false); if (f) onFile(f); } }, "Galerie") : null];
}
/* Kleine Vorschau eines Buchrückens (stehend). */
function spineMini(b, key, sc = 6) { const c = spineCm(b); return el("div", { class: "spine", style: `width:${c.w * sc}px;height:${c.h * sc}px` }, spineFace(b, c.w * sc, c.h * sc, null, key)); }
function spineEditor(b, onSave) {
  const d = { mode: "hoch", dir: "up", querPos: "unten", font: "serif", size: 100, ...(b.spine || {}) };
  const est = (() => { const p = +b.pages || 0; return { w: p ? Math.min(7, Math.max(0.8, p * 0.0058 + 0.35)) : 2.2, h: 18 + (hue(b.id || b.title) % 60) / 10 }; })();
  const prevKey = "edit-" + b.id;
  const prev = el("div", { class: "spprev" });
  const drawPrev = () => {
    const sc = 9, w = (+d.thickCm || est.w) * sc, h = (+d.heightCm || est.h) * sc;
    const stand = el("div", { class: "spine", style: `width:${w}px;height:${h}px` }, spineFace(b, w, h, d, prevKey));
    const lieFace = spineFace(b, w, h, d, prevKey); lieFace.style.cssText += ";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(90deg)";
    const lie = el("div", { class: "spine lie", style: `width:${h}px;height:${w}px` }, lieFace);
    fillNode(prev, el("div", { class: "spcol" }, el("small", { text: "stehend" }), stand), el("div", { class: "spcol" }, el("small", { text: "liegend" }), lie));
    requestAnimationFrame(() => fitMaxTitles(prev));
    syncSize();
  };
  const field = (label, input, cls = "c3") => el("div", { class: cls }, el("label", { class: "lbl", text: label }), input);
  const on = (inp, fn, ev = "input") => { inp.addEventListener(ev, () => { fn(inp); drawPrev(); }); return inp; };
  const autoCol = spineColor(b).bg;
  const toHex = c => { if (/^#/.test(c)) return c; const m = c.match(/\d+/g); if (!m) return "#7a6f64"; if (c.startsWith("hsl")) { const [h, s, l] = m.map(Number); const a = s / 100 * Math.min(l / 100, 1 - l / 100); const f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); }; return "#" + f(0) + f(8) + f(4); } return "#" + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, "0")).join(""); };
  const col = on(el("input", { type: "color", value: d.color || toHex(autoCol), class: "colin" }), i => { d.color = i.value; });
  const fgSel = on(el("select", { class: "field" }, el("option", { value: "", selected: !d.fg || null }, "automatisch"), el("option", { value: "#ffffff", selected: d.fg === "#ffffff" || null }, "hell"), el("option", { value: "#1f1b18", selected: d.fg === "#1f1b18" || null }, "dunkel"), el("option", { value: "#c9a24a", selected: d.fg === "#c9a24a" || null }, "gold")), i => { d.fg = i.value; }, "change");
  const txt = on(el("input", { class: "field", value: d.text || "", placeholder: b.title || "Titel" }), i => { d.text = i.value; });
  const quer = on(el("input", { class: "field", value: d.quer || "", placeholder: firstAuthorLast(b.author) || "z. B. Verlag, Nr., Autor" }), i => { d.quer = i.value; });
  const modeSeg = el("div", { class: "seg" });
  const drawMode = () => modeSeg.replaceChildren(...[["hoch", "Hochkant"], ["quer", "Quer"], ["beides", "Beides"], ["kein", "Kein Text"]].map(([v, l]) => el("button", { type: "button", class: d.mode === v ? "on" : "", onclick: () => { d.mode = v; drawMode(); drawPrev(); } }, l)));
  drawMode();
  const dir = on(el("select", { class: "field" }, el("option", { value: "up", selected: d.dir !== "down" || null }, "von unten nach oben (deutsch)"), el("option", { value: "down", selected: d.dir === "down" || null }, "von oben nach unten (englisch)")), i => { d.dir = i.value; }, "change");
  const qpos = on(el("select", { class: "field" }, el("option", { value: "unten", selected: d.querPos !== "oben" || null }, "unten"), el("option", { value: "oben", selected: d.querPos === "oben" || null }, "oben")), i => { d.querPos = i.value; }, "change");
  const font = on(el("select", { class: "field" }, ...[["serif", "Serif"], ["sans", "Serifenlos"], ["bold", "Fett"], ["mono", "Schreibmaschine"]].map(([v, l]) => el("option", { value: v, selected: d.font === v || null }, l))), i => { d.font = i.value; }, "change");
  // Schriftgröße stufenlos (40–200 %); ohne sichtbaren Text ausgegraut, mit Hinweis warum
  const size = on(el("input", { type: "range", min: 40, max: 200, step: 1, value: d.size || 100, "aria-label": "Schriftgröße" }), i => { d.size = +i.value; delete d.maxText; });
  const sizeTxt = el("span", { class: "saved", style: "min-width:44px;text-align:right" }), sizeHint = el("div", { class: "saved" });
  const sizeBox = el("div", {}, el("div", { style: "display:flex;gap:8px;align-items:center" }, size, sizeTxt,
    el("button", { class: "btn sm ghost", type: "button", title: "Normale Größe", onclick: () => { d.size = 100; size.value = 100; delete d.maxText; drawPrev(); } }, "100 %"),
    el("button", { class: "btn sm ghost", type: "button", title: "Rückentitel so groß wie möglich", onclick: () => { d.maxText = true; drawPrev(); } }, "Max")), sizeHint);
  const syncSize = () => {
    const off = d.mode === "kein" ? "Bei „Kein Text“ gibt es keine Schrift." : d.imageBlob && !d.textOnImage ? "Das Foto ersetzt den Text – „Text trotzdem zeigen“ anhaken, dann wirkt die Schriftgröße." : "";
    size.disabled = !!off; sizeBox.classList.toggle("sizeoff", !!off); sizeTxt.textContent = d.maxText ? "Max" : (d.size || 100) + " %"; sizeHint.textContent = off;
  };
  const thick = on(el("input", { class: "field", type: "number", step: "0.1", min: "0.3", max: "15", value: d.thickCm || "", placeholder: est.w.toFixed(1) }), i => { d.thickCm = i.value ? +i.value : ""; });
  const height = on(el("input", { class: "field", type: "number", step: "0.5", min: "8", max: "33", value: d.heightCm || "", placeholder: est.h.toFixed(1) }), i => { d.heightCm = i.value ? +i.value : ""; });
  const textOnImg = el("input", { type: "checkbox", checked: d.textOnImage || null });
  textOnImg.addEventListener("change", () => { d.textOnImage = textOnImg.checked; drawPrev(); });
  const imgInfo = el("span", { class: "saved" });
  const imgBtns = el("div", { class: "covertools" });
  const setImage = async f => {
    try {
      const had = +d.thickCm; Object.assign(d, await spineWithPhoto(b, f, d)); thick.value = d.thickCm || "";
      drawImgBtns(); drawPrev(); toast(had ? "Bild übernommen." : "Bild übernommen – die Dicke wurde aus dem Bild berechnet.", 2600);
    } catch { toast("Bild konnte nicht gelesen werden."); }
  };
  const drawImgBtns = () => {
    const m = isMobile();
    fillNode(imgBtns,
      m ? el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(true); if (f) setImage(f); } }, "📷 Rücken fotografieren") : null,
      el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(false); if (f) setImage(f); } }, m ? "Galerie" : "🖼 Bild wählen"),
      d.imageBlob ? el("button", { class: "btn sm", type: "button", onclick: async () => { d.imageBlob = await rotateBlob(d.imageBlob, 180); drawPrev(); } }, "↻ 180° drehen") : null,
      d.imageBlob ? el("button", { class: "btn sm ghost danger", type: "button", onclick: () => { d.imageBlob = null; drawImgBtns(); drawPrev(); } }, "Bild entfernen") : null,
      d.imageBlob ? el("label", { class: "saved", style: "display:flex;gap:6px;align-items:center" }, textOnImg, "Text trotzdem zeigen") : null);
    imgInfo.textContent = d.imageBlob ? "" : (m ? "" : "Tipp: Bild auch hierher ziehen oder mit Strg+V einfügen.");
  };
  drawImgBtns();
  const prevPaste = S.pasteHandler; S.pasteHandler = setImage;
  const close = () => { S.pasteHandler = prevPaste; const c = spineImg.get(prevKey); if (c) { URL.revokeObjectURL(c.url); spineImg.delete(prevKey); } box.remove(); };
  const clean = () => { const o = { ...d }; for (const k of Object.keys(o)) if (o[k] === "" || o[k] == null || o[k] === false) delete o[k]; if (o.mode === "hoch") delete o.mode; if (o.dir === "up") delete o.dir; if (o.querPos === "unten") delete o.querPos; if (o.font === "serif") delete o.font; if (o.size === 100) delete o.size; return Object.keys(o).length ? o : null; };
  const body = el("div", { class: "sheet-b spedit" },
    el("div", { class: "spgrid" }, prev,
      el("div", { class: "spfields" },
        el("div", { class: "fgrid" },
          field("Farbe", el("div", { style: "display:flex;gap:6px;align-items:center" }, col, el("button", { class: "btn sm ghost", type: "button", onclick: () => { delete d.color; col.value = toHex(autoCol); drawPrev(); } }, "aus Cover"))),
          field("Schriftfarbe", fgSel),
          el("div", { class: "c6" }, el("label", { class: "lbl", text: "Text-Anordnung" }), modeSeg),
          field("Text hochkant", txt, "c6"),
          field("Leserichtung", dir, "c3"), field("Schrift", font, "c3"),
          field("Text quer (z. B. Autor, Verlag, Band-Nr.)", quer, "c4"), field("Position", qpos, "c2"),
          field("Schriftgröße", sizeBox, "c6"),
          field("Dicke (cm)", thick), field("Höhe (cm)", height)),
        el("div", { class: "sec" }, el("h3", { text: "Eigenes Bild vom Buchrücken" }),
          el("p", { class: "saved", style: "margin:0 0 8px", text: "Ein Foto des Rückens ersetzt Farbe und Text. Querformat-Fotos werden automatisch gedreht; die Dicke wird aus dem Seitenverhältnis berechnet." }),
          imgBtns, imgInfo))),
    el("div", { class: "actions" },
      el("button", { class: "btn ghost", type: "button", onclick: () => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, { mode: "hoch", dir: "up", querPos: "unten", font: "serif", size: 100 }); onSave(null); close(); toast("Buchrücken wieder automatisch."); } }, "Zurücksetzen"),
      el("div", { class: "covertools" }, el("button", { class: "btn", type: "button", onclick: close }, "Abbrechen"), el("button", { class: "btn primary", type: "button", onclick: () => { onSave(clean()); close(); } }, "Übernehmen"))));
  if (!isMobile()) { body.addEventListener("dragover", e => e.preventDefault()); body.addEventListener("drop", e => { e.preventDefault(); const f = [...e.dataTransfer.files].find(f => f.type.startsWith("image/")); if (f) setImage(f); }); }
  const box = el("div", { class: "overlay confirm", style: "z-index:75", onclick: e => { if (e.target === box) close(); } },
    el("div", { class: "sheet", style: "max-width:720px" },
      el("div", { class: "sheet-h" }, el("h2", { text: "🎨 Buchrücken gestalten" }), el("button", { class: "x", onclick: close }, "✕")), body));
  document.body.append(box); drawPrev();
}
async function editSpineDirect(b) {
  spineEditor(b, async sp => { await patchBook(b.id, { spine: sp }); renderAll(); toast("Buchrücken gespeichert."); });
}

/* ================= Verwaltung (Tabelle) ================= */
// Kurzangaben zu Widmung/Signatur/Anhängen – hier statt in attachments.js, weil die Tabelle sie schon beim ersten Rendern braucht
function hasSignInfo(b) { return !!(b.signed || b.signedBy || b.dedication); }
function signSummary(b) { return [b.signed ? "✍ signiert" + (b.signedBy ? " von " + b.signedBy : "") : (b.signedBy ? "✍ " + b.signedBy : ""), b.dedication ? "🖋 Widmung" : ""].filter(Boolean).join(" · "); }
function extrasSummary(b) { return [signSummary(b), (b.images || []).length ? "🖼 " + b.images.length : "", (b.files || []).length ? "📎 " + b.files.length : ""].filter(Boolean).join(" · "); }

/* ---------- Mögliche Dubletten (Zusammenführen: duplicates.js) ---------- */
// Gleiche ISBN – oder gleicher Titel + Autor, solange ISBN bzw. Band-Nr. nicht widersprechen.
// Paare, die als „verschiedene Bücher“ bestätigt wurden, stehen im optionalen Feld b.notDup (Liste von Buch-IDs).
const notDupPair = (a, b) => (a.notDup || []).includes(b.id) || (b.notDup || []).includes(a.id);
// Band-Nummer aus Rücken- oder Titeltext: „… am Kamin 8 13427“ → 8, „Band 3“ → 3, „… · 32“ → 32.
// Nur 1–3-stellig; Jahreszahlen und Verlags-Bestellnummern (4–6 Ziffern) zählen nicht, Zahlen mitten im Titel („aus 40 Jahren“) auch nicht.
function volFromText(s) {
  s = String(s || "");
  let m = s.match(/\b(?:band|bd\.?|teil|folge|vol\.?|volume|tome)\s*(\d{1,3})\b/i); if (m) return String(+m[1]);
  m = s.match(/(?:^|[^\d.,])(\d{1,3})\s*[.)]?\s*(?:[·|\-–]\s*)?(?:\d{4,6})?\s*$/); if (m) return String(+m[1]);
  return "";
}
// Band eines gespeicherten Buchs: Band-Nr. (falls kurz) oder aus dem erkannten Rückentext
function volOf(b) { const s = String(b.seriesNo ?? "").trim(); return /^\d{1,3}$/.test(s) ? String(+s) : volFromText(b.spine?.text); }
function dupConflict(a, b) {
  const i = toIsbn13(a.isbn), j = toIsbn13(b.isbn); if (i && j && i !== j) return true;
  const x = String(a.seriesNo ?? "").trim(), y = String(b.seriesNo ?? "").trim();
  const short = s => /^\d{1,3}$/.test(s); // Band-Nr. (kurz) und Verlagsnummer (lang) sind nicht vergleichbar
  if (x && y && x !== y && short(x) === short(y)) return true;
  const u = volOf(a), v = volOf(b); return !!(u && v && u !== v); // verschiedene Bände einer Reihe – auch wenn (fälschlich) dieselbe ISBN
}
function dupGroups(books = S.books) {
  const parent = new Map(books.map(b => [b.id, b.id]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const buckets = new Map(), put = (k, b) => { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(b); };
  for (const b of books) {
    const i = toIsbn13(b.isbn); if (i) put("i" + i, b);
    const t = normS(b.title); if (t) put("t" + t + "\u0001" + normS(b.author), b);
  }
  for (const [k, list] of buckets) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    const a = list[x], b = list[y];
    if (notDupPair(a, b) || dupConflict(a, b)) continue;
    parent.set(find(a.id), find(b.id));
  }
  const groups = new Map();
  for (const b of books) { const r = find(b.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(b); }
  return [...groups.values()].filter(g => g.length > 1);
}
const COLS = [
  { k: "sel", l: "", nos: true, w: 40, fixed: true }, // Auswahl für Mehrfach-Aktionen (immer sichtbar)
  { k: "cover", l: "", nos: true, w: 62 },
  { k: "title", l: "Titel", w: 220 }, { k: "author", l: "Autor", w: 170 }, { k: "year", l: "Jahr", w: 70 },
  { k: "isbn", l: "ISBN", w: 140 }, { k: "publisher", l: "Verlag", w: 130 }, { k: "series", l: "Reihe", w: 140 }, { k: "seriesNo", l: "Band", w: 60 }, { k: "pages", l: "Seiten", w: 70 }, { k: "price", l: "Preis €", w: 80 }, { k: "value", l: "Wert €", w: 80 },
  { k: "genre", l: "Genre", w: 110 }, { k: "status", l: "Status", w: 130 }, { k: "rating", l: "★", w: 70 }, { k: "favorite", l: "♥", w: 44 },
  { k: "tags", l: "Schlagworte", w: 180 },
  { k: "reads", l: "Gelesen", w: 110 },
  { k: "extras", l: "Extras", w: 150 },
  { k: "location", l: "Standort / Verbleib", w: 200 },
  { k: "addedAt", l: "Hinzugefügt", w: 100 }, { k: "missing", l: "Fehlt", w: 150 }, { k: "act", l: "", nos: true, w: 150 },
];
// Spaltentypen für Filter: Text (Standard), Zahl, Datum, Auswahl
const COL_TYPE = { year: "num", seriesNo: "num", pages: "num", price: "num", value: "num", addedAt: "date", reads: "date", status: "sel", rating: "sel", favorite: "sel", cover: "sel" };
const COL_NAME = { sel: "Auswahl", cover: "Cover", rating: "Bewertung", favorite: "Lieblingsbuch", price: "Preis", value: "Wert", location: "Standort", seriesNo: "Band", act: "Aktionen" };
const colLabel = k => COL_NAME[k] || COLS.find(c => c.k === k)?.l || k;
const SEL_OPTS = {
  status: [["", "alle"], ...Object.entries(STATUS)],
  rating: [["", "alle"], ["0", "ohne"], ["1", "ab 1★"], ["2", "ab 2★"], ["3", "ab 3★"], ["4", "ab 4★"], ["5", "5★"]],
  favorite: [["", "alle"], ["yes", "♥ ja"], ["no", "nein"]],
  cover: [["", "alle"], ["yes", "mit"], ["no", "ohne"]],
};
const FILTER_HELP = {
  text: "Enthält … · !wort = enthält nicht · a | b = oder · =wort = genau so · leer / !leer",
  num: "Zahl · >1990 · <=20 · 1980-1990 · leer / !leer · mehrere mit |",
  date: "2025 · 03.2025 · >2024 · 2023..2025 · leer = nie · mehrere mit |",
};
// gespeicherte Tabellen-Einstellungen (nur dieses Gerät). Felder nur ergänzen – ältere Stände ohne hidden/widths/… bleiben gültig.
const T_FILTER_KEYS = ["all", "unread", "reading", "read", "fav", "unplaced", "gone", "wish", "nocover", "incomplete", "dup"];
const DEFAULT_SORTS = () => [{ key: "addedAt", dir: -1 }];
(() => { try { const t = JSON.parse(localStorage.getItem("tableView") || "null"); if (t) {
  S.colF = t.colF || {}; S.tSorts = t.sorts; S.showColF = t.showF; S.tHidden = t.hidden; S.tW = t.widths; S.tView = t.view;
  if (T_FILTER_KEYS.includes(t.tFilter)) S.tFilter = t.tFilter;
  if (typeof t.tTag === "string") S.tTag = t.tTag;
  if (typeof t.tq === "string") S.tq = t.tq;
} } catch {} })();
S.colF = S.colF && typeof S.colF === "object" ? S.colF : {};
S.tSorts = Array.isArray(S.tSorts) && S.tSorts.length ? S.tSorts : DEFAULT_SORTS();
if (typeof S.showColF !== "boolean") S.showColF = true;
S.tHidden = Array.isArray(S.tHidden) ? S.tHidden.filter(k => k !== "title" && COLS.some(c => c.k === k)) : [];
S.tW = S.tW && typeof S.tW === "object" ? S.tW : {};
S.tView = typeof S.tView === "string" ? S.tView : "";
S.tTag = S.tTag || "";
if (S.tq) $("#tq").value = S.tq;
function saveTableView() {
  try { localStorage.setItem("tableView", JSON.stringify({ colF: S.colF, sorts: S.tSorts, showF: S.showColF, hidden: S.tHidden, widths: S.tW, tFilter: S.tFilter, tTag: S.tTag, tq: S.tq, view: S.tView })); } catch {}
}
// benannte Ansichten (Filter, Sortierung, Spalten, Breiten)
S.tViews = (() => { try { const v = JSON.parse(localStorage.getItem("tableViews") || "[]"); return Array.isArray(v) ? v.filter(x => x && typeof x.name === "string" && x.name.trim()) : []; } catch { return []; } })();
function saveViews() { try { localStorage.setItem("tableViews", JSON.stringify(S.tViews)); } catch {} }

/* ---------- Spalten: sichtbar, Breite ---------- */
const MIN_COL_W = 40;
const visCols = () => COLS.filter(c => c.fixed || !S.tHidden.includes(c.k));

/* ---------- Mehrfachauswahl (z. B. mehrere Bücher löschen) ---------- */
S.tSel = new Set(); // ausgewählte Buch-IDs – wird geleert, sobald sich Filter oder Sortierung ändern
function updSel() {
  const list = S.tList || [];
  const n = list.filter(b => S.tSel.has(b.id)).length;
  const all = $("#tbl thead input.selall");
  if (all) { all.checked = !!list.length && n === list.length; all.indeterminate = n > 0 && n < list.length; }
  for (const tr of $("#tbl").querySelectorAll("tbody tr[data-id]")) {
    const on = S.tSel.has(tr.dataset.id); tr.classList.toggle("selrow", on);
    const cb = tr.querySelector("input.selcb"); if (cb) cb.checked = on;
  }
  renderTableBar(list, anyTableFilter());
}
function selectAllShown(on) { S.tSel = new Set(on ? (S.tList || []).map(b => b.id) : []); S.tSelLast = null; updSel(); }
function selCell(b) {
  const cb = el("input", { type: "checkbox", class: "selcb", checked: S.tSel.has(b.id) || null, "aria-label": "Auswählen: " + (b.title || "ohne Titel"), title: "Auswählen · Umschalt+Klick: Bereich" });
  cb.addEventListener("click", e => {
    const list = S.tList || [], idx = list.indexOf(b);
    if (e.shiftKey && S.tSelLast != null && idx >= 0) { // Bereich bis zum zuletzt angeklickten Buch
      for (const x of list.slice(Math.min(idx, S.tSelLast), Math.max(idx, S.tSelLast) + 1)) cb.checked ? S.tSel.add(x.id) : S.tSel.delete(x.id);
    } else if (cb.checked) S.tSel.add(b.id); else S.tSel.delete(b.id);
    S.tSelLast = idx; updSel();
  });
  return el("td", { class: "seltd" }, cb);
}
async function deleteSelected() {
  const books = (S.tList || []).filter(b => S.tSel.has(b.id));
  if (!books.length) return;
  const n = books.length;
  const names = books.slice(0, 6).map(b => "• " + (b.title || "ohne Titel") + (b.author ? " – " + b.author : "")).join("\n") + (n > 6 ? `\n… und ${n - 6} weitere` : "");
  const syncOn = typeof SY !== "undefined" && SY.conf?.on;
  if (!(await confirmBox(`${n === 1 ? "Dieses Buch" : `Diese ${n} Bücher`} endgültig löschen?\n\n${names}\n\nAuch ihre Bilder und Dateien werden gelöscht.` +
    (syncOn ? " Durch den Abgleich verschwinden sie auch auf deinen anderen Geräten." : "") +
    "\n\nTipp: Bücher, die du nur weggegeben hast, besser als „📦 Hatte ich mal“ markieren.", n === 1 ? "Löschen" : `${n} Bücher löschen`))) return;
  const t = toast(`Lösche ${n} …`, 60000);
  for (const b of books) await removeBook(b.id);
  t.remove();
  S.tSel.clear(); S.tSelLast = null;
  toast(n === 1 ? "1 Buch gelöscht." : `${n} Bücher gelöscht.`);
  renderAll();
}
const colW = col => Math.max(MIN_COL_W, Math.round(+S.tW[col.k] || col.w));
function setColHidden(k, hide) {
  if (k === "title") return;
  S.tHidden = hide ? [...new Set([...S.tHidden, k])] : S.tHidden.filter(x => x !== k);
  saveTableView(); renderTable();
}
function colGrip(col) {
  const g = el("span", { class: "colgrip", title: "Ziehen: Spaltenbreite ändern · Doppelklick: Standardbreite" });
  g.addEventListener("click", e => e.stopPropagation());
  g.addEventListener("dblclick", e => { e.stopPropagation(); delete S.tW[col.k]; saveTableView(); renderTable(); });
  g.addEventListener("pointerdown", e => {
    if (e.button) return;
    e.preventDefault(); e.stopPropagation();
    const tbl = $("#tbl"), c = tbl.querySelector(`col[data-k="${col.k}"]`); if (!c) return;
    const x0 = e.clientX, w0 = colW(col), rest = (parseFloat(tbl.style.width) || tbl.offsetWidth) - w0;
    let w = w0;
    g.setPointerCapture(e.pointerId); document.body.classList.add("colresizing");
    const move = ev => { w = Math.max(MIN_COL_W, Math.round(w0 + ev.clientX - x0)); c.style.width = w + "px"; tbl.style.width = rest + w + "px"; };
    const up = () => {
      g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
      document.body.classList.remove("colresizing"); S.tResized = Date.now();
      if (w !== w0) { S.tW[col.k] = w; saveTableView(); renderTableBar(tableList(), anyTableFilter()); }
    };
    g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
  });
  return g;
}

/* ---------- benannte Ansichten ---------- */
const canon = v => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v ?? null);
const viewSnap = () => ({ colF: { ...S.colF }, sorts: S.tSorts.map(s => ({ key: s.key, dir: s.dir })), showF: S.showColF, hidden: [...S.tHidden], widths: { ...S.tW }, tFilter: S.tFilter, tTag: S.tTag || "", tq: S.tq || "" });
const currentView = () => S.tViews.find(v => v.name === S.tView) || null;
const viewChanged = v => { const { name, ...rest } = v; return canon(rest) !== canon(viewSnap()); };
function applyView(v) {
  S.colF = { ...(v.colF || {}) };
  S.tSorts = Array.isArray(v.sorts) && v.sorts.length ? v.sorts.map(s => ({ key: s.key, dir: s.dir })) : DEFAULT_SORTS();
  S.showColF = v.showF !== false;
  S.tHidden = (v.hidden || []).filter(k => k !== "title" && COLS.some(c => c.k === k));
  S.tW = { ...(v.widths || {}) };
  S.tFilter = T_FILTER_KEYS.includes(v.tFilter) ? v.tFilter : "all";
  S.tTag = v.tTag || ""; S.tq = v.tq || ""; $("#tq").value = S.tq;
  S.tView = v.name; S.viewsOpen = false;
  saveTableView(); renderTable(); toast(`Ansicht „${v.name}“`);
}
function saveViewAs(name) {
  name = String(name || "").trim();
  if (!name) { toast("Bitte einen Namen für die Ansicht eingeben."); return; }
  const i = S.tViews.findIndex(v => v.name.toLowerCase() === name.toLowerCase());
  const v = { name: i >= 0 ? S.tViews[i].name : name, ...viewSnap() };
  if (i >= 0) S.tViews[i] = v; else S.tViews.push(v);
  saveViews(); S.tView = v.name; S.viewsOpen = false; saveTableView(); renderTable();
  toast(i >= 0 ? `Ansicht „${v.name}“ aktualisiert.` : `Ansicht „${v.name}“ gespeichert.`);
}
async function deleteView(v) {
  if (!(await confirmBox(`Ansicht „${v.name}“ löschen? Die Bücher bleiben unverändert.`))) return;
  S.tViews = S.tViews.filter(x => x !== v); saveViews();
  if (S.tView === v.name) S.tView = "";
  saveTableView(); renderTable();
}
function resetTableView() {
  S.colF = {}; S.tSorts = DEFAULT_SORTS(); S.showColF = true; S.tHidden = []; S.tW = {};
  S.tFilter = "all"; S.tTag = ""; S.tq = ""; $("#tq").value = ""; S.tView = ""; S.viewsOpen = false;
  saveTableView(); renderTable(); toast("Tabelle auf Grundeinstellung zurückgesetzt.");
}

/* ---------- Werte je Spalte ---------- */
const normS = s => String(s ?? "").toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const hasCover = b => !!(b.coverBlob || (b.coverUrl && !S.badCover.has(b.id)));
function locText(b) { if (isGone(b)) return "Hatte ich mal · " + goneText(b.gone); if (isWish(b)) return "Wunschliste"; const l = locationOf(b.id); return l ? locationText(l) : "nicht eingeräumt"; }
function colText(b, k) {
  switch (k) {
    case "tags": return (b.tags || []).join(", ");
    case "extras": return [extrasSummary(b), b.signed ? "signiert" : "", b.signedBy, b.dedication, ...(b.files || []).map(f => f.name), ...(b.images || []).map(i => i.caption)].filter(Boolean).join(" ");
    case "location": return locText(b);
    case "missing": { const m = missingOf(b); return m.length ? m.join(", ") : "vollständig"; }
    default: return String(b[k] ?? "");
  }
}
function colNum(b, k) {
  if (k === "price" || k === "value") return priceNum(b[k]);
  if (k === "seriesNo") { const n = parseFloat(String(b.seriesNo || "").replace(",", ".")); return isFinite(n) ? n : null; }
  const m = String(b[k] ?? "").match(/\d+/); return m ? +m[0] : null;
}
function colDates(b, k) {
  if (k === "addedAt") return b.addedAt ? [b.addedAt.slice(0, 10)] : [];
  if (k === "reads") return readsOf(b).map(r => r.end || r.start).filter(Boolean);
  return [];
}

/* ---------- Filter-Ausdrücke ---------- */
const isEmptyQ = a => /^\(?leer\)?$/i.test(a);
const splitAlts = q => String(q).split("|").map(s => s.trim()).filter(Boolean);
function withNeg(a, make) { let neg = false; if (a.startsWith("!")) { neg = true; a = a.slice(1).trim(); } const t = make(a); return t ? (neg ? v => !t(v) : t) : null; }
function anyOf(tests) { tests = tests.filter(Boolean); return tests.length ? v => tests.some(t => t(v)) : null; }
function cmpTest(a, conv, cmp) {
  let m;
  if ((m = a.match(/^(>=|<=|>|<|=)\s*(.+)$/))) {
    const x = conv(m[2]); if (x == null) return null; const op = m[1];
    return v => { const c = cmp(v, x); return c != null && (op === ">" ? c > 0 : op === "<" ? c < 0 : op === ">=" ? c >= 0 : op === "<=" ? c <= 0 : c === 0); };
  }
  if ((m = a.match(/^(.+?)\s*(?:\.\.|bis)\s*(.+)$/))) {
    const x = conv(m[1]), y = conv(m[2]); if (x == null || y == null) return null;
    return v => { const c1 = cmp(v, x), c2 = cmp(v, y); return c1 != null && c1 >= 0 && c2 <= 0; };
  }
  const x = conv(a); if (x == null) return null;
  return v => cmp(v, x) === 0;
}
function textPred(q) {
  return anyOf(splitAlts(q).map(a => withNeg(a, a => {
    if (isEmptyQ(a)) return v => !normS(v);
    if (a.startsWith("=")) { const x = normS(a.slice(1)); return v => normS(v) === x; }
    const ws = normS(a).split(" ").filter(Boolean); if (!ws.length) return null;
    return v => { const n = normS(v); return ws.every(w => n.includes(w)); };
  })));
}
const toNum = s => { const t = String(s).replace(/\s|€/g, "").replace(",", "."); if (!/^-?\d+(\.\d+)?$/.test(t)) return null; return +t; };
function numPred(q) {
  return anyOf(splitAlts(q).map(a => withNeg(a, a => {
    if (isEmptyQ(a)) return v => v == null;
    const m = a.match(/^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)$/); if (m) a = m[1] + ".." + m[2];
    return cmpTest(a, toNum, (v, x) => v == null ? null : Math.sign(v - x));
  })));
}
function toIsoPrefix(s) {
  s = String(s).trim(); let m;
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if ((m = s.match(/^(\d{1,2})\.(\d{4})$/))) return `${m[2]}-${m[1].padStart(2, "0")}`;
  if ((m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/))) return m[1] + (m[2] ? "-" + m[2].padStart(2, "0") : "") + (m[3] ? "-" + m[3].padStart(2, "0") : "");
  return null;
}
const dateCmp = (v, x) => { if (!v) return null; const p = v.slice(0, x.length); return p < x ? -1 : p > x ? 1 : 0; };
function datePred(q) { // arbeitet auf einer Liste von Daten (z. B. alle Lesedurchgänge)
  return anyOf(splitAlts(q).map(a => withNeg(a, a => {
    if (isEmptyQ(a)) return arr => !arr.length;
    const m = a.match(/^(\d{4})\s*-\s*(\d{4})$/); if (m) a = m[1] + ".." + m[2];
    const one = cmpTest(a, toIsoPrefix, dateCmp); return one ? arr => arr.some(one) : null;
  })));
}
function colPredicate(k, q) {
  const ty = COL_TYPE[k] || "text";
  if (ty === "sel") {
    if (!q) return null;
    if (k === "status") return b => (b.status || "unread") === q;
    if (k === "rating") return q === "0" ? b => !b.rating : q === "5" ? b => b.rating === 5 : b => (b.rating || 0) >= +q;
    if (k === "favorite") return q === "yes" ? b => !!b.favorite : b => !b.favorite;
    if (k === "cover") return q === "yes" ? hasCover : b => !hasCover(b);
    return null;
  }
  if (!String(q || "").trim()) return null;
  if (ty === "num") { const p = numPred(q); return p && (b => p(colNum(b, k))); }
  if (ty === "date") { const p = datePred(q); return p && (b => p(colDates(b, k))); }
  const p = textPred(q); return p && (b => p(colText(b, k)));
}
const activeColFilters = () => Object.entries(S.colF).filter(([, q]) => String(q ?? "").trim() !== "");
function fDesc(k, q) { if (SEL_OPTS[k]) return (SEL_OPTS[k].find(o => o[0] === q) || [, q])[1]; return `„${q}“`; }

/* ---------- Sortierung (mehrstufig) ---------- */
const coll = new Intl.Collator("de", { sensitivity: "base", numeric: true });
const STATUS_ORDER = { unread: 0, reading: 1, read: 2 };
function sortVal(b, k) {
  switch (k) {
    case "missing": return missingOf(b).length;
    case "rating": return b.rating || 0;
    case "year": case "pages": case "seriesNo": case "price": case "value": return colNum(b, k);
    case "favorite": return b.favorite ? 1 : 0;
    case "status": return STATUS_ORDER[b.status || "unread"];
    case "reads": return lastReadDate(b) || null;
    case "tags": return (b.tags || []).join(", ") || null;
    case "extras": return (hasSignInfo(b) ? 10 : 0) + (b.images || []).length + (b.files || []).length;
    case "location": { if (isWish(b) || isGone(b)) return locText(b); const l = locationOf(b.id); return l ? locationShort(l) : null; }
    case "author": return lastName(b.author) ? lastName(b.author) + " " + b.author : null;
    case "addedAt": return b.addedAt || null;
    default: { const v = String(b[k] ?? "").trim(); return v || null; }
  }
}
function cmpBooks(a, b) {
  for (const { key, dir } of S.tSorts) {
    const x = sortVal(a, key), y = sortVal(b, key);
    if (x == null && y == null) continue;
    if (x == null) return 1;            // leere Werte immer ans Ende
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : coll.compare(String(x), String(y));
    if (c) return c * dir;
  }
  return 0;
}
function sortBadge(k) { const i = S.tSorts.findIndex(s => s.key === k); if (i < 0) return ""; return (S.tSorts[i].dir > 0 ? "▲" : "▼") + (S.tSorts.length > 1 ? (i + 1) : ""); }
function clickSort(k, add) {
  const i = S.tSorts.findIndex(s => s.key === k);
  if (add) { if (i >= 0) S.tSorts[i].dir *= -1; else S.tSorts.push({ key: k, dir: 1 }); }
  else if (i === 0) S.tSorts[0].dir *= -1;
  else S.tSorts = [{ key: k, dir: 1 }];
  saveTableView(); renderTable();
}

/* ---------- Darstellung ---------- */
const T_FILTER_NAMES = { unread: "Ungelesen", reading: "Gerade dabei", read: "Gelesen", fav: "♥ Lieblingsbücher", unplaced: "Nicht eingeräumt", gone: "📦 Hatte ich mal", wish: "⭐ Wunschliste", nocover: "Ohne Cover", incomplete: "Unvollständig", dup: "🧩 Mögliche Dubletten" };
const tFilterPass = (b, dup) => S.tFilter === "all" || (S.tFilter === "incomplete" ? missingOf(b).length : S.tFilter === "fav" ? b.favorite : S.tFilter === "unplaced" ? (inStock(b) && !locationOf(b.id)) : S.tFilter === "gone" ? isGone(b) : S.tFilter === "wish" ? isWish(b) : S.tFilter === "nocover" ? needsCover(b) : S.tFilter === "dup" ? dup.has(b.id) : (b.status || "unread") === S.tFilter);
function filteredBooks(exceptCol) {
  const preds = activeColFilters().filter(([k]) => k !== exceptCol).map(([k, q]) => colPredicate(k, q)).filter(Boolean);
  const dup = S.tFilter === "dup" ? new Set(dupGroups().flat().map(b => b.id)) : null;
  return S.books.filter(b => tFilterPass(b, dup) && (!S.tTag || hasTag(b, S.tTag)) && matchQ(b, S.tq) && preds.every(p => p(b)));
}
function tableList() { return filteredBooks().sort(cmpBooks); }
const anyTableFilter = () => !!(activeColFilters().length || S.tq || S.tTag || S.tFilter !== "all");

/* ---------- Vorschläge in den Spaltenfiltern ---------- */
// Werte, die in den gerade sichtbaren Büchern vorkommen (die anderen Filter gelten mit), häufigste zuerst.
const SUGGEST_COLS = new Set(["title", "author", "year", "publisher", "series", "genre", "tags", "location", "missing"]);
function suggestValues(k) {
  const cnt = new Map();
  const add = v => { v = String(v ?? "").trim(); if (v) cnt.set(v, (cnt.get(v) || 0) + 1); };
  for (const b of filteredBooks(k)) {
    if (k === "tags") (b.tags || []).forEach(add);
    else if (k === "missing") { const m = missingOf(b); m.length ? m.forEach(add) : add("vollständig"); }
    else if (k === "year") { const n = colNum(b, "year"); if (n != null) add(String(n)); }
    else add(colText(b, k));
  }
  return [...cnt].sort((a, b) => b[1] - a[1] || coll.compare(a[0], b[0])).slice(0, 300);
}
function fillSuggest(dl, k, inp, force) {
  const v = inp.value, cut = v.lastIndexOf("|");
  const pre = cut >= 0 ? v.slice(0, cut + 1).trimEnd() + " " : ""; // „a | b“: Vorschläge hängen an das schon Getippte an
  if (!force && dl.dataset.pre === pre) return;
  dl.dataset.pre = pre;
  dl.replaceChildren(...suggestValues(k).map(([s, n]) => el("option", { value: pre + s, label: n === 1 ? "1 Buch" : n + " Bücher" })));
}
function markF(inp, k) {
  const q = S.colF[k] || "", on = String(q).trim() !== "";
  inp.classList.toggle("on", on); inp.classList.toggle("bad", on && !colPredicate(k, q));
}
function setColF(k, v, inp) {
  if (String(v ?? "").trim()) S.colF[k] = v; else delete S.colF[k];
  saveTableView(); if (inp) markF(inp, k); renderTableRows();
}
function filterCell(col) {
  const k = col.k;
  if (k === "sel") return el("th", { class: "fth" });
  if (k === "act") return el("th", { class: "fth" }, activeColFilters().length ? el("button", { class: "btn sm ghost", title: "Alle Spaltenfilter aufheben", onclick: () => { S.colF = {}; saveTableView(); renderTable(); } }, "✕ Filter") : null);
  const ty = COL_TYPE[k] || "text";
  const cur = S.colF[k] || "";
  let inp;
  if (ty === "sel") {
    inp = el("select", { "aria-label": "Filter " + colLabel(k) }, ...SEL_OPTS[k].map(([v, l]) => el("option", { value: v, selected: cur === v || null }, l)));
    inp.addEventListener("change", () => setColF(k, inp.value, inp));
  } else {
    const PH = { year: ">1990", seriesNo: "1-3", pages: ">300", price: "<20", value: ">50", addedAt: "2025", reads: "2025" };
    inp = el("input", { type: "search", value: cur, placeholder: PH[k] || "filtern …", title: FILTER_HELP[ty], "aria-label": "Filter " + colLabel(k) });
    let t; inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => setColF(k, inp.value, inp), 160); });
    inp.addEventListener("keydown", e => { if (e.key === "Escape" && inp.value) { e.stopPropagation(); inp.value = ""; setColF(k, "", inp); } if (e.key === "Enter") { clearTimeout(t); setColF(k, inp.value, inp); } });
    if (SUGGEST_COLS.has(k)) {
      const dl = el("datalist", { id: "fsug-" + k });
      inp.setAttribute("list", dl.id);
      inp.addEventListener("focus", () => fillSuggest(dl, k, inp, true));
      inp.addEventListener("click", () => fillSuggest(dl, k, inp, true)); // Liste öffnet beim Klick – andere Filter können sich geändert haben
      inp.addEventListener("input", () => fillSuggest(dl, k, inp));
      markF(inp, k);
      return el("th", { class: "fth" }, inp, dl);
    }
  }
  markF(inp, k);
  return el("th", { class: "fth" }, inp);
}
function renderTable() {
  saveTableView();
  const tbl = $("#tbl");
  const ae = document.activeElement;
  if (tbl.contains(ae) && ae.tagName !== "BUTTON") {
    if (tbl.tHead && tbl.tHead.contains(ae)) { renderTableRows(); return; } // Fokus im Filterfeld: nur Zeilen neu
    S.tableDirty = true; return;
  }
  const c = counts(S.books.filter(inStock)); const inc = S.books.filter(b => missingOf(b).length).length;
  const nDup = dupGroups().reduce((n, g) => n + g.length, 0);
  $("#stats").replaceChildren(
    el("span", {}, el("b", { text: c.all }), "im Bestand"), el("span", {}, el("b", { text: c.read }), "gelesen"),
    el("span", {}, el("b", { text: c.reading }), "gerade dabei"), el("span", {}, el("b", { text: c.unread }), "ungelesen"),
    el("span", {}, el("b", { style: inc ? "color:var(--warn)" : "", text: inc }), "mit fehlenden Daten"),
    el("span", {}, el("b", { text: S.books.filter(isGone).length }), "hatte ich mal"),
    el("span", {}, el("b", { text: S.books.filter(isWish).length }), "auf der Wunschliste"));
  renderFilters($("#tfilters"), S.tFilter, k => { S.tFilter = k; renderTable(); }, [["fav", "♥ Lieblingsbücher", null, S.books.filter(b => b.favorite).length], ["unplaced", "Nicht eingeräumt", null, S.books.filter(b => inStock(b) && !locationOf(b.id)).length], ["gone", "📦 Hatte ich mal", null, S.books.filter(isGone).length], ["wish", "⭐ Wunschliste", null, S.books.filter(isWish).length], ["nocover", "Ohne Cover", null, S.books.filter(needsCover).length], ["incomplete", "Unvollständig", "var(--warn)", inc], ...(nDup || S.tFilter === "dup" ? [["dup", "🧩 Mögliche Dubletten", "var(--warn)", nDup]] : [])]);
  const tts = $("#ttagSlot"); if (tts) { tagDatalist(); fillNode(tts, tagFilterSelect(S.tTag, t => { S.tTag = t; renderTable(); }, S.books)); }
  const cols = visCols();
  const colgroup = el("colgroup", {}, ...cols.map(col => el("col", { "data-k": col.k, style: `width:${colW(col)}px` })));
  tbl.style.width = cols.reduce((s, c) => s + colW(c), 0) + "px";
  const selAllTh = () => {
    const cb = el("input", { type: "checkbox", class: "selall", "aria-label": "Alle angezeigten Bücher auswählen", title: "Alle angezeigten Bücher auswählen (auch die noch nicht geladenen)" });
    cb.addEventListener("change", () => selectAllShown(cb.checked));
    return el("th", { class: "nos seltd", "data-k": "sel" }, cb);
  };
  const thead = el("thead", {},
    el("tr", {}, ...cols.map(col => col.k === "sel" ? selAllTh() : el("th", {
      class: col.nos ? "nos" : null, "data-k": col.k,
      title: col.nos ? null : "Klick: danach sortieren (nochmal: umkehren) · Umschalt+Klick: als weitere Sortierstufe · rechten Rand ziehen: Breite",
      onclick: col.nos ? null : e => { if (e.target.closest(".colgrip") || Date.now() - (S.tResized || 0) < 300) return; clickSort(col.k, e.shiftKey); },
    }, col.l, el("span", { class: "sortb", text: sortBadge(col.k) }), colGrip(col)))),
    S.showColF ? el("tr", { class: "frow" }, ...cols.map(filterCell)) : null);
  tbl.replaceChildren(colgroup, thead, el("tbody"));
  renderTableRows();
}
function tableRow(b, cols = visCols()) {
  const cellInput = (b, k) => {
    const i = el("input", { value: b[k] ?? "" });
    i.addEventListener("change", () => { const v = k === "isbn" ? (toIsbn13(i.value) || i.value.trim()) : i.value.trim(); patchBook(b.id, { [k]: v }); });
    i.addEventListener("keydown", e => { if (e.key === "Enter") i.blur(); });
    return i;
  };
  const miss = missingOf(b);
  const cell = col => {
    const k = col.k;
    if (k === "sel") return selCell(b);
    if (k === "cover") { const src = coverSrc(b); return el("td", {}, el("div", { class: "thumb" + (needsCover(b) ? " nocov" : ""), title: needsCover(b) ? "Cover online suchen" : "Details öffnen", onclick: () => needsCover(b) ? findCoverFor(b.id) : openDetail(b.id) }, src ? el("img", { src, alt: "", loading: "lazy", onerror: e => e.target.remove() }) : (needsCover(b) ? el("span", { text: "🖼" }) : null))); }
    if (k === "status") { const s = el("select", {}, ...Object.entries(STATUS).map(([v, l]) => el("option", { value: v, selected: (b.status || "unread") === v || null }, l))); s.addEventListener("change", () => patchBook(b.id, statusPatch(b, s.value))); return el("td", {}, s); }
    if (k === "tags") { const i = el("input", { value: (b.tags || []).join(", "), placeholder: "", list: "taglist", title: "Mehrere mit Komma trennen" }); i.addEventListener("change", () => patchBook(b.id, { tags: normTags(i.value) })); i.addEventListener("keydown", e => { if (e.key === "Enter") i.blur(); }); return el("td", {}, i); }
    if (k === "extras") return el("td", { style: "padding:0 8px;font-size:12.5px;color:var(--muted);white-space:nowrap", title: [b.dedication ? "Widmung: " + b.dedication : "", ...(b.files || []).map(f => f.name)].filter(Boolean).join("\n"), text: extrasSummary(b) });
    if (k === "reads") { const r = readsOf(b); const d = lastReadDate(b); return el("td", { style: "padding:0 8px;font-size:12.5px;color:var(--muted);white-space:nowrap", title: r.map(readText).join("\n"), text: r.length ? `${r.filter(x => x.end).length}× · ${fmtD(d)}` : "" }); }
    if (k === "rating") { const s = el("select", {}, ...[0, 1, 2, 3, 4, 5].map(n => el("option", { value: n, selected: (b.rating || 0) === n || null }, n ? n + "★" : "–"))); s.addEventListener("change", () => patchBook(b.id, { rating: +s.value })); return el("td", {}, s); }
    if (k === "favorite") { const cb = el("input", { type: "checkbox", checked: b.favorite || null, title: "Lieblingsbuch", style: "width:18px;height:18px;min-width:0;accent-color:var(--accent)" }); cb.addEventListener("change", () => patchBook(b.id, { favorite: cb.checked })); return el("td", { style: "text-align:center" }, cb); }
    if (k === "location" && isGone(b)) return el("td", { style: "padding:0 8px;font-size:12.5px;color:var(--muted)", text: "📦 " + goneText(b.gone) });
    if (k === "location" && isWish(b)) return el("td", { style: "padding:0 8px;font-size:12.5px;color:var(--muted)", text: "⭐ Wunschliste" });
    if (k === "location") { const loc = locationOf(b.id); return el("td", { style: "padding:0 8px;font-size:12.5px;color:var(--muted)" }, loc ? el("a", { href: "#wand", onclick: () => { S.highlight = b.id; S.wallId = loc.w.id; }, text: locationShort(loc) }) : el("a", { href: "#wand", onclick: () => { S.pick = b.id; }, text: "einräumen…" })); }
    if (k === "addedAt") return el("td", { style: "color:var(--muted);white-space:nowrap;padding:0 8px", text: b.addedAt ? new Date(b.addedAt).toLocaleDateString("de-DE") : "" });
    if (k === "missing") return el("td", { style: "padding:0 6px" }, miss.length ? miss.map(m => el("span", { class: "mtag", text: m })) : el("span", { class: "oktag", text: "✓ vollständig" }));
    if (k === "act") return el("td", { style: "white-space:nowrap" },
      miss.length ? el("button", { class: "btn sm ghost", title: "Fehlende Daten online suchen", onclick: e => fillMissing(b.id, e.currentTarget) }, "🔎") : null,
      el("button", { class: "btn sm ghost", title: "Ansehen", onclick: () => openDetail(b.id) }, "Öffnen"),
      el("button", { class: "btn sm ghost", title: "Alle Angaben bearbeiten", onclick: () => openDetail(b.id, true) }, "✏️"),
      el("button", { class: "btn sm ghost danger", title: "Löschen", onclick: async () => { if (await confirmBox(`„${b.title || "Dieses Buch"}“ wirklich löschen?`)) { await removeBook(b.id); toast("Gelöscht."); } } }, "🗑"));
    const req = FIELDS.find(f => f.k === k)?.req;
    return el("td", { class: req && !String(b[k] ?? "").trim() ? "miss" : null }, cellInput(b, k));
  };
  const cls = [isGone(b) ? "gonerow" : isWish(b) ? "wishrow" : "", S.tSel.has(b.id) ? "selrow" : ""].filter(Boolean).join(" ");
  return el("tr", { class: cls || null, "data-id": b.id }, ...cols.map(col => { const td = cell(col); td.setAttribute("data-k", col.k); return td; }));
}
const T_PAGE = 150;
S.tLimit = T_PAGE;
let tMoreObs = null;
function moreRow() {
  const rest = S.tList.length - S.tLimit;
  const tr = el("tr", { class: "tmore" }, el("td", { colspan: S.tCols.length },
    el("span", { text: `Noch ${rest} ${rest === 1 ? "Buch" : "Bücher"} …` }),
    el("button", { class: "btn sm", onclick: () => showMoreRows(Infinity) }, "Alle anzeigen")));
  // automatisch nachladen, sobald die Zeile in die Nähe des sichtbaren Bereichs kommt
  if ("IntersectionObserver" in window) {
    if (tMoreObs) tMoreObs.disconnect();
    tMoreObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) showMoreRows(T_PAGE); }, { root: $(".tablewrap"), rootMargin: "400px" });
    requestAnimationFrame(() => { if (tr.isConnected) tMoreObs.observe(tr); });
  }
  return tr;
}
function showMoreRows(n) {
  const body = $("#tbl").tBodies[0]; if (!body || !S.tList) return;
  const old = body.querySelector("tr.tmore"); if (old) old.remove();
  if (tMoreObs) tMoreObs.disconnect();
  const from = S.tLimit; S.tLimit = Math.min(S.tList.length, from + n);
  body.append(...S.tList.slice(from, S.tLimit).map(b => tableRow(b, S.tCols)));
  if (S.tList.length > S.tLimit) body.append(moreRow());
}
function clearAllTableFilters() { S.colF = {}; S.tq = ""; $("#tq").value = ""; S.tTag = ""; S.tFilter = "all"; saveTableView(); renderTable(); }
function renderTableRows() {
  const tbl = $("#tbl");
  const list = tableList();
  const anyFilter = anyTableFilter();
  const cols = visCols();
  // Große Listen in Stücken zeichnen: erst T_PAGE Zeilen, beim Scrollen mehr. Neu anfangen nur, wenn sich Filter/Sortierung ändern –
  // nicht beim Bearbeiten einer Zelle (sonst springt die Liste).
  const sig = canon({ colF: S.colF, sorts: S.tSorts, tFilter: S.tFilter, tTag: S.tTag, tq: S.tq });
  if (sig !== S.tSig) { const first = S.tSig == null; S.tSig = sig; S.tLimit = T_PAGE; S.tSel.clear(); S.tSelLast = null; const w = $(".tablewrap"); if (w && !first) w.scrollTop = 0; } // neue Auswahl: oben beginnen, Häkchen weg
  S.tList = list; S.tCols = cols;
  if (S.tSel.size) { const ids = new Set(list.map(b => b.id)); for (const id of [...S.tSel]) if (!ids.has(id)) S.tSel.delete(id); } // gelöschte/ausgeblendete nicht mehr ausgewählt
  const body = el("tbody", {}, ...list.slice(0, S.tLimit).map(b => tableRow(b, cols)));
  if (list.length > S.tLimit) body.append(moreRow());
  if (!list.length) body.append(el("tr", {}, el("td", { colspan: cols.length, style: "padding:30px;text-align:center;color:var(--muted);white-space:normal" },
    !S.loaded ? "Lade …" : !S.books.length ? "Noch keine Bücher erfasst." : "Keine Treffer.",
    S.loaded && S.books.length && anyFilter ? el("button", { class: "btn sm", style: "margin-left:10px", onclick: clearAllTableFilters }, "Alle Filter aufheben") : null)));
  const old = tbl.tBodies[0]; if (old) old.replaceWith(body); else tbl.append(body);
  updSel(); // Häkchen-Zustand im Kopf + Leiste über der Tabelle
}
function renderTableBar(list, anyFilter) {
  const host = $("#tbar"); if (!host) return;
  const act = activeColFilters();
  const chip = (text, onX, bad) => el("span", { class: "fchip" + (bad ? " bad" : ""), title: bad ? "Dieser Filter ist ungültig und wird ignoriert" : null }, text, el("button", { title: "Filter entfernen", onclick: () => { onX(); saveTableView(); renderTable(); } }, "×"));
  const sortChip = (s, i) => el("span", { class: "schip" },
    el("button", { class: "sdir", title: "Richtung umkehren", onclick: () => { s.dir *= -1; saveTableView(); renderTable(); } }, (i ? "dann " : "") + colLabel(s.key) + (s.dir > 0 ? " ▲" : " ▼")),
    S.tSorts.length > 1 ? el("button", { class: "sx", title: "Sortierstufe entfernen", onclick: () => { S.tSorts.splice(i, 1); saveTableView(); renderTable(); } }, "×") : null);
  const addSel = el("select", { class: "field sadd", title: "Weitere Sortierstufe hinzufügen" }, el("option", { value: "" }, "＋ dann nach …"),
    ...COLS.filter(c => !c.nos && !S.tSorts.some(s => s.key === c.k)).map(c => el("option", { value: c.k }, colLabel(c.k))));
  addSel.addEventListener("change", () => { if (addSel.value) { S.tSorts.push({ key: addSel.value, dir: 1 }); saveTableView(); renderTable(); } });
  const nSel = S.tSel.size;
  fillNode(host,
    nSel ? el("div", { class: "tbrow selbar", role: "region", "aria-label": "Auswahl" },
      el("b", { text: `${nSel} ausgewählt` }),
      el("button", { class: "btn sm danger", onclick: deleteSelected }, nSel === 1 ? "🗑 Löschen" : `🗑 ${nSel} Bücher löschen`),
      nSel < list.length ? el("button", { class: "btn sm ghost", onclick: () => selectAllShown(true) }, `Alle ${list.length} auswählen`) : null,
      el("button", { class: "btn sm ghost", onclick: () => selectAllShown(false) }, "Auswahl aufheben")) : null,
    el("div", { class: "tbrow" },
      el("span", { class: "tcount" }, el("b", { text: list.length }), ` von ${S.books.length}`),
      el("span", { class: "tlbl", text: "Sortiert:" }), ...S.tSorts.map(sortChip), addSel,
      el("span", { style: "flex:1" }),
      viewsMenu(), columnsMenu(),
      el("button", { class: "btn sm" + (S.showColF ? " on" : ""), title: "Filterzeile unter den Spaltenüberschriften", onclick: () => { S.showColF = !S.showColF; saveTableView(); renderTable(); } }, S.showColF ? "Spaltenfilter ausblenden" : "⛃ Spaltenfilter"),
      anyFilter && list.length ? el("button", { class: "btn sm", onclick: () => exportCsv(list) }, `⬇ CSV (${list.length} gefiltert)`) : null),
    anyFilter ? el("div", { class: "tbrow" },
      el("span", { class: "tlbl", text: "Filter:" }),
      ...act.map(([k, q]) => chip(`${colLabel(k)}: ${fDesc(k, q)}`, () => { delete S.colF[k]; }, !colPredicate(k, q))),
      S.tq ? chip(`Suche: „${S.tq}“`, () => { S.tq = ""; $("#tq").value = ""; }) : null,
      S.tTag ? chip("# " + S.tTag, () => { S.tTag = ""; }) : null,
      S.tFilter !== "all" ? chip(T_FILTER_NAMES[S.tFilter] || S.tFilter, () => { S.tFilter = "all"; }) : null,
      el("button", { class: "btn sm ghost", onclick: clearAllTableFilters }, "Alle aufheben")) : null,
    S.showColF ? el("details", { class: "saved fhelp", open: S.fhelpOpen || null, ontoggle: e => { S.fhelpOpen = e.currentTarget.open; } }, el("summary", { text: "ℹ So funktionieren die Spaltenfilter" }),
      "Text = enthält · ", el("code", { text: "!wort" }), " enthält nicht · ", el("code", { text: "a | b" }), " oder · ", el("code", { text: "=wort" }), " genau · ", el("code", { text: "leer" }), " / ", el("code", { text: "!leer" }),
      " · Zahlen: ", el("code", { text: ">1990" }), " ", el("code", { text: "<=20" }), " ", el("code", { text: "1980-1990" }),
      " · Datum: ", el("code", { text: "2025" }), " ", el("code", { text: ">03.2025" }), " ", el("code", { text: "2023..2025" }),
      " · Umschalt+Klick auf eine Überschrift = weitere Sortierstufe") : null);
}
function popMenu(stateKey, label, ...body) {
  return el("details", { class: "tpop", open: S[stateKey] || null, ontoggle: e => { S[stateKey] = e.currentTarget.open; } },
    el("summary", { class: "btn sm" + (S[stateKey] ? " on" : "") }, label),
    el("div", { class: "tpanel" }, ...body));
}
function columnsMenu() {
  const n = S.tHidden.length;
  return popMenu("colPickOpen", "▦ Spalten" + (n ? ` (${n} aus)` : ""),
    el("div", { class: "tphead", text: "Angezeigte Spalten" }),
    el("div", { class: "tpcols" }, ...COLS.filter(c => !c.fixed).map(c => {
      const cb = el("input", { type: "checkbox", checked: !S.tHidden.includes(c.k) || null, disabled: c.k === "title" || null, "aria-label": "Spalte " + colLabel(c.k) });
      cb.addEventListener("change", () => setColHidden(c.k, !cb.checked));
      return el("label", { class: "tpick" + (c.k === "title" ? " fixed" : "") }, cb, colLabel(c.k));
    })),
    el("div", { class: "tpbtns" },
      n ? el("button", { class: "btn sm", onclick: () => { S.tHidden = []; saveTableView(); renderTable(); } }, "Alle zeigen") : null,
      Object.keys(S.tW).length ? el("button", { class: "btn sm", title: "Alle Spalten wieder in Standardbreite", onclick: () => { S.tW = {}; saveTableView(); renderTable(); } }, "Breiten zurücksetzen") : null),
    el("div", { class: "saved", text: "Breite ändern: in der Überschrift den rechten Rand der Spalte ziehen. Doppelklick dort = Standardbreite." }));
}
function viewsMenu() {
  const cur = currentView(), changed = cur && viewChanged(cur);
  const name = el("input", { class: "field", type: "text", value: cur ? cur.name : "", placeholder: "Name, z. B. „Ungelesene Krimis“", "aria-label": "Name der Ansicht", maxlength: 60 });
  return popMenu("viewsOpen", "⭐ " + (cur ? cur.name + (changed ? " (geändert)" : "") : "Ansichten"),
    el("div", { class: "tphead", text: "Gespeicherte Ansichten" }),
    S.tViews.length
      ? el("div", { class: "tviews" }, ...S.tViews.map(v => el("div", { class: "tvrow" + (cur === v ? " on" : "") },
          el("button", { class: "tvname", title: "Diese Ansicht anwenden", onclick: () => applyView(v) }, v.name),
          el("button", { class: "sx", title: "Ansicht löschen", "aria-label": `Ansicht ${v.name} löschen`, onclick: () => deleteView(v) }, "×"))))
      : el("div", { class: "saved", text: "Noch keine. Stelle Filter, Sortierung und Spalten ein und speichere sie hier unter einem Namen." }),
    el("form", { class: "tvsave", onsubmit: e => { e.preventDefault(); saveViewAs(name.value); } },
      name, el("button", { class: "btn sm", type: "submit", title: "Unter vorhandenem Namen: Ansicht aktualisieren" }, "Speichern")),
    el("div", { class: "saved", text: "Gespeichert werden Filter, Suche, Sortierung, ausgeblendete Spalten und Spaltenbreiten – nur auf diesem Gerät." }),
    el("div", { class: "tpbtns" }, el("button", { class: "btn sm ghost", onclick: resetTableView }, "↺ Grundeinstellung")));
}
// Menüs schließen, wenn daneben geklickt wird
document.addEventListener("click", e => {
  if (!e.target.isConnected) return; // Knopf im Menü hat die Leiste gerade neu aufgebaut
  for (const d of document.querySelectorAll("details.tpop[open]")) if (!d.contains(e.target)) d.open = false;
});
$("#tbl").addEventListener("focusout", () => setTimeout(() => { if (S.tableDirty && !$("#tbl").contains(document.activeElement)) { S.tableDirty = false; renderTable(); } }, 50));
$("#tq").addEventListener("input", e => { S.tq = e.target.value; renderTable(); });

/* ================= Export / Import / Abgleich ================= */
function saveFile(name, blob) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
async function buildBackup(opt = { images: true, files: true }) {
  const books = [];
  for (const b of S.books) {
    const { coverBlob, ...rest } = b; if (coverBlob) rest.coverData = await blobToDataURL(coverBlob);
    if ((b.images || []).length || (b.files || []).length) Object.assign(rest, await attachmentsToBackup(b, opt));
    if (rest.spine?.imageBlob) { const { imageBlob, ...sp } = rest.spine; sp.imageData = await blobToDataURL(imageBlob); rest.spine = sp; }
    books.push(rest);
  }
  // Fach-Fotos: offene mit Bild, erledigte/gelöschte nur als Angaben (damit das andere Gerät sie als erledigt sieht)
  const photos = [];
  for (const p of S.photos || []) { const { blob, ...rest } = p; if (blob && !p.doneAt && !p.deletedAt && opt.photos !== false) rest.imageData = await blobToDataURL(blob); photos.push(rest); }
  const out = { app: "buecherregal", version: 2, exportedAt: new Date().toISOString(), books, deleted: S.deleted, shelves: S.shelves };
  if (photos.length) out.photos = photos;
  return out;
}
async function exportFlow() {
  const stats = await attachmentStats();
  let opt = { images: true, files: true };
  if (stats.ni || stats.nf) { opt = await exportOptionsDialog(stats); if (!opt) return; }
  toast("Sicherung wird erstellt …", 1500);
  const data = await buildBackup(opt);
  const name = `buecherregal-${today()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  await DB.setMeta("lastBackup", new Date().toISOString());
  if (isMobile() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Bücherregal-Sicherung" }); toast("Sicherung geteilt."); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  saveFile(name, blob); toast(`Gespeichert als ${name}`);
  $("#banner").replaceChildren();
}
async function importFlow() {
  const f = await pickFile("#fileImport"); if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { toast("Die Datei ist keine gültige Sicherung."); return; }
  if (data?.app !== "buecherregal" || !Array.isArray(data.books)) { toast("Die Datei ist keine Bücherregal-Sicherung."); return; }
  toast(await importData(data), 5000);
}
async function importData(data) {
  // Sicherungen aller bisherigen Versionen (1 und 2) werden gelesen; unbekannte Felder bleiben einfach erhalten.
  let added = 0, updated = 0, removed = 0, skipped = 0;
  const del = { ...S.deleted, ...(data.deleted || {}) };
  for (const [id, when] of Object.entries(data.deleted || {})) {
    const local = S.books.find(b => b.id === id);
    if (local && (local.updatedAt || "") <= when) { await DB.del(id); S.books = S.books.filter(b => b.id !== id); removed++; }
  }
  for (const inc of data.books) {
    if (!inc.id) continue;
    if (del[inc.id] && del[inc.id] >= (inc.updatedAt || "")) { skipped++; continue; }
    const local = S.books.find(b => b.id === inc.id);
    if (local && (local.updatedAt || "") >= (inc.updatedAt || "")) { skipped++; continue; }
    const { coverData, ...rest } = inc;
    const b = { ...rest };
    if (coverData) { try { b.coverBlob = await dataURLToBlob(coverData); } catch {} }
    if (b.spine?.imageData) { const { imageData, ...sp } = b.spine; try { sp.imageBlob = await dataURLToBlob(imageData); } catch {} b.spine = sp; }
    if (inc.images || inc.files || local?.images || local?.files) Object.assign(b, await attachmentsFromBackup(inc, local));
    await DB.put(b);
    if (local) { S.books[S.books.indexOf(local)] = b; updated++; } else { S.books.push(b); added++; }
    if (S.urls.has(b.id)) { URL.revokeObjectURL(S.urls.get(b.id)); S.urls.delete(b.id); }
  }
  S.deleted = del; await DB.setMeta("deleted", del);
  let photoNote = 0;
  for (const inc of Array.isArray(data.photos) ? data.photos : []) {
    if (!inc?.id) continue;
    const local = S.photos.find(p => p.id === inc.id);
    if (local && (local.updatedAt || "") >= (inc.updatedAt || "")) continue;
    const { imageData, ...p } = inc;
    if (!p.deletedAt) { if (imageData) { try { p.blob = await dataURLToBlob(imageData); } catch {} } if (!p.blob && local?.blob) p.blob = local.blob; }
    await storePhotoLocal(p); photoNote++;
  }
  let wallNote = "";
  if (data.shelves?.walls && (data.shelves.updatedAt || "") > (S.shelves.updatedAt || "")) { S.shelves = data.shelves; await DB.setMeta("shelves", S.shelves); wallNote = " Regal-Aufstellung übernommen."; }
  renderAll();
  dataChanged();
  return `Abgleich fertig: ${added} neu, ${updated} aktualisiert, ${removed} gelöscht, ${skipped} unverändert.${wallNote}${photoNote ? " " + photoNote + " Fach-Foto(s) übernommen." : ""}`;
}
function exportCsv(only) {
  const books = Array.isArray(only) ? only : S.books;
  const keys = ["title", "author", "year", "isbn", "publisher", "pages", "genre", "language", "series", "seriesNo", "price", "value", "tags", "wish", "status", "rating", "favorite", "location", "reads", "gone", "signed", "signedBy", "dedication", "images", "files", "addedAt", "summary", "notes"];
  const head = ["Titel", "Autor", "Jahr", "ISBN", "Verlag", "Seiten", "Genre", "Sprache", "Reihe", "Band-Nr.", "Preis (€)", "Heutiger Wert (€)", "Schlagworte", "Wunschliste", "Status", "Bewertung", "Lieblingsbuch", "Standort", "Gelesen (Zeiträume)", "Hatte ich mal", "Signiert", "Signiert von / Anlass", "Widmung", "Weitere Bilder", "Dateien", "Hinzugefügt", "Zusammenfassung", "Notizen"];
  const q = v => { v = String(v ?? ""); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [head.join(";"), ...books.map(b => keys.map(k => q(k === "status" ? STATUS[b.status || "unread"] : k === "isbn" && b.isbn ? `="${b.isbn}"` : k === "addedAt" && b.addedAt ? b.addedAt.slice(0, 10) : k === "favorite" ? (b.favorite ? "ja" : "") : k === "location" ? (locationOf(b.id) ? locationText(locationOf(b.id)) : "") : k === "reads" ? readsOf(b).map(r => readText(r) + (r.note ? " (" + r.note + ")" : "")).join("; ") : k === "gone" ? (b.gone ? goneText(b.gone) + (b.gone.note ? " – " + b.gone.note : "") : "") : k === "signed" ? (b.signed ? "ja" : "") : k === "images" ? ((b.images || []).length || "") : k === "files" ? (b.files || []).map(f => f.name).join("; ") : k === "tags" ? (b.tags || []).join(", ") : k === "wish" ? (b.wish ? "ja" : "") : b[k])).join(";"))];
  saveFile(`buecherregal-${today()}${Array.isArray(only) ? "-auswahl" : ""}.csv`, new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
}
async function remindBackup() {
  if (!S.books.length) return;
  if (typeof autoBackupActive === "function" && await autoBackupActive()) return;
  const last = await DB.getMeta("lastBackup").catch(() => null);
  const days = last ? (Date.now() - new Date(last)) / 864e5 : 999;
  if (days > 14) setBanner(`Deine Bücher liegen nur in diesem Browser. ${last ? "Letzte Sicherung vor " + Math.floor(days) + " Tagen." : "Noch keine Sicherung."} `, el("button", { class: "btn sm", style: "margin-left:8px", onclick: exportFlow }, "Jetzt sichern"));
}

function aboutBox() {
  const sh = sheet("Über diese App");
  sh.body.append(
    el("p", { text: "Mein Bücherregal speichert alle Daten in diesem Browser auf diesem Gerät – es gibt kein Konto. Wer möchte, kann zusätzlich einen eigenen Server (z. B. auf dem PC) für den automatischen Abgleich eintragen." }),
    el("p", { text: "Buchdaten kommen von der Deutschen Nationalbibliothek (sehr vollständig für deutschsprachige und aktuelle Ausgaben), Google Books und Open Library." }),
    el("p", { text: "Handy und PC abgleichen: „Mehr“ → „Sicherung exportieren“ (auf dem Handy z. B. per Mail, Messenger oder Cloud an dich selbst schicken), dann am anderen Gerät „Sicherung importieren“. Bücher werden zusammengeführt, die neuere Änderung gewinnt." }),
    el("p", { text: "Wichtig: Wenn du die Browserdaten löschst, ist auch das Regal weg. Exportiere deshalb ab und zu eine Sicherung." }),
    el("p", { class: "saved", text: `${S.books.length} Bücher gespeichert.` }),
    autoBackupBox(),
    syncBox(),
    googleKeyBox(),
    gcsKeyBox(),
    aiKeyBox());
}
function googleKeyBox() {
  let cur = ""; try { cur = localStorage.getItem("gbooksKey") || ""; } catch {}
  const inp = el("input", { class: "field", placeholder: "AIza…", value: cur, autocomplete: "off" });
  const save = () => { try { const v = inp.value.trim(); if (v) localStorage.setItem("gbooksKey", v); else localStorage.removeItem("gbooksKey"); toast(v ? "Schlüssel gespeichert." : "Schlüssel entfernt."); } catch { toast("Konnte nicht gespeichert werden."); } };
  return el("div", { class: "sec" }, el("h3", { text: "Google Books (optional)" }),
    el("p", { class: "saved", text: "Ohne Schlüssel teilt sich die App ein kleines Abfrage-Kontingent mit allen anderen – Google antwortet dann oft gar nicht. Ein eigener, kostenloser Schlüssel behebt das. Er bleibt nur in diesem Browser." }),
    el("div", { class: "manual", style: "margin-top:6px" }, inp, el("button", { class: "btn", onclick: save }, "Speichern")),
    el("p", { class: "saved", style: "margin-top:6px" }, "So bekommst du einen: ", el("a", { href: "https://console.cloud.google.com/apis/library/books.googleapis.com", target: "_blank", rel: "noopener" }, "Google Cloud Console ↗"), " → Projekt anlegen → „Books API“ aktivieren → Anmeldedaten → API-Schlüssel erstellen."));
}

/* ================= Start ================= */
/* ---------- Neue App-Version ---------- */
// Der Service Worker übernimmt eine neue Version sofort (skipWaiting/claim). Die offene Seite läuft aber noch mit dem alten Code –
// deshalb ein Hinweis zum Neuladen statt automatischem Neuladen (könnte eine offene Eingabe verwerfen).
function showUpdateBar() {
  if ($(".updbar")) return;
  document.body.append(el("div", { class: "updbar", role: "status" },
    el("span", { text: "Neue Version der App ist da." }),
    el("button", { class: "btn sm primary", onclick: () => location.reload() }, "Jetzt aktualisieren"),
    el("button", { class: "x", title: "Später", "aria-label": "Hinweis schließen", onclick: e => e.currentTarget.parentElement.remove() }, "✕")));
}
function watchForUpdates(sw = navigator.serviceWorker) {
  let hadController = !!sw.controller; // beim allerersten Installieren gibt es nichts zu aktualisieren
  sw.addEventListener("controllerchange", () => { if (hadController) showUpdateBar(); hadController = true; });
  // installierte Apps bleiben lange offen: beim Zurückkehren nach Updates sehen
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sw.getRegistration().then(r => r && r.update()).catch(() => {}); });
}
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  watchForUpdates();
}
renderAll();
loadAll().then(offerReviewDraft);
