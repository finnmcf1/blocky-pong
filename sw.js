// Blocky Pong service worker: precache the game for offline play.
// Network-first for same-origin GETs so fresh deploys arrive immediately;
// the cache is the fallback when offline. API calls are never cached.

const CACHE = 'blocky-pong-v1';
const ASSETS = [
  '.',
  'index.html',
  'style.css',
  'game.js',
  'manifest.webmanifest',
  'sounds/goal.mp3',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return;   // leaderboard is live-only

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) =>
          hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined)
        )
      )
  );
});
