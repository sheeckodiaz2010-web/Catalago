/* DIGAR: instalación completa y cachés limitadas a esta aplicación. */
const CACHE = 'digar-v8';
const SDK_CACHE = 'digar-sdk-v1';
const NAV_TIMEOUT = 3000;
const INDEX = new URL('./index.html', self.registration.scope).href;
const ROOT = new URL('./', self.registration.scope).href;
const PRECACHE = [
  './index.html', './admin.html', './manifest.webmanifest', './icon-192.png',
  './icon-512.png', './icon-maskable-192.png',
  './icon-maskable-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  // Precache tolerante: un archivo que falle no tumba toda la instalación.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(
    PRECACHE.map((url) => fetch(url, { cache: 'reload' })
      .then((res) => { if (res.ok) return cache.put(url, res); })
      .catch(() => {}))
  )));
  // La página puede solicitar la actualización cuando el usuario esté listo.
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => /^digar-(?:v\d+|sdk-v\d+)$/.test(key)
      && key !== CACHE && key !== SDK_CACHE)
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

async function fetchAndStore(req, cacheName, navigation = false) {
  const res = await fetch(req);
  if (res.ok && !res.redirected && (!navigation ||
      (res.headers.get('content-type') || '').includes('text/html'))) {
    const cache = await caches.open(cacheName);
    const url = new URL(req.url);
    // Solo la portada sin parámetros puede actualizar el shell offline.
    const key = navigation && !url.search &&
      (url.href === ROOT || url.href === INDEX) ? INDEX : req;
    await cache.put(key, res.clone()).catch(() => {});
  }
  return res;
}

async function navigate(req, net) {
  let timer;
  try {
    const res = await Promise.race([
      net,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), NAV_TIMEOUT); })
    ]);
    if (res && res.ok) return res;
    const cache = await caches.open(CACHE);
    const fallback = new URL(req.url).pathname === new URL('./admin.html', self.registration.scope).pathname
      ? new URL('./admin.html', self.registration.scope).href : INDEX;
    const cached = await cache.match(req) || await cache.match(fallback);
    return cached || res || await net || offline();
  } finally {
    clearTimeout(timer);
  }
}

function offline() {
  return new Response('Sin conexión. Vuelve a intentarlo cuando tengas internet.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.searchParams.has('__ping')) return;
  const sdk = url.origin === 'https://www.gstatic.com' &&
    url.pathname.startsWith('/firebasejs/');
  if (!sdk && (url.origin !== self.location.origin ||
      !url.href.startsWith(self.registration.scope))) return;
  const navigation = !sdk && req.mode === 'navigate';
  const cacheName = sdk ? SDK_CACHE : CACHE;
  const net = fetchAndStore(req, cacheName, navigation).catch(() => null);
  event.waitUntil(net.then(() => {}));
  event.respondWith(navigation ? navigate(req, net) : (async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(req) || await net || Response.error();
  })());
});
