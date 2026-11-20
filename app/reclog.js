/* Mein Bücherregal – Erkennungsprotokoll („Messen statt raten“).
   Bei jeder Erkennung (Fach-Foto, Cover-Foto, Barcode, Titelsuche, Titelliste) ein Lauf mit:
   Modell und Bildgrößen, roher KI-Antwort, Fehler, stop_reason, Dauer; je Buch die gelesenen Angaben, alle Katalogabfragen je Quelle
   (Treffer / Fehler / Zeitüberschreitung / gesperrt), Punktwerte der Kandidaten, gewählter Treffer und warum.
   Gespeichert lokal im Meta-Eintrag „recLog“ (die letzten 30 Läufe) – nicht in Sicherung und Abgleich.
   KI-Schlüssel, Google-Schlüssel und Serverzugang stehen nie darin (es werden keine Kopfzeilen und keine Adressen gespeichert,
   und beim Speichern wird zur Sicherheit alles entfernt, was wie ein Schlüssel aussieht). */
"use strict";

const RECLOG_MAX = 30, RECLOG_RAW = 60000;
let recLogList = null, recLogT = null;
async function recLogAll() {
  if (!recLogList) { try { recLogList = (await DB.getMeta("recLog")) || []; } catch { recLogList = []; } }
  return recLogList;
}
// Alles entfernen, was wie ein Zugang aussieht (Anthropic-Schlüssel, key=… in Adressen, Passwörter in Server-Adressen)
function recScrub(v) {
  return JSON.parse(JSON.stringify(v ?? null, (k, x) => typeof x !== "string" ? x
    : x.replace(/sk-ant-[A-Za-z0-9_\-]+/g, "[Schlüssel entfernt]").replace(/([?&](?:key|api_key|apikey)=)[^&\s"]+/gi, "$1[entfernt]").replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1[Zugang entfernt]@")));
}
function recSave() {
  clearTimeout(recLogT);
  recLogT = setTimeout(() => { if (recLogList) DB.setMeta("recLog", recScrub(recLogList.slice(0, RECLOG_MAX))).catch(() => {}); }, 400);
}
/* Neuer Lauf. kind: "fach-foto" | "cover" | "barcode" | "titelsuche" | "titelliste" | "stapel" | "eval" */
function recRun(kind, meta = {}) {
  let model = ""; try { model = aiKey() ? aiModel() : ""; } catch {}
  const run = { id: uid(), kind, at: new Date().toISOString(), model, ...meta, ai: [], books: [], searches: [] };
  recLogAll().then(l => { l.unshift(run); l.splice(RECLOG_MAX); recSave(); });
  return run;
}
function recAi(run, e) {
  if (!run) return;
  if (typeof e.raw === "string" && e.raw.length > RECLOG_RAW) e.raw = e.raw.slice(0, RECLOG_RAW) + " … [gekürzt]";
  run.ai.push(e); recSave();
}
const recPick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined && o[k] !== "" && o[k] !== null).map(k => [k, o[k]]));
// Ein Buch mit allem, was zur Entscheidung geführt hat
function recBook(run, it, queries) {
  if (!run) return;
  run.books.push({
    n: run.books.length + 1,
    gelesen: recPick(it, ["kind", "position", "title", "subtitle", "author", "publisher", "series", "volume", "series_no", "order_no", "isbn", "year", "confidence", "line", "spine_text_vertical", "spine_text_horizontal"]),
    abfragen: queries || [],
    kandidaten: (it.cands || []).map(c => recPick({ ...c, score: c._score != null ? Math.round(c._score * 10) / 10 : undefined }, ["title", "author", "publisher", "year", "isbn", "series", "seriesNo", "src", "score"])),
    gewaehlt: it.choice ?? -1,
    warum: typeof choiceWhy === "function" ? choiceWhy(it) : "",
    ...(it.judge ? { claude: it.judge } : {}), ...(it.judgeError ? { claudeFehler: it.judgeError } : {}), ...(it.webFound ? { websuche: true } : {}),
  });
  recSave();
}
// Einfache Suche (Titelsuche, Barcode) ohne Prüfliste
function recSearch(run, q, queries, n, note) {
  if (!run) return;
  run.searches.push(recPick({ q, abfragen: queries || [], treffer: n, hinweis: note }, ["q", "abfragen", "treffer", "hinweis"])); recSave();
}
function recEnd(run, extra) { if (!run) return; Object.assign(run, extra || {}); recSave(); }

/* ---------- Anzeigen / Teilen ---------- */
const REC_KIND = { "fach-foto": "📷 Fach-Foto", cover: "🖼 Cover-Foto", barcode: "▦ Barcode", titelsuche: "🔎 Titelsuche", titelliste: "📋 Titelliste", stapel: "📚 Stapel", eval: "🧪 Auswertung" };
function recSummary(r) {
  const errs = new Map();
  for (const q of [...r.books.flatMap(b => b.abfragen || []), ...r.searches.flatMap(s => s.abfragen || [])]) if (q.err) errs.set(q.src + ": " + q.err, (errs.get(q.src + ": " + q.err) || 0) + 1);
  const ai = r.ai.map(a => [a.step, a.err ? "Fehler: " + a.err : a.stop_reason, a.ms != null ? Math.round(a.ms / 100) / 10 + " s" : ""].filter(Boolean).join(" · "));
  const auto = r.books.filter(b => b.gewaehlt >= 0).length;
  return [
    r.books.length ? `${r.books.length} Bücher, ${auto} automatisch zugeordnet` : r.searches.length ? `${r.searches.length} Suche(n), ${r.searches.reduce((n, s) => n + (s.treffer || 0), 0)} Treffer` : "",
    ...ai.map(t => "KI: " + t),
    ...[...errs].map(([k, n]) => `⚠ ${k} (${n}×)`),
  ].filter(Boolean);
}
async function recLogFile() {
  const runs = recScrub(await recLogAll());
  return new File([JSON.stringify({ app: "buecherregal-protokoll", version: 1, exportedAt: new Date().toISOString(), runs }, null, 2)], `buecherregal-protokoll-${today()}.json`, { type: "application/json" });
}
async function openRecLog() {
  const runs = await recLogAll();
  const close = () => box.remove();
  const list = el("div", { class: "reclist" }, ...(runs.length ? runs.map(r => el("div", { class: "recrow" },
    el("b", { text: `${REC_KIND[r.kind] || r.kind} · ${new Date(r.at).toLocaleString("de-DE")}` }),
    r.model ? el("span", { class: "saved", text: " · " + r.model }) : null,
    ...recSummary(r).map(t => el("div", { class: "saved" + (t.startsWith("⚠") || t.includes("Fehler") || t.includes("max_tokens") ? " recwarn" : ""), text: t }))))
    : [el("div", { class: "saved", text: "Noch keine Erkennung protokolliert." })]));
  const share = async () => {
    const f = await recLogFile();
    try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: "Erkennungsprotokoll" }); return; } } catch (e) { if (e?.name === "AbortError") return; }
    saveFile(f.name, f);
  };
  const box = el("div", { class: "overlay confirm", style: "z-index:85", onclick: e => { if (e.target === box && !isMobile()) close(); } },
    el("div", { class: "sheet", style: "max-width:620px" },
      el("div", { class: "sheet-h" }, el("h2", { text: "🧾 Erkennungsprotokoll" }), el("button", { class: "x", onclick: close }, "✕")),
      el("div", { class: "sheet-b" },
        el("p", { class: "saved", style: "margin-top:0", text: `Die letzten ${RECLOG_MAX} Erkennungen: was die KI gelesen hat, welche Kataloge wie geantwortet haben und warum ein Treffer gewählt wurde (oder nicht). Bleibt nur auf diesem Gerät. Dein KI-Schlüssel steht nie darin.` }),
        list,
        el("div", { class: "actions" },
          el("button", { class: "btn ghost", onclick: async () => { if (await confirmBox("Das Protokoll löschen?", "Löschen")) { recLogList = []; await DB.setMeta("recLog", []).catch(() => {}); close(); toast("Protokoll gelöscht."); } } }, "Löschen"),
          el("div", { class: "covertools" }, el("button", { class: "btn", onclick: async () => { const f = await recLogFile(); saveFile(f.name, f); } }, "⬇ Als Datei"), el("button", { class: "btn primary", onclick: share }, "📤 Teilen"))))));
  document.body.append(box);
}
