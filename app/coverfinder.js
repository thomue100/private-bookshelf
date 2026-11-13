/* Mein Bücherregal – Cover aus dem Internet nachtragen (Google Books, Open Library).
   Eindeutige Treffer werden direkt übernommen, bei mehreren Kandidaten oder Unsicherheit wird nachgefragt. */
"use strict";


/* Prüft, ob eine Cover-Adresse ein echtes Bild liefert, und gibt Blob + Maße zurück (null, wenn nicht). */
async function probeCover(url) {
  const blob = await fetchCoverBlob(url); if (!blob) return null;
  try { const img = await loadImage(blob); if (img.naturalWidth < 60 || img.naturalHeight < 60) return null; return { url, blob, w: img.naturalWidth, h: img.naturalHeight }; }
  catch { return null; }
}
const covKey = u => String(u).replace(/^https?:\/\//, "").replace(/[?&](zoom|edge|source)=[^&]*/g, "").replace(/-[SML]\.jpg/, ".jpg");

/* Sammelt Cover-Kandidaten für ein Buch. Jeder Kandidat: {url, blob, w, h, src, title, author, year, publisher, isbn, score, reason} */
async function coverCandidates(b, onStatus) {
  const i13 = toIsbn13(b.isbn);
  const seen = new Set(); const out = [];
  const add = async (url, meta, score, reason) => {
    if (!url) return; const k = covKey(url); if (seen.has(k)) return; seen.add(k);
    const p = await probeCover(url); if (!p) return;
    out.push({ ...p, ...meta, score, reason });
  };
  // 1) Genau diese Ausgabe per ISBN
  if (i13) {
    onStatus && onStatus("Suche Cover zur ISBN …");
    let rec = null; try { rec = await lookupIsbn(i13); } catch {}
    const urls = rec?.altCovers?.length ? rec.altCovers : olCovers(i13);
    for (const u of urls) await add(u, { src: /openlibrary/.test(u) ? "Open Library" : "Google Books", title: rec?.title || b.title, author: rec?.author || b.author, year: rec?.year || b.year, publisher: rec?.publisher || b.publisher, isbn: i13 }, 10, "passend zur ISBN");
  }
  // 2) Ausgaben zum Titel (bei ISBN-Treffer nur als Alternative)
  if (!out.length || !i13) {
    onStatus && onStatus("Suche Ausgaben zu Titel und Autor …");
    let list = []; try { list = await searchBooks([b.title, lastName(b.author)].filter(Boolean).join(" ")); } catch {}
    const tOk = c => overlap(b.title, c.title) >= 0.5;
    const aOk = c => !b.author || !c.author || overlap(b.author, c.author) > 0;
    for (const c of list.filter(c => c.coverUrl && tOk(c)).slice(0, 8)) {
      const score = (overlap(b.title, c.title) >= 0.8 ? 4 : 2) + (aOk(c) ? 2 : -3) + (b.publisher && c.publisher && overlap(b.publisher, c.publisher) > 0 ? 2 : 0) + (b.year && c.year === b.year ? 1 : 0) + (c.language === "Deutsch" ? 0.5 : 0);
      await add(c.coverUrl, { src: c.src || "", title: c.title, author: c.author, year: c.year, publisher: c.publisher, isbn: c.isbn }, score, aOk(c) ? "Titel passt" : "anderer Autor?");
      if (out.length >= 6) break;
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
function decideCover(cands) {
  if (!cands.length) return { kind: "none" };
  const best = cands[0];
  if (best.score >= 10) return { kind: "sure", c: best };                // ISBN-Treffer
  if (best.score >= 8 && (cands.length === 1 || cands[1].score <= best.score - 3)) return { kind: "sure", c: best };
  return { kind: "ask" };
}
async function applyCover(id, c) { S.badCover.delete(id); await patchBook(id, { coverUrl: c.url, coverBlob: c.blob }); }

/* ---------- Einzelnes Buch: Auswahl-Dialog ---------- */
function coverPickDialog(b, cands, { skipLabel = "Ohne Cover lassen", title, google } = {}) {
  return new Promise(res => {
    const prevPaste = S.pasteHandler;
    let closed = false;
    const done = v => { if (closed) return; closed = true; if (S.pasteHandler === pasteH || (S.pasteHandler && S.pasteHandler.fixed)) S.pasteHandler = prevPaste; box.remove(); res(v); };
    // eingefügte/abgelegte Bilder: gespeichertes Bild bevorzugt, sonst nur verlinkt
    const pasteH = x => x instanceof Blob ? done({ ownFile: x }) : x.blob ? done({ ownFile: x.blob }) : done({ url: x.url, src: "Google Bilder", reason: "nur verlinkt" });
    pasteH.urlOk = true;
    const gsec = googleSection(b, done, pasteH);
    S.pasteHandler = pasteH;
    const m = isMobile();
    const grid = el("div", { class: "covgrid" }, ...cands.map((c, i) => {
      const u = URL.createObjectURL(c.blob);
      const card = el("button", { class: "covcand" + (i === 0 ? " best" : ""), onclick: () => done(c) },
        el("div", { class: "cover" }, el("img", { src: u, alt: "" })),
        el("b", { text: c.title || "" }), el("span", { text: [c.author, c.publisher, c.year].filter(Boolean).join(" · ") }),
        el("small", { text: [c.src, c.isbn ? "ISBN " + c.isbn : "", c.reason, `${c.w}×${c.h}`].filter(Boolean).join(" · ") }));
      return card;
    }));
    const own = async camera => { const f = await pickImage(camera); if (f) done({ ownFile: f }); };
    const box = el("div", { class: "overlay confirm", style: "z-index:72;align-items:center", onclick: e => { if (e.target === box) done(undefined); } },
      el("div", { class: "sheet", style: "max-width:760px" },
        el("div", { class: "sheet-h" }, el("h2", { text: title || "Welches Cover passt?" }), el("button", { class: "x", onclick: () => done(undefined) }, "✕")),
        el("div", { class: "sheet-b" },
          el("div", { style: "display:flex;gap:12px;align-items:center;margin-bottom:12px" },
            el("div", { style: "width:46px;flex:none" }, coverEl(b)),
            el("div", {}, el("b", { text: b.title || "Ohne Titel" }), el("div", { class: "meta", text: [b.author, b.publisher, b.year, b.isbn ? "ISBN " + b.isbn : ""].filter(Boolean).join(" · ") }))),
          cands.length ? el("p", { class: "saved", style: "margin-top:0", text: "Mehrere Treffer oder nicht ganz sicher – bitte wählen. Der wahrscheinlichste ist markiert." }) : el("div", { class: "note", text: "In den Buchkatalogen wurde kein passendes Cover gefunden. Versuch die Google-Bildersuche oder nimm ein eigenes Foto." }),
          grid,
          gsec,
          el("div", { class: "actions" },
            el("div", { class: "covertools" },
              m ? el("button", { class: "btn", onclick: () => own(true) }, "📷 Eigenes Foto") : null,
              el("button", { class: "btn", onclick: () => own(false) }, m ? "Aus Galerie" : "🖼 Eigenes Bild")),
            el("div", { class: "covertools" }, el("button", { class: "btn ghost", onclick: () => done(null) }, skipLabel), el("button", { class: "btn ghost", onclick: () => done(undefined) }, "Abbrechen"))))));
    document.body.append(box);
    if (google || !cands.length) gsec._open();
  });
}
async function findCoverFor(id, { auto = true } = {}) {
  const b = S.books.find(x => x.id === id); if (!b) return "none";
  const st = toast("Suche Cover …", 20000);
  let cands; try { cands = await coverCandidates(b); } catch { document.querySelectorAll(".toast").forEach(t => t.remove()); toast("Keine Internetverbindung."); return "offline"; }
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const d = decideCover(cands);
  if (auto && d.kind === "sure") { await applyCover(id, d.c); toast("✓ Cover übernommen (" + d.c.reason + ")."); return "set"; }
  const pick = await coverPickDialog(b, cands);
  if (pick === undefined) return "cancel";
  if (pick === null) return "skip";
  if (pick.ownFile) { await patchBook(id, { coverBlob: await coverBlobFromFile(pick.ownFile), coverUrl: "" }); toast("✓ Eigenes Cover gespeichert."); return "set"; }
  await applyCover(id, pick); toast("✓ Cover übernommen."); return "set";
}

/* ---------- Viele Bücher: Sammellauf ---------- */
/* Prüft Bücher, die nur eine Cover-Adresse (kein gespeichertes Bild) haben: liefert die Adresse kein Bild, gilt das Buch als „ohne Cover“. */
async function verifyCoverLinks({ ids, onStatus, limit = 400 } = {}) {
  let list = S.books.filter(b => inStock(b) && !b.coverBlob && b.coverUrl);
  if (ids) list = list.filter(b => ids.includes(b.id));
  list = list.slice(0, limit);
  let bad = 0, fixed = 0;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    onStatus && onStatus(`Prüfe vorhandene Cover-Adressen (${i + 1}/${list.length}) …`);
    if (S.badCover.has(b.id)) { await patchBook(b.id, { coverUrl: "" }); bad++; continue; } // beim Anzeigen schon als tot erkannt
    const blob = await fetchCoverBlob(b.coverUrl);
    if (blob) { await patchBook(b.id, { coverBlob: blob }); fixed++; continue; }   // Bild da → dauerhaft speichern
    if (await imgOk(b.coverUrl)) continue;                                          // Bild lädt, nur nicht speicherbar → ok
    S.badCover.add(b.id); await patchBook(b.id, { coverUrl: "" }); bad++;           // Pseudo-Cover → zählt als „ohne Cover“
  }
  if (bad || fixed) renderAll();
  return { checked: list.length, bad, fixed };
}
async function coverRun(ids) {
  const pre = await verifyCoverLinks({ ids, onStatus: t => toast(t, 4000) });
  document.querySelectorAll(".toast").forEach(t => t.remove());
  if (pre.bad) toast(`${pre.bad} Pseudo-Cover erkannt – werden mitgesucht.`, 3000);
  ids = (ids || S.books.filter(needsCover).map(b => b.id)).filter(id => { const b = S.books.find(x => x.id === id); return b && needsCover(b); });
  if (!ids.length) { toast("Alle Bücher im Bestand haben schon ein Cover."); return; }
  const sh = sheet("🖼 Cover nachtragen");
  const bar = el("div", { class: "progress" }, el("div", {}));
  const status = el("div", { class: "saved", text: "" });
  const log = el("div", { class: "covlog" });
  let stop = false, set = 0, asked = [], none = [];
  const stopBtn = el("button", { class: "btn", onclick: () => { stop = true; stopBtn.disabled = true; stopBtn.textContent = "Wird beendet …"; } }, "Anhalten");
  fillNode(sh.body,
    el("p", { style: "margin-top:0", text: `${ids.length} ${ids.length === 1 ? "Buch" : "Bücher"} ohne Cover. Eindeutige Treffer werden direkt übernommen; bei mehreren oder unsicheren Treffern fragt die App am Ende nach.` }),
    bar, status, log, el("div", { class: "actions" }, stopBtn, el("span")));
  sh.guard = async () => { stop = true; return true; };
  const row = (b, txt, cls) => log.prepend(el("div", { class: "covrow " + (cls || "") }, el("span", { text: txt }), el("b", { text: b.title || "Ohne Titel" })));
  for (let i = 0; i < ids.length && !stop; i++) {
    const b = S.books.find(x => x.id === ids[i]); if (!b || !needsCover(b)) continue;
    bar.firstChild.style.width = Math.round(i / ids.length * 100) + "%";
    status.textContent = `${i + 1} / ${ids.length}: „${b.title}“`;
    let cands = []; try { cands = await coverCandidates(b, t => status.textContent = `${i + 1} / ${ids.length}: „${b.title}“ – ${t}`); }
    catch { row(b, "⚠ offline", "warn"); stop = true; break; }
    const d = decideCover(cands);
    if (d.kind === "sure") { await applyCover(b.id, d.c); set++; row(b, "✓ übernommen", "ok"); }
    else if (d.kind === "ask") { asked.push({ b, cands }); row(b, `? ${cands.length} Treffer – nachfragen`, "ask"); }
    else { none.push(b); row(b, "– nichts gefunden", "none"); }
  }
  bar.firstChild.style.width = "100%";
  sh.guard = null;
  status.textContent = `Fertig: ${set} übernommen, ${asked.length} zum Nachfragen, ${none.length} ohne Treffer.` + (stop ? " (angehalten)" : "");
  const actions = el("div", { class: "actions" },
    el("button", { class: "btn ghost", onclick: closeSheet }, "Schließen"),
    el("div", { class: "covertools" },
      none.length ? el("button", { class: "btn", onclick: () => { closeSheet(); S.tFilter = "nocover"; location.hash = "#verwaltung"; renderAll(); } }, `${none.length} ohne Treffer in der Tabelle zeigen`) : null,
      asked.length ? el("button", { class: "btn primary", onclick: () => askCovers(asked) }, `Jetzt ${asked.length} nachfragen`) : null));
  sh.body.querySelector(".actions").replaceWith(actions);
  if (asked.length) renderAll();
  else renderAll();
}
async function askCovers(asked) {
  closeSheet();
  let n = 0;
  for (let i = 0; i < asked.length; i++) {
    const { b, cands } = asked[i];
    const cur = S.books.find(x => x.id === b.id); if (!cur || !needsCover(cur)) continue;
    const pick = await coverPickDialog(cur, cands, { skipLabel: "Überspringen", title: `Cover wählen (${i + 1} von ${asked.length})` });
    if (pick === undefined) break;
    if (pick === null) continue;
    if (pick.ownFile) await patchBook(b.id, { coverBlob: await coverBlobFromFile(pick.ownFile), coverUrl: "" });
    else await applyCover(b.id, pick);
    n++;
  }
  renderAll();
  toast(`${n} Cover übernommen.`);
}

/* ================= Google-Bildersuche ================= */
// Direkt in der App über die Google Custom Search API (eigener Schlüssel + Suchmaschinen-ID, 100 Anfragen/Tag kostenlos).
// Ohne Schlüssel: Google Bilder im neuen Tab öffnen und das Bild per Drag & Drop oder Strg+V in die App holen.
function gcsKeys() { try { return { key: localStorage.getItem("gcsKey") || "", cx: localStorage.getItem("gcsCx") || "" }; } catch { return { key: "", cx: "" }; } }
const gcsReady = () => { const k = gcsKeys(); return !!(k.key && k.cx); };
function googleImagesUrl(q) { return "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(q); }
function coverQuery(b) { const a = (b.author || "").split(/[,;&]| und /)[0].trim().split(/\s+/).pop() || ""; return [b.title, a, b.publisher, "Buch Cover"].filter(Boolean).join(" "); }
async function googleImageSearch(q, start = 1) {
  const { key, cx } = gcsKeys(); if (!key || !cx) throw new Error("Kein Google-Schlüssel.");
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&searchType=image&num=10&start=${start}&safe=active&q=${encodeURIComponent(q)}`;
  const r = await fetch(url); const j = await r.json().catch(() => ({}));
  if (!r.ok) { const msg = j?.error?.message || "Fehler " + r.status; if (r.status === 429 || /quota/i.test(msg)) throw new Error("Tageskontingent der Google-Bildersuche aufgebraucht (100/Tag)."); if (r.status === 400 || r.status === 403) throw new Error("Google lehnt den Schlüssel ab: " + msg); throw new Error(msg); }
  return (j.items || []).map(it => ({ url: it.link, thumb: it.image?.thumbnailLink || it.link, w: it.image?.width, h: it.image?.height, site: it.displayLink || "", title: it.title || "" }));
}
/* Bild von einer fremden Seite holen: erst Original, dann Google-Vorschaubild; beides kann durch CORS scheitern. */
async function grabImage(hit) {
  for (const u of [hit.url, hit.thumb]) { if (!u) continue; try { const r = await fetch(u, { mode: "cors" }); if (!r.ok) continue; const blob = await r.blob(); if (blob.type.startsWith("image/") && blob.size > 1500) return { blob, url: u }; } catch {} }
  return null;
}
/* Abschnitt im Cover-Dialog: Suche + Ergebnisse + Ablagefläche */
function googleSection(b, onPick, pasteH) {
  const q = el("input", { class: "field", value: coverQuery(b), placeholder: "Suchbegriff für Google Bilder" });
  const link = el("a", { class: "btn sm", href: googleImagesUrl(q.value), target: "_blank", rel: "noopener" }, "Google Bilder öffnen ↗");
  q.addEventListener("input", () => link.href = googleImagesUrl(q.value));
  const results = el("div", { class: "gimgs" });
  const info = el("div", { class: "saved" });
  const drop = dropZone(isMobile() ? "Hier tippen und „Einfügen“ wählen – oder den Knopf „📋 Aus Zwischenablage“" : "Bild aus dem Google-Tab hierher ziehen – oder Rechtsklick auf das Bild → „Bild kopieren“ und hier Strg+V", x => pasteH(x), { urlOk: true });
  drop.style.cssText = "padding:12px;font-size:13px";
  const clipBtn = el("button", { class: "btn sm", type: "button", title: "Bild aus der Zwischenablage übernehmen", onclick: () => pasteFromClipboard(pasteH) }, "📋 Aus Zwischenablage");
  let page = 1;
  const run = async (more) => {
    if (!gcsReady()) return;
    if (!more) { page = 1; results.replaceChildren(); }
    info.textContent = "Suche bei Google Bilder …"; moreBtn.disabled = true;
    try {
      const hits = await googleImageSearch(q.value.trim(), page);
      info.textContent = hits.length ? "" : "Keine Bilder gefunden.";
      for (const h of hits) {
        const card = el("button", { class: "gimg", title: `${h.title}\n${h.site}${h.w ? ` · ${h.w}×${h.h}` : ""}`, onclick: async () => {
          card.classList.add("busy"); info.textContent = "Lade Bild …";
          const g = await grabImage(h); card.classList.remove("busy");
          if (g) onPick({ blob: g.blob, url: g.url, src: "Google Bilder · " + h.site, reason: "aus Bildersuche" });
          else info.textContent = "Diese Seite erlaubt kein direktes Laden. Bild im Google-Tab mit Rechtsklick → „Bild kopieren“ und hier mit Strg+V einfügen.";
        } }, el("img", { src: h.thumb, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }), el("span", { text: h.site }));
        results.append(card);
      }
      page += 10; moreBtn.disabled = false; moreBtn.style.display = hits.length === 10 ? "" : "none";
    } catch (e) { info.textContent = e.message || String(e); }
  };
  const moreBtn = el("button", { class: "btn sm", style: "display:none", onclick: () => run(true) }, "Mehr");
  const searchBtn = gcsReady() ? el("button", { class: "btn sm primary", onclick: () => run(false) }, "🔍 Suchen") : null;
  q.addEventListener("keydown", e => { if (e.key === "Enter" && gcsReady()) run(false); });
  const sec = el("details", { class: "gsec" }, el("summary", {}, "🔍 Google-Bildersuche"),
    el("div", { class: "manual", style: "margin-top:8px" }, q, searchBtn, link),
    gcsReady() ? null : el("div", { class: "saved", style: "margin-top:4px" }, "Suche direkt in der App: Google-Schlüssel + Suchmaschinen-ID unter ", el("a", { href: "#", onclick: e => { e.preventDefault(); aboutBox(); } }, "Einstellungen"), " eintragen (100 Anfragen/Tag kostenlos). Ohne Schlüssel: Google-Tab öffnen und Bild hierher ziehen."),
    results, info, moreBtn,
    el("div", { class: "pasterow" }, drop, clipBtn),
    el("div", { class: "saved", style: "margin-top:4px", text: "Tipp: In Google Bilder erst ein Bild anklicken (große Vorschau rechts), dann dieses kopieren oder ziehen – das kleine Vorschaubild in der Trefferliste ist sehr unscharf." }));
  sec._open = () => { sec.open = true; if (gcsReady()) run(false); };
  return sec;
}
function gcsKeyBox() {
  const k = gcsKeys();
  const key = el("input", { class: "field", type: "password", placeholder: "API-Schlüssel (AIza…)", value: k.key, autocomplete: "off" });
  const cx = el("input", { class: "field", placeholder: "Suchmaschinen-ID (cx), z. B. 0123456789abcdef0", value: k.cx, autocomplete: "off" });
  const save = () => { try { for (const [n, v] of [["gcsKey", key.value.trim()], ["gcsCx", cx.value.trim()]]) { if (v) localStorage.setItem(n, v); else localStorage.removeItem(n); } toast(gcsReady() ? "Google-Bildersuche eingerichtet." : "Angaben gespeichert (unvollständig)."); } catch { toast("Konnte nicht gespeichert werden."); } };
  const test = async () => { try { const h = await googleImageSearch("Buch Cover", 1); toast(h.length ? `✓ Funktioniert – ${h.length} Bilder gefunden.` : "Verbindung ok, aber keine Treffer – ist „Bildersuche“ in der Suchmaschine aktiviert?", 4000); } catch (e) { toast("Fehler: " + e.message, 5000); } };
  return el("div", { class: "sec" }, el("h3", { text: "Google-Bildersuche (optional)" }),
    el("p", { class: "saved", text: "Für die Bildersuche direkt in der App (Cover, die in keinem Katalog sind). Kostenlos bis 100 Anfragen pro Tag. Beide Angaben bleiben nur in diesem Browser." }),
    el("div", { style: "display:grid;gap:8px;margin-top:6px" }, key, cx, el("div", { class: "covertools" }, el("button", { class: "btn", onclick: save }, "Speichern"), el("button", { class: "btn ghost", onclick: test }, "Testen"))),
    el("ol", { class: "saved", style: "margin:8px 0 0;padding-left:18px;line-height:1.6" },
      el("li", {}, el("a", { href: "https://programmablesearchengine.google.com/controlpanel/create", target: "_blank", rel: "noopener" }, "Programmable Search Engine ↗"), " anlegen: „Das gesamte Web durchsuchen“ wählen, dann in den Einstellungen „Bildersuche“ einschalten. Die Suchmaschinen-ID (cx) steht in der Übersicht."),
      el("li", {}, el("a", { href: "https://console.cloud.google.com/apis/library/customsearch.googleapis.com", target: "_blank", rel: "noopener" }, "Custom Search API ↗"), " in der Google Cloud Console aktivieren → Anmeldedaten → API-Schlüssel erstellen. Derselbe Schlüssel funktioniert auch für Google Books, wenn dort die Books API aktiviert ist.")));
}

/* Beim Start im Hintergrund: Cover-Adressen ohne gespeichertes Bild prüfen (einmal pro Sitzung). */
setTimeout(async () => {
  if (!S.loaded || !navigator.onLine) return;
  try { const r = await verifyCoverLinks({ limit: 150 }); if (r.bad) toast(`${r.bad} ${r.bad === 1 ? "Buch hat" : "Bücher haben"} nur ein Pseudo-Cover – jetzt als „ohne Cover“ markiert.`, 5000); } catch {}
}, 4000);
