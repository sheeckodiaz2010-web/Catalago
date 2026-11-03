/* DIGAR service worker v9: red primero para navegación, caché de respaldo y purga de versiones anteriores. */
const CACHE = 'digar-v9';
const SDK_CACHE = 'digar-sdk-v1';
const NAV_TIMEOUT = 4000;
const SCOPE = self.registration.scope;
const INDEX = new URL('./index.html', SCOPE).href;
const ADMIN = new URL('./admin.html', SCOPE).href;
const PRECACHE = ['./index.html', './admin.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(
    PRECACHE.map((url) => fetch(url, { cache: 'reload' })
      .then((res) => { if (res.ok) return cache.put(url, res); })
      .catch(() => {}))
  )));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('digar-') && k !== CACHE && k !== SDK_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkNavigate(req) {
  const url = new URL(req.url);
  const isAdmin = url.pathname.endsWith('/admin.html');
  const fallback = isAdmin ? ADMIN : INDEX;
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { signal: AbortSignal.timeout(NAV_TIMEOUT) });
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      cache.put(isAdmin ? ADMIN : INDEX, res.clone()).catch(() => {});
      return res;
    }
  } catch (e) { /* sin red o lenta: usar caché */ }
  const cached = await cache.match(fallback);
  if (cached) return cached;
  try { return await fetch(req); } catch (e) {
    return new Response('Sin conexión. Vuelve a intentarlo cuando tengas internet.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sdk = url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!sdk && (url.origin !== self.location.origin || !url.href.startsWith(SCOPE))) return;
  if (url.searchParams.has('__ping')) return;

  if (!sdk && req.mode === 'navigate') {
    event.respondWith(networkNavigate(req));
    return;
  }
  const cacheName = sdk ? SDK_CACHE : CACHE;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic' || (sdk && res.ok)) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
