// Service Worker für Marmotte Trinkgeld
// Sorgt dafür, dass die App auf dem Smartphone als "installierbar" erkannt wird
// und die Grundseiten auch bei kurzzeitig fehlender Verbindung geladen werden können.

// Achtung: Cache Storage ist pro Origin, nicht pro App. Alle Marmotte-Apps liegen
// auf derselben Adresse, deshalb hat jede App ein eigenes Präfix und räumt nur
// ihre eigenen Caches auf.
const CACHE_PREFIX = "marmotte-trinkgeld-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const DESIGN_ORIGIN = "https://bakerymarmotte-cmyk.github.io";
const DESIGN = "https://bakerymarmotte-cmyk.github.io/marmotte-design";
const SHELL_FILES = [
  "./index.html",
  "./app.html",
  "./change-password.html",
  "./style.css",
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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Nur die Grund-Shell-Dateien (HTML/CSS/Manifest, Design-Dateien) werden zwischengespeichert.
// JavaScript-Module (.js) werden absichtlich NICHT gecacht, damit Updates am Code
// immer sofort ankommen und nicht durch eine alte, gecachte Version blockiert werden.

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isOwnOrigin = url.origin === self.location.origin;
  const isDesignOrigin = url.origin === DESIGN_ORIGIN;
  if (!isOwnOrigin && !isDesignOrigin) return;
  // App-eigenes JS immer frisch vom Netzwerk laden (nicht cachen).
  // Ausnahme: die Design-Skripte (theme.js, icons.js) – die werden wie CSS behandelt:
  // zuerst Netzwerk, bei fehlender Verbindung aus dem Cache.
  const isDesignFile = url.pathname.startsWith("/marmotte-design/");
  if (isOwnOrigin && url.pathname.endsWith(".js") && !isDesignFile) return;

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
