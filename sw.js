// Bunny Counter — Service Worker v6
//
// Strategy: network-first with offline fallback.
//
// Why not cache-first?
//   Cache-first means users keep seeing the old version until the new service
//   worker eventually activates — which can be many visits later. Network-first
//   always tries to fetch the latest files when online, falls back to the cache
//   only when there's no network. This makes deployments instant.

const CACHE_NAME = 'bunny-counter-v6';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './auth.js',
  './sync.js',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  './privacy-policy.rtf',
  './terms-of-service.rtf',
];

// ─── Install: pre-cache the app shell for offline use ───────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting(); // activate immediately, don't wait for old tabs to close
});

// ─── Activate: clear old caches, then tell all tabs to reload ────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        // Tell every open tab "a new version just activated — please reload."
        // app.js listens for this message and calls location.reload().
        clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
      })
  );
  self.clients.claim();
});

// ─── Fetch: network-first, cache fallback ────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request.clone())
      .then(response => {
        // Update the cache with the fresh response for future offline use
        if (
          response.ok &&
          response.type === 'basic' &&
          new URL(event.request.url).origin === self.location.origin
        ) {
          caches.open(CACHE_NAME).then(cache =>
            cache.put(event.request, response.clone())
          );
        }
        return response;
      })
      .catch(() =>
        // Network failed — serve whatever we have cached
        caches.match(event.request)
      )
  );
});
