// Service worker: trzyma pliki aplikacji w pamięci urządzenia, żeby działała bez internetu.
// Przy każdej nowej wersji aplikacji zmień WERSJA.
const WERSJA = 'or-finanse-0.11.0';
const PLIKI = [
  './', './index.html', './css/app.css',
  './js/app.js', './js/db.js', './js/api.js', './js/sync.js',
  './js/util.js', './js/dane.js', './js/formularz.js', './js/ikony.js', './js/lista.js', './js/planowane.js',
  './js/pozyczki.js', './js/budzety.js', './js/edycja.js', './js/ustawienia.js', './js/podsumowanie.js', './js/sprzedaz.js', './js/dziennik.js', './js/importy.js', './js/rozliczenia.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const CZCIONKI = 'or-finanse-czcionki';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(klucze => Promise.all(klucze.filter(k => k !== WERSJA && k !== CZCIONKI).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(CZCIONKI).then(async c => {
      const z = await c.match(req);
      const siec = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => z);
      return z || siec;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(z => z || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(z => z || fetch(req)));
});
