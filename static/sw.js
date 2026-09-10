/**
 * FD-LMS Service Worker (Auto-purge / Unregister)
 * Ensures browsers drop stale caches and load latest WebGIS code.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Pass through all requests directly to the network
  event.respondWith(fetch(event.request));
});
