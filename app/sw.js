/* Service Worker: App offline verfügbar machen. Version erhöhen, wenn sich Dateien ändern.
   Wie bei professionellen PWAs: Die App-Dateien kommen sofort aus dem Zwischenspeicher („cache first“) – auch bei schlechtem
   Empfang startet die App ohne Warten. Neue Versionen kommen über eine neue VERSION: Der neue Service Worker lädt alle Dateien
   im Hintergrund, danach zeigt die App „Neue Version der App ist da“. Cover-Bilder werden beim ersten Anzeigen gemerkt. */
const VERSION = "v69";
const SHELL = `shell-${VERSION}`;
const RUNTIME = "runtime-v1";
const CDN = ["https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"]; // optional: darf die Installation nicht verhindern
const RUNTIME_MAX = 3000; // höchstens so viele gemerkte Bilder
const FILES = ["./", "index.html", "app.js", "reclog.js", "attachments.js", "shelfscan.js", "spineread.js", "judge.js", "titlelist.js", "shelfphotos.js", "batchscan.js", "autobackup.js", "coverfinder.js", "sync.js", "duplicates.js", "webtake.js", "perspective.js", "stackscan.js", "measures.js", "style.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES).then(() => Promise.all(CDN.map(u => c.add(u).catch(() => {})))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("shell-") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// „Teilen → Bücherregal“ (Android): Fotos/Text im Cache „share-inbox“ ablegen und die App öffnen; dort übernimmt shelfphotos.js.
async function receiveShare(req) {
  const id = Date.now();
  try {
    const form = await req.formData();
    const cache = await caches.open("share-inbox");
    const text = ["title", "text", "url"].map(k => form.get(k)).filter(v => typeof v === "string" && v.trim()).join("\n");
    if (text) await cache.put(`share/${id}/text`, new Response(text, { headers: { "content-type": "text/plain;charset=utf-8" } }));
    let n = 0;
    for (const f of form.getAll("photos")) if (f && typeof f !== "string") await cache.put(`share/${id}/file-${n++}`, new Response(f, { headers: { "content-type": f.type || "application/octet-stream" } }));
  } catch {}
  return Response.redirect(new URL(`./?share=${id}`, self.registration.scope).href, 303);
}
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method === "POST" && new URL(req.url).pathname.endsWith("/share-target")) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Buch-APIs immer live
  if (url.hostname === "www.googleapis.com" || url.pathname.endsWith(".json") && url.hostname === "openlibrary.org") return;
  // Eigene Dateien: sofort aus dem Zwischenspeicher dieser Version, sonst Netz (und merken).
  // Nur beim Entwickeln auf localhost erst das Netz, damit Änderungen ohne neue VERSION sichtbar sind.
  if (url.origin === location.origin) {
    e.respondWith(url.hostname === "localhost" ? networkFirst(req) : shellFirst(req));
    return;
  }
  // Bilder fremder Seiten (z. B. Cover in Suchergebnissen): beim ersten Anzeigen merken
  if (req.destination === "image" && url.protocol === "https:") { e.respondWith(runtimeFirst(req)); return; }
  // Bibliotheken, Schriften, Texterkennungs-Daten, Cover: Cache zuerst
  const cacheable = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com", "tessdata.projectnaptha.com", "covers.openlibrary.org", "books.google.com", "books.googleusercontent.com", "archive.org"].some(h => url.hostname === h || url.hostname.endsWith("." + h));
  if (cacheable) e.respondWith(runtimeFirst(req));
});
async function shellFirst(req) {
  const c = await caches.open(SHELL);
  const hit = req.mode === "navigate" ? (await c.match(req, { ignoreSearch: true }) || await c.match("index.html")) : await c.match(req);
  if (hit) return hit;
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
  catch { return (await caches.match(req)) || (req.mode === "navigate" ? c.match("index.html") : Response.error()); }
}
async function networkFirst(req) {
  try { const r = await fetch(req); if (r.ok) { const c = r.clone(); caches.open(SHELL).then(ca => ca.put(req, c)); } return r; }
  catch { return (await caches.match(req, { ignoreSearch: req.mode === "navigate" })) || (await caches.match("index.html")); }
}
let trimming = null;
async function runtimeFirst(req) {
  const hit = await caches.match(req); if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === "opaque") {
    const c = r.clone();
    caches.open(RUNTIME).then(ca => ca.put(req, c)).then(() => { trimming = trimming || trimRuntime().finally(() => { trimming = null; }); }).catch(() => {});
  }
  return r;
}
async function trimRuntime() {
  const ca = await caches.open(RUNTIME); const keys = await ca.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - RUNTIME_MAX))) await ca.delete(k); // älteste zuerst
}
