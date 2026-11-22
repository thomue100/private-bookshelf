/* Mein Bücherregal – Buchmaße nachtragen (Bereinigungslauf): Höhe, Dicke und Rückenbild für Bücher, denen sie fehlen.
   Quellen in dieser Reihenfolge: 1. gespeicherte Fach-Fotos (das eigene Exemplar, kostet nichts), 2. DNB (Format „21 cm“),
   3. Google Books (Höhe und Dicke, nur im einzelnen Datensatz). Vorhandene Werte werden nie überschrieben. */
"use strict";

/* ---------- Google Books: Maße ---------- */
// „24.00 cm“, „9.5 mm“, selten „8.5 in“ → cm (eine Nachkommastelle) oder 0
function dimCm(s) {
  const m = String(s || "").match(/(\d+(?:[.,]\d+)?)\s*(cm|mm|in|inch|inches|")?/i); if (!m) return 0;
  let v = parseFloat(m[1].replace(",", ".")); const u = (m[2] || "cm").toLowerCase();
  if (u === "mm") v /= 10; else if (u !== "cm") v *= 2.54;
  return isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0;
}
// Maße stehen nicht in der Suche, nur im einzelnen Datensatz (volumes/<id>). Ergebnis {heightCm?, thickCm?} – Unplausibles fällt weg.
async function googleDims(isbn) {
  const j = await gJSON("isbn:" + isbn, "&maxResults=3");
  const items = (j.items || []).filter(it => it.id && (!(it.volumeInfo?.industryIdentifiers || []).length || fromGoogle(it).isbn === isbn));
  for (const it of items.slice(0, 2)) {
    const v = await catFetch("Google Books", "gv|" + it.id, () => getJSON(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(it.id)}?fields=volumeInfo(dimensions)${gKey()}`));
    const d = v?.volumeInfo?.dimensions; if (!d) continue;
    const h = dimCm(d.height), t = dimCm(d.thickness), out = {};
    if (h >= 8 && h <= 33) out.heightCm = h;
    if (t >= 0.3 && t <= 15) out.thickCm = t;
    if (Object.keys(out).length) return out;
  }
  return {};
}

/* ---------- Gespeicherte Fach-Fotos: erkannte Rücken den Büchern zuordnen ---------- */
// Nur, wo die Zuordnung eindeutig ist: Bücher im Fach des Fotos (ohne Fach: ganze Bibliothek, aber strenger), Titel passt klar, Band passt.
// Ergebnis: Map bookId → {p, it, comp, heightCm?, thickCm?, look} (neuestes Foto gewinnt)
function photoMeasures() {
  const out = new Map();
  const fachs = typeof fachOptions === "function" ? fachOptions() : [];
  const photos = S.photos.filter(p => !p.deletedAt && p.blob && p.scan?.items?.length).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  for (const p of photos) {
    const grouped = !!p.partOf || S.photos.some(x => x.partOf === p.id && !x.deletedAt); // Teil eines Fachs → Breite stimmt nicht, nur Höhe
    const f = p.fachKey && fachs.find(x => x.key === p.fachKey);
    const pool = f ? [...new Set(["front", "back", "top"].flatMap(l => layerList(f.m, f.k, l)))].map(id => S.books.find(b => b.id === id)).filter(Boolean)
      : S.books.filter(b => !isWish(b));
    const need = f ? 0.6 : 0.9;
    const comp = p.scan.compartment || { x0: 0, y0: 0, x1: 1, y1: 1 };
    const used = new Set();
    for (const it of p.scan.items) {
      if (it.kind === "other" || !(it.title || "").trim() || !it.bbox) continue;
      const iv = itemVol(it);
      const scored = pool.filter(b => !used.has(b.id) && !(iv && hitVol(b) && hitVol(b) !== iv))
        .map(b => ({ b, s: overlap(it.title, b.title) + (it.author && b.author ? (overlap(it.author, b.author) > 0 ? 0.2 : -0.5) : 0) }))
        .sort((x, y) => y.s - x.s);
      const best = scored[0];
      if (!best || best.s < need || (scored[1] && scored[1].s > best.s - 0.15)) continue;
      used.add(best.b.id);
      const { sp } = spineFromScan(it, comp, null);
      const m = { p, it, comp, look: sp };
      if (sp.heightCm) m.heightCm = sp.heightCm;
      if (!grouped && sp.thickCm) m.thickCm = sp.thickCm;
      out.set(best.b.id, m);
    }
  }
  return out;
}
// Rückenbild aus dem Fach-Foto schneiden (wie beim Übernehmen) – Fotos werden je Lauf nur einmal geladen
async function spineImageFrom(m, cache) {
  try {
    if (!cache.has(m.p.id)) cache.set(m.p.id, toCanvas(await loadImage(m.p.blob), Infinity));
    const src = cache.get(m.p.id);
    const c = m.it.quad ? spineCanvas(src, m.it, { turn: false, max: SPINE_MAX }) : cropSpine(src, m.it, m.comp, SPINE_MAX);
    return c ? await canvasBlob(c, .85) : null;
  } catch { return null; }
}

/* ---------- Erfolglose Katalogabfragen merken (Meta „measureMiss“, nur dieses Gerät) ---------- */
const MEASURE_MISS_DAYS = 60;
const measureSig = b => toIsbn13(b.isbn) || "";
async function measureMisses() { if (!S.measureMiss) { try { S.measureMiss = (await DB.getMeta("measureMiss")) || {}; } catch { S.measureMiss = {}; } } return S.measureMiss; }
const recentMeasureMiss = b => { const e = S.measureMiss?.[b.id]; return !!e && e.sig === measureSig(b) && Date.now() - Date.parse(e.at) < MEASURE_MISS_DAYS * 864e5; };

/* ---------- Der Lauf ---------- */
const lacksMeasures = b => !+b.spine?.heightCm || !+b.spine?.thickCm;
// Bücher, denen Höhe oder Dicke fehlt – oder ein Rückenbild, das ein Fach-Foto liefern kann
function measureTargets(pm, retry) {
  return S.books.filter(b => !isWish(b) && !isGone(b) && (
    (lacksMeasures(b) && (pm.has(b.id) || (toIsbn13(b.isbn) && (retry || !recentMeasureMiss(b))))) ||
    (!b.spine?.imageBlob && pm.has(b.id))));
}
async function measureRun({ retry = false } = {}) {
  await measureMisses();
  const pm = photoMeasures();
  const ids = measureTargets(pm, retry).map(b => b.id);
  const skipped = retry ? 0 : S.books.filter(b => !isWish(b) && !isGone(b) && lacksMeasures(b) && toIsbn13(b.isbn) && !pm.has(b.id) && recentMeasureMiss(b)).length;
  const missing = S.books.filter(b => !isWish(b) && !isGone(b) && lacksMeasures(b)).length;
  const sh = sheet("📏 Maße nachtragen");
  const retryBtn = skipped ? el("button", { class: "btn sm ghost", onclick: () => { closeSheet(); measureRun({ retry: true }); } }, "Trotzdem neu fragen") : null;
  const skipNote = skipped ? el("div", { class: "note" }, el("div", { text: `${skipped} ${skipped === 1 ? "Buch wird" : "Bücher werden"} übersprungen: Die Kataloge hatten in den letzten ${MEASURE_MISS_DAYS} Tagen keine Maße dafür.` }), el("div", { class: "covertools mt-2" }, retryBtn)) : null;
  if (!ids.length) {
    fillNode(sh.body, el("p", { style: "margin-top:0", text: missing ? `Für die ${missing} Bücher ohne vollständige Maße gibt es gerade keine Quelle: keine ISBN und kein erkanntes Fach-Foto. Fotografier das Fach, oder trag die Maße beim Buchrücken selbst ein.` : "Alle Bücher haben Höhe und Dicke." }),
      skipNote, el("div", { class: "actions" }, el("span"), el("button", { class: "btn primary", onclick: closeSheet }, "Schließen")));
    return;
  }
  const bar = el("div", { class: "progress" }, el("div", {}));
  const status = el("div", { class: "saved" });
  const log = el("div", { class: "covlog" });
  let stop = false, nH = 0, nT = 0, nI = 0, none = 0, changed = 0;
  const stopBtn = el("button", { class: "btn", onclick: () => { stop = true; stopBtn.disabled = true; stopBtn.textContent = "Wird beendet …"; } }, "Anhalten");
  fillNode(sh.body,
    el("p", { style: "margin-top:0", text: `${ids.length} ${ids.length === 1 ? "Buch" : "Bücher"} mit fehlender Höhe, Dicke oder fehlendem Rückenbild. Die App nimmt zuerst deine Fach-Fotos, dann die Deutsche Nationalbibliothek und Google Books. Vorhandene Werte bleiben unverändert.` }),
    skipNote, bar, status, log, el("div", { class: "actions" }, stopBtn, el("span")));
  sh.guard = async () => { stop = true; return true; };
  const row = (b, txt, cls) => log.prepend(el("div", { class: "covrow " + (cls || "") }, el("span", { text: txt }), el("b", { text: b.title || "Ohne Titel" })));
  const fmt = v => String(v).replace(".", ",");
  const canvases = new Map();
  for (let i = 0; i < ids.length && !stop; i++) {
    let b = S.books.find(x => x.id === ids[i]); if (!b) continue;
    bar.firstChild.style.width = Math.round(i / ids.length * 100) + "%";
    status.textContent = `${i + 1} / ${ids.length}: „${b.title}“`;
    const sp = { ...(b.spine || {}) }, got = [];
    const take = (k, v, label) => { if (v && !+sp[k]) { sp[k] = v; got.push(label + " " + fmt(v) + " cm"); if (k === "heightCm") nH++; else nT++; } };
    // 1) Fach-Foto
    const m = pm.get(b.id);
    if (m) {
      take("heightCm", m.heightCm, "Höhe"); take("thickCm", m.thickCm, "Dicke");
      if (!sp.imageBlob) { const blob = await spineImageFrom(m, canvases); if (blob) { sp.imageBlob = blob; got.push("Rückenbild"); nI++; } }
      for (const k of ["color", "fg"]) if (!sp[k] && m.look[k]) sp[k] = m.look[k];
      if (!sp.text && !sp.quer && m.look.text) sp.text = m.look.text;
    }
    // 2) + 3) Kataloge – nur mit ISBN, nur was noch fehlt
    const isbn = toIsbn13(b.isbn);
    let asked = false, failed = false; // failed: eine Quelle war nicht erreichbar oder pausiert → nicht als „keine Maße“ merken
    if (isbn && (!+sp.heightCm || !+sp.thickCm) && (retry || !recentMeasureMiss(b))) {
      if (!+sp.heightCm) {
        asked = true;
        try { const recs = await dnbQuery(`num=${isbn}`, 3); const rec = recs.find(r => r.isbn === isbn) || recs[0]; take("heightCm", +rec?.heightCm || 0, "Höhe"); }
        catch { failed = true; }
      }
      if (!+sp.heightCm || !+sp.thickCm) {
        asked = true;
        try { const d = await googleDims(isbn); take("heightCm", d.heightCm, "Höhe"); take("thickCm", d.thickCm, "Dicke"); }
        catch { failed = true; }
      }
      if (asked && !failed) {
        if (!+sp.heightCm || !+sp.thickCm) S.measureMiss[b.id] = { at: new Date().toISOString(), sig: measureSig(b) };
        else delete S.measureMiss[b.id];
      }
    }
    const cur = S.books.find(x => x.id === b.id); // kann sich inzwischen geändert haben
    if (got.length && cur) {
      const merged = { ...(cur.spine || {}) };
      for (const [k, v] of Object.entries(sp)) if (merged[k] === undefined || merged[k] === "" || merged[k] === null || ((k === "heightCm" || k === "thickCm") && !+merged[k])) merged[k] = v;
      await patchBook(b.id, { spine: merged }); changed++;
      row(b, "✓ " + got.join(", "), "ok");
    } else if (failed) row(b, "⚠ Kataloge nicht erreichbar", "warn");
    else { none++; row(b, "– keine Angabe", "none"); }
    if (asked && !stop && i < ids.length - 1) await new Promise(r => setTimeout(r, S.heightPause ?? 400)); // schonend
  }
  canvases.forEach(c => { c.width = c.height = 0; });
  try { await DB.setMeta("measureMiss", S.measureMiss); } catch {}
  bar.firstChild.style.width = "100%";
  sh.guard = null;
  status.textContent = `Fertig: ${changed} ${changed === 1 ? "Buch" : "Bücher"} ergänzt (Höhe ${nH}, Dicke ${nT}, Rückenbild ${nI}), ${none} ohne Angabe.` + (stop ? " (angehalten)" : "");
  sh.body.querySelector(".actions").replaceWith(el("div", { class: "actions" }, el("span"), el("button", { class: "btn primary", onclick: closeSheet }, "Schließen")));
  renderAll();
}
