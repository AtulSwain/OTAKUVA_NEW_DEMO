/* OTAKUVA service worker (v2, 2026-11-06).
 *
 * - Pages (navigations): always from the network. Offline → /offline.html.
 *   Page HTML is never stored, so nothing personal stays on a shared device.
 * - Built assets (/_next/static/*, hashed and immutable), app icons, brand
 *   art and fonts: cache-first — repeat visits load faster.
 * - API calls and everything else: network only, never cached.
 */
const VERSION = 'v2';
const STATIC_CACHE = `otakuva-static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/app-icons/192.png', '/brand/otakuva-mark.png'];
const MAX_STATIC_ENTRIES = 300;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // One missing icon must not stop the worker from installing.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('otakuva-') && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/app-icons/') ||
    url.pathname.startsWith('/brand/') ||
    /\.(woff2?|ttf|otf)$/.test(url.pathname)
  );
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_STATIC_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') {
          cache.put(req, res.clone()).then(() => trim(cache)).catch(() => {});
        }
        return res;
      })
    );
  }
});
