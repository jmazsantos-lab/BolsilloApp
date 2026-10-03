// Service worker: la app abre y funciona sin conexión.
// Al publicar una versión nueva, sube el número de VERSION para renovar la caché.
const VERSION = 'bolsillo-v1.4.0';

// Lo imprescindible para abrir y usar la app sin red (incluida la librería de Supabase).
const ESENCIAL = [
  './', './index.html', './app.js', './config.js', './styles.css', './manifest.webmanifest',
  './vendor/supabase.js',
];
// Útil pero no imprescindible: si falta alguno (p. ej. no se subió a GitHub), la app funciona igual.
const OPCIONAL = [
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png',
];

// Cada fichero se guarda por separado: un icono que falte ya no impide el modo sin conexión.
async function guardar(cache, url) {
  try {
    const r = await fetch(new Request(url, { cache: 'reload' }));
    if (r.ok) await cache.put(url, r);
    return r.ok;
  } catch (e) { return false; }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all([...ESENCIAL, ...OPCIONAL].map(u => guardar(c, u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // La base de datos nunca se sirve desde caché
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  // Copia de reserva de la librería desde el CDN (solo si falta vendor/supabase.js): caché primero
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Ficheros propios: se sirven de caché al instante (aunque no haya red o vaya muy lenta)
  // y se actualizan por detrás para la próxima vez que se abra la app.
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const navegacion = e.request.mode === 'navigate';
    const clave = navegacion ? './index.html' : e.request;
    const hit = await c.match(clave, { ignoreSearch: navegacion });
    const red = fetch(e.request)
      .then(r => { if (r.ok) c.put(clave, r.clone()); return r; })
      .catch(() => null);
    if (hit) { e.waitUntil(red); return hit; }
    const r = await red;
    if (r) return r;
    if (navegacion) {
      const inicio = await c.match('./') || await c.match('./index.html');
      if (inicio) return inicio;
    }
    return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
