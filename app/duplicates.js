/* Mein Bücherregal – mögliche Dubletten prüfen: zusammenführen oder als verschiedene Bücher markieren.
   Die Erkennung (dupGroups) steht in app.js, weil die Tabelle die Anzahl schon beim ersten Anzeigen braucht. */
"use strict";

// Welcher Eintrag standardmäßig bleibt: im Bestand vor „Hatte ich mal“ vor Wunschliste, eingeräumt, vollständiger, mit Cover/Anhängen, länger da
function dupScore(b) {
  return (inStock(b) ? 1000 : isGone(b) ? 500 : 0) + (locationOf(b.id) ? 100 : 0) - missingOf(b).length * 10
    + (hasCover(b) ? 5 : 0) + ((b.images || []).length + (b.files || []).length ? 3 : 0);
}
const dupOrder = (a, b) => dupScore(b) - dupScore(a) || String(a.addedAt || "").localeCompare(String(b.addedAt || ""));

const MERGE_FIELDS = ["title", "author", "year", "isbn", "publisher", "series", "seriesNo", "pages", "genre", "language", "price", "value", "summary", "signedBy", "dedication"];
const filled = v => String(v ?? "").trim() !== "";

/** Führt die Bücher otherIds in keepId zusammen: Leeres wird ergänzt, Listen vereinigt, Anhänge umgehängt, die anderen gelöscht. */
async function mergeBooks(keepId, otherIds) {
  const keep = S.books.find(b => b.id === keepId); if (!keep) return;
  const others = otherIds.filter(id => id !== keepId).map(id => S.books.find(b => b.id === id)).filter(Boolean);
  const k = { ...keep };
  let shelvesChanged = false;
  for (const o of others) {
    for (const f of MERGE_FIELDS) if (!filled(k[f]) && filled(o[f])) k[f] = o[f];
    if (!k.coverBlob && !k.coverUrl) { if (o.coverBlob) k.coverBlob = o.coverBlob; else if (o.coverUrl) k.coverUrl = o.coverUrl; }
    if (!k.spine && o.spine) k.spine = o.spine;
    if (o.signed) k.signed = true;
    if (o.favorite) k.favorite = true;
    k.rating = Math.max(k.rating || 0, o.rating || 0);
    const tags = [...new Set([...(k.tags || []), ...(o.tags || [])])]; if (tags.length) k.tags = tags;
    if (filled(o.notes) && !String(k.notes || "").includes(o.notes.trim())) k.notes = [k.notes, o.notes].filter(filled).map(s => s.trim()).join("\n\n");
    // Lesezeiten vereinigen (alte Felder startedAt/finishedAt werden dabei übersetzt)
    const seen = new Set(), reads = [];
    for (const r of [...readsOf(k), ...readsOf(o)]) { const key = `${r.start}|${r.end}|${r.note || ""}`; if (!seen.has(key)) { seen.add(key); reads.push({ ...r }); } }
    if (reads.length) { k.reads = reads.sort((x, y) => String(x.start || x.end).localeCompare(String(y.start || y.end))); delete k.startedAt; delete k.finishedAt; }
    if ((STATUS_ORDER[o.status || "unread"] || 0) > (STATUS_ORDER[k.status || "unread"] || 0)) k.status = o.status;
    if (isWish(k) && inStock(o)) delete k.wish; // gekauft: der Eintrag im Bestand zählt
    if (o.addedAt && (!k.addedAt || o.addedAt < k.addedAt)) k.addedAt = o.addedAt;
    // weitere Bilder und Dateien: Speicher-Einträge auf das bleibende Buch umhängen
    for (const x of [...(o.images || []), ...(o.files || [])]) {
      const r = await DB.getBlob(x.id).catch(() => null);
      if (r) { r.bookId = k.id; await DB.putBlob(r); }
    }
    if ((o.images || []).length) k.images = [...(k.images || []), ...o.images];
    if ((o.files || []).length) k.files = [...(k.files || []), ...o.files];
    // Platz im Regal übernehmen, wenn das bleibende Buch noch nicht eingeräumt ist
    const lo = locationOf(o.id);
    if (lo && !locationOf(k.id)) { lo.list[lo.pos] = k.id; if (isLying(o.id)) setLying(k.id, true); shelvesChanged = true; }
    if (isLying(o.id)) { setLying(o.id, false); shelvesChanged = true; }
    k.notDup = [...new Set([...(k.notDup || []), ...(o.notDup || [])])];
  }
  const merged = new Set(others.map(o => o.id));
  k.notDup = (k.notDup || []).filter(id => id !== k.id && !merged.has(id));
  if (!k.notDup.length) delete k.notDup;
  await putBook(k);
  for (const o of others) {
    const cur = S.books.find(b => b.id === o.id);
    if (cur) { cur.images = []; cur.files = []; } // umgehängte Anhänge nicht mitlöschen
    await removeBook(o.id);
  }
  if (shelvesChanged) await saveShelves();
  renderAll();
}

/** Markiert alle Bücher der Gruppe gegenseitig als „verschiedene Bücher“ (z. B. zwei Exemplare oder verschiedene Bände). */
async function markDistinct(ids) {
  for (const id of ids) {
    const b = S.books.find(x => x.id === id); if (!b) continue;
    await patchBook(id, { notDup: [...new Set([...(b.notDup || []), ...ids.filter(x => x !== id)])] });
  }
}

function dupStateText(b) {
  if (isGone(b)) return "📦 Hatte ich mal · " + goneText(b.gone);
  if (isWish(b)) return "⭐ Wunschliste";
  const loc = locationOf(b.id);
  return [STATUS[b.status || "unread"], loc ? "📍 " + locationShort(loc) : "nicht eingeräumt", extrasSummary(b)].filter(Boolean).join(" · ");
}

function dupGroupCard(group, redraw) {
  const g = [...group].sort(dupOrder);
  let keep = g[0].id;
  const radioName = "dupkeep-" + g[0].id;
  const rows = g.map(b => {
    const r = el("input", { type: "radio", name: radioName, value: b.id, checked: b.id === keep || null, "aria-label": "Behalten: " + (b.title || "ohne Titel") });
    r.addEventListener("change", () => { keep = b.id; });
    const src = coverSrc(b);
    return el("label", { class: "duprow" }, r,
      el("div", { class: "thumb" }, src ? el("img", { src, alt: "", loading: "lazy", onerror: e => e.target.remove() }) : null),
      el("div", { class: "dupinfo" },
        el("b", { text: b.title || "(ohne Titel)" }),
        el("div", { class: "saved", text: [b.author, b.year, b.isbn ? "ISBN " + b.isbn : "ohne ISBN", b.seriesNo ? "Band " + b.seriesNo : "", b.publisher].filter(filled).join(" · ") }),
        el("div", { class: "saved", text: dupStateText(b) })),
      el("button", { class: "btn sm ghost", type: "button", title: "Eintrag ansehen oder korrigieren (z. B. die ISBN)", onclick: e => { e.preventDefault(); openDetail(b.id); } }, "Öffnen"));
  });
  const why = g.some((b, i) => i && toIsbn13(b.isbn) && toIsbn13(b.isbn) === toIsbn13(g[0].isbn)) ? "gleiche ISBN" : "gleicher Titel und Autor";
  return el("div", { class: "dupgroup" },
    el("div", { class: "duphead" }, el("b", { text: `${g.length}× „${g[0].title || "ohne Titel"}“` }), el("span", { class: "saved", text: " – " + why })),
    el("div", { class: "saved", text: "Ausgewählt = dieser Eintrag bleibt." }),
    ...rows,
    el("div", { class: "row dupbtns" },
      el("button", { class: "btn sm primary", onclick: async () => {
        const n = g.length - 1;
        if (!(await confirmBox(`${n === 1 ? "Den anderen Eintrag" : `Die ${n} anderen Einträge`} in den ausgewählten übernehmen und dann löschen?\n\nFehlende Angaben, Schlagworte, Notizen, Lesezeiten, Bilder und Dateien werden übernommen.`, "Zusammenführen"))) return;
        await mergeBooks(keep, g.map(b => b.id));
        toast("Zusammengeführt."); redraw();
      } }, "Zusammenführen"),
      el("button", { class: "btn sm", title: "z. B. zwei Exemplare oder verschiedene Bände – wird nicht mehr als Dublette angezeigt", onclick: async () => {
        await markDistinct(g.map(b => b.id)); toast("Als verschiedene Bücher gemerkt."); redraw();
      } }, "Sind verschiedene Bücher")));
}

function openDuplicates() {
  const sh = sheet("🧩 Mögliche Dubletten");
  const draw = () => {
    const groups = dupGroups().sort((a, b) => coll.compare(a[0].title || "", b[0].title || ""));
    if (!groups.length) { fillNode(sh.body, el("p", { text: "Keine möglichen Dubletten gefunden. 🎉" })); return; }
    fillNode(sh.body,
      el("p", { class: "saved", text: `${groups.length} ${groups.length === 1 ? "Gruppe" : "Gruppen"} mit gleicher ISBN oder gleichem Titel und Autor. ` +
        "Zusammenführen behält den ausgewählten Eintrag und übernimmt, was ihm fehlt. Sind es wirklich verschiedene Bücher (zwei Exemplare, andere Bände), " +
        "merkt sich die App das. Stimmt nur eine ISBN nicht, öffne den Eintrag und korrigiere sie." }),
      ...groups.map(g => dupGroupCard(g, draw)));
  };
  draw();
}
