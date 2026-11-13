/* Mein Bücherregal – Fach-Fotos einlesen: Buchrücken erkennen, Buchdaten suchen, Bücher anlegen und einsortieren. */
"use strict";

/* ================= Einstellungen: KI-Schlüssel ================= */
const AI_MODELS = [["claude-sonnet-5-5", "Claude Sonnet 5.5 (empfohlen)"], ["claude-opus-5-5", "Claude Opus 5.5 (am genauesten, teurer)"], ["claude-haiku-5-5", "Claude Haiku 5.5 (am günstigsten)"]];
function aiKey() { try { return localStorage.getItem("aiKey") || ""; } catch { return ""; } }
function aiModel() { try { return localStorage.getItem("aiModel") || AI_MODELS[0][0]; } catch { return AI_MODELS[0][0]; } }
function aiKeyBox() {
  const inp = el("input", { class: "field", type: "password", placeholder: "sk-ant-…", value: aiKey(), autocomplete: "off" });
  const sel = el("select", { class: "field", style: "width:100%" }, ...AI_MODELS.map(([v, l]) => el("option", { value: v, selected: aiModel() === v || null }, l)));
  const save = () => { try { const v = inp.value.trim(); if (v) localStorage.setItem("aiKey", v); else localStorage.removeItem("aiKey"); localStorage.setItem("aiModel", sel.value); toast(v ? "KI-Schlüssel gespeichert." : "KI-Schlüssel entfernt."); } catch { toast("Konnte nicht gespeichert werden."); } };
  return el("div", { class: "sec" }, el("h3", { text: "KI-Erkennung für Fach-Fotos (optional)" }),
    el("p", { class: "saved", text: "Mit einem eigenen Schlüssel für die Claude-API erkennt die App auf Fach-Fotos alle Buchrücken – auch gestaltete Schriften, liegende Bücher und Reihennummern. Abgerechnet wird pro Foto direkt über dein API-Konto bei Anthropic (in der Regel wenige Cent pro Foto). Der Schlüssel bleibt nur in diesem Browser und wird nicht mit exportiert. Ohne Schlüssel nutzt die App eine einfache Texterkennung." }),
    el("div", { style: "display:grid;gap:8px;margin-top:6px" }, inp, sel, el("button", { class: "btn", onclick: save }, "Speichern")),
    el("p", { class: "saved", style: "margin-top:6px" }, "Schlüssel bekommst du unter ", el("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener" }, "console.anthropic.com ↗"), ". Gib die App mit eingetragenem Schlüssel nicht an andere weiter – jede Person trägt ihren eigenen ein."));
}

/* ================= Erkennung per KI ================= */
const SCAN_PROMPT = `You are cataloguing a private home library. The photo shows ONE compartment of a bookshelf.
List every object in the compartment.

Order: first the standing row (and books lying flat inside the row) from LEFT to RIGHT; then objects lying ON TOP of the row from TOP to BOTTOM; then objects clearly visible BEHIND the front row from left to right.

Return ONLY a JSON object, no prose, no markdown:
{"compartment":{"x0":0,"y0":0,"x1":1,"y1":1},
 "items":[{"kind":"book","label":"","position":"standing","title":"","subtitle":"","author":"","publisher":"","series":"","volume":"","order_no":"","series_no":"","isbn":"",
   "spine_text_vertical":"","spine_text_horizontal":"","text_direction":"up","spine_color":"#rrggbb","text_color":"#rrggbb",
   "bbox":{"x0":0,"y0":0,"x1":0,"y1":0},"confidence":"high"}]}

Field rules:
- compartment: inner edges of the shelf compartment (side walls, shelf board, top board) as fractions 0–1 of image width/height.
- kind: "book" for books (also thin paperbacks and catalogues with a printed spine), "other" for CDs, maps, folders, brochures, magazines, boxes, decoration. For "other" give a short German label (e.g. "CDs", "Landkarten", "Prospekte").
- position: "standing" (upright in the row), "lying_in_row" (lying flat inside the row, spine facing out), "lying_on_top" (lying on top of other books), "behind" (in a second row behind).
- title/subtitle/author/publisher: as printed on the spine; use your knowledge to complete the author's full name or an obviously truncated title only if you are sure. Publisher logos like "dtv", "rororo", "Fischer", "S", "wbg/Theiss", "Koehler", "E&R" count as publisher. Never invent an ISBN – only if it is printed.
- volume: the volume number of a numbered series or anthology exactly as printed on the spine (e.g. "8" for "Weihnachtsgeschichten am Kamin 8", "3" for "Harry Potter 3"). Look carefully – neighbouring spines of the same series usually differ only in this number. Empty if there is none.
- series: name of that numbered series (for numbered anthologies the title itself, e.g. "Weihnachtsgeschichten am Kamin"); empty if there is no volume.
- order_no: a publisher's catalogue/order number printed on the spine, usually 4–6 digits (e.g. rororo "13427", dtv "13794"). Never put it into volume.
- series_no: repeat the volume if there is one, otherwise the order_no (kept for compatibility).
- Different volumes of the same series are different books: give each its own volume and never merge them.
- spine_text_vertical: the main text running along the spine exactly as printed; spine_text_horizontal: short horizontal text (publisher logo, number).
- text_direction: "up" (reads bottom to top, German style), "down" (top to bottom, English style) or "horizontal".
- spine_color/text_color: dominant spine background colour and main text colour.
- bbox: the visible spine area as fractions 0–1 of the image width/height (x0 left, x1 right, y0 top, y1 bottom). Be precise; adjacent spines must not overlap much.
- confidence: "high", "medium" or "low" (low for partly hidden or unreadable spines, or if title or volume are partly guessed). Do not guess silently – an honest "low" is better than a wrong title.
- Two copies of the same book are two items.`;

async function blobToBase64(blob) { const d = await blobToDataURL(blob); return d.slice(d.indexOf(",") + 1); }
function parseJSONLoose(text) {
  const t = String(text || "").replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Keine gültige Antwort der KI.");
  return JSON.parse(t.slice(a, b + 1));
}
async function aiScanShelf(jpegBlob, onStatus) {
  const key = aiKey(); if (!key) throw new Error("Kein KI-Schlüssel eingetragen.");
  onStatus && onStatus("KI erkennt die Buchrücken … (dauert meist 20–60 Sekunden)");
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 180000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: aiModel(), max_tokens: 12000, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(jpegBlob) } },
        { type: "text", text: SCAN_PROMPT }] }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || ("Fehler " + r.status);
      if (r.status === 401) throw new Error("Der KI-Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen.");
      if (r.status === 404 || /model/i.test(msg)) throw new Error("Das gewählte KI-Modell ist nicht verfügbar (" + msg + "). Bitte in den Einstellungen ein anderes wählen.");
      if (r.status === 429) throw new Error("Zu viele Anfragen – bitte kurz warten.");
      throw new Error(msg);
    }
    const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    const data = parseJSONLoose(text);
    if (!Array.isArray(data.items)) throw new Error("Die KI hat keine Liste geliefert.");
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Die KI hat zu lange gebraucht.");
    if (e instanceof TypeError) throw new Error("Keine Verbindung zur KI (Internet prüfen).");
    throw e;
  } finally { clearTimeout(tm); }
}

/* ================= Erkennung ohne KI (Texterkennung, ungenau) ================= */
function rotateCanvas(src, deg) {
  const c = document.createElement("canvas"); c.width = src.height; c.height = src.width;
  const x = c.getContext("2d"); x.translate(c.width / 2, c.height / 2); x.rotate(deg * Math.PI / 180); x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}
async function ocrScanShelf(canvas, onStatus) {
  if (!window.Tesseract) { onStatus && onStatus("Lade Texterkennung …"); await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"); }
  if (!ocrWorker) ocrWorker = await Tesseract.createWorker(["deu", "eng"], 1);
  const W = canvas.width, H = canvas.height, found = [];
  for (const [deg, dir] of [[90, "up"], [-90, "down"]]) {
    onStatus && onStatus(`Texterkennung läuft (${dir === "up" ? "1" : "2"}/2) …`);
    const rc = rotateCanvas(canvas, deg);
    const { data } = await ocrWorker.recognize(rc);
    for (const l of data.lines || []) {
      const t = l.text.replace(/[^\p{L}\p{N}\s'’.\-&:]/gu, " ").replace(/\s+/g, " ").trim();
      if (l.confidence < 55 || t.length < 4 || !/\p{L}{3,}/u.test(t)) continue;
      const b = l.bbox; let x0, x1, y0, y1;
      if (deg === 90) { x0 = b.y0; x1 = b.y1; y0 = H - b.x1; y1 = H - b.x0; } else { x0 = W - b.y1; x1 = W - b.y0; y0 = b.x0; y1 = b.x1; }
      found.push({ t, conf: l.confidence, dir, x0, x1, y0, y1 });
    }
  }
  // gleiche Rücken zusammenführen (überlappende x-Bereiche)
  found.sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1));
  const groups = [];
  for (const f of found) {
    const g = groups[groups.length - 1];
    const ov = g ? Math.min(g.x1, f.x1) - Math.max(g.x0, f.x0) : -1;
    if (g && ov > 0.5 * Math.min(g.x1 - g.x0, f.x1 - f.x0)) {
      if (f.dir === g.dir) { g.parts.push(f); g.x0 = Math.min(g.x0, f.x0); g.x1 = Math.max(g.x1, f.x1); g.y0 = Math.min(g.y0, f.y0); g.y1 = Math.max(g.y1, f.y1); }
      else if (f.conf > g.conf) groups[groups.length - 1] = { ...f, parts: [f] };
    } else groups.push({ ...f, parts: [f] });
  }
  return {
    compartment: { x0: 0, y0: 0, x1: 1, y1: 1 }, ocr: true,
    items: groups.map(g => {
      const text = g.parts.sort((a, b) => a.y0 - b.y0).map(p => p.t).join(" ");
      return { kind: "book", position: "standing", title: text, author: "", publisher: "", spine_text_vertical: text, text_direction: g.dir,
        bbox: { x0: g.x0 / W, x1: g.x1 / W, y0: Math.max(0, g.y0 / H - 0.03), y1: Math.min(1, g.y1 / H + 0.03) }, confidence: g.conf > 80 ? "medium" : "low", ocrText: true };
    }),
  };
}

/* ================= Katalogabgleich ================= */
const normTxt = s => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["der", "die", "das", "und", "the", "of", "a", "an", "ein", "eine", "von", "im", "in", "zum", "zur", "den", "des", "dem", "and", "le", "la"]);
const toks = s => normTxt(s).split(" ").filter(w => w.length > 1 && !STOP.has(w));
function overlap(a, b) { const A = new Set(toks(a)), B = new Set(toks(b)); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(A.size, Math.min(B.size, A.size + 2)); }
// Band-Nummer des erkannten Rückens bzw. eines Katalogtreffers (siehe volFromText in app.js)
function itemVol(it) {
  const v = String(it.volume ?? "").trim(); if (/^\d{1,3}$/.test(v)) return String(+v);
  const s = String(it.series_no ?? "").trim(); if (/^\d{1,3}$/.test(s)) return String(+s); // ältere Antworten ohne „volume“
  return volFromText(it.spine_text_vertical) || volFromText(it.title);
}
function candVol(c) {
  const p = String(c.part ?? "").replace(/\D/g, ""); if (p && p.length <= 3) return String(+p);
  const s = String(c.seriesNo ?? "").trim(); if (/^\d{1,3}$/.test(s)) return String(+s);
  return volFromText(c.title);
}
const digits = s => String(s ?? "").replace(/\D/g, "");
function scoreCandidate(it, c) {
  let s = overlap(it.title + " " + (it.subtitle || ""), c.title) * 4;
  if (it.author) s += overlap(it.author, c.author) * 2.5;
  if (it.publisher && c.publisher && (normTxt(c.publisher).includes(normTxt(it.publisher)) || normTxt(it.publisher).includes(normTxt(c.publisher).split(" ")[0]))) s += 1.5;
  if (c.language === "Deutsch") s += 0.3;
  if (c.ebook) s -= 1.5;
  if (it.isbn && toIsbn13(it.isbn) && toIsbn13(it.isbn) === c.isbn) s += 10;
  // Reihen: der richtige Band zählt viel, ein anderer Band ist ein falscher Treffer
  const iv = itemVol(it), cv = candVol(c);
  if (iv && cv) s += iv === cv ? 3 : -6; else if (iv) s -= 0.5;
  const on = digits(it.order_no); if (on.length >= 4 && digits(c.seriesNo) === on) s += 4; // Verlagsnummer (rororo 13427) passt genau
  return s;
}
async function matchItem(it) {
  const i13 = toIsbn13(it.isbn);
  let cands = [];
  try {
    if (i13) { const r = await lookupIsbn(i13); if (r) cands.push({ ...r, isbn: i13 }); }
    const last = (it.author || "").split(/[,;&]| und /)[0].trim().split(/\s+/).pop() || "";
    const vol = itemVol(it);
    const q1 = [it.title, vol, last].filter(Boolean).join(" ");
    if (q1.trim()) cands.push(...await searchBooks(q1));
    if (vol && it.title && !cands.some(c => candVol(c) === vol)) cands.push(...await searchBooks([it.title, last].filter(Boolean).join(" ")));
    if (cands.length < 2 && it.title && (last || vol)) cands.push(...await searchBooks(it.title));
  } catch (e) { if (!cands.length) throw e; }
  const seen = new Set();
  cands = cands.filter(c => { const k = c.isbn || normTxt(c.title + c.author + c.year); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(c => ({ ...c, _score: scoreCandidate(it, c) })).sort((a, b) => b._score - a._score).slice(0, 6);
  return cands;
}

/* ================= Wie sicher ist die Erkennung? (Nachfrage) ================= */
// Automatisch übernommen wird ein Katalogtreffer nur, wenn er gut passt – und bei Reihen nur derselbe Band.
// Ein Treffer ohne Band-Angabe ist meist ein bestimmter anderer Band (falsche ISBN) und bleibt nur zur Auswahl.
function autoChoice(it) {
  const b = it.cands[0]; if (!b || b._score < (it.ocrText ? 1.5 : 3)) return -1;
  const iv = itemVol(it); if (iv && candVol(b) !== iv && !(toIsbn13(it.isbn) && toIsbn13(it.isbn) === b.isbn)) return -1;
  return 0;
}
const candKey = c => c ? (c.isbn || "t:" + normTxt(c.title + " " + c.author)) : "";
const itemKey = it => candKey(it.cands[it.choice]) || "r:" + normTxt(it.title + " " + it.author) + "|" + itemVol(it);
// schon in der Sammlung? – mit Band-Nummer, damit Band 9 nicht als „vorhandener“ Band 8 gilt
function scanDup(it) { const c = it.cands[it.choice]; return findDuplicate({ title: c ? c.title : it.title, author: c ? c.author : it.author, isbn: c ? c.isbn : it.isbn, seriesNo: itemVol(it) }); }
// Mehrere Rücken mit demselben Katalogtreffer, aber verschiedenen Band-Nummern: höchstens einer kann stimmen
function resolveCollisions(items) {
  const groups = new Map();
  for (const it of items) { if (it.kind === "other" || !it.include) continue; const k = candKey(it.cands[it.choice]); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  for (const g of groups.values()) {
    if (g.length < 2 || new Set(g.map(itemVol).filter(Boolean)).size < 2) continue;
    const cv = candVol(g[0].cands[g[0].choice]);
    for (const it of g) if (itemVol(it) !== cv) it.choice = -1;
  }
}
// Gründe zum Nachfragen je Rücken (leer = sicher)
function assessScan(items) {
  const byKey = new Map();
  items.forEach((it, n) => { if (it.kind === "other" || !it.include) return; const k = itemKey(it); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(n); });
  items.forEach((it, n) => {
    const r = [];
    if (it.kind !== "other") {
      if (it.ocrText) r.push("Einfache Texterkennung – Titel bitte prüfen");
      else if (it.confidence === "low") r.push("Rücken schlecht lesbar – Titel bitte prüfen");
      const c = it.cands[it.choice], iv = itemVol(it);
      if (!c) r.push(it.offline ? "Katalog nicht erreichbar – es werden nur die erkannten Angaben übernommen"
        : !it.cands.length ? "Nicht im Katalog gefunden – es werden die erkannten Angaben übernommen"
        : iv && !it.cands.some(x => candVol(x) === iv) ? `Band ${iv} nicht im Katalog gefunden – es werden die erkannten Angaben übernommen (ohne ISBN)`
        : "Kein sicherer Katalogtreffer – es werden die erkannten Angaben übernommen");
      else {
        const cv = candVol(c);
        if (iv && !cv) r.push(`Band ${iv} erkannt – der Katalogtreffer nennt keinen Band`);
        const isbnSure = toIsbn13(it.isbn) && toIsbn13(it.isbn) === c.isbn;
        const rival = it.cands.find(x => x !== c && x._score > c._score - 1 && (normTxt(x.title) !== normTxt(c.title) || candVol(x) !== cv));
        if (rival && !isbnSure) r.push("Mehrere ähnliche Katalogeinträge – bitte den richtigen auswählen");
      }
      const same = it.include ? (byKey.get(itemKey(it)) || []).filter(m => m !== n) : [];
      if (same.length) r.push(`Gleiches Buch wie Nr. ${same.map(m => m + 1).join(", ")} – ein zweites Exemplar? Sonst Titel oder Band korrigieren und neu suchen`);
    }
    it.reasons = r;
  });
}
const isUnsure = it => !!(it.include && it.kind !== "other" && it.reasons?.length && !it.confirmed);

/* ================= Ablauf & Prüfliste ================= */
function fachOptions() {
  const out = [];
  for (const f of allFachs()) if (f.layer === "front") out.push({ key: f.m.id + ":" + f.k, m: f.m, k: f.k, label: `${f.w.name}${f.w.columns.length > 1 ? " · Spalte " + (f.ci + 1) : ""}${f.c.modules.length > 1 ? " · " + (f.mi + 1) + ". Würfel" : ""} · ${modName(f.m)} · ${FACH_LABEL[f.k]}`, n: [...f.list, ...layerList(f.m, f.k, "back"), ...layerList(f.m, f.k, "top")].length });
  return out;
}
/* ================= Erkennungs-Wege ================= */
// "api" = eigener API-Schlüssel, "chat" = Claude-Chat (claude.ai / Claude-App, dein Abo), "ocr" = Texterkennung im Browser
function scanModes() {
  return [
    ["api", "🤖 KI direkt (API-Schlüssel)", aiKey() ? "Automatisch, am bequemsten. Kosten pro Foto über dein API-Konto." : "Kein Schlüssel eingetragen.", !!aiKey()],
    ["chat", "💬 Über deinen Claude-Chat", "Mit deinem Claude-Abo: Foto + Auftrag an Claude geben, Antwort hier einfügen. Keine Zusatzkosten.", true],
    ["ocr", "🔤 Einfache Texterkennung", "Ohne KI, im Browser. Findet nur gut lesbare Rücken.", true],
  ];
}
function modeChooser(cur, onPick) {
  const box = el("div", { class: "plist" });
  for (const [v, l, d, ok] of scanModes()) {
    const r = el("input", { type: "radio", name: "scanmode", value: v, checked: v === cur || null, disabled: !ok || null });
    r.addEventListener("change", () => onPick(v));
    box.append(el("label", { class: "prow" + (ok ? "" : " off") }, r, el("span", {}, el("b", { text: l }), el("div", { class: "saved" }, d, !ok ? el("a", { href: "#", style: "margin-left:4px", onclick: e => { e.preventDefault(); aboutBox(); } }, "Einrichten") : null))));
  }
  return box;
}
function defaultMode() { try { const m = localStorage.getItem("scanMode"); if (m === "api" && !aiKey()) return "chat"; if (m) return m; } catch {} return aiKey() ? "api" : "chat"; }
function setDefaultMode(m) { try { localStorage.setItem("scanMode", m); } catch {} }

/* Claude-Chat-Brücke: Foto + Auftrag an Claude geben, JSON-Antwort zurück einfügen */
function claudeChatBridge(sh, { title, prompt, jpeg, fileName, onResult, onBack }) {
  sh.h2.textContent = title;
  const fullPrompt = prompt + "\n\nAntworte ausschließlich mit dem JSON in einem Codeblock, ohne weiteren Text.";
  const file = new File([jpeg], fileName || "foto.jpg", { type: "image/jpeg" });
  const ta = el("textarea", { class: "field", rows: 7, placeholder: "Hier Claudes Antwort einfügen (beginnt mit { … )" });
  const err = el("div", { class: "saved", style: "color:#b3261e" });
  const copy = async () => { try { await navigator.clipboard.writeText(fullPrompt); toast("Auftrag kopiert – jetzt in Claude einfügen."); } catch { promptBox.style.display = ""; promptBox.select(); toast("Bitte den Auftrag unten markieren und kopieren."); } };
  const promptBox = el("textarea", { class: "field", rows: 5, readonly: true, style: "display:none;font-size:12px" }); promptBox.value = fullPrompt;
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const go = () => {
    err.textContent = "";
    try { const data = parseJSONLoose(ta.value); onResult(data); }
    catch (e) { err.textContent = "Das sieht nicht nach Claudes JSON-Antwort aus. Bitte die komplette Antwort kopieren (Kopieren-Knopf am Codeblock)."; }
  };
  ta.addEventListener("paste", () => setTimeout(() => { if (/\}\s*(```)?\s*$/.test(ta.value.trim())) go(); }, 50));
  fillNode(sh.body,
    el("div", { class: "bridge" },
      el("div", { class: "bstep" }, el("b", { text: "1" }), el("div", {},
        el("div", { class: "btitle", text: "Foto und Auftrag an Claude geben" }),
        el("p", { class: "saved", text: canShare ? "Am einfachsten: „An Claude teilen“ und im Teilen-Menü die Claude-App wählen – oder Auftrag kopieren und das Foto in einem neuen Claude-Chat anhängen." : "Neuen Chat auf claude.ai öffnen, das Foto anhängen (Datei unten speichern oder das Original nehmen) und den kopierten Auftrag einfügen." }),
        el("div", { class: "covertools" },
          canShare ? el("button", { class: "btn primary", onclick: async () => { try { await navigator.clipboard.writeText(fullPrompt).catch(() => {}); await navigator.share({ files: [file], text: fullPrompt }); } catch (e) { if (e.name !== "AbortError") toast("Teilen nicht möglich – bitte kopieren."); } } }, "📤 An Claude teilen") : null,
          el("button", { class: "btn" + (canShare ? "" : " primary"), onclick: copy }, "📋 Auftrag kopieren"),
          el("button", { class: "btn", onclick: () => saveFile(fileName || "foto.jpg", jpeg) }, "⬇ Foto speichern"),
          el("a", { class: "btn", href: "https://claude.ai/new", target: "_blank", rel: "noopener" }, "Claude öffnen ↗")),
        promptBox)),
      el("div", { class: "bstep" }, el("b", { text: "2" }), el("div", {},
        el("div", { class: "btitle", text: "Claudes Antwort hier einfügen" }),
        el("p", { class: "saved", text: "Claude antwortet mit einem Codeblock. Kopiere ihn (Kopieren-Knopf) und füge ihn hier ein." }),
        ta, err))),
    el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: onBack }, "← Zurück"), el("button", { class: "btn primary", onclick: go }, "Weiter")));
}

/* ================= Fach-Foto: Ablauf ================= */
function openShelfScan(preFachKey) {
  const sh = sheet("📷 Fach-Foto einlesen");
  const fachs = fachOptions();
  const sel = el("select", { class: "field", style: "width:100%" },
    el("option", { value: "" }, "Nicht einsortieren – nur Bücher erfassen"),
    ...fachs.map(f => el("option", { value: f.key, selected: (preFachKey || S.lastScanFach) === f.key || null }, f.label + (f.n ? ` (${f.n} Bücher)` : " (leer)"))));
  let mode = defaultMode();
  const go = f => { S.lastScanFach = sel.value; setDefaultMode(mode); runShelfScan(f, sel.value, mode); };
  const m = isMobile();
  fillNode(sh.body,
    el("p", { style: "margin-top:0", text: "Fotografiere ein ganzes Fach von vorne. Die App erkennt alle Buchrücken von links nach rechts, sucht die Buchdaten, und du prüfst alles, bevor es übernommen wird." }),
    el("label", { class: "lbl", text: "Wohin sollen die Bücher?" }), sel,
    fachs.length ? null : el("div", { class: "saved", style: "margin-top:4px", text: "Tipp: Lege unter „Echtes Regal“ deine Regalwand an, dann kann die App die Bücher direkt ins richtige Fach stellen." }),
    el("label", { class: "lbl", style: "margin-top:14px", text: "Wie soll erkannt werden?" }), modeChooser(mode, v => mode = v),
    el("div", { class: "covertools", style: "margin-top:16px" },
      m ? el("button", { class: "btn primary", onclick: async () => { const f = await pickImage(true); if (f) go(f); } }, "📷 Fach fotografieren") : null,
      el("button", { class: "btn" + (m ? "" : " primary"), onclick: async () => { const f = await pickImage(false); if (f) go(f); } }, m ? "Aus Galerie" : "🖼 Foto wählen")),
    m ? null : dropZone("…oder Foto hierher ziehen bzw. mit Strg+V einfügen", go));
  S.pasteHandler = go;
}
async function runShelfScan(file, fachKey, mode = defaultMode()) {
  const sh = openSheet || sheet("📷 Fach-Foto einlesen");
  S.pasteHandler = null;
  const status = busyView("Fach wird erkannt", file, "Bereite das Foto vor …");
  let img, canvas, jpeg;
  try { img = await loadImage(file); canvas = toCanvas(img, 1568); jpeg = await canvasBlob(canvas, .88); }
  catch { toast("Das Foto konnte nicht gelesen werden."); openShelfScan(fachKey); return; }
  if (mode === "chat") {
    claudeChatBridge(sh, { title: "💬 Fach-Foto mit Claude erkennen", prompt: SCAN_PROMPT, jpeg, fileName: "regalfach.jpg",
      onBack: () => openShelfScan(fachKey),
      onResult: data => { if (!Array.isArray(data.items)) { toast("In der Antwort fehlt die Bücherliste."); return; } continueShelfScan(sh, { file, canvas, data, fachKey, mode }); } });
    return;
  }
  let data;
  try { data = mode === "api" && aiKey() ? await aiScanShelf(jpeg, t => status.textContent = t) : await ocrScanShelf(canvas, t => status.textContent = t); }
  catch (e) {
    fillNode(sh.body, el("div", { class: "note", text: "Erkennung fehlgeschlagen: " + (e.message || e) }),
      el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: () => openShelfScan(fachKey) }, "← Zurück"),
        el("div", { class: "covertools" }, el("button", { class: "btn", onclick: () => runShelfScan(file, fachKey, "chat") }, "💬 Über Claude-Chat"), el("button", { class: "btn primary", onclick: () => runShelfScan(file, fachKey, mode) }, "Nochmal versuchen"))));
    return;
  }
  continueShelfScan(sh, { file, canvas, data, fachKey, mode });
}
async function continueShelfScan(sh, { file, canvas, data, fachKey }) {
  const status = busyView("Buchdaten werden gesucht", file, "…");
  const items = data.items.map((it, i) => ({ ...it, _i: i, include: it.kind !== "other", cands: [], choice: -1, title: it.title || it.spine_text_vertical || it.label || "" }));
  // Buchdaten suchen (3 gleichzeitig)
  let done = 0; const books = items.filter(x => x.kind !== "other");
  status.textContent = `${items.length} Objekte erkannt – suche Buchdaten (0/${books.length}) …`;
  const queue = [...books];
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length) {
      const it = queue.shift();
      try { it.cands = await matchItem(it); } catch { it.cands = []; it.offline = true; }
      it.choice = autoChoice(it);
      status.textContent = `${items.length} Objekte erkannt – suche Buchdaten (${++done}/${books.length}) …`;
    }
  }));
  resolveCollisions(items);
  assessScan(items);
  for (const it of items) it.dup = scanDup(it);
  scanReview(sh, { file, canvas, data, items, fachKey });
}

/* ================= Einzelnes Cover per KI / Claude-Chat ================= */
const COVER_PROMPT = `The photo shows a book (front cover, back cover or title page). Identify the book.
Return ONLY a JSON object: {"title":"","subtitle":"","author":"","publisher":"","year":"","isbn":"","language":"","confidence":"high|medium|low"}
Read the text as printed; complete the author's full name only if you are sure. Only give an ISBN if it is printed on the photo.`;
async function aiRecognizeCover(file) {
  const img = await loadImage(file); const jpeg = await canvasBlob(toCanvas(img, 1200), .86);
  const key = aiKey(); if (!key) throw new Error("Kein KI-Schlüssel.");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: aiModel(), max_tokens: 1000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(jpeg) } }, { type: "text", text: COVER_PROMPT }] }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || "Fehler " + r.status);
  return parseJSONLoose((j.content || []).filter(c => c.type === "text").map(c => c.text).join(""));
}
async function coverViaChat(file) {
  const sh = openSheet || sheet("Cover erkennen");
  const img = await loadImage(file); const jpeg = await canvasBlob(toCanvas(img, 1400), .86);
  claudeChatBridge(sh, { title: "💬 Cover mit Claude erkennen", prompt: COVER_PROMPT, jpeg, fileName: "cover.jpg",
    onBack: () => showSearch("", file),
    onResult: d => coverResult(d, file) });
}
function coverResult(d, file) {
  const i = toIsbn13(d.isbn);
  if (i) { handleIsbnWithCover(i, file); return; }
  const last = (d.author || "").split(/[,;&]| und /)[0].trim().split(/\s+/).pop() || "";
  showSearch([d.title, last].filter(Boolean).join(" "), file, d);
}
async function handleIsbnWithCover(isbn, file) {
  busyView("Buchdaten werden geladen", file, `ISBN ${isbn} – suche …`);
  let rec = null; try { rec = await lookupIsbn(isbn); } catch {}
  openReview(rec || { isbn }, file, rec ? null : "Zu dieser ISBN wurde online nichts gefunden – bitte ergänzen.");
}

function cropSpine(canvas, it, comp) {
  const b = it.bbox; if (!b) return null;
  const W = canvas.width, H = canvas.height;
  const x0 = Math.max(0, Math.floor(b.x0 * W)), x1 = Math.min(W, Math.ceil(b.x1 * W)), y0 = Math.max(0, Math.floor(b.y0 * H)), y1 = Math.min(H, Math.ceil(b.y1 * H));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  let c = document.createElement("canvas"); c.width = x1 - x0; c.height = y1 - y0;
  c.getContext("2d").drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  if (it.position === "lying_in_row" || it.position === "lying_on_top") c = rotateCanvas(c, -90); // liegend → als stehenden Rücken speichern
  return c;
}
function spineFromScan(it, comp, cropCanvas) {
  const cw = Math.max(0.05, (comp?.x1 ?? 1) - (comp?.x0 ?? 0)), chh = Math.max(0.05, (comp?.y1 ?? 1) - (comp?.y0 ?? 0));
  const b = it.bbox || {}; const bw = (b.x1 - b.x0) / cw * FACH_W, bh = (b.y1 - b.y0) / chh * FACH_H;
  const lying = it.position === "lying_in_row" || it.position === "lying_on_top";
  const clampN = (v, a, z) => Math.round(Math.min(z, Math.max(a, v)) * 10) / 10;
  const sp = {};
  if (isFinite(bw) && isFinite(bh) && bw > 0 && bh > 0) { sp.thickCm = clampN(lying ? bh : bw, 0.3, 15); sp.heightCm = clampN(lying ? bw : bh, 8, 33); }
  if (/^#[0-9a-f]{6}$/i.test(it.spine_color || "")) sp.color = it.spine_color;
  if (/^#[0-9a-f]{6}$/i.test(it.text_color || "")) sp.fg = it.text_color;
  if (it.spine_text_vertical) sp.text = it.spine_text_vertical;
  if (it.spine_text_horizontal) { sp.quer = it.spine_text_horizontal; sp.mode = it.text_direction === "horizontal" ? "quer" : "beides"; }
  else if (it.text_direction === "horizontal") sp.mode = "quer";
  if (it.text_direction === "down") sp.dir = "down";
  if (/rororo|dtv|fischer|suhrkamp/i.test(it.publisher || "")) sp.font = "sans";
  return { sp, cropCanvas };
}
function scanReview(sh, st) {
  const { canvas, data, items } = st;
  sh.h2.textContent = "Erkannte Bücher prüfen";
  const comp = data.compartment || { x0: 0, y0: 0, x1: 1, y1: 1 };
  // Foto mit nummerierten Rahmen
  const photoUrl = canvas.toDataURL("image/jpeg", .85);
  const ov = el("div", { class: "scanphoto" }, el("img", { src: photoUrl, alt: "" }));
  items.forEach((it, n) => { const b = it.bbox; if (!b) return; ov.append(el("div", { class: "scanbox" + (it.kind === "other" ? " other" : "") + (it.include ? "" : " off"), "data-n": n, style: `left:${b.x0 * 100}%;top:${b.y0 * 100}%;width:${(b.x1 - b.x0) * 100}%;height:${(b.y1 - b.y0) * 100}%` }, el("span", { text: n + 1 }))); });
  const optCrop = el("input", { type: "checkbox", checked: data.ocr ? null : true });
  const optStatus = el("select", { class: "field" }, ...Object.entries(STATUS).map(([v, l]) => el("option", { value: v }, l)));
  const fachs = fachOptions(); const target = fachs.find(f => f.key === st.fachKey);
  const optReplace = el("select", { class: "field" }, el("option", { value: "replace" }, "Fach-Inhalt ersetzen (bisherige Bücher → „Noch nicht eingeräumt“)"), el("option", { value: "append" }, "Hinten an den bisherigen Inhalt anhängen"));
  const scanTags = { tags: [] };
  const list = el("div", { class: "scanlist" });
  const countBtn = el("button", { class: "btn primary" });
  const updCount = () => { const n = items.filter(x => x.include).length; countBtn.textContent = `${n} ${n === 1 ? "Buch" : "Bücher"} übernehmen${target ? " & einsortieren" : ""}`; countBtn.disabled = !n || null; ov.querySelectorAll(".scanbox").forEach(bx => bx.classList.toggle("off", !items[+bx.dataset.n].include)); };
  // Nachfrage: unsichere Rücken gelb markieren, oben zählen, optional nur diese zeigen
  const drawers = [];
  const onlyUnsure = el("input", { type: "checkbox" });
  onlyUnsure.addEventListener("change", () => list.classList.toggle("onlyunsure", onlyUnsure.checked));
  const unsureNote = el("div");
  const updUnsure = () => {
    const n = items.filter(isUnsure).length;
    if (!n && onlyUnsure.checked) { onlyUnsure.checked = false; list.classList.remove("onlyunsure"); }
    fillNode(unsureNote, n ? el("div", { class: "note warnnote" },
      el("b", { text: `⚠ ${n} ${n === 1 ? "Buch ist" : "Bücher sind"} unsicher erkannt` }), " (gelb markiert). Bitte prüfen: richtigen Katalogtreffer wählen, " +
      "oder Titel/Band korrigieren und „🔎 Neu suchen“ – oder „✓ Passt so“, wenn alles stimmt.",
      el("label", { class: "prow", style: "margin-top:6px" }, onlyUnsure, el("span", { text: "Nur unsichere zeigen" }))) : null);
  };
  const refresh = () => { assessScan(items); drawers.forEach(d => d()); updCount(); updUnsure(); };
  const POS = { standing: "steht", lying_in_row: "liegt in der Reihe", lying_on_top: "liegt oben auf", behind: "hintere Reihe" };
  const rowFor = (it, n) => {
    const cb = el("input", { type: "checkbox", checked: it.include || null });
    cb.addEventListener("change", () => { it.include = cb.checked; row.classList.toggle("off", !it.include); refresh(); });
    const crop = cropSpine(canvas, it, comp);
    const thumb = el("div", { class: "scanthumb" }); if (crop) { const c2 = crop; c2.style.cssText = "max-width:100%;max-height:100%"; thumb.append(c2); }
    const tIn = el("input", { class: "field", value: it.title || "", placeholder: "Titel" });
    const aIn = el("input", { class: "field", value: it.author || "", placeholder: "Autor" });
    const editHint = el("div", { class: "saved", style: "color:var(--accent)" });
    const edited = () => { if (it.kind !== "other" && it.cands.length) editHint.textContent = "Geändert – „🔎 Neu suchen“ tippen, damit der Katalogtreffer passt."; };
    const vIn = el("input", { class: "field", value: itemVol(it), placeholder: "Band", inputmode: "numeric", title: "Band-Nummer einer Reihe (leer = keine)", "aria-label": "Band" });
    tIn.addEventListener("input", () => { it.title = tIn.value; edited(); }); aIn.addEventListener("input", () => { it.author = aIn.value; edited(); });
    vIn.addEventListener("input", () => { it.volume = vIn.value.replace(/\D/g, "").slice(0, 3); it.series_no = it.volume; it.spine_text_vertical = ""; edited(); }); // eigene Angabe ersetzt die erkannte
    const pick = el("select", { class: "field", style: "width:100%" });
    const drawPick = () => fillNode(pick,
      el("option", { value: -1, selected: it.choice === -1 || null }, "Nur erkannte Angaben übernehmen (ohne Katalogtreffer)"),
      ...it.cands.map((c, i) => el("option", { value: i, selected: it.choice === i || null }, `${c.title} – ${c.author || "?"} · ${[c.publisher, c.year].filter(Boolean).join(" ")}${c.isbn ? " · ISBN " + c.isbn : ""}${c.ebook ? " · E-Book" : ""}`)));
    drawPick();
    const dupInfo = el("div", { class: "saved" });
    const drawDup = () => { it.dup = scanDup(it); dupInfo.textContent = it.dup ? (isWish(it.dup) ? `⭐ Stand auf deiner Wunschliste („${it.dup.title}“) – wird als gekauft in den Bestand übernommen.` : `✓ Schon in deiner Sammlung („${it.dup.title}“) – wird nicht doppelt angelegt, nur einsortiert.`) : ""; };
    pick.addEventListener("change", () => { it.choice = +pick.value; it.confirmed = true; refresh(); }); // eigene Auswahl = geprüft
    const re = el("button", { class: "btn sm", type: "button" }, "🔎 Neu suchen");
    re.addEventListener("click", async () => {
      editHint.textContent = ""; re.disabled = true; re.textContent = "Suche …";
      try { it.cands = await matchItem(it); it.choice = autoChoice(it); it.confirmed = false; } catch { toast("Keine Internetverbindung."); }
      drawPick(); refresh(); re.disabled = false; re.textContent = "🔎 Neu suchen";
    });
    const warn = el("div", { class: "scanwarn" });
    const drawWarn = () => {
      const why = it.kind === "other" ? [] : it.reasons || [];
      row.classList.toggle("unsure", isUnsure(it));
      ov.querySelector(`.scanbox[data-n="${n}"]`)?.classList.toggle("unsure", isUnsure(it));
      fillNode(warn, why.length ? [el("div", { class: "scanwhy" }, ...why.map(t => el("div", { text: "⚠ " + t }))),
        it.confirmed ? el("div", { class: "saved", text: "✓ Von dir geprüft" })
          : el("button", { class: "btn sm", type: "button", title: "Angaben stimmen – ohne weitere Nachfrage übernehmen", onclick: () => { it.confirmed = true; refresh(); } }, "✓ Passt so")] : []);
    };
    drawers.push(() => { drawWarn(); drawDup(); });
    const vol = itemVol(it);
    const meta = [POS[it.position] || "", it.publisher, it.order_no ? "Nr. " + it.order_no : (!vol && it.series_no ? "Nr. " + it.series_no : "")].filter(Boolean).join(" · ");
    const row = el("div", { class: "scanrow" + (it.include ? "" : " off") + (it.kind === "other" ? " other" : "") },
      el("label", { class: "scancb" }, cb, el("b", { text: n + 1 })),
      thumb,
      el("div", { class: "scanmain" },
        it.kind === "other" ? el("div", { class: "saved", text: `Kein Buch erkannt: ${it.label || "Objekt"} – wird standardmäßig übersprungen.` }) : null,
        el("div", { class: "scanin" }, tIn, aIn, it.kind === "other" ? null : vIn), editHint,
        el("div", { class: "saved", text: meta }),
        it.kind === "other" ? null : el("div", { class: "scanpick" }, pick, re),
        it.offline ? el("div", { class: "saved", text: "Katalogsuche nicht möglich (offline)." }) : null,
        dupInfo, warn));
    return row;
  };
  fillNode(list, ...items.map(rowFor));
  countBtn.addEventListener("click", async () => {
    const open = items.filter(isUnsure);
    if (open.length && !(await confirmBox(`${open.length} ${open.length === 1 ? "Buch ist" : "Bücher sind"} noch nicht geprüft (gelb markiert).\nSo übernehmen, wie sie gerade eingestellt sind?`, "Trotzdem übernehmen"))) {
      list.children[items.indexOf(open[0])]?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    importScan(st, { crop: optCrop.checked, status: optStatus.value, replace: optReplace.value === "replace", target, tags: scanTags.tags });
  });
  fillNode(sh.body,
    el("div", { class: "note info" }, `${items.filter(x => x.kind !== "other").length} Bücher${items.some(x => x.kind === "other") ? " und " + items.filter(x => x.kind === "other").length + " sonstige Objekte" : ""} erkannt. Prüfe Titel und Katalogtreffer – Haken weg bei allem, was nicht übernommen werden soll.` + (data.ocr ? " (Einfache Texterkennung: bitte besonders genau prüfen; fehlende Bücher kannst du danach normal hinzufügen.)" : "")),
    unsureNote,
    ov,
    el("div", { class: "scanopts" },
      el("label", { class: "prow" }, optCrop, el("span", {}, el("b", { text: "Buchrücken-Bilder aus dem Foto übernehmen" }), el("div", { class: "saved", text: "Sonst Farbe, Text und Maße wie erkannt." }))),
      el("div", { class: "fgrid" }, el("div", { class: "c3" }, el("label", { class: "lbl", text: "Lesestatus für neue Bücher" }), optStatus),
        target ? el("div", { class: "c3" }, el("label", { class: "lbl", text: "Ziel: " + target.label }), optReplace) : el("div", { class: "c3 saved", style: "align-self:end", text: "Ohne Fach: Bücher landen unter „Noch nicht eingeräumt“." }),
        el("div", { class: "c6" }, el("label", { class: "lbl", text: "Schlagworte für alle übernommenen Bücher (optional)" }), tagEditor(scanTags, () => {})))),
    list,
    el("div", { class: "actions sticky" }, el("button", { class: "btn ghost", onclick: () => openShelfScan(st.fachKey) }, "← Anderes Foto"), countBtn));
  refresh();
  sh.guard = async () => await confirmBox("Die erkannten Bücher wurden noch nicht übernommen.\nWirklich schließen?", "Schließen");
  sh.body.parentElement.scrollTop = 0;
}
async function importScan(st, opt) {
  const sh = openSheet; const { canvas, data, items } = st;
  const comp = data.compartment || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const chosen = items.filter(x => x.include);
  if (!chosen.length) return;
  const msg = busyView("Bücher werden übernommen", null, `0 / ${chosen.length}`);
  const placed = { front: [], top: [], back: [] };
  let created = 0, reused = 0, n = 0; const used = new Set(); const newIds = [];
  for (const it of chosen) {
    const c = it.cands[it.choice];
    const look = spineFromScan(it, comp, opt.crop ? cropSpine(canvas, it, comp) : null);
    let spine = { ...look.sp };
    if (look.cropCanvas) { spine.imageBlob = await canvasBlob(look.cropCanvas, .86); }
    let id;
    let dup = scanDup(it);
    const copyOf = dup && used.has(dup.id) ? dup.id : null; // zweites Exemplar im selben Foto → eigener Eintrag
    const copy = !!copyOf;
    if (copy) dup = null;
    if (dup) {
      id = dup.id; reused++;
      const patch = {}; if (!dup.spine) patch.spine = spine; if (isGone(dup)) patch.gone = null; if (isWish(dup)) { patch.wish = false; patch.addedAt = new Date().toISOString(); }
      if ((opt.tags || []).length) { const t = normTags([...(dup.tags || []), ...opt.tags]); if (t.length !== (dup.tags || []).length) patch.tags = t; }
      if (Object.keys(patch).length) await patchBook(id, patch);
    } else {
      const base = c ? { ...c } : { title: it.title, author: it.author, publisher: it.publisher || "" };
      if (c && it.title && !overlap(it.title, c.title)) base.title = it.title; // Katalogtitel passt nicht → Erkanntes behalten
      const b = { id: uid(), status: opt.status, rating: 0, notes: copy ? "Weiteres Exemplar" : "", addedAt: new Date().toISOString(), source: "fachfoto" };
      if (copyOf) b.notDup = [copyOf]; // bewusst zweites Exemplar – keine Dublette
      for (const f of FIELDS) b[f.k] = String(base[f.k] || "").trim();
      if (!b.title) b.title = it.title || it.label || "Unbekanntes Buch";
      if (!b.author && it.author) b.author = it.author;
      if (!b.publisher && it.publisher) b.publisher = it.publisher;
      if (it.isbn && !b.isbn) b.isbn = toIsbn13(it.isbn) || "";
      if (!b.series && (it.series || it.series_no)) { b.series = it.series || it.publisher || ""; b.seriesNo = it.series_no || ""; }
      if (!b.seriesNo && it.series_no && b.series) b.seriesNo = it.series_no;
      // Erkannter Band einer Reihe: als Reihe + Band-Nr. speichern (statt einer Verlagsnummer wie rororo 13427 aus dem Katalog)
      const iv = itemVol(it);
      if (iv) {
        const pubSeries = digits(b.seriesNo).length >= 4; // Katalog-„Reihe“ ist nur die Verlagsreihe
        b.series = String(it.series || "").trim() || (!pubSeries && b.series) || String(it.title || b.title).replace(/[\s·.\-–]*\d{1,3}\s*$/, "").trim();
        b.seriesNo = iv;
      }
      b.spine = spine;
      if ((opt.tags || []).length) b.tags = normTags(opt.tags);
      if (c?.coverUrl) { const url = (c.altCovers && c.altCovers[0]) || c.coverUrl; const blob = await fetchCoverBlob(url); if (blob) { b.coverUrl = url; b.coverBlob = blob; } else if (await imgOk(url)) b.coverUrl = url; }
      await putBook(b); id = b.id; created++; newIds.push(id);
    }
    used.add(id);
    const layer = it.position === "lying_on_top" ? "top" : it.position === "behind" ? "back" : "front";
    placed[layer].push({ id, lying: it.position === "lying_in_row" });
    msg.textContent = `${++n} / ${chosen.length}`;
  }
  if (opt.target) {
    const { m, k } = opt.target;
    if (opt.replace) for (const layer of ["front", "back", "top"]) for (const id of [...layerList(m, k, layer)]) { unshelve(id); setLying(id, false); }
    for (const layer of ["front", "back"]) for (const p of placed[layer]) { unshelve(p.id); layerList(m, k, layer).push(p.id); setLying(p.id, p.lying); }
    for (const p of [...placed.top].reverse()) { unshelve(p.id); layerList(m, k, "top").push(p.id); setLying(p.id, false); } // oberstes Buch zuletzt
    if (placed.back.length) S.showBack.delete(m.id + ":" + k);
    await saveShelves();
  }
  sh.guard = null;
  closeSheet();
  renderAll();
  toast(`${created} neue Bücher angelegt${reused ? `, ${reused} vorhandene erkannt` : ""}${opt.target ? " und einsortiert" : ""}.`, 4500);
  if (opt.target) { S.wallId = allFachs().find(f => f.m === opt.target.m)?.w.id || S.wallId; if (location.hash !== "#wand") location.hash = "#wand"; }
  const noCov = newIds.filter(id => { const b = S.books.find(x => x.id === id); return b && needsCover(b); });
  if (noCov.length && await confirmBox(`${noCov.length} der neuen Bücher ${noCov.length === 1 ? "hat" : "haben"} noch kein Cover.\nJetzt online nachtragen? (Eindeutige Treffer werden übernommen, sonst wird gefragt.)`, "Cover suchen")) coverRun(noCov);
}
