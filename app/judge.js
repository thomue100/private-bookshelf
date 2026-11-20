/* Mein Bücherregal – Claude wählt den Katalogtreffer (Text + Bild).
   Nach der Katalogsuche bekommt Claude je Buch das Foto des Rückens (bzw. Covers) und bis zu 5 Kandidaten mit Angaben und kleinem
   Coverbild und sagt: welcher Kandidat (oder keiner), wie sicher, kurzer Grund. Mehrere Bücher pro Anfrage (läuft beim Öffnen der Prüfliste, auch nach einem Sammelauftrag).
   Automatisch übernommen wird nur, wenn Claude sicher ist UND Band/Reihe nicht widersprechen (Band-Regeln wie bisher) – sonst bleibt
   die Zeile gelb, Claudes Vermutung steht als Vorschlag da. Ohne Schlüssel oder abgeschaltet: wie bisher die Punkte (scoreCandidate).
   Optional (Standard aus): Websuche über das Werkzeug der API für Bücher ohne passenden Kandidaten; eine gefundene ISBN wird immer
   über lookupIsbn bestätigt. Einstellungen nur auf diesem Gerät (localStorage „aiJudge“, „aiWebSearch“). */
"use strict";

const JUDGE_GROUP = 4, JUDGE_CANDS = 5, JUDGE_IMG_PX = 800, JUDGE_COVER_PX = 256;
function judgeOn() { try { return localStorage.getItem("aiJudge") !== "0"; } catch { return true; } }
function webSearchOn() { try { return localStorage.getItem("aiWebSearch") === "1"; } catch { return false; } }
const WEB_SEARCH_CENTS = () => { const [ri, ro] = AI_PRICES[aiModel()] || AI_PRICES["claude-sonnet-5-5"]; return 2 * 1 + (12000 * ri + 800 * ro) / 1e4; }; // 2 Suchen à 1 ct + Tokens

const JUDGE_PROMPT = `You verify library catalogue matches for books photographed in a private bookshelf.
For each book you get: a photo of its spine (or front cover), what was read from it, and up to ${JUDGE_CANDS} catalogue candidates — each with its data and, when available, a small cover image.
Decide which candidate is the SAME book: same work and author, and — if a volume number is visible — the same volume. When a cover image is given, compare the edition: colours, typography, publisher logo and series design of the spine should fit that cover. Translations, other volumes, study guides and audio books are different books.
Answer for every book number:
- choice: the candidate number (1–${JUDGE_CANDS}), or 0 if none of them matches
- confidence: "high" only if you are sure (title, author and – if visible – volume clearly agree and nothing contradicts), "medium" if probably, "low" if guessing
- reason: at most 15 words, in German.`;
const JUDGE_SCHEMA = { type: "object", additionalProperties: false, required: ["books"], properties: {
  books: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "choice", "confidence", "reason"],
    properties: { n: { type: "integer" }, choice: { type: "integer" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, reason: { type: "string" } } } } } };

// Kleines Coverbild als base64 (nur, wenn der Katalog es herausgibt) – je Adresse einmal
const coverThumbs = new Map();
function coverThumb(c) {
  const url = c && ((c.altCovers && c.altCovers[0]) || c.coverUrl);
  if (!url) return Promise.resolve(null);
  if (!coverThumbs.has(url)) coverThumbs.set(url, (async () => {
    try { const b = await Promise.race([fetchCoverBlob(url), new Promise(r => setTimeout(() => r(null), 6000))]); if (!b) return null; return blobToBase64(await canvasBlob(toCanvas(await loadImage(b), JUDGE_COVER_PX), .8)); } catch { return null; }
  })());
  return coverThumbs.get(url);
}
const candLine = c => [c.title + (c.author ? " – " + c.author : ""), [c.publisher, c.year].filter(Boolean).join(" "), c.isbn ? "ISBN " + c.isbn : "", candVol(c) ? "Band " + candVol(c) : "", c.ebook ? "E-Book" : "", c.language && c.language !== "Deutsch" ? c.language : ""].filter(Boolean).join(" · ");
const readLine = it => ["Titel: " + (it.title || "?"), it.subtitle ? "Untertitel: " + it.subtitle : "", it.author ? "Autor: " + it.author : "", it.publisher ? "Verlag: " + it.publisher : "", itemVol(it) ? "Band: " + itemVol(it) : "", it.order_no ? "Verlagsnummer: " + it.order_no : ""].filter(Boolean).join(" · ");
/* Inhalt einer Anfrage: entries = [{ n, it, img (Canvas) }] → { content, cidx: { n: [Index in it.cands …] } } */
async function judgeContent(entries) {
  const content = [], cidx = {};
  for (const { n, it, img } of entries) {
    content.push({ type: "text", text: `Buch ${n} – Foto:` });
    if (img) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await canvasB64(img) } });
    content.push({ type: "text", text: `Gelesen: ${readLine(it)}` });
    const idx = it.cands.map((_, i) => i).slice(0, JUDGE_CANDS);
    cidx[n] = idx;
    for (let k = 0; k < idx.length; k++) {
      const c = it.cands[idx[k]];
      content.push({ type: "text", text: `Kandidat ${n}.${k + 1}: ${candLine(c)}` });
      const t = await coverThumb(c);
      if (t) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: t } });
    }
  }
  content.push({ type: "text", text: JUDGE_PROMPT });
  return { content, cidx };
}
const judgeParams = (content, model = aiModel()) => ({ model, max_tokens: AI_MAX_TOKENS, output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } }, messages: [{ role: "user", content }] });
function judgeFromMessage(m) {
  if (m?.stop_reason === "refusal") throw new Error("Die KI hat die Auswahl nicht bearbeitet.");
  const d = parseJSONLoose(aiText(m));
  if (!Array.isArray(d.books)) throw new Error("Die KI hat keine Auswahl geliefert.");
  return d.books;
}
/* Claudes Urteil übernehmen: automatisch nur, wenn sicher UND Band/Reihe passen; sonst Vorschlag (gelb) */
function applyJudge(it, j, idx) {
  if (!j) return;
  const k = +j.choice || 0, ci = k >= 1 && k <= idx.length ? idx[k - 1] : -1;
  it.judge = { choice: k, ci, confidence: j.confidence, reason: String(j.reason || "").slice(0, 160) };
  delete it.suggest;
  if (ci < 0) { it.choice = -1; return; }
  const c = it.cands[ci], iv = itemVol(it), cv = candVol(c);
  const isbnSure = toIsbn13(it.isbn) && toIsbn13(it.isbn) === c.isbn;
  const volOk = isbnSure || !iv || (cv && cv === iv);
  if (j.confidence === "high" && volOk) it.choice = ci;
  else { it.choice = -1; it.suggest = ci; if (!volOk) it.judge.volConflict = true; }
}
/* Mehrere Bücher prüfen lassen. imageFor(it) → Canvas des Rückens/Covers. Fehler sind nicht schlimm: dann bleibt die Punkte-Wahl. */
async function judgeItems(items, imageFor, { run, onStatus, model = aiModel(), nOf } = {}) {
  // ohne Kandidaten nichts zu wählen; gedruckte ISBN mit genau passendem Treffer ist schon sicher
  const todo = items.filter(it => it.kind !== "other" && it.cands?.length && !(toIsbn13(it.isbn) && it.cands[it.choice]?.isbn === toIsbn13(it.isbn)));
  if (!todo.length || !aiKey()) return;
  let done = 0;
  for (let i = 0; i < todo.length; i += JUDGE_GROUP) {
    const part = todo.slice(i, i + JUDGE_GROUP);
    const entries = part.map((it, k) => ({ n: nOf ? nOf(it) : i + k + 1, it, img: (() => { try { return imageFor(it); } catch { return null; } })() }));
    try {
      const { content, cidx } = await judgeContent(entries);
      const res = await aiRequest(judgeParams(content, model), { run, step: "auswahl", imgs: entries.map(e => ({ n: e.n, w: e.img?.width, h: e.img?.height })), parse: judgeFromMessage });
      for (const e of entries) applyJudge(e.it, res.find(x => +x.n === e.n), cidx[e.n]);
    } catch (e) { for (const it of part) it.judgeError = e.message; }
    done += part.length; onStatus && onStatus(`Claude vergleicht die Treffer (${done}/${todo.length}) …`);
  }
}

/* Fach-Foto: Claude wählt die Treffer, danach (falls eingeschaltet) Websuche. src = Originalfoto als Canvas (sonst aus file geladen).
   Fehler schaden nicht – dann bleibt die Punkte-Wahl. nOf: Nummer des Buchs im Fach (fürs Protokoll). */
async function judgeScan(items, { file, src, run, onStatus, nOf } = {}) {
  if (!judgeOn() || !aiKey()) return;
  let own = false;
  if (!src) { try { src = toCanvas(await loadImage(file), SRC_MAX_PX); own = true; } catch { return; } }
  try {
    const todo = items.filter(it => it.include !== false && !it.confirmed);
    await judgeItems(todo, it => it.bbox ? spineCanvas(src, it, { max: JUDGE_IMG_PX }) : null, { run, onStatus, nOf });
    await webSearchItems(todo, { run, onStatus });
  } finally { if (own) src.width = src.height = 0; }
}
/* Cover-Foto (Suchergebnis in showSearch): Claude vergleicht das Foto – zugeschnitten, wenn die Erkennung die Ecken geliefert hat –
   mit den Covern der ersten Treffer. → { i (Index in list, -1 = keiner), sure, reason, confidence } oder null (aus, Fehler).
   „sure“ nur bei „high“ und passendem Band – gerade Übersetzungen und Neuauflagen mit ähnlichem Cover werden sonst verwechselt. */
async function judgeCover(file, recognized, list, run) {
  if (!judgeOn() || !aiKey() || !list?.length) return null;
  let img = null;
  try { if (file.quads?.cover && typeof warpQuad === "function") img = await warpQuad(file, file.quads.cover, JUDGE_IMG_PX); } catch { img = null; }
  if (!img) { try { img = toCanvas(await loadImage(file), JUDGE_IMG_PX); } catch { return null; } }
  const it = { ...recognized, kind: "book", cands: list.slice(0, JUDGE_CANDS), choice: -1 };
  await judgeItems([it], () => img, { run });
  if (!it.judge) return null;
  const i = it.choice >= 0 ? it.choice : it.suggest ?? -1;
  return { i, sure: it.choice >= 0, reason: it.judge.reason, confidence: it.judge.confidence };
}
// Neue Katalogsuche → altes Urteil passt nicht mehr zu den Kandidaten
function clearJudge(it) { for (const k of ["judge", "suggest", "judgeError", "webFound", "webError"]) delete it[k]; }

/* ---------- Optional: Websuche nach Ausgabe und ISBN (Standard aus) ---------- */
const WEB_SCHEMA = { type: "object", additionalProperties: false, required: ["found", "isbn", "title", "author", "publisher", "year", "confidence"], properties: {
  found: { type: "boolean" }, isbn: { type: "string" }, title: { type: "string" }, author: { type: "string" }, publisher: { type: "string" }, year: { type: "string" },
  confidence: { type: "string", enum: ["high", "medium", "low"] } } };
async function webSearchItem(it, { run, model = aiModel() } = {}) {
  const messages = [{ role: "user", content: [{ type: "text", text: `Find the exact edition and its ISBN for this book from a German private library. Read from the spine: ${readLine(it)}. Search library catalogues or booksellers. Only report an ISBN that you actually found for this book (same title, author and – if given – volume and publisher); otherwise found=false.` }] }];
  let out = null;
  for (let turn = 0; turn < 3 && !out; turn++) { // pause_turn: weitermachen lassen
    const params = { model, max_tokens: AI_MAX_TOKENS, tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 }], output_config: { effort: "low", format: { type: "json_schema", schema: WEB_SCHEMA } }, messages };
    const j = await aiRequest(params, { run, step: "websuche", parse: x => x });
    if (j.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: j.content }); continue; }
    out = parseJSONLoose(aiText(j));
  }
  if (!out?.found || !toIsbn13(out.isbn)) return null;
  const rec = await lookupIsbn(toIsbn13(out.isbn)).catch(() => null); // jede gefundene ISBN im Katalog bestätigen
  if (!rec) return null;
  return { ...rec, isbn: toIsbn13(out.isbn), src: (rec.src ? rec.src + ", " : "") + "Websuche", _score: scoreCandidate(it, rec), _web: out.confidence };
}
async function webSearchItems(items, { run, onStatus } = {}) {
  if (!webSearchOn() || !aiKey()) return;
  const todo = items.filter(it => it.kind !== "other" && it.include !== false && it.choice < 0 && it.suggest === undefined && (it.title || "").trim());
  let n = 0;
  for (const it of todo) {
    onStatus && onStatus(`Websuche nach Ausgabe und ISBN (${++n}/${todo.length}) …`);
    try {
      const c = await webSearchItem(it, { run });
      if (!c) continue;
      it.cands = [c, ...it.cands.filter(x => x.isbn !== c.isbn)];
      // automatisch nur, wenn Titel klar übereinstimmt und Band passt – sonst Vorschlag
      const iv = itemVol(it), cv = candVol(c);
      if (c._web === "high" && overlap(it.title, c.title) >= 0.6 && (!iv || cv === iv)) { it.choice = 0; delete it.suggest; }
      else { it.choice = -1; it.suggest = 0; }
      it.webFound = true;
    } catch (e) { it.webError = e.message; }
  }
}

/* ---------- Einstellungen (in „Über die App & Einstellungen“ unter KI-Erkennung) ---------- */
function judgeSettingsBox() {
  const cb = (on, label, hint, set) => { const i = el("input", { type: "checkbox", checked: on || null }); i.addEventListener("change", () => { set(i.checked); toast("Gespeichert."); }); return el("label", { class: "prow" }, i, el("span", {}, el("b", { text: label }), el("div", { class: "saved", text: hint }))); };
  return el("div", { style: "margin-top:10px" },
    cb(judgeOn(), "Claude wählt den Katalogtreffer (Bildvergleich)", `Vergleicht Rücken bzw. Cover mit den Kandidaten-Covern – viel weniger falsche Treffer. Kostet zusätzlich ${fmtCents(shelfCostCents(25, { judge: true }) - shelfCostCents(25))} pro Fach.`, v => { try { localStorage.setItem("aiJudge", v ? "1" : "0"); } catch {} }),
    cb(webSearchOn(), "Websuche für Bücher ohne Treffer", `Claude sucht im Internet nach Ausgabe und ISBN (die ISBN wird im Katalog bestätigt). Kostet ${fmtCents(WEB_SEARCH_CENTS())} je gesuchtem Buch.`, v => { try { localStorage.setItem("aiWebSearch", v ? "1" : "0"); } catch {} }));
}
