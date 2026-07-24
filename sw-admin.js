/* WW CRM admin PWA — shell cache only. NEVER cache CRM data or API responses. */
const CACHE = 'ww-admin-shell-v1';
const SHELL = [
  '/admin.webmanifest',
  '/assets/pwa/icon-180.png',
  '/assets/pwa/icon-192.png',
  '/assets/pwa/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Network-only for the dashboard page itself and all API/function calls —
  // CRM data must always be live and must never sit in a browser cache.
  if (url.pathname === '/admin.html' || url.pathname.includes('/functions/') || e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }
  // Static shell assets: cache-first.
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
    return;
  }
  // Everything else (fonts etc.): network, no caching.
  e.respondWith(fetch(e.request));
});
