/* Mein Bücherregal – zusätzliche Bilder, Dateien (E-Books, PDFs …), Widmung & Signatur. */
"use strict";
// Metadaten im Buch: b.images = [{id, caption, size}], b.files = [{id, name, type, size}]
// Die eigentlichen Daten liegen im IndexedDB-Speicher "blobs" ({id, bookId, blob}).

const blobUrls = new Map();
async function blobUrl(id) {
  if (blobUrls.has(id)) return blobUrls.get(id);
  const r = await DB.getBlob(id).catch(() => null); if (!r) return null;
  const u = URL.createObjectURL(r.blob); blobUrls.set(id, u); return u;
}
function forgetBlobUrl(id) { const u = blobUrls.get(id); if (u) { URL.revokeObjectURL(u); blobUrls.delete(id); } }
function fmtSize(n) { n = +n || 0; return n > 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }
const FILE_ICON = n => /\.pdf$/i.test(n) ? "📕" : /\.(epub|mobi|azw3?|kfx|fb2)$/i.test(n) ? "📘" : /\.(mp3|m4a|m4b|ogg|wav)$/i.test(n) ? "🎧" : /\.(jpe?g|png|gif|webp|heic)$/i.test(n) ? "🖼" : "📄";
// hasSignInfo, signSummary, extrasSummary stehen in app.js (werden schon beim ersten Anzeigen der Tabelle gebraucht)
async function deleteBookBlobs(b) { for (const x of [...(b.images || []), ...(b.files || [])]) { forgetBlobUrl(x.id); await DB.delBlob(x.id).catch(() => {}); } }

async function openStoredFile(f, download) {
  const r = await DB.getBlob(f.id).catch(() => null);
  if (!r) { toast("Diese Datei ist auf diesem Gerät nicht gespeichert (z. B. ohne Dateien importiert)."); return; }
  const blob = r.blob.type ? r.blob : new Blob([r.blob], { type: f.type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  if (!download && /pdf|image|text|audio/.test(blob.type)) { const w = window.open(url, "_blank"); if (!w) saveFile(f.name, blob); }
  else saveFile(f.name, blob);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------- Ansicht ---------- */
function extrasView(b) {
  const out = el("div", {});
  if (hasSignInfo(b)) out.append(el("div", { class: "sec" }, el("h3", { text: "Widmung & Signatur" }),
    el("dl", { class: "kv" },
      b.signed || b.signedBy ? [el("dt", { text: "Signiert" }), el("dd", { text: (b.signed ? "ja" : "") + (b.signedBy ? (b.signed ? " – " : "") + b.signedBy : "") })] : [],
      b.dedication ? [el("dt", { text: "Widmung" }), el("dd", { class: "dedi", text: b.dedication })] : [])));
  if ((b.images || []).length) {
    const g = el("div", { class: "gallery" });
    for (const im of b.images) {
      const fig = el("figure", {}, el("div", { class: "gimg" }), im.caption ? el("figcaption", { text: im.caption }) : null);
      blobUrl(im.id).then(u => { const box = fig.querySelector(".gimg"); if (u) { const i = el("img", { src: u, alt: im.caption || "" }); i.addEventListener("click", () => lightbox(u)); box.append(i); } else box.append(el("span", { class: "saved", text: "nicht auf diesem Gerät" })); });
      g.append(fig);
    }
    out.append(el("div", { class: "sec" }, el("h3", { text: `Weitere Bilder (${b.images.length})` }), g));
  }
  if ((b.files || []).length) out.append(el("div", { class: "sec" }, el("h3", { text: `Dateien (${b.files.length})` }),
    el("div", { class: "filelist" }, ...b.files.map(f => el("div", { class: "fileitem" },
      el("span", { class: "ficon", text: FILE_ICON(f.name) }), el("div", { class: "fname" }, el("b", { text: f.name }), el("span", { text: fmtSize(f.size) })),
      el("button", { class: "btn sm", onclick: () => openStoredFile(f) }, /\.pdf$/i.test(f.name) ? "Öffnen" : "Öffnen / Laden"),
      el("button", { class: "btn sm ghost", title: "Herunterladen", onclick: () => openStoredFile(f, true) }, "⬇"))))));
  return out;
}

/* ---------- Bearbeiten (Änderungen erst beim Speichern) ---------- */
// st.att = { add: Map(id → Blob), del: Set(id) }
function extrasEdit(draft, st, markDirty) {
  st.att = st.att || { add: new Map(), del: new Set() };
  draft.images = (draft.images || []).map(x => ({ ...x })); draft.files = (draft.files || []).map(x => ({ ...x }));
  const box = el("div", {});
  const pendingUrl = new Map();
  const urlFor = async im => st.att.add.has(im.id) ? (pendingUrl.get(im.id) || (pendingUrl.set(im.id, URL.createObjectURL(st.att.add.get(im.id))), pendingUrl.get(im.id))) : blobUrl(im.id);
  const addImage = async file => {
    try { const img = await loadImage(file); const blob = await canvasBlob(toCanvas(img, 1800), .86); const id = uid(); st.att.add.set(id, blob); draft.images.push({ id, caption: "", size: blob.size }); markDirty(); draw(); }
    catch { toast("Bild konnte nicht gelesen werden."); }
  };
  const addFiles = files => { for (const f of files) { const id = uid(); st.att.add.set(id, f); draft.files.push({ id, name: f.name, type: f.type || "", size: f.size }); } if (files.length) { markDirty(); draw(); } };
  const pickAny = () => new Promise(res => { const i = el("input", { type: "file", multiple: true, accept: ".pdf,.epub,.mobi,.azw,.azw3,.fb2,.txt,.rtf,.doc,.docx,.odt,.mp3,.m4a,.m4b,application/pdf,application/epub+zip,audio/*,*/*", style: "display:none" }); i.addEventListener("change", () => { res([...i.files]); i.remove(); }); document.body.append(i); i.click(); });
  const draw = () => {
    const m = isMobile();
    const imgs = el("div", { class: "gallery edit" }, ...draft.images.map((im, i) => {
      const cap = el("input", { class: "field", value: im.caption || "", placeholder: "Beschriftung, z. B. Widmung, Rückseite …" });
      cap.addEventListener("input", () => { im.caption = cap.value; markDirty(); });
      const fig = el("figure", {}, el("div", { class: "gimg" }), cap,
        el("div", { class: "covertools" },
          el("button", { class: "btn sm ghost", type: "button", title: "Nach vorne", disabled: i === 0 || null, onclick: () => { draft.images.splice(i - 1, 0, draft.images.splice(i, 1)[0]); markDirty(); draw(); } }, "◀"),
          el("button", { class: "btn sm ghost danger", type: "button", onclick: () => { if (st.att.add.has(im.id)) st.att.add.delete(im.id); else st.att.del.add(im.id); draft.images.splice(i, 1); markDirty(); draw(); } }, "Entfernen")));
      urlFor(im).then(u => { if (u) { const x = el("img", { src: u, alt: "" }); x.addEventListener("click", () => lightbox(u)); fig.querySelector(".gimg").append(x); } });
      return fig;
    }));
    const files = el("div", { class: "filelist" }, ...draft.files.map((f, i) => el("div", { class: "fileitem" },
      el("span", { class: "ficon", text: FILE_ICON(f.name) }), el("div", { class: "fname" }, el("b", { text: f.name }), el("span", { text: fmtSize(f.size) + (st.att.add.has(f.id) ? " · neu" : "") })),
      el("button", { class: "btn sm ghost danger", type: "button", onclick: () => { if (st.att.add.has(f.id)) st.att.add.delete(f.id); else st.att.del.add(f.id); draft.files.splice(i, 1); markDirty(); draw(); } }, "Entfernen"))));
    const imgDrop = m ? null : dropZone("Bilder hierher ziehen", f => addImage(f)); if (imgDrop) imgDrop.style.cssText = "padding:8px;font-size:12px;margin-top:8px";
    const fileDrop = el("div", { class: "drop", style: "padding:8px;font-size:12px;margin-top:8px" }, "Dateien hierher ziehen (PDF, EPUB, MOBI, Hörbuch …)");
    fileDrop.addEventListener("dragover", e => { e.preventDefault(); fileDrop.classList.add("hot"); });
    fileDrop.addEventListener("dragleave", () => fileDrop.classList.remove("hot"));
    fileDrop.addEventListener("drop", e => { e.preventDefault(); fileDrop.classList.remove("hot"); addFiles([...e.dataTransfer.files]); });
    fillNode(box,
      el("div", { class: "sec" }, el("h3", { text: "Weitere Bilder" }),
        el("p", { class: "saved", style: "margin:0 0 8px", text: "Zum Beispiel Widmung, Signatur, Rückseite, Zustand, Kaufbeleg." }),
        draft.images.length ? imgs : null,
        el("div", { class: "covertools" },
          m ? el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(true); if (f) addImage(f); } }, "📷 Foto") : null,
          el("button", { class: "btn sm", type: "button", onclick: async () => { const f = await pickImage(false); if (f) addImage(f); } }, m ? "Galerie" : "🖼 Bild hinzufügen")),
        imgDrop),
      el("div", { class: "sec" }, el("h3", { text: "Dateien (E-Book, PDF …)" }),
        el("p", { class: "saved", style: "margin:0 0 8px", text: "Dateien werden nur in diesem Browser gespeichert. In die Sicherung kommen sie, wenn du das beim Export auswählst." }),
        draft.files.length ? files : null,
        el("div", { class: "covertools" }, el("button", { class: "btn sm", type: "button", onclick: async () => addFiles(await pickAny()) }, "📎 Datei hinzufügen")),
        m ? null : fileDrop));
  };
  draw();
  return box;
}
async function commitAttachments(bookId, st) {
  if (!st.att) return;
  for (const [id, blob] of st.att.add) await DB.putBlob({ id, bookId, blob });
  for (const id of st.att.del) { forgetBlobUrl(id); await DB.delBlob(id).catch(() => {}); }
  st.att = { add: new Map(), del: new Set() };
}
function signEdit(draft, markDirty) {
  const cb = el("input", { type: "checkbox", checked: draft.signed || null, style: "width:18px;height:18px;accent-color:var(--accent)" });
  cb.addEventListener("change", () => { draft.signed = cb.checked; markDirty(); });
  const by = el("input", { class: "field", value: draft.signedBy || "", placeholder: "z. B. vom Autor, Lesung Hamburg 2019" });
  by.addEventListener("input", () => { draft.signedBy = by.value; markDirty(); });
  const ded = el("textarea", { class: "field", rows: 3, placeholder: "Wortlaut der Widmung, von wem, für wen, wann …" }); ded.value = draft.dedication || "";
  ded.addEventListener("input", () => { draft.dedication = ded.value; markDirty(); });
  return el("div", { class: "sec" }, el("h3", { text: "Widmung & Signatur" }),
    el("label", { class: "prow", style: "border:1px solid var(--line);border-radius:10px;margin-bottom:10px" }, cb, el("span", {}, el("b", { text: "✍ Signiertes Exemplar" }))),
    el("div", { class: "fgrid" }, el("div", { class: "c6" }, el("label", { class: "lbl", text: "Signiert von / Anlass" }), by),
      el("div", { class: "c6" }, el("label", { class: "lbl", text: "Widmung" }), ded)),
    el("p", { class: "saved", text: "Tipp: Ein Foto der Widmung kannst du unten unter „Weitere Bilder“ ablegen." }));
}

/* ---------- Sicherung ---------- */
async function attachmentStats() {
  let ni = 0, si = 0, nf = 0, sf = 0;
  for (const b of S.books) { for (const x of b.images || []) { ni++; si += +x.size || 0; } for (const x of b.files || []) { nf++; sf += +x.size || 0; } }
  return { ni, si, nf, sf };
}
async function attachmentsToBackup(b, opt) {
  const conv = async (list, include) => Promise.all((list || []).map(async x => {
    if (!include) return { ...x };
    const r = await DB.getBlob(x.id).catch(() => null);
    return r ? { ...x, data: await blobToDataURL(r.blob) } : { ...x };
  }));
  return { images: await conv(b.images, opt.images), files: await conv(b.files, opt.files) };
}
async function attachmentsFromBackup(inc, local) {
  // speichert mitgelieferte Daten, behält vorhandene lokale Daten, räumt nicht mehr benutzte lokale Daten auf
  const keep = new Set();
  const take = async list => Promise.all((list || []).map(async x => {
    const { data, ...meta } = x; keep.add(meta.id);
    if (data) { try { const blob = await dataURLToBlob(data); await DB.putBlob({ id: meta.id, bookId: inc.id, blob }); forgetBlobUrl(meta.id); meta.size = meta.size || blob.size; } catch {} }
    return meta;
  }));
  // Sicherungen älterer App-Versionen kennen keine Bilder/Dateien → lokale behalten
  const keepLocal = list => { for (const x of list || []) keep.add(x.id); return (list || []).map(x => ({ ...x })); };
  const images = inc.images === undefined ? keepLocal(local?.images) : await take(inc.images);
  const files = inc.files === undefined ? keepLocal(local?.files) : await take(inc.files);
  if (local) for (const x of [...(local.images || []), ...(local.files || [])]) if (!keep.has(x.id)) { forgetBlobUrl(x.id); await DB.delBlob(x.id).catch(() => {}); }
  return { images, files };
}
function exportOptionsDialog(stats) {
  return new Promise(res => {
    const ci = el("input", { type: "checkbox", checked: true });
    const cf = el("input", { type: "checkbox", checked: stats.sf < 80e6 || null });
    const done = v => { box.remove(); res(v); };
    const box = el("div", { class: "overlay confirm", style: "z-index:70;align-items:center", onclick: e => { if (e.target === box) done(null); } },
      el("div", { class: "sheet", style: "max-width:440px;border-radius:16px" }, el("div", { class: "sheet-b" },
        el("h3", { style: "margin-bottom:8px", text: "Was soll in die Sicherung?" }),
        el("p", { class: "saved", style: "margin-top:0", text: "Bücher, Cover, Notizen, Regal-Aufstellung und Buchrücken sind immer dabei." }),
        stats.ni ? el("label", { class: "prow" }, ci, el("span", {}, el("b", { text: `Weitere Bilder (${stats.ni})` }), el("div", { class: "saved", text: "ca. " + fmtSize(stats.si * 1.37) }))) : null,
        stats.nf ? el("label", { class: "prow" }, cf, el("span", {}, el("b", { text: `Dateien – E-Books, PDFs … (${stats.nf})` }), el("div", { class: "saved", text: "ca. " + fmtSize(stats.sf * 1.37) + (stats.sf >= 80e6 ? " – groß, nur bei Bedarf mitnehmen" : "") }))) : null,
        el("p", { class: "saved", text: "Was du hier weglässt, bleibt beim Import auf dem anderen Gerät erhalten, falls es dort schon vorhanden ist." }),
        el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: () => done(null) }, "Abbrechen"), el("button", { class: "btn primary", onclick: () => done({ images: ci.checked, files: cf.checked }) }, "Sicherung erstellen")))));
    document.body.append(box);
  });
}
