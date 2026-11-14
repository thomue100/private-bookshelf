/* Mein Bücherregal – gespeicherte Fach-Fotos.
   Jedes Fach-Foto wird in der App gespeichert (IndexedDB-Store „photos“, Grundfunktionen in app.js). Erkennen und Einsortieren
   kann sofort oder später passieren – auch auf einem anderen Gerät (Abgleich über den eigenen Server oder per Sicherung).
   Außerdem: Weitermachen nach einem Neustart (Android beendet Apps im Hintergrund gern) und Empfang über „Teilen → Bücherregal“. */
"use strict";

const PHOTO_MAX = 2000; // längste Seite in Pixeln – genug für Erkennung und Buchrücken-Ausschnitte

async function savePhoto(file, fachKey) {
  const img = await loadImage(file);
  const c = toCanvas(img, PHOTO_MAX);
  const blob = await canvasBlob(c, .88);
  return putPhoto({ id: uid(), createdAt: new Date().toISOString(), fachKey: fachKey || "", blob, w: c.width, h: c.height });
}
async function deletePhoto(p) {
  // Grabstein ohne Bild – so erfährt auch das andere Gerät von der Löschung
  await putPhoto({ id: p.id, createdAt: p.createdAt, fachKey: p.fachKey || "", deletedAt: new Date().toISOString() });
}

/* ---------- Angefangenes Fach-Foto (für das Weitermachen nach einem Neustart) ---------- */
function getPending() { try { return JSON.parse(localStorage.getItem("scanPending") || "null"); } catch { return null; } }
function setPending(id, mode) { try { localStorage.setItem("scanPending", JSON.stringify({ id, mode, at: Date.now() })); } catch {} }
function clearPending(id) { try { const p = getPending(); if (!id || p?.id === id) localStorage.removeItem("scanPending"); } catch {} }
function pendingPhoto() {
  const pend = getPending();
  if (!pend || Date.now() - pend.at > 12 * 3600e3) return null;
  const p = S.photos.find(x => x.id === pend.id && !x.doneAt && !x.deletedAt && x.blob);
  return p ? { photo: p, mode: pend.mode } : null;
}
function resumePhoto({ photo, mode }) {
  if (photo.scan) runShelfScan(photo, "stored");
  else if (mode === "chat") runShelfScan(photo, "chat", { autoRead: true });
  else openShelfScan(null, { photo });
}

/* ---------- Übersicht ---------- */
function photoStatus(p) {
  if (p.deletedAt) return "gelöscht";
  if (p.doneAt) return "einsortiert am " + new Date(p.doneAt).toLocaleDateString("de-DE");
  if (!p.blob) return "Bild kommt noch (Abgleich)";
  return p.scan ? "erkannt – bitte prüfen" : "noch nicht erkannt";
}
function photoCard(p, redraw) {
  const when = new Date(p.createdAt || p.updatedAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  return el("div", { class: "phcard" + (p.doneAt ? " done" : "") },
    p.blob ? el("img", { src: photoUrl(p), alt: "Fach-Foto", loading: "lazy", onclick: () => lightbox(photoUrl(p)) }) : el("div", { class: "phmissing", text: "📷" }),
    el("div", { class: "phinfo" },
      el("b", { text: fachName(p.fachKey) }),
      el("div", { class: "saved", text: when + " · " + photoStatus(p) }),
      el("div", { class: "covertools" },
        el("button", { class: "btn sm" + (p.doneAt ? "" : " primary"), disabled: p.blob ? null : true, onclick: () => openShelfScan(null, { photo: p }) },
          p.doneAt ? "Nochmal bearbeiten" : p.scan ? "Prüfen & einsortieren" : "Erkennen & einsortieren"),
        el("button", { class: "btn sm ghost danger", "aria-label": "Foto löschen", onclick: async () => { if (await confirmBox("Dieses Fach-Foto löschen?\n(Bereits übernommene Bücher bleiben erhalten.)")) { await deletePhoto(p); redraw(); } } }, "Löschen"))));
}
function openPhotoInbox() {
  const sh = sheet("📥 Gespeicherte Fach-Fotos");
  const draw = () => {
    if (openSheet !== sh) return;
    const open = openPhotos();
    const done = S.photos.filter(p => !p.deletedAt && p.doneAt).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
    fillNode(sh.body,
      el("p", { class: "saved", style: "margin-top:0", text: "Fach-Fotos, die noch erkannt und einsortiert werden müssen. Mit dem Abgleich über deinen Server (oder per Sicherung) kommen sie auch auf deine anderen Geräte – so kannst du am Handy fotografieren und in Ruhe am PC prüfen." }),
      open.length ? el("div", { class: "phlist" }, ...open.map(p => photoCard(p, draw))) : el("div", { class: "note info", text: "Keine offenen Fach-Fotos." }),
      el("div", { class: "covertools", style: "margin-top:12px" }, el("button", { class: "btn primary", onclick: () => openShelfScan() }, "📷 Neues Fach-Foto")),
      done.length ? el("details", { class: "sec" }, el("summary", { text: `Erledigt (${done.length})` }),
        el("div", { class: "phlist" }, ...done.map(p => photoCard(p, draw))),
        el("button", { class: "btn ghost danger", style: "margin-top:10px", onclick: async () => {
          if (!(await confirmBox(`Alle ${done.length} erledigten Fach-Fotos löschen?\n(Die Bücher bleiben erhalten.)`))) return;
          for (const p of done) await deletePhoto(p);
          draw();
        } }, "Erledigte Fotos löschen")) : null);
  };
  sh.redraw = draw;
  draw();
}
// Hinweis über dem echten Regal
function photoInboxBar() {
  const n = openPhotos().length; if (!n) return null;
  return el("div", { class: "note info phbar" },
    el("span", {}, el("b", { text: `📥 ${n} Fach-Foto${n === 1 ? " wartet" : "s warten"} auf Erkennung.` }), " Erkennen und einsortieren geht auch am PC."),
    el("button", { class: "btn sm primary", onclick: openPhotoInbox }, "Ansehen"));
}

/* ---------- Empfang über „Teilen → Bücherregal“ (Android, installierte App) ----------
   Der Service Worker legt geteilte Fotos/Texte im Cache „share-inbox“ ab und öffnet die App mit ?share=… */
async function takeShared() {
  if (!new URLSearchParams(location.search).has("share")) return false;
  history.replaceState(null, "", location.pathname + location.hash);
  let text = ""; const files = [];
  try {
    const c = await caches.open("share-inbox");
    const keys = (await c.keys()).sort((a, b) => a.url.localeCompare(b.url, "en", { numeric: true }));
    for (const req of keys) {
      const r = await c.match(req);
      if (r) { if (new URL(req.url).pathname.endsWith("/text")) text += (text ? "\n" : "") + await r.text(); else files.push(await r.blob()); }
      await c.delete(req);
    }
  } catch {}
  const imgs = files.filter(f => (f.type || "").startsWith("image/"));
  if (imgs.length) {
    const saved = [];
    for (const f of imgs) { try { saved.push(await savePhoto(f, "")); } catch {} }
    if (!saved.length) { toast("Die geteilten Bilder konnten nicht gelesen werden."); return true; }
    if (saved.length === 1) openShelfScan(null, { photo: saved[0] });
    else { openPhotoInbox(); toast(`${saved.length} Fotos empfangen – bitte jeweils das Fach zuordnen.`, 4500); }
    return true;
  }
  if (text.trim()) { receiveAnswer(text); return true; }
  toast("Es wurde nichts Verwendbares geteilt.");
  return true;
}
// Geteilte Antwort von Claude dem passenden Fach-Foto zuordnen
function receiveAnswer(text) {
  const pend = pendingPhoto();
  if (pend && !pend.photo.scan) { S.sharedAnswer = text; runShelfScan(pend.photo, "chat"); return; }
  const waiting = openPhotos().filter(p => !p.scan && p.blob);
  if (!waiting.length) { toast("Antwort empfangen – aber kein Fach-Foto wartet darauf.", 4500); return; }
  if (waiting.length === 1) { S.sharedAnswer = text; runShelfScan(waiting[0], "chat"); return; }
  const sh = sheet("Zu welchem Fach-Foto gehört die Antwort?");
  fillNode(sh.body, el("div", { class: "phlist" }, ...waiting.map(p => el("button", { class: "phcard pick", onclick: () => { S.sharedAnswer = text; runShelfScan(p, "chat"); } },
    el("img", { src: photoUrl(p), alt: "" }), el("div", { class: "phinfo" }, el("b", { text: fachName(p.fachKey) }), el("div", { class: "saved", text: new Date(p.createdAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) }))))));
}

/* ---------- Start ---------- */
(async () => {
  await new Promise(r => { const t = setInterval(() => { if (S.loaded) { clearInterval(t); r(); } }, 50); });
  if (await takeShared()) return;
  const pend = pendingPhoto();
  if (pend && !openSheet) { resumePhoto(pend); toast("Weiter mit deinem Fach-Foto."); }
  else if (!pend) clearPending();
})();
