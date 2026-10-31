/* DIGAR Catalog – Service Worker v4 (offline shell + SDK en caché) */
const CACHE = 'digar-v4';
const SDK_CACHE = 'digar-sdk-v1';
const NAV_TIMEOUT = 3000;
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map((u) =>
        cache.add(u).catch((e) => console.warn('[SW] No se pudo precachear', u, e))
      ))
    )
  );
  // Sin skipWaiting automático: la página avisa y el usuario decide (no pierde estado).
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SDK_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function navigateHandler(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((res) => {
    if (res && res.ok) cache.put('./index.html', res.clone()).catch(() => {});
    return res;
  });
  const timeout = new Promise((r) => setTimeout(() => r(null), NAV_TIMEOUT));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch (e) { /* red caída: usar caché */ }
  const cached = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html'));
  if (cached) { net.catch(() => {}); return cached; }
  return net;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const net = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return cached || (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pings de conectividad: siempre a la red
  if (url.searchParams.has('__ping')) return;

  // SDK de Firebase (módulos versionados): disponible offline
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(staleWhileRevalidate(req, SDK_CACHE));
    return;
  }

  // Datos/APIs externas: no interceptar (Firestore maneja su propia caché)
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(navigateHandler(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req, CACHE));
});
