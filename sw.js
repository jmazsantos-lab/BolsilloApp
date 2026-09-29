// Service worker: la app abre y funciona sin conexión.
// Al publicar una versión nueva, sube el número de VERSION para renovar la caché.
const VERSION = 'bolsillo-v1.2.0';
const NUCLEO = [
  './', './index.html', './app.js', './config.js', './styles.css', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(NUCLEO)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // La base de datos nunca se sirve desde caché
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;

  // Librería de Supabase (CDN): caché primero, porque la versión no cambia
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }

  // Ficheros propios: se sirven de caché al instante y se actualizan por detrás
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const clave = e.request.mode === 'navigate' ? './index.html' : e.request;
      const hit = await c.match(clave, { ignoreSearch: e.request.mode === 'navigate' });
      const red = fetch(e.request).then(r => { if (r.ok) c.put(clave, r.clone()); return r; }).catch(() => null);
      return hit || (await red) || new Response('Sin conexión', { status: 503 });
    }));
  }
});
