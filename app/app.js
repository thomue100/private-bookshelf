/* Mein Bücherregal – eigenständige Web-App, Daten bleiben im Browser (IndexedDB). */
"use strict";

/* ================= Grundlagen ================= */
const S = {
  books: [], deleted: {}, loaded: false,
  filter: "all", sort: "added-desc", q: "",
  tFilter: "all", tq: "", tSort: { key: "addedAt", dir: -1 },
  urls: new Map(), // id -> objectURL des Covers
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
function toast(msg, ms = 2800) { document.querySelectorAll(".toast").forEach(x => x.remove()); const t = el("div", { class: "toast", text: msg }); document.body.append(t); setTimeout(() => t.remove(), ms); return t; }
function setBanner(t, btn) { $("#banner").replaceChildren(el("div", { class: "banner" }, t, btn || null)); }

/* ================= Speicher (IndexedDB) ================= */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("buecherregal", 2);
    r.onupgradeneeded = () => { // Version 1 → 2: zusätzlicher Speicher für Bilder & Dateien; vorhandene Daten bleiben unverändert
      const d = r.result;
      if (!d.objectStoreNames.contains("books")) d.createObjectStore("books", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs", { keyPath: "id" }).createIndex("bookId", "bookId");
    };
    r.onsuccess = () => res(r.result);
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
  };
})();

async function loadAll() {
  try {
    S.books = await DB.all();
    S.deleted = (await DB.getMeta("deleted")) || {};
    S.shelves = (await DB.getMeta("shelves")) || { walls: [], updatedAt: "" };
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
  if (b.favorite) c.append(el("span", { class: "favbadge", title: "Lieblingsbuch", text: "♥" }));
  if (badge && b.status && b.status !== "unread") c.append(el("span", { class: "badge", style: `background:${STATUS_COLOR[b.status]}`, text: b.status === "read" ? "✓ Gelesen" : "Liest du" }));
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
/* Lädt ein Bild nur zur Anzeige (ohne CORS) und prüft, ob es wirklich ein brauchbares Bild ist. */
function imgOk(url, ms = 8000) {
  return new Promise(res => {
    if (!url) return res(false);
    const i = new Image(); const t = setTimeout(() => { i.src = ""; res(false); }, ms);
    i.onload = () => { clearTimeout(t); res(i.naturalWidth >= 60 && i.naturalHeight >= 60); };
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
async function getJSON(url, ms = 9000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
function stripHtml(s) { const d = document.createElement("div"); d.innerHTML = s || ""; return (d.textContent || "").trim(); }
const LANG = { de: "Deutsch", en: "Englisch", fr: "Französisch", es: "Spanisch", it: "Italienisch", nl: "Niederländisch", ger: "Deutsch", eng: "Englisch", fre: "Französisch", spa: "Spanisch", ita: "Italienisch" };
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
function fromDNB(r) {
  const names = [];
  for (const tag of ["100", "700"]) for (const d of dnbFields(r, tag)) {
    const role = [...d.getElementsByTagNameNS(MARC, "subfield")].filter(x => x.getAttribute("code") === "4").map(x => x.textContent);
    if (tag === "700" && !role.includes("aut")) continue;
    if (role.length && !role.includes("aut")) continue;
    const n = flipName(dnbSub(d, "a"));
    if (n.length > 3 && !/^(the|der|die|das|a|an)$/i.test(n)) names.push(n);
  }
  let author = [...new Set(names)].join(", ");
  if (!author) {
    let c = dnbFirst(r, "245", "c");
    c = c.split(/\s;\s|\b(Aus d(em|\.)|Übers|übers|Deutsch von|Mit Ill)/)[0];
    author = trimPunct(c.replace(/\[|\]|\(|\)|\bu\.\s?a\.|\bvon\b|\.\.\./g, " ").replace(/\s+/g, " "));
  }
  const title = [trimPunct(dnbFirst(r, "245", "a")), trimPunct(dnbFirst(r, "245", "b"))].filter(Boolean).join(" – ");
  const pubF = dnbFields(r, "264")[0] || dnbFields(r, "260")[0];
  const publisher = pubF ? trimPunct(dnbSub(pubF, "b")) : "";
  const year = pubF ? ((dnbSub(pubF, "c").match(/\d{4}/) || [""])[0]) : "";
  const ext = dnbFirst(r, "300", "a");
  const pages = (ext.match(/(\d+)\s*(Seiten|S\.)/) || [, ""])[1];
  const isbn = dnbFields(r, "020").map(d => toIsbn13(dnbSub(d, "a"))).find(Boolean) || "";
  const lang = dnbFirst(r, "041", "a");
  const ebook = /Online-Ressource|E-Book|eBook/i.test(ext + " " + publisher);
  const edition = trimPunct(dnbFirst(r, "250", "a"));
  const serF = dnbFields(r, "490")[0];
  const series = serF ? trimPunct(dnbSub(serF, "a")) : "", seriesNo = serF ? trimPunct(dnbSub(serF, "v")) : "";
  const part = trimPunct(dnbFirst(r, "245", "n")); // Bandzählung eines mehrbändigen Werks, z. B. „8“
  return { title, author, year, publisher, pages, genre: "", language: LANG[lang] || "", summary: "", isbn, coverUrl: "", src: "Deutsche Nationalbibliothek", ebook, edition, series, seriesNo, part };
}
async function dnbQuery(cql, max = 15) {
  const url = `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml&maximumRecords=${max}&query=${encodeURIComponent(cql)}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status);
    const x = new DOMParser().parseFromString(await r.text(), "application/xml");
    return [...x.getElementsByTagNameNS(MARC, "record")].map(fromDNB).filter(b => b.title);
  } finally { clearTimeout(t); }
}
const olCovers = isbn => { const i10 = isbn10of(isbn); return [`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, i10 ? `https://covers.openlibrary.org/b/isbn/${i10}-L.jpg?default=false` : null].filter(Boolean); };

async function lookupIsbn(isbn) {
  const [g, ol, dnb] = await Promise.allSettled([
    getJSON(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${gKey()}`),
    getJSON(`https://openlibrary.org/search.json?q=isbn:${isbn}&limit=1&fields=key,title,subtitle,author_name,first_publish_year,publisher,number_of_pages_median,subject,language,isbn,cover_i`),
    dnbQuery(`num=${isbn}`, 3),
  ]);
  let rec = {};
  if (g.status === "fulfilled" && g.value.items?.length) rec = fromGoogle(g.value.items[0]);
  if (dnb.status === "fulfilled" && dnb.value.length) {
    const d = dnb.value.find(x => x.isbn === isbn) || dnb.value[0];
    // Für Verlag/Jahr/Seiten ist die DNB verlässlicher (genau diese Ausgabe)
    rec = rec.title ? merge({ ...rec, publisher: d.publisher || rec.publisher, year: d.year || rec.year, pages: d.pages || rec.pages }, d) : d;
  }
  if (ol.status === "fulfilled" && ol.value.docs?.length) {
    const o = fromOLSearch(ol.value.docs[0]); o.isbn = isbn;
    rec = merge(rec, o);
    if (!rec.summary) rec.summary = await olDescription(o.olKey);
  }
  if (!rec.title && g.status === "rejected" && ol.status === "rejected" && dnb.status === "rejected") throw new Error("offline");
  rec.isbn = isbn;
  rec.src = [g.status === "fulfilled" && g.value.items?.length ? "Google Books" : null, dnb.status === "fulfilled" && dnb.value.length ? "Deutsche Nationalbibliothek" : null, ol.status === "fulfilled" && ol.value.docs?.length ? "Open Library" : null].filter(Boolean).join(", ");
  rec.altCovers = [rec.coverUrl, ...olCovers(isbn)].filter((v, i, a) => v && a.indexOf(v) === i);
  rec.coverUrl = rec.altCovers[0];
  return rec.title ? rec : null;
}
async function searchBooks(q) {
  const words = q.replace(/["“”„]/g, " ").replace(/\s+/g, " ").trim();
  const [g, ol, dnb] = await Promise.allSettled([
    getJSON(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(words)}&maxResults=10&printType=books${gKey()}`),
    getJSON(`https://openlibrary.org/search.json?q=${encodeURIComponent(words)}&limit=6&fields=key,title,subtitle,author_name,first_publish_year,publisher,number_of_pages_median,subject,language,isbn,cover_i`),
    dnbQuery(`woe all "${words}"`, 20),
  ]);
  if (g.status === "rejected" && ol.status === "rejected" && dnb.status === "rejected") throw new Error("offline");
  // DNB zuerst (gedruckte Ausgaben, neueste oben), dann Google Books, dann Open Library
  // DNB: deutschsprachig vor Übersetzungen, gedruckt vor E-Book, dann neueste zuerst
  const de = b => (b.language === "Deutsch" ? 0 : 1);
  const d = dnb.status === "fulfilled" ? dnb.value.slice().sort((a, b) => (de(a) - de(b)) || (a.ebook - b.ebook) || (+b.year || 0) - (+a.year || 0)) : [];
  const out = [...d];
  if (g.status === "fulfilled") for (const it of g.value.items || []) out.push(fromGoogle(it));
  if (ol.status === "fulfilled") for (const x of ol.value.docs || []) out.push(fromOLSearch(x));
  const seen = new Map();
  for (const r of out) {
    const key = r.isbn || (r.title + "|" + r.author + "|" + r.year).toLowerCase();
    if (seen.has(key)) seen.set(key, merge(seen.get(key), r)); else seen.set(key, r);
  }
  return [...seen.values()].filter(r => r.title).slice(0, 20).map(r => {
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
async function decodeFromImage(img) {
  if ("BarcodeDetector" in window) {
    try { const det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] }); for (const r of await det.detect(img)) { const i = toIsbn13(r.rawValue); if (i) return i; } } catch {}
  }
  const Z = window.ZXing; if (!Z) return null;
  const reader = new Z.MultiFormatReader(); reader.setHints(zxingReader());
  for (const size of [1400, 900, 2200]) for (const rot of [0, 90]) {
    let c = toCanvas(img, size);
    if (rot) { const r = document.createElement("canvas"); r.width = c.height; r.height = c.width; const x = r.getContext("2d"); x.translate(r.width / 2, r.height / 2); x.rotate(Math.PI / 2); x.drawImage(c, -c.width / 2, -c.height / 2); c = r; }
    try { const res = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(c)))); const i = toIsbn13(res.getText()); if (i) return i; } catch {}
  }
  return null;
}
/* Live-Scanner mit der Kamera. Liefert ISBN oder null (abgebrochen). */
function liveScan() {
  return new Promise(async resolve => {
    if (!navigator.mediaDevices?.getUserMedia) { toast("Live-Kamera ist hier nicht verfügbar – nimm ein Foto."); return resolve(undefined); }
    const video = el("video", { playsinline: true, muted: true, autoplay: true }); video.muted = true;
    const info = el("p", { text: "Halte den Barcode auf der Rückseite in den Rahmen." });
    let stream, stopped = false, timer, zx;
    const finish = v => {
      if (stopped) return; stopped = true; clearInterval(timer);
      try { zx && zx.reset(); } catch {}
      stream && stream.getTracks().forEach(t => t.stop());
      ov.remove(); resolve(v);
    };
    const ov = el("div", { class: "scan" }, video, el("div", { class: "frame" }),
      el("div", { class: "bottom" }, info,
        el("div", { style: "display:flex;gap:8px" },
          el("button", { class: "btn", onclick: () => finish(null) }, "Abbrechen"),
          el("button", { class: "btn", onclick: () => finish("photo") }, "Lieber ein Foto"))));
    document.body.append(ov);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      ov.remove(); toast(e.name === "NotAllowedError" ? "Kamera-Zugriff wurde nicht erlaubt." : "Kamera nicht verfügbar – nimm ein Foto."); return resolve(undefined);
    }
    if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream; await video.play().catch(() => {});
    const hit = isbn => { if (navigator.vibrate) navigator.vibrate(80); finish(isbn); };
    let det = null;
    if ("BarcodeDetector" in window) { try { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes("ean_13")) det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] }); } catch {} }
    if (det) {
      timer = setInterval(async () => {
        if (stopped || video.readyState < 2) return;
        try { for (const r of await det.detect(video)) { const i = toIsbn13(r.rawValue); if (i) return hit(i); else info.textContent = "Das ist kein ISBN-Barcode (" + r.rawValue + ")."; } } catch {}
      }, 180);
    } else if (window.ZXing) {
      const Z = window.ZXing; const reader = new Z.MultiFormatReader(); reader.setHints(zxingReader());
      const c = document.createElement("canvas"); const ctx = c.getContext("2d", { willReadFrequently: true });
      timer = setInterval(() => {
        if (stopped || video.readyState < 2) return;
        // mittleren Streifen auswerten (schneller, wie der Rahmen)
        const w = video.videoWidth, h = video.videoHeight, sh = Math.round(h * .45);
        c.width = Math.min(1280, w); c.height = Math.round(sh * c.width / w);
        ctx.drawImage(video, 0, Math.round((h - sh) / 2), w, sh, 0, 0, c.width, c.height);
        try { const res = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(c)))); const i = toIsbn13(res.getText()); if (i) hit(i); } catch {}
      }, 250);
    } else { info.textContent = "Barcode-Erkennung lädt nicht – bitte Foto verwenden."; }
  });
}

/* ================= Texterkennung (OCR) fürs Cover ================= */
let ocrWorker = null;
async function ocrCover(file, onProgress) {
  if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
  if (!ocrWorker) ocrWorker = await Tesseract.createWorker(["deu", "eng"], 1, { logger: m => { if (m.status === "recognizing text") onProgress?.(Math.round(m.progress * 100)); } });
  const img = await loadImage(file);
  const c = toCanvas(img, 1600);
  const { data } = await ocrWorker.recognize(c);
  // große Schrift (Titel/Autor) zuerst: nach Zeilenhöhe sortieren
  const lines = (data.lines || []).map(l => ({ t: l.text.replace(/[^\p{L}\p{N}\s'’.\-&:]/gu, " ").replace(/\s+/g, " ").trim(), h: l.bbox.y1 - l.bbox.y0, conf: l.confidence }))
    .filter(l => l.t.length >= 2 && /\p{L}{2,}/u.test(l.t) && l.conf > 45);
  lines.sort((a, b) => b.h - a.h);
  return lines.slice(0, 4).map(l => l.t).join(" ").slice(0, 120);
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
  renderNav();
  const v = view();
  if (v === "verwaltung") renderTable(); else if (v === "wand") renderWall(); else if (v === "wunsch") renderWish(); else renderShelf();
}
function view() { return location.hash === "#verwaltung" ? "verwaltung" : location.hash === "#wand" ? "wand" : location.hash === "#wunsch" ? "wunsch" : "regal"; }
function renderNav() {
  const v = view();
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.dataset.view === v));
  $("#v-regal").classList.toggle("hidden", v !== "regal");
  $("#v-verwaltung").classList.toggle("hidden", v !== "verwaltung");
  $("#v-wand").classList.toggle("hidden", v !== "wand");
  $("#v-wunsch").classList.toggle("hidden", v !== "wunsch");
  $(".fab").classList.toggle("hidden", v === "wand");
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
  if (!S.loaded) { host.replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" }, el("div", { class: "spin", style: "margin:0 auto" }))); return; }
  const tagSlot = $("#tagSlot"); if (tagSlot) fillNode(tagSlot, tagFilterSelect(S.tag, t => { S.tag = t; renderShelf(); }, S.books));
  if (S.tag && !allTags().some(t => t.name.toLowerCase() === S.tag.toLowerCase())) S.tag = "";
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
  const goneSec = goneList.length ? el("div", { class: "gonesec", style: "grid-column:1/-1" },
    el("button", { class: "gonehead", onclick: () => { S.hideGone = !S.hideGone; try { localStorage.setItem("hideGone", S.hideGone ? "1" : ""); } catch {} renderShelf(); } },
      el("span", { text: (S.hideGone ? "▸ " : "▾ ") + "📦 Hatte ich mal" }), el("span", { class: "n", text: goneList.length })),
    S.hideGone ? null : el("div", { class: "grid gonegrid" }, ...goneList.map(b => el("button", { class: "card gone", onclick: () => openDetail(b.id) },
      coverEl(b), el("div", { class: "ti", text: b.title || "Ohne Titel" }), el("div", { class: "au", text: b.author || "—" }), el("div", { class: "gt", text: goneText(b.gone) }))))) : null;
  const noCov = S.books.filter(needsCover).length;
  const covNote = noCov && !S.q && S.filter === "all" && !S.favOnly && !S.tag && !S.series && !S.hideCovNote ? el("div", { class: "note info", style: "grid-column:1/-1;display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
    el("span", { style: "flex:1", text: `${noCov} ${noCov === 1 ? "Buch hat" : "Bücher haben"} noch kein Cover.` }),
    el("button", { class: "btn sm primary", onclick: () => coverRun() }, "🖼 Cover online nachtragen"),
    el("button", { class: "btn sm ghost", onclick: () => { S.hideCovNote = true; renderShelf(); } }, "Später")) : null;
  const wishHits = S.q ? S.books.filter(b => isWish(b) && matchQ(b, S.q)).length : 0;
  const wishNote = wishHits ? el("div", { class: "saved", style: "grid-column:1/-1" }, `Auch auf deiner Wunschliste: ${wishHits} Treffer – `, el("a", { href: "#wunsch", onclick: () => { S.wishQ = S.q; } }, "anzeigen")) : null;
  if (!list.length && goneSec && S.books.some(b => !isGone(b)) === false) { host.replaceChildren(goneSec); return; }
  if (!list.length) {
    host.replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" },
      S.books.length ? el("div", {}, el("h2", { text: "Nichts gefunden" }), el("p", { text: "Kein Buch passt zu Filter oder Suche." }))
        : el("div", {}, el("h2", { text: "Dein Regal ist noch leer" }), el("p", { text: "Scanne den Barcode eines Buches, fotografiere das Cover oder suche nach Titel." }),
          el("button", { class: "btn primary", onclick: openAdd }, "＋ Erstes Buch hinzufügen"),
          el("p", { style: "margin-top:18px;font-size:13px" }, "Du hast schon Bücher auf einem anderen Gerät? ", el("a", { href: "#", onclick: e => { e.preventDefault(); importFlow(); } }, "Sicherung importieren")))), wishNote || "", goneSec || "");
    return;
  }
  fillNode(host, covNote, ...list.map(b => el("button", { class: "card", onclick: () => openDetail(b.id) },
    coverEl(b, { badge: true }), el("div", { class: "ti", text: b.title || "Ohne Titel" }), el("div", { class: "au", text: b.author || "—" }),
    b.series && (S.series || S.sort === "series") ? el("div", { class: "st", style: "color:var(--muted);letter-spacing:0", text: seriesText(b) }) : null,
    b.rating ? el("div", { class: "st", text: "★".repeat(b.rating) + (readsOf(b).filter(r => r.end).length > 1 ? "  ·  " + readsSummary(b) : "") }) : (readsOf(b).filter(r => r.end).length > 1 ? el("div", { class: "st", style: "color:var(--muted);letter-spacing:0", text: readsSummary(b) }) : null))), wishNote, goneSec);
}
try { S.hideGone = !!localStorage.getItem("hideGone"); } catch {}

/* ================= Ansicht: Wunschliste ================= */
function renderWish() {
  const host = $("#v-wunsch"); if (!host || host.classList.contains("hidden")) return;
  const q = el("input", { class: "field search", type: "search", placeholder: "In der Wunschliste suchen …", value: S.wishQ || "" });
  const sort = el("select", { class: "field" }, ...[["added-desc", "Zuletzt hinzugefügt"], ["title", "Titel A–Z"], ["author", "Autor A–Z"], ["series", "Reihe & Band"], ["price", "Preis aufsteigend"]].map(([v, l]) => el("option", { value: v, selected: (S.wishSort || "added-desc") === v || null }, l)));
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
    el("div", { class: "tools" }, el("h2", { style: "font-size:20px", text: "⭐ Wunschliste" }), sumEl, el("span", { style: "flex:1" }), q, sort,
      el("button", { class: "btn primary", onclick: () => openAdd(true) }, "＋ Wunsch hinzufügen")),
    el("p", { class: "saved", style: "margin:0", text: "Getrennt von deinem Bestand: Wünsche erscheinen nicht im Regal und nicht im echten Regal und zählen nicht mit. Gekauft? Buch öffnen → „✓ Gekauft“." }),
    grid);
  draw();
}
$("#q").addEventListener("input", e => { S.q = e.target.value; renderShelf(); });
try { const s = localStorage.getItem("shelfSort"); if (s) { S.sort = s; $("#sort").value = s; } } catch {}
$("#sort").addEventListener("change", e => { S.sort = e.target.value; try { localStorage.setItem("shelfSort", S.sort); } catch {} renderShelf(); });
window.addEventListener("hashchange", renderAll);
document.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => openAdd(view() === "wunsch")));

/* ================= Dialoge ================= */
let openSheet = null;
function sheet(title, { onClose } = {}) {
  closeSheet();
  const body = el("div", { class: "sheet-b" });
  const h2 = el("h2", { text: title });
  const head = el("div", { class: "sheet-h" }, h2, el("button", { class: "x", "aria-label": "Schließen", onclick: requestClose }, "✕"));
  const sh = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, head, body);
  const ov = el("div", { class: "overlay", onclick: e => { if (e.target === ov) requestClose(); } }, sh);
  document.body.append(ov); document.body.style.overflow = "hidden";
  openSheet = { ov, body, h2, onClose };
  return openSheet;
}
async function requestClose() { if (!openSheet) return; const s = openSheet; if (s.guard && !(await s.guard())) return; if (openSheet === s) closeSheet(); }
function closeSheet() { if (!openSheet) return; const s = openSheet; openSheet = null; s.onClose && s.onClose(); s.ov.remove(); document.body.style.overflow = ""; S.pasteHandler = null; }
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
  const m = isMobile();
  const scanBtn = el("button", { class: "btn primary", onclick: startLiveScan }, "▦ Barcode scannen");
  const isbnIn = el("input", { class: "field", placeholder: "ISBN eintippen", inputmode: "numeric" });
  const isbnGo = () => { const i = toIsbn13(isbnIn.value); if (!i) { toast("Das ist keine gültige ISBN – bitte Ziffern prüfen."); return; } handleIsbn(i); };
  isbnIn.addEventListener("keydown", e => { if (e.key === "Enter") isbnGo(); });
  const qIn = el("input", { class: "field", type: "search", placeholder: "Titel und/oder Autor" });
  const qGo = () => { if (qIn.value.trim()) showSearch(qIn.value.trim(), null); };
  qIn.addEventListener("keydown", e => { if (e.key === "Enter") qGo(); });
  fillNode(sh.body,
    el("div", { class: "ways" },
      el("div", { class: "way" }, el("h3", { text: "Weg A · Barcode" }),
        el("p", { text: "Kamera über den ISBN-Barcode auf der Rückseite halten – Titel, Autor, Klappentext und Cover werden aus dem Internet geladen." }),
        el("div", { class: "row" }, scanBtn, el("button", { class: "btn", onclick: async () => { const f = await pickImage(m); if (f) barcodeFromPhoto(f); } }, m ? "📷 Foto" : "🖼 Bild mit Barcode"))),
      el("div", { class: "way" }, el("h3", { text: "Weg B · Cover-Foto" }),
        el("p", { text: "Für Bücher ohne Barcode: Vorderseite fotografieren. Die App liest Titel und Autor vom Bild und sucht passende Bücher." }),
        el("div", { class: "row" },
          m ? el("button", { class: "btn primary", onclick: async () => { const f = await pickImage(true); if (f) coverFlow(f); } }, "📷 Cover fotografieren") : null,
          el("button", { class: "btn" + (m ? "" : " primary"), onclick: async () => { const f = await pickImage(false); if (f) coverFlow(f); } }, m ? "Aus Galerie" : "🖼 Cover-Bild wählen")))),
    m ? null : dropZone("…oder ein Cover-Bild hierher ziehen bzw. mit Strg+V einfügen", f => coverFlow(f)),
    el("div", { class: "way", style: "margin-top:14px" }, el("h3", { text: "Weg C · Fach-Foto (viele Bücher auf einmal)" }),
      el("p", { text: "Ein ganzes Regalfach fotografieren: Die App erkennt alle Buchrücken, sucht die Buchdaten und stellt die Bücher in der richtigen Reihenfolge ins echte Regal." }),
      el("div", { class: "row" }, el("button", { class: "btn primary", onclick: () => openShelfScan() }, "📷 Fach-Foto einlesen"))),
    el("div", { class: "sec" }, el("label", { class: "lbl", text: "Suchen nach Titel / Autor" }), el("div", { class: "manual", style: "margin-top:0" }, qIn, el("button", { class: "btn", onclick: qGo }, "Suchen"))),
    el("div", { class: "sec" }, el("label", { class: "lbl", text: "ISBN eingeben" }), el("div", { class: "manual", style: "margin-top:0" }, isbnIn, el("button", { class: "btn", onclick: isbnGo }, "Laden"))),
    el("div", { style: "margin-top:16px" }, el("button", { class: "btn ghost", onclick: () => openReview({}, null) }, "✏️ Ganz von Hand eintragen"))
  );
  S.pasteHandler = f => coverFlow(f);
}
function busyView(title, img, msg) {
  const sh = openSheet || sheet(title);
  sh.h2.textContent = title; S.pasteHandler = null;
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
  try { rec = await lookupIsbn(isbn); } catch (e) { err = e; }
  if (!rec) {
    openReview({ isbn }, null, err ? "Keine Internetverbindung – trag die Daten von Hand ein oder versuch es später mit „Daten suchen“." : "Zu dieser ISBN wurde online nichts gefunden. Trag die Daten von Hand ein oder fotografiere das Cover.");
    return;
  }
  openReview(rec, null);
}
async function coverFlow(file) {
  if (aiKey()) {
    busyView("Cover wird erkannt", file, "KI liest das Cover …");
    try { coverResult(await aiRecognizeCover(file), file); return; } catch (e) { toast("KI-Erkennung nicht möglich: " + (e.message || e) + " – nutze Texterkennung.", 4000); }
  }
  const msg = busyView("Cover wird gelesen", file, "Texterkennung startet … (beim ersten Mal werden Sprachdaten geladen)");
  let text = "";
  try { text = await ocrCover(file, p => { msg.textContent = `Lese Text vom Cover … ${p} %`; }); } catch (e) { console.warn(e); }
  showSearch(text, file);
}
async function showSearch(query, coverFile, recognized) {
  const sh = openSheet || sheet("Suche");
  sh.h2.textContent = coverFile ? "Welches Buch ist es?" : "Suchergebnisse";
  S.pasteHandler = null;
  const qIn = el("input", { class: "field", type: "search", value: query || "", placeholder: "Titel und/oder Autor" });
  const results = el("div", { class: "cands" });
  const run = async () => {
    const q = qIn.value.trim();
    if (!q) { results.replaceChildren(el("div", { class: "note", text: "Auf dem Cover war kein Text lesbar. Tipp: Titel und Autor oben eintippen." })); return; }
    results.replaceChildren(el("div", { class: "busy", style: "padding:14px" }, el("div", { class: "spin" })));
    let list = [];
    try { list = await searchBooks(q); } catch { results.replaceChildren(el("div", { class: "note", text: "Keine Internetverbindung. Du kannst das Buch trotzdem von Hand anlegen." })); return; }
    if (!list.length) { results.replaceChildren(el("div", { class: "note", text: "Nichts gefunden. Suchbegriff kürzen oder anpassen – oder von Hand anlegen." })); return; }
    results.replaceChildren(
      el("div", { class: "saved", text: `${list.length} Treffer – neueste deutsche Ausgaben (DNB) zuerst. Die ISBN zeigt, welche Ausgabe es ist.` }),
      ...list.map(r => el("button", { class: "cand", onclick: () => pickCandidate(r, coverFile) },
        el("div", { class: "cv" }, r.coverUrl ? el("img", { src: r.coverUrl, alt: "", loading: "lazy", onerror: e => { const n = (r.altCovers || []).indexOf(e.target.getAttribute("src")); const nx = (r.altCovers || [])[n + 1]; if (nx) e.target.src = nx; else e.target.remove(); } }) : null),
        el("div", {}, el("b", { text: r.title }),
          el("span", { text: [r.author, [r.publisher, r.year].filter(Boolean).join(" "), r.pages ? r.pages + " S." : ""].filter(Boolean).join(" · ") }),
          el("div", { class: "candmeta" }, r.ebook ? el("span", { class: "mtag", text: "E-Book" }) : null, r.edition ? el("span", { text: r.edition }) : null, r.isbn ? el("span", { text: "ISBN " + r.isbn }) : null, el("span", { text: r.src }))),
        el("span", { style: "color:var(--accent);font-weight:600", text: "Wählen" }))));
    links.replaceChildren(webSearchLinks(q) || "");
  };
  const links = el("div", {});
  qIn.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  fillNode(sh.body, 
    coverFile ? el("div", { style: "display:flex;gap:14px;align-items:flex-start;margin-bottom:12px" },
      el("img", { src: URL.createObjectURL(coverFile), style: "width:70px;border-radius:4px;box-shadow:var(--shadow)" }),
      el("div", { style: "font-size:14px;color:var(--muted)" }, query ? "Vom Cover gelesen – bei Bedarf korrigieren und erneut suchen:" : "Text konnte nicht gelesen werden – bitte Titel/Autor eintippen:")) : null,
    el("div", { class: "manual", style: "margin-top:0" }, qIn, el("button", { class: "btn primary", onclick: run }, "Suchen")),
    results,
    links,
    el("div", { class: "saved", style: "margin-top:6px", text: "Nicht dabei? Über die Links findest du die Ausgabe im Web – dann die ISBN unter „Buch hinzufügen → ISBN eingeben“ eintippen." }),
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
function openReview(rec, coverFile, noteText) {
  const sh = openSheet || sheet("Prüfen & speichern");
  sh.h2.textContent = "Prüfen & speichern";
  const draft = { status: "unread", rating: 0, notes: "", wish: !!S.addAsWish };
  for (const f of FIELDS) draft[f.k] = rec[f.k] || "";
  let coverMode = coverFile ? "photo" : (rec.coverUrl ? "web" : "none");
  let photo = coverFile || null, photoUrl = photo ? URL.createObjectURL(photo) : null;
  const webCovers = rec.altCovers || (rec.coverUrl ? [rec.coverUrl] : []);
  let webIdx = 0;
  const coverBox = el("div", {});
  const coverChoice = el("div", { class: "covertools" });
  const drawCover = () => {
    const src = coverMode === "photo" ? photoUrl : coverMode === "web" ? webCovers[webIdx] : null;
    const c = coverEl(draft, { src });
    const img = c.querySelector("img");
    if (img && coverMode === "web") img.onerror = () => { if (webIdx < webCovers.length - 1) { webIdx++; drawCover(); } else { coverMode = photo ? "photo" : "none"; drawCover(); } };
    if (src) c.addEventListener("click", () => lightbox(src));
    coverBox.replaceChildren(c);
    coverChoice.replaceChildren(...[
      photo && webCovers.length ? el("button", { class: "btn sm", type: "button", onclick: () => { coverMode = coverMode === "photo" ? "web" : "photo"; drawCover(); } }, coverMode === "photo" ? "Online-Cover nehmen" : "Mein Foto nehmen") : null].filter(Boolean));
  };
  const setPhoto = f => { photo = f; photoUrl = URL.createObjectURL(f); coverMode = "photo"; drawCover(); };
  drawCover();
  S.pasteHandler = setPhoto;
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
      if (await confirmBox(`„${dup.title}“ steht auf deiner Wunschliste.\nAls gekauft in den Bestand übernehmen?`, "Übernehmen")) { await wishBought(dup.id); if (next) openAdd(); else openDetail(dup.id); }
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
      await putBook(b);
      toast(b.wish ? `„${b.title}“ steht auf der Wunschliste.` : `„${b.title}“ ist im Regal.`);
      if (next) openAdd(); else closeSheet();
    } catch (e) { console.error(e); toast("Speichern fehlgeschlagen."); saveBtn.disabled = false; saveBtn.textContent = label(); }
  };
  saveBtn.addEventListener("click", () => doSave(false));
  fillNode(sh.body, 
    ...notes,
    whereSeg,
    el("div", { class: "dtop" }, el("div", {}, coverBox, coverChoice, coverTools(setPhoto)), el("div", {}, personal)),
    el("div", { class: "sec" }, el("h3", { text: "Buchdaten" }), form,
      el("label", { class: "lbl", style: "margin-top:12px", text: "Schlagworte" }), tagEditor(draft, () => {}),
      webSearchLinks([draft.title, draft.author].filter(Boolean).join(" "), draft.isbn, draft.title, draft.author)),
    el("div", { class: "actions" },
      el("button", { class: "btn ghost", onclick: openAdd }, "← Zurück"),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, el("button", { class: "btn", onclick: () => doSave(true) }, "Speichern & nächstes"), saveBtn))
  );
  sh.body.parentElement.scrollTop = 0;
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
  const editBtn = el("button", { class: "btn primary", onclick: () => drawDetailEdit(sh, S.books.find(x => x.id === b.id)) }, "✏️ Bearbeiten");
  fillNode(sh.body,
    el("div", { class: "dtop" }, el("div", {}, cover),
      el("div", {}, head,
        el("label", { class: "lbl", style: "margin-top:12px", text: "Lesestatus" }), seg,
        el("label", { class: "lbl", style: "margin-top:12px", text: "Deine Bewertung" }), stars,
        el("div", { style: "margin-top:10px" }, el("button", { type: "button", class: "favbtn" + (book.favorite ? " on" : ""), onclick: () => quickSave({ favorite: !book.favorite }).then(() => drawDetailView(sh, S.books.find(x => x.id === b.id))) }, book.favorite ? "♥ Lieblingsbuch" : "♡ Als Lieblingsbuch markieren")),
        dates,
        el("div", { style: "margin-top:14px" }, editBtn))),
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
    el("div", { class: "actions" },
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
  const setPhoto = async f => { try { draft.coverBlob = await coverBlobFromFile(f); draft.coverUrl = ""; st.previewUrl = null; st.coverChanged = true; markDirty(); drawCover(); } catch { toast("Bild konnte nicht gelesen werden."); } };
  S.pasteHandler = setPhoto;
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
  const drawSpPrev = () => { const sc = 6, c = spineCm(draft); fillNode(spPrev, el("div", { class: "spine", style: `width:${c.w * sc}px;height:${c.h * sc}px` }, spineFace(draft, c.w * sc, c.h * sc, null, "draft-" + b.id))); };
  drawSpPrev();
  const spineSec = el("div", { class: "sec" }, el("h3", { text: "Buchrücken (echtes Regal)" }),
    el("div", { style: "display:flex;gap:14px;align-items:flex-end" }, spPrev,
      el("div", {}, el("p", { class: "saved", style: "margin:0 0 8px", text: draft.spine ? "Individuell gestaltet." : "Automatisch: Farbe aus dem Cover, Dicke aus der Seitenzahl." }),
        el("button", { class: "btn sm", type: "button", onclick: () => spineEditor(draft, sp => { draft.spine = sp; markDirty(); drawSpPrev(); }) }, "🎨 Gestalten"))));
  const wishCb = el("input", { type: "checkbox", checked: isWish(draft) || null, style: "width:18px;height:18px;accent-color:var(--accent)" });
  wishCb.addEventListener("change", () => { draft.wish = wishCb.checked; if (draft.wish && goneCb.checked) { goneCb.checked = false; syncGone(); } markDirty(); });
  const goneSec = el("div", { class: "sec" }, el("h3", { text: "Besitz" }),
    el("label", { class: "prow", style: "border:1px solid var(--line);border-radius:10px;margin-bottom:8px" }, wishCb, el("span", {}, el("b", { text: "⭐ Wunschliste" }), el("div", { class: "saved", text: "Besitze ich (noch) nicht – getrennt vom Bestand, nicht im echten Regal." }))),
    el("label", { class: "prow", style: "border:1px solid var(--line);border-radius:10px" }, goneCb, el("span", {}, el("b", { text: "📦 Hatte ich mal" }), el("div", { class: "saved", text: "Verschenkt, gespendet, verkauft … – das Buch wird ausgegraut in einer eigenen Liste gezeigt und aus dem echten Regal genommen." }))),
    goneBody);
  const signSec = signEdit(draft, markDirty);
  const extrasSec = extrasEdit(draft, st, markDirty);
  fillNode(sh.body,
    el("div", { class: "dtop" }, el("div", {}, coverBox, coverControls, coverDrop), el("div", {}, personal)),
    signSec,
    extrasSec,
    spineSec,
    goneSec,
    el("div", { class: "sec" }, el("h3", { text: "Buchdaten" }), form,
      el("label", { class: "lbl", style: "margin-top:12px", text: "Schlagworte" }), tagEditor(draft, () => markDirty()),
      el("div", { class: "covertools", style: "margin-top:12px" }, fillBtn, reloadBtn),
      webSearchLinks([draft.title, draft.author].filter(Boolean).join(" "), draft.isbn, draft.title, draft.author)),
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
    if (needsCover(b) && rec.coverUrl) { const blob = await fetchCoverBlob(rec.coverUrl); if (blob) { patch.coverUrl = rec.coverUrl; patch.coverBlob = blob; S.badCover.delete(b.id); } else if (await imgOk(rec.coverUrl)) { patch.coverUrl = rec.coverUrl; S.badCover.delete(b.id); } }
    if (!Object.keys(patch).length) { toast("Nichts Neues gefunden."); return; }
    await patchBook(id, patch);
    toast("Ergänzt: " + Object.keys(patch).filter(k => k !== "coverBlob").map(k => k === "coverUrl" ? "Cover" : FIELDS.find(f => f.k === k).l).join(", "));
  } catch { toast("Keine Internetverbindung."); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "🔎"; } }
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
const MOD_COLORS = [["Weiß", "#f3f2ee"], ["Hellgrau", "#d6d4cf"], ["Anthrazit", "#3a3a3a"], ["Ruby", "#7d2630"], ["Salbei", "#a7b4a0"], ["Blau", "#3f5d7d"], ["Senf", "#d9a640"]];
S.shelves = { walls: [], updatedAt: "" }; S.wallId = null; S.pick = null; S.wallEdit = false; S.zoom = 1; S.highlight = null; S.wq = ""; S.showBack = new Set();

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
async function placeBook(id, mod, k, index, layer = "front") {
  const list = layerList(mod, k, layer);
  const old = list.indexOf(id);
  if (index == null) index = list.length;
  if (old >= 0 && old < index) index--;
  unshelve(id);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
  await saveShelves();
  const b = S.books.find(x => x.id === id);
  const u = fachUsage(mod, k);
  toast(`„${b?.title || "Buch"}“ ${layer === "top" ? "oben aufgelegt" : layer === "back" ? "in die hintere Reihe gestellt" : "eingeräumt"}` + (u.full ? " – das Fach ist rechnerisch voll." : "."), 2200);
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
function rowMetrics(ids) { // Breite und größte Höhe einer Reihe in cm
  let w = 0, h = 0;
  for (const g of rowGroups(ids)) {
    if (g.lying) { w += Math.max(...g.items.map(x => spineCm(x.b).h)); h = Math.max(h, g.items.reduce((a, x) => a + spineCm(x.b).w, 0)); }
    else for (const x of g.items) { const c = spineCm(x.b); w += c.w; h = Math.max(h, c.h); }
  }
  return { w, h };
}
function fachUsage(m, k) {
  const f = rowMetrics(layerList(m, k, "front")), b = rowMetrics(layerList(m, k, "back"));
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
  // Maßstab: ganze Wand passt in die Breite (Zoom ändert das)
  const colW = c => Math.max(35.4, ...c.modules.map(m => modDims(m).w));
  const totalW = w.columns.reduce((a, c) => a + colW(c), 0) + (w.columns.length - 1) * 1.5 + 2;
  const wide = innerWidth >= 900;
  const avail = (wide ? Math.min(1280, innerWidth) - 36 - 310 : innerWidth - 36) - 32;
  const s = Math.max(2.6, Math.min(9, avail / Math.max(totalW, 69.6))) * S.zoom;

  const sel = el("select", { class: "field" }, ...S.shelves.walls.map(x => el("option", { value: x.id, selected: x.id === w.id || null }, x.name)));
  sel.addEventListener("change", () => { S.wallId = sel.value; renderWall(); });
  const tools = el("div", { class: "tools" },
    S.shelves.walls.length > 1 ? sel : el("h2", { style: "font-size:20px", text: w.name }),
    el("button", { class: "btn sm" + (S.wallEdit ? " primary" : ""), onclick: () => { S.wallEdit = !S.wallEdit; renderWall(); } }, S.wallEdit ? "✓ Aufbau fertig" : "🧱 Aufbau ändern"),
    el("button", { class: "btn sm", onclick: newWallDialog }, "＋ Weitere Wand"),
    el("button", { class: "btn sm", onclick: () => openShelfScan() }, "📷 Fach-Foto einlesen"),
    el("span", { style: "flex:1" }),
    el("button", { class: "btn sm", title: "Verkleinern", onclick: () => { S.zoom = Math.max(0.5, S.zoom / 1.2); renderWall(); } }, "−"),
    el("button", { class: "btn sm", title: "Vergrößern", onclick: () => { S.zoom = Math.min(4, S.zoom * 1.2); renderWall(); } }, "＋"));

  const pickBook = S.pick && bookOf(S.pick);
  const pickBar = pickBook ? el("div", { class: "note info pickbar" },
    el("span", {}, el("b", { text: `„${pickBook.title}“ einräumen: ` }), "Tippe auf ein Fach (kommt ans Ende), auf das Buch, vor das es soll, oder auf „⇧ drauflegen“ in einem Fach."),
    el("button", { class: "btn sm", onclick: () => { S.pick = null; renderWall(); } }, "Abbrechen")) : null;

  const wallEl = el("div", { class: "wall" + (S.wallEdit ? " editing" : "") + (pickBook ? " picking" : ""), style: `gap:${1.5 * s}px` });
  w.columns.forEach((col, ci) => {
    const colEl = el("div", { class: "wcol", style: `min-width:${colW(col) * s}px` });
    if (S.wallEdit) colEl.append(el("div", { class: "colbar", style: `width:${Math.max(colW(col) * s, 220)}px` },
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

  const editInfo = S.wallEdit ? el("div", { class: "note info" }, "Aufbau ändern: Würfel oben an eine Spalte anfügen, mit ▲ ▼ ◀ ▶ verschieben, 2er-Würfel mit ⟳ hochkant drehen, Farbe wählen oder entfernen. ",
    el("a", { href: "#", onclick: e => { e.preventDefault(); renameWall(w); } }, "Wand umbenennen"), " · ",
    el("a", { href: "#", onclick: async e => { e.preventDefault(); if (await confirmBox(`Regalwand „${w.name}“ löschen? Die Bücher bleiben in deiner Sammlung, gelten aber als nicht eingeräumt.`, "Löschen")) { S.shelves.walls = S.shelves.walls.filter(x => x !== w); S.wallId = null; S.wallEdit = false; await saveShelves(); renderAll(); } } }, "Wand löschen")) : null;

  const legend = el("div", { class: "saved", style: "margin-top:10px" },
    "Symbolisch: Dicke aus der Seitenzahl geschätzt, Farbe aus dem Cover. ♥ = Lieblingsbuch. ",
    "Buch antippen: hinlegen, stapeln, oben drauflegen oder in die hintere Reihe stellen. „⇅ hinten“ zeigt die hintere Reihe eines Fachs. Rot umrandet = rechnerisch voll.");

  fillNode(host, tools, pickBar, editInfo,
    el("div", { class: "wandlayout" }, el("div", { class: "wallscroll" }, wallEl, legend), sidebarEl()));
  if (S.highlight) {
    const sp = host.querySelector(`.spine[data-id="${S.highlight}"]`);
    if (sp) { sp.classList.add("hl"); sp.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }); }
    const id = S.highlight; setTimeout(() => { if (S.highlight === id) { S.highlight = null; host.querySelectorAll(".spine.hl").forEach(x => x.classList.remove("hl")); } }, 4000);
  }
}
async function editWall(fn) { fn(); await saveShelves(); renderAll(); }
function moduleEl(w, col, ci, m, mi, s) {
  const d = modDims(m), lay = modLayout(m);
  if (m.type === "gap") return el("div", { class: "mod gap", style: `width:${d.w * s}px;height:${d.h * s}px` }, S.wallEdit ? modBar(w, col, ci, m, mi) : null);
  ensureLayers(m);
  const interior = `color-mix(in srgb, ${m.color} 84%, #000)`;
  const def = MOD[m.type];
  const mEl = el("div", { class: "mod", title: `${def.model}${upright(m) ? " hochkant" : ""} · B ${String(d.w).replace(".", ",")} × H ${String(d.h).replace(".", ",")} × T ${def.d} cm`,
    style: `width:${d.w * s}px;height:${d.h * s}px;padding:${BOARD * s}px;gap:${BOARD * s}px;background:${m.color};grid-template-columns:repeat(${lay.cols},1fr);grid-template-rows:repeat(${lay.rows},1fr)` });
  for (const k of lay.keys) mEl.append(fachEl(m, k, s, interior));
  if (S.wallEdit) mEl.append(modBar(w, col, ci, m, mi));
  return mEl;
}
function rotateModule(m) {
  ensureLayers(m);
  const map = upright(m) ? { T: "L", B: "R" } : { L: "T", R: "B" };
  for (const o of [m.fachs, m.back, m.top]) for (const [a, b] of Object.entries(map)) { o[b] = o[a] || []; delete o[a]; }
  m.orient = upright(m) ? "h" : "v";
}
function modBar(w, col, ci, m, mi) {
  const colSel = el("select", { title: "Farbe" }, ...MOD_COLORS.map(([n, c]) => el("option", { value: c, selected: m.color === c || null }, n)));
  colSel.addEventListener("change", () => editWall(() => { m.color = colSel.value; }));
  const move = (dc) => editWall(() => { const t = w.columns[ci + dc]; if (!t) return; col.modules.splice(mi, 1); t.modules.splice(Math.min(mi, t.modules.length), 0, m); });
  return el("div", { class: "modbar" + (upright(m) ? " vert" : ""), onclick: e => e.stopPropagation() },
    el("span", { text: MOD[m.type].name }),
    el("button", { title: "Nach oben", disabled: mi === 0 || null, onclick: () => editWall(() => { col.modules.splice(mi, 1); col.modules.splice(mi - 1, 0, m); }) }, "▲"),
    el("button", { title: "Nach unten", disabled: mi === col.modules.length - 1 || null, onclick: () => editWall(() => { col.modules.splice(mi, 1); col.modules.splice(mi + 1, 0, m); }) }, "▼"),
    el("button", { title: "In linke Spalte", disabled: ci === 0 || null, onclick: () => move(-1) }, "◀"),
    el("button", { title: "In rechte Spalte", disabled: ci === w.columns.length - 1 || null, onclick: () => move(1) }, "▶"),
    m.type !== "1112" ? el("button", { title: upright(m) ? "Quer stellen" : "Hochkant stellen", onclick: () => editWall(() => rotateModule(m)) }, "⟳") : null,
    m.type !== "gap" ? colSel : null,
    el("button", { title: "Entfernen", onclick: async () => { const n = modBookCount(m); if (!n || await confirmBox(`In diesem Würfel stehen ${n} Bücher. Sie gelten danach als „nicht eingeräumt“.\nWürfel entfernen?`, "Entfernen")) editWall(() => col.modules.splice(mi, 1)); } }, "✕"));
}
function bookEl(b, s, lying, onClick) {
  const { w, h } = spineCm(b);
  const thick = w * s, len = h * s;
  const sp = el("div", { class: "spine" + (lying ? " lie" : "") + (b.favorite ? " fav" : "") + (S.pick === b.id ? " picked" : ""), "data-id": b.id, draggable: S.wallEdit ? null : "true",
    title: `${b.title}${b.author ? " – " + b.author : ""}${lying ? " (liegend)" : ""}`,
    style: lying ? `width:${len}px;height:${thick}px` : `width:${thick}px;height:${len}px` });
  const face = spineFace(b, thick, len);
  if (lying) face.style.cssText += ";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(90deg)";
  sp.append(face);
  sp.addEventListener("click", e => { e.stopPropagation(); if (!S.wallEdit) onClick(b); });
  sp.addEventListener("dragstart", e => { e.stopPropagation(); e.dataTransfer.setData("text/plain", b.id); e.dataTransfer.effectAllowed = "move"; });
  return sp;
}
function rowEl(m, k, layer, s) {
  const ids = layerList(m, k, layer);
  const row = el("div", { class: "layer " + layer, style: `padding:0 ${0.3 * s}px` });
  for (const g of rowGroups(ids)) {
    const click = b => { if (S.pick && S.pick !== b.id) placeBook(S.pick, m, k, ids.indexOf(b.id), layer).then(() => { S.pick = null; renderAll(); }); else spineMenu(b); };
    if (g.lying) {
      const st = el("div", { class: "stack", "data-i": g.items[0].i });
      g.items.forEach(x => st.append(bookEl(x.b, s, true, click)));
      row.append(st);
    } else g.items.forEach(x => { const sp = bookEl(x.b, s, false, click); sp.dataset.i = x.i; row.append(sp); });
  }
  return row;
}
function fachEl(m, k, s, interior) {
  const fid = m.id + ":" + k;
  const back = layerList(m, k, "back"), top = layerList(m, k, "top"), front = layerList(m, k, "front");
  const showBack = S.showBack.has(fid) && back.length;
  const active = showBack ? "back" : "front";
  const u = fachUsage(m, k);
  const f = el("div", { class: "fach" + (u.full ? " full" : "") + (showBack ? " showback" : ""), style: `background:${interior}`,
    title: `Fach ${FACH_LABEL[k]} · vorne ${front.length}${back.length ? ", hinten " + back.length : ""}${top.length ? ", oben drauf " + top.length : ""} Bücher · Reihe ca. ${Math.round(Math.min(u.front.w, 99) / FACH_W * 100)} % belegt` });
  // hintere Reihe (etwas höher und abgedunkelt), vordere Reihe, oben aufgelegte Bücher
  const backEl = rowEl(m, k, "back", s); backEl.style.bottom = (showBack ? 0 : 1.6 * s) + "px";
  const frontEl = rowEl(m, k, "front", s);
  const topEl = el("div", { class: "stack top", style: `left:${0.3 * s}px;bottom:${u.front.h * s}px` });
  top.forEach(id => { const b = bookOf(id); if (b) topEl.append(bookEl(b, s, true, bb => { if (S.pick && S.pick !== bb.id) placeBook(S.pick, m, k, top.indexOf(bb.id), "top").then(() => { S.pick = null; renderAll(); }); else spineMenu(bb); })); });
  f.append(backEl, frontEl);
  if (top.length && !showBack) f.append(topEl);
  // kleine Schalter im Fach
  const tg = el("div", { class: "fachbtns" });
  if (back.length) tg.append(el("button", { title: showBack ? "Vordere Reihe zeigen" : "Hintere Reihe zeigen", onclick: e => { e.stopPropagation(); S.showBack.has(fid) ? S.showBack.delete(fid) : S.showBack.add(fid); renderWall(); } }, showBack ? "⇅ vorne" : `⇅ hinten (${back.length})`));
  if (S.pick && !S.wallEdit) {
    tg.append(el("button", { title: "Liegend oben auf die Reihe legen", onclick: e => { e.stopPropagation(); placeBook(S.pick, m, k, null, "top").then(() => { setLying(S.pick, false); S.pick = null; saveShelves().then(renderAll); }); } }, "⇧ drauflegen"));
    if (!back.length) tg.append(el("button", { title: "In eine zweite, hintere Reihe stellen", onclick: e => { e.stopPropagation(); placeBook(S.pick, m, k, null, "back").then(() => { S.showBack.add(fid); S.pick = null; renderAll(); }); } }, "⇅ hinten"));
  }
  if (tg.children.length) f.append(tg);

  // Einräumen per Tippen
  f.addEventListener("click", () => { if (S.wallEdit || !S.pick) return; placeBook(S.pick, m, k, null, active).then(() => { S.pick = null; renderAll(); }); });
  // Einräumen per Ziehen (PC)
  const rowNow = () => f.querySelector(".layer." + active);
  const idxAt = x => { const kids = [...rowNow().children]; for (const kd of kids) { const r = kd.getBoundingClientRect(); if (x < r.left + r.width / 2) return +kd.dataset.i; } return layerList(m, k, active).length; };
  const clearIns = () => { f.classList.remove("drop", "insend"); f.querySelectorAll(".ins").forEach(x => x.classList.remove("ins")); };
  f.addEventListener("dragover", e => { if (S.wallEdit) return; e.preventDefault(); clearIns(); f.classList.add("drop"); const i = idxAt(e.clientX); const kid = [...rowNow().children].find(kd => +kd.dataset.i === i); if (kid) kid.classList.add("ins"); else f.classList.add("insend"); });
  f.addEventListener("dragleave", clearIns);
  f.addEventListener("drop", e => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); const i = idxAt(e.clientX); clearIns(); if (id && bookOf(id)) placeBook(id, m, k, i, active).then(() => { S.pick = null; renderAll(); }); });
  return f;
}
function sidebarEl() {
  const q = el("input", { class: "field", type: "search", placeholder: "Buch suchen (auch eingeräumte)", value: S.wq });
  const listEl = el("div", { class: "wlist" });
  const draw = () => {
    const qq = S.wq.trim();
    const list = (qq ? S.books.filter(b => inStock(b) && matchQ(b, qq)) : S.books.filter(b => inStock(b) && !locationOf(b.id)))
      .sort((a, b) => lastName(a.author).localeCompare(lastName(b.author), "de") || (a.title || "").localeCompare(b.title || "", "de"));
    fillNode(listEl, ...list.slice(0, 200).map(b => {
      const loc = locationOf(b.id);
      const it = el("div", { class: "witem" + (S.pick === b.id ? " on" : ""), draggable: "true", title: "Antippen, dann auf ein Fach tippen – oder ins Regal ziehen" },
        el("div", { class: "wthumb" }, coverSrc(b) ? el("img", { src: coverSrc(b), alt: "", loading: "lazy", onerror: e => e.target.remove() }) : null),
        el("div", { style: "min-width:0" }, el("b", { text: (b.favorite ? "♥ " : "") + (b.title || "Ohne Titel") }), el("span", { text: loc ? "📍 " + locationShort(loc) : (b.author || "") })),
        loc ? el("button", { class: "btn sm ghost", title: "Zurück zu „Noch nicht eingeräumt“", onclick: async e => { e.stopPropagation(); unshelve(b.id); setLying(b.id, false); await saveShelves(); renderAll(); toast("Zurückgelegt."); } }, "↩") : null);
      it.addEventListener("click", () => { S.pick = S.pick === b.id ? null : b.id; renderWall(); });
      it.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", b.id); e.dataTransfer.effectAllowed = "move"; });
      return it;
    }), list.length ? null : el("div", { class: "saved", style: "padding:10px", text: qq ? "Nichts gefunden." : "Alle Bücher sind eingeräumt. 🎉" }));
  };
  q.addEventListener("input", () => { S.wq = q.value; draw(); });
  draw();
  const n = S.books.filter(b => inStock(b) && !locationOf(b.id)).length;
  const aside = el("aside", { class: "wside" }, el("h3", { text: `Noch nicht eingeräumt (${n})` }), q, listEl,
    el("div", { class: "saved", text: "Tipp: Ein Buch aus dem Regal hierher ziehen (oder antippen → ↩), um es wieder herauszunehmen." }));
  aside.addEventListener("dragover", e => { e.preventDefault(); aside.classList.add("hot"); });
  aside.addEventListener("dragleave", e => { if (!aside.contains(e.relatedTarget)) aside.classList.remove("hot"); });
  aside.addEventListener("drop", async e => { e.preventDefault(); aside.classList.remove("hot"); const id = e.dataTransfer.getData("text/plain"); if (id && locationOf(id)) { unshelve(id); setLying(id, false); await saveShelves(); renderAll(); toast("Zurück in „Noch nicht eingeräumt“."); } });
  return aside;
}
function spineMenu(b) {
  const loc = locationOf(b.id); if (!loc) return;
  const close = () => box.remove();
  const after = async (msg) => { await saveShelves(); close(); renderAll(); if (msg) toast(msg, 1800); };
  const mv = d => { const l = loc.list; const i = l.indexOf(b.id), j = i + d; if (j < 0 || j >= l.length) return; l.splice(i, 1); l.splice(j, 0, b.id); after().then(() => spineMenu(b)); };
  const toLayer = async (layer, msg) => { const fid = loc.m.id + ":" + loc.k; unshelve(b.id); layerList(loc.m, loc.k, layer).push(b.id); if (layer === "top") setLying(b.id, false); if (layer === "back") S.showBack.add(fid); else S.showBack.delete(fid); await after(msg); };
  const lying = isLying(b.id), top = loc.layer === "top";
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
        el("button", { class: "btn sm danger", onclick: async () => { unshelve(b.id); setLying(b.id, false); await after("Zurück in „Noch nicht eingeräumt“."); } }, "↩ Zurück zu „Noch nicht eingeräumt“"),
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
  const showText = (!img || sp.textOnImage) && mode !== "kein" && thick >= 6;
  if (showText && (mode === "hoch" || mode === "beides")) face.append(el("span", { class: "vt" + (sp.dir === "down" ? " down" : ""), style: `font-size:${Math.max(6, Math.min(18, thick * 0.6 * scale))}px`, text: sp.text || b.title || "" }));
  if (showText && (mode === "quer" || mode === "beides")) face.append(el("span", { class: "qt pos-" + (sp.querPos || "unten"), style: `font-size:${Math.max(5, Math.min(14, thick * 0.3 * scale))}px`, text: sp.quer || (mode === "quer" ? (b.title || "") : firstAuthorLast(b.author)) }));
  return face;
}
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
  const size = on(el("input", { type: "range", min: 60, max: 160, step: 5, value: d.size || 100 }), i => { d.size = +i.value; });
  const thick = on(el("input", { class: "field", type: "number", step: "0.1", min: "0.3", max: "15", value: d.thickCm || "", placeholder: est.w.toFixed(1) }), i => { d.thickCm = i.value ? +i.value : ""; });
  const height = on(el("input", { class: "field", type: "number", step: "0.5", min: "8", max: "33", value: d.heightCm || "", placeholder: est.h.toFixed(1) }), i => { d.heightCm = i.value ? +i.value : ""; });
  const textOnImg = el("input", { type: "checkbox", checked: d.textOnImage || null });
  textOnImg.addEventListener("change", () => { d.textOnImage = textOnImg.checked; drawPrev(); });
  const imgInfo = el("span", { class: "saved" });
  const imgBtns = el("div", { class: "covertools" });
  const setImage = async f => {
    try {
      const { blob, ratio } = await prepSpineImage(f); d.imageBlob = blob;
      if (!d.thickCm) { d.thickCm = Math.round((+d.heightCm || est.h) * ratio * 10) / 10; thick.value = d.thickCm; }
      drawImgBtns(); drawPrev(); toast("Bild übernommen – die Dicke wurde aus dem Bild berechnet.", 2600);
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
          field("Schriftgröße", size, "c6"),
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
    el("span", {}, el("b", { text: c.all }), "Bücher im Bestand"), el("span", {}, el("b", { text: c.read }), "gelesen"),
    el("span", {}, el("b", { text: c.reading }), "gerade dabei"), el("span", {}, el("b", { text: c.unread }), "ungelesen"),
    el("span", {}, el("b", { style: inc ? "color:var(--warn)" : "", text: inc }), "mit fehlenden Daten"),
    el("span", {}, el("b", { text: S.books.filter(isGone).length }), "hatte ich mal"),
    el("span", {}, el("b", { text: S.books.filter(isWish).length }), "auf der Wunschliste"));
  renderFilters($("#tfilters"), S.tFilter, k => { S.tFilter = k; renderTable(); }, [["fav", "♥ Lieblingsbücher", null, S.books.filter(b => b.favorite).length], ["unplaced", "Nicht eingeräumt", null, S.books.filter(b => inStock(b) && !locationOf(b.id)).length], ["gone", "📦 Hatte ich mal", null, S.books.filter(isGone).length], ["wish", "⭐ Wunschliste", null, S.books.filter(isWish).length], ["nocover", "Ohne Cover", null, S.books.filter(needsCover).length], ["incomplete", "Unvollständig", "var(--warn)", inc], ...(nDup || S.tFilter === "dup" ? [["dup", "🧩 Mögliche Dubletten", "var(--warn)", nDup]] : [])]);
  const dupBtn = $("#dupRun"); if (dupBtn) { dupBtn.textContent = "🧩 Dubletten prüfen" + (nDup ? ` (${nDup})` : ""); dupBtn.classList.toggle("warn", !!nDup); }
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
  return { app: "buecherregal", version: 2, exportedAt: new Date().toISOString(), books, deleted: S.deleted, shelves: S.shelves };
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
  let wallNote = "";
  if (data.shelves?.walls && (data.shelves.updatedAt || "") > (S.shelves.updatedAt || "")) { S.shelves = data.shelves; await DB.setMeta("shelves", S.shelves); wallNote = " Regal-Aufstellung übernommen."; }
  renderAll();
  dataChanged();
  return `Abgleich fertig: ${added} neu, ${updated} aktualisiert, ${removed} gelöscht, ${skipped} unverändert.${wallNote}`;
}
function exportCsv(only) {
  const books = Array.isArray(only) ? only : S.books;
  const keys = ["title", "author", "year", "isbn", "publisher", "pages", "genre", "language", "series", "seriesNo", "price", "value", "tags", "wish", "status", "rating", "favorite", "location", "reads", "gone", "signed", "signedBy", "dedication", "images", "files", "addedAt", "summary", "notes"];
  const head = ["Titel", "Autor", "Jahr", "ISBN", "Verlag", "Seiten", "Genre", "Sprache", "Reihe", "Band-Nr.", "Preis (€)", "Heutiger Wert (€)", "Schlagworte", "Wunschliste", "Status", "Bewertung", "Lieblingsbuch", "Standort", "Gelesen (Zeiträume)", "Hatte ich mal", "Signiert", "Signiert von / Anlass", "Widmung", "Weitere Bilder", "Dateien", "Hinzugefügt", "Zusammenfassung", "Notizen"];
  const q = v => { v = String(v ?? ""); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [head.join(";"), ...books.map(b => keys.map(k => q(k === "status" ? STATUS[b.status || "unread"] : k === "isbn" && b.isbn ? `="${b.isbn}"` : k === "addedAt" && b.addedAt ? b.addedAt.slice(0, 10) : k === "favorite" ? (b.favorite ? "ja" : "") : k === "location" ? (locationOf(b.id) ? locationText(locationOf(b.id)) : "") : k === "reads" ? readsOf(b).map(r => readText(r) + (r.note ? " (" + r.note + ")" : "")).join("; ") : k === "gone" ? (b.gone ? goneText(b.gone) + (b.gone.note ? " – " + b.gone.note : "") : "") : k === "signed" ? (b.signed ? "ja" : "") : k === "images" ? ((b.images || []).length || "") : k === "files" ? (b.files || []).map(f => f.name).join("; ") : k === "tags" ? (b.tags || []).join(", ") : k === "wish" ? (b.wish ? "ja" : "") : b[k])).join(";"))];
  saveFile(`buecherregal-${today()}${Array.isArray(only) ? "-auswahl" : ""}.csv`, new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
}
$("#exportCsv").addEventListener("click", exportCsv);
$("#coverRun").addEventListener("click", () => coverRun());
$("#dupRun").addEventListener("click", () => openDuplicates());
async function remindBackup() {
  if (!S.books.length) return;
  if (typeof autoBackupActive === "function" && await autoBackupActive()) return;
  const last = await DB.getMeta("lastBackup").catch(() => null);
  const days = last ? (Date.now() - new Date(last)) / 864e5 : 999;
  if (days > 14) setBanner(`Deine Bücher liegen nur in diesem Browser. ${last ? "Letzte Sicherung vor " + Math.floor(days) + " Tagen." : "Noch keine Sicherung."} `, el("button", { class: "btn sm", style: "margin-left:8px", onclick: exportFlow }, "Jetzt sichern"));
}

/* ================= Menü ================= */
$("#menuBtn").addEventListener("click", e => {
  e.stopPropagation();
  const old = $(".menu-list"); if (old) { old.remove(); return; }
  const close = () => list.remove();
  const item = (label, fn) => el("button", { onclick: () => { close(); fn(); } }, label);
  const list = el("div", { class: "menu-list" },
    item("⬆ Sicherung exportieren / an PC senden", exportFlow),
    item("⬇ Sicherung importieren & abgleichen", importFlow),
    el("hr"),
    item("💾 Automatische Sicherung …", openAutoBackup),
    item("🔄 Abgleich mit eigenem Server …", openSyncSettings),
    item("📊 Als CSV für Excel exportieren", exportCsv),
    item("🔗 Suchseiten wählen (ZVAB, SLUB …)", providerSettings),
    item("📷 Fach-Foto einlesen", () => openShelfScan()),
    item("🖼 Fehlende Cover online nachtragen", () => coverRun()),
    item("⚙️ Über die App & Einstellungen", aboutBox),
    el("small", { text: "Abgleich: Auf dem einen Gerät exportieren, auf dem anderen importieren. Neuere Änderungen gewinnen." }));
  $(".menu").append(list);
  setTimeout(() => document.addEventListener("click", function h(ev) { if (!list.contains(ev.target)) { close(); document.removeEventListener("click", h); } }), 0);
});
function aboutBox() {
  const sh = sheet("Über diese App");
  sh.body.append(
    el("p", { text: "Mein Bücherregal speichert alle Daten in diesem Browser auf diesem Gerät – es gibt kein Konto. Wer möchte, kann zusätzlich einen eigenen Server (z. B. auf dem PC) für den automatischen Abgleich eintragen." }),
    el("p", { text: "Buchdaten kommen von der Deutschen Nationalbibliothek (sehr vollständig für deutschsprachige und aktuelle Ausgaben), Google Books und Open Library. Die Texterkennung auf Covern läuft direkt im Browser (Tesseract)." }),
    el("p", { text: "Handy und PC abgleichen: Menü ⋯ → „Sicherung exportieren“ (auf dem Handy z. B. per Mail, Messenger oder Cloud an dich selbst schicken), dann am anderen Gerät „Sicherung importieren“. Bücher werden zusammengeführt, die neuere Änderung gewinnt." }),
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
loadAll();
