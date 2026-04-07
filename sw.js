// Bunny Counter — Service Worker
// Strategy: cache-first for the app shell, so it works fully offline after first load.

const CACHE_NAME = 'bunny-counter-v3';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
];

// ─── Install: pre-cache the app shell ───────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  // Take over immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ─── Activate: remove any old cache versions ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch: serve from cache, fall back to network ──────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests for our own origin
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      // Not in cache — try network, then optionally cache the response
      return fetch(event.request).then(response => {
        // Only cache valid same-origin responses
        if (
          response.ok &&
          response.type === 'basic' &&
          new URL(event.request.url).origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
