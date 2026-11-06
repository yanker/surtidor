// Service worker de Surtidor
//  - App (HTML/JS/CSS/iconos): stale-while-revalidate → abre al instante y offline
//  - /api/estaciones: network-first con copia en caché → últimos precios si no hay red
//  - Teselas del mapa y demás orígenes: se dejan pasar

const VERSION = 'v2';
const CACHE_APP = `surtidor-app-${VERSION}`;
const CACHE_API = `surtidor-api-${VERSION}`;
const PRECACHE = ['/', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => ![CACHE_APP, CACHE_API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            // Una sola entrada: la última consulta sirve de respaldo offline
            caches.open(CACHE_API).then((c) => c.put('/api/ultima', copia));
          }
          return res;
        })
        .catch(() => caches.match('/api/ultima').then((r) => r || Response.error())),
    );
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE_APP).then((c) => c.put('/', copia));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((enCache) => {
      const red = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(CACHE_APP).then((c) => c.put(req, copia));
          }
          return res;
        })
        .catch(() => enCache);
      return enCache || red;
    }),
  );
});
