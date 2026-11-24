/* Aufstellungen: dieselbe Bibliothek in mehreren Varianten ins echte Regal einsortiert (z. B. „Nach Farben“, „Nach Autoren“).
   Gespeichert additiv in S.shelves (Meta „shelves“, Sicherung, Abgleich – ältere App-Versionen nehmen die Felder unverändert mit):
     S.shelves.variants  = [{ id, name, walls?, lying? }]  – alle Aufstellungen; nur die nicht aktiven tragen walls/lying
     S.shelves.variantId = Id der aktiven Aufstellung      – deren Inhalt steht wie bisher in S.shelves.walls/lying
   Fehlen die Felder, gibt es genau eine (unbenannte) Aufstellung – alles wie früher.
   Jede Aufstellung hat ihren eigenen Aufbau (Würfel, Wände); „gleicher Aufbau, leer“ übernimmt die Würfel ohne Bücher. */

const lyClone = x => JSON.parse(JSON.stringify(x ?? null));
function layoutsOf() { return Array.isArray(S.shelves.variants) ? S.shelves.variants : []; }
function activeLayout() { const v = layoutsOf(); return v.find(x => x.id === S.shelves.variantId) || null; }
// Sorgt dafür, dass die gerade sichtbare Aufstellung einen Eintrag hat (beim ersten Anlegen einer zweiten)
function ensureActiveLayout() {
  if (!Array.isArray(S.shelves.variants)) S.shelves.variants = [];
  let cur = activeLayout();
  if (!cur) { cur = { id: uid().slice(0, 8), name: "Aufstellung " + (S.shelves.variants.length + 1) }; S.shelves.variants.unshift(cur); S.shelves.variantId = cur.id; }
  return cur;
}
// Bücher einer Aufstellung zählen (aktive: aus S.shelves.walls)
function layoutWalls(v) { return v.id === S.shelves.variantId ? S.shelves.walls : (v.walls || []); }
function layoutFachs(walls) {
  const out = [];
  for (const w of walls || []) (w.columns || []).forEach((c, ci) => (c.modules || []).forEach((m, mi) => {
    for (const k of modLayout(m).keys) for (const layer of ["front", "back", "top"]) {
      const o = layer === "back" ? m.back : layer === "top" ? m.top : m.fachs;
      out.push({ w, c, ci, m, mi, k, layer, list: (o && o[k]) || [] });
    }
  }));
  return out;
}
function layoutCount(v) { const ids = new Set(); for (const f of layoutFachs(layoutWalls(v))) for (const id of f.list) if (bookOf(id)) ids.add(id); return ids.size; }
// Wo steht das Buch in den anderen (nicht aktiven) Aufstellungen? Für den Standort im Buch.
function layoutLocations(id) {
  const out = [];
  for (const v of layoutsOf()) {
    if (v.id === S.shelves.variantId) continue;
    let loc = null;
    for (const f of layoutFachs(v.walls)) { const i = f.list.indexOf(id); if (i >= 0) { loc = { ...f, pos: i }; break; } }
    out.push({ v, text: loc ? locationShort(loc) : "nicht eingeräumt" });
  }
  return out;
}
// Zusammengeführte Dubletten: Platz in den anderen Aufstellungen ebenfalls übernehmen (duplicates.js)
function layoutsReplaceId(from, to) {
  let ch = false;
  for (const v of layoutsOf()) {
    if (v.id === S.shelves.variantId || !v.walls) continue;
    const fachs = layoutFachs(v.walls), has = fachs.some(f => f.list.includes(to));
    for (const f of fachs) { let i; while ((i = f.list.indexOf(from)) >= 0) { if (has) f.list.splice(i, 1); else { f.list[i] = to; if (v.lying?.[from]) v.lying[to] = true; } ch = true; } }
    if (v.lying?.[from]) { delete v.lying[from]; ch = true; }
  }
  return ch;
}
function emptiedWalls(walls) {
  const ws = lyClone(walls) || [];
  for (const w of ws) for (const c of w.columns || []) for (const m of c.modules || []) { m.fachs = {}; m.back = {}; m.top = {}; delete m.fit; ensureLayers(m); }
  return ws;
}
async function switchLayout(id) {
  const target = layoutsOf().find(x => x.id === id); if (!target || id === S.shelves.variantId) return;
  const cur = ensureActiveLayout();
  cur.walls = S.shelves.walls; cur.lying = S.shelves.lying || {};
  S.shelves.walls = target.walls || []; S.shelves.lying = target.lying || {};
  delete target.walls; delete target.lying;
  S.shelves.variantId = target.id;
  // inzwischen gelöschte Bücher (Grabstein) aus der hervorgeholten Aufstellung nehmen
  for (const f of allFachs()) for (let i = f.list.length - 1; i >= 0; i--) if (S.deleted?.[f.list[i]] && !bookOf(f.list[i])) { delete S.shelves.lying[f.list[i]]; f.list.splice(i, 1); }
  endPick(); S.sel.clear(); S.selMode = false; S.highlight = null; S.wallReset = true;
  if (!S.shelves.walls.some(w => w.id === S.wallId)) S.wallId = null;
  await saveShelves(); renderAll();
  toast(`Aufstellung „${target.name}“ ist jetzt im Regal zu sehen.`, 2400);
}
// Neue Aufstellung: Kopie der aktuellen (Bücher bleiben, wo sie sind) oder gleicher Aufbau ohne Bücher; danach ist sie aktiv
async function addLayout(name, empty) {
  ensureActiveLayout();
  const v = { id: uid().slice(0, 8), name: name || "Aufstellung " + (S.shelves.variants.length + 1),
    walls: empty ? emptiedWalls(S.shelves.walls) : lyClone(S.shelves.walls) || [], lying: empty ? {} : lyClone(S.shelves.lying || {}) };
  S.shelves.variants.push(v);
  await switchLayout(v.id);
  return v;
}
async function renameLayout(id, name) {
  const v = layoutsOf().find(x => x.id === id); name = String(name || "").trim(); if (!v || !name) return;
  v.name = name; await saveShelves(); renderAll();
}
async function deleteLayout(id) {
  const v = layoutsOf().find(x => x.id === id); if (!v || id === S.shelves.variantId) return;
  S.shelves.variants = layoutsOf().filter(x => x !== v);
  await saveShelves(); renderAll();
}

function openLayouts() {
  const sh = sheet("Aufstellungen");
  const draw = () => {
    const list = layoutsOf().length ? layoutsOf() : [{ id: null, name: "Aktuelle Aufstellung" }];
    const nm = n => n === 1 ? "1 Buch eingeräumt" : n + " Bücher eingeräumt";
    const rows = list.map(v => {
      const active = v.id === S.shelves.variantId || v.id === null;
      const name = el("input", { class: "field", value: v.name, "aria-label": "Name der Aufstellung" });
      name.addEventListener("change", async () => { if (v.id === null) { ensureActiveLayout().name = name.value.trim() || "Aufstellung 1"; await saveShelves(); } else await renameLayout(v.id, name.value); draw(); });
      const n = v.id === null ? layoutFachs(S.shelves.walls).reduce((s, f) => s + f.list.filter(bookOf).length, 0) : layoutCount(v);
      return el("div", { class: "lyrow" + (active ? " active" : "") },
        el("div", { class: "grow" }, name, el("div", { class: "small muted mt-1", text: (active ? "✓ jetzt im Regal · " : "") + nm(n) })),
        el("div", { class: "hstack" },
          active ? null : el("button", { class: "btn sm primary", onclick: async () => { await switchLayout(v.id); closeSheet(); if (location.hash !== "#wand") location.hash = "#wand"; } }, "Zeigen"),
          active ? null : el("button", { class: "btn sm ghost danger", "aria-label": "Aufstellung löschen", onclick: async () => { if (await confirmBox(`Aufstellung „${v.name}“ löschen? Die Bücher bleiben in deiner Sammlung und in den anderen Aufstellungen.`, "Löschen")) { await deleteLayout(v.id); draw(); } } }, "Löschen")));
    });
    const newName = el("input", { class: "field", placeholder: "z. B. Nach Farben, Nach Autoren", "aria-label": "Name der neuen Aufstellung" });
    fillNode(sh.body,
      el("p", { class: "muted", text: "Du kannst deine Bücher in mehreren Varianten ins Regal einsortieren und zwischen ihnen wechseln. Jede Aufstellung merkt sich Würfel, Fächer und die Reihenfolge der Bücher. Die Bücher selbst gibt es nur einmal." }),
      el("div", { class: "vstack lylist" }, ...rows),
      el("h3", { class: "mt-4", text: "Neue Aufstellung" }), newName,
      el("div", { class: "covertools mt-2" },
        el("button", { class: "btn sm primary", onclick: async () => { const v = await addLayout(newName.value.trim(), false); closeSheet(); toast(`„${v.name}“ angelegt – eine Kopie der bisherigen. Jetzt kannst du umstellen.`, 3000); if (location.hash !== "#wand") location.hash = "#wand"; } }, "📋 Kopie der jetzigen"),
        el("button", { class: "btn sm", onclick: async () => { const v = await addLayout(newName.value.trim(), true); closeSheet(); toast(`„${v.name}“ angelegt – gleiche Würfel, noch keine Bücher eingeräumt.`, 3000); if (location.hash !== "#wand") location.hash = "#wand"; } }, "🧱 Gleicher Aufbau, leer")),
      el("p", { class: "small muted mt-3", text: "Was du im Regal umstellst, gilt immer für die Aufstellung, die gerade zu sehen ist. Beim Abgleich und in Sicherungen sind alle Aufstellungen dabei." }));
  };
  draw();
}
