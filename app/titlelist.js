/* Mein Bücherregal – „📋 Titelliste einfügen“: viele Bücher auf einmal aus einer Liste (Excel, Notiz, Mail, CSV).
   Ablauf: Text einfügen → parseTitleList (eine Zeile = ein Buch; Tabellen mit/ohne Kopfzeile; Freitext „Titel – Autor“ usw.)
   → Vorschau (Felder und Spalten korrigierbar) → Katalogsuche wie beim Fach-Foto (matchItem, autoChoice, resolveCollisions, assessScan)
   → dieselbe Prüfliste (scanReview ohne Foto) → Übernehmen (bookFromItem).
   Der angefangene Lauf (Text, Zeilen, Treffer – keine Bilder) steht im Meta-Eintrag „titleListRun“: nur auf diesem Gerät,
   nicht in Sicherung und Abgleich. So geht nichts verloren, wenn Android die App schließt. */
"use strict";

/* ================= Liste verstehen ================= */
const TL_FIELDS = [["title", "Titel"], ["author", "Autor"], ["isbn", "ISBN"], ["publisher", "Verlag"], ["year", "Jahr"], ["series", "Reihe"], ["volume", "Band"], ["tags", "Schlagworte"], ["", "– ignorieren –"]];
const TL_HEAD = {
  title: ["titel", "title", "buchtitel", "booktitle", "werk"],
  author: ["autor", "autorin", "autoren", "verfasser", "verfasserin", "author", "authors", "writer", "schriftsteller"],
  isbn: ["isbn", "isbn13", "isbn10", "ean"],
  publisher: ["verlag", "publisher", "verleger"],
  year: ["jahr", "erscheinungsjahr", "year", "published", "publicationyear"],
  series: ["reihe", "serie", "series", "buchreihe"],
  volume: ["band", "bandnr", "bd", "volume", "vol", "nr", "nummer", "teil"],
  tags: ["schlagworte", "schlagwort", "tags", "tag", "stichworte", "stichwort", "kategorie", "kategorien", "category", "categories"],
};
const tlNorm = s => String(s || "").toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
const headField = cell => { const n = tlNorm(cell); if (!n) return null; for (const [k, ws] of Object.entries(TL_HEAD)) if (ws.includes(n)) return k; return null; };
// Zelle säubern: Excel-Formel ="978…", Anführungszeichen, Leerraum
const tlCell = v => String(v ?? "").replace(/^﻿/, "").replace(/^="(.*)"$/s, "$1").trim();

// CSV/TSV lesen: Anführungszeichen, verdoppelte "" und Zeilenumbrüche in Anführungszeichen (wie im eigenen CSV-Export)
function csvRows(text, sep) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") { q = true; cell = ""; }
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}
// Ist der Text eine Tabelle? → { sep, rows, header (Zeile 0 ist Kopf?), map (Spalte → Feld) } oder null
function detectTable(text) {
  for (const sep of ["\t", ";", ","]) {
    if (!text.includes(sep)) continue;
    const rows = csvRows(text, sep);
    if (rows.length < 1) continue;
    const counts = new Map(); for (const r of rows) counts.set(r.length, (counts.get(r.length) || 0) + 1);
    const [k, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (k < 2 || n / rows.length < 0.6) continue;
    const hmap = rows[0].map(headField), known = hmap.filter(Boolean).length;
    const header = hmap.includes("title") || known >= 2;
    // Komma kommt in Freitext ständig vor („Ende, Michael: Momo“) – nur mit erkannter Kopfzeile als Tabelle werten
    if (sep === "," && !header) continue;
    if (sep === ";" && !header && rows.length < 2) continue;
    if (!header && rows.length < 2 && sep !== "\t") continue;
    return { sep, rows, header, map: header ? hmap.map(f => f || "") : guessColumns(rows) };
  }
  return null;
}
// Spalten ohne Kopfzeile aus dem Inhalt raten: ISBN, Jahr, Band (kleine Zahl), Rest = Titel/Autor/Verlag
function guessColumns(rows) {
  const cols = Math.max(...rows.map(r => r.length));
  const share = (c, test) => { const v = rows.map(r => tlCell(r[c])).filter(Boolean); return v.length ? v.filter(test).length / v.length : 0; };
  const map = [];
  const text = [];
  for (let c = 0; c < cols; c++) {
    if (share(c, v => isbnsIn(v).length > 0) >= 0.5) map[c] = "isbn";
    else if (share(c, v => /^(1[4-9]|20)\d\d$/.test(v)) >= 0.6) map[c] = "year";
    else if (share(c, v => /^(bd\.?\s*|band\s*|#)?\d{1,3}\.?$/i.test(v)) >= 0.6) map[c] = "volume";
    else { map[c] = ""; if (share(c, v => /\p{L}/u.test(v)) >= 0.5) text.push(c); }
  }
  // Namen-artige Spalte = Autor; die andere Textspalte = Titel
  const nameShare = c => share(c, v => nameLike(v));
  if (text.length === 1) map[text[0]] = "title";
  else if (text.length >= 2) {
    const [a, b] = text;
    const authorFirst = nameShare(a) > nameShare(b) + 0.2;
    map[authorFirst ? b : a] = "title"; map[authorFirst ? a : b] = "author";
    if (text[2] !== undefined) map[text[2]] = "publisher";
  }
  return map;
}
// Sieht aus wie ein Personenname? („Michael Ende“, „Ende, Michael“, „J. K. Rowling“, „Otfried Preußler“)
const NAME_PART = /^(von|van|der|den|de|du|di|da|le|la|zu|vom|y|bin|al)$/i;
function nameLike(s) {
  s = String(s || "").trim();
  if (!s || s.length > 45 || /\d|[!?«»"„“]/.test(s)) return false;
  if (/^[^,]+,\s*[^,]+$/.test(s)) s = flipName(s);
  const w = s.split(/\s+/).filter(Boolean);
  if (w.length < 1 || w.length > 4) return false;
  return w.every(x => /^\p{Lu}[\p{L}'’.-]*$/u.test(x) || NAME_PART.test(x)) && w.some(x => x.length > 2);
}
const authorName = s => { s = String(s || "").trim(); return /^[^,]+,\s*[^,]+$/.test(s) ? flipName(s) : s; };

// Eine Freitext-Zeile zerlegen. Unklar → ganze Zeile als Suchtext (lieber breiter suchen als falsch zerlegen)
function parseLine(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:[-–—•*·▪►☐☑✓✔]\s*|\(?\d{1,4}[.)]\s+|\d{1,4}\s*[.)]\s*(?=\p{L}))/u, "").trim(); // Aufzählung, Nummer
  const it = { line: String(raw || "").trim(), title: "", author: "", publisher: "", year: "", isbn: "", volume: "", series: "", tags: [] };
  // ISBN
  const isbn = isbnsIn(s)[0];
  if (isbn) { it.isbn = isbn; s = s.replace(/\b(?:ISBN|EAN)(?:-1[03])?:?\s*/gi, "").replace(/(?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dXx]/, " ").replace(/\s+/g, " ").replace(/[\s,;·|–-]+$/, "").replace(/^[\s,;·|–-]+/, "").trim(); }
  // Klammer am Ende: „(dtv, 1998)“ → Verlag/Jahr, „(Michael Ende)“ → Autor
  const par = s.match(/\(([^()]{1,60})\)\s*$/);
  if (par) {
    const inner = par[1].trim(), y = inner.match(/\b(1[4-9]|20)\d\d\b/);
    if (y) { it.year = y[0]; it.publisher = inner.replace(y[0], "").replace(/^[\s,;:]+|[\s,;:]+$/g, "").trim(); s = s.slice(0, par.index).trim(); }
    else if (nameLike(inner)) { it.author = authorName(inner); s = s.slice(0, par.index).trim(); }
  }
  // Jahr am Ende „…, 1998“
  if (!it.year) { const y = s.match(/[,;]\s*((?:1[4-9]|20)\d\d)\s*$/); if (y) { it.year = y[1]; s = s.slice(0, y.index).trim(); } }
  // Band: „Bd. 27“, „Band 3“, „#3“, „Teil 2“, „Vol. 4“
  const v = s.match(/(?:^|[\s,;(·–-])(?:Bd\.?|Band|Teil|Vol\.?|Volume|Nr\.?|#)\s*(\d{1,3})\b\.?\)?/i);
  if (v) { it.volume = String(+v[1]); s = (s.slice(0, v.index) + " " + s.slice(v.index + v[0].length)).replace(/\s+/g, " ").replace(/[\s,;·–-]+$/, "").trim(); }
  s = s.replace(/^["„“'»«]+|["„“'»«]+$/g, "").trim();
  if (!it.author) {
    let m;
    // „A – B“: sieht B wie ein Name aus, ist es „Titel – Autor“ (auch wenn A ein einzelnes Wort wie „Momo“ ist); sonst „Autor – Titel“
    if ((m = s.match(/^(.+?)\s+[–—-]\s+(.+)$/)) && nameLike(m[2]) && m[2].trim().split(/\s+/).length >= 2 - /,/.test(m[2])) { it.title = m[1]; it.author = authorName(m[2]); } // Titel – Autor
    else if (m && nameLike(m[1]) && !nameLike(m[2])) { it.author = authorName(m[1]); it.title = m[2]; }                                        // Autor – Titel
    else if ((m = s.match(/^([^:]{3,45}):\s+(.+)$/)) && nameLike(m[1]) && (/,/.test(m[1]) || m[1].trim().split(/\s+/).length >= 2)) { it.author = authorName(m[1]); it.title = m[2]; } // Autor: Titel / Nachname, Vorname: Titel
    else if ((m = s.match(/^(.+?)\s+von\s+(.+)$/i)) && nameLike(m[2])) { it.title = m[1]; it.author = authorName(m[2]); }                       // Titel von Autor
    else it.title = s;                                                                                                                         // unklar: ganze Zeile
  } else it.title = s;
  it.title = it.title.replace(/^["„“'»«]+|["„“'»«]+$/g, "").replace(/[\s,;:·–-]+$/, "").trim();
  return it;
}
// Tabellenzeile → Eintrag
function itemFromCells(cells, map) {
  const it = { line: cells.map(tlCell).filter(Boolean).join(" · "), title: "", author: "", publisher: "", year: "", isbn: "", volume: "", series: "", tags: [] };
  map.forEach((f, i) => {
    const v = tlCell(cells[i]); if (!f || !v) return;
    if (f === "isbn") it.isbn = isbnsIn(v)[0] || "";
    else if (f === "tags") it.tags = normTags(v.split(/[,;|]/));
    else if (f === "volume") { const d = v.match(/\d{1,3}/); it.volume = d ? String(+d[0]) : ""; }
    else if (f === "year") it.year = (v.match(/\b(1[4-9]|20)\d\d\b/) || [""])[0];
    else if (f === "author") it.author = authorName(v);
    else it[f] = v;
  });
  if (!it.title && it.series) it.title = it.series;
  return it;
}
/* Text → { items: [{ line, title, author, publisher, year, isbn, volume, series, tags }], table: { sep, header, map, cols } | null }.
   map (optional) überschreibt die Zuordnung der Spalten. */
function parseTitleList(text, map) {
  text = String(text || "").replace(/^﻿/, "");
  const t = detectTable(text);
  if (t) {
    const m = map || t.map;
    const rows = t.header ? t.rows.slice(1) : t.rows;
    const items = rows.map(r => itemFromCells(r, m)).filter(it => it.title || it.isbn || it.author);
    return { items, table: { sep: t.sep, header: t.header, map: m, cols: Math.max(...t.rows.map(r => r.length)), head: t.header ? t.rows[0].map(tlCell) : null, sample: rows[0] ? rows[0].map(tlCell) : [] } };
  }
  const items = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && /[\p{L}\d]/u.test(l)).map(parseLine).filter(it => it.title || it.isbn);
  return { items, table: null };
}

/* ================= Gemerkter Lauf ================= */
// { text, map, items (ohne Treffer-Bücher/Blobs), opts, step: "preview" | "search" | "review", at }
let tlSaveT = null;
const tlClean = it => { const { dup, reasons, ...rest } = it; return rest; };
async function tlSave(run, now) {
  if (!run) return;
  const go = () => DB.setMeta("titleListRun", { ...run, items: run.items.map(tlClean), at: new Date().toISOString() }).catch(() => {});
  clearTimeout(tlSaveT);
  if (now) return go();
  tlSaveT = setTimeout(go, 400);
}
async function tlLoad() { try { const r = await DB.getMeta("titleListRun"); return r && Array.isArray(r.items) ? r : null; } catch { return null; } }
async function tlDrop() { clearTimeout(tlSaveT); S.titleRun = null; await DB.setMeta("titleListRun", null).catch(() => {}); document.querySelector(".tlresume")?.remove(); }

/* ================= Eingabe ================= */
function openTitleList(prefill) {
  const sh = sheet("📋 Titelliste einfügen");
  const ta = el("textarea", { class: "field tltext", rows: 10, placeholder: "Eine Zeile pro Buch, z. B.\nMomo – Michael Ende\nPreußler, Otfried: Krabat\nWeihnachtsgeschichten am Kamin Bd. 27\n978-3-423-12345-6\n\n… oder Spalten aus Excel einfügen" });
  ta.value = prefill || "";
  const readFile = async f => {
    const buf = await f.arrayBuffer();
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf); // alte Excel-CSV
    ta.value = t; toast(`„${f.name}“ eingelesen.`, 1800);
  };
  const fileIn = el("input", { type: "file", accept: ".txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values", class: "hidden" });
  fileIn.addEventListener("change", () => { if (fileIn.files[0]) readFile(fileIn.files[0]); });
  if (!isMobile()) {
    ta.addEventListener("dragover", e => { e.preventDefault(); ta.classList.add("hot"); });
    ta.addEventListener("dragleave", () => ta.classList.remove("hot"));
    ta.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); ta.classList.remove("hot"); readFile(f); });
  }
  const go = () => {
    const text = ta.value;
    if (!text.trim()) { toast("Bitte zuerst eine Liste einfügen."); return; }
    const { items, table } = parseTitleList(text);
    if (!items.length) { toast("In diesem Text habe ich keine Bücher gefunden."); return; }
    const run = { text, map: table ? table.map : null, items, opts: { wish: !!S.addAsWish, status: "unread", tags: ["Liste-Import"], fachKey: "" }, step: "preview" };
    S.titleRun = run; tlSave(run, true);
    tlPreview(run);
  };
  fillNode(sh.body,
    el("p", { class: "saved", style: "margin-top:0", text: "Füge eine Liste ein – aus einer Notiz, einer Mail oder einer Tabelle. Die App sucht jedes Buch in den Katalogen und zeigt dir danach eine Prüfliste. Nur unsichere Treffer brauchen deine Aufmerksamkeit." }),
    ta,
    el("div", { class: "covertools" },
      navigator.clipboard?.readText ? el("button", { class: "btn sm", type: "button", onclick: async () => { try { ta.value = await navigator.clipboard.readText(); } catch { toast("Zugriff auf die Zwischenablage nicht erlaubt – bitte ins Feld tippen und „Einfügen“ wählen."); } } }, "📋 Aus Zwischenablage") : null,
      el("button", { class: "btn sm", type: "button", onclick: () => fileIn.click() }, "📄 Datei wählen (.txt, .csv)"), fileIn),
    el("div", { class: "note info", style: "margin-top:10px" }, el("b", { text: "Aus Excel: " }), "Spalten markieren (z. B. Titel und Autor, gern mit Überschrift), kopieren und hier einfügen. Eine Excel-Datei selbst kann die App nicht öffnen – als CSV speichern geht auch."),
    el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: () => openAdd() }, "← Zurück"), el("button", { class: "btn primary", onclick: go }, "Weiter: Liste prüfen")));
}

/* ================= Vorschau vor der Suche ================= */
function tlPreview(run) {
  const sh = openSheet && openSheet.h2 ? openSheet : sheet("📋 Titelliste");
  sh.h2.textContent = "📋 Titelliste – erkannte Bücher";
  sh.redraw = null; sh.guard = null;
  const t = parseTitleList(run.text, run.map || undefined).table;
  const listBox = el("div", { class: "tlprev" });
  const count = el("div", { class: "note info" });
  const draw = () => {
    count.textContent = `${run.items.length} ${run.items.length === 1 ? "Buch" : "Bücher"} erkannt. Stimmt die Aufteilung? Felder lassen sich ändern, × entfernt eine Zeile.`;
    fillNode(listBox, ...run.items.map((it, i) => {
      const inp = (k, ph, cls = "") => { const x = el("input", { class: "field " + cls, value: it[k] || "", placeholder: ph }); x.addEventListener("input", () => { it[k] = x.value.trim(); tlSave(run); }); return x; };
      return el("div", { class: "tlrow" },
        el("div", { class: "tlline", text: it.line }),
        el("div", { class: "tlfields" }, inp("title", "Titel"), inp("author", "Autor"), inp("isbn", "ISBN", "sm"), inp("volume", "Band", "xs")),
        el("button", { class: "btn sm ghost danger tldel", type: "button", title: "Zeile entfernen", onclick: () => { run.items.splice(i, 1); tlSave(run); draw(); } }, "×"));
    }));
  };
  // Tabelle: Spalten-Zuordnung korrigieren
  const colBox = t ? el("div", { class: "tlcols" }, el("div", { class: "lbl", text: t.header ? "Spalten (aus der Überschrift erkannt)" : "Spalten (geraten – bitte prüfen)" }),
    el("div", { class: "tlcolgrid" }, ...Array.from({ length: t.cols }, (_, c) => {
      const sel = el("select", { class: "field" }, ...TL_FIELDS.map(([v, l]) => el("option", { value: v, selected: (t.map[c] || "") === v || null }, l)));
      sel.addEventListener("change", () => {
        const map = [...t.map]; map[c] = sel.value; run.map = map; t.map = map;
        run.items = parseTitleList(run.text, map).items; tlSave(run); draw();
      });
      return el("label", { class: "tlcol" }, el("span", { class: "saved", text: (t.head ? t.head[c] : t.sample[c]) || `Spalte ${c + 1}` }), sel);
    }))) : null;
  draw();
  fillNode(sh.body, count, colBox, listBox,
    el("div", { class: "actions sticky" },
      el("button", { class: "btn ghost", onclick: () => { tlDrop(); openTitleList(run.text); } }, "← Text ändern"),
      el("button", { class: "btn primary", onclick: () => { if (!run.items.length) { toast("Die Liste ist leer."); return; } tlSearch(run); } }, `🔎 ${run.items.length} ${run.items.length === 1 ? "Buch" : "Bücher"} suchen`)));
  sh.body.parentElement.scrollTop = 0;
}

/* ================= Suchen (schonend, mit Fortschritt, anhaltbar, gemerkt) ================= */
async function tlSearch(run) {
  const sh = openSheet || sheet("📋 Titelliste");
  sh.h2.textContent = "📋 Bücher werden gesucht";
  sh.redraw = null;
  for (const it of run.items) { it.kind = "book"; if (it.include === undefined) it.include = true; if (!it.cands) it.cands = []; if (it.choice === undefined) it.choice = -1; }
  run.step = "search"; tlSave(run, true);
  const todo = run.items.filter(it => !it.searched);
  const bar = el("div", { class: "progress" }, el("div", {}));
  const status = el("div", { class: "saved" });
  let stop = false, done = run.items.length - todo.length;
  const stopBtn = el("button", { class: "btn", onclick: () => { stop = true; stopBtn.disabled = true; stopBtn.textContent = "Wird angehalten …"; } }, "Anhalten");
  fillNode(sh.body, el("p", { style: "margin-top:0", text: "Die App sucht jedes Buch in DNB, Bibliotheksverbund, Google Books und Open Library. Das dauert je Buch ein paar Sekunden – du kannst die App dabei auch schließen, sie macht später weiter." }),
    bar, status, el("div", { class: "actions" }, stopBtn, el("span")));
  const show = () => { bar.firstChild.style.width = Math.round(done / run.items.length * 100) + "%"; status.textContent = `Suche ${Math.min(done + 1, run.items.length)} von ${run.items.length} …`; };
  show();
  const queue = [...todo];
  const R = todo.length ? recRun("titelliste", { zeilen: run.items.length, zuSuchen: todo.length }) : null;
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length && !stop) {
      const it = queue.shift(), log = [];
      try { it.cands = await matchItem(it, log); it.offline = false; } catch { it.cands = []; it.offline = true; }
      it.choice = autoChoice(it); it.searched = true; done++;
      recBook(R, it, log);
      if (openSheet === sh) show();
      tlSave(run);
    }
  }));
  if (openSheet !== sh) return; // inzwischen geschlossen – Lauf ist gemerkt
  for (const it of run.items) if (!it.searched) it.offline = true; // angehalten: nur eigene Angaben (später „🔎 Neu suchen“)
  resolveCollisions(run.items);
  for (const it of run.items) if (!it.reviewed) { const d = scanDup(it); if (d && !isWish(d)) it.include = false; it.reviewed = true; } // schon vorhanden → standardmäßig überspringen
  run.step = "review"; await tlSave(run, true);
  tlReview(run);
}

/* ================= Prüfliste (dieselbe wie beim Fach-Foto, ohne Foto) ================= */
function tlReview(run) {
  const sh = openSheet || sheet("📋 Titelliste prüfen");
  sh.redraw = null;
  const o = run.opts;
  const fachs = fachOptions();
  const wishSeg = el("div", { class: "seg" });
  const drawWish = () => wishSeg.replaceChildren(
    el("button", { type: "button", class: o.wish ? "" : "on", onclick: () => { o.wish = false; drawWish(); tlSave(run); } }, "📚 In meinen Bestand"),
    el("button", { type: "button", class: o.wish ? "on" : "", onclick: () => { o.wish = true; drawWish(); tlSave(run); } }, "⭐ Auf die Wunschliste"));
  drawWish();
  const stSel = el("select", { class: "field" }, ...Object.entries(STATUS).map(([v, l]) => el("option", { value: v, selected: v === o.status || null }, l)));
  stSel.addEventListener("change", () => { o.status = stSel.value; tlSave(run); });
  const fachSel = el("select", { class: "field" }, el("option", { value: "" }, "nicht einsortieren"), ...fachs.map(f => el("option", { value: f.key, selected: f.key === o.fachKey || null }, f.label)));
  fachSel.addEventListener("change", () => { o.fachKey = fachSel.value; tlSave(run); });
  const tagsObj = { tags: o.tags || [] };
  const options = el("div", { class: "scanopts" }, wishSeg,
    el("div", { class: "fgrid", style: "margin-top:10px" },
      el("div", { class: "c3" }, el("label", { class: "lbl", text: "Lesestatus für neue Bücher" }), stSel),
      el("div", { class: "c3" }, el("label", { class: "lbl", text: "Ziel-Fach (in Listenreihenfolge ans Ende)" }), fachSel),
      el("div", { class: "c6" }, el("label", { class: "lbl", text: "Schlagworte für alle (Schlagworte aus der Liste kommen dazu)" }), tagEditor(tagsObj, () => { o.tags = tagsObj.tags; tlSave(run); }))));
  const thumb = it => {
    const c = it.cands[it.choice]; const urls = c ? [c.coverUrl, ...(c.altCovers || [])].filter((v, i, a) => v && a.indexOf(v) === i) : [];
    if (!urls.length) return el("span", { class: "tlnocov", text: "📕" });
    let k = 0; const img = el("img", { src: urls[0], alt: "", referrerpolicy: "no-referrer", loading: "lazy" });
    img.onerror = () => { if (++k < urls.length) img.src = urls[k]; else img.replaceWith(el("span", { class: "tlnocov", text: "📕" })); };
    img.addEventListener("load", () => { if (placeholderImg(img)) img.onerror(); });
    return img;
  };
  const rowExtra = (it, ctx) => {
    const linkIn = el("input", { class: "field", placeholder: "Link oder ISBN einfügen (ZVAB, booklooker …)" });
    const take = async () => {
      const r = await bookFromWeb(linkIn.value).catch(() => null);
      if (!r) { toast("Darin habe ich keine ISBN und keinen Buchtitel gefunden."); return; }
      let cand = null;
      try {
        if (r.isbn) cand = await lookupIsbn(r.isbn).then(x => x && { ...x, isbn: r.isbn }) || { title: it.title, author: it.author, isbn: r.isbn };
        else if (r.rec) cand = r.rec;
        else if (r.query) { const l = await searchBooks(r.query); cand = l[0] || null; }
      } catch { toast("Keine Internetverbindung."); return; }
      if (!cand) { toast("Dazu wurde nichts gefunden."); return; }
      it.cands = [{ ...cand, _score: 99 }, ...it.cands.filter(c => !cand.isbn || c.isbn !== cand.isbn)];
      it.choice = 0; it.confirmed = true; linkIn.value = ""; ctx.update(); toast("Übernommen: " + cand.title, 2000);
    };
    linkIn.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); take(); } });
    linkIn.addEventListener("paste", () => setTimeout(take, 30));
    const skip = el("button", { class: "btn sm ghost", type: "button", onclick: () => ctx.setInclude(!it.include) }, "überspringen");
    const more = el("details", { class: "tlmore" }, el("summary", { text: "Im Internet suchen / Link einfügen" }),
      webSearchLinks([it.title, it.author].filter(Boolean).join(" "), it.isbn, it.title, it.author),
      el("div", { class: "manual", style: "margin-top:6px" }, linkIn, el("button", { class: "btn sm", type: "button", onclick: take }, "Übernehmen")));
    return { top: el("div", { class: "tlline", text: it.line }), bottom: el("div", {}, el("div", { class: "covertools" }, skip), more) };
  };
  scanReview(sh, {
    items: run.items, words: SCAN_WORDS.list, title: "📋 Titelliste prüfen",
    intro: `${run.items.length} ${run.items.length === 1 ? "Buch" : "Bücher"} aus deiner Liste. Ohne Markierung = sicher gefunden, gelb = bitte prüfen. Bücher, die du schon hast, sind nicht angehakt.`,
    options, thumb, rowExtra,
    dupText: it => isWish(it.dup) ? `⭐ Steht auf deiner Wunschliste („${it.dup.title}“) – wird als gekauft übernommen.`
      : `Schon vorhanden („${it.dup.title}“) – ${it.include ? "wird als weiteres Exemplar angelegt." : "wird übersprungen. Haken setzen = weiteres Exemplar."}`,
    onChange: () => tlSave(run),
    onImport: () => tlImport(run),
    back: { label: "Später weiter", fn: () => { tlSave(run, true); closeSheet(); tlResumeHint(); } },
  });
  sh.guard = null; // der Lauf ist gemerkt – Schließen verliert nichts
}

/* ================= Übernehmen ================= */
async function tlImport(run) {
  const sh = openSheet; const o = run.opts;
  const chosen = run.items.filter(it => it.include);
  const msg = busyView("Bücher werden übernommen", null, `0 / ${chosen.length}`);
  if (sh) sh.guard = null;
  let created = 0, bought = 0, n = 0; const placed = [], newIds = [], used = new Map();
  const tags = normTags(o.tags || []);
  for (const it of chosen) {
    const c = it.cands[it.choice];
    const k = itemKey(it);
    let dup = scanDup(it);
    if (dup && isWish(dup)) {
      if (!o.wish) { await wishBought(dup.id); if ((tags.length || it.tags?.length)) await patchBook(dup.id, { tags: normTags([...(dup.tags || []), ...tags, ...(it.tags || [])]) }); bought++; placed.push(dup.id); }
      msg.textContent = `${++n} / ${chosen.length}`; continue; // als Wunsch erfasst und steht schon auf der Wunschliste → kein Doppel
    }
    const copyOf = dup ? dup.id : used.get(k) || null; // bewusst angehakt bzw. zweimal in der Liste → weiteres Exemplar
    const b = await bookFromItem(it, c, { status: o.status, tags: [...tags, ...(it.tags || [])], source: "liste", copyOf });
    if (o.wish) b.wish = true;
    await putBook(b); created++; newIds.push(b.id); used.set(k, b.id);
    if (!o.wish) placed.push(b.id);
    msg.textContent = `${++n} / ${chosen.length}`;
  }
  const fach = o.fachKey && fachOptions().find(f => f.key === o.fachKey);
  if (fach && placed.length) await placeBooks(placed, fach.m, fach.k);
  await tlDrop();
  closeSheet(); renderAll();
  const skipped = run.items.length - created - bought;
  toast(`${created + bought} ${created + bought === 1 ? "Buch" : "Bücher"} übernommen${bought ? ` (davon ${bought} von der Wunschliste gekauft)` : ""}, ${skipped} übersprungen.`, 5000);
  const noCov = newIds.filter(id => { const b = S.books.find(x => x.id === id); return b && needsCover(b); });
  if (noCov.length && await confirmBox(`${noCov.length} der neuen Bücher ${noCov.length === 1 ? "hat" : "haben"} noch kein Cover.\nJetzt online nachtragen? (Eindeutige Treffer werden übernommen, sonst wird gefragt.)`, "Cover suchen")) coverRun(noCov);
}

/* ================= Weitermachen nach einem Neustart ================= */
async function resumeTitleList() {
  const run = S.titleRun || await tlLoad(); if (!run) return;
  S.titleRun = run;
  document.querySelector(".tlresume")?.remove();
  sheet("📋 Titelliste");
  if (run.step === "preview") tlPreview(run);
  else if (run.step === "search") tlSearch(run);
  else tlReview(run);
}
function tlResumeHint() {
  const run = S.titleRun; if (!run || document.querySelector(".tlresume")) return;
  const n = run.items.length;
  resumeBar("titleList", `📋 Angefangene Titelliste (${n} ${n === 1 ? "Buch" : "Bücher"})`, resumeTitleList,
    async () => { await tlDrop(); toast("Titelliste verworfen."); },
    { goLabel: "Titelliste weiter prüfen", cls: "tlresume", ask: "Die angefangene Titelliste verwerfen?\nBereits übernommene Bücher bleiben natürlich." });
}
(async () => {
  await new Promise(r => { const t = setInterval(() => { if (S.loaded && scriptsReady()) { clearInterval(t); r(); } }, 50); });
  const run = await tlLoad();
  if (run) { S.titleRun = run; tlResumeHint(); }
})();
