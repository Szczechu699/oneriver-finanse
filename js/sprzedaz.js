// Ekran „Sprzedaż”: paragony z Subiekta GT (INCO i OFI) wklejone z zestawienia SQL „Sprzedaż do aplikacji”,
// raport za wybrany okres oraz ekran wklejania (#sprzedaz/wklej).

import { $, esc, zaokr, fmt2, kwotaTxt, dataLok, dodajDni, przesunDate, roznicaDni, dataKrotko, nazwaMiesiaca, odmiana, toast } from './util.js';
import { dane, wczytajDane } from './dane.js';
import * as sync from './sync.js';
import { wersjaApi } from './api.js';
import { przedzialy } from './podsumowanie.js';
import { ikonaSvg } from './ikony.js';

const PODMIOTY_SGT = ['INCO', 'OFI'];
const OKRESY = [['ten-miesiac', 'Ten miesiąc'], ['poprzedni', 'Poprzedni miesiąc'], ['kwartal', 'Ten kwartał'], ['rok', 'Ten rok'], ['12m', 'Ostatnie 12 miesięcy'], ['wlasny', 'Własny']];
const FORMY = [['kw_gotowka', 'Gotówka'], ['kw_karta', 'Karta'], ['kw_przelew', 'Przelew'], ['kw_kredyt', 'Kredyt']];

// Kolejność kolumn zestawienia – używana, gdy wklejony tekst nie ma wiersza nagłówka.
const KOLUMNY_SGT = ['podmiot', 'dok_id', 'typ', 'numer', 'data', 'magazyn_symbol', 'magazyn', 'kontrahent_symbol', 'kontrahent',
  'forma_platnosci', 'kw_gotowka', 'kw_karta', 'kw_przelew', 'kw_kredyt', 'kategoria', 'wystawil', 'dokument_brutto',
  'ob_id', 'symbol', 'nazwa', 'grupa', 'ilosc', 'jm', 'netto', 'brutto'];
const WYMAGANE = ['podmiot', 'dok_id', 'numer', 'data', 'ob_id', 'brutto'];
// Pola porównywane przy ponownym wklejeniu (zmiana któregoś = aktualizacja w arkuszu).
const POLA_DOK = ['typ', 'numer', 'data', 'magazyn', 'magazyn_symbol', 'kontrahent_id', 'kontrahent', 'forma_platnosci',
  'kw_gotowka', 'kw_karta', 'kw_przelew', 'kw_kredyt', 'kategoria', 'wystawil', 'netto', 'brutto', 'liczba_pozycji'];
const POLA_POZ = ['dok_id', 'symbol', 'nazwa', 'grupa', 'ilosc', 'jm', 'netto', 'brutto'];

const stan = {
  okres: 'ten-miesiac', od: '', do: '', panel: false,
  podmioty: new Set(), magazyny: new Set(), formy: new Set(),
  ileParagonow: 30, tekst: '', plik: '', wynik: null,
};

// ───────────────────────── okres ─────────────────────────

function zakres() {
  const dzis = dataLok();
  const poczMies = dzis.slice(0, 7) + '-01';
  const konMies = d => dodajDni(przesunDate(d.slice(0, 7) + '-01', 'miesiąc', 1), -1);
  switch (stan.okres) {
    case 'poprzedni': { const od = przesunDate(poczMies, 'miesiąc', -1); return [od, konMies(od)]; }
    case 'kwartal': {
      const m = Math.floor((Number(dzis.slice(5, 7)) - 1) / 3) * 3 + 1;
      const od = `${dzis.slice(0, 4)}-${String(m).padStart(2, '0')}-01`;
      return [od, dodajDni(przesunDate(od, 'miesiąc', 3), -1)];
    }
    case 'rok': return [dzis.slice(0, 4) + '-01-01', dzis.slice(0, 4) + '-12-31'];
    case '12m': return [przesunDate(poczMies, 'miesiąc', -11), konMies(dzis)];
    case 'wlasny': {
      const od = stan.od || poczMies;
      const do_ = stan.do && stan.do >= od ? stan.do : konMies(od);
      return [od, do_];
    }
    default: return [poczMies, konMies(dzis)];
  }
}

function opisZakresu(od, do_) {
  if (od.slice(8) === '01' && do_ === dodajDni(przesunDate(od, 'miesiąc', 1), -1)) return nazwaMiesiaca(od.slice(0, 7));
  const r = (a, b) => (a.slice(0, 4) === b.slice(0, 4) ? '' : ' ' + a.slice(0, 4));
  return `${dataKrotko(od)}${r(od, do_)} – ${dataKrotko(do_)} ${do_.slice(0, 4)}`;
}

function okresPoprzedni(od, do_) {
  const dzis = dataLok();
  const koniec = od <= dzis && dzis < do_ ? dzis : do_;
  const miesiace = { 'ten-miesiac': 1, poprzedni: 1, kwartal: 3, rok: 12, '12m': 12 }[stan.okres];
  if (miesiace) return { od: przesunDate(od, 'miesiąc', -miesiace), do: przesunDate(koniec, 'miesiąc', -miesiace), doDzis: koniec !== do_ };
  const dni = roznicaDni(do_, od) + 1;
  return { od: dodajDni(od, -dni), do: dodajDni(koniec, -dni), doDzis: koniec !== do_ };
}

// ───────────────────────── dane ─────────────────────────

const num = v => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};
const kluczDok = d => `${d.podmiot}|${d.dok_id}`;

function pasuje(d) {
  if (stan.podmioty.size && !stan.podmioty.has(d.podmiot)) return false;
  if (stan.magazyny.size && !stan.magazyny.has(d.magazyn || '')) return false;
  if (stan.formy.size && !stan.formy.has(d.forma_platnosci || '')) return false;
  return true;
}

const dokumentyOkresu = (od, do_) => dane.sprzedaz.filter(d => d.data >= od && d.data <= do_ && pasuje(d));

/** Kwoty według formy płatności; resztę (np. brak danych w starszych wierszach) pokazujemy jako „Inna”. */
function platnosci(d) {
  const wynik = FORMY.map(([pole, nazwa]) => [nazwa, num(d[pole])]).filter(([, v]) => v);
  const reszta = zaokr(num(d.brutto) - wynik.reduce((a, [, v]) => a + v, 0));
  if (Math.abs(reszta) >= 0.01) wynik.push([d.forma_platnosci && !wynik.length ? d.forma_platnosci : 'Inna', reszta]);
  return wynik;
}

function sumuj(lista, fn) {
  const mapa = new Map();
  lista.forEach(x => fn(x).forEach(([k, v]) => mapa.set(k, (mapa.get(k) || 0) + v)));
  return [...mapa.entries()].map(([k, v]) => [k, zaokr(v)]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
}

// ───────────────────────── raport ─────────────────────────

function ranking(pozycje, pusto = 'Brak sprzedaży w tym okresie.') {
  if (!pozycje.length) return `<p class="pusto">${esc(pusto)}</p>`;
  const suma = pozycje.reduce((a, [, v]) => a + v, 0);
  const max = Math.max(...pozycje.map(([, v]) => v), 1);
  return `<ol class="ranking">${pozycje.map(([nazwa, v]) => `
    <li><div class="pozycja-rankingu bez-ikony">
      <span class="opis-rankingu"><span class="nazwa">${esc(nazwa)}</span>
        <span class="pasek-rankingu"><span class="seria-wplywy" style="width:${Math.max(1.5, (v / max) * 100).toFixed(1)}%"></span></span></span>
      <span class="wartosc-rankingu"><b>${esc(kwotaTxt(v))}</b><span>${suma ? Math.round((v / suma) * 100) : 0}%</span></span>
    </div></li>`).join('')}</ol>`;
}

const krotko = n => (n >= 1000 ? fmt2.format(n / 1000).replace(/,?0+$/, '') + ' tys.' : String(Math.round(n)));

function wykres(kubly, szer) {
  const W = Math.max(300, szer), H = 220, L = 54, P = 8, G = 14, D = 26;
  const max = Math.max(...kubly.map(k => k.v), 0) || 100;
  const krok = Math.pow(10, Math.floor(Math.log10(max)));
  const gora = Math.ceil(max / krok) * krok;
  const y = v => G + (H - G - D) * (1 - v / gora);
  const szerKubla = (W - L - P) / kubly.length;
  const co = Math.ceil(kubly.length / Math.floor((W - L) / 46));
  const linie = [0, 0.5, 1].map(f => {
    const v = gora * f;
    return `<line class="${f ? 'siatka' : 'os-zero'}" x1="${L}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}"/><text class="os" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(krotko(v))}</text>`;
  }).join('');
  const slupki = kubly.map((k, i) => {
    const x = L + i * szerKubla;
    const s = Math.max(2, szerKubla * 0.7);
    const h = Math.max(0, y(0) - y(k.v));
    return `<g><title>${esc(k.pelna)}: ${esc(kwotaTxt(k.v))} (${k.n} ${odmiana(k.n, 'paragon', 'paragony', 'paragonów')})</title>
      ${k.v ? `<rect class="seria-wplywy" x="${(x + (szerKubla - s) / 2).toFixed(1)}" y="${(y(0) - h).toFixed(1)}" width="${s.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>` : ''}
      <rect class="cel-dotyku" x="${x.toFixed(1)}" y="${G}" width="${szerKubla.toFixed(1)}" height="${H - G - D}"/>
      ${i % co === 0 ? `<text class="os" x="${(x + szerKubla / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(k.etykieta)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="wykres" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sprzedaż brutto w czasie">${linie}${slupki}</svg>`;
}

function panelFiltrow() {
  const grupa = (nazwa, tytul, opcje, wybrane) => `<fieldset class="grupa-filtru"><legend>${esc(tytul)}</legend><div class="chipy male">${opcje.map(v =>
    `<button type="button" class="chip" data-akcja="f-${nazwa}" data-v="${esc(v)}" aria-pressed="${wybrane.has(v)}">${esc(v || '(brak)')}</button>`).join('')}</div></fieldset>`;
  const unikalne = pole => [...new Set(dane.sprzedaz.map(d => d[pole] || ''))].sort((a, b) => a.localeCompare(b, 'pl'));
  return `<div class="panel-filtrow">
    ${grupa('podmioty', 'Podmiot', PODMIOTY_SGT, stan.podmioty)}
    ${grupa('magazyny', 'Magazyn', unikalne('magazyn'), stan.magazyny)}
    ${grupa('formy', 'Forma płatności', unikalne('forma_platnosci'), stan.formy)}
    <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="wyczysc">Wyczyść filtry</button>
      <button type="button" data-akcja="panel">Gotowe</button></div>
  </div>`;
}

function zmiana(teraz, wczesniej) {
  if (!wczesniej) return teraz ? 'brak sprzedaży w poprzednim okresie' : '';
  const p = ((teraz - wczesniej) / Math.abs(wczesniej)) * 100;
  if (Math.abs(p) < 0.5) return 'tak samo jak w poprzednim okresie';
  return `${p > 0 ? '▲' : '▼'} ${fmt2.format(Math.abs(p)).replace(/,00$/, '')}% wobec poprzedniego okresu`;
}

function htmlParagonu(d, poz) {
  return `<details class="paragon">
    <summary>
      <span class="paragon-data">${esc(dataKrotko(d.data))}</span>
      <span class="paragon-opis"><b>${esc(d.numer)}</b><span>${esc([d.podmiot, d.magazyn, d.kontrahent].filter(Boolean).join(' · '))}</span></span>
      <span class="paragon-forma">${esc(d.forma_platnosci || '')}</span>
      <b class="paragon-kwota">${esc(kwotaTxt(num(d.brutto)))}</b>
    </summary>
    <table class="tabela"><thead><tr><th>Symbol</th><th>Nazwa</th><th class="liczba">Ilość</th><th class="liczba">Brutto</th></tr></thead>
      <tbody>${poz.map(p => `<tr><td>${esc(p.symbol)}</td><td>${esc(p.nazwa)}</td><td class="liczba">${esc(fmt2.format(num(p.ilosc)).replace(/,00$/, ''))} ${esc(p.jm || '')}</td><td class="liczba">${esc(kwotaTxt(num(p.brutto)))}</td></tr>`).join('')
        || '<tr><td colspan="4">Brak pozycji na urządzeniu.</td></tr>'}</tbody></table>
    ${platnosci(d).length > 1 ? `<p class="podpowiedz">Płatność: ${platnosci(d).map(([n, v]) => `${esc(n)} ${esc(kwotaTxt(v))}`).join(', ')}</p>` : ''}
  </details>`;
}

function renderRaport() {
  if (!dane.sprzedaz.length) {
    $('#widok').innerHTML = `<section class="ekran podsumowanie-ekran sprzedaz-ekran">
      <div class="naglowek-sekcji"><h1>Sprzedaż</h1></div>
      <div class="karta-ustawien">
        <h2>Brak sprzedaży z Subiektu</h2>
        <p>Uruchom w Subiekcie zestawienie SQL „Sprzedaż do aplikacji” (osobno w INCO i w OFI), skopiuj wynik i wklej go tutaj.</p>
        <div class="przyciski"><a class="przycisk" href="#sprzedaz/wklej">Wklej zestawienie z Subiektu</a></div>
      </div></section>`;
    return;
  }
  const [od, do_] = zakres();
  const pop = okresPoprzedni(od, do_);
  const dok = dokumentyOkresu(od, do_);
  const dokPop = dokumentyOkresu(pop.od, pop.do);
  const klucze = new Set(dok.map(kluczDok));
  const poz = dane.sprzedazPoz.filter(p => klucze.has(`${p.podmiot}|${p.dok_id}`));
  const suma = zaokr(dok.reduce((a, d) => a + num(d.brutto), 0));
  const sumaPop = zaokr(dokPop.reduce((a, d) => a + num(d.brutto), 0));
  const bezgotowkowe = zaokr(dok.reduce((a, d) => a + num(d.kw_karta) + num(d.kw_przelew) + num(d.kw_kredyt), 0));
  const nFiltrow = stan.podmioty.size + stan.magazyny.size + stan.formy.size;

  const kubly = przedzialy(od, do_).map(k => ({ ...k, v: 0, n: 0 }));
  dok.forEach(d => {
    const k = kubly.find(x => d.data >= x.od && d.data <= x.do);
    if (k) { k.v += num(d.brutto); k.n++; }
  });
  kubly.forEach(k => { k.v = zaokr(k.v); });

  const produkty = new Map();
  poz.forEach(p => {
    const k = p.symbol || p.nazwa || '?';
    const e = produkty.get(k) || { symbol: p.symbol, nazwa: p.nazwa, ilosc: 0, brutto: 0 };
    e.ilosc += num(p.ilosc); e.brutto += num(p.brutto);
    produkty.set(k, e);
  });
  const top = [...produkty.values()].sort((a, b) => b.brutto - a.brutto).slice(0, 12);
  const pozWgDok = new Map();
  poz.forEach(p => {
    const k = `${p.podmiot}|${p.dok_id}`;
    if (!pozWgDok.has(k)) pozWgDok.set(k, []);
    pozWgDok.get(k).push(p);
  });
  const paragony = [...dok].sort((a, b) => (b.data + b.numer).localeCompare(a.data + a.numer, 'pl', { numeric: true }));
  const ostatnieWklejenie = dane.sprzedaz.reduce((m, d) => (String(d.data_wklejenia || '') > m ? String(d.data_wklejenia) : m), '');
  const szer = Math.min(($('#widok').clientWidth || 900) - 40, 1200);

  $('#widok').innerHTML = `
  <section class="ekran podsumowanie-ekran sprzedaz-ekran">
    <div class="naglowek-sekcji"><h1>Sprzedaż</h1><span class="okres-tytul">${esc(opisZakresu(od, do_))}</span>
      <a class="przycisk-maly akcja-naglowka" href="#sprzedaz/wklej">Wklej z Subiektu</a></div>
    <div class="pasek-filtrow">
      <div class="chipy male" role="group" aria-label="Okres">${OKRESY.map(([o, e]) =>
        `<button type="button" class="chip" data-akcja="okres" data-v="${o}" aria-pressed="${stan.okres === o}">${e}</button>`).join('')}</div>
      ${stan.okres === 'wlasny' ? `<div class="zakres-dat">
        <label><span class="etykieta">Od</span><input type="date" name="od" value="${esc(od)}"></label>
        <label><span class="etykieta">Do</span><input type="date" name="do" value="${esc(do_)}" min="${esc(od)}"></label></div>` : ''}
      <button type="button" class="drugorzedny przycisk-ikona" data-akcja="panel" aria-expanded="${stan.panel}">${ikonaSvg('filtr')} Filtry${nFiltrow ? ` <span class="licznik">${nFiltrow}</span>` : ''}</button>
    </div>
    ${stan.panel ? panelFiltrow() : ''}

    <div class="kafle-wskaznikow">
      <div class="wskaznik wyroznione"><span class="etykieta-wsk"><i class="znak seria-wplywy"></i>Sprzedaż brutto</span><b>${esc(kwotaTxt(suma))}</b><span class="zmiana">${esc(zmiana(suma, sumaPop))}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Paragony</span><b>${dok.length}</b><span class="zmiana">poprzednio ${dokPop.length}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Średni paragon</span><b>${esc(kwotaTxt(dok.length ? zaokr(suma / dok.length) : 0))}</b><span class="zmiana">${poz.length} ${odmiana(poz.length, 'pozycja', 'pozycje', 'pozycji')}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Karta, przelew, kredyt</span><b>${esc(kwotaTxt(bezgotowkowe))}</b><span class="zmiana">do sprawdzenia z wyciągami</span></div>
    </div>
    <p class="uwagi-podsumowania">Paragony z Subiektu GT${nFiltrow ? ', według filtrów' : ''}. Porównanie ${pop.doDzis ? 'do dziś ' : ''}z okresem ${esc(opisZakresu(pop.od, pop.do))}.${ostatnieWklejenie ? ` Ostatnio wklejono ${esc(dataKrotko(ostatnieWklejenie.slice(0, 10)))}.` : ''}</p>

    <div class="siatka-paneli">
      <article class="panel szeroki">
        <header><h2>Sprzedaż w czasie</h2><span class="podtytul">brutto</span></header>
        <div class="wykres-kontener">${wykres(kubly, szer - 36)}</div>
        <details class="tabela-wykresu"><summary>Pokaż jako tabelę</summary>
          <table class="tabela"><thead><tr><th>Okres</th><th class="liczba">Paragony</th><th class="liczba">Brutto</th></tr></thead>
          <tbody>${kubly.filter(k => k.n).map(k => `<tr><td>${esc(k.pelna)}</td><td class="liczba">${k.n}</td><td class="liczba">${esc(kwotaTxt(k.v))}</td></tr>`).join('') || '<tr><td colspan="3">Brak danych</td></tr>'}</tbody></table>
        </details>
      </article>
      <article class="panel"><header><h2>Według magazynu</h2></header>${ranking(sumuj(dok, d => [[d.magazyn || '(bez magazynu)', num(d.brutto)]]))}</article>
      <article class="panel"><header><h2>Według formy płatności</h2></header>${ranking(sumuj(dok, platnosci))}</article>
      ${stan.podmioty.size === 1 ? '' : `<article class="panel"><header><h2>Według podmiotu</h2></header>${ranking(sumuj(dok, d => [[d.podmiot, num(d.brutto)]]))}</article>`}
      <article class="panel"><header><h2>Według grupy towarów</h2></header>${ranking(sumuj(poz, p => [[p.grupa || 'Podstawowa', num(p.brutto)]]).slice(0, 10))}</article>
      <article class="panel szeroki"><header><h2>Najlepiej sprzedające się produkty</h2></header>
        ${top.length ? `<table class="tabela"><thead><tr><th>Symbol</th><th>Nazwa</th><th class="liczba">Ilość</th><th class="liczba">Brutto</th></tr></thead>
          <tbody>${top.map(p => `<tr><td>${esc(p.symbol)}</td><td>${esc(p.nazwa)}</td><td class="liczba">${esc(fmt2.format(p.ilosc).replace(/,00$/, ''))}</td><td class="liczba">${esc(kwotaTxt(zaokr(p.brutto)))}</td></tr>`).join('')}</tbody></table>`
          : '<p class="pusto">Brak sprzedaży w tym okresie.</p>'}
      </article>
      <article class="panel szeroki"><header><h2>Paragony</h2><span class="podtytul">${dok.length} ${odmiana(dok.length, 'paragon', 'paragony', 'paragonów')}</span></header>
        ${paragony.length ? `<div class="lista-paragonow">${paragony.slice(0, stan.ileParagonow).map(d => htmlParagonu(d, pozWgDok.get(kluczDok(d)) || [])).join('')}</div>
          ${paragony.length > stan.ileParagonow ? `<div class="przyciski"><button type="button" class="drugorzedny" data-akcja="wiecej-paragonow">Pokaż kolejne (${paragony.length - stan.ileParagonow})</button></div>` : ''}`
          : '<p class="pusto">Brak paragonów w tym okresie.</p>'}
      </article>
    </div>
  </section>`;
}

// ───────────────────────── wklejanie ─────────────────────────

/** Kwota z Subiekta: „1 234,56”, „1234.5600”, „12,5 zł”. */
function kwota(s) {
  let t = String(s ?? '').replace(/[\s  ]|zł|PLN/gi, '');
  if (t === '') return 0;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '');
  const n = Number(t.replace(',', '.'));
  return isFinite(n) ? n : NaN;
}

function dataIso(s) {
  const t = String(s ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function podzielLinie(linia, sep) {
  if (sep === '\t') return linia.split('\t');
  const wynik = [];
  let pole = '', cudzyslow = false;
  for (let i = 0; i < linia.length; i++) {
    const c = linia[i];
    if (cudzyslow) {
      if (c === '"' && linia[i + 1] === '"') { pole += '"'; i++; }
      else if (c === '"') cudzyslow = false;
      else pole += c;
    } else if (c === '"') cudzyslow = true;
    else if (c === sep) { wynik.push(pole); pole = ''; }
    else pole += c;
  }
  wynik.push(pole);
  return wynik;
}

/** Tekst zestawienia → paragony z pozycjami, porównane z tym, co już jest w aplikacji. */
export function przeanalizuj(tekst) {
  const linie = String(tekst || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!linie.length) return null;
  const sep = linie[0].includes('\t') ? '\t' : (linie[0].split(';').length > linie[0].split(',').length ? ';' : ',');
  const pierwsza = podzielLinie(linie[0], sep).map(c => c.trim().toLowerCase());
  let kolumny, start;
  if (pierwsza.includes('dok_id')) { kolumny = pierwsza; start = 1; }
  else if (pierwsza.length === KOLUMNY_SGT.length) { kolumny = KOLUMNY_SGT; start = 0; }
  else return { blad: 'Nie rozpoznaję kolumn. Skopiuj wynik zestawienia „Sprzedaż do aplikacji” razem z nagłówkiem (pierwszy wiersz z nazwami kolumn).' };
  const brak = WYMAGANE.filter(k => !kolumny.includes(k));
  if (brak.length) return { blad: `W wklejonym tekście brakuje kolumn: ${brak.join(', ')}. Sprawdź, czy zapytanie w Subiekcie jest aktualne.` };

  const bledy = [];
  let pominiete = 0;
  const dokumenty = new Map();
  const dzis = dataLok();
  for (let i = start; i < linie.length; i++) {
    const komorki = podzielLinie(linie[i], sep);
    const r = {};
    kolumny.forEach((k, j) => { r[k] = String(komorki[j] ?? '').trim(); });
    if (!r.dok_id || !r.ob_id) { pominiete++; continue; }
    const podmiot = r.podmiot.toUpperCase();
    if (!PODMIOTY_SGT.includes(podmiot)) { bledy.push(`Wiersz ${i + 1}: nieznany podmiot „${r.podmiot}”.`); continue; }
    const data = dataIso(r.data);
    if (!data) { bledy.push(`Wiersz ${i + 1}: nie rozumiem daty „${r.data}”.`); continue; }
    const liczby = {};
    let zla = '';
    ['kw_gotowka', 'kw_karta', 'kw_przelew', 'kw_kredyt', 'dokument_brutto', 'ilosc', 'netto', 'brutto'].forEach(k => {
      liczby[k] = kwota(r[k]);
      if (isNaN(liczby[k])) zla = zla || `${k} = „${r[k]}”`;
    });
    if (zla) { bledy.push(`Wiersz ${i + 1}: to nie jest liczba: ${zla}.`); continue; }

    const klucz = `${podmiot}|${r.dok_id}`;
    let d = dokumenty.get(klucz);
    if (!d) {
      d = {
        wiersz: {
          podmiot, dok_id: r.dok_id, typ: r.typ || 'PA', numer: r.numer, data,
          magazyn: r.magazyn, magazyn_symbol: r.magazyn_symbol, kontrahent_id: r.kontrahent_symbol, kontrahent: r.kontrahent,
          forma_platnosci: r.forma_platnosci, kw_gotowka: zaokr(liczby.kw_gotowka), kw_karta: zaokr(liczby.kw_karta),
          kw_przelew: zaokr(liczby.kw_przelew), kw_kredyt: zaokr(liczby.kw_kredyt), kategoria: r.kategoria, wystawil: r.wystawil,
          netto: 0, brutto: 0, liczba_pozycji: 0, okres: data.slice(0, 7), data_wklejenia: dzis, zrodlo: 'Subiekt GT – zestawienie SQL',
        },
        dokumentBrutto: liczby.dokument_brutto, sumaPoz: 0, pozycje: new Map(),
      };
      dokumenty.set(klucz, d);
    }
    if (!d.pozycje.has(r.ob_id)) {
      d.pozycje.set(r.ob_id, {
        podmiot, dok_id: r.dok_id, ob_id: r.ob_id, symbol: r.symbol, nazwa: r.nazwa, grupa: r.grupa,
        ilosc: liczby.ilosc, jm: r.jm, netto: zaokr(liczby.netto), brutto: zaokr(liczby.brutto),
      });
      d.wiersz.netto += liczby.netto;
      d.sumaPoz += liczby.brutto;
    }
  }

  const istniejace = new Map(dane.sprzedaz.map(d => [kluczDok(d), d]));
  const istniejacePoz = new Map(dane.sprzedazPoz.map(p => [`${p.podmiot}|${p.ob_id}`, p]));
  const rozne = (a, b, pola) => !b || pola.some(p => {
    const x = a[p], y = b[p];
    if (typeof x === 'number') return Math.abs(x - num(y)) > 0.004;
    return String(x ?? '').trim() !== String(y ?? '').trim();
  });

  const wynik = {
    dokumenty: [], pozycje: [], nowe: 0, zmienione: 0, bezZmian: 0, liczbaPoz: 0, suma: 0, od: '', do: '',
    podmioty: new Set(), niezgodne: [], bledy, pominiete, formy: new Map(), magazyny: new Map(),
  };
  for (const [klucz, d] of dokumenty) {
    const w = d.wiersz;
    w.netto = zaokr(w.netto);
    w.liczba_pozycji = d.pozycje.size;
    w.brutto = zaokr(d.dokumentBrutto || d.sumaPoz);
    if (d.dokumentBrutto && Math.abs(d.dokumentBrutto - d.sumaPoz) > 0.02) w.niezgodny = true;
    if (w.niezgodny) { wynik.niezgodne.push(`${w.numer} (${w.podmiot}): paragon ${kwotaTxt(d.dokumentBrutto)}, pozycje ${kwotaTxt(zaokr(d.sumaPoz))}`); delete w.niezgodny; }
    wynik.suma += w.brutto;
    wynik.liczbaPoz += d.pozycje.size;
    wynik.podmioty.add(w.podmiot);
    if (!wynik.od || w.data < wynik.od) wynik.od = w.data;
    if (!wynik.do || w.data > wynik.do) wynik.do = w.data;
    platnosci(w).forEach(([n, v]) => wynik.formy.set(n, zaokr((wynik.formy.get(n) || 0) + v)));
    const mag = w.magazyn || '(bez magazynu)';
    wynik.magazyny.set(mag, zaokr((wynik.magazyny.get(mag) || 0) + w.brutto));

    const stary = istniejace.get(klucz);
    const nowePoz = [...d.pozycje.values()].filter(p => rozne(p, istniejacePoz.get(`${p.podmiot}|${p.ob_id}`), POLA_POZ));
    if (!stary) wynik.nowe++;
    else if (rozne(w, stary, POLA_DOK) || nowePoz.length) wynik.zmienione++;
    else { wynik.bezZmian++; continue; }
    wynik.dokumenty.push(stary ? { ...w, data_wklejenia: dzis } : w);
    wynik.pozycje.push(...nowePoz);
  }
  wynik.suma = zaokr(wynik.suma);
  wynik.liczbaDok = dokumenty.size;
  return wynik;
}

function htmlPodgladu() {
  const w = stan.wynik;
  if (!w) return '';
  if (w.blad) return `<p class="komunikat blad">${esc(w.blad)}</p>`;
  if (!w.liczbaDok) return `<p class="komunikat blad">Nie znalazłem żadnego paragonu w wklejonym tekście.${w.bledy.length ? ' ' + esc(w.bledy.slice(0, 3).join(' ')) : ''}</p>`;
  const api = wersjaApi();
  const stareApi = api && api < 4;
  const doZapisu = w.nowe + w.zmienione;
  const lista = mapa => [...mapa.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => `<div><dt>${esc(n)}</dt><dd>${esc(kwotaTxt(v))}</dd></div>`).join('');
  return `
    <dl class="info">
      <div><dt>Podmiot</dt><dd><b>${esc([...w.podmioty].join(', '))}</b></dd></div>
      <div><dt>Okres</dt><dd>${esc(w.od === w.do ? dataKrotko(w.od) + ' ' + w.od.slice(0, 4) : opisZakresu(w.od, w.do))}</dd></div>
      <div><dt>Paragony</dt><dd>${w.liczbaDok} (${w.liczbaPoz} ${odmiana(w.liczbaPoz, 'pozycja', 'pozycje', 'pozycji')})</dd></div>
      <div><dt>Suma brutto</dt><dd><b>${esc(kwotaTxt(w.suma))}</b></dd></div>
    </dl>
    <h3>Formy płatności</h3><dl class="info">${lista(w.formy)}</dl>
    <h3>Magazyny</h3><dl class="info">${lista(w.magazyny)}</dl>
    <p>${w.nowe ? `<b>Nowe: ${w.nowe}</b>` : 'Nowych: 0'} · zmienione: ${w.zmienione} · już w aplikacji bez zmian: ${w.bezZmian}</p>
    ${w.niezgodne.length ? `<div class="pasek-edycji"><span>Suma pozycji nie zgadza się z wartością paragonu (${w.niezgodne.length}): ${esc(w.niezgodne.slice(0, 5).join('; '))}${w.niezgodne.length > 5 ? '…' : ''}. Zapiszę wartość z paragonu.</span></div>` : ''}
    ${w.bledy.length ? `<p class="komunikat blad">Pominięte wiersze z błędami (${w.bledy.length}): ${esc(w.bledy.slice(0, 4).join(' '))}${w.bledy.length > 4 ? '…' : ''}</p>` : ''}
    ${stareApi ? `<p class="komunikat blad">Skrypt arkusza ma wersję ${api}. Do zapisu sprzedaży potrzebna jest wersja 4 – wklej nowy Kod.gs i wdroż nową wersję.</p>` : ''}
    <div class="przyciski">
      <button type="button" data-akcja="zapisz-sgt" ${!doZapisu || stareApi ? 'disabled' : ''}>${doZapisu ? `Zapisz ${doZapisu} ${odmiana(doZapisu, 'paragon', 'paragony', 'paragonów')}` : 'Wszystko jest już zapisane'}</button>
      <button type="button" class="drugorzedny" data-akcja="wyczysc-wklejke">Wyczyść</button>
    </div>`;
}

function renderWklej() {
  $('#widok').innerHTML = `
  <section class="ekran ustawienia sprzedaz-wklej">
    <div class="naglowek-sekcji"><h1>Wklej sprzedaż z Subiektu</h1><a class="przycisk-maly drugorzedny akcja-naglowka" href="#sprzedaz">Wróć do sprzedaży</a></div>
    <div class="karta-ustawien">
      <ol class="kroki-wklejania">
        <li>W Subiekcie (INCO albo OFI) uruchom zestawienie <b>Sprzedaż do aplikacji</b> i wybierz okres.</li>
        <li>Kliknij w wynik, zaznacz wszystko (<kbd>Ctrl</kbd>+<kbd>A</kbd>) i skopiuj (<kbd>Ctrl</kbd>+<kbd>C</kbd>).</li>
        <li>Wklej poniżej (<kbd>Ctrl</kbd>+<kbd>V</kbd>) albo wybierz zapisany plik.</li>
      </ol>
      <label class="pole"><span class="etykieta">Wynik zestawienia</span>
        <textarea name="sgt" rows="6" spellcheck="false" placeholder="Wklej tutaj…">${esc(stan.tekst)}</textarea></label>
      <label class="pole"><span class="etykieta">albo plik (.txt, .csv)</span>
        <input type="file" name="plik-sgt" accept=".txt,.csv,.tsv,text/plain,text/csv"></label>
      <p class="podpowiedz">Ponowne wklejenie tego samego okresu niczego nie zdubluje: paragony bez zmian zostaną pominięte, a poprawione w Subiekcie – zaktualizowane.</p>
    </div>
    <div class="karta-ustawien" id="podglad-sgt" ${stan.wynik ? '' : 'hidden'}><h2>Podgląd</h2>${htmlPodgladu()}</div>
  </section>`;
}

function odswiezPodglad() {
  stan.wynik = stan.tekst.trim() ? przeanalizuj(stan.tekst) : null;
  const el = $('#podglad-sgt');
  if (!el) return;
  el.hidden = !stan.wynik;
  el.innerHTML = `<h2>Podgląd</h2>${htmlPodgladu()}`;
}

/** Pliki z Windows bywają w UTF-16 albo w stronie kodowej 1250 – próbujemy po kolei. */
async function czytajPlik(plik) {
  const bajty = new Uint8Array(await plik.arrayBuffer());
  if (bajty[0] === 0xFF && bajty[1] === 0xFE) return new TextDecoder('utf-16le').decode(bajty);
  if (bajty[0] === 0xFE && bajty[1] === 0xFF) return new TextDecoder('utf-16be').decode(bajty);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bajty); } catch { return new TextDecoder('windows-1250').decode(bajty); }
}

async function zapiszSprzedaz(przycisk) {
  const w = stan.wynik;
  if (!w || !w.dokumenty.length) return;
  przycisk.disabled = true;
  try {
    await sync.zapiszWiele([
      { karta: 'SPRZEDAZ_SGT', wiersze: w.dokumenty },
      { karta: 'SPRZEDAZ_SGT_POZ', wiersze: w.pozycje },
    ]);
    await wczytajDane();
    toast(`Zapisano ${w.dokumenty.length} ${odmiana(w.dokumenty.length, 'paragon', 'paragony', 'paragonów')} (${[...w.podmioty].join(', ')}).`, 'ok');
    stan.okres = 'wlasny';
    stan.od = w.od.slice(0, 7) + '-01';
    stan.do = w.do;
    if (w.od.slice(0, 7) === w.do.slice(0, 7)) stan.do = dodajDni(przesunDate(stan.od, 'miesiąc', 1), -1);
    stan.podmioty.clear(); stan.magazyny.clear(); stan.formy.clear();
    stan.tekst = ''; stan.wynik = null;
    location.hash = '#sprzedaz';
  } catch (e) {
    przycisk.disabled = false;
    toast('Nie udało się zapisać: ' + e.message, 'blad', 7000);
  }
}

// ───────────────────────── zdarzenia ─────────────────────────

let trybWklejania = false;

function render(arg) {
  trybWklejania = arg === 'wklej';
  if (trybWklejania) renderWklej(); else renderRaport();
}

function przerysuj() {
  const y = window.scrollY;
  render(trybWklejania ? 'wklej' : null);
  window.scrollTo(0, y);
}

function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'zapisz-sgt') { zapiszSprzedaz(b); return; }
  if (akcja === 'wyczysc-wklejke') { stan.tekst = ''; stan.wynik = null; przerysuj(); return; }
  if (akcja === 'okres') { stan.okres = v; stan.ileParagonow = 30; }
  else if (akcja === 'panel') stan.panel = !stan.panel;
  else if (akcja === 'wyczysc') { stan.podmioty.clear(); stan.magazyny.clear(); stan.formy.clear(); }
  else if (akcja === 'wiecej-paragonow') stan.ileParagonow += 50;
  else if (akcja.startsWith('f-')) { const z = stan[akcja.slice(2)]; if (z.has(v)) z.delete(v); else z.add(v); }
  else return;
  przerysuj();
}

let zegar = null;
function wejscie(e) {
  if (e.target.name !== 'sgt') return;
  stan.tekst = e.target.value;
  stan.plik = '';
  clearTimeout(zegar);
  zegar = setTimeout(odswiezPodglad, 250);
}

async function zmianaPola(e) {
  const t = e.target;
  if (t.name === 'plik-sgt' && t.files?.[0]) {
    stan.tekst = await czytajPlik(t.files[0]);
    stan.plik = t.files[0].name;
    $('textarea[name="sgt"]').value = stan.tekst;
    odswiezPodglad();
    return;
  }
  if (t.name === 'od') stan.od = t.value;
  else if (t.name === 'do') stan.do = t.value;
  else return;
  przerysuj();
}

export const ekran = { render, klik, wejscie, zmiana: zmianaPola };
