/* Cartuchin service worker: the emulator files are big and never change between
   releases, so they come from the cache; the page and app script check the network first. */
const VERSION = "cartucho-v2";
const CORE = ["vendor/emulator.min.js", "vendor/emulator.min.css", "vendor/mgba_libretro.js", "ejs/cores/mgba_libretro.wasm", "vendor/lang-pt-BR.js", "vendor/qrcode.js", "icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isCore = CORE.some((p) => url.pathname.endsWith("/" + p));
  if (isCore) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const c = r.clone(); caches.open(VERSION).then((cc) => cc.put(e.request, c)); return r; })));
  } else {
    // "no-cache" asks the server every time (a cheap check when nothing changed), so the
    // page and its script never come from two different versions of the app
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((cc) => cc.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
  }
});
