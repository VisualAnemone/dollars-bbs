'use strict';

const CACHE_NAME = 'dollars-bbs-v1';
const PRECACHE   = ['/', '/style.css', '/app.js', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Skip API and socket.io requests — always go to network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
