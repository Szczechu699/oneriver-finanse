// Ekrany: Transakcje, Planowane, Budżety (lista i formularz), Ustawienia.

import * as db from './db.js';
import * as sync from './sync.js';
import { ustawienia, zapiszUstawienia, skonfigurowane, wywolaj } from './api.js';
import {
  $, esc, zaokr, fmt2, kwotaTxt, dataLok, dodajDni, dataSlownie, dataKrotko, nazwaMiesiaca, uuid,
  liczba, liczbaNaTekst, odmiana, toast, okno, bezSkoku,
} from './util.js';
import {
  dane, wczytajDane, konta, glowne, podmioty, ikona, kolorKategorii, KOLORY, czyPrzeks, kwotaPLN, czekaNaWysylke,
  grupy, zalaczniki, opisRytmu, aktywnePlanowane, nastepnyTermin, miesiecznyKoszt, aktywneBudzety, okresBudzetu,
  kategorieBudzetu, stanBudzetu,
} from './dane.js';

export const WERSJA = '0.2.0';

// ───────────────────────── Transakcje ─────────────────────────

export const filtry = { miesiac: dataLok().slice(0, 7), konto: '', budzet: '', szukaj: '', anulowane: false };

function pasujeDoBudzetu(t, b) {
  if (b.rodzaj === 'projekt') return t.budzet === b.id;
  const [od, do_] = okresBudzetu(b, t.data_operacji);
  return t.typ === 'wydatek' && kategorieBudzetu(b).includes(t.kategoria) && t.data_operacji >= od && t.data_operacji <= do_
    && (!b.podmiot || t.podmiot === b.podmiot);
}

export function renderLista() {
  const budzet = filtry.budzet ? dane.budzety.find(b => b.id === filtry.budzet) : null;
  const wMiesiacu = dane.transakcje.filter(t => String(t.data_operacji || '').startsWith(filtry.miesiac));
  const szukaj = filtry.szukaj.trim().toLowerCase();
  const pasuje = g => g.czesci.some(t =>
    (filtry.anulowane || t.status !== 'anulowana')
    && (!filtry.konto || t.konto === filtry.konto)
    && (!budzet || pasujeDoBudzetu(t, budzet))
    && (!szukaj || [t.kontrahent, t.kategoria, t.podkategoria, t.zrodlo_przychodu, t.opis, t.tagi, t.nr_dokumentu, t.konto, String(t.kwota)]
      .some(x => String(x || '').toLowerCase().includes(szukaj))));
  const widoczne = grupy(wMiesiacu).filter(pasuje);

  let wplywy = 0, wydatki = 0, bezKursu = 0;
  const czekaWyciag = new Set();
  wMiesiacu.forEach(t => {
    if (t.status === 'anulowana' || czyPrzeks(t)) return;
    if (budzet && !pasujeDoBudzetu(t, budzet)) return;
    if (t.status === 'oczekuje na wyciąg') czekaWyciag.add(t.podzial_id || t.id);
    const k = kwotaPLN(t);
    if (k === null) { bezKursu++; return; }
    if (t.typ === 'wpływ') wplywy += k; else if (t.typ === 'wydatek') wydatki += k;
  });

  const dni = new Map();
  widoczne
    .sort((a, b) => String(b.glowna.data_operacji).localeCompare(String(a.glowna.data_operacji))
      || String(b.glowna.utworzono || '').localeCompare(String(a.glowna.utworzono || '')))
    .forEach(g => {
      const d = g.glowna.data_operacji;
      if (!dni.has(d)) dni.set(d, []);
      dni.get(d).push(g);
    });

  const wynik = wplywy - wydatki;
  const n = czekaWyciag.size;
  $('#widok').innerHTML = `
  <section class="lista">
    <div class="naglowek-listy">
      <div class="miesiac">
        <button type="button" data-akcja="miesiac" data-v="-1" aria-label="Poprzedni miesiąc">‹</button>
        <h1>${esc(nazwaMiesiaca(filtry.miesiac))}</h1>
        <button type="button" data-akcja="miesiac" data-v="1" aria-label="Następny miesiąc">›</button>
      </div>
      ${budzet ? `<p class="filtr-budzetu">Tylko budżet „${esc(budzet.nazwa)}”. <button type="button" class="link" data-akcja="bez-budzetu">Pokaż wszystkie</button></p>` : ''}
      <dl class="podsumowanie">
        <div class="plus"><dt>Wpływy</dt><dd>${esc(kwotaTxt(wplywy))}</dd></div>
        <div class="minus"><dt>Wydatki</dt><dd>${esc(kwotaTxt(wydatki))}</dd></div>
        <div class="${wynik < 0 ? 'minus' : 'plus'}"><dt>Wynik</dt><dd>${esc(kwotaTxt(wynik))}</dd></div>
      </dl>
      <p class="uwagi-podsumowania">${[
        'Bez przeksięgowań i anulowanych',
        n ? `${n} ${odmiana(n, 'transakcja czeka', 'transakcje czekają', 'transakcji czeka')} na potwierdzenie wyciągiem` : '',
        bezKursu ? `Niewliczone, bo czekają na kurs NBP: ${bezKursu}` : '',
      ].filter(Boolean).map(esc).join('. ')}.</p>
      <div class="filtry">
        <input type="search" name="szukaj" value="${esc(filtry.szukaj)}" placeholder="Szukaj: kontrahent, opis, kwota" aria-label="Szukaj">
        <select name="konto" aria-label="Konto">
          <option value="">Wszystkie konta</option>
          ${konta().map(k => `<option ${k.nazwa === filtry.konto ? 'selected' : ''}>${esc(k.nazwa)}</option>`).join('')}
        </select>
        <label class="przelacznik"><input type="checkbox" name="anulowane" ${filtry.anulowane ? 'checked' : ''}> Pokaż anulowane</label>
      </div>
    </div>
    ${dni.size ? [...dni.entries()].map(([d, lst]) => `
      <section class="dzien">
        <h2>${esc(dataSlownie(d))}</h2>
        <ul>${lst.map(wierszListy).join('')}</ul>
      </section>`).join('') : `
      <div class="pusto-duze">
        <p>${wMiesiacu.length ? 'Nic nie pasuje do filtrów.' : 'W tym miesiącu nie ma jeszcze transakcji.'}</p>
        <a class="przycisk" href="#dodaj">Dodaj transakcję</a>
      </div>`}
  </section>`;
}

function wierszListy(g) {
  const t = g.glowna;
  let tytul, opis, kwota, druga = '', klasa, ik, tlo;
  if (g.rodzaj === 'przeksiegowanie' || g.rodzaj === 'wymiana') {
    tytul = g.rodzaj === 'wymiana' ? 'Wymiana walut' : 'Przeksięgowanie';
    opis = `${g.z?.konto || '?'} na ${g.na?.konto || '?'}`;
    kwota = kwotaTxt(Number(g.z.kwota), g.z.waluta);
    if (g.na && g.na.waluta !== g.z.waluta) druga = '→ ' + kwotaTxt(Number(g.na.kwota), g.na.waluta);
    klasa = 'przeks'; ik = g.rodzaj === 'wymiana' ? '💱' : '⇄'; tlo = '#D3E4E2';
  } else {
    const typ = t.typ === 'wpływ' ? 'wpływ' : 'wydatek';
    const kat = c => (typ === 'wpływ' ? c.zrodlo_przychodu : c.kategoria);
    const budzet = t.budzet && dane.budzety.find(b => b.id === t.budzet);
    if (g.rodzaj === 'podzial') {
      tytul = t.kontrahent || 'Transakcja podzielona';
      opis = [g.czesci.map(c => `${kat(c)} ${kwotaTxt(Number(c.kwota), c.waluta)}`).join(' + '), t.konto].join(', ');
    } else {
      tytul = t.kontrahent || kat(t) || 'Bez kategorii';
      opis = [t.kontrahent ? kat(t) : '', t.podkategoria, t.konto].filter(Boolean).join(', ');
    }
    if (t.podmiot && t.podmiot !== 'wspólne') opis += ', ' + t.podmiot;
    if (budzet) opis += `, budżet ${budzet.nazwa}`;
    kwota = (typ === 'wpływ' ? '+' : '−') + kwotaTxt(g.kwota, t.waluta);
    klasa = typ === 'wpływ' ? 'plus' : 'minus';
    ik = ikona(kat(t), typ); tlo = kolorKategorii(kat(t), typ);
  }
  const zal = zalaczniki(t.zalacznik).length;
  const znaczniki = [
    g.rodzaj === 'podzial' ? `<span class="znacznik">podzielona na ${g.czesci.length}</span>` : '',
    t.status === 'oczekuje na wyciąg' ? '<span class="znacznik czeka">czeka na wyciąg</span>' : '',
    t.status === 'potwierdzona' ? '<span class="znacznik potw">potwierdzona</span>' : '',
    t.status === 'anulowana' ? '<span class="znacznik anul">anulowana</span>' : '',
    zal ? `<span class="znacznik">${zal} ${odmiana(zal, 'załącznik', 'załączniki', 'załączników')}</span>` : '',
    g.czesci.some(czekaNaWysylke) ? '<span class="znacznik wysylka">do wysłania</span>' : '',
  ].join('');
  return `<li class="${t.status === 'anulowana' ? 'anulowana' : ''}">
    <a href="#edytuj/${encodeURIComponent(t.id)}">
      <span class="ikona" style="--tlo:${esc(tlo)}" aria-hidden="true">${esc(ik)}</span>
      <span class="srodek"><span class="tytul">${esc(tytul)}</span>
        <span class="opis">${esc(opis)}${t.opis ? ` <i>${esc(t.opis)}</i>` : ''}</span>
        ${znaczniki ? `<span class="znaczniki">${znaczniki}</span>` : ''}</span>
      <span class="kwota-wiersza ${klasa}">${esc(kwota)}${druga ? `<small>${esc(druga)}</small>` : ''}</span>
    </a></li>`;
}

export function klikLista(e) {
  if (!$('.lista')) return;
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  if (b.dataset.akcja === 'miesiac') {
    const d = new Date(filtry.miesiac + '-15T12:00:00');
    d.setMonth(d.getMonth() + Number(b.dataset.v));
    filtry.miesiac = dataLok(d).slice(0, 7);
  } else if (b.dataset.akcja === 'bez-budzetu') filtry.budzet = '';
  else return;
  renderLista();
}

export function filtrListy(e) {
  if (!$('.lista')) return;
  const el = e.target;
  if (el.name === 'szukaj') filtry.szukaj = el.value;
  else if (el.name === 'konto') filtry.konto = el.value;
  else if (el.name === 'anulowane') filtry.anulowane = el.checked;
  else return;
  const poz = el.name === 'szukaj' ? el.selectionStart : null;
  renderLista();
  if (poz !== null) {
    const nowe = $('.lista input[name="szukaj"]');
    nowe.focus();
    nowe.setSelectionRange(poz, poz);
  }
}

// ───────────────────────── Planowane ─────────────────────────

export function renderPlanowane() {
  const dzis = dataLok();
  const za30 = dodajDni(dzis, 30);
  const wszystkie = aktywnePlanowane().sort((a, b) => String(a.nastepna_data).localeCompare(String(b.nastepna_data)));
  const sekcje = [
    ['Po terminie', wszystkie.filter(p => p.nastepna_data < dzis)],
    ['Najbliższe 30 dni', wszystkie.filter(p => p.nastepna_data >= dzis && p.nastepna_data <= za30)],
    ['Później', wszystkie.filter(p => p.nastepna_data > za30)],
  ].filter(s => s[1].length);
  const subskrypcje = wszystkie.filter(p => p.rodzaj === 'subskrypcja');
  const subPLN = subskrypcje.filter(p => (p.waluta || 'PLN') === 'PLN').reduce((s, p) => s + miesiecznyKoszt(p), 0);
  const subObce = subskrypcje.filter(p => (p.waluta || 'PLN') !== 'PLN');
  let wyd30 = 0, wpl30 = 0;
  wszystkie.filter(p => p.nastepna_data <= za30 && (p.waluta || 'PLN') === 'PLN').forEach(p => {
    if (p.typ === 'wpływ') wpl30 += Number(p.kwota) || 0; else wyd30 += Number(p.kwota) || 0;
  });

  $('#widok').innerHTML = `
  <section class="planowane">
    <div class="naglowek-sekcji">
      <h1>Planowane</h1>
      <a class="przycisk" href="#dodaj/plan">Zaplanuj płatność</a>
    </div>
    ${wszystkie.length ? `
    <dl class="podsumowanie">
      <div class="minus"><dt>Do zapłaty w 30 dni</dt><dd>${esc(kwotaTxt(wyd30))}</dd></div>
      <div class="plus"><dt>Wpływy w 30 dni</dt><dd>${esc(kwotaTxt(wpl30))}</dd></div>
      <div><dt>Subskrypcje miesięcznie</dt><dd>${esc(kwotaTxt(zaokr(subPLN)))}</dd></div>
    </dl>
    <p class="uwagi-podsumowania">Kwoty w złotych. ${subObce.length ? `Subskrypcje w obcych walutach: ${subObce.map(p => `${esc(p.nazwa)} ${esc(kwotaTxt(miesiecznyKoszt(p), p.waluta))}`).join(', ')}.` : ''}</p>
    ${sekcje.map(([tytul, lst]) => `
      <section class="dzien ${tytul === 'Po terminie' ? 'po-terminie' : ''}">
        <h2>${esc(tytul)}</h2>
        <ul>${lst.map(wierszPlanu).join('')}</ul>
      </section>`).join('')}` : `
    <div class="pusto-duze">
      <p>Nie masz jeszcze nic zaplanowanego. Przy wpisie wybierz rodzaj „Nadchodząca” albo „Powtarzalna”, np. dla czynszu, ZUS czy abonamentu.</p>
    </div>`}
  </section>`;
}

function wierszPlanu(p) {
  const typ = p.typ === 'wpływ' ? 'wpływ' : 'wydatek';
  const kat = typ === 'wpływ' ? p.zrodlo_przychodu : p.kategoria;
  const dzis = dataLok();
  const opoznienie = p.nastepna_data < dzis;
  return `<li class="wiersz-planu ${opoznienie ? 'opozniona' : ''}">
    <a href="#plan/${encodeURIComponent(p.id)}">
      <span class="ikona" style="--tlo:${esc(kolorKategorii(kat, typ))}" aria-hidden="true">${esc(ikona(kat, typ))}</span>
      <span class="srodek"><span class="tytul">${esc(p.nazwa || kat)}</span>
        <span class="opis">${esc([opisRytmu(p), kat, p.konto].filter(Boolean).join(', '))}</span>
        <span class="znaczniki"><span class="znacznik ${opoznienie ? 'anul' : 'czeka'}">${esc(opoznienie ? 'termin minął ' + dataKrotko(p.nastepna_data) : dataSlownie(p.nastepna_data))}</span>
        ${p.rodzaj === 'subskrypcja' ? '<span class="znacznik">subskrypcja</span>' : ''}</span></span>
      <span class="kwota-wiersza ${typ === 'wpływ' ? 'plus' : 'minus'}">${typ === 'wpływ' ? '+' : '−'}${esc(kwotaTxt(Number(p.kwota), p.waluta))}</span>
    </a>
    <div class="akcje-planu">
      <button type="button" data-akcja="zaplacone" data-v="${esc(p.id)}">${typ === 'wpływ' ? 'Wpłynęło' : 'Zapłacone'}</button>
      ${p.rodzaj !== 'jednorazowa' ? `<button type="button" class="drugorzedny" data-akcja="pomin" data-v="${esc(p.id)}">Pomiń ten termin</button>` : ''}
    </div>
  </li>`;
}

async function oznaczZaplacone(p) {
  const kwota = Number(p.kwota) || 0;
  const waluta = p.waluta || 'PLN';
  const dzis = dataLok();
  const t = {
    id: uuid(), typ: p.typ === 'wpływ' ? 'wpływ' : 'wydatek', id_pary: '', podzial_id: '', data_operacji: dzis,
    konto: p.konto, kwota, waluta, kurs: waluta === 'PLN' ? 1 : '', kwota_pln: waluta === 'PLN' ? kwota : '',
    kategoria: p.kategoria || '', podkategoria: p.podkategoria || '', zrodlo_przychodu: p.zrodlo_przychodu || '',
    kontrahent: p.kontrahent || '', podmiot: p.podmiot || '', tagi: p.tagi || '', nr_dokumentu: '', opis: p.opis || '',
    zalacznik: '', budzet: p.budzet || '', planowana_id: p.id, status: 'oczekuje na wyciąg', zrodlo: 'ręczny',
  };
  const nastepny = nastepnyTermin(p);
  const plan = nastepny ? { ...p, nastepna_data: nastepny } : { ...p, status: 'zakończona' };
  await sync.zapisz('TRANSAKCJE', [t]);
  await sync.zapisz('PLANOWANE', [plan]);
  await wczytajDane();
  toast(`Zapisano ${t.typ} ${kwotaTxt(kwota, waluta)}.${nastepny ? ` Następny termin: ${dataSlownie(nastepny).toLowerCase()}.` : ''}`, 'ok', 5000,
    { etykieta: 'Popraw', fn: () => { location.hash = '#edytuj/' + encodeURIComponent(t.id); } });
  bezSkoku(renderPlanowane);
}

export async function klikPlanowane(e) {
  if (!$('.planowane')) return;
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const p = dane.planowane.find(x => x.id === b.dataset.v);
  if (b.dataset.akcja === 'zaplacone' && p) {
    b.disabled = true;
    await oznaczZaplacone(p);
  } else if (b.dataset.akcja === 'pomin' && p) {
    const nastepny = nastepnyTermin(p);
    await sync.zapisz('PLANOWANE', [nastepny ? { ...p, nastepna_data: nastepny } : { ...p, status: 'zakończona' }]);
    await wczytajDane();
    toast(nastepny ? `Pominięto. Następny termin: ${dataSlownie(nastepny).toLowerCase()}.` : 'Pominięto ostatni termin, pozycja zakończona.', 'ok');
    bezSkoku(renderPlanowane);
  }
}

// ───────────────────────── Budżety ─────────────────────────

export function renderBudzety() {
  const lst = aktywneBudzety();
  const projekty = lst.filter(b => b.rodzaj === 'projekt');
  const limity = lst.filter(b => b.rodzaj !== 'projekt');
  const zakonczone = dane.budzety.filter(b => b.status === 'zakończony');
  $('#widok').innerHTML = `
  <section class="budzety">
    <div class="naglowek-sekcji">
      <h1>Budżety</h1>
      <a class="przycisk" href="#budzet/nowy">Nowy budżet</a>
    </div>
    ${lst.length ? '' : `<div class="pusto-duze">
      <p>Budżet projektu zbiera wydatki wyprawy albo kiermaszu, które przypiszesz przy wpisie. Limit pilnuje miesięcznej kwoty na wybrane kategorie, np. wysyłki.</p>
      <a class="przycisk" href="#budzet/nowy">Utwórz pierwszy budżet</a></div>`}
    ${projekty.length ? `<h2 class="tytul-grupy">Projekty</h2><div class="karty-budzetow">${projekty.map(kartaBudzetu).join('')}</div>` : ''}
    ${limity.length ? `<h2 class="tytul-grupy">Limity na kategorie</h2><div class="karty-budzetow">${limity.map(kartaBudzetu).join('')}</div>` : ''}
    ${zakonczone.length ? `<details class="wiecej"><summary>Zakończone (${zakonczone.length})</summary>
      <div class="karty-budzetow">${zakonczone.map(kartaBudzetu).join('')}</div></details>` : ''}
  </section>`;
}

function kartaBudzetu(b) {
  const s = stanBudzetu(b);
  const przekroczony = s.zostalo < 0;
  const okres = b.rodzaj === 'projekt'
    ? (b.data_od || b.data_do ? `${b.data_od ? dataKrotko(b.data_od) : '…'} – ${b.data_do ? dataKrotko(b.data_do) : '…'}` : 'bez dat')
    : ({ 'tydzień': 'w tym tygodniu', 'rok': 'w tym roku' }[b.okres] || nazwaMiesiaca(s.od.slice(0, 7)).toLowerCase());
  const kat = kategorieBudzetu(b);
  return `<article class="karta-budzetu ${przekroczony ? 'przekroczony' : ''}" style="--kolor:${esc(b.kolor || KOLORY[0])}">
    <a class="naglowek-karty" href="#budzet/${encodeURIComponent(b.id)}">
      <h3>${esc(b.nazwa)}</h3>
      <span>${esc(okres)}${b.rodzaj !== 'projekt' && kat.length ? `, ${esc(kat.join(', '))}` : ''}${b.podmiot ? `, ${esc(b.podmiot)}` : ''}</span>
    </a>
    <div class="pasek" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(1, s.procent) * 100)}"
      aria-label="Wykorzystanie budżetu"><span style="width:${Math.min(100, s.procent * 100).toFixed(1)}%"></span></div>
    <p class="liczby"><b>${esc(kwotaTxt(s.wydane))}</b> z ${esc(kwotaTxt(s.kwota))}</p>
    <p class="zostalo">${przekroczony ? `Przekroczony o ${esc(kwotaTxt(-s.zostalo))}` : `Zostało ${esc(kwotaTxt(s.zostalo))}`}${s.naDzien ? `, około ${esc(kwotaTxt(s.naDzien))} dziennie do końca` : ''}.</p>
    ${s.wplywy ? `<p class="dodatkowe">Wpływy w tym budżecie: ${esc(kwotaTxt(s.wplywy))}.</p>` : ''}
    ${s.bezKursu ? `<p class="dodatkowe">Bez kursu NBP, niewliczone: ${s.bezKursu}.</p>` : ''}
    <button type="button" class="link" data-akcja="pokaz-transakcje" data-v="${esc(b.id)}">Pokaż transakcje (${s.liczba})</button>
  </article>`;
}

let bf = null;

function nowyBudzet() {
  return { id: null, nazwa: '', rodzaj: 'projekt', kwota: '', waluta: 'PLN', okres: 'miesiąc', data_od: dataLok(), data_do: '',
    kategorie: [], konta: '', podmiot: '', kolor: KOLORY[0], status: 'aktywny', opis: '', oryginal: null };
}

export function renderFormularzBudzetu(id) {
  if (!bf || bf.id !== (id === 'nowy' ? null : id)) {
    if (id === 'nowy') bf = nowyBudzet();
    else {
      const b = dane.budzety.find(x => x.id === id);
      if (!b) { location.hash = '#budzety'; return; }
      bf = { ...nowyBudzet(), ...b, kategorie: kategorieBudzetu(b), kwota: liczbaNaTekst(b.kwota), oryginal: b };
    }
  }
  const projekt = bf.rodzaj === 'projekt';
  $('#widok').innerHTML = `
  <section class="formularz-budzetu">
    <h1>${bf.id ? 'Edycja budżetu' : 'Nowy budżet'}</h1>
    <form class="karta-ustawien" data-forma="budzet" novalidate>
      <fieldset class="pole"><legend>Rodzaj</legend>
        <div class="chipy">
          <button type="button" class="chip" data-akcja="b-rodzaj" data-v="projekt" aria-pressed="${projekt}">Budżet projektu</button>
          <button type="button" class="chip" data-akcja="b-rodzaj" data-v="limit" aria-pressed="${!projekt}">Limit na kategorie</button>
        </div>
        <span class="podpowiedz">${projekt
          ? 'Liczą się transakcje, którym przy wpisie wskażesz ten budżet, np. wyprawa albo kiermasz.'
          : 'Aplikacja sama sumuje wydatki z wybranych kategorii w każdym okresie.'}</span>
      </fieldset>
      <div class="rzad">
        <label class="pole"><span class="etykieta">Nazwa</span>
          <input name="nazwa" value="${esc(bf.nazwa)}" placeholder="${projekt ? 'np. Wyprawa luty 2027' : 'np. Wysyłki'}" autocomplete="off" required></label>
        <label class="pole"><span class="etykieta">Kwota (zł)</span>
          <input name="kwota" inputmode="decimal" value="${esc(bf.kwota)}" placeholder="np. 15 000" autocomplete="off" required></label>
      </div>
      ${projekt ? `<div class="rzad">
        <label class="pole"><span class="etykieta">Od</span><input type="date" name="data_od" value="${esc(bf.data_od)}"></label>
        <label class="pole"><span class="etykieta">Do</span><input type="date" name="data_do" value="${esc(bf.data_do)}" min="${esc(bf.data_od)}"></label>
      </div>` : `
      <fieldset class="pole"><legend>Okres</legend>
        <div class="chipy">${[['miesiąc', 'Co miesiąc'], ['tydzień', 'Co tydzień'], ['rok', 'Co rok']].map(([o, e]) =>
          `<button type="button" class="chip" data-akcja="b-okres" data-v="${o}" aria-pressed="${bf.okres === o}">${e}</button>`).join('')}</div>
      </fieldset>
      <fieldset class="pole"><legend>Kategorie</legend>
        <div class="chipy">${glowne('wydatek').map(k =>
          `<button type="button" class="chip" data-akcja="b-kategoria" data-v="${esc(k.nazwa)}" aria-pressed="${bf.kategorie.includes(k.nazwa)}">${esc(k.nazwa)}</button>`).join('')}</div>
      </fieldset>`}
      <fieldset class="pole"><legend>Dotyczy</legend>
        <div class="chipy">${['', ...podmioty().filter(p => p !== 'wspólne')].map(p =>
          `<button type="button" class="chip" data-akcja="b-podmiot" data-v="${esc(p)}" aria-pressed="${bf.podmiot === p}">${esc(p || 'Całej firmy')}</button>`).join('')}</div>
      </fieldset>
      <fieldset class="pole"><legend>Kolor</legend>
        <div class="kolory">${KOLORY.map(k =>
          `<button type="button" data-akcja="b-kolor" data-v="${k}" aria-pressed="${bf.kolor === k}" style="--k:${k}" aria-label="Kolor ${k}"></button>`).join('')}</div>
      </fieldset>
      <label class="pole"><span class="etykieta">Opis</span><textarea name="opis" rows="2">${esc(bf.opis)}</textarea></label>
      <div class="przyciski">
        <button type="submit">${bf.id ? 'Zapisz zmiany' : 'Utwórz budżet'}</button>
        ${bf.id && bf.status === 'aktywny' ? '<button type="button" class="drugorzedny" data-akcja="b-zakoncz">Zakończ budżet</button>' : ''}
        ${bf.id && bf.status === 'zakończony' ? '<button type="button" class="drugorzedny" data-akcja="b-wznow">Przywróć budżet</button>' : ''}
        <a class="drugorzedny przycisk" href="#budzety">Wróć</a>
      </div>
    </form>
  </section>`;
}

function zbierzBudzet() {
  const form = $('form[data-forma="budzet"]');
  if (!form) return;
  ['nazwa', 'kwota', 'data_od', 'data_do', 'opis'].forEach(n => { if (form.elements[n]) bf[n] = form.elements[n].value; });
}

export async function klikBudzety(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'pokaz-transakcje' && $('.budzety')) {
    const bud = dane.budzety.find(x => x.id === v);
    filtry.budzet = v;
    filtry.miesiac = (bud?.rodzaj === 'projekt' && bud.data_od && !dataLok().startsWith(bud.data_od.slice(0, 7)) && bud.data_od > dataLok() ? bud.data_od : dataLok()).slice(0, 7);
    location.hash = '#lista';
    return;
  }
  if (!$('.formularz-budzetu') || !bf) return;
  zbierzBudzet();
  if (akcja === 'b-rodzaj') bf.rodzaj = v;
  else if (akcja === 'b-okres') bf.okres = v;
  else if (akcja === 'b-kategoria') bf.kategorie = bf.kategorie.includes(v) ? bf.kategorie.filter(k => k !== v) : [...bf.kategorie, v];
  else if (akcja === 'b-podmiot') bf.podmiot = v;
  else if (akcja === 'b-kolor') bf.kolor = v;
  else if (akcja === 'b-zakoncz' || akcja === 'b-wznow') {
    await sync.zapisz('BUDZETY', [{ ...bf.oryginal, status: akcja === 'b-zakoncz' ? 'zakończony' : 'aktywny' }]);
    await wczytajDane();
    toast(akcja === 'b-zakoncz' ? 'Budżet zakończony.' : 'Budżet przywrócony.', 'ok');
    bf = null;
    location.hash = '#budzety';
    return;
  } else return;
  bezSkoku(() => renderFormularzBudzetu(bf.id || 'nowy'));
}

export async function zapiszBudzet() {
  zbierzBudzet();
  const kwota = zaokr(liczba(bf.kwota));
  if (!bf.nazwa.trim()) return toast('Wpisz nazwę budżetu.', 'blad');
  if (!(kwota > 0)) return toast('Wpisz kwotę budżetu.', 'blad');
  if (bf.rodzaj === 'limit' && !bf.kategorie.length) return toast('Wybierz co najmniej jedną kategorię.', 'blad');
  if (bf.rodzaj === 'projekt' && bf.data_od && bf.data_do && bf.data_do < bf.data_od) return toast('Data końca jest wcześniejsza niż początek.', 'blad');
  const w = {
    ...(bf.oryginal || {}),
    id: bf.id || uuid(), nazwa: bf.nazwa.trim(), rodzaj: bf.rodzaj, kwota, waluta: 'PLN',
    okres: bf.rodzaj === 'projekt' ? '' : bf.okres,
    data_od: bf.rodzaj === 'projekt' ? bf.data_od : '', data_do: bf.rodzaj === 'projekt' ? bf.data_do : '',
    kategorie: bf.rodzaj === 'projekt' ? '' : bf.kategorie.join(', '), konta: '', podmiot: bf.podmiot,
    kolor: bf.kolor, status: bf.oryginal?.status || 'aktywny', opis: bf.opis.trim(),
  };
  await sync.zapisz('BUDZETY', [w]);
  await wczytajDane();
  toast(bf.id ? 'Zapisano budżet.' : `Utworzono budżet „${w.nazwa}”.`, 'ok');
  bf = null;
  location.hash = '#budzety';
}

// ───────────────────────── Ustawienia ─────────────────────────

export function renderUstawienia(komunikat = '') {
  const u = ustawienia();
  const s = sync.stanSynchronizacji();
  const pierwszy = !skonfigurowane();
  $('#widok').innerHTML = `
  <section class="ustawienia">
    ${pierwszy ? `<div class="powitanie">
      <h1>Połącz aplikację z arkuszem</h1>
      <p>Wpisz adres API i token z arkusza „One River – Finanse”. Zapiszą się tylko na tym urządzeniu.</p>
    </div>` : `<h1>Ustawienia</h1>`}

    <form class="karta-ustawien" data-forma="polaczenie" novalidate>
      <h2>Połączenie z arkuszem</h2>
      <label class="pole"><span class="etykieta">Adres API (kończy się na /exec)</span>
        <input name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(u.url || '')}"
          placeholder="https://script.google.com/macros/s/…/exec" required></label>
      <label class="pole"><span class="etykieta">Token</span>
        <span class="z-przyciskiem"><input name="token" type="password" autocomplete="off" spellcheck="false" value="${esc(u.token || '')}" required>
        <button type="button" class="drugorzedny" data-akcja="pokaz-token">Pokaż</button></span></label>
      <label class="pole"><span class="etykieta">Kto korzysta z tego urządzenia</span>
        <input name="kto" autocomplete="off" value="${esc(u.kto || '')}" placeholder="np. Olek, tablet kiermasz">
        <span class="podpowiedz">Ta nazwa trafia do kolumny „kto” i do dziennika zmian.</span></label>
      <div class="przyciski"><button type="submit">Zapisz i sprawdź połączenie</button></div>
      <p class="komunikat" aria-live="polite">${komunikat}</p>
    </form>

    ${pierwszy ? '' : `<div class="karta-ustawien">
      <h2>Synchronizacja</h2>
      <dl class="info">
        <div><dt>Ostatnia</dt><dd>${s.ostatnia ? esc(new Date(s.ostatnia).toLocaleString('pl-PL')) : 'jeszcze nie było'}</dd></div>
        <div><dt>Zmiany do wysłania</dt><dd>${(s.oczekujace || 0) - (s.plikiOczekujace || 0)}</dd></div>
        <div><dt>Załączniki do wysłania</dt><dd>${s.plikiOczekujace || 0}</dd></div>
        <div><dt>Transakcje na urządzeniu</dt><dd>${dane.transakcje.length}</dd></div>
        ${s.blad ? `<div><dt>Ostatni błąd</dt><dd class="blad">${esc(s.blad)}</dd></div>` : ''}
      </dl>
      <div class="przyciski">
        <button type="button" data-akcja="synchronizuj">Synchronizuj teraz</button>
        <button type="button" class="drugorzedny" data-akcja="pelna">Pobierz wszystko od nowa</button>
      </div>
    </div>

    <div class="karta-ustawien">
      <h2>To urządzenie</h2>
      <p>Wersja aplikacji ${WERSJA}. Dane działają bez internetu i wysyłają się same, gdy wróci połączenie.</p>
      <div class="przyciski"><button type="button" class="niebezpieczny" data-akcja="wyczysc">Usuń dane z tego urządzenia</button></div>
    </div>`}
  </section>`;
}

export async function zapiszPolaczenie(form) {
  const url = form.elements.url.value.trim();
  const token = form.elements.token.value.trim();
  const kto = form.elements.kto.value.trim();
  const msg = $('.komunikat', form);
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    msg.textContent = 'Adres musi zaczynać się od https://script.google.com/ i kończyć na /exec.';
    msg.className = 'komunikat blad';
    return;
  }
  if (!token) { msg.textContent = 'Wpisz token.'; msg.className = 'komunikat blad'; return; }
  zapiszUstawienia({ url, token, kto });
  msg.textContent = 'Sprawdzam połączenie…';
  msg.className = 'komunikat';
  try {
    const p = await wywolaj('ping', {}, 30000);
    msg.textContent = `Połączono z arkuszem „${p.arkusz}”. Pobieram dane…`;
    msg.className = 'komunikat ok';
    await sync.synchronizuj({ pelna: true });
    await wczytajDane();
    const s = sync.stanSynchronizacji();
    if (s.tryb === 'blad' && !s.plikiOczekujace) {
      renderUstawienia(esc('Połączenie działa, ale synchronizacja się nie udała: ' + s.blad));
    } else {
      toast(`Gotowe. Pobrano ${konta().length} kont i ${dane.transakcje.length} transakcji.`, 'ok');
      location.hash = '#dodaj';
    }
  } catch (e) {
    msg.textContent = e.message;
    msg.className = 'komunikat blad';
  }
}

export async function klikUstawienia(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b || !$('.ustawienia')) return;
  const akcja = b.dataset.akcja;
  if (akcja === 'pokaz-token') {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.textContent = i.type === 'password' ? 'Pokaż' : 'Ukryj';
  } else if (akcja === 'synchronizuj' || akcja === 'pelna') {
    b.disabled = true;
    await sync.synchronizuj({ pelna: akcja === 'pelna' });
    await wczytajDane();
    renderUstawienia();
  } else if (akcja === 'wyczysc') {
    const s = sync.stanSynchronizacji();
    const tak = await okno('Usunąć dane z tego urządzenia?',
      s.oczekujace
        ? `<p class="blad"><b>${s.oczekujace} zmian lub plików nie zostało jeszcze wysłanych i przepadną.</b> Najpierw połącz się z internetem i zsynchronizuj.</p>`
        : `<p>Arkusz zostaje bez zmian. Z urządzenia znikną kopie danych, adres API i token.</p>`,
      [{ etykieta: 'Zostaw dane', wartosc: false, klasa: 'drugorzedny', autofocus: true },
       { etykieta: s.oczekujace ? 'Usuń mimo to' : 'Usuń dane', wartosc: true, klasa: 'niebezpieczny' }]);
    if (!tak) return;
    await db.wyczyscWszystko();
    localStorage.clear();
    location.hash = '#ustawienia';
    location.reload();
  }
}
