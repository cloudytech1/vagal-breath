/* Vagal Breath service worker: keeps the app and voice clips available offline. */
const VERSION = 7; // keep in step with APP_VERSION in index.html
const CACHE = `vagal-breath-v${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'voice/voices.json',
  'icons/favicon-32.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'fonts/figtree-latin.woff2', 'fonts/spectral-300-italic-latin.woff2', 'fonts/spectral-300-latin.woff2',
];

const LINES = ['intro', 'in1', 'in2', 'in3', 'top', 'hold', 'out1', 'out2', 'out3', 'rest', 'coach', 'half', 'done', 'sample'];

// Store every voice clip up front so the app is fully usable offline after one visit.
async function storeVoices(cache) {
  try {
    const cfg = await (await fetch('voice/voices.json', { cache: 'no-cache' })).json();
    const urls = cfg.voices.flatMap((v) => LINES.map((l) => `voice/${v.id}/${l}.${cfg.ext || 'mp3'}`));
    await Promise.allSettled(urls.map((u) => cache.add(u)));
  } catch (e) { /* clips are still cached later, as they are played */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).then(() => storeVoices(c))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vagal-breath-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!own && !font) return;
  const keep = (res) => {
    if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  };
  // The page and the voice list: fresh when online, cached when not.
  if (req.mode === 'navigate' || url.pathname.endsWith('voices.json')) {
    e.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
    return;
  }
  // Everything else (clips, icons, fonts): cached copy first.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)));
});
