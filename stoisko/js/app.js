// Start aplikacji stoiska: nawigacja, pasek synchronizacji, service worker.

import * as sync from './sync.js';
import { gotowe } from './api.js';
import { $, $$, toast, godzina, bezSkoku } from './util.js';
import { wczytaj } from './dane.js';
import { ekran as ekranNowe } from './nowe.js';
import { ekran as ekranListy } from './lista.js';
import { ekran as ekranZamowienia } from './zamowienie.js';
import { ekran as ekranUstawien } from './ustawienia.js';
import { ekran as ekranKlientow } from './klienci.js';
import { ekran as ekranSklepu } from './sklep.js';
import { ekran as ekranPoziomow } from './poziomy.js';
import { ileDoPotwierdzenia } from './lista.js';

const TRASY = {
  nowe: [ekranNowe, 'nowe', 'Nowe zamówienie'],
  lista: [ekranListy, 'lista', 'Zamówienia'],
  edytuj: [ekranNowe, 'lista', 'Edycja zamówienia'],
  zamowienie: [ekranZamowienia, 'lista', 'Zamówienie'],
  klienci: [ekranKlientow, 'klienci', 'Klienci'],
  klient: [ekranKlientow, 'klienci', 'Klient'],
  sklep: [ekranSklepu, 'sklep', 'Sklep'],
  poziomy: [ekranPoziomow, 'sklep', 'Poziomy cen'],
  ustawienia: [ekranUstawien, 'ustawienia', 'Ustawienia'],
};

let aktywny = null;

function trasa() {
  const h = location.hash.slice(1) || (gotowe() ? 'nowe' : 'ustawienia');
  const i = h.indexOf('/');
  const widok = i < 0 ? h : h.slice(0, i);
  const arg = i < 0 ? null : decodeURIComponent(h.slice(i + 1));
  return { widok: TRASY[widok] ? widok : 'nowe', arg };
}

function render() {
  let { widok, arg } = trasa();
  if (!gotowe() && widok !== 'ustawienia') { widok = 'ustawienia'; arg = null; }
  const [ekran, zakladka, tytul] = TRASY[widok];
  aktywny = ekran;
  $$('.nawigacja a').forEach(a => {
    if (a.dataset.widok === zakladka) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const n = ileDoPotwierdzenia();
  const licznik = $('.nawigacja [data-widok="lista"] .licznik');
  licznik.textContent = n || '';
  licznik.hidden = !n;
  ekran.render(arg);
  document.title = `${tytul} · One River Stoisko`;
}

let ostatniaZmiana = 0;

function pokazStan(s) {
  const b = $('#sync');
  let tekst, klasa = '';
  switch (s.tryb) {
    case 'praca': tekst = 'Synchronizuję…'; klasa = 'praca'; break;
    case 'offline': tekst = s.oczekujace ? `Bez internetu · ${s.oczekujace} do wysłania` : 'Bez internetu'; klasa = 'offline'; break;
    case 'blad': tekst = s.oczekujace ? `Nie wysłano: ${s.oczekujace}` : 'Błąd synchronizacji'; klasa = 'blad'; break;
    case 'brak-ustawien': tekst = 'Połącz z arkuszem'; klasa = 'blad'; break;
    case 'start': tekst = 'Uruchamianie…'; break;
    default:
      if (s.oczekujace) { tekst = `${s.oczekujace} do wysłania`; klasa = 'offline'; }
      else tekst = s.ostatnia ? 'Zsynchronizowano ' + godzina(s.ostatnia) : 'Synchronizuj';
  }
  b.textContent = tekst;
  b.className = 'sync ' + klasa;
  b.title = s.blad || 'Dotknij, aby zsynchronizować';
  if (s.zmiana && s.zmiana !== ostatniaZmiana) {
    ostatniaZmiana = s.zmiana;
    wczytaj().then(zmienione => {
      if (!zmienione) return;
      const el = document.activeElement;
      const pisze = el && /INPUT|TEXTAREA|SELECT/.test(el.tagName);
      if (!pisze && !$('#okno').open) bezSkoku(render);
    });
  }
}

async function start() {
  await wczytaj();
  render();
  sync.obserwuj(pokazStan);
  await sync.start();

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  const widok = $('#widok');
  widok.addEventListener('click', e => aktywny?.klik?.(e));
  widok.addEventListener('change', e => aktywny?.zmiana?.(e));
  widok.addEventListener('input', e => aktywny?.wejscie?.(e));
  widok.addEventListener('submit', e => { e.preventDefault(); aktywny?.submit?.(e.target, e); });

  $('#sync').addEventListener('click', () => {
    const s = sync.stanSynchronizacji();
    if (s.tryb === 'brak-ustawien') { location.hash = '#ustawienia'; return; }
    if (s.tryb === 'blad' && s.blad) toast(s.blad, 'blad', 7000);
    sync.synchronizuj();
  });

  window.addEventListener('beforeunload', e => {
    if (sync.stanSynchronizacji().oczekujace && !navigator.onLine) { e.preventDefault(); e.returnValue = ''; }
  });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => {
      reg.addEventListener('updatefound', () => {
        const nowy = reg.installing;
        nowy?.addEventListener('statechange', () => {
          if (nowy.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Jest nowa wersja aplikacji – zamknij ją i otwórz ponownie.', '', 10000);
          }
        });
      });
    }).catch(() => {});
  }
}

start();
