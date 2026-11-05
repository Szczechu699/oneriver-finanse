// Ekran „Zamówienia”: lista z filtrem (dziś / to urządzenie / wszystkie) i wyszukiwaniem.

import { $, $$, esc, kwotaTxt, num, dataLok, dataKrotko, normalizuj, odmiana } from './util.js';
import { dane, klient, telefonCzytelny } from './dane.js';
import { ustawienia } from './api.js';
import { STATUSY } from './konfiguracja.js';
import { etykietaStatusu } from './zamowienie.js';
import * as sync from './sync.js';
import { eksportujEpp } from './eksport-epp.js';
import { toast } from './util.js';

// wybor: null albo Set numerów zamówień zaznaczonych do eksportu EPP
const stan = { filtr: null, szukaj: '', wybor: null };
const FILTRY = [['nowe', 'Do potwierdzenia'], ['dzis', 'Dziś'], ['urzadzenie', 'To urządzenie'], ['nieoplacone', 'Czekają na płatność'], ['subiekt', 'Do Subiekta'], ['wszystkie', 'Wszystkie']];
const doSubiekta = z => z.status !== STATUSY.anulowane && !z.epp_eksport && !z.nr_dok_sgt;
const klasaStatusu = st => ({ [STATUSY.nowe]: 'nowe', [STATUSY.czeka]: 'czeka', [STATUSY.oplacone]: 'oplacone', [STATUSY.anulowane]: 'anulowane' }[st] || '');

function lista() {
  const { kod } = ustawienia();
  const dzis = dataLok();
  const slowa = normalizuj(stan.szukaj).split(/\s+/).filter(Boolean);
  return dane.zamowienia.filter(z => {
    if (stan.filtr === 'dzis' && String(z.data).slice(0, 10) !== dzis) return false;
    if (stan.filtr === 'urzadzenie' && !String(z.id).startsWith(kod + '-')) return false;
    if (stan.filtr === 'nieoplacone' && z.status !== STATUSY.czeka) return false;
    if (stan.filtr === 'nowe' && z.status !== STATUSY.nowe) return false;
    if (stan.filtr === 'subiekt' && !doSubiekta(z)) return false;
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
      const w = stan.wybor;
      const otw = w ? `<label class="lz-wybierz"><input type="checkbox" data-wybierz="${esc(z.id)}"${w.has(String(z.id)) ? ' checked' : ''}${z.status === STATUSY.anulowane ? ' disabled' : ''}>` : `<a href="#zamowienie/${encodeURIComponent(z.id)}">`;
      const sgt = z.nr_dok_sgt ? ` · ${esc(z.nr_dok_sgt)}` : (z.epp_eksport ? ' · EPP ✓' : '');
      return `<li class="${w ? 'wybor' : ''}">${otw}
        <span class="lz-numer">${esc(z.id)}${czekajace.has('ZAMOWIENIA|' + z.id) ? ' <i class="do-wyslania" title="Czeka na wysłanie do arkusza">●</i>' : ''}</span>
        <span class="lz-klient">${esc(k?.nazwa || (k ? telefonCzytelny(k.telefon) : 'bez klienta'))}<small>${esc(dataKrotko(z.data))} · ${esc(z.forma_platnosci || '')}${z.wydarzenie ? ' · ' + esc(z.wydarzenie) : ''}${z.dostawa ? ' · ' + (z.nadano ? `wysyła ${esc(z.realizuje || '')}` : 'do wysłania') : ''}${sgt}</small></span>
        <span class="lz-kwota"><b>${esc(kwotaTxt(num(z.suma_brutto)))}</b><span class="status ${klasaStatusu(z.status)}">${esc(etykietaStatusu(z.status))}</span></span>
      ${w ? '</label>' : '</a>'}</li>`;
    }).join('')}</ul>`;
}

function htmlPaskaEpp() {
  if (!stan.wybor) return '';
  const n = stan.wybor.size;
  return `<div class="panel pasek-epp">
      <p>Zaznacz zamówienia do pliku EPP. Plik wczytasz w Subiekcie: <b>Operacje → Odbierz z… → Plik EDI++</b>.</p>
      <div class="przyciski">
        <button type="button" class="drugorzedny" data-akcja="epp-wszystkie">Zaznacz widoczne</button>
        <button type="button" class="drugorzedny" data-akcja="epp-zadne">Odznacz</button>
        <button type="button" data-akcja="epp-pobierz"${n ? '' : ' disabled'}>Pobierz plik EPP (${n})</button>
      </div></div>`;
}

const odswiezListe = () => { $('#lista-zam').innerHTML = htmlListy(); $('#pasek-epp').innerHTML = htmlPaskaEpp(); };

export const ileDoPotwierdzenia = () => dane.zamowienia.filter(z => z.status === STATUSY.nowe).length;

function render() {
  const nowe = ileDoPotwierdzenia();
  if (!stan.filtr) stan.filtr = nowe ? 'nowe' : 'dzis';
  $('#widok').innerHTML = `
  <section class="ekran">
    <header class="naglowek-zam"><h1>Zamówienia</h1><span class="naglowek-akcje">
      <button type="button" class="drugorzedny maly" data-akcja="epp-tryb">${stan.wybor ? 'Zakończ wybieranie' : 'Eksport do Subiektu'}</button>
      <a class="przycisk" href="#nowe">+ Nowe</a></span></header>
    <div id="pasek-epp">${htmlPaskaEpp()}</div>
    <div class="chipy male filtry">${FILTRY.filter(([w]) => w !== 'nowe' || nowe).map(([w, e]) => `<button type="button" class="chip" data-filtr="${w}" aria-pressed="${stan.filtr === w}">${esc(e)}${w === 'nowe' && nowe ? ` (${nowe})` : ''}</button>`).join('')}</div>
    <label class="pole szukaj"><span class="sr">Szukaj</span>
      <input type="search" id="szukaj-zam" value="${esc(stan.szukaj)}" placeholder="Numer, klient, telefon, paragon" autocomplete="off"></label>
    <div id="lista-zam">${htmlListy()}</div>
  </section>`;
}

async function klik(e) {
  const cb = e.target.closest('[data-wybierz]');
  if (cb) { const id = cb.dataset.wybierz; if (cb.checked) stan.wybor.add(id); else stan.wybor.delete(id); $('#pasek-epp').innerHTML = htmlPaskaEpp(); return; }
  const a = e.target.closest('[data-akcja]');
  if (a) {
    const akcja = a.dataset.akcja;
    if (akcja === 'epp-tryb') {
      if (stan.wybor) stan.wybor = null;
      else {
        stan.filtr = 'subiekt';
        stan.wybor = new Set(lista().filter(doSubiekta).map(z => String(z.id)));
      }
      render(); return;
    }
    if (akcja === 'epp-wszystkie') { lista().filter(z => z.status !== STATUSY.anulowane).forEach(z => stan.wybor.add(String(z.id))); odswiezListe(); return; }
    if (akcja === 'epp-zadne') { stan.wybor.clear(); odswiezListe(); return; }
    if (akcja === 'epp-pobierz') {
      a.disabled = true;
      try {
        const w = await eksportujEpp([...stan.wybor]);
        if (w.wyeksportowane.length) toast(`Pobrano plik EPP: ${w.wyeksportowane.length} ${odmiana(w.wyeksportowane.length, 'zamówienie', 'zamówienia', 'zamówień')}.`, 'ok', 5000);
        if (w.bledy.length) toast('Pominięto: ' + w.bledy.join(' '), 'blad', 9000);
        if (w.wyeksportowane.length) stan.wybor = null;
      } catch (err) { toast('Nie udało się utworzyć pliku: ' + err.message, 'blad'); }
      render(); return;
    }
    return;
  }
  const b = e.target.closest('[data-filtr]');
  if (!b) return;
  stan.filtr = b.dataset.filtr;
  $$('.filtry .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.filtr === stan.filtr)));
  odswiezListe();
}

function wejscie(e) {
  if (e.target.id !== 'szukaj-zam') return;
  stan.szukaj = e.target.value;
  $('#lista-zam').innerHTML = htmlListy();
}

export const ekran = { render, klik, wejscie };
