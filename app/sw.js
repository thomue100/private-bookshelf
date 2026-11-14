/* Service Worker: App offline verfügbar machen. Version erhöhen, wenn sich Dateien ändern. */
const VERSION = "v26";
const SHELL = `shell-${VERSION}`;
const RUNTIME = "runtime-v1";
const FILES = ["./", "index.html", "app.js", "attachments.js", "shelfscan.js", "autobackup.js", "coverfinder.js", "sync.js", "duplicates.js", "style.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("shell-") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Buch-APIs immer live
  if (url.hostname === "www.googleapis.com" || url.pathname.endsWith(".json") && url.hostname === "openlibrary.org") return;
  // Eigene Dateien: erst Netz (damit Updates ankommen), sonst Cache
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(SHELL).then(ca => ca.put(req, c)); return r; }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
    return;
  }
  // Bibliotheken, Schriften, Texterkennungs-Daten, Cover: Cache zuerst
  const cacheable = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com", "tessdata.projectnaptha.com", "covers.openlibrary.org", "books.google.com", "books.googleusercontent.com", "archive.org"].some(h => url.hostname === h || url.hostname.endsWith("." + h));
  if (cacheable) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(RUNTIME).then(ca => ca.put(req, c)); } return r; })));
  }
});
