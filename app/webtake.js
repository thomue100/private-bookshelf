/* Mein Bücherregal – Bücher aus dem Web übernehmen, ohne die ISBN abzutippen.
   Es genügt ein kopierter Link (ZVAB, booklooker, Amazon, DNB, Google Books …), kopierter Seitentext oder die ISBN.
   Wege: Feld „ISBN oder Link“ beim Hinzufügen und unter den Suchtreffern, automatische Abholung aus der Zwischenablage
   nach „Im Internet suchen“, und am Handy „Teilen → Bücherregal“ direkt von der Shop-Seite. */
"use strict";

// Alle gültigen ISBNs (mit Prüfziffer) in Text oder Link, in der Reihenfolge des Vorkommens, als ISBN-13
function isbnsIn(text) {
  const s = String(text || ""), out = [];
  const add = v => { const i = toIsbn13(v); if (i && !out.includes(i)) out.push(i); };
  const hits = [];
  for (const m of s.matchAll(/(?<![\dA-Za-z])97[89](?:[\s\-‐–]?\d){10}(?![\dA-Za-z])/g)) hits.push([m.index, m[0]]);
  for (const m of s.matchAll(/(?<![\dA-Za-z])\d(?:[\s\-‐–]?\d){8}[\s\-‐–]?[\dXx](?![\dA-Za-z])/g)) hits.push([m.index, m[0]]);
  for (const m of s.matchAll(/\/(?:dp|gp\/product|ASIN)\/(\d{9}[\dXx])\b/gi)) hits.push([m.index, m[1]]); // Amazon: ASIN = ISBN-10
  hits.sort((a, b) => a[0] - b[0]).forEach(h => add(h[1]));
  return out;
}
// Wörter aus Shop-Adressen, die nichts über das Buch sagen
const URL_NOISE = new Set(["www", "http", "https", "html", "htm", "php", "aspx", "servlet", "searchresults", "search", "suche", "shop", "home", "artikeldetails", "product", "products", "produkt", "item", "items", "detail", "details", "angebote", "buecher", "bücher", "buch", "books", "book", "titel", "isbn", "plp", "sortby", "sort", "page", "edition", "frontcover", "printsec", "stripbooks", "ref", "amazon", "zvab", "booklooker", "thalia", "abebooks", "google", "query", "simplesearch", "opac", "results"]);
/* Was steckt im Text? → { isbn } (bevorzugt), { rec } (Katalogdatensatz ohne ISBN) oder { query } (Suchbegriff) – sonst null */
async function bookFromWeb(text) {
  const s = String(text || "").trim(); if (!s) return null;
  const url = (s.match(/https?:\/\/[^\s<>"]+/) || [])[0];
  let u = null; try { if (url) u = new URL(url); } catch {}
  // Katalognummern in DNB-Links sind keine ISBN (passen aber manchmal zufällig zur Prüfziffer)
  const isbns = isbnsIn(u && (u.hostname.endsWith("d-nb.info") || u.searchParams.has("idn")) ? s.replace(url, " ") : s);
  if (isbns.length) return { isbn: isbns[0], more: isbns.slice(1) };
  if (u) {
    // DNB: https://d-nb.info/1234567890 oder …?idn=…
    const idn = u.hostname.endsWith("d-nb.info") ? u.pathname.split("/").filter(Boolean)[0] : u.searchParams.get("idn");
    if (idn && /^\d{8,10}[\dX]?$/i.test(idn)) { try { const r = (await dnbQuery(`idn=${idn}`, 1))[0]; if (r) return r.isbn ? { isbn: r.isbn } : { rec: r }; } catch {} }
    // Google Books: books?id=… oder /books/edition/…/<id>
    const gid = /(^|\.)books\.google\./.test(u.hostname) || /(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith("/books") ? (u.searchParams.get("id") || (u.pathname.match(/\/books\/edition\/[^/]*\/([\w-]{8,})/) || [])[1]) : null;
    if (gid) { try { const r = fromGoogle(await getJSON(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(gid)}${gKey().replace("&", "?")}`)); if (r.isbn) return { isbn: r.isbn }; if (r.title) return { rec: r }; } catch {} }
    // sonst: Titel aus der Adresse („/Weihnachtsgeschichten-Kamin-27-Mürmann-Barbara/“ oder „?kn=…“)
    let path = u.pathname + " " + [...u.searchParams.values()].join(" ");
    try { path = decodeURIComponent(path); } catch {}
    const words = path.split(/[\s\/\-_+=.,:;|]+/).filter(w => /\p{L}{2,}/u.test(w) && !URL_NOISE.has(w.toLowerCase()) && !/^[a-z]{1,3}\d+/i.test(w)).concat(path.split(/[\s\/\-_+=.,:;|]+/).filter(w => /^\d{1,3}$/.test(w)).slice(0, 1));
    const q = [...new Set(words)].slice(0, 9).join(" ");
    return q ? { query: q } : null;
  }
  // kopierter Text ohne ISBN und Link: erste sinnvolle Zeile als Suchbegriff
  const line = s.split(/\n/).map(x => x.trim()).find(x => x.length >= 3 && x.length <= 160 && /\p{L}{3,}/u.test(x));
  return line ? { query: line } : null;
}
/* Übernehmen: ISBN → Buchdaten laden und prüfen lassen; ohne ISBN → Katalogsuche mit dem gefundenen Titel */
async function takeFromWeb(text) {
  hideClipOffer();
  const r = await bookFromWeb(text);
  if (!r) { toast("Darin war keine ISBN und kein Buchtitel zu finden."); return false; }
  if (r.isbn) { await handleIsbn(r.isbn); if (r.more?.length) toast(`Es standen ${r.more.length + 1} ISBNs darin – die erste wurde genommen.`, 3500); return true; }
  if (r.rec) { openReview(r.rec, null); return true; }
  showSearch(r.query, null);
  return true;
}
async function takeFromClipboard() {
  let t = ""; try { t = await navigator.clipboard.readText(); } catch { toast("Kein Zugriff auf die Zwischenablage – bitte ins Feld tippen und „Einfügen“ wählen."); return false; }
  if (!t.trim()) { toast("Die Zwischenablage ist leer."); return false; }
  return takeFromWeb(t);
}
// Eingabefeld „ISBN, Link oder Text aus dem Web“ mit Übernehmen- und Einfügen-Knopf
function webTakeField(placeholder = "ISBN eintippen oder Link einfügen") {
  const inp = el("input", { class: "field", placeholder, autocomplete: "off" });
  const go = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } const i = toIsbn13(v); if (i) handleIsbn(i); else takeFromWeb(v); };
  inp.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  inp.addEventListener("paste", () => setTimeout(() => { if (/https?:\/\/|97[89]/.test(inp.value)) go(); }, 50)); // eingefügter Link: gleich los
  const row = el("div", { class: "manual", style: "margin-top:0" }, inp, el("button", { class: "btn", onclick: go }, "Übernehmen"),
    navigator.clipboard?.readText ? el("button", { class: "btn", title: "Link oder ISBN aus der Zwischenablage übernehmen", onclick: takeFromClipboard }, "📋 Einfügen") : null);
  row.input = inp;
  return row;
}

/* ---------- Zurück aus dem Web: Zwischenablage anbieten ----------
   Nach einem Klick auf „Im Internet suchen“ schaut die App beim Zurückkommen still in die Zwischenablage.
   Steht dort eine ISBN oder ein Link (und nicht dasselbe wie vorher), erscheint unten „Übernehmen?“. */
const WT = { since: 0, before: null, offered: new Set(), busy: false };
function watchWebReturn() {
  WT.since = Date.now();
  if (navigator.clipboard?.readText) navigator.clipboard.readText().then(t => { WT.before = t; }).catch(() => {});
}
async function checkWebReturn() {
  if (WT.busy || !WT.since || Date.now() - WT.since > 45 * 60 * 1000 || document.visibilityState !== "visible") return;
  let t; WT.busy = true; try { t = await navigator.clipboard.readText(); } catch { return; } finally { WT.busy = false; }
  t = String(t || "").trim();
  if (!t || t === WT.before || WT.offered.has(t) || t.length > 5000) return;
  const isbn = isbnsIn(t)[0], url = (t.match(/https?:\/\/[^\s<>"]+/) || [])[0];
  if (!isbn && !url) return; // nur eindeutige Fundstücke anbieten, keinen beliebigen Text
  WT.offered.add(t);
  let what = isbn ? "ISBN " + isbn : "Link";
  if (!isbn) { try { what = "Link von " + new URL(url).hostname.replace(/^www\./, ""); } catch {} }
  // Eine offene Prüfliste oder ein angefangenes Buch nie ersetzen – dort gibt es eigene Felder zum Einfügen
  if (openSheet && !openSheet.webTake) { toast(`📋 In der Zwischenablage: ${what} – zum Übernehmen hier in das Feld „Link oder ISBN“ einfügen.`, 5000); return; }
  showClipOffer(`📋 In der Zwischenablage: ${what}`, () => takeFromWeb(t));
}
function showClipOffer(text, onTake) {
  hideClipOffer();
  const bar = el("div", { class: "clipoffer", role: "status" }, el("span", { text }),
    el("button", { class: "btn sm primary", onclick: () => { hideClipOffer(); if (openSheet && !openSheet.webTake) { toast("Erst das offene Fenster abschließen – der Link bleibt in der Zwischenablage."); return; } onTake(); } }, "Übernehmen"),
    el("button", { class: "btn sm ghost", title: "Nicht übernehmen", onclick: hideClipOffer }, "✕"));
  document.body.append(bar);
}
function hideClipOffer() { document.querySelectorAll(".clipoffer").forEach(x => x.remove()); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(checkWebReturn, 300); });
window.addEventListener("focus", () => setTimeout(checkWebReturn, 300));
// Klick auf einen der Links „Im Internet suchen“ startet das Beobachten
document.addEventListener("click", e => { if (e.target.closest && e.target.closest(".weblinks a[target=_blank]")) watchWebReturn(); }, true);
