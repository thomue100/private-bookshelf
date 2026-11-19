/* Mein Bücherregal – viele Fach-Fotos auf einmal erkennen (für die Ersterfassung einer ganzen Bibliothek).
   Ablauf: Fächer fotografieren („Nur speichern“) → „Alle erkennen“ schickt die Fotos als Sammelauftrag an die Anthropic-API
   (Message Batches, halber Preis, meist unter einer Stunde) → die App fragt regelmäßig nach und legt jede Erkennung als `scan`
   am Fach-Foto ab → „Der Reihe nach prüfen“ führt Fach für Fach durch die Prüfliste, Cover werden am Ende gesammelt nachgetragen.
   Klappt der Sammelauftrag nicht, geht es einzeln nacheinander (normaler Preis).
   Zwei Runden (spineread.js): erst alle Übersichten (Lage der Rücken, kind "ov"), dann alle Rücken in voller Auflösung (kind "read").
   Zwischen den Runden stehen die Übersichten im Auftragseintrag; scheitert das Absenden der zweiten Runde, bleibt er als "ovdone"
   stehen und wird beim nächsten Nachsehen erneut geschickt. Aufträge älterer Versionen (ohne kind) werden wie bisher ausgewertet.
   Laufende Sammelaufträge stehen nur auf diesem Gerät (localStorage „aiBatches“) – wie der KI-Schlüssel. */
"use strict";

const BATCH_CHUNK = 40; // Fotos je Sammelauftrag (hält die Anfrage klein genug)
function batchList() { try { return JSON.parse(localStorage.getItem("aiBatches") || "[]"); } catch { return []; } }
function setBatchList(l) { try { if (l.length) localStorage.setItem("aiBatches", JSON.stringify(l)); else localStorage.removeItem("aiBatches"); } catch {} }
const batchPhotoIds = () => new Set(batchList().flatMap(b => b.ids));
const unscannedPhotos = () => { const busy = batchPhotoIds(); return openPhotos().filter(p => p.blob && !p.scan && !busy.has(p.id)); };
const scannedPhotos = () => openPhotos().filter(p => p.blob && p.scan);
async function scanB64(photo) { const img = await loadImage(photo.blob); return blobToBase64(await canvasBlob(toCanvas(img, 1568), .88)); }

/* ---------- Sammelauftrag senden ---------- */
async function startBatchScan(photos, onStatus) {
  let sent = 0;
  for (let i = 0; i < photos.length; i += BATCH_CHUNK) {
    const part = photos.slice(i, i + BATCH_CHUNK), requests = [];
    const cid = {};
    for (const p of part) { onStatus(`Bereite Foto ${i + requests.length + 1} von ${photos.length} vor …`); const id = "o" + requests.length; cid[id] = p.id; requests.push({ custom_id: id, params: ovParams(await scanB64(p)) }); }
    onStatus("Sende an Claude …");
    let j;
    try { j = await postBatch(requests); } catch (e) { throw Object.assign(e, { sent }); }
    setBatchList([...batchList(), { id: j.id, kind: "ov", ids: part.map(p => p.id), cid, at: new Date().toISOString() }]);
    sent += part.length;
  }
  return sent;
}

async function postBatch(requests) {
  let r;
  try { r = await fetch(AI_API + "/v1/messages/batches", { method: "POST", headers: aiHeaders(), body: JSON.stringify({ requests }) }); }
  catch { throw new Error("Keine Verbindung zur KI (Internet prüfen)."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw aiError(r.status, j);
  return j;
}
/* Runde 2: zu jeder Übersicht die Rücken aus dem Originalfoto schneiden und als Sammelauftrag lesen lassen (je 8 Fotos ein Auftrag) */
async function submitReadBatches(ovs) {
  const entries = [], pids = Object.keys(ovs);
  for (let i = 0; i < pids.length; i += 8) {
    const part = pids.slice(i, i + 8), requests = [], cid = {};
    for (const pid of part) {
      const p = S.photos.find(x => x.id === pid && x.blob); if (!p) continue;
      const img = await loadImage(p.blob), src = toCanvas(img, SRC_MAX_PX);
      const books = ovs[pid].items.filter(it => it.kind === "book");
      for (let g = 0; g < books.length; g += READ_GROUP) {
        const imgs = [];
        for (let k = g; k < Math.min(books.length, g + READ_GROUP); k++) { const c = spineCanvas(src, books[k]); if (c) imgs.push({ n: k + 1, b64: await canvasB64(c) }); }
        if (!imgs.length) continue;
        const id = "r" + requests.length; cid[id] = { p: pid, ns: imgs.map(x => x.n) };
        requests.push({ custom_id: id, params: readParams(imgs) });
      }
      src.width = src.height = 0;
    }
    const ov = Object.fromEntries(part.map(pid => [pid, ovs[pid]]));
    if (!requests.length) { entries.push({ kind: "read", id: "", ids: part, cid, ov, empty: true }); continue; }
    const j = await postBatch(requests);
    entries.push({ id: j.id, kind: "read", ids: part, cid, ov, at: new Date().toISOString() });
  }
  return entries;
}
// Ergebnis eines fertigen Fotos (Runde 2) ablegen
async function finishReadPhoto(pid, data) {
  for (const it of data.items) if (it.kind === "book" && it.confidence === "low" && !it.title && !it.read_error) it.read_error = "im Sammelauftrag nicht gelesen";
  const p = S.photos.find(x => x.id === pid && !x.deletedAt);
  if (p && !p.scan) { await patchPhoto(pid, { scan: data, scanAt: new Date().toISOString() }); return true; }
  return false;
}

/* ---------- Ergebnisse abholen ---------- */
let batchBusy = false;
async function checkBatches({ loud = false } = {}) {
  const list = batchList();
  if (batchBusy || !list.length || !aiKey()) return;
  batchBusy = true;
  let got = 0, gotStack = 0, failed = 0, offline = false;
  const add = [];
  try {
    for (const b of list) {
      if (b.kind === "ovdone" || (b.kind === "read" && b.empty)) { // Runde 2 noch nicht abgeschickt bzw. nichts zu lesen
        if (b.empty) { for (const pid of b.ids) if (await finishReadPhoto(pid, b.ov[pid])) got++; b.drop = true; continue; }
        try { add.push(...await submitReadBatches(b.ov)); b.drop = true; } catch { offline = true; }
        continue;
      }
      let r;
      try { r = await fetch(`${AI_API}/v1/messages/batches/${b.id}`, { headers: aiHeaders() }); } catch { offline = true; break; }
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) { b.drop = true; continue; } // gibt es nicht mehr (z. B. anderer Schlüssel) – Fotos wieder freigeben
      if (!r.ok) continue;
      b.counts = j.request_counts || null;
      if (j.processing_status !== "ended") continue;
      let rr;
      try { rr = await fetch(j.results_url, { headers: aiHeaders() }); } catch { offline = true; break; }
      if (!rr.ok) continue;
      const ok = new Set(), lines = (await rr.text()).split("\n").filter(l => l.trim());
      if (b.kind === "ov") { // Runde 1 fertig: Übersichten sammeln, Runde 2 abschicken
        const ovs = {};
        for (const line of lines) {
          let res, ov = null, err = "";
          try { res = JSON.parse(line); if (res.result?.type === "succeeded") ov = ovToScan(ovFromMessage(res.result.message)); else err = res.result?.type || "unbekannt"; } catch (e) { err = e.message || "nicht lesbar"; }
          const m = res?.result?.message;
          recAi(recRun("fach-foto", { mode: "sammelauftrag" }), { step: "übersicht (Sammelauftrag)", model: m?.model, stop_reason: m?.stop_reason, usage: m?.usage, raw: m ? aiText(m) : "", err: ov ? undefined : err });
          const pid = res && (b.cid?.[res.custom_id] || res.custom_id);
          if (ov && pid && S.photos.some(x => x.id === pid && !x.deletedAt && !x.scan)) ovs[pid] = ov;
        }
        failed += b.ids.filter(id => !ovs[id] && S.photos.some(x => x.id === id && !x.deletedAt && !x.scan)).length;
        if (Object.keys(ovs).length) { try { add.push(...await submitReadBatches(ovs)); } catch { add.push({ kind: "ovdone", id: "", ids: Object.keys(ovs), ov: ovs, at: new Date().toISOString() }); } }
        b.drop = true; continue;
      }
      if (b.kind === "read") { // Runde 2 fertig: gelesene Rücken in die Übersichten übernehmen
        for (const line of lines) {
          let res, spines = null, err = "";
          try { res = JSON.parse(line); if (res.result?.type === "succeeded") spines = readFromMessage(res.result.message); else err = res.result?.type || "unbekannt"; } catch (e) { err = e.message || "nicht lesbar"; }
          const m = res?.result?.message, c = res && b.cid?.[res.custom_id];
          recAi(recRun("fach-foto", { mode: "sammelauftrag" }), { step: "rücken (Sammelauftrag)", model: m?.model, stop_reason: m?.stop_reason, usage: m?.usage, raw: m ? aiText(m) : "", err: spines ? undefined : err });
          if (!c || !b.ov[c.p]) continue;
          const books = b.ov[c.p].items.filter(it => it.kind === "book");
          for (const n of c.ns) { const r = spines?.find(x => +x.n === n); if (r) applyRead(books[n - 1], r); else if (books[n - 1]) books[n - 1].read_error = err || "nicht gelesen"; }
        }
        for (const pid of b.ids) if (b.ov[pid] && await finishReadPhoto(pid, b.ov[pid])) got++;
        b.drop = true; continue;
      }
      for (const line of lines) {
        if (b.kind === "stack") { // Cover-Erkennung für den Stapel-Modus (stackscan.js)
          let res, d = null;
          try { res = JSON.parse(line); if (res.result?.type === "succeeded") d = parseJSONLoose((res.result.message.content || []).filter(c => c.type === "text").map(c => c.text).join("")); } catch {}
          if (res && d && await stackRecognized(res.custom_id, d)) gotStack++;
          continue;
        }
        let res, data = null, err = "";
        try { res = JSON.parse(line); if (res.result?.type === "succeeded") data = scanFromMessage(res.result.message); else err = res.result?.type || "unbekannt"; } catch (e) { err = e.message || "nicht lesbar"; }
        const m = res?.result?.message;
        recAi(recRun("fach-foto", { mode: "sammelauftrag" }), { step: "fach (Sammelauftrag)", model: m?.model, stop_reason: m?.stop_reason, usage: m?.usage, raw: m ? aiText(m) : "", err: data ? undefined : err });
        const p = res && S.photos.find(x => x.id === res.custom_id && !x.deletedAt);
        if (!p) continue;
        if (data && !p.scan) { await patchPhoto(p.id, { scan: data, scanAt: new Date().toISOString() }); got++; ok.add(p.id); }
        else if (data) ok.add(p.id);
      }
      if (b.kind !== "stack") failed += b.ids.filter(id => !ok.has(id) && S.photos.some(x => x.id === id && !x.deletedAt && !x.scan)).length;
      b.drop = true; // nicht erkannte Fotos sind damit wieder frei für „Alle erkennen“
    }
  } finally {
    setBatchList([...list.filter(b => !b.drop), ...add]);
    batchBusy = false;
  }
  if (got) toast(`🤖 ${got} Fach-Foto${got === 1 ? "" : "s"} erkannt – bitte prüfen und einsortieren.`, 5000);
  if (failed) toast(`${failed} Foto${failed === 1 ? " konnte" : "s konnten"} nicht erkannt werden – bitte nochmal „Alle erkennen“.`, 6000);
  if (gotStack) toast(`📚 ${gotStack} ${gotStack === 1 ? "Buch" : "Bücher"} aus dem Stapel erkannt – bitte prüfen.`, 5000);
  if (loud && !got && !gotStack && !failed) toast(offline ? "Keine Verbindung – später nochmal nachsehen." : "Claude arbeitet noch – bitte etwas später nachsehen.");
  if (openSheet?.redraw) openSheet.redraw();
  if (got && location.hash === "#wand" && !openSheet) renderAll();
}

/* ---------- Ohne Sammelauftrag: einzeln nacheinander (normaler Preis) ---------- */
async function directScanAll(photos, onStatus, alive) {
  let n = 0, bad = 0;
  for (const p of photos) {
    if (!alive()) break;
    onStatus(`Erkenne Foto ${n + 1} von ${photos.length} … (je Foto meist 20–60 Sekunden)`);
    try {
      await patchPhoto(p.id, { scan: await aiScanShelf2(p.blob, null, recRun("fach-foto", { mode: "einzeln" })), scanAt: new Date().toISOString() });
    } catch (e) { bad++; if (/Schlüssel|Modell|Verbindung/.test(e.message || "")) { toast(e.message, 5000); break; } }
    n++;
  }
  return { n, bad };
}

/* ---------- Der Reihe nach prüfen ---------- */
// Der Ablauf überlebt einen Neustart (localStorage „reviewChain“, nur Gerät): danach geht es mit dem nächsten Fach weiter
function chainSave() { try { if (S.reviewChain) localStorage.setItem("reviewChain", JSON.stringify({ noCov: S.chainNoCov || [] })); else localStorage.removeItem("reviewChain"); } catch {} }
function chainRestore() { try { const c = JSON.parse(localStorage.getItem("reviewChain") || "null"); if (c) { S.reviewChain = true; S.chainNoCov = c.noCov || []; } return !!c; } catch { return false; } }
function startReviewChain() {
  const first = scannedPhotos()[0]; if (!first) return;
  S.reviewChain = true; S.chainNoCov = []; chainSave();
  runShelfScan(first, "stored");
}
function nextReview() {
  const next = scannedPhotos()[0];
  if (next) { runShelfScan(next, "stored"); return; }
  endReviewChain(true);
}
async function endReviewChain(all) {
  if (!S.reviewChain) return;
  const noCov = (S.chainNoCov || []).filter(id => { const b = S.books.find(x => x.id === id); return b && needsCover(b); });
  S.reviewChain = false; S.chainNoCov = []; chainSave();
  if (all) toast("Alle erkannten Fächer sind geprüft und einsortiert.", 4500);
  if (noCov.length && await confirmBox(`${noCov.length} der neuen Bücher ${noCov.length === 1 ? "hat" : "haben"} noch kein Cover.\nJetzt online nachtragen? (Eindeutige Treffer werden übernommen, sonst wird gefragt.)`, "Cover suchen")) coverRun(noCov);
}

/* ---------- Kasten oben in „Gespeicherte Fach-Fotos“ ---------- */
function batchInboxBox(redraw) {
  const todo = unscannedPhotos(), ready = scannedPhotos(), running = batchList();
  const waiting = running.reduce((n, b) => n + b.ids.filter(id => S.photos.some(p => p.id === id && !p.deletedAt && !p.scan)).length, 0);
  if (!todo.length && !ready.length && !waiting) return null;
  const parts = [];
  if (todo.length && !aiKey()) parts.push(el("div", { class: "note info" },
    `${todo.length} Foto${todo.length === 1 ? "" : "s"} noch nicht erkannt. Mit einem KI-Schlüssel erkennt die App alle auf einmal (Sammelauftrag, halber Preis) – `,
    el("a", { href: "#", onclick: e => { e.preventDefault(); aboutBox(); } }, "einrichten"), ". Ohne Schlüssel: jedes Foto einzeln über deinen Claude-Chat."));
  if (todo.length && aiKey()) {
    const status = el("div", { class: "saved" });
    const btn = el("button", { class: "btn primary" }, `🤖 Alle ${todo.length} Foto${todo.length === 1 ? "" : "s"} erkennen`);
    btn.addEventListener("click", async () => {
      const sh = openSheet; btn.disabled = true;
      try {
        const n = await startBatchScan(todo, t => status.textContent = t);
        toast(`${n} Foto${n === 1 ? "" : "s"} an Claude geschickt. Das dauert meist unter einer Stunde – du kannst die App solange schließen.`, 6000);
      } catch (e) {
        status.textContent = "";
        if (e.sent) toast(`${e.sent} Fotos sind unterwegs, der Rest nicht: ${e.message}`, 6000);
        else if (await confirmBox(`Der Sammelauftrag hat nicht geklappt:\n${e.message}\n\nStattdessen jedes Foto einzeln erkennen? (normaler Preis, die App muss dabei offen bleiben)`, "Einzeln erkennen")) {
          const left = unscannedPhotos();
          const { n, bad } = await directScanAll(left, t => { if (status.isConnected) status.textContent = t; }, () => openSheet === sh);
          toast(`${n - bad} von ${left.length} Fotos erkannt.`, 4500);
        }
      }
      redraw();
    });
    parts.push(el("div", { class: "note info batchbox" },
      el("b", { text: "Viele Fächer auf einmal" }),
      el("div", { text: "Schickt alle noch nicht erkannten Fotos in einem Rutsch an Claude (Sammelauftrag zum halben Preis). Meist ist alles in unter einer Stunde fertig – die App muss dabei nicht offen bleiben." }),
      el("div", { class: "covertools", style: "margin-top:8px" }, btn), status));
  }
  if (waiting) parts.push(el("div", { class: "note info batchrun" },
    el("b", { text: `⏳ ${waiting} Foto${waiting === 1 ? " wird" : "s werden"} gerade von Claude erkannt.` }),
    " Die App sieht regelmäßig nach. ",
    el("button", { class: "btn sm", onclick: () => checkBatches({ loud: true }) }, "Jetzt nachsehen")));
  if (ready.length) parts.push(el("div", { class: "covertools", style: "margin:4px 0 12px" },
    el("button", { class: "btn primary", onclick: startReviewChain }, `✓ ${ready.length} erkannte${ready.length === 1 ? "s Fach" : " Fächer"} der Reihe nach prüfen & einsortieren`)));
  return el("div", {}, ...parts);
}

/* ---------- Start: laufende Sammelaufträge regelmäßig abfragen ---------- */
(async () => {
  await new Promise(r => { const t = setInterval(() => { if (S.loaded && document.readyState !== "loading") { clearInterval(t); r(); } }, 50); });
  const tick = () => { if (document.visibilityState === "visible" && batchList().length) checkBatches(); };
  tick();
  setInterval(tick, 60_000);
  document.addEventListener("visibilitychange", tick);
})();
