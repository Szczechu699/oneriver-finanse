// Start aplikacji, nawigacja i pasek synchronizacji.

import * as sync from './sync.js';
import { skonfigurowane } from './api.js';
import { $, toast, godzina, bezSkoku } from './util.js';
import { wczytajDane, poTerminie } from './dane.js';
import * as formularz from './formularz.js';
import * as w from './widoki.js';

function trasa() {
  const h = location.hash.slice(1) || (skonfigurowane() ? 'dodaj' : 'ustawienia');
  const [widok, arg] = h.split('/');
  return { widok, arg: arg ? decodeURIComponent(arg) : null };
}

const ZAKLADKI = { edytuj: 'lista', plan: 'planowane', budzet: 'budzety' };

function render() {
  const { widok, arg } = trasa();
  const zakladka = ZAKLADKI[widok] || widok;
  document.querySelectorAll('.zakladki a').forEach(a => {
    if (a.dataset.widok === zakladka) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const opoznione = poTerminie().length;
  const znacznik = $('.zakladki a[data-widok="planowane"] .licznik');
  znacznik.textContent = opoznione || '';
  znacznik.hidden = !opoznione;

  if (widok === 'lista') w.renderLista();
  else if (widok === 'planowane') w.renderPlanowane();
  else if (widok === 'budzety') w.renderBudzety();
  else if (widok === 'budzet') w.renderFormularzBudzetu(arg || 'nowy');
  else if (widok === 'ustawienia') w.renderUstawienia();
  else if (widok === 'edytuj') formularz.renderDodaj('edytuj', arg);
  else if (widok === 'plan') formularz.renderDodaj('plan', arg);
  else formularz.renderDodaj(arg === 'plan' ? 'nowy-plan' : null);
}

let ostatniaZmiana = 0;

function pokazStan(s) {
  const b = $('#sync');
  let tekst, klasa = '';
  switch (s.tryb) {
    case 'praca': tekst = 'Synchronizuję…'; klasa = 'praca'; break;
    case 'offline': tekst = s.oczekujace ? `Bez internetu, ${s.oczekujace} do wysłania` : 'Bez internetu'; klasa = 'offline'; break;
    case 'blad': tekst = s.oczekujace ? `Nie wysłano: ${s.oczekujace}` : 'Synchronizacja nie powiodła się'; klasa = 'blad'; break;
    case 'brak-ustawien': tekst = 'Połącz z arkuszem'; klasa = 'blad'; break;
    case 'start': tekst = 'Uruchamianie…'; break;
    default:
      if (s.oczekujace) { tekst = `${s.oczekujace} do wysłania`; klasa = 'offline'; }
      else tekst = s.ostatnia ? 'Zsynchronizowano ' + godzina(s.ostatnia) : 'Synchronizuj';
  }
  b.textContent = tekst;
  b.className = 'sync ' + klasa;
  b.title = s.blad || 'Kliknij, aby zsynchronizować';
  if (s.zmiana && s.zmiana !== ostatniaZmiana) {
    ostatniaZmiana = s.zmiana;
    wczytajDane().then(() => {
      const aktywny = document.activeElement;
      const pisze = aktywny && /INPUT|TEXTAREA|SELECT/.test(aktywny.tagName);
      if (!pisze && !$('#okno').open) bezSkoku(render);
    });
  }
}

async function start() {
  await wczytajDane();
  render();
  sync.obserwuj(pokazStan);
  await sync.start();

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  const widok = $('#widok');
  widok.addEventListener('click', e => {
    formularz.obsluzKlik(e);
    w.klikLista(e);
    w.klikPlanowane(e);
    w.klikBudzety(e);
    w.klikUstawienia(e);
  });
  widok.addEventListener('change', e => { formularz.obsluzZmiane(e); w.filtrListy(e); });
  widok.addEventListener('input', e => {
    if (e.target.name === 'szukaj') w.filtrListy(e);
    formularz.obsluzWejscie(e);
  });
  widok.addEventListener('submit', e => {
    e.preventDefault();
    const forma = e.target.dataset.forma;
    if (forma === 'polaczenie') w.zapiszPolaczenie(e.target);
    else if (forma === 'budzet') w.zapiszBudzet();
    else if (e.target.classList.contains('kolumna-szczegolow')) formularz.zapiszFormularz();
  });

  $('#sync').addEventListener('click', () => {
    const s = sync.stanSynchronizacji();
    if (s.tryb === 'brak-ustawien') { location.hash = '#ustawienia'; return; }
    if (s.tryb === 'blad' && s.blad) toast(s.blad, 'blad', 7000);
    sync.synchronizuj();
  });

  document.addEventListener('keydown', e => {
    if (!formularz.pisze() || $('#okno').open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    const mapa = { Backspace: '⌫', Escape: 'C', Delete: 'C', '.': ',', ',': ',', '+': '+' };
    if (/^\d$/.test(e.key)) { formularz.klawisz(e.key); e.preventDefault(); }
    else if (mapa[e.key]) { formularz.klawisz(mapa[e.key]); e.preventDefault(); }
    else if (e.key === 'Enter') { formularz.zapiszFormularz(); e.preventDefault(); }
  });

  window.addEventListener('beforeunload', e => {
    if (sync.stanSynchronizacji().oczekujace && !navigator.onLine) { e.preventDefault(); e.returnValue = ''; }
  });

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nowy = reg.installing;
        nowy?.addEventListener('statechange', () => {
          if (nowy.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Jest nowa wersja aplikacji.', '', 15000, { etykieta: 'Odśwież', fn: () => location.reload() });
          }
        });
      });
    }).catch(() => {});
  }
}

start();
