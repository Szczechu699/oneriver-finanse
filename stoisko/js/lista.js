// Ekran „Zamówienia”: lista z filtrem (dziś / to urządzenie / wszystkie) i wyszukiwaniem.

import { $, $$, esc, kwotaTxt, num, dataLok, dataKrotko, normalizuj, odmiana } from './util.js';
import { dane, klient, telefonCzytelny } from './dane.js';
import { ustawienia } from './api.js';
import { STATUSY } from './konfiguracja.js';
import * as sync from './sync.js';

const stan = { filtr: 'dzis', szukaj: '' };
const FILTRY = [['dzis', 'Dziś'], ['urzadzenie', 'To urządzenie'], ['nieoplacone', 'Czekają na płatność'], ['wszystkie', 'Wszystkie']];
const klasaStatusu = st => ({ [STATUSY.czeka]: 'czeka', [STATUSY.oplacone]: 'oplacone', [STATUSY.anulowane]: 'anulowane' }[st] || '');

function lista() {
  const { kod } = ustawienia();
  const dzis = dataLok();
  const slowa = normalizuj(stan.szukaj).split(/\s+/).filter(Boolean);
  return dane.zamowienia.filter(z => {
    if (stan.filtr === 'dzis' && String(z.data).slice(0, 10) !== dzis) return false;
    if (stan.filtr === 'urzadzenie' && !String(z.id).startsWith(kod + '-')) return false;
    if (stan.filtr === 'nieoplacone' && z.status !== STATUSY.czeka) return false;
    if (!slowa.length) return true;
    const k = klient(z.klient_id);
    const tekst = normalizuj([z.id, z.nr_dok_sgt, z.wydarzenie, k?.nazwa, k?.telefon, k?.email].join(' '));
    return slowa.every(s => tekst.includes(s));
  });
}

function htmlListy() {
  const l = lista();
  const czekajace = sync.stanSynchronizacji().oczekujaceKlucze || new Set();
  const aktywne = l.filter(z => z.status !== STATUSY.anulowane);
  const suma = aktywne.reduce((a, z) => a + num(z.suma_brutto), 0);
  const nieopl = aktywne.filter(z => z.status === STATUSY.czeka).reduce((a, z) => a + num(z.suma_brutto), 0);
  if (!l.length) return '<p class="pusto">Brak zamówień dla tego filtra.</p>';
  return `<div class="wskazniki">
      <div><span>${aktywne.length} ${odmiana(aktywne.length, 'zamówienie', 'zamówienia', 'zamówień')}</span><b>${esc(kwotaTxt(suma))}</b></div>
      <div><span>czeka na płatność</span><b>${esc(kwotaTxt(nieopl))}</b></div>
    </div>
    <ul class="lista-zam">${l.slice(0, 300).map(z => {
      const k = klient(z.klient_id);
      return `<li><a href="#zamowienie/${encodeURIComponent(z.id)}">
        <span class="lz-numer">${esc(z.id)}${czekajace.has('ZAMOWIENIA|' + z.id) ? ' <i class="do-wyslania" title="Czeka na wysłanie do arkusza">●</i>' : ''}</span>
        <span class="lz-klient">${esc(k?.nazwa || (k ? telefonCzytelny(k.telefon) : 'bez klienta'))}<small>${esc(dataKrotko(z.data))} · ${esc(z.forma_platnosci || '')}${z.wydarzenie ? ' · ' + esc(z.wydarzenie) : ''}</small></span>
        <span class="lz-kwota"><b>${esc(kwotaTxt(num(z.suma_brutto)))}</b><span class="status ${klasaStatusu(z.status)}">${esc(z.status || '')}</span></span>
      </a></li>`;
    }).join('')}</ul>`;
}

function render() {
  $('#widok').innerHTML = `
  <section class="ekran">
    <header class="naglowek-zam"><h1>Zamówienia</h1><a class="przycisk" href="#nowe">+ Nowe</a></header>
    <div class="chipy male filtry">${FILTRY.map(([w, e]) => `<button type="button" class="chip" data-filtr="${w}" aria-pressed="${stan.filtr === w}">${esc(e)}</button>`).join('')}</div>
    <label class="pole szukaj"><span class="sr">Szukaj</span>
      <input type="search" id="szukaj-zam" value="${esc(stan.szukaj)}" placeholder="Numer, klient, telefon, paragon" autocomplete="off"></label>
    <div id="lista-zam">${htmlListy()}</div>
  </section>`;
}

function klik(e) {
  const b = e.target.closest('[data-filtr]');
  if (!b) return;
  stan.filtr = b.dataset.filtr;
  $$('.filtry .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.filtr === stan.filtr)));
  $('#lista-zam').innerHTML = htmlListy();
}

function wejscie(e) {
  if (e.target.id !== 'szukaj-zam') return;
  stan.szukaj = e.target.value;
  $('#lista-zam').innerHTML = htmlListy();
}

export const ekran = { render, klik, wejscie };
