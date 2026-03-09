// Minimal service worker for PWA installability. Does not cache or intercept fetch.
const CACHE_VERSION = 'v1';
self.addEventListener('install', function (event) {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
