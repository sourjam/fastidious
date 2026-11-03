const CACHE = 'fastidious-v1';
const SHELL = ['./Fastidious.dc.html', './support.js', './styles.css', './manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const key = url.origin === location.origin ? url.pathname : e.request;
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(url.origin === location.origin ? new Request(url.pathname) : e.request, copy)); return r; })
      .catch(() => caches.match(key, { ignoreSearch: true }))
  );
});
