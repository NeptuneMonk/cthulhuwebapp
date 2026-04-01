// Minimal service worker: network-first for HTML, cache-first for static assets.
// Forces PWA to always fetch fresh index.html on startup.

const CACHE_NAME = 'cthulhu-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Navigation requests (HTML pages): always network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // API calls: always network, never cache
  if (url.pathname.startsWith('/api/')) {
    return; // Let browser handle normally
  }

  // Static assets (JS/CSS with hashes): cache-first
  if (url.pathname.match(/\.(js|css)$/) && url.pathname.includes('.')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }
});
