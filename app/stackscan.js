/* Mein Bücherregal – „📚 Stapel erfassen“ (Fließband für viele Bücher).
   Die Kamera bleibt offen: Barcode → Piep → optional Cover- und Rückenfoto → nächstes Buch. Bücher ohne Barcode: Cover fotografieren.
   Jeder Schritt wird sofort im Store „stack“ gespeichert (IndexedDB Version 4) – schließt Android die App, geht nichts verloren.
   Buchdaten lädt die App im Hintergrund; Bücher ohne Barcode erkennt Claude später (Sammelauftrag in batchscan.js, ohne Schlüssel
   über die Claude-Chat-Brücke). Am Ende eine gesammelte Prüfliste, „Alle übernehmen“ legt die Bücher an.
   Der Stapel bleibt nur auf diesem Gerät: nicht in Sicherung und Abgleich (er ist nur ein Zwischenspeicher bis zum Übernehmen).
   Eintrag: { id, createdAt, updatedAt, isbn?, coverBlob?, spineBlob?, rec?, sure?, lookupAt?, recog?, recogAt? } */
"use strict";

const stackOpen = () => (S.stack || []).slice().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
const stackUrls = new Map();
function stackUrl(e) { if (!e?.coverBlob) return null; const c = stackUrls.get(e.id); if (c && c.blob === e.coverBlob) return c.url; if (c) URL.revokeObjectURL(c.url); const url = URL.createObjectURL(e.coverBlob); stackUrls.set(e.id, { blob: e.coverBlob, url }); return url; }
async function putStackEntry(e) {
  e.updatedAt = new Date().toISOString();
  await DB.putStack(e);
  const i = S.stack.findIndex(x => x.id === e.id); if (i >= 0) S.stack[i] = e; else S.stack.push(e);
  if (openSheet?.stackView) openSheet.redraw();
  return e;
}
async function patchStackEntry(id, patch) { const e = S.stack.find(x => x.id === id); return e ? putStackEntry({ ...e, ...patch }) : null; }
async function dropStackEntry(id) {
  await DB.delStack(id); S.stack = S.stack.filter(x => x.id !== id);
  const c = stackUrls.get(id); if (c) { URL.revokeObjectURL(c.url); stackUrls.delete(id); }
}
const newStackEntry = data => putStackEntry({ id: uid(), createdAt: new Date().toISOString(), ...data });

/* ---------- Hintergrund: Buchdaten zur ISBN bzw. zur Erkennung suchen (nacheinander, offline → später) ---------- */
let stackBusy = false;
async function stackWork() {
  if (stackBusy) return; stackBusy = true;
  try {
    for (;;) {
      const e = S.stack.find(x => !x.lookupAt && (x.isbn || x.recog)); if (!e) break;
      let res;
      try { res = await stackMatch(e); } catch { break; } // keine Verbindung – beim nächsten Öffnen weiter
      if (!S.stack.some(x => x.id === e.id)) continue;   // inzwischen übernommen oder verworfen
      await patchStackEntry(e.id, { ...res, lookupAt: new Date().toISOString() });
    }
  } finally { stackBusy = false; }
}
async function stackMatch(e) {
  const d = e.recog || {};
  const isbn = e.isbn || toIsbn13(d.isbn);
  if (isbn) {
    const rec = await lookupIsbn(isbn);
    if (rec) return { rec, sure: true };
    if (!d.title) return { rec: { isbn }, sure: false };
  }
  if (!d.title) return { rec: null, sure: false };
  const q = [d.title, firstAuthorLast(d.author)].filter(Boolean).join(" ");
  const list = await searchBooks(q);
  const best = list.find(r => overlap(r.title, d.title) >= 0.5);
  // nur über Titel gefunden: immer nachfragen (gelb)
  return { rec: best ? { ...best, isbn: best.isbn || isbn || "" } : { title: d.title || "", author: d.author || "", publisher: d.publisher || "", year: d.year || "", isbn: isbn || "" }, sure: false };
}
/* Ergebnis der Cover-Erkennung (Sammelauftrag oder Claude-Chat) – gibt false zurück, wenn es den Eintrag nicht mehr gibt. */
async function stackRecognized(id, d) {
  if (!S.stack.some(x => x.id === id) || !d || !(d.title || d.isbn)) return false;
  await patchStackEntry(id, { recog: d, recogAt: new Date().toISOString(), lookupAt: null });
  stackWork();
  return true;
}

/* ---------- Kamera: Fließband ---------- */
function stackBeep() {
  try {
    const A = window.AudioContext || window.webkitAudioContext; const ctx = stackBeep.ctx || (stackBeep.ctx = new A());
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 1320; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.09);
  } catch {}
  if (navigator.vibrate) navigator.vibrate(70);
}
// Einzelbild aus der laufenden Kamera – mit voller Auflösung, wo der Browser es kann (ImageCapture); gespeichert höchstens 2000 px
async function grabFrame(video, track) {
  let blob = null;
  if (track && "ImageCapture" in window) {
    try { blob = await Promise.race([new ImageCapture(track).takePhoto(), new Promise(r => setTimeout(() => r(null), 2500))]); } catch {}
  }
  if (!blob || !blob.size) {
    const c = document.createElement("canvas"); c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0); return canvasBlob(c, .9);
  }
  return canvasBlob(toCanvas(await loadImage(blob), 2000), .88);
}
const stackTitle = e => e.rec?.title || e.recog?.title || "";

async function openStackCapture() {
  closeSheet();
  if (!navigator.mediaDevices?.getUserMedia) { toast("Die Live-Kamera ist hier nicht verfügbar."); openStackReview(); return; }
  const video = el("video", { playsinline: true, muted: true, autoplay: true }); video.muted = true;
  const count = el("div", { class: "stkcount" }), info = el("p"), btns = el("div", { class: "stkbtns" });
  const flash = el("div", { class: "stkflash" });
  let stream, track, stopLoop = () => {}, closed = false, cur = null, lastIsbn = null, busy = false;
  const presetBar = presetBarEl({ dark: true }); // Vorgaben bleiben sichtbar
  const ov = el("div", { class: "scan stack" }, video, el("div", { class: "frame" }), flash,
    el("div", { class: "stktop" }, count, presetBar, el("button", { class: "btn sm", onclick: () => finish() }, "✕")),
    el("div", { class: "bottom" }, info, btns));
  const finish = () => {
    if (closed) return; closed = true; stopLoop();
    stream && stream.getTracks().forEach(t => t.stop());
    ov.remove(); stackWork(); openStackReview();
  };
  const draw = () => {
    if (closed) return;
    const e = cur && S.stack.find(x => x.id === cur);
    count.textContent = `📚 ${S.stack.length} im Stapel`;
    info.textContent = e ? `${e.isbn ? "✓ ISBN " + e.isbn : "✓ Buch ohne Barcode"}${stackTitle(e) ? " – " + stackTitle(e) : ""}. Fotos sind freiwillig.`
      : "Barcode in den Rahmen halten. Buch ohne Barcode? Cover fotografieren.";
    const shot = (label, key, onDone) => el("button", { class: "btn" + (e?.[key] ? " ok" : ""), disabled: busy || null, onclick: async () => {
      busy = true; draw(); flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on");
      try { const blob = await grabFrame(video, track); await onDone(blob); } catch { toast("Foto hat nicht geklappt."); }
      busy = false; draw();
    } }, label);
    fillNode(btns, e
      ? el("div", { class: "covertools" },
        shot(e.coverBlob ? "📷 Cover ✓" : "📷 Cover", "coverBlob", b => patchStackEntry(e.id, { coverBlob: b })),
        shot(e.spineBlob ? "📷 Rücken ✓" : "📷 Rücken", "spineBlob", b => patchStackEntry(e.id, { spineBlob: b })),
        el("button", { class: "btn primary", onclick: () => { cur = null; draw(); } }, "Weiter ▶"))
      : el("div", { class: "covertools" },
        shot("📷 Cover (ohne Barcode)", "-", async b => { const n = await newStackEntry({ coverBlob: b }); cur = n.id; lastIsbn = null; }),
        el("button", { class: "btn primary", onclick: finish }, `✓ Fertig – prüfen (${S.stack.length})`)),
      e ? el("button", { class: "btn sm ghost stkdel", onclick: async () => { await dropStackEntry(e.id); cur = null; toast("Buch verworfen."); draw(); } }, "Dieses Buch verwerfen") : null);
  };
  const onIsbn = async isbn => {
    if (closed || isbn === lastIsbn) return; // derselbe Barcode ist noch im Bild
    lastIsbn = isbn; stackBeep();
    const n = await newStackEntry({ isbn }); cur = n.id; draw();
    stackWork().then(draw);
  };
  document.body.append(ov); draw();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    closed = true; ov.remove(); toast(e.name === "NotAllowedError" ? "Kamera-Zugriff wurde nicht erlaubt." : "Kamera nicht verfügbar."); openStackReview(); return;
  }
  if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
  track = stream.getVideoTracks()[0];
  video.srcObject = stream; await video.play().catch(() => {});
  const stop = await barcodeLoop(video, onIsbn, t => { if (!cur) info.textContent = t; });
  if (closed) stop(); else stopLoop = stop;
}

/* ---------- Prüfliste ---------- */
function stackState(e, busyIds) {
  if (busyIds.has(e.id)) return { kind: "wait", text: "⏳ Claude erkennt das Cover …" };
  if (!e.isbn && !e.recog) return { kind: "new", text: "Noch nicht erkannt" };
  if (!e.lookupAt) return { kind: "wait", text: "Buchdaten werden gesucht …" };
  if (!e.rec?.title) return { kind: "unsure", text: "Nichts gefunden – bitte Titel eintragen" };
  return e.sure ? { kind: "sure", text: "✓ sicher" } : { kind: "unsure", text: "? bitte prüfen" };
}
function openStackReview() {
  const sh = openSheet || sheet("📚 Stapel prüfen");
  sh.h2.textContent = "📚 Stapel prüfen";
  S.pasteHandler = null;
  sh.stackView = true;
  const inc = new Map(); // vom Nutzer gesetzte Häkchen; sonst der Vorschlag (alles außer schon vorhandenen Büchern)
  const status = el("div", { class: "saved" });
  const dupOf = e => { const r = e.rec || {}; return r.title || r.isbn || e.isbn ? findDuplicate({ isbn: r.isbn || e.isbn, title: r.title, author: r.author }) : null; };
  const chosen = e => { if (!(e.rec?.title || "").trim()) return false; if (inc.has(e.id)) return inc.get(e.id); const d = dupOf(e); return !(d && !isWish(d)); };
  const draw = () => {
    if (!sh.stackView || openSheet !== sh) return;
    const a = document.activeElement; // nicht neu zeichnen, während jemand tippt – danach
    if (a && a.tagName === "INPUT" && a.type !== "checkbox" && sh.body.contains(a)) { a.addEventListener("blur", () => setTimeout(draw, 0), { once: true }); return; }
    const list = stackOpen();
    const busyIds = new Set(batchList().filter(b => b.kind === "stack").flatMap(b => b.ids));
    if (!list.length) {
      fillNode(sh.body, el("div", { class: "note info", text: "Der Stapel ist leer." }),
        el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: () => openAdd() }, "← Buch hinzufügen"), el("button", { class: "btn primary", onclick: openStackCapture }, "📚 Stapel erfassen")));
      return;
    }
    const rows = list.map(e => {
      const st = stackState(e, busyIds), r = e.rec || {};
      const dup = dupOf(e), can = !!(r.title || "").trim(), on = chosen(e);
      const cb = el("input", { type: "checkbox", checked: on || null, disabled: can ? null : true });
      cb.addEventListener("change", () => { inc.set(e.id, cb.checked); draw(); });
      const src = stackUrl(e) || r.coverUrl;
      const thumb = el("div", { class: "stkthumb" }, src ? el("img", { src, alt: "", referrerpolicy: "no-referrer", onerror: ev => ev.target.remove() }) : el("span", { text: "📕" }));
      const edit = (k, ph) => {
        const i = el("input", { class: "field", value: r[k] || "", placeholder: ph });
        i.addEventListener("change", () => { const rec = { ...(e.rec || {}), [k]: i.value.trim() }; patchStackEntry(e.id, { rec: rec, lookupAt: e.lookupAt || new Date().toISOString() }); });
        return i;
      };
      const notes = [];
      if (dup) notes.push(el("div", { class: "saved stkdup", text: isWish(dup) ? "⭐ Steht auf deiner Wunschliste – wird als gekauft übernommen." : "Steht schon in deinem Regal – nur mit Häkchen noch einmal anlegen." }));
      if (e.isbn) notes.push(el("div", { class: "saved", text: "ISBN " + e.isbn + (e.spineBlob ? " · mit Rückenfoto" : "") }));
      else if (e.spineBlob) notes.push(el("div", { class: "saved", text: "mit Rückenfoto" }));
      const tools = [];
      if (st.kind === "new" && e.coverBlob && !aiKey()) tools.push(el("button", { class: "btn sm", onclick: () => stackViaChat(sh, e) }, "💬 Mit Claude-Chat erkennen"));
      tools.push(el("button", { class: "btn sm ghost danger", title: "Aus dem Stapel nehmen", onclick: async () => { await dropStackEntry(e.id); draw(); } }, "🗑"));
      return el("div", { class: `stkrow ${st.kind}${on ? "" : " off"}`, "data-id": e.id }, cb, thumb,
        el("div", { class: "stkmain" },
          el("div", { class: "stkstate", text: st.text }),
          el("div", { class: "stkfields" }, edit("title", "Titel"), edit("author", "Autor")),
          ...notes, el("div", { class: "covertools" }, ...tools)));
    });
    const todoAi = list.filter(e => stackState(e, busyIds).kind === "new" && e.coverBlob);
    const n = list.filter(chosen).length;
    const unsure = list.filter(e => ["unsure", "new"].includes(stackState(e, busyIds).kind)).length;
    const waiting = busyIds.size ? list.filter(e => busyIds.has(e.id)).length : 0;
    const top = [];
    if (todoAi.length && aiKey()) {
      const btn = el("button", { class: "btn primary" }, `🤖 ${todoAi.length} ${todoAi.length === 1 ? "Buch" : "Bücher"} ohne Barcode erkennen`);
      btn.addEventListener("click", () => stackRecognizeAll(todoAi, btn, status, draw));
      top.push(el("div", { class: "note info" }, el("div", { text: "Claude liest Titel und Autor vom Cover – alle auf einmal als Sammelauftrag zum halben Preis (meist unter einer Stunde, die App muss nicht offen bleiben)." }), el("div", { class: "covertools", style: "margin-top:8px" }, btn), status));
    } else if (todoAi.length) top.push(el("div", { class: "note info" }, `${todoAi.length} ${todoAi.length === 1 ? "Buch" : "Bücher"} ohne Barcode: je Buch „💬 Mit Claude-Chat erkennen“ – oder Titel und Autor selbst eintragen. Mit einem KI-Schlüssel geht es für alle auf einmal (`, el("a", { href: "#", onclick: ev => { ev.preventDefault(); aboutBox(); } }, "einrichten"), ")."));
    if (waiting) top.push(el("div", { class: "note info" }, el("b", { text: `⏳ ${waiting} ${waiting === 1 ? "Buch wird" : "Bücher werden"} gerade von Claude erkannt.` }), " ", el("button", { class: "btn sm", onclick: () => checkBatches({ loud: true }) }, "Jetzt nachsehen")));
    if (unsure) top.push(el("div", { class: "note warnnote", text: `⚠ ${unsure} ${unsure === 1 ? "Buch ist" : "Bücher sind"} gelb markiert – bitte Titel und Autor kurz prüfen.` }));
    const presetBar = presetBarEl({ onChange: draw });
    fillNode(sh.body,
      el("p", { class: "saved", style: "margin-top:0", text: `${list.length} ${list.length === 1 ? "Buch" : "Bücher"} im Stapel. Grün = sicher erkannt, gelb = bitte prüfen. Schon vorhandene Bücher sind nicht angehakt.` }),
      presetBar, ...top, el("div", { class: "stklist" }, ...rows),
      el("div", { class: "actions sticky" },
        el("button", { class: "btn", onclick: openStackCapture }, "📷 Weiter erfassen"),
        el("button", { class: "btn primary", disabled: n ? null : true, onclick: () => importStack(list.filter(chosen)) }, `${n} ${n === 1 ? "Buch" : "Bücher"} übernehmen`)));
  };
  sh.redraw = draw;
  draw();
  stackWork();
}
// Ohne Schlüssel: ein Cover über die Claude-Chat-Brücke erkennen lassen
async function stackViaChat(sh, e) {
  sh.stackView = false; sh.redraw = null;
  const jpeg = await canvasBlob(toCanvas(await loadImage(e.coverBlob), 1400), .86);
  claudeChatBridge(sh, { title: "💬 Cover mit Claude erkennen", prompt: COVER_PROMPT, jpeg, fileName: "cover.jpg",
    onBack: () => openStackReview(),
    accept: d => !!(d && (d.title || d.isbn)) && !Array.isArray(d.items),
    onResult: async d => { await stackRecognized(e.id, d); openStackReview(); } });
}
// Mit Schlüssel: alle Bücher ohne Barcode als Sammelauftrag – klappt das nicht, einzeln (normaler Preis)
async function stackRecognizeAll(list, btn, status, redraw) {
  btn.disabled = true;
  try {
    const requests = [];
    for (const e of list) { status.textContent = `Bereite Cover ${requests.length + 1} von ${list.length} vor …`; requests.push({ custom_id: e.id, params: coverParams(await coverB64(e.coverBlob)) }); }
    status.textContent = "Sende an Claude …";
    let r; try { r = await fetch(AI_API + "/v1/messages/batches", { method: "POST", headers: aiHeaders(), body: JSON.stringify({ requests }) }); }
    catch { throw new Error("Keine Verbindung zur KI (Internet prüfen)."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw aiError(r.status, j);
    setBatchList([...batchList(), { id: j.id, ids: list.map(e => e.id), at: new Date().toISOString(), kind: "stack" }]);
    status.textContent = "";
    toast(`${list.length} Cover an Claude geschickt – meist ist alles in unter einer Stunde erkannt.`, 5000);
  } catch (err) {
    status.textContent = "";
    if (await confirmBox(`Der Sammelauftrag hat nicht geklappt:\n${err.message}\n\nStattdessen jedes Cover einzeln erkennen? (normaler Preis, die App muss dabei offen bleiben)`, "Einzeln erkennen")) {
      let ok = 0;
      for (const e of list) {
        status.textContent = `Erkenne Cover ${ok + 1} von ${list.length} …`;
        try { if (await stackRecognized(e.id, await aiRecognizeCover(e.coverBlob))) ok++; } catch (e2) { toast(e2.message || "Erkennung fehlgeschlagen.", 4000); break; }
      }
      status.textContent = ""; toast(`${ok} von ${list.length} Covern erkannt.`);
    }
  }
  redraw();
}

/* ---------- Übernehmen ---------- */
async function importStack(list) {
  const sh = openSheet;
  const unsure = list.filter(e => !e.sure).length;
  if (unsure && !(await confirmBox(`${unsure} ${unsure === 1 ? "Buch ist" : "Bücher sind"} nicht sicher erkannt und ${unsure === 1 ? "wird" : "werden"} mit den eingetragenen Angaben übernommen.\nTrotzdem alle übernehmen?`, "Übernehmen"))) return;
  if (sh) { sh.stackView = false; sh.redraw = null; }
  const msg = busyView("Bücher werden übernommen", null, `0 / ${list.length}`);
  let created = 0, bought = 0; const placed = [];
  for (const e0 of list) {
    const e = S.stack.find(x => x.id === e0.id); if (!e) continue;
    msg.textContent = `${created + bought + 1} / ${list.length}: ${stackTitle(e)}`;
    const r = e.rec || {};
    const pre = capturePreset(); // Vorgaben (Fach, Schlagworte, Status, Wunschliste)
    const dup = findDuplicate({ isbn: r.isbn || e.isbn, title: r.title, author: r.author });
    if (dup && isWish(dup)) {
      if (!pre?.wish) { await patchBook(dup.id, { wish: false, addedAt: new Date().toISOString() }); bought++; placed.push(dup.id); } // gekauft
      await dropStackEntry(e.id); continue; // als Wunsch erfasst, steht aber schon auf der Wunschliste
    }
    const b = { id: uid(), status: "unread", rating: 0, notes: "", addedAt: new Date().toISOString(), source: "stapel" };
    for (const f of FIELDS) b[f.k] = String(r[f.k] || "").trim();
    b.isbn = toIsbn13(b.isbn || e.isbn) || b.isbn || e.isbn || "";
    if (!b.title) continue;
    const hs = spineWithHeight(b, r); if (hs) b.spine = hs;
    let spineSrc = e.spineBlob || null;
    try {
      if (e.coverBlob) {
        const q = quadsFromAnswer(e.recog); let src = e.coverBlob;
        if (q?.cover) src = await warpQuad(e.coverBlob, q.cover, 1200).catch(() => e.coverBlob);
        if (!spineSrc && q?.spine) spineSrc = await warpQuad(e.coverBlob, q.spine, SPINE_MAX).catch(() => null);
        b.coverBlob = await coverBlobFromFile(src);
      } else if (r.coverUrl) {
        const url = (r.altCovers && r.altCovers[0]) || r.coverUrl, blob = await fetchCoverBlob(url);
        if (blob) { b.coverUrl = url; b.coverBlob = blob; } else if (await imgOk(url)) b.coverUrl = url;
      }
      if (spineSrc) b.spine = await spineWithPhoto(b, spineSrc);
    } catch {}
    if (pre) applyPreset(b, pre);
    await putBook(b); created++; if (!b.wish) placed.push(b.id);
    await dropStackEntry(e.id);
  }
  await placePresetBooks(placed); // in Erfassungsreihenfolge ans Ende des Vorgabe-Fachs
  closeSheet(); renderAll();
  toast(`${created} ${created === 1 ? "Buch" : "Bücher"} angelegt${bought ? `, ${bought} von der Wunschliste gekauft` : ""}.${S.stack.length ? ` ${S.stack.length} ${S.stack.length === 1 ? "bleibt" : "bleiben"} im Stapel.` : ""}`, 4500);
}

/* ---------- Start: angefangene Suchen nach einem Neustart fortsetzen ---------- */
(async () => {
  await new Promise(r => { const t = setInterval(() => { if (S.loaded) { clearInterval(t); r(); } }, 50); });
  if (S.stack.length) stackWork();
  window.addEventListener("online", () => { if (S.stack.length) stackWork(); });
})();

/* ================= Vorgaben für einen Stapel (auch für „Speichern & nächstes“) =================
   Einmal festlegen: Ziel-Fach, Schlagworte, Lesestatus, Bestand oder Wunschliste. Jedes erfasste Buch übernimmt sie und kommt in
   Erfassungsreihenfolge ans Ende des Fachs. Gespeichert nur auf diesem Gerät (localStorage „capturePreset“) – wie Filter und Ansichten,
   gehört nicht zu den Buchdaten. */
function presetGet() { try { const p = JSON.parse(localStorage.getItem("capturePreset") || "null"); return p && typeof p === "object" ? p : null; } catch { return null; } }
function presetSet(p) { try { if (p) localStorage.setItem("capturePreset", JSON.stringify(p)); else localStorage.removeItem("capturePreset"); } catch {} }
// Aktive Vorgaben (eingeschaltet) oder null; ein gelöschtes Fach zählt nicht mehr
function capturePreset() {
  const p = presetGet(); if (!p?.on) return null;
  const fach = p.fachKey && typeof fachOptions === "function" ? fachOptions().find(f => f.key === p.fachKey) : null;
  return { status: STATUS[p.status] ? p.status : "unread", tags: normTags(p.tags || []), wish: !!p.wish, fachKey: fach ? p.fachKey : "", fach: fach || null };
}
// Vorgaben auf ein neues Buch anwenden (Stapel); in „Prüfen & speichern“ füllen sie stattdessen den Entwurf vor
function applyPreset(b, pre) {
  if (pre.status && pre.status !== (b.status || "unread")) Object.assign(b, statusPatch(b, pre.status));
  if (pre.tags.length) b.tags = normTags([...(b.tags || []), ...pre.tags]);
  if (pre.wish) b.wish = true; else delete b.wish;
}
// Bücher in dieser Reihenfolge ans Ende des Vorgabe-Fachs stellen (Wünsche nie)
async function placePresetBooks(ids) {
  const pre = capturePreset(); if (!pre?.fach) return;
  ids = ids.filter(id => { const b = S.books.find(x => x.id === id); return b && !isWish(b) && !isGone(b); });
  if (ids.length) await placeBooks(ids, pre.fach.m, pre.fach.k);
}
function presetText(pre) {
  return [pre.fach ? "📍 " + pre.fach.label : "", pre.tags.length ? pre.tags.map(t => "#" + t).join(" ") : "", STATUS[pre.status], pre.wish ? "⭐ Wunschliste" : "📚 Bestand"].filter(Boolean).join(" · ");
}
/* Leiste „Vorgaben: …“ mit „ändern“ und Ein/Aus. onChange wird nach jeder Änderung aufgerufen. */
function presetBarEl({ dark = false, onChange = () => {} } = {}) {
  const bar = el("div", { class: "presetbar" + (dark ? " dark" : "") });
  const draw = () => {
    const p = presetGet(), pre = capturePreset();
    if (!pre) fillNode(bar, el("button", { class: "btn sm ghost", type: "button", onclick: () => presetDialog(redraw) }, p ? "⚙ Vorgaben (aus) – einschalten" : "⚙ Vorgaben für alle Bücher festlegen"));
    else fillNode(bar,
      el("span", { class: "presettext" }, el("b", { text: "Vorgaben: " }), presetText(pre)),
      el("button", { class: "btn sm", type: "button", onclick: () => presetDialog(redraw) }, "ändern"),
      el("button", { class: "btn sm ghost", type: "button", title: "Vorgaben abschalten (bleiben gespeichert)", onclick: () => { presetSet({ ...presetGet(), on: false }); redraw(); } }, "aus"));
  };
  const redraw = () => { draw(); onChange(); };
  draw();
  return bar;
}
function presetDialog(done = () => {}) {
  const p = { status: "unread", tags: [], wish: false, fachKey: "", ...(presetGet() || {}) };
  const fachs = typeof fachOptions === "function" ? fachOptions() : [];
  const fachSel = el("select", { class: "field" }, el("option", { value: "" }, "nicht einsortieren"),
    ...fachs.map(f => el("option", { value: f.key, selected: f.key === p.fachKey || null }, f.label)));
  const stSel = el("select", { class: "field" }, ...Object.entries(STATUS).map(([v, l]) => el("option", { value: v, selected: v === p.status || null }, l)));
  const tagsObj = { tags: [...(p.tags || [])] };
  const seg = el("div", { class: "seg" });
  const drawSeg = () => seg.replaceChildren(
    el("button", { type: "button", class: p.wish ? "" : "on", onclick: () => { p.wish = false; drawSeg(); } }, "📚 Bestand"),
    el("button", { type: "button", class: p.wish ? "on" : "", onclick: () => { p.wish = true; drawSeg(); } }, "⭐ Wunschliste"));
  drawSeg();
  const close = () => box.remove();
  const save = on => { presetSet({ on, fachKey: fachSel.value, status: stSel.value, tags: normTags(tagsObj.tags), wish: p.wish }); close(); done(); };
  const box = el("div", { class: "overlay confirm", style: "z-index:96", onclick: e => { if (e.target === box) close(); } },
    el("div", { class: "sheet", style: "max-width:520px" },
      el("div", { class: "sheet-h" }, el("h2", { text: "⚙ Vorgaben für alle Bücher" }), el("button", { class: "x", onclick: close }, "✕")),
      el("div", { class: "sheet-b" },
        el("p", { class: "saved", style: "margin-top:0", text: "Gilt für den Stapel und für „Speichern & nächstes“, bis du die Vorgaben abschaltest. Jedes Buch kommt in Erfassungsreihenfolge ans Ende des Fachs." }),
        el("label", { class: "lbl", text: "Ziel-Fach im echten Regal" }), fachSel,
        fachs.length ? null : el("div", { class: "saved", text: "Noch keine Regalwand angelegt – siehe „Echtes Regal“." }),
        el("label", { class: "lbl", style: "margin-top:10px", text: "Schlagworte" }), tagEditor(tagsObj, () => {}),
        el("label", { class: "lbl", style: "margin-top:10px", text: "Lesestatus" }), stSel,
        el("label", { class: "lbl", style: "margin-top:10px", text: "Besitz" }), seg,
        el("div", { class: "actions" },
          el("button", { class: "btn ghost", onclick: () => save(false) }, "Vorgaben aus"),
          el("div", { class: "covertools" }, el("button", { class: "btn", onclick: close }, "Abbrechen"), el("button", { class: "btn primary", onclick: () => save(true) }, "Übernehmen"))))));
  document.body.append(box);
}
