/**
 * UPI Spendr - Progressive Web App Service Worker
 * Enables offline caching, background sync & home screen installation
 */

const CACHE_NAME = 'upi-spendr-v2.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/css/components.css',
  '/css/charts.css',
  '/js/app.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/store.js',
  '/js/smsParser.js',
  '/js/audioChime.js',
  '/js/charts.js',
  '/js/billSplitter.js',
  '/js/recurring.js',
  '/js/insights.js',
  '/js/exportUtils.js',
  '/js/qrEngine.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Offline - showing cached data' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});
