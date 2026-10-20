/* Offline support: the app shell is cached; patient data never passes through here (it lives in IndexedDB). */
const VERSION = "practice-v1.0.0";
const SHELL = [
  "./", "index.html", "app.css", "fonts.css", "strings.js", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
  "fonts/commissioner-greek-wght-normal.woff2", "fonts/commissioner-latin-wght-normal.woff2",
  "fonts/noto-sans-greek-400-normal.woff2", "fonts/noto-sans-latin-400-normal.woff2",
  "fonts/noto-sans-greek-600-normal.woff2", "fonts/noto-sans-latin-600-normal.woff2"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Same-origin GETs: answer from cache at once, refresh the cache in the background.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      const res = await network;
      return res || (req.mode === "navigate" ? cache.match("index.html") : Response.error());
    })
  );
});
