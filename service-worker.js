// Service Worker für Marmotte Trinkgeld
// Macht die App installierbar und zeigt sie auch ohne Verbindung an.
// Strategie: zuerst Netzwerk (damit Änderungen sofort ankommen), bei fehlender
// Verbindung aus dem Cache.

// Achtung: Cache Storage ist pro Origin. Alle Marmotte-Apps liegen auf derselben
// Adresse, deshalb hat jede App ein eigenes Präfix und räumt nur ihre eigenen Caches auf.
const CACHE_PREFIX = "marmotte-trinkgeld-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const DESIGN = "https://bakerymarmotte-cmyk.github.io/marmotte-design";
const SHELL_FILES = [
  "./index.html",
  "./manifest.json",
  `${DESIGN}/marmotte.css`,
  `${DESIGN}/theme.js`,
  `${DESIGN}/icons.js`,
  `${DESIGN}/fonts/roboto-400.woff2`,
  `${DESIGN}/fonts/roboto-500.woff2`,
  `${DESIGN}/fonts/roboto-700.woff2`,
  `${DESIGN}/fonts/roboto-mono-500.woff2`
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Nur eigene Dateien und das Design-Repo – nicht die anderen Apps
  const isOwn = url.pathname.startsWith(new URL("./", self.location).pathname);
  const isDesign = url.pathname.startsWith("/marmotte-design/");
  if (!isOwn && !isDesign) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
