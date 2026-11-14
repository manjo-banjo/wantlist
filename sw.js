// Service worker: keeps a copy of the app's own files so it opens with no connection.
// Network first, so a new deploy shows up on the next online load; the copy is only used offline.
// List data and images are cached separately by the app (IndexedDB); GitHub API calls are not touched.

const CACHE = 'wantlist-shell-v2';
const SHELL = [
  './', 'index.html', 'app.js', 'styles.css', 'manifest.json', 'users.json',
  'js/api.js', 'js/capture.js', 'js/crypto.js', 'js/duplicates.js', 'js/planner.js', 'js/ui.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const saved = await cache.match(req, { ignoreSearch: true });
      if (saved) return saved;
      throw err;
    }
  })());
});
