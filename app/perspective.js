/* Mein Bücherregal – Perspektive entzerren (ohne Bibliothek).
   Ein schräg fotografiertes Buch: Vorderseite und Rücken sind je ein Viereck im Foto. Die App rechnet daraus gerade Bilder
   (Homographie, Canvas). Die Ecken liefert die KI (`cover_quad`, `spine_quad` in der Cover-Erkennung) oder man zieht sie
   von Hand im Ecken-Editor (`quadEditor`). Ecken sind immer relativ (0–1), im Uhrzeigersinn ab oben links. */
"use strict";

/* ---------- Rechnen ---------- */
// Lineares Gleichungssystem A·x = b (Gauß mit Spaltenpivot); null, wenn es keine eindeutige Lösung gibt.
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
// Homographie (3×3 als Liste mit 9 Werten), die die 4 Punkte src genau auf die 4 Punkte dst abbildet.
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solveLinear(A, b);
  return h && [...h, 1];
}
function applyH(h, x, y) { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; }
const qdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Brauchbares Viereck? 4 Punkte im Bild, konvex, im Uhrzeigersinn (y nach unten), nicht winzig. Sonst null.
function validQuad(q) {
  if (!Array.isArray(q) || q.length !== 4) return null;
  const p = q.map(pt => Array.isArray(pt) ? pt.map(Number) : [Number(pt?.x), Number(pt?.y)]);
  if (p.some(([x, y]) => !isFinite(x) || !isFinite(y) || x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02)) return null;
  const c = p.map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4];
    if ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]) <= 0) return null; // nicht konvex oder gegen den Uhrzeigersinn
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2 >= 0.002 ? c : null;
}
// Ecken aus einer KI-Antwort (fehlende oder unbrauchbare Angaben → null; alte Antworten haben keine)
function quadsFromAnswer(d) {
  const cover = validQuad(d?.cover_quad), spine = validQuad(d?.spine_quad);
  return cover || spine ? { cover, spine } : null;
}

/* Entzerrt das Viereck quad (relativ) aus dem Bild zu einem geraden Bild. Breite/Höhe aus den Kantenlängen, längste Seite ≤ maxPx. */
async function warpQuad(source, quad, maxPx = 1600) {
  const img = source instanceof Blob ? await loadImage(source) : source;
  const src = toCanvas(img, 3000); // genug Auflösung, ohne den Speicher am Handy zu sprengen
  const out = warpCanvas(src, quad, maxPx);
  src.width = src.height = 0;
  return canvasBlob(out, .88);
}
/* Entzerren direkt aus einer Canvas (z. B. viele Buchrücken aus demselben Fach-Foto) → Canvas.
   Gelesen wird nur der Bereich um das Viereck, nicht das ganze Foto. */
function warpCanvas(src, quad, maxPx = 1600) {
  const W0 = src.width, H0 = src.height, P0 = quad.map(([x, y]) => [x * W0, y * H0]);
  const bx = Math.max(0, Math.floor(Math.min(...P0.map(p => p[0]))) - 2), by = Math.max(0, Math.floor(Math.min(...P0.map(p => p[1]))) - 2);
  const W = Math.min(W0, Math.ceil(Math.max(...P0.map(p => p[0]))) + 2) - bx, H = Math.min(H0, Math.ceil(Math.max(...P0.map(p => p[1]))) + 2) - by;
  if (W < 2 || H < 2) throw new Error("Ecken ungültig");
  const P = P0.map(([x, y]) => [x - bx, y - by]);
  let w = Math.max(qdist(P[0], P[1]), qdist(P[3], P[2])), h = Math.max(qdist(P[0], P[3]), qdist(P[1], P[2]));
  const s = Math.min(1, maxPx / Math.max(w, h)); w = Math.max(2, Math.round(w * s)); h = Math.max(2, Math.round(h * s));
  const hm = homography([[0, 0], [w, 0], [w, h], [0, h]], P);
  if (!hm) throw new Error("Ecken ungültig");
  const sd = src.getContext("2d").getImageData(bx, by, W, H).data;
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const od = out.getContext("2d").createImageData(w, h), o = od.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let [u, v] = applyH(hm, x + 0.5, y + 0.5); u -= 0.5; v -= 0.5;
    u = Math.min(W - 1.001, Math.max(0, u)); v = Math.min(H - 1.001, Math.max(0, v));
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = (y0 * W + x0) * 4, j = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) { // bilinear aus den vier Nachbarpixeln
      const a = sd[i + k] + (sd[i + 4 + k] - sd[i + k]) * fx, b = sd[i + W * 4 + k] + (sd[i + W * 4 + 4 + k] - sd[i + W * 4 + k]) * fx;
      o[j + k] = a + (b - a) * fy;
    }
    o[j + 3] = 255;
  }
  out.getContext("2d").putImageData(od, 0, 0);
  return out;
}

/* ---------- Ecken-Editor ----------
   Vollbild: Foto mit Viereck und vier Griffen (Maus/Finger), Lupe beim Ziehen. Reiter „Cover“ und – mit spine:true – „Rücken“.
   Ergebnis: { cover, spine } (je Viereck oder null) bzw. null bei „Abbrechen“. */
const DEFAULT_COVER_QUAD = [[0.12, 0.08], [0.88, 0.08], [0.88, 0.92], [0.12, 0.92]];
const DEFAULT_SPINE_QUAD = [[0.02, 0.08], [0.1, 0.08], [0.1, 0.92], [0.02, 0.92]];
function quadEditor(file, { cover = null, spine = null, withSpine = false, title = "✂ Zuschneiden" } = {}) {
  return new Promise(async resolve => {
    const url = URL.createObjectURL(file);
    const img = el("img", { src: url, alt: "", draggable: "false" });
    try { await img.decode(); } catch { URL.revokeObjectURL(url); toast("Bild konnte nicht gelesen werden."); resolve(null); return; }
    const Q = { cover: (cover || DEFAULT_COVER_QUAD).map(p => [...p]), spine: spine ? spine.map(p => [...p]) : null };
    let tab = "cover";
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "qsvg"); svg.setAttribute("viewBox", "0 0 1 1"); svg.setAttribute("preserveAspectRatio", "none");
    const polys = { cover: document.createElementNS(NS, "polygon"), spine: document.createElementNS(NS, "polygon") };
    polys.cover.setAttribute("class", "qpoly cover"); polys.spine.setAttribute("class", "qpoly spine"); svg.append(polys.cover, polys.spine);
    const handles = [0, 1, 2, 3].map(i => el("div", { class: "qh", "data-i": i, title: ["oben links", "oben rechts", "unten rechts", "unten links"][i] }));
    const lens = el("canvas", { class: "qlens", width: 132, height: 132 });
    const stage = el("div", { class: "qstage" }, img, svg, ...handles, lens);
    const tabs = el("div", { class: "seg" });
    const spineInfo = el("div", { class: "saved" });
    const draw = () => {
      for (const k of ["cover", "spine"]) { const q = Q[k]; polys[k].setAttribute("points", q ? q.map(p => p.join(",")).join(" ") : ""); polys[k].classList.toggle("on", k === tab); }
      const q = Q[tab];
      handles.forEach((h, i) => { h.style.display = q ? "" : "none"; if (q) { h.style.left = q[i][0] * 100 + "%"; h.style.top = q[i][1] * 100 + "%"; } h.classList.toggle("spine", tab === "spine"); });
      if (withSpine) fillNode(tabs,
        el("button", { type: "button", class: tab === "cover" ? "on" : "", onclick: () => { tab = "cover"; draw(); } }, "📕 Cover"),
        el("button", { type: "button", class: tab === "spine" ? "on" : "", onclick: () => { tab = "spine"; if (!Q.spine) Q.spine = DEFAULT_SPINE_QUAD.map(p => [...p]); draw(); } }, "📗 Rücken"));
      spineInfo.replaceChildren(...(withSpine && Q.spine ? [el("span", { text: "Rücken wird mit übernommen. " }), el("a", { href: "#", onclick: e => { e.preventDefault(); Q.spine = null; tab = "cover"; draw(); } }, "Rücken weglassen")]
        : withSpine ? [el("span", { text: "Ist auch der Rücken zu sehen? Reiter „📗 Rücken“ antippen und seine Ecken setzen." })] : []));
    };
    // Lupe: zeigt die Umgebung der gezogenen Ecke dreifach vergrößert, neben dem Finger
    const showLens = (i, cx, cy) => {
      const q = Q[tab], r = stage.getBoundingClientRect(), g = lens.getContext("2d"), sz = 132, z = 3;
      const sx = q[i][0] * img.naturalWidth, sy = q[i][1] * img.naturalHeight, f = img.naturalWidth / r.width;
      g.fillStyle = "#222"; g.fillRect(0, 0, sz, sz);
      g.drawImage(img, sx - sz / 2 * f / z, sy - sz / 2 * f / z, sz * f / z, sz * f / z, 0, 0, sz, sz);
      g.strokeStyle = tab === "spine" ? "#2a9d5c" : "#e8590c"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(sz / 2, 0); g.lineTo(sz / 2, sz); g.moveTo(0, sz / 2); g.lineTo(sz, sz / 2); g.stroke();
      lens.style.display = "block";
      const left = cx - r.left > r.width / 2 ? cx - r.left - sz - 40 : cx - r.left + 40;
      lens.style.left = Math.max(0, Math.min(r.width - sz, left)) + "px"; lens.style.top = Math.max(0, cy - r.top - sz - 30) + "px";
    };
    handles.forEach((h, i) => {
      h.addEventListener("pointerdown", e => {
        e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add("drag");
        const move = ev => {
          const r = stage.getBoundingClientRect(), q = Q[tab];
          q[i] = [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
          draw(); showLens(i, ev.clientX, ev.clientY);
        };
        const up = () => { h.classList.remove("drag"); lens.style.display = "none"; h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); };
        h.addEventListener("pointermove", move); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
        showLens(i, e.clientX, e.clientY);
      });
    });
    const done = v => { box.remove(); URL.revokeObjectURL(url); resolve(v); };
    const ok = () => {
      const cq = validQuad(Q.cover), sq = Q.spine ? validQuad(Q.spine) : null;
      if (!cq) { tab = "cover"; draw(); toast("Die Cover-Ecken bilden kein gültiges Viereck – bitte im Uhrzeigersinn ab oben links setzen."); return; }
      if (Q.spine && !sq) { tab = "spine"; draw(); toast("Die Rücken-Ecken bilden kein gültiges Viereck."); return; }
      done({ cover: cq, spine: sq });
    };
    const box = el("div", { class: "overlay confirm qedit", style: "z-index:80" },
      el("div", { class: "sheet" },
        el("div", { class: "sheet-h" }, el("h2", { text: title }), el("button", { class: "x", onclick: () => done(null) }, "✕")),
        el("div", { class: "sheet-b" },
          el("p", { class: "saved", style: "margin:0 0 8px", text: "Die vier Ecken auf die Ecken des Buchs ziehen – die App macht daraus ein gerades Bild." }),
          withSpine ? tabs : null, el("div", { class: "qwrap" }, stage), spineInfo,
          el("div", { class: "actions" }, el("button", { class: "btn ghost", onclick: () => done(null) }, "Abbrechen"), el("button", { class: "btn primary", onclick: ok }, "Übernehmen")))));
    // Seitenverhältnis des Fotos für die Fläche (Griffe liegen dann genau auf dem Bild)
    stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    stage.style.setProperty("--ar", img.naturalWidth / img.naturalHeight);
    document.body.append(box);
    draw();
  });
}
