/* Mein Bücherregal – Buchrücken einzeln und scharf lesen (zweistufig).
   Runde 1 (Übersicht, Claude Haiku 5.5): nur Lage und Reihenfolge der Objekte im verkleinerten Foto – Rahmen (bbox), bei schrägen
   Rücken die vier Ecken (quad), Position, Buch oder nicht, Schriftrichtung, Farben.
   Runde 2 (Lesen, eingestelltes Modell): jeder Rücken wird aus dem Originalfoto (bis 3000 px) geschnitten, bei schrägem Viereck
   entzerrt (perspective.js), so gedreht, dass die Schrift waagerecht liegt, und in Gruppen von READ_GROUP Bildern gelesen.
   Beide Runden mit strukturierter Ausgabe (output_config.format, JSON-Schema) und effort „low“. Zeigt ein Ausschnitt keinen oder zwei
   Rücken, wird der Rahmen angepasst und einmal neu gelesen. Eine abgeschnittene Antwort wird in kleineren Gruppen nachgefordert.
   Ergebnis hat dasselbe Format wie bisher ({compartment, items}) – Prüfliste, Sammelauftrag, Sicherung bleiben gleich.
   Ohne Schlüssel (Claude-Chat): Runde 1 ist die bisherige Anfrage mit dem ganzen Foto; unsichere Rücken lassen sich danach als
   Collage aus nummerierten, waagerechten Ausschnitten genauer lesen. */
"use strict";

const OV_MODEL = "claude-haiku-5-5";
const READ_GROUP = 8;          // Rücken je Anfrage
const READ_MAX_PX = 1200;      // längste Seite eines Rücken-Bilds (Schrift gut lesbar groß, unter der API-Verkleinerung von 1568 px)
const SRC_MAX_PX = 3000;       // Originalfoto zum Ausschneiden
const AI_MAX_TOKENS = 16000;   // Denk-Tokens zählen mit – großzügig, damit nichts abgeschnitten wird

/* ---------- Kosten (Preise je 1 Mio. Tokens: Eingabe, Ausgabe) ---------- */
const AI_PRICES = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
// Grobe Schätzung in Cent für ein Fach mit n Büchern; judge = Treffer-Wahl mit Bildvergleich (Stufe 4)
function shelfCostCents(n = 25, { batch = false, judge = false, model = aiModel() } = {}) {
  const [ri, ro] = AI_PRICES[model] || AI_PRICES["claude-sonnet-5-5"], [hi, ho] = AI_PRICES[OV_MODEL];
  const groups = Math.ceil(n / READ_GROUP);
  let usd = (3300 * hi + 2500 * ho) / 1e6;                                       // Übersicht
  usd += ((n * 260 + groups * 700) * ri + (n * 120 + groups * 600) * ro) / 1e6;   // Rücken lesen
  usd *= batch ? 0.5 : 1;
  if (judge) usd += ((n * 900) * ri + (n * 100 + groups * 400) * ro) / 1e6;       // Kandidaten-Cover vergleichen (immer direkt, nicht im Sammelauftrag)
  return usd * 100;
}
const fmtCents = c => c < 1 ? "unter 1 ct" : `ca. ${Math.round(c)} ct`;
function shelfCostText(n = 25) {
  const j = typeof judgeOn === "function" && judgeOn();
  return `${fmtCents(shelfCostCents(n, { judge: j }))} pro Fach (bei ~${n} Büchern; Sammelauftrag ${fmtCents(shelfCostCents(n, { judge: j, batch: true }))})`;
}

/* ---------- Runde 1: Übersicht ---------- */
const OV_PROMPT = `You are cataloguing a private home library. The photo shows ONE compartment of a bookshelf.
Locate every object: books standing in the row, books lying flat in the row, books lying on top of the row, books in a second row behind, and non-book objects (CDs, DVDs, boxes, folders, maps, decoration).
Order: front row left to right, then lying-on-top items from top to bottom, then the back row left to right. Number them n = 1, 2, 3 … in this order.
For each object:
- kind: "book" or "other"; label: for "other" what it is, for books "".
- position: standing | lying_in_row | lying_on_top | behind.
- bbox: fractions of the image width/height (x0,y0 = top-left, x1,y1 = bottom-right), tight around the visible spine only (not the neighbours).
- quad: only if the spine is clearly tilted or seen at an angle: its 4 corners as [x1,y1,x2,y2,x3,y3,x4,y4] (fractions), clockwise starting at the top-left corner as the book stands upright; otherwise null.
- text_direction: "up" if the spine text reads bottom-to-top, "down" if top-to-bottom, "horizontal" if the letters are horizontal.
- spine_color, text_color: hex like "#8b1e2d".
- hint: up to 6 words of the most prominent legible spine text, else "".
compartment: the inner edges of the compartment (fractions).
Do NOT try to read full titles — every spine is read in a second step at full resolution.`;
const NUM = { type: "number" }, STR = { type: "string" };
const BOX = { type: "object", additionalProperties: false, required: ["x0", "y0", "x1", "y1"], properties: { x0: NUM, y0: NUM, x1: NUM, y1: NUM } };
const OV_SCHEMA = { type: "object", additionalProperties: false, required: ["compartment", "items"], properties: {
  compartment: BOX,
  items: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["n", "kind", "label", "position", "bbox", "quad", "text_direction", "spine_color", "text_color", "hint"],
    properties: {
      n: { type: "integer" }, kind: { type: "string", enum: ["book", "other"] }, label: STR,
      position: { type: "string", enum: ["standing", "lying_in_row", "lying_on_top", "behind"] },
      bbox: BOX, quad: { anyOf: [{ type: "array", items: NUM }, { type: "null" }] },
      text_direction: { type: "string", enum: ["up", "down", "horizontal"] }, spine_color: STR, text_color: STR, hint: STR } } } } };
const structured = (schema, model, max = AI_MAX_TOKENS) => ({ model, max_tokens: max, output_config: { effort: "low", format: { type: "json_schema", schema } } });
const ovParams = (b64, max) => ({ ...structured(OV_SCHEMA, OV_MODEL, max), messages: [{ role: "user", content: [
  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: OV_PROMPT }] }] });
function ovFromMessage(m) {
  if (m?.stop_reason === "refusal") throw new Error("Die KI hat das Foto nicht bearbeitet.");
  const d = parseJSONLoose(aiText(m));
  if (!Array.isArray(d.items)) throw new Error("Die KI hat keine Liste geliefert.");
  return d;
}
const clamp01 = v => Math.min(1, Math.max(0, +v || 0));
// Übersicht → bisheriges Erkennungsformat (Lesefelder kommen in Runde 2 dazu)
function ovToScan(ov) {
  const items = [...ov.items].sort((a, b) => (a.n || 0) - (b.n || 0)).map(o => {
    const b = o.bbox || {}, bbox = { x0: clamp01(Math.min(b.x0, b.x1)), y0: clamp01(Math.min(b.y0, b.y1)), x1: clamp01(Math.max(b.x0, b.x1)), y1: clamp01(Math.max(b.y0, b.y1)) };
    const q = Array.isArray(o.quad) && o.quad.length === 8 ? validQuad([0, 2, 4, 6].map(i => [o.quad[i], o.quad[i + 1]])) : null;
    return { kind: o.kind === "other" ? "other" : "book", label: o.label || "", position: o.position || "standing", bbox, ...(q ? { quad: q } : {}),
      text_direction: o.text_direction || "up", spine_color: o.spine_color || "", text_color: o.text_color || "",
      title: "", author: "", spine_text_vertical: o.hint || "", confidence: "low" };
  });
  return { compartment: ov.compartment || { x0: 0, y0: 0, x1: 1, y1: 1 }, items, two_stage: 1 };
}

/* ---------- Rücken ausschneiden ---------- */
const spineLying = it => it.position === "lying_in_row" || it.position === "lying_on_top";
// Rücken aus dem Originalfoto: entzerrt (quad) oder Rahmen mit Rand; widen/narrow passen den Rahmen beim zweiten Versuch an.
// turn: so drehen, dass die Schrift waagerecht liegt (zum Lesen); ohne turn stehend (fürs echte Regal).
function spineCanvas(src, it, { widen = false, narrow = false, turn = true, max = READ_MAX_PX } = {}) {
  let c = null;
  if (it.quad && !widen && !narrow && !spineLying(it)) { try { c = warpCanvas(src, it.quad, 2400); } catch { c = null; } }
  if (!c) {
    const b = it.bbox, bw = b.x1 - b.x0, bh = b.y1 - b.y0, f = widen ? 0.6 : narrow ? -0.2 : 0.12;
    const box = spineLying(it) ? { x0: b.x0 - bw * 0.02, x1: b.x1 + bw * 0.02, y0: b.y0 - bh * f, y1: b.y1 + bh * f }
      : { x0: b.x0 - bw * f, x1: b.x1 + bw * f, y0: b.y0 - bh * 0.02, y1: b.y1 + bh * 0.02 };
    c = cropSpine(src, { bbox: box }, null, 2400);
    if (!c) return null;
    if (!turn && spineLying(it)) c = rotateCanvas(c, -90); // liegend → stehender Rücken
  }
  if (turn && !spineLying(it)) { if (it.text_direction === "up") c = rotateCanvas(c, 90); else if (it.text_direction === "down") c = rotateCanvas(c, -90); }
  const s = Math.min(1, max / Math.max(c.width, c.height));
  if (s < 1) { const o = document.createElement("canvas"); o.width = Math.max(1, Math.round(c.width * s)); o.height = Math.max(1, Math.round(c.height * s)); const g = o.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, o.width, o.height); c = o; }
  return c;
}
const canvasB64 = async c => blobToBase64(await canvasBlob(c, .85));

/* ---------- Runde 2: Rücken lesen ---------- */
const READ_PROMPT = `Each image above is ONE book spine cut out of a bookshelf photo and rotated so that the text runs roughly horizontally (it may still be upside down). The text before each image gives its number.
For every number, read the spine exactly as printed:
- title, subtitle, author (full name as printed), publisher (also imprint or logo text such as "dtv", "rororo", "Fischer", "Reclam")
- series and volume: only if the book belongs to a numbered series (e.g. "Weihnachtsgeschichten am Kamin", volume "27")
- order_no: a publisher order number (e.g. "rororo 13427" → "13427"), isbn: only if printed
- spine_text: all legible text on the spine in reading order
- books_in_image: how many different book spines are the main subject of the image (0 = no spine / only background, 2 = clearly two spines side by side, else 1)
- confidence: "high" if title and author are clearly legible, "medium" if partly guessed, "low" if mostly unreadable
Use "" for anything not printed or not legible — never invent or complete from memory.`;
const READ_SCHEMA = { type: "object", additionalProperties: false, required: ["spines"], properties: {
  spines: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["n", "books_in_image", "title", "subtitle", "author", "publisher", "series", "volume", "order_no", "isbn", "spine_text", "confidence"],
    properties: { n: { type: "integer" }, books_in_image: { type: "integer" }, title: STR, subtitle: STR, author: STR, publisher: STR, series: STR, volume: STR,
      order_no: STR, isbn: STR, spine_text: STR, confidence: { type: "string", enum: ["high", "medium", "low"] } } } } } };
const readParams = (imgs, model = aiModel(), max) => ({ ...structured(READ_SCHEMA, model, max), messages: [{ role: "user", content: [
  ...imgs.flatMap(x => [{ type: "text", text: `Rücken Nr. ${x.n}:` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: x.b64 } }]),
  { type: "text", text: READ_PROMPT }] }] });
function readFromMessage(m) {
  if (m?.stop_reason === "refusal") throw new Error("Die KI hat die Rücken nicht gelesen.");
  const d = parseJSONLoose(aiText(m));
  if (!Array.isArray(d.spines)) throw new Error("Die KI hat keine Rücken-Liste geliefert.");
  return d.spines;
}
// Gelesenes in die Zeile übernehmen
function applyRead(it, r) {
  for (const k of ["title", "subtitle", "author", "publisher", "series", "volume", "order_no", "isbn"]) it[k] = String(r[k] || "").trim();
  if (it.volume && !it.series_no) it.series_no = it.volume;
  if (r.spine_text) it.spine_text_vertical = r.spine_text;
  it.confidence = r.confidence || "medium";
  it.books_in_image = r.books_in_image;
  delete it.read_error;
}
/* Liest die Rücken der Zeilen items aus dem Originalfoto src (Canvas). Zwei Gruppen gleichzeitig. */
// nOf: Nummer je Rücken (Standard: Reihenfolge in items) – beim erneuten Lesen bleibt die Nummer des Buchs im Fach
async function readSpines(src, items, { run, onStatus, model = aiModel(), nOf } = {}) {
  const jobs = items.map((it, i) => ({ it, n: nOf ? nOf(it) : i + 1 }));
  let done = 0, firstErr = null;
  const readGroup = async (group, opt = {}) => {
    const imgs = [];
    for (const j of group) { const c = spineCanvas(src, j.it, opt); if (c) imgs.push({ n: j.n, b64: await canvasB64(c), w: c.width, h: c.height }); }
    if (!imgs.length) return [];
    try {
      return await aiRequest(readParams(imgs, model), { run, step: "rücken" + (opt.widen ? " (breiter)" : opt.narrow ? " (schmaler)" : ""), imgs: imgs.map(x => ({ n: x.n, w: x.w, h: x.h })), parse: readFromMessage });
    } catch (e) {
      if (/abgeschnitten/.test(e.message) && group.length > 1) { const h = Math.ceil(group.length / 2); return [...await readGroup(group.slice(0, h), opt), ...await readGroup(group.slice(h), opt)]; }
      throw e;
    }
  };
  const apply = (group, res) => { for (const j of group) { const r = res.find(x => +x.n === j.n); if (r) applyRead(j.it, r); } };
  const groups = []; for (let i = 0; i < jobs.length; i += READ_GROUP) groups.push(jobs.slice(i, i + READ_GROUP));
  const queue = [...groups];
  await Promise.all([0, 1].map(async () => {
    while (queue.length) {
      const g = queue.shift();
      try { apply(g, await readGroup(g)); } catch (e) { firstErr = firstErr || e; for (const j of g) { j.it.read_error = e.message; j.it.confidence = "low"; } }
      done += g.length; onStatus && onStatus(`Schritt 2/2: Buchrücken werden gelesen (${Math.min(done, jobs.length)}/${jobs.length}) …`);
    }
  }));
  if (firstErr && jobs.every(j => j.it.read_error)) throw firstErr;
  // Ausschnitt zeigt keinen oder zwei Rücken → Rahmen anpassen und einmal neu lesen, sonst unsicher
  for (const kind of ["widen", "narrow"]) {
    const again = jobs.filter(j => kind === "widen" ? j.it.books_in_image === 0 : j.it.books_in_image >= 2);
    for (let i = 0; i < again.length; i += READ_GROUP) {
      const g = again.slice(i, i + READ_GROUP);
      try { apply(g, await readGroup(g, { [kind]: true })); } catch {}
    }
  }
  for (const j of jobs) if (j.it.books_in_image !== undefined && j.it.books_in_image !== 1) {
    j.it.confidence = "low";
    j.it.spine_problem = j.it.books_in_image === 0 ? "Im Ausschnitt war kein Buchrücken zu sehen" : "Im Ausschnitt waren zwei Buchrücken";
  }
  return items;
}
/* Zweistufige Erkennung eines Fach-Fotos mit API-Schlüssel → {compartment, items} */
async function aiScanShelf2(file, onStatus, run) {
  if (!aiKey()) throw new Error("Kein KI-Schlüssel eingetragen.");
  const img = await loadImage(file);
  const ovc = toCanvas(img, 1568), jpeg = await canvasBlob(ovc, .88), b64 = await blobToBase64(jpeg);
  onStatus && onStatus("Schritt 1/2: Lage der Buchrücken wird erkannt …");
  const ovReq = max => aiRequest(ovParams(b64, max), { run, step: "übersicht", imgs: [{ w: ovc.width, h: ovc.height, bytes: jpeg.size }], parse: ovFromMessage });
  let ov;
  try { ov = await ovReq(); } catch (e) { if (!/abgeschnitten/.test(e.message)) throw e; ov = await ovReq(32000); } // sehr volles Fach: Rest nachfordern
  const data = ovToScan(ov);
  const src = toCanvas(img, SRC_MAX_PX);
  await readSpines(src, data.items.filter(it => it.kind === "book"), { run, onStatus });
  src.width = src.height = 0;
  return data;
}

/* ---------- Ohne Schlüssel: Collage nummerierter Rücken für die Claude-Chat-Brücke ---------- */
const READ_CHAT_PROMPT = `Das Bild ist eine Collage aus Buchrücken eines Bücherregals. Jeder Streifen ist EIN Buchrücken, waagerecht gedreht; links steht seine Nummer.
Lies jeden Rücken genau so, wie er gedruckt ist, und antworte mit JSON: {"spines":[{"n":1,"books_in_image":1,"title":"","subtitle":"","author":"","publisher":"","series":"","volume":"","order_no":"","isbn":"","spine_text":"","confidence":"high|medium|low"}]}
publisher auch Verlagslogo (dtv, rororo …); series/volume nur bei nummerierten Reihen; order_no = Verlagsnummer; books_in_image = 0, wenn kein Rücken zu sehen ist, 2 bei zwei Rücken; leere Angabe "" statt raten.`;
async function spineCollages(src, items, per = 10) {
  const out = [];
  for (let i = 0; i < items.length; i += per) {
    const part = items.slice(i, i + per), strips = [];
    for (const it of part) { const c = spineCanvas(src, it, { max: 1300 }); if (c) strips.push({ it, c }); }
    const H = 130, L = 80, W = 1380;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = strips.length * (H + 8) + 8;
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    const map = {};
    strips.forEach(({ it, c }, k) => {
      const n = i + k + 1, y = 8 + k * (H + 8), s = Math.min((W - L - 8) / c.width, H / c.height);
      g.fillStyle = "#111"; g.font = "bold 48px sans-serif"; g.textBaseline = "middle"; g.fillText(String(n), 10, y + H / 2);
      g.drawImage(c, L, y + (H - c.height * s) / 2, c.width * s, c.height * s);
      map[n] = it;
    });
    out.push({ blob: await canvasBlob(cv, .88), map });
  }
  return out;
}

/* ---------- Prüfliste: unsichere Rücken genauer lesen (mit Schlüssel per API, sonst über die Chat-Brücke) ---------- */
// src (optional): Originalfoto – dann vergleicht Claude danach Rücken und Kandidaten (judge.js); nOf: Nummer im Fach
async function rematchItems(items, run, { src, nOf, onStatus } = {}) {
  const logs = new Map();
  for (const it of items) {
    const log = []; logs.set(it, log);
    try { it.cands = await matchItem(it, log); it.offline = false; } catch { it.cands = []; it.offline = true; }
    it.choice = autoChoice(it); it.confirmed = false;
    if (typeof clearJudge === "function") clearJudge(it);
  }
  if (src && typeof judgeScan === "function") await judgeScan(items, { src, run, nOf, onStatus });
  if (typeof recBook === "function") for (const it of items) recBook(run, it, logs.get(it));
}
async function rereadUnsure(sh, st) {
  const list = st.items.filter(it => it.kind !== "other" && it.include && isUnsure(it) && it.bbox);
  if (!list.length) { toast("Keine unsicheren Buchrücken."); return; }
  const src = await fullScanCanvas(st);
  const run = typeof recRun === "function" ? recRun("fach-foto", { mode: "genauer lesen", anzahl: list.length }) : null;
  const finish = async () => {
    const msg = busyView("Buchdaten werden gesucht", null, "…");
    const books = st.items.filter(it => it.kind !== "other");
    await rematchItems(list, run, { src, nOf: it => books.indexOf(it) + 1, onStatus: t => { msg.textContent = t; } });
    resolveCollisions(st.items); for (const it of st.items) it.dup = scanDup(it);
    if (st.photo) await photoReviewSave(st, true);
    scanReview(sh, st);
  };
  if (aiKey()) {
    const msg = busyView("Unsichere Rücken genauer lesen", null, "…");
    const books = st.items.filter(it => it.kind !== "other");
    try { await readSpines(src, list, { run, onStatus: t => { msg.textContent = t; }, nOf: it => books.indexOf(it) + 1 }); }
    catch (e) { toast("Lesen hat nicht geklappt: " + (e.message || e), 5000); scanReview(sh, st); return; }
    return finish();
  }
  const collages = await spineCollages(src, list);
  let k = 0;
  const next = () => {
    if (k >= collages.length) { finish(); return; }
    const col = collages[k];
    claudeChatBridge(sh, { title: `💬 Rücken genauer lesen${collages.length > 1 ? ` (${k + 1}/${collages.length})` : ""}`, prompt: READ_CHAT_PROMPT, jpeg: col.blob, fileName: `ruecken-${k + 1}.jpg`,
      onBack: () => scanReview(sh, st),
      accept: d => Array.isArray(d?.spines),
      onResult: d => { for (const r of d.spines || []) { const it = col.map[+r.n]; if (it) applyRead(it, r); } if (typeof recAi === "function") recAi(run, { step: "rücken (Claude-Chat)", raw: JSON.stringify(d) }); k++; next(); } });
  };
  next();
}
