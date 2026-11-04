// Ekran „Transakcje”: lista z kontem przy każdej transakcji, filtry, zaznaczanie kilku pozycji, suma i masowa edycja.

import * as sync from './sync.js';
import { $, $$, esc, zaokr, kwotaTxt, dataLok, dataSlownie, nazwaMiesiaca, odmiana, toast, okno, bezSkoku } from './util.js';
import {
  dane, wczytajDane, konta, kolorKonta, glowne, podrzedne, podmioty, ikona, kolorKategorii, czyPrzeks, czyPozyczkowa,
  czyZakupZaMnie, kierunek, kwotaPLN, czekaNaWysylke, grupy, zalaczniki, aktywneBudzety, aktywneCele, okresBudzetu,
  kategorieBudzetu, RODZAJE_POZYCZEK, PRYWATNE, czyPrywatna, kluczPodmiotu, nazwaPodmiotu, czyKorekta,
} from './dane.js';
import { czyWplywDoRozliczenia, zostaloWplywu, rozliczonoTransakcji } from './rozliczenia.js';
import { ikonaSvg } from './ikony.js';

const RODZAJE = [['wydatki', 'Wydatki'], ['wplywy', 'Wpływy'], ['przeksiegowania', 'Przeksięgowania i wymiany'], ['pozyczki', 'Pożyczki i spłaty']];
const STATUSY = [['oczekuje na wyciąg', 'Czeka na wyciąg'], ['potwierdzona', 'Potwierdzona'], ['bez ruchu na koncie', 'Bez ruchu na koncie']];

export const filtry = {
  zakres: 'miesiac', miesiac: dataLok().slice(0, 7), rok: dataLok().slice(0, 4),
  rodzaje: new Set(), konta: new Set(), kategorie: new Set(), podmioty: new Set(), statusy: new Set(),
  budzet: '', cel: '', zalaczniki: false, szukaj: '', anulowane: false,
};
let panel = false;
let zaznaczanie = false;
const zaznaczone = new Set();
let widoczneGrupy = [];

export function ustawFiltrBudzetu(id) {
  const b = dane.budzety.find(x => x.id === id);
  if (b?.rodzaj === 'cel') { filtry.cel = id; filtry.budzet = ''; filtry.zakres = 'wszystko'; }
  else {
    filtry.budzet = id; filtry.cel = '';
    if (b?.rodzaj === 'projekt') filtry.zakres = 'wszystko';
  }
}

function liczbaFiltrow() {
  return filtry.rodzaje.size + filtry.konta.size + filtry.kategorie.size + filtry.podmioty.size + filtry.statusy.size
    + (filtry.budzet ? 1 : 0) + (filtry.cel ? 1 : 0) + (filtry.zalaczniki ? 1 : 0) + (filtry.anulowane ? 1 : 0);
}

function rodzajGrupy(g) {
  if (g.rodzaj === 'przeksiegowanie' || g.rodzaj === 'wymiana') return 'przeksiegowania';
  if (g.rodzaj === 'pozyczka' && !czyZakupZaMnie(g.glowna)) return 'pozyczki';
  return g.glowna.typ === 'wpływ' ? 'wplywy' : 'wydatki';
}

function pasujeDoBudzetu(t, b) {
  if (b.rodzaj === 'projekt') return t.budzet === b.id;
  const [od, do_] = okresBudzetu(b, t.data_operacji);
  return t.typ === 'wydatek' && kategorieBudzetu(b).includes(t.kategoria) && t.data_operacji >= od && t.data_operacji <= do_
    && (!b.podmiot || t.podmiot === b.podmiot);
}

function wZakresie(t) {
  const d = String(t.data_operacji || '');
  if (filtry.zakres === 'miesiac') return d.startsWith(filtry.miesiac);
  if (filtry.zakres === 'rok') return d.startsWith(filtry.rok);
  return true;
}

function pasuje(g) {
  const t = g.glowna;
  const czesci = g.czesci;
  if (!filtry.anulowane && czesci.every(c => c.status === 'anulowana')) return false;
  if (filtry.rodzaje.size && !filtry.rodzaje.has(rodzajGrupy(g))) return false;
  if (filtry.konta.size && !czesci.some(c => filtry.konta.has(c.konto))) return false;
  if (filtry.kategorie.size && !czesci.some(c => filtry.kategorie.has(c.kategoria) || filtry.kategorie.has(c.zrodlo_przychodu))) return false;
  if (filtry.podmioty.size && !filtry.podmioty.has(kluczPodmiotu(t))) return false;
  if (filtry.statusy.size && !filtry.statusy.has(t.status)) return false;
  if (filtry.zalaczniki && !zalaczniki(t.zalacznik).length) return false;
  if (filtry.cel && !czesci.some(c => c.cel === filtry.cel)) return false;
  if (filtry.budzet) {
    const b = dane.budzety.find(x => x.id === filtry.budzet);
    if (b && !czesci.some(c => pasujeDoBudzetu(c, b))) return false;
  }
  const q = filtry.szukaj.trim().toLowerCase();
  if (q && !czesci.some(c => [c.kontrahent, c.kategoria, c.podkategoria, c.zrodlo_przychodu, c.opis, c.tagi, c.nr_dokumentu, c.konto, String(c.kwota)]
    .some(x => String(x || '').toLowerCase().includes(q)))) return false;
  return true;
}

function tytulOkresu() {
  if (filtry.zakres === 'miesiac') return nazwaMiesiaca(filtry.miesiac);
  if (filtry.zakres === 'rok') return `Rok ${filtry.rok}`;
  return 'Wszystkie';
}

/** Znak kwoty grupy do sumowania: wpływ +, wydatek −, przeksięgowanie 0. */
function znak(g) {
  if (g.rodzaj === 'przeksiegowanie' || g.rodzaj === 'wymiana') return 0;
  return kierunek(g.glowna) === 'wpływ' ? 1 : -1;
}

function sumaZaznaczonych() {
  const sumy = {};
  let przeks = 0;
  widoczneGrupy.filter(g => zaznaczone.has(g.glowna.id)).forEach(g => {
    const z = znak(g);
    if (!z) { przeks++; return; }
    const w = g.glowna.waluta || 'PLN';
    sumy[w] = zaokr((sumy[w] || 0) + z * g.kwota);
  });
  const tekst = Object.entries(sumy).map(([w, v]) => (v > 0 ? '+' : v < 0 ? '−' : '') + kwotaTxt(Math.abs(v), w)).join(', ') || kwotaTxt(0);
  return { tekst, przeks };
}

export function render() {
  const wOkresie = dane.transakcje.filter(wZakresie);
  widoczneGrupy = grupy(wOkresie).filter(pasuje)
    .sort((a, b) => String(b.glowna.data_operacji).localeCompare(String(a.glowna.data_operacji))
      || String(b.glowna.utworzono || '').localeCompare(String(a.glowna.utworzono || '')));
  [...zaznaczone].forEach(id => { if (!widoczneGrupy.some(g => g.glowna.id === id)) zaznaczone.delete(id); });

  let wplywy = 0, wydatki = 0, bezKursu = 0, czeka = 0;
  const poz = { 'pożyczka-udzielona': 0, 'pożyczka-otrzymana': 0, 'spłata-otrzymana': 0, 'spłata-oddana': 0 };
  const zPrywatnymi = filtry.podmioty.has(PRYWATNE);
  let prywatnych = 0;
  widoczneGrupy.forEach(g => g.czesci.forEach(t => {
    if (t.status === 'anulowana' || czyPrzeks(t) || czyKorekta(t)) return;
    if (czyPrywatna(t) && !zPrywatnymi) { prywatnych++; return; }
    if (t.status === 'oczekuje na wyciąg') czeka++;
    const k = kwotaPLN(t);
    if (k === null) { bezKursu++; return; }
    if (czyPozyczkowa(t)) poz[t.typ] += k;
    else if (t.typ === 'wpływ') wplywy += k;
    else if (t.typ === 'wydatek') wydatki += k;
  }));
  const wynik = wplywy - wydatki;
  const jestPozyczek = Object.values(poz).some(v => v);
  const nFiltrow = liczbaFiltrow();

  const dni = new Map();
  widoczneGrupy.forEach(g => {
    const d = g.glowna.data_operacji;
    if (!dni.has(d)) dni.set(d, []);
    dni.get(d).push(g);
  });

  $('#widok').innerHTML = `
  <section class="ekran lista ${zaznaczanie ? 'tryb-zaznaczania' : ''}">
    <div class="naglowek-listy">
      <div class="miesiac">
        ${filtry.zakres !== 'wszystko' ? '<button type="button" data-akcja="okres" data-v="-1" aria-label="Poprzedni okres">‹</button>' : ''}
        <h1>${esc(tytulOkresu())}</h1>
        ${filtry.zakres !== 'wszystko' ? '<button type="button" data-akcja="okres" data-v="1" aria-label="Następny okres">›</button>' : ''}
        <div class="przelacznik-zakresu chipy male">${[['miesiac', 'Miesiąc'], ['rok', 'Rok'], ['wszystko', 'Wszystko']].map(([z, e]) =>
          `<button type="button" class="chip" data-akcja="zakres" data-v="${z}" aria-pressed="${filtry.zakres === z}">${e}</button>`).join('')}</div>
      </div>
      <dl class="podsumowanie">
        <div class="plus"><dt>Wpływy</dt><dd>${esc(kwotaTxt(wplywy))}</dd></div>
        <div class="minus"><dt>Wydatki</dt><dd>${esc(kwotaTxt(wydatki))}</dd></div>
        <div class="${wynik < 0 ? 'minus' : 'plus'}"><dt>Wynik</dt><dd>${esc(kwotaTxt(wynik))}</dd></div>
      </dl>
      <p class="uwagi-podsumowania">${[
        nFiltrow || filtry.szukaj ? 'Według filtrów' : '',
        zPrywatnymi ? 'Bez przeksięgowań, pożyczek i anulowanych' : 'Bez prywatnych, przeksięgowań, pożyczek i anulowanych',
        czeka ? `${czeka} ${odmiana(czeka, 'transakcja czeka', 'transakcje czekają', 'transakcji czeka')} na wyciąg` : '',
        bezKursu ? `Niewliczone, bo czekają na kurs NBP: ${bezKursu}` : '',
      ].filter(Boolean).map(esc).join('. ')}.${jestPozyczek ? `<br>Pożyczki: udzielone ${esc(kwotaTxt(poz['pożyczka-udzielona']))}, otrzymane ${esc(kwotaTxt(poz['pożyczka-otrzymana']))}; zwroty do mnie ${esc(kwotaTxt(poz['spłata-otrzymana']))}, moje spłaty ${esc(kwotaTxt(poz['spłata-oddana']))}.` : ''}</p>
      <div class="filtry">
        <input type="search" name="szukaj" value="${esc(filtry.szukaj)}" placeholder="Szukaj: tytuł, opis, kwota" aria-label="Szukaj">
        <button type="button" class="drugorzedny przycisk-ikona" data-akcja="panel" aria-expanded="${panel}">${ikonaSvg('filtr')} Filtry${nFiltrow ? ` <span class="licznik">${nFiltrow}</span>` : ''}</button>
        <button type="button" class="drugorzedny" data-akcja="zaznaczanie" aria-pressed="${zaznaczanie}">${zaznaczanie ? 'Zakończ zaznaczanie' : 'Zaznacz'}</button>
      </div>
      ${panel ? panelFiltrow() : ''}
    </div>
    ${dni.size ? [...dni.entries()].map(([d, lst]) => `
      <section class="dzien">
        <h2>${esc(dataSlownie(d))}</h2>
        <ul>${lst.map(wiersz).join('')}</ul>
      </section>`).join('') : `
      <div class="pusto-duze">
        <p>${wOkresie.length ? 'Nic nie pasuje do filtrów.' : 'W tym okresie nie ma transakcji.'}</p>
        ${nFiltrow ? '<button type="button" class="przycisk" data-akcja="wyczysc">Wyczyść filtry</button>' : '<a class="przycisk" href="#dodaj">Dodaj transakcję</a>'}
      </div>`}
    ${zaznaczanie ? paskiZaznaczenia() : ''}
  </section>`;
}

function grupaChipow(nazwa, tytul, opcje, wybrane) {
  return `<fieldset class="grupa-filtru"><legend>${esc(tytul)}</legend><div class="chipy male">${opcje.map(([v, e, kolor]) =>
    `<button type="button" class="chip ${kolor ? 'konto-chip' : ''}" ${kolor ? `style="--k:${esc(kolor)}"` : ''} data-akcja="f-${nazwa}" data-v="${esc(v)}" aria-pressed="${wybrane.has(v)}">${esc(e)}</button>`).join('')}</div></fieldset>`;
}

function panelFiltrow() {
  const kategorie = [...glowne('wydatek').map(k => [k.nazwa, k.nazwa]), ...glowne('wpływ').map(k => [k.nazwa, k.nazwa + ' (wpływ)'])];
  const budzety = aktywneBudzety().filter(b => b.rodzaj !== 'cel');
  const cele = aktywneCele();
  return `<div class="panel-filtrow">
    ${grupaChipow('rodzaje', 'Rodzaj', RODZAJE, filtry.rodzaje)}
    ${grupaChipow('konta', 'Konta', konta().map(k => [k.nazwa, k.nazwa, k.kolor]), filtry.konta)}
    ${grupaChipow('kategorie', 'Kategorie', kategorie, filtry.kategorie)}
    ${grupaChipow('podmioty', 'Dotyczy', [...podmioty(), ''].map(p => [p, nazwaPodmiotu(p)]), filtry.podmioty)}
    ${grupaChipow('statusy', 'Status', STATUSY, filtry.statusy)}
    <div class="rzad">
      ${budzety.length ? `<label class="pole"><span class="etykieta">Budżet</span><select name="f-budzet">
        <option value="">Wszystkie</option>${budzety.map(b => `<option value="${esc(b.id)}" ${filtry.budzet === b.id ? 'selected' : ''}>${esc(b.nazwa)}</option>`).join('')}</select></label>` : ''}
      ${cele.length ? `<label class="pole"><span class="etykieta">Cel</span><select name="f-cel">
        <option value="">Wszystkie</option>${cele.map(b => `<option value="${esc(b.id)}" ${filtry.cel === b.id ? 'selected' : ''}>${esc(b.nazwa)}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="chipy male">
      <label class="przelacznik"><input type="checkbox" name="f-zalaczniki" ${filtry.zalaczniki ? 'checked' : ''}> Tylko z załącznikiem</label>
      <label class="przelacznik"><input type="checkbox" name="f-anulowane" ${filtry.anulowane ? 'checked' : ''}> Pokaż anulowane</label>
    </div>
    <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="wyczysc">Wyczyść filtry</button>
      <button type="button" data-akcja="panel">Gotowe</button></div>
  </div>`;
}

function paskiZaznaczenia() {
  const n = zaznaczone.size;
  const s = sumaZaznaczonych();
  return `<div class="pasek-zaznaczenia" role="region" aria-label="Zaznaczone transakcje">
    <div class="suma-zaznaczenia"><b>${n ? `Zaznaczono ${n}` : 'Dotknij transakcji, aby je zaznaczyć'}</b>
      ${n ? `<span>Suma: ${esc(s.tekst)}${s.przeks ? `, przeksięgowania pominięte (${s.przeks})` : ''}</span>` : ''}</div>
    <div class="przyciski">
      <button type="button" class="drugorzedny" data-akcja="zaznacz-wszystkie">${n === widoczneGrupy.length && n ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}</button>
      <button type="button" data-akcja="masowa-edycja" ${n ? '' : 'disabled'}>Edytuj zaznaczone</button>
      <button type="button" class="niebezpieczny" data-akcja="masowe-anulowanie" ${n ? '' : 'disabled'}>Anuluj</button>
    </div>
  </div>`;
}

function wiersz(g) {
  const t = g.glowna;
  let tytul, kwota, druga = '', klasa, ik, tlo, etykiety = [], cel = `#edytuj/${encodeURIComponent(t.id)}`;
  const kontoChip = k => (k ? `<span class="etykieta-konta" style="--k:${esc(kolorKonta(k))}">${esc(k)}</span>` : '');
  const katChip = (k, typ, pod) => (k ? `<span class="etykieta-kategorii" style="--tlo:${esc(kolorKategorii(k, typ))}">${esc(k)}${pod ? ' › ' + esc(pod) : ''}</span>` : '');
  if (g.rodzaj === 'przeksiegowanie' || g.rodzaj === 'wymiana') {
    tytul = g.rodzaj === 'wymiana' ? 'Wymiana walut' : 'Przeksięgowanie';
    etykiety = [kontoChip(g.z?.konto), '<span class="strzalka">→</span>', kontoChip(g.na?.konto)];
    kwota = kwotaTxt(Number(g.z.kwota), g.z.waluta);
    if (g.na && g.na.waluta !== g.z.waluta) druga = '→ ' + kwotaTxt(Number(g.na.kwota), g.na.waluta);
    klasa = 'przeks'; ik = g.rodzaj === 'wymiana' ? '💱' : '⇄'; tlo = '#D3E4E2';
  } else if (g.rodzaj === 'pozyczka') {
    const p = dane.pozyczki.find(x => x.id === t.pozyczka_id);
    cel = `#pozyczka/${encodeURIComponent(t.pozyczka_id)}`;
    const plus = p ? RODZAJE_POZYCZEK[p.rodzaj]?.strona === 'do-odzyskania' : t.typ.includes('udzielona') || t.typ === 'spłata-otrzymana';
    const osoba = t.kontrahent || p?.osoba || '';
    if (czyZakupZaMnie(t)) {
      tytul = t.opis || t.kategoria || 'Zakup';
      etykiety = [`<span class="etykieta-winien">zapłacił(a) ${esc(osoba)}</span>`, katChip(t.kategoria, 'wydatek', t.podkategoria)];
    } else {
      tytul = {
        'pożyczka-udzielona': `Pożyczka dla: ${osoba}`, 'pożyczka-otrzymana': `Pożyczka od: ${osoba}`,
        'spłata-otrzymana': `Zwrot od: ${osoba}`, 'spłata-oddana': `Spłata dla: ${osoba}`,
      }[t.typ] || osoba;
      etykiety = [kontoChip(t.konto)];
    }
    kwota = (kierunek(t) === 'wpływ' ? '+' : '−') + kwotaTxt(g.kwota, t.waluta);
    klasa = plus ? 'pozyczka-plus' : 'pozyczka-minus';
    ik = plus ? '↗' : '↙'; tlo = plus ? '#D5E3DA' : '#EBD6DA';
  } else {
    const typ = t.typ === 'wpływ' ? 'wpływ' : 'wydatek';
    const kat = c => (typ === 'wpływ' ? c.zrodlo_przychodu : c.kategoria);
    tytul = t.kontrahent || (g.rodzaj === 'podzial' ? 'Transakcja podzielona' : kat(t)) || 'Bez kategorii';
    etykiety = [kontoChip(t.konto), ...(g.rodzaj === 'podzial'
      ? g.czesci.map(c => katChip(`${kat(c)} ${kwotaTxt(Number(c.kwota), c.waluta)}`, typ))
      : [katChip(kat(t), typ, t.podkategoria)])];
    kwota = (typ === 'wpływ' ? '+' : '−') + kwotaTxt(g.kwota, t.waluta);
    klasa = typ === 'wpływ' ? 'plus' : 'minus';
    ik = ikona(kat(t), typ); tlo = kolorKategorii(kat(t), typ);
  }
  if (kluczPodmiotu(t)) etykiety.push(`<span class="etykieta-podmiotu ${czyPrywatna(t) ? 'prywatna' : ''}">${esc(t.podmiot)}</span>`);
  const budzet = t.budzet && dane.budzety.find(b => b.id === t.budzet);
  const celB = g.czesci.map(c => c.cel).find(Boolean);
  const celN = celB && dane.budzety.find(b => b.id === celB);
  const zal = zalaczniki(t.zalacznik).length;
  const znaczniki = [
    budzet ? `<span class="znacznik">budżet: ${esc(budzet.nazwa)}</span>` : '',
    celN ? `<span class="znacznik">cel: ${esc(celN.nazwa)}</span>` : '',
    t.status === 'oczekuje na wyciąg' ? '<span class="znacznik czeka">czeka na wyciąg</span>' : '',
    t.status === 'potwierdzona' ? '<span class="znacznik potw">potwierdzona</span>' : '',
    t.status === 'anulowana' ? '<span class="znacznik anul">anulowana</span>' : '',
    t.planowana_id ? '<span class="znacznik">z planu</span>' : '',
    czyKorekta(t) ? '<span class="znacznik">korekta salda</span>' : '',
    czyWplywDoRozliczenia(t) && zostaloWplywu(t) > 0.004 && dane.sprzedaz.length ? `<span class="znacznik czeka">do rozliczenia ${esc(kwotaTxt(zostaloWplywu(t), t.waluta))}</span>` : '',
    t.typ === 'wpływ' && rozliczonoTransakcji(t.id) > 0 && zostaloWplywu(t) <= 0.004 ? '<span class="znacznik potw">rozliczona z paragonem</span>' : '',
    zal ? `<span class="znacznik">${zal} ${odmiana(zal, 'załącznik', 'załączniki', 'załączników')}</span>` : '',
    g.czesci.some(czekaNaWysylke) ? '<span class="znacznik wysylka">do wysłania</span>' : '',
  ].join('');
  const wybrana = zaznaczone.has(t.id);
  return `<li class="${t.status === 'anulowana' ? 'anulowana' : ''} ${klasa.startsWith('pozyczka') ? klasa : ''} ${czyPrywatna(t) ? 'prywatna' : ''} ${wybrana ? 'wybrana' : ''}">
    <a href="${cel}" data-grupa="${esc(t.id)}" ${zaznaczanie ? `role="checkbox" aria-checked="${wybrana}"` : ''}>
      ${zaznaczanie ? `<span class="pole-wyboru" aria-hidden="true">${wybrana ? '✓' : ''}</span>` : ''}
      <span class="ikona" style="--tlo:${esc(tlo)}" aria-hidden="true">${esc(ik)}</span>
      <span class="srodek"><span class="tytul">${esc(tytul)}</span>
        <span class="etykiety">${etykiety.filter(Boolean).join('')}</span>
        ${t.opis && g.rodzaj !== 'pozyczka' ? `<span class="opis"><i>${esc(t.opis)}</i></span>` : ''}
        ${znaczniki ? `<span class="znaczniki">${znaczniki}</span>` : ''}</span>
      <span class="kwota-wiersza ${klasa}">${esc(kwota)}${druga ? `<small>${esc(druga)}</small>` : ''}</span>
    </a></li>`;
}

// ── masowe operacje ──

async function masowaEdycja() {
  const wybrane = widoczneGrupy.filter(g => zaznaczone.has(g.glowna.id));
  const opcje = (l, pusty = 'Bez zmian') => `<option value="">${pusty}</option>${l}`;
  const katOpcje = typ => glowne(typ).map(k => [`<option value="${esc(k.nazwa + '||')}">${esc(k.nazwa)}</option>`,
    ...podrzedne(typ, k.nazwa).map(p => `<option value="${esc(k.nazwa + '||' + p.nazwa)}">${esc(k.nazwa + ' › ' + p.nazwa)}</option>`)].join('')).join('');
  const ok = await okno(`Edytuj ${wybrane.length} ${odmiana(wybrane.length, 'transakcję', 'transakcje', 'transakcji')}`, `
    <p class="podpowiedz">Zmienią się tylko pola, które wybierzesz. Przeksięgowań i pożyczek nie dotyczą kategoria i konto.</p>
    <div class="rzad">
      <label class="pole"><span class="etykieta">Kategoria wydatków</span><select name="m-kat-wyd">${opcje(katOpcje('wydatek'))}</select></label>
      <label class="pole"><span class="etykieta">Źródło przychodu</span><select name="m-kat-wpl">${opcje(katOpcje('wpływ'))}</select></label>
      <label class="pole"><span class="etykieta">Konto</span><select name="m-konto">${opcje(konta().map(k => `<option>${esc(k.nazwa)}</option>`).join(''))}</select></label>
      <label class="pole"><span class="etykieta">Dotyczy</span><select name="m-podmiot">${opcje(podmioty().map(p => `<option>${esc(p)}</option>`).join(''))}</select></label>
      <label class="pole"><span class="etykieta">Budżet</span><select name="m-budzet">${opcje(`<option value="-">Bez budżetu</option>${aktywneBudzety().filter(b => b.rodzaj === 'projekt').map(b => `<option value="${esc(b.id)}">${esc(b.nazwa)}</option>`).join('')}`)}</select></label>
      <label class="pole"><span class="etykieta">Cel</span><select name="m-cel">${opcje(`<option value="-">Bez celu</option>${aktywneCele().map(b => `<option value="${esc(b.id)}">${esc(b.nazwa)}</option>`).join('')}`)}</select></label>
      <label class="pole"><span class="etykieta">Data operacji</span><input type="date" name="m-data"></label>
      <label class="pole"><span class="etykieta">Status</span><select name="m-status">${opcje('<option>oczekuje na wyciąg</option><option>potwierdzona</option>')}</select></label>
    </div>
    <label class="pole"><span class="etykieta">Dodaj tag</span><input name="m-tag" autocomplete="off" placeholder="np. Kiermasz Koneser"></label>`,
  [{ etykieta: 'Wróć', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Zastosuj', wartosc: true, autofocus: true }]);
  if (!ok) return;
  const v = n => $(`#okno [name="${n}"]`).value;
  const zm = {
    katWyd: v('m-kat-wyd'), katWpl: v('m-kat-wpl'), konto: v('m-konto'), podmiot: v('m-podmiot'), budzet: v('m-budzet'),
    cel: v('m-cel'), data: v('m-data'), status: v('m-status'), tag: v('m-tag').trim(),
  };
  if (!Object.values(zm).some(Boolean)) { toast('Nie wybrano żadnej zmiany.', ''); return; }

  const wiersze = [];
  let pominiete = 0;
  for (const g of wybrane) {
    const zwykla = g.rodzaj === 'pojedyncza' || g.rodzaj === 'podzial';
    let dotyczy = false;
    const zmienione = g.czesci.filter(c => c.status !== 'anulowana' || g.czesci.every(x => x.status === 'anulowana')).map(c => {
      const n = { ...c };
      if (zwykla && c.typ === 'wydatek' && zm.katWyd && g.rodzaj === 'pojedyncza') { [n.kategoria, n.podkategoria] = zm.katWyd.split('||'); dotyczy = true; }
      if (zwykla && c.typ === 'wpływ' && zm.katWpl && g.rodzaj === 'pojedyncza') { n.zrodlo_przychodu = zm.katWpl.split('||')[0]; dotyczy = true; }
      // konto w innej walucie pomijamy – kwota musiałaby zmienić walutę
      const walKonta = zm.konto && konta().find(k => k.nazwa === zm.konto)?.waluta;
      if (zwykla && zm.konto && (!walKonta || walKonta === (c.waluta || 'PLN'))) { n.konto = zm.konto; dotyczy = true; }
      if (zm.podmiot && !czyPrzeks(c)) { n.podmiot = zm.podmiot; dotyczy = true; }
      if (zm.budzet && zwykla) { n.budzet = zm.budzet === '-' ? '' : zm.budzet; dotyczy = true; }
      if (zm.cel && (zwykla || c.typ === 'przeksięgowanie-wpływ')) { n.cel = zm.cel === '-' ? '' : zm.cel; dotyczy = true; }
      if (zm.data) { n.data_operacji = zm.data; if (n.waluta !== 'PLN') { n.kurs = ''; n.kwota_pln = ''; } dotyczy = true; }
      if (zm.status && c.status !== 'bez ruchu na koncie') { n.status = zm.status; dotyczy = true; }
      if (zm.tag) {
        const tagi = String(c.tagi || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!tagi.includes(zm.tag)) n.tagi = [...tagi, zm.tag].join(', ');
        dotyczy = true;
      }
      return n;
    });
    if (dotyczy) wiersze.push(...zmienione); else pominiete++;
  }
  if (!wiersze.length) { toast('Wybrane zmiany nie dotyczą zaznaczonych transakcji.', 'blad', 5000); return; }
  await sync.zapisz('TRANSAKCJE', wiersze);
  await wczytajDane();
  toast(`Zmieniono ${wybrane.length - pominiete} ${odmiana(wybrane.length - pominiete, 'pozycję', 'pozycje', 'pozycji')}${pominiete ? `, pominięto ${pominiete}, których zmiana nie dotyczy` : ''}.`, 'ok', 5000);
  zaznaczone.clear();
  bezSkoku(render);
}

async function masoweAnulowanie() {
  const wybrane = widoczneGrupy.filter(g => zaznaczone.has(g.glowna.id));
  const pozyczkowe = wybrane.filter(g => g.rodzaj === 'pozyczka');
  const reszta = wybrane.filter(g => g.rodzaj !== 'pozyczka');
  if (!reszta.length) { toast('Pożyczki i spłaty anuluje się na ekranie pożyczki.', 'blad', 5000); return; }
  const tak = await okno(`Anulować ${reszta.length} ${odmiana(reszta.length, 'transakcję', 'transakcje', 'transakcji')}?`,
    `<p>Zostaną w arkuszu ze statusem „anulowana”.${pozyczkowe.length ? ` Pożyczki i spłaty (${pozyczkowe.length}) pominę, bo anuluje się je na ekranie pożyczki.` : ''}</p>`,
    [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Anuluj transakcje', wartosc: true, klasa: 'niebezpieczny' }]);
  if (!tak) return;
  await sync.zapisz('TRANSAKCJE', reszta.flatMap(g => g.czesci.map(c => ({ ...c, status: 'anulowana' }))));
  await wczytajDane();
  toast(`Anulowano ${reszta.length}.`, 'ok');
  zaznaczone.clear();
  bezSkoku(render);
}

// ── zdarzenia ──

function przelacz(zbior, v) { if (zbior.has(v)) zbior.delete(v); else zbior.add(v); }

export async function klik(e) {
  const wierszEl = e.target.closest('a[data-grupa]');
  if (wierszEl && zaznaczanie) {
    e.preventDefault();
    przelacz(zaznaczone, wierszEl.dataset.grupa);
    const li = wierszEl.closest('li');
    const wyb = zaznaczone.has(wierszEl.dataset.grupa);
    li.classList.toggle('wybrana', wyb);
    wierszEl.setAttribute('aria-checked', String(wyb));
    wierszEl.querySelector('.pole-wyboru').textContent = wyb ? '✓' : '';
    const stary = $('.pasek-zaznaczenia');
    if (stary) stary.outerHTML = paskiZaznaczenia();
    return;
  }
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'okres') {
    if (filtry.zakres === 'rok') filtry.rok = String(Number(filtry.rok) + Number(v));
    else {
      const d = new Date(filtry.miesiac + '-15T12:00:00');
      d.setMonth(d.getMonth() + Number(v));
      filtry.miesiac = dataLok(d).slice(0, 7);
    }
  } else if (akcja === 'zakres') {
    filtry.zakres = v;
    if (v === 'rok') filtry.rok = filtry.miesiac.slice(0, 4);
  } else if (akcja === 'panel') panel = !panel;
  else if (akcja === 'zaznaczanie') { zaznaczanie = !zaznaczanie; zaznaczone.clear(); }
  else if (akcja === 'zaznacz-wszystkie') {
    if (zaznaczone.size === widoczneGrupy.length) zaznaczone.clear();
    else widoczneGrupy.forEach(g => zaznaczone.add(g.glowna.id));
  } else if (akcja === 'masowa-edycja') { await masowaEdycja(); return; }
  else if (akcja === 'masowe-anulowanie') { await masoweAnulowanie(); return; }
  else if (akcja === 'wyczysc') {
    ['rodzaje', 'konta', 'kategorie', 'podmioty', 'statusy'].forEach(k => filtry[k].clear());
    Object.assign(filtry, { budzet: '', cel: '', zalaczniki: false, anulowane: false, szukaj: '' });
  } else if (akcja.startsWith('f-')) przelacz(filtry[akcja.slice(2)], v);
  else return;
  bezSkoku(render);
}

export function zmiana(e) {
  const el = e.target;
  if (el.name === 'f-budzet') filtry.budzet = el.value;
  else if (el.name === 'f-cel') filtry.cel = el.value;
  else if (el.name === 'f-zalaczniki') filtry.zalaczniki = el.checked;
  else if (el.name === 'f-anulowane') filtry.anulowane = el.checked;
  else return;
  bezSkoku(render);
}

export function wejscie(e) {
  const el = e.target;
  if (el.name !== 'szukaj') return;
  filtry.szukaj = el.value;
  const poz = el.selectionStart;
  bezSkoku(render);
  const nowe = $('.lista input[name="szukaj"]');
  nowe.focus();
  nowe.setSelectionRange(poz, poz);
}

export const ekran = { render, klik, zmiana, wejscie };
