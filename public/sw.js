/* eslint-disable no-restricted-globals */
const CACHE = 'stake-originals-v2';
const PRECACHE = [
  '/',
  '/index.html',
  '/client.js',
  '/styles.css',
  '/manifest.json',
  '/games/loader.js',
  '/games/slots.js',
  '/games/dice.js',
  '/games/crash.js',
  '/games/plinko.js',
  '/games/mines.js',
  '/games/tower.js',
  '/games/limbo.js',
  '/games/keno.js',
  '/games/wheel.js',
  '/games/baccarat.js',
  '/games/blackjack.js',
  '/games/hilo.js',
  '/legal/terms.html',
  '/legal/privacy.html',
  '/legal/sweepstakes-rules.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => {
            if (event.request.protocol === 'http:' || event.request.protocol === 'https:') {
              cache.put(event.request, clone);
            }
          });
        }
        return response;
      }).catch(() => {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});