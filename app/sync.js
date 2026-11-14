/* Mein Bücherregal – Abgleich mit dem eigenen CouchDB-Server (optional).
   Die App speichert weiterhin alles im Browser und funktioniert ohne Netz. Ist ein Server eingetragen und erreichbar,
   gleicht sie sich automatisch mit ihm ab: neuere Änderung gewinnt, Löschungen werden übernommen.
   Auf dem Server: ein Dokument je Buch („book:<id>“, Cover/Buchrücken/Bilder/Dateien als Anhänge), „meta:shelves“ für das Regal
   und je gespeichertem Fach-Foto „photo:<id>“ ({type:"photo", updatedAt, photo:{…ohne Bild}, Anhang „image“}; gelöscht: zusätzlich deletedAt).
   Ältere App-Versionen überspringen Dokumente, die nicht vom Typ „book“ sind. */
"use strict";

const SY = { conf: null, state: null, running: false, again: false, timer: null, changed: false, lastError: "", status: "" };
const SY_SHELVES = "meta:shelves";
const SY_INLINE_MAX = 2e6; // größere Anhänge werden einzeln hochgeladen
const syDocId = id => "book:" + id;
const syPhotoId = id => "photo:" + id;
const syEnc = encodeURIComponent;
const syNow = () => new Date().toISOString();

/* ---------- Verbindung ---------- */
function syBase(c = SY.conf) { return String(c.url || "").trim().replace(/\/+$/, "") + "/" + syEnc((c.db || "buecherregal").trim()); }
function syErrText(status, j) {
  if (status === 401) return "Benutzername oder Passwort stimmt nicht.";
  if (status === 403) return "Kein Zugriff auf die Datenbank – ist der Benutzer dort als Mitglied eingetragen?";
  if (status === 404) return "Die Datenbank gibt es auf dem Server nicht.";
  return (j && (j.reason || j.error)) || "Fehler " + status;
}
async function syFetch(path, opt = {}, conf = SY.conf) {
  const headers = { Accept: "application/json", ...(opt.headers || {}) };
  if (conf.user) headers.Authorization = "Basic " + btoa(unescape(encodeURIComponent(conf.user + ":" + (conf.pass || ""))));
  if (typeof opt.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  try { return await fetch(syBase(conf) + path, { ...opt, headers, cache: "no-store" }); }
  catch { const e = new Error("Server nicht erreichbar – ist der PC an, Tailscale verbunden und CORS eingeschaltet?"); e.offline = true; throw e; }
}
async function syJson(path, opt, conf) {
  const r = await syFetch(path, opt, conf);
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(syErrText(r.status, j)); e.status = r.status; throw e; }
  return j;
}

/* ---------- Hilfen ---------- */
async function syHash(blob) {
  const h = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function syB64(blob) { const d = await blobToDataURL(blob); return d.slice(d.indexOf(",") + 1); }
const syDigests = d => Object.fromEntries(Object.entries(d._attachments || {}).map(([k, v]) => [k, v.digest || ""]));
async function saveSyState() { await DB.setMeta("syncState", SY.state); }
function syStateKey(c) { return syBase(c) + "|" + (c.user || ""); }

/* ---------- Hochladen ---------- */
// Baut das Server-Dokument für ein Buch. Unveränderte Anhänge werden nur als Verweis („stub“) mitgeschickt.
async function syBookDoc(b, st, noStubs) {
  const { coverBlob, ...meta } = b;
  const atts = {}, sha = {}, later = [];
  const add = async (name, blob, hashed) => {
    let same = !noStubs && !!st?.att?.[name];
    if (hashed) { sha[name] = await syHash(blob); same = same && st.sha?.[name] === sha[name]; }
    if (same) { atts[name] = { stub: true }; return; }
    const type = blob.type || "application/octet-stream";
    if (blob.size > SY_INLINE_MAX) later.push({ name, blob, type });
    else atts[name] = { content_type: type, data: await syB64(blob) };
  };
  if (meta.spine?.imageBlob) { const { imageBlob, ...sp } = meta.spine; meta.spine = sp; await add("spine", imageBlob, true); }
  if (coverBlob) await add("cover", coverBlob, true);
  for (const [pre, list] of [["img-", meta.images], ["file-", meta.files]]) for (const x of list || []) {
    const name = pre + x.id;
    if (!noStubs && st?.att?.[name]) { atts[name] = { stub: true }; continue; } // gleiche ID = gleicher Inhalt
    const r = await DB.getBlob(x.id).catch(() => null);
    if (r) await add(name, r.blob, false);
  }
  const doc = { _id: syDocId(b.id), type: "book", updatedAt: b.updatedAt || "", book: meta, _attachments: atts };
  if (st?.rev) doc._rev = st.rev;
  return { doc, sha, later };
}
async function syRemote(id) { try { return await syJson("/" + syEnc(id)); } catch (e) { if (e.status === 404) return null; throw e; } }

async function syPushBook(b) {
  const id = syDocId(b.id);
  let st = SY.state.docs[id], noStubs = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { doc, sha, later } = await syBookDoc(b, st, noStubs);
    const r = await syFetch("/" + syEnc(id), { method: "PUT", body: JSON.stringify(doc) });
    if (r.ok) {
      let rev = (await r.json()).rev;
      for (const L of later) rev = (await syJson(`/${syEnc(id)}/${syEnc(L.name)}?rev=${syEnc(rev)}`, { method: "PUT", body: L.blob, headers: { "Content-Type": L.type } })).rev;
      const cur = await syRemote(id);
      SY.state.docs[id] = { rev: cur?._rev || rev, upd: b.updatedAt || "", att: cur ? syDigests(cur) : {}, sha };
      return;
    }
    if (r.status === 409) { // auf dem Server gibt es einen neueren Stand
      const remote = await syRemote(id);
      if (remote && (remote.updatedAt || "") > (b.updatedAt || "")) { await syApply(remote); return; }
      st = remote ? { rev: remote._rev, att: syDigests(remote), sha: {} } : {};
      continue;
    }
    if (r.status === 400 || r.status === 412) { noStubs = true; continue; } // Anhang fehlt auf dem Server → alles mitschicken
    let j = null; try { j = await r.json(); } catch {}
    const e = new Error(syErrText(r.status, j)); e.status = r.status; throw e;
  }
  throw new Error("„" + (b.title || "Buch") + "“ konnte nicht abgeglichen werden.");
}
async function syPushSimple(id, body, upd, onNewer) {
  let st = SY.state.docs[id];
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = { _id: id, ...body }; if (st?.rev) doc._rev = st.rev;
    const r = await syFetch("/" + syEnc(id), { method: "PUT", body: JSON.stringify(doc) });
    if (r.ok) { SY.state.docs[id] = { rev: (await r.json()).rev, upd, att: {}, sha: {} }; return; }
    if (r.status !== 409) { let j = null; try { j = await r.json(); } catch {} const e = new Error(syErrText(r.status, j)); e.status = r.status; throw e; }
    const remote = await syRemote(id);
    if (remote && (remote.updatedAt || "") > upd) { await onNewer(remote); return; }
    st = { rev: remote?._rev };
  }
}
// Fach-Foto hochladen. Das Bild ändert sich nie – ist es schon auf dem Server, geht nur ein Verweis mit.
async function syPushPhoto(p) {
  const id = syPhotoId(p.id);
  let st = SY.state.docs[id], noStubs = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { blob, ...meta } = p;
    const doc = { _id: id, type: "photo", updatedAt: p.updatedAt || "", photo: meta };
    if (p.deletedAt) doc.deletedAt = p.deletedAt;
    else if (blob) doc._attachments = { image: !noStubs && st?.att?.image ? { stub: true } : { content_type: blob.type || "image/jpeg", data: await syB64(blob) } };
    if (st?.rev) doc._rev = st.rev;
    const r = await syFetch("/" + syEnc(id), { method: "PUT", body: JSON.stringify(doc) });
    if (r.ok) { const rev = (await r.json()).rev; SY.state.docs[id] = { rev, upd: p.updatedAt || "", att: doc._attachments ? { image: "1" } : {}, sha: {} }; return; }
    if (r.status === 409) {
      const remote = await syRemote(id);
      if (remote && (remote.updatedAt || "") > (p.updatedAt || "")) { await syApplyPhoto(remote); return; }
      st = remote ? { rev: remote._rev, att: syDigests(remote) } : {};
      continue;
    }
    if (r.status === 400 || r.status === 412) { noStubs = true; continue; }
    let j = null; try { j = await r.json(); } catch {}
    const e = new Error(syErrText(r.status, j)); e.status = r.status; throw e;
  }
  throw new Error("Ein Fach-Foto konnte nicht abgeglichen werden.");
}
async function syApplyPhoto(d) {
  const id = d._id.slice(6);
  const local = S.photos.find(p => p.id === id);
  const p = { ...(d.photo || {}), id, updatedAt: d.updatedAt || "" };
  delete p.blob;
  if (d.deletedAt) p.deletedAt = d.deletedAt;
  else if (d._attachments?.image) p.blob = local?.blob || await syAttachment(d._id, "image");
  await storePhotoLocal(p);
  SY.state.docs[d._id] = { rev: d._rev, upd: p.updatedAt, att: syDigests(d), sha: {} };
  SY.changed = true;
}
async function syPush() {
  const dirty = S.books.filter(b => (SY.state.docs[syDocId(b.id)]?.upd ?? null) !== (b.updatedAt || ""));
  let n = 0;
  for (const b of dirty) {
    SY.status = `Lade hoch: ${++n} von ${dirty.length}`; syRefresh();
    await syPushBook(b);
    if (n % 20 === 0) await saveSyState();
  }
  for (const [id, when] of Object.entries(S.deleted || {})) {
    if (S.books.some(b => b.id === id) || SY.state.docs[syDocId(id)]?.upd === when) continue;
    await syPushSimple(syDocId(id), { type: "book", updatedAt: when, deletedAt: when }, when, syApply);
  }
  for (const p of S.photos || []) {
    if ((SY.state.docs[syPhotoId(p.id)]?.upd ?? null) === (p.updatedAt || "")) continue;
    SY.status = "Lade Fach-Fotos hoch …"; syRefresh();
    await syPushPhoto(p);
  }
  const su = S.shelves?.updatedAt || "";
  if (su && SY.state.docs[SY_SHELVES]?.upd !== su)
    await syPushSimple(SY_SHELVES, { type: "shelves", updatedAt: su, shelves: S.shelves }, su, syApplyShelves);
  await saveSyState();
}

/* ---------- Herunterladen ---------- */
async function syAttachment(docId, name) {
  const r = await syFetch(`/${syEnc(docId)}/${syEnc(name)}`, { headers: { Accept: "*/*" } });
  if (!r.ok) { const e = new Error(syErrText(r.status)); e.status = r.status; throw e; }
  return r.blob();
}
async function syApplyShelves(d) {
  if ((d.updatedAt || "") > (S.shelves?.updatedAt || "")) {
    S.shelves = { ...d.shelves, updatedAt: d.updatedAt }; await DB.setMeta("shelves", S.shelves); SY.changed = true;
  }
  SY.state.docs[SY_SHELVES] = { rev: d._rev, upd: d.updatedAt || "" };
}
// Übernimmt den Server-Stand eines Buchs auf dieses Gerät (lädt nur geänderte Anhänge).
async function syApply(d) {
  if (d._id === SY_SHELVES) return syApplyShelves(d);
  const id = d._id.slice(5);
  const local = S.books.find(b => b.id === id);
  if (d.deletedAt) {
    if (local) { await deleteBookBlobs(local); await DB.del(id); S.books = S.books.filter(b => b.id !== id); }
    S.deleted[id] = d.deletedAt; await DB.setMeta("deleted", S.deleted);
    SY.state.docs[d._id] = { rev: d._rev, upd: d.updatedAt || d.deletedAt, att: {}, sha: {} };
    SY.changed = true; return;
  }
  const st = SY.state.docs[d._id] || {};
  const atts = d._attachments || {};
  const fresh = name => !st.att || st.att[name] !== atts[name].digest;
  const b = { ...d.book, id, updatedAt: d.updatedAt || d.book?.updatedAt || "" };
  const sha = {};
  if (atts.cover) { b.coverBlob = !fresh("cover") && local?.coverBlob ? local.coverBlob : await syAttachment(d._id, "cover"); sha.cover = await syHash(b.coverBlob); }
  if (atts.spine && b.spine) { const old = local?.spine?.imageBlob; b.spine = { ...b.spine, imageBlob: !fresh("spine") && old ? old : await syAttachment(d._id, "spine") }; sha.spine = await syHash(b.spine.imageBlob); }
  const keep = new Set();
  for (const [pre, list] of [["img-", b.images], ["file-", b.files]]) for (const x of list || []) {
    keep.add(x.id);
    const name = pre + x.id;
    if (!atts[name]) continue; // auf dem Server ohne Daten (z. B. ohne Dateien importiert) → lokale Daten behalten
    if (!fresh(name) && await DB.getBlob(x.id).catch(() => null)) continue;
    await DB.putBlob({ id: x.id, bookId: id, blob: await syAttachment(d._id, name) });
    if (typeof forgetBlobUrl === "function") forgetBlobUrl(x.id);
  }
  if (local) for (const x of [...(local.images || []), ...(local.files || [])]) if (!keep.has(x.id)) { if (typeof forgetBlobUrl === "function") forgetBlobUrl(x.id); await DB.delBlob(x.id).catch(() => {}); }
  await DB.put(b);
  const i = S.books.findIndex(x => x.id === id);
  if (i >= 0) S.books[i] = b; else S.books.push(b);
  if (S.urls.has(id)) { URL.revokeObjectURL(S.urls.get(id)); S.urls.delete(id); }
  spineCol.delete(id);
  if (spineImg.has(id)) { URL.revokeObjectURL(spineImg.get(id).url); spineImg.delete(id); }
  SY.state.docs[d._id] = { rev: d._rev, upd: b.updatedAt, att: syDigests(d), sha };
  SY.changed = true;
}
async function syPull() {
  for (;;) {
    const j = await syJson(`/_changes?since=${syEnc(SY.state.since || "0")}&include_docs=true&limit=100`);
    for (const ch of j.results || []) {
      const d = ch.doc;
      if (!d || d._deleted || d._id.startsWith("_")) continue;
      if (SY.state.docs[d._id]?.rev === d._rev) continue; // eigener Stand
      if (d._id === SY_SHELVES) { await syApplyShelves(d); continue; }
      if (d.type === "photo" && d._id.startsWith("photo:")) {
        const local = S.photos.find(p => p.id === d._id.slice(6));
        if ((d.updatedAt || "") > (local?.updatedAt || "")) { SY.status = "Lade Fach-Fotos …"; syRefresh(); await syApplyPhoto(d); }
        else SY.state.docs[d._id] = { rev: d._rev, upd: d.updatedAt || "", att: syDigests(d), sha: {} }; // hier neuer → wird hochgeladen
        continue;
      }
      if (d.type !== "book" || !d._id.startsWith("book:")) continue;
      const id = d._id.slice(5);
      const local = S.books.find(b => b.id === id);
      const mine = local ? (local.updatedAt || "") : (S.deleted[id] || "");
      SY.status = "Lade Änderungen …"; syRefresh();
      if ((d.updatedAt || "") > mine || (!local && !S.deleted[id])) await syApply(d);
      else SY.state.docs[d._id] = { rev: d._rev, upd: d.updatedAt || "", att: syDigests(d), sha: {} }; // hier neuer → wird hochgeladen
    }
    SY.state.since = j.last_seq ?? SY.state.since;
    await saveSyState();
    if ((j.results || []).length < 100) break;
  }
}

/* ---------- Ablauf ---------- */
async function syLoadState() {
  const key = syStateKey(SY.conf);
  if (!SY.state) SY.state = await DB.getMeta("syncState").catch(() => null);
  if (!SY.state || SY.state.key !== key) SY.state = { key, since: "0", docs: {} };
}
async function runSync(manual) {
  if (!SY.conf?.on) return false;
  if (SY.running) { SY.again = true; return false; }
  SY.running = true; SY.changed = false; SY.status = "Gleiche ab …"; syRefresh();
  try {
    await syLoadState();
    await syPull();
    await syPush();
    SY.lastError = "";
    await DB.setMeta("syncAt", syNow());
    if (manual) toast("✓ Abgeglichen.");
    return true;
  } catch (e) {
    console.warn(e);
    SY.lastError = e.message || String(e);
    if (manual) toast("Abgleich fehlgeschlagen: " + SY.lastError, 6000);
    try { if (SY.state) await saveSyState(); } catch {}
    return false;
  } finally {
    SY.running = false; SY.status = "";
    if (SY.changed) { renderAll(); if (typeof scheduleAutoBackup === "function") scheduleAutoBackup(); }
    syRefresh();
    if (SY.again) { SY.again = false; scheduleSync(1000); }
  }
}
function scheduleSync(ms = 4000) { if (!SY.conf?.on) return; clearTimeout(SY.timer); SY.timer = setTimeout(() => runSync(false), ms); }

async function saveSyncConf(c) {
  const prev = SY.conf;
  SY.conf = { url: (c.url || "").trim(), db: (c.db || "buecherregal").trim(), user: (c.user || "").trim(), pass: c.pass || "", on: !!c.on };
  if (!prev || syStateKey(prev) !== syStateKey(SY.conf)) SY.state = null; // anderer Server → von vorne abgleichen
  await DB.setMeta("syncConf", SY.conf);
  syRefresh();
}
async function testSyncConf(c) {
  if (!/^https?:\/\/[^/]+/i.test(c.url || "")) throw new Error("Bitte die Serveradresse mit https:// angeben.");
  try { return await syJson("", {}, c); }
  catch (e) {
    if (e.status !== 404) throw e;
    try { await syJson("", { method: "PUT" }, c); return await syJson("", {}, c); } // Datenbank anlegen, falls erlaubt
    catch { throw new Error(`Die Datenbank „${c.db || "buecherregal"}“ gibt es noch nicht. Bitte in CouchDB anlegen (siehe Anleitung).`); }
  }
}

/* ---------- Oberfläche ---------- */
const syBoxes = new Set();
function syRefresh() {
  for (const f of [...syBoxes]) { if (!f.box.isConnected) syBoxes.delete(f); else f(); }
  let dot = document.getElementById("syncDot");
  if (!SY.conf?.on) { dot?.remove(); return; }
  if (!dot) {
    dot = el("button", { id: "syncDot", class: "btn ghost syncdot", onclick: openSyncSettings }, "⟳");
    const m = document.querySelector("header .menu"); if (m) m.before(dot); else return;
  }
  dot.classList.toggle("busy", SY.running); dot.classList.toggle("err", !!SY.lastError && !SY.running);
  dot.title = SY.running ? (SY.status || "Gleiche ab …") : SY.lastError ? "Abgleich: " + SY.lastError : "Abgleich mit deinem Server ist aktiv";
}
function syncBox(noTitle) {
  const box = el("div", { class: "sec sybox" });
  const c = SY.conf || { url: "", db: "buecherregal", user: "", pass: "", on: false };
  const f = {
    url: el("input", { class: "field", placeholder: "https://mein-pc.tailxxxx.ts.net", value: c.url, autocomplete: "off", "aria-label": "Serveradresse" }),
    db: el("input", { class: "field", placeholder: "buecherregal", value: c.db, autocomplete: "off", "aria-label": "Datenbank" }),
    user: el("input", { class: "field", placeholder: "z. B. buecher", value: c.user, autocomplete: "username", "aria-label": "Benutzer" }),
    pass: el("input", { class: "field", type: "password", value: c.pass, autocomplete: "current-password", "aria-label": "Passwort" }),
  };
  const read = on => ({ url: f.url.value, db: f.db.value || "buecherregal", user: f.user.value, pass: f.pass.value, on });
  const connect = async () => {
    const cfg = read(true);
    try { const info = await testSyncConf(cfg); await saveSyncConf(cfg); toast(`Verbunden – auf dem Server liegen ${info?.doc_count ?? 0} Einträge. Gleiche ab …`); await runSync(true); }
    catch (e) { toast(e.message, 6000); }
  };
  const off = async () => { await saveSyncConf({ ...read(false) }); toast("Abgleich ausgeschaltet. Die Bücher bleiben auf diesem Gerät."); };
  const status = el("div", {}), btns = el("div", { class: "covertools", style: "margin-top:12px" });
  const draw = async () => {
    const at = await DB.getMeta("syncAt").catch(() => null);
    const on = !!SY.conf?.on;
    fillNode(status, on ? el("div", { class: "note" + (SY.lastError ? "" : " info") },
      el("b", { text: SY.running ? (SY.status || "Gleiche ab …") : SY.lastError ? "Abgleich gestört" : "Abgleich aktiv" }),
      el("div", { class: "saved", style: "margin-top:2px", text: at ? "Zuletzt abgeglichen: " + new Date(at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "Noch nicht abgeglichen." }),
      SY.lastError ? el("div", { class: "saved", style: "color:#b3261e", text: SY.lastError }) : null) : null);
    fillNode(btns,
      el("button", { class: "btn primary", onclick: connect }, on ? "Speichern & abgleichen" : "Verbindung prüfen & einschalten"),
      on ? el("button", { class: "btn", onclick: () => runSync(true) }, "Jetzt abgleichen") : null,
      on ? el("button", { class: "btn ghost danger", onclick: off }, "Ausschalten") : null);
  };
  fillNode(box, noTitle ? null : el("h3", { text: "🔄 Abgleich mit eigenem Server" }),
    el("p", { class: "saved", style: "margin-top:0", text: "Optional: Trage deinen eigenen CouchDB-Server ein (z. B. auf deinem PC). Dann gleichen sich Handy und PC automatisch ab, sobald beide den Server erreichen. Ohne Verbindung arbeitet die App ganz normal weiter. Die Zugangsdaten bleiben nur in diesem Browser." }),
    status,
    el("label", { class: "lbl", text: "Serveradresse" }), f.url,
    el("label", { class: "lbl", text: "Datenbank" }), f.db,
    el("div", { class: "fgrid" }, el("div", { class: "c3" }, el("label", { class: "lbl", text: "Benutzer" }), f.user), el("div", { class: "c3" }, el("label", { class: "lbl", text: "Passwort" }), f.pass)),
    btns);
  draw.box = box; draw(); syBoxes.add(draw);
  return box;
}
function openSyncSettings() { const sh = sheet("🔄 Abgleich mit eigenem Server"); const bx = syncBox(true); bx.style.marginTop = "0"; fillNode(sh.body, bx); }

/* ---------- Start ---------- */
(async () => {
  try { SY.conf = await DB.getMeta("syncConf") || null; } catch { SY.conf = null; }
  if (!SY.conf?.on) return;
  syRefresh();
  const wait = () => new Promise(r => { const t = setInterval(() => { if (S.loaded) { clearInterval(t); r(); } }, 50); });
  await wait();
  runSync(false);
})();
setInterval(() => { if (SY.conf?.on && document.visibilityState === "visible") runSync(false); }, 30000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleSync(500); });
window.addEventListener("online", () => scheduleSync(500));
