// Service worker stoiska: trzyma pliki aplikacji w pamięci urządzenia, żeby działała bez internetu.
// Przy każdej nowej wersji zmień WERSJA (i WERSJA w js/konfiguracja.js).
const WERSJA = 'or-stoisko-0.4.3';
const OCR = 'or-stoisko-ocr';   // pliki rozpoznawania tekstu – pobierane przy pierwszym użyciu, potem z pamięci
const PLIKI = [
  './', './index.html', './css/stoisko.css', './manifest.webmanifest',
  './js/app.js', './js/api.js', './js/db.js', './js/sync.js', './js/util.js', './js/dane.js', './js/konfiguracja.js',
  './js/nowe.js', './js/lista.js', './js/zamowienie.js', './js/ustawienia.js', './js/wiadomosc.js', './js/klienci.js', './js/sklep.js', './js/poziomy.js', './js/inpost.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/icon-maskable-512.png',
];
const CZCIONKI = 'or-stoisko-czcionki';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(klucze => Promise.all(klucze.filter(k => k.startsWith('or-stoisko') && k !== WERSJA && k !== CZCIONKI && k !== OCR).map(k => caches.delete(k))))
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
  if (url.pathname.includes('/vendor/ocr/')) {
    e.respondWith(caches.open(OCR).then(async c => {
      const z = await c.match(req, { ignoreSearch: true });
      if (z) return z;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    }));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(WERSJA).then(c => c.match('./index.html')).then(z => z || fetch(req)));
    return;
  }
  e.respondWith(caches.open(WERSJA).then(c => c.match(req, { ignoreSearch: true })).then(z => z || fetch(req)));
});
