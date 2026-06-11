/* ============================================================
   FIFA WORLD CUP 2026 — SERVICE WORKER
   Strategy: Cache-first for assets, network-first for data
   v2 — bumped to bust old cached style-2.css reference
   ============================================================ */

const CACHE_NAME  = 'wc2026-v2';
const DATA_CACHE  = 'wc2026-data-v2';

// Static assets to pre-cache on install
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---------- ACTIVATE ---------- */
// Delete any old caches from previous versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for matches.json (live data — always want freshest)
  if (url.pathname.endsWith('matches.json')) {
    event.respondWith(networkFirstWithCache(request, DATA_CACHE));
    return;
  }

  // Cache-first for all other same-origin assets
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithNetwork(request, CACHE_NAME));
    return;
  }

  // Pass through for cross-origin requests
  event.respondWith(fetch(request));
});

/* ---------- STRATEGIES ---------- */

/** Network first, fall back to cache */
async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/** Cache first, fall back to network */
async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}
