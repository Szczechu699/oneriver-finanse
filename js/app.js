// Start aplikacji, nawigacja (menu boczne na komputerze, dolne menu na telefonie) i pasek synchronizacji.

import * as sync from './sync.js';
import { skonfigurowane } from './api.js';
import { $, $$, esc, toast, godzina, bezSkoku } from './util.js';
import { dane, wczytajDane, poTerminie } from './dane.js';
import { ikonaSvg } from './ikony.js';
import * as formularz from './formularz.js';
import { ekran as ekranListy } from './lista.js';
import { ekranPlanowane, ekranSubskrypcje } from './planowane.js';
import { ekran as ekranPozyczek } from './pozyczki.js';
import { ekranBudzety, ekranBudzet } from './budzety.js';
import { ekranDane, ekranKonta, ekranKonto, ekranKategorie, ekranKategoria, ekranTytuly } from './edycja.js';
import { ekran as ekranUstawien } from './ustawienia.js';
import { ekran as ekranPodsumowania } from './podsumowanie.js';
import { ekran as ekranSprzedazy } from './sprzedaz.js';

// Pozycje menu: [trasa, etykieta, ikona, na telefonie w dolnym pasku?]
const MENU = [
  ['podsumowanie', 'Podsumowanie', 'podsumowanie', true],
  ['dodaj', 'Dodaj', 'dodaj', true],
  ['lista', 'Transakcje', 'lista', true],
  ['planowane', 'Planowane', 'planowane', true],
  ['sprzedaz', 'Sprzedaż', 'sprzedaz', false],
  ['subskrypcje', 'Subskrypcje', 'subskrypcje', false],
  ['pozyczki', 'Pożyczki', 'pozyczki', false],
  ['budzety', 'Budżety i cele', 'budzety', false],
  ['dane', 'Edytuj dane', 'dane', false],
  ['ustawienia', 'Ustawienia', 'ustawienia', false],
];

// Trasa → [ekran, zakładka menu]
const TRASY = {
  dodaj: [formularz.ekran, 'dodaj'], edytuj: [formularz.ekran, 'lista'], plan: [formularz.ekran, 'planowane'],
  lista: [ekranListy, 'lista'], podsumowanie: [ekranPodsumowania, 'podsumowanie'], sprzedaz: [ekranSprzedazy, 'sprzedaz'],
  planowane: [ekranPlanowane, 'planowane'], subskrypcje: [ekranSubskrypcje, 'subskrypcje'],
  pozyczki: [ekranPozyczek, 'pozyczki'], pozyczka: [ekranPozyczek, 'pozyczki'],
  budzety: [ekranBudzety, 'budzety'], budzet: [ekranBudzet, 'budzety'],
  dane: [ekranDane, 'dane'], konta: [ekranKonta, 'dane'], konto: [ekranKonto, 'dane'],
  kategorie: [ekranKategorie, 'dane'], kategoria: [ekranKategoria, 'dane'], tytuly: [ekranTytuly, 'dane'],
  ustawienia: [ekranUstawien, 'ustawienia'],
};

let aktywny = null;

function trasa() {
  const h = location.hash.slice(1) || (skonfigurowane() ? 'dodaj' : 'ustawienia');
  const [widok, arg] = h.split('/');
  return { widok: TRASY[widok] ? widok : 'dodaj', arg: arg ? decodeURIComponent(arg) : null };
}

function render() {
  let { widok, arg } = trasa();

  // transakcje i raty pożyczek otwierają ekran pożyczki
  if (widok === 'edytuj') {
    const t = dane.transakcje.find(x => x.id === arg);
    if (t?.pozyczka_id) { location.replace('#pozyczka/' + encodeURIComponent(t.pozyczka_id)); return; }
  }
  if (widok === 'plan') {
    const p = dane.planowane.find(x => x.id === arg);
    if (p?.pozyczka_id) { location.replace('#pozyczka/' + encodeURIComponent(p.pozyczka_id)); return; }
  }

  const [ekran, zakladka] = TRASY[widok];
  aktywny = ekran;
  $$('.menu a').forEach(a => {
    if (a.dataset.widok === zakladka) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const wiecej = $('.menu .przycisk-wiecej');
  const wDolnym = MENU.find(m => m[0] === zakladka)?.[3];
  wiecej.toggleAttribute('data-aktywny', !wDolnym);

  const opoznione = poTerminie().length;
  $$('.menu .licznik').forEach(z => { z.textContent = opoznione || ''; z.hidden = !opoznione; });

  if (ekran === formularz.ekran) {
    if (widok === 'dodaj' && arg?.startsWith('odloz-')) ekran.render(['nowe-odlozenie', arg.slice(6)]);
    else {
      const tryb = widok === 'dodaj'
        ? ({ plan: 'nowy-plan', sub: 'nowa-sub', pozyczka: 'nowa-pozyczka' }[arg] || null)
        : widok;
      ekran.render([tryb, widok === 'dodaj' ? null : arg]);
    }
  } else {
    ekran.render(arg);
  }
  document.title = `${MENU.find(m => m[0] === zakladka)?.[1] || 'Finanse'} · One River Finanse`;
}

function zbudujMenu() {
  $('.menu').innerHTML = MENU.map(([w, e, ik, dol]) => `
    <a href="#${w}" data-widok="${w}" class="${dol ? 'w-dolnym' : ''}">${ikonaSvg(ik)}<span>${esc(e)}</span>${w === 'planowane' ? '<span class="licznik" hidden></span>' : ''}</a>`).join('')
    + `<button type="button" class="przycisk-wiecej">${ikonaSvg('wiecej')}<span>Więcej</span></button>`;
}

function pokazWiecej() {
  const d = $('#okno');
  d.innerHTML = `<form method="dialog" class="okno menu-wiecej">
    <h2>Więcej</h2>
    <nav aria-label="Pozostałe sekcje">${MENU.filter(m => !m[3]).map(([w, e, ik]) =>
      `<a href="#${w}">${ikonaSvg(ik)}<span>${esc(e)}</span></a>`).join('')}</nav>
    <div class="okno-przyciski"><button value="0" class="drugorzedny">Zamknij</button></div>
  </form>`;
  d.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => d.close()));
  d.showModal();
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
      const el = document.activeElement;
      const pisze = el && /INPUT|TEXTAREA|SELECT/.test(el.tagName);
      if (!pisze && !$('#okno').open) {
        if (aktywny === formularz.ekran) formularz.zachowajPola();
        bezSkoku(render);
      }
    });
  }
}

async function start() {
  zbudujMenu();
  await wczytajDane();
  render();
  sync.obserwuj(pokazStan);
  await sync.start();

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  const widok = $('#widok');
  widok.addEventListener('click', e => aktywny?.klik?.(e));
  widok.addEventListener('change', e => aktywny?.zmiana?.(e));
  widok.addEventListener('input', e => aktywny?.wejscie?.(e));
  widok.addEventListener('submit', e => { e.preventDefault(); aktywny?.submit?.(e.target); });
  $('.menu .przycisk-wiecej').addEventListener('click', pokazWiecej);

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
