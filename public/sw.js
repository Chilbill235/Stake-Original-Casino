/* eslint-disable no-restricted-globals */

const CACHE_NAME = 'stake-originals-v5';

// Assets cached to satisfy iOS PWA installation requirements
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install: Skip waiting immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: Delete all old caches & claim client control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// Fetch: Pure Network requests. Returns an error if offline (no offline site)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || !url.protocol.startsWith('http')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      // Prevents serving old offline pages
      return Response.error();
    })
  );
});

/* ==========================================================================
   PUSH NOTIFICATIONS (iOS Safari & Standalone PWA Support)
   ========================================================================== */

// Handle incoming push messages from Apple Push Notification service (APNs)
self.addEventListener('push', (event) => {
  let data = { title: 'Stake Originals', body: 'You have a new notification!' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/badge.png',
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification tap actions
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new tab/window if not open
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});