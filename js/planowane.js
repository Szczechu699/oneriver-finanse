// Ekrany „Planowane” (bilans, zaległe, rozliczone) i „Subskrypcje” (mapa kosztów).

import * as sync from './sync.js';
import { $, esc, zaokr, kwotaTxt, dataLok, dodajDni, przesunDate, roznicaDni, dataSlownie, dataKrotko, uuid, odmiana, toast, okno, bezSkoku } from './util.js';
import {
  dane, wczytajDane, konta, glowne, podmioty, kolorKonta, PRYWATNE, kluczPodmiotu, nazwaPodmiotu, kontoCelu, czyWirtualne, ikona, kolorKategorii, KOLORY, opisRytmu, aktywnePlanowane, nastepnyTermin, terminy,
  miesiecznyKoszt, kierunekPlanu, RODZAJE_POZYCZEK, stanPozyczki, statusDlaKonta,
} from './dane.js';
import { zaplacRate, cofnijSplate, doZaplatyRaty } from './pozyczki.js';
import { ikonaSvg } from './ikony.js';

// ── wspólne: zapłacone / cofnij / pomiń ──

export async function oznaczZaplacone(p) {
  if (p.rodzaj === 'rata') return zaplacRate(p);
  if (p.typ === 'przeksięgowanie') return odlozNaCel(p);
  const kwota = Number(p.kwota) || 0;
  const waluta = p.waluta || 'PLN';
  const t = {
    id: uuid(), typ: p.typ === 'wpływ' ? 'wpływ' : 'wydatek', id_pary: '', podzial_id: '', data_operacji: dataLok(),
    konto: p.konto, kwota, waluta, kurs: waluta === 'PLN' ? 1 : '', kwota_pln: waluta === 'PLN' ? kwota : '',
    kategoria: p.kategoria || '', podkategoria: p.podkategoria || '', zrodlo_przychodu: p.zrodlo_przychodu || '',
    kontrahent: p.kontrahent || p.nazwa || '', podmiot: p.podmiot || '', tagi: p.tagi || '', nr_dokumentu: '', opis: p.opis || '',
    zalacznik: '', budzet: p.budzet || '', cel: '', pozyczka_id: '', planowana_id: p.id, planowany_termin: p.nastepna_data,
    status: statusDlaKonta(p.konto), zrodlo: 'ręczny',
  };
  const nastepny = nastepnyTermin(p);
  const plan = nastepny ? { ...p, nastepna_data: nastepny } : { ...p, status: 'zakończona' };
  await sync.zapiszWiele([{ karta: 'TRANSAKCJE', wiersze: [t] }, { karta: 'PLANOWANE', wiersze: [plan] }]);
  await wczytajDane();
  return t;
}

/** Planowane odkładanie na cel: przeksięgowanie z konta na konto celu (zwykle Skarbonka). */
async function odlozNaCel(p) {
  const kwota = Number(p.kwota) || 0;
  const waluta = p.waluta || 'PLN';
  const para = uuid();
  const wirtualne = czyWirtualne(p.konto) || czyWirtualne(p.konto_docelowe);
  const noga = (typ, konto) => ({
    id: uuid(), typ, id_pary: para, podzial_id: '', data_operacji: dataLok(), konto, kwota, waluta,
    kurs: waluta === 'PLN' ? 1 : '', kwota_pln: waluta === 'PLN' ? kwota : '', kategoria: '', podkategoria: '', zrodlo_przychodu: '',
    kontrahent: '', podmiot: '', tagi: '', nr_dokumentu: '', opis: p.nazwa || '', zalacznik: '', budzet: '',
    cel: typ === 'przeksięgowanie-wpływ' ? p.budzet || '' : '', pozyczka_id: '',
    planowana_id: p.id, planowany_termin: p.nastepna_data,
    status: wirtualne ? 'bez ruchu na koncie' : statusDlaKonta(konto), zrodlo: 'ręczny',
  });
  const nogi = [noga('przeksięgowanie-wypływ', p.konto), noga('przeksięgowanie-wpływ', p.konto_docelowe)];
  const nastepny = nastepnyTermin(p);
  const plan = nastepny ? { ...p, nastepna_data: nastepny } : { ...p, status: 'zakończona' };
  await sync.zapiszWiele([{ karta: 'TRANSAKCJE', wiersze: nogi }, { karta: 'PLANOWANE', wiersze: [plan] }]);
  await wczytajDane();
  return nogi[1];
}

export async function cofnijZaplacone(t) {
  if (t.pozyczka_id) return cofnijSplate(t);
  const p = dane.planowane.find(x => x.id === t.planowana_id);
  const nogi = t.id_pary && t.typ.startsWith('przeksięgowanie') ? dane.transakcje.filter(x => x.id_pary === t.id_pary) : [t];
  const paczki = [{ karta: 'TRANSAKCJE', wiersze: nogi.map(x => ({ ...x, status: 'anulowana' })) }];
  if (p) {
    const termin = t.planowany_termin;
    const np = { ...p };
    if (p.status === 'zakończona') { np.status = 'aktywna'; if (termin) np.nastepna_data = termin; }
    else if (termin && termin < p.nastepna_data) np.nastepna_data = termin;
    paczki.push({ karta: 'PLANOWANE', wiersze: [np] });
  }
  await sync.zapiszWiele(paczki);
  await wczytajDane();
}

async function pomin(p) {
  const nastepny = nastepnyTermin(p);
  await sync.zapisz('PLANOWANE', [nastepny ? { ...p, nastepna_data: nastepny } : { ...p, status: 'zakończona' }]);
  await wczytajDane();
  toast(nastepny ? `Pominięto. Następny termin: ${dataSlownie(nastepny).toLowerCase()}.` : 'Pominięto ostatni termin, pozycja zakończona.', 'ok');
}

function kwotaPlanu(p) {
  if (p.rodzaj === 'rata') {
    const poz = dane.pozyczki.find(x => x.id === p.pozyczka_id);
    if (poz) return doZaplatyRaty(poz, p);
  }
  return Number(p.kwota) || 0;
}

function kategoriaPlanu(p) {
  return kierunekPlanu(p) === 'wpływ' && p.typ === 'wpływ' ? p.zrodlo_przychodu : p.kategoria;
}

function relatywnie(d) {
  const r = roznicaDni(d, dataLok());
  if (r === 0) return '';
  if (r > 0) return `za ${r} ${odmiana(r, 'dzień', 'dni', 'dni')}`;
  return `${-r} ${odmiana(-r, 'dzień', 'dni', 'dni')} po terminie`;
}

export function wierszPlanu(p) {
  if (p.typ === 'przeksięgowanie') return wierszOdlozenia(p);
  const rata = p.rodzaj === 'rata';
  const wplyw = kierunekPlanu(p) === 'wpływ';
  const kat = kategoriaPlanu(p);
  const opoz = p.nastepna_data < dataLok();
  const kwota = kwotaPlanu(p);
  const klasa = rata ? (wplyw ? 'pozyczka-plus' : 'pozyczka-minus') : '';
  const ik = rata ? (wplyw ? '↗' : '↙') : ikona(kat, wplyw ? 'wpływ' : 'wydatek');
  const tlo = rata ? (wplyw ? '#D5E3DA' : '#EBD6DA') : kolorKategorii(kat, wplyw ? 'wpływ' : 'wydatek');
  const href = rata ? `#pozyczka/${encodeURIComponent(p.pozyczka_id)}` : `#plan/${encodeURIComponent(p.id)}`;
  return `<li class="wiersz-planu ${klasa} ${opoz ? 'opozniona' : ''}">
    <a href="${href}">
      <span class="ikona" style="--tlo:${esc(tlo)}" aria-hidden="true">${esc(ik)}</span>
      <span class="srodek"><span class="tytul">${esc(p.nazwa || kat || p.kontrahent)}</span>
        <span class="etykiety">${p.konto ? `<span class="etykieta-konta" style="--k:${esc(kolorKonta(p.konto))}">${esc(p.konto)}</span>` : ''}
          ${kat ? `<span class="etykieta-kategorii" style="--tlo:${esc(kolorKategorii(kat, wplyw ? 'wpływ' : 'wydatek'))}">${esc(kat)}</span>` : ''}
          ${p.rodzaj === 'subskrypcja' ? '<span class="znacznik">subskrypcja</span>' : ''}</span></span>
      <span class="kwota-wiersza ${rata ? klasa : (wplyw ? 'plus' : 'minus')}">${wplyw ? '+' : '−'}${esc(kwotaTxt(kwota, p.waluta))}
        <small>${esc(opisRytmu(p))}</small></span>
    </a>
    <div class="akcje-planu">
      <button type="button" data-akcja="zaplacone" data-v="${esc(p.id)}">${wplyw ? 'Wpłynęło?' : 'Zapłać?'}</button>
      ${!rata && p.rodzaj !== 'jednorazowa' ? `<button type="button" class="drugorzedny" data-akcja="pomin" data-v="${esc(p.id)}">Pomiń ten termin</button>` : ''}
    </div>
  </li>`;
}

function wierszOdlozenia(p) {
  const cel = dane.budzety.find(b => b.id === p.budzet);
  return `<li class="wiersz-planu odlozenie ${p.nastepna_data < dataLok() ? 'opozniona' : ''}">
    <a href="${cel ? `#budzet/${encodeURIComponent(cel.id)}` : '#budzety'}">
      <span class="ikona" style="--tlo:#DDE8C6" aria-hidden="true">${ikonaSvg('cele')}</span>
      <span class="srodek"><span class="tytul">${esc(p.nazwa || 'Odkładanie na cel')}</span>
        <span class="etykiety"><span class="etykieta-konta" style="--k:${esc(kolorKonta(p.konto))}">${esc(p.konto)}</span>
          <span class="strzalka">→</span><span class="etykieta-konta" style="--k:${esc(kolorKonta(p.konto_docelowe))}">${esc(p.konto_docelowe)}</span></span></span>
      <span class="kwota-wiersza">${esc(kwotaTxt(Number(p.kwota), p.waluta))}<small>${esc(opisRytmu(p))}</small></span>
    </a>
    <div class="akcje-planu">
      <button type="button" data-akcja="zaplacone" data-v="${esc(p.id)}">Odłożone?</button>
      ${p.rodzaj !== 'jednorazowa' ? `<button type="button" class="drugorzedny" data-akcja="pomin" data-v="${esc(p.id)}">Pomiń ten termin</button>` : ''}
    </div>
  </li>`;
}

function wierszRozliczonej(t) {
  const p = dane.planowane.find(x => x.id === t.planowana_id);
  const wplyw = ['wpływ', 'spłata-otrzymana'].includes(t.typ);
  const odl = t.typ === 'przeksięgowanie-wpływ';
  return `<li class="wiersz-planu rozliczona">
    <a href="${t.pozyczka_id ? `#pozyczka/${encodeURIComponent(t.pozyczka_id)}` : odl && t.cel ? `#budzet/${encodeURIComponent(t.cel)}` : `#edytuj/${encodeURIComponent(t.id)}`}">
      <span class="ikona" style="--tlo:#E4E7E5" aria-hidden="true">✓</span>
      <span class="srodek"><span class="tytul">${esc(p?.nazwa || t.kontrahent || t.kategoria)}</span>
        <span class="opis">${esc(odl ? 'Odłożone' : wplyw ? 'Wpłynęło' : 'Zapłacone')} ${esc(dataSlownie(t.data_operacji).toLowerCase())}${t.planowany_termin ? `, termin ${esc(dataKrotko(t.planowany_termin))}` : ''}</span></span>
      <span class="kwota-wiersza">${odl ? '' : wplyw ? '+' : '−'}${esc(kwotaTxt(Number(t.kwota), t.waluta))}</span>
    </a>
    <div class="akcje-planu">
      <button type="button" class="znacznik-przycisk" data-akcja="cofnij" data-v="${esc(t.id)}" title="Cofnij rozliczenie">${esc(odl ? 'Odłożone' : wplyw ? 'Wpłynęło' : 'Zapłacone')}, cofnij</button>
    </div>
  </li>`;
}

// ── Planowane ──

const stan = {
  okres: 'miesiac', zakladka: 'wszystko', szukaj: '', panel: false,
  rodzaje: new Set(), konta: new Set(), kategorie: new Set(), podmioty: new Set(),
};
const OKRESY = [['miesiac', 'Do końca miesiąca'], ['30', '30 dni'], ['90', '3 miesiące'], ['365', '12 miesięcy'], ['wszystko', 'Wszystko']];
const RODZAJE_PLANU = [['wydatki', 'Wydatki'], ['wplywy', 'Wpływy'], ['subskrypcje', 'Subskrypcje'], ['raty', 'Raty pożyczek'], ['cele', 'Odkładanie na cele']];

function koniecOkresu() {
  const dzis = dataLok();
  if (stan.okres === 'miesiac') return dodajDni(przesunDate(dzis.slice(0, 7) + '-01', 'miesiąc', 1), -1);
  if (stan.okres === '30') return dodajDni(dzis, 30);
  if (stan.okres === '90') return przesunDate(dzis, 'miesiąc', 3);
  if (stan.okres === '365') return przesunDate(dzis, 'miesiąc', 12);
  return '9999-12-31';
}

function rodzajPlanu(p) {
  if (p.typ === 'przeksięgowanie') return 'cele';
  if (p.rodzaj === 'rata') return 'raty';
  if (p.rodzaj === 'subskrypcja') return 'subskrypcje';
  return kierunekPlanu(p) === 'wpływ' ? 'wplywy' : 'wydatki';
}

const liczbaFiltrow = () => stan.rodzaje.size + stan.konta.size + stan.kategorie.size + stan.podmioty.size;

/** Pozycje po filtrach (bez okresu, zakładki i szukania). */
function poFiltrach() {
  return aktywnePlanowane().filter(p =>
    (!stan.rodzaje.size || stan.rodzaje.has(rodzajPlanu(p)))
    && (!stan.konta.size || stan.konta.has(p.konto))
    && (!stan.kategorie.size || stan.kategorie.has(p.kategoria) || stan.kategorie.has(p.zrodlo_przychodu))
    && (!stan.podmioty.size || stan.podmioty.has(kluczPodmiotu(p))));
}

/** Bilans okresu: zaległe (termin minął, nierozliczone) + nadchodzące do końca okresu. */
function bilans(lista) {
  const dzis = dataLok();
  const koniec = stan.okres === 'wszystko' ? przesunDate(dzis, 'miesiąc', 12) : koniecOkresu();
  const b = { wplywy: 0, wydatki: 0, zalWpl: 0, zalWyd: 0, nZal: 0, obce: {}, srednio: 0, koniec };
  const zPrywatnymi = stan.podmioty.has(PRYWATNE);
  lista.forEach(p => {
    if (kierunekPlanu(p) === 'przesunięcie') return;          // odkładanie na cel nie zmienia bilansu
    if (p.podmiot === PRYWATNE && !zPrywatnymi) return;      // prywatne pomijamy w bilansie
    const w = p.waluta || 'PLN';
    const wplyw = kierunekPlanu(p) === 'wpływ';
    terminy(p, koniec).forEach((d, i) => {
      const kw = i === 0 ? kwotaPlanu(p) : Number(p.kwota) || 0;
      if (w !== 'PLN') { b.obce[w] = zaokr((b.obce[w] || 0) + (wplyw ? kw : -kw)); return; }
      if (d < dzis) { b.nZal++; if (wplyw) b.zalWpl += kw; else b.zalWyd += kw; }
      else if (wplyw) b.wplywy += kw; else b.wydatki += kw;
    });
    if (w === 'PLN') b.srednio += (wplyw ? 1 : -1) * miesiecznyKoszt(p);
  });
  return b;
}

function panelFiltrow() {
  const grupa = (nazwa, tytul, opcje, wybrane) => `<fieldset class="grupa-filtru"><legend>${esc(tytul)}</legend><div class="chipy male">${opcje.map(([v, e, kolor]) =>
    `<button type="button" class="chip ${kolor ? 'konto-chip' : ''}" ${kolor ? `style="--k:${esc(kolor)}"` : ''} data-akcja="f-${nazwa}" data-v="${esc(v)}" aria-pressed="${wybrane.has(v)}">${esc(e)}</button>`).join('')}</div></fieldset>`;
  return `<div class="panel-filtrow">
    ${grupa('rodzaje', 'Rodzaj', RODZAJE_PLANU, stan.rodzaje)}
    ${grupa('konta', 'Konta', konta().map(k => [k.nazwa, k.nazwa, k.kolor]), stan.konta)}
    ${grupa('kategorie', 'Kategorie', [...glowne('wydatek').map(k => [k.nazwa, k.nazwa]), ...glowne('wpływ').map(k => [k.nazwa, k.nazwa + ' (wpływ)'])], stan.kategorie)}
    ${grupa('podmioty', 'Dotyczy', [...podmioty(), ''].map(p => [p, nazwaPodmiotu(p)]), stan.podmioty)}
    <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="wyczysc">Wyczyść filtry</button>
      <button type="button" data-akcja="panel">Gotowe</button></div>
  </div>`;
}

export function renderPlanowane() {
  const dzis = dataLok();
  const koniec = koniecOkresu();
  const filtrowane = poFiltrach();
  const b = bilans(filtrowane);
  const wplywyRazem = b.wplywy + b.zalWpl;
  const wydatkiRazem = b.wydatki + b.zalWyd;
  const saldo = wplywyRazem - wydatkiRazem;
  const q = stan.szukaj.trim().toLowerCase();
  const wszystkie = filtrowane
    .filter(p => p.nastepna_data <= koniec)
    .filter(p => stan.zakladka === 'wszystko' || (stan.zakladka === 'zalegle' ? p.nastepna_data < dzis : p.nastepna_data >= dzis))
    .filter(p => !q || [p.nazwa, p.kontrahent, p.kategoria, p.zrodlo_przychodu, p.konto, p.opis].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b2) => String(a.nastepna_data).localeCompare(String(b2.nastepna_data)) || String(a.nazwa).localeCompare(String(b2.nazwa), 'pl'));
  const poOkresie = filtrowane.filter(p => p.nastepna_data > koniec).length;
  const dni = new Map();
  wszystkie.forEach(p => { if (!dni.has(p.nastepna_data)) dni.set(p.nastepna_data, []); dni.get(p.nastepna_data).push(p); });
  const rozliczone = dane.transakcje.filter(t => t.planowana_id && t.status !== 'anulowana' && t.data_operacji >= dodajDni(dzis, -31) && t.typ !== 'przeksięgowanie-wypływ')
    .sort((a, b2) => String(b2.data_operacji).localeCompare(String(a.data_operacji)) || String(b2.utworzono || '').localeCompare(String(a.utworzono || '')));
  const obce = Object.entries(b.obce).filter(([, v]) => Math.abs(v) >= 0.005);
  const nFiltrow = liczbaFiltrow();
  const opisOkresu = stan.okres === 'wszystko'
    ? `Bilans: zaległe i najbliższe 12 miesięcy`
    : `Bilans: zaległe i terminy od dziś do ${dataSlownie(koniec).toLowerCase()}`;

  $('#widok').innerHTML = `
  <section class="ekran planowane">
    <div class="naglowek-sekcji">
      <h1>Planowane</h1>
      <a class="przycisk" href="#dodaj/plan">Zaplanuj płatność</a>
    </div>
    <div class="chipy male okresy" role="group" aria-label="Okres">${OKRESY.map(([o, e]) =>
      `<button type="button" class="chip" data-akcja="okres" data-v="${o}" aria-pressed="${stan.okres === o}">${e}</button>`).join('')}</div>
    <dl class="podsumowanie cztery">
      <div class="plus"><dt>Wpływy</dt><dd>${esc(kwotaTxt(wplywyRazem))}</dd></div>
      <div class="minus"><dt>Wydatki</dt><dd>${esc(kwotaTxt(wydatkiRazem))}</dd></div>
      <div class="${saldo < 0 ? 'minus' : 'plus'} wyroznione"><dt>Bilans</dt><dd>${saldo > 0 ? '+' : ''}${esc(kwotaTxt(saldo))}</dd></div>
      <div class="${b.nZal ? 'minus' : ''}"><dt>W tym zaległe (${b.nZal})</dt><dd>${esc(kwotaTxt(b.zalWpl - b.zalWyd))}</dd></div>
    </dl>
    <p class="uwagi-podsumowania">${esc(opisOkresu)}, z ratami pożyczek, bez odkładania na cele${stan.podmioty.has(PRYWATNE) ? '' : ' i prywatnych'}${nFiltrow ? ', według filtrów' : ''}.${b.nZal ? ` Zaległe wpływy ${esc(kwotaTxt(b.zalWpl))}, zaległe wydatki ${esc(kwotaTxt(b.zalWyd))}.` : ''} Pozycje cykliczne średnio miesięcznie: ${b.srednio > 0 ? '+' : ''}${esc(kwotaTxt(zaokr(b.srednio)))}.${obce.length ? ` W innych walutach: ${obce.map(([w, v]) => (v > 0 ? '+' : '') + esc(kwotaTxt(v, w))).join(', ')}.` : ''}</p>
    <div class="filtry trzy">
      <div class="zakladki-ekranu" role="tablist">${[['wszystko', 'Wszystko'], ['nadchodzace', 'Nadchodzące'], ['zalegle', 'Zaległe']].map(([z, e]) =>
        `<button type="button" role="tab" data-akcja="zakladka" data-v="${z}" aria-selected="${stan.zakladka === z}">${e}</button>`).join('')}</div>
      <input type="search" name="szukaj" value="${esc(stan.szukaj)}" placeholder="Szukaj" aria-label="Szukaj w planowanych">
      <button type="button" class="drugorzedny przycisk-ikona" data-akcja="panel" aria-expanded="${stan.panel}">${ikonaSvg('filtr')} Filtry${nFiltrow ? ` <span class="licznik">${nFiltrow}</span>` : ''}</button>
    </div>
    ${stan.panel ? panelFiltrow() : ''}
    ${dni.size ? [...dni.entries()].map(([d, lst]) => `
      <section class="dzien ${d < dzis ? 'po-terminie' : ''}">
        <h2>${esc(dataSlownie(d))} <span>${esc(relatywnie(d))}</span></h2>
        <ul>${lst.map(wierszPlanu).join('')}</ul>
      </section>`).join('') : `
      <div class="pusto-duze"><p>${aktywnePlanowane().length ? 'W tym okresie nic nie pasuje.' : 'Nie masz jeszcze nic zaplanowanego. Przy wpisie wybierz „Nadchodząca” albo „Powtarzalna”, np. dla czynszu, ZUS czy abonamentu.'}</p></div>`}
    ${poOkresie && stan.okres !== 'wszystko' ? `<p class="uwagi-podsumowania">Później niż ${esc(dataSlownie(koniec).toLowerCase())}: ${poOkresie} ${odmiana(poOkresie, 'pozycja', 'pozycje', 'pozycji')}. <button type="button" class="link" data-akcja="okres" data-v="wszystko">Pokaż wszystkie</button></p>` : ''}
    ${rozliczone.length && stan.zakladka !== 'zalegle' ? `<section class="dzien rozliczone">
      <h2>Rozliczone w ostatnim miesiącu</h2>
      <ul>${rozliczone.map(wierszRozliczonej).join('')}</ul>
    </section>` : ''}
  </section>`;
}

// ── Subskrypcje ──

let widokSub = 'miesiecznie';

function kursPrzyblizony(w) {
  if (w === 'PLN' || !w) return 1;
  const t = dane.transakcje.filter(x => x.waluta === w && Number(x.kurs) > 0)
    .sort((a, b) => String(b.data_operacji).localeCompare(String(a.data_operacji)))[0];
  return t ? Number(t.kurs) : null;
}

/** Mapa prostokątów (algorytm „squarified”): wartości malejąco, wynik w tej samej kolejności. */
function mapaProstokatow(wartosci, W, H) {
  const suma = wartosci.reduce((s, v) => s + v, 0);
  if (!suma) return [];
  const pola = wartosci.map(v => (v * W * H) / suma);
  const wynik = [];
  let prost = { x: 0, y: 0, w: W, h: H };
  const najgorszy = (rzad, bok) => {
    const s = rzad.reduce((a, b) => a + b, 0);
    return Math.max((bok * bok * Math.max(...rzad)) / (s * s), (s * s) / (bok * bok * Math.min(...rzad)));
  };
  const uloz = rzad => {
    const s = rzad.reduce((a, b) => a + b, 0);
    if (prost.w >= prost.h) {
      const szer = s / prost.h;
      let y = prost.y;
      rzad.forEach(a => { wynik.push({ x: prost.x, y, w: szer, h: a / szer }); y += a / szer; });
      prost = { x: prost.x + szer, y: prost.y, w: prost.w - szer, h: prost.h };
    } else {
      const wys = s / prost.w;
      let x = prost.x;
      rzad.forEach(a => { wynik.push({ x, y: prost.y, w: a / wys, h: wys }); x += a / wys; });
      prost = { x: prost.x, y: prost.y + wys, w: prost.w, h: prost.h - wys };
    }
  };
  let rzad = [];
  let i = 0;
  while (i < pola.length) {
    const bok = Math.min(prost.w, prost.h);
    if (!rzad.length || najgorszy([...rzad, pola[i]], bok) <= najgorszy(rzad, bok)) { rzad.push(pola[i]); i++; }
    else { uloz(rzad); rzad = []; }
  }
  if (rzad.length) uloz(rzad);
  return wynik;
}

/** Termin, od którego liczy się bieżący okres subskrypcji (poprzedni termin przed najbliższym). */
function poczatekOkresu(p) {
  return przesunDate(p.nastepna_data, p.powtarzanie || 'miesiąc', -(Number(p.co_ile) || 1), p.data_start || p.nastepna_data);
}

const platnosciPlanu = id => dane.transakcje
  .filter(t => t.planowana_id === id && t.status !== 'anulowana')
  .sort((a, b) => String(b.planowany_termin || b.data_operacji).localeCompare(String(a.planowany_termin || a.data_operacji)));

function wierszSubskrypcji(p) {
  const dzis = dataLok();
  const aktywna = p.status === 'aktywna';
  const kat = p.kategoria;
  const ostatnia = platnosciPlanu(p.id)[0];
  const zaplaconaTeraz = aktywna && ostatnia && String(ostatnia.planowany_termin || ostatnia.data_operacji) >= poczatekOkresu(p)
    && p.nastepna_data >= dzis;
  const opoz = aktywna && p.nastepna_data < dzis;
  let stanTxt;
  if (!aktywna) stanTxt = `Zakończona${p.data_koniec ? ` (koniec ${dataKrotko(p.data_koniec)} ${p.data_koniec.slice(0, 4)})` : ''}${ostatnia ? `, ostatnia płatność ${dataKrotko(ostatnia.data_operacji)}` : ''}`;
  else if (zaplaconaTeraz) stanTxt = `✓ Zapłacono ${dataSlownie(ostatnia.data_operacji).toLowerCase()} · następna ${dataKrotko(p.nastepna_data)}`;
  else if (opoz) stanTxt = `Do zapłaty od ${dataKrotko(p.nastepna_data)} – ${relatywnie(p.nastepna_data)}`;
  else stanTxt = `Następna płatność ${dataSlownie(p.nastepna_data).toLowerCase()}${relatywnie(p.nastepna_data) ? ` (${relatywnie(p.nastepna_data)})` : ''}`;
  return `<li class="wiersz-planu wiersz-sub ${opoz ? 'opozniona' : ''} ${zaplaconaTeraz ? 'zaplacona' : ''} ${aktywna ? '' : 'zakonczona'}">
    <a href="#plan/${encodeURIComponent(p.id)}">
      <span class="ikona" style="--tlo:${esc(kolorKategorii(kat, 'wydatek'))}" aria-hidden="true">${esc(ikona(kat, 'wydatek'))}</span>
      <span class="srodek"><span class="tytul">${esc(p.nazwa || kat || p.kontrahent)}</span>
        <span class="etykiety">${p.konto ? `<span class="etykieta-konta" style="--k:${esc(kolorKonta(p.konto))}">${esc(p.konto)}</span>` : ''}
          ${p.podmiot ? `<span class="znacznik">${esc(p.podmiot)}</span>` : ''}</span>
        <span class="stan-sub">${esc(stanTxt)}</span></span>
      <span class="kwota-wiersza minus">−${esc(kwotaTxt(Number(p.kwota) || 0, p.waluta))}<small>${esc(opisRytmu(p))}</small></span>
    </a>
    <div class="akcje-planu">
      ${!aktywna ? `<button type="button" data-akcja="wznow" data-v="${esc(p.id)}">Wznów</button>`
        : zaplaconaTeraz ? `<button type="button" class="znacznik-przycisk" data-akcja="cofnij" data-v="${esc(ostatnia.id)}">Zapłacone, cofnij</button>`
        : `<button type="button" data-akcja="zaplacone" data-v="${esc(p.id)}">Zapłać?</button>
           <button type="button" class="drugorzedny" data-akcja="pomin" data-v="${esc(p.id)}">Pomiń ten termin</button>`}
    </div>
  </li>`;
}

/** Wznowienie zakończonej subskrypcji: bez daty końca, od terminu po ostatniej płatności. */
async function wznow(p) {
  const baza = { ...p, data_koniec: '', status: 'aktywna' };
  const ostatnia = platnosciPlanu(p.id)[0];
  const termin = ostatnia && (ostatnia.planowany_termin || ostatnia.data_operacji);
  if (termin && termin >= p.nastepna_data) baza.nastepna_data = nastepnyTermin(baza, termin);
  await sync.zapisz('PLANOWANE', [baza]);
  await wczytajDane();
  toast(`Wznowiono: ${p.nazwa}. Następna płatność ${dataSlownie(baza.nastepna_data).toLowerCase()}.`, 'ok');
}

export function renderSubskrypcje() {
  const wszystkie = dane.planowane.filter(p => p.rodzaj === 'subskrypcja' && p.status !== 'anulowana');
  const subs = wszystkie.filter(p => p.status === 'aktywna');
  const zakonczone = wszystkie.filter(p => p.status !== 'aktywna').sort((a, b) => String(a.nazwa).localeCompare(String(b.nazwa), 'pl'));
  const zaplacono = id => zaokr(platnosciPlanu(id).reduce((s, t) => s + (t.waluta === 'PLN' ? Number(t.kwota) : Number(t.kwota_pln) || 0), 0));
  const pozycje = (widokSub === 'zaplacono' ? wszystkie : subs).map(p => {
    const kurs = kursPrzyblizony(p.waluta || 'PLN');
    const mies = miesiecznyKoszt(p) * (kurs || 0);
    const wartosc = widokSub === 'miesiecznie' ? mies : widokSub === 'rocznie' ? mies * 12 : zaplacono(p.id);
    return { p, wartosc: zaokr(wartosc), mies: zaokr(mies), bezKursu: !kurs };
  }).sort((a, b) => b.wartosc - a.wartosc);
  const suma = zaokr(pozycje.reduce((s, x) => s + x.wartosc, 0));
  const naMapie = pozycje.filter(x => x.wartosc > 0);
  const proporcja = window.innerWidth < 720 ? 1.15 : 2.8;
  const prost = mapaProstokatow(naMapie.map(x => x.wartosc), 100 * proporcja, 100);
  const dzis = dataLok();
  const zaplaconeTeraz = p => {
    const o = platnosciPlanu(p.id)[0];
    return o && String(o.planowany_termin || o.data_operacji) >= poczatekOkresu(p) && p.nastepna_data >= dzis;
  };
  const doZaplaty = subs.filter(p => !zaplaconeTeraz(p)).sort((a, b) => String(a.nastepna_data).localeCompare(String(b.nastepna_data)));
  const zaplacone = subs.filter(zaplaconeTeraz).sort((a, b) => String(a.nastepna_data).localeCompare(String(b.nastepna_data)));
  const sekcja = (tytul, lista, klasa = '') => lista.length ? `
      <section class="dzien lista-sub ${klasa}">
        <h2>${esc(tytul)} <span>${lista.length}</span></h2>
        <ul>${lista.map(wierszSubskrypcji).join('')}</ul>
      </section>` : '';

  $('#widok').innerHTML = `
  <section class="ekran subskrypcje">
    <div class="naglowek-sekcji">
      <h1>Subskrypcje</h1>
      <a class="przycisk" href="#dodaj/sub">Dodaj subskrypcję</a>
    </div>
    <div class="suma-sub">
      <b>${esc(kwotaTxt(suma))}</b>
      <span>${{ miesiecznie: 'miesięcznie', rocznie: 'rocznie', zaplacono: 'zapłacono dotąd' }[widokSub]}${subs.length ? `, ${subs.length} ${odmiana(subs.length, 'aktywna subskrypcja', 'aktywne subskrypcje', 'aktywnych subskrypcji')}` : ''}</span>
      <div class="chipy male">${[['miesiecznie', 'Miesięcznie'], ['rocznie', 'Rocznie'], ['zaplacono', 'Zapłacono dotąd']].map(([v, e]) =>
        `<button type="button" class="chip" data-akcja="widok-sub" data-v="${v}" aria-pressed="${widokSub === v}">${e}</button>`).join('')}</div>
    </div>
    ${naMapie.length ? `<div class="mapa-sub" style="aspect-ratio:${proporcja}">${naMapie.map((x, i) => {
      const r = prost[i];
      const kat = x.p.kategoria;
      const procent = suma ? Math.round((x.wartosc / suma) * 100) : 0;
      return `<a class="kafel-sub" href="#plan/${encodeURIComponent(x.p.id)}" style="left:${(r.x / proporcja).toFixed(3)}%;top:${r.y.toFixed(3)}%;width:${(r.w / proporcja).toFixed(3)}%;height:${r.h.toFixed(3)}%;--tlo:${esc(KOLORY[(i + 3) % KOLORY.length])}">
        <span class="ikona" aria-hidden="true">${esc(ikona(kat, 'wydatek'))}</span>
        <span class="procent">${procent}%</span>
        <span class="nazwa">${esc(x.p.nazwa)}</span>
        <span class="kwota-sub">${esc(kwotaTxt(Number(x.p.kwota), x.p.waluta))} / ${esc(opisRytmu(x.p).replace(/^co /, ''))}</span>
      </a>`;
    }).join('')}</div>` : ''}
    ${pozycje.some(x => x.bezKursu) ? '<p class="uwagi-podsumowania">Subskrypcje w walucie bez znanego kursu nie są wliczone w sumę.</p>' : ''}
    ${wszystkie.length ? `
      ${sekcja('Do zapłaty', doZaplaty)}
      ${sekcja('Zapłacone w tym okresie', zaplacone, 'zaplacone')}
      ${zakonczone.length ? `<details class="zakonczone-sub"><summary>Zakończone (${zakonczone.length})</summary>${sekcja('Zakończone', zakonczone, 'zakonczone')}</details>` : ''}` : `
      <div class="pusto-duze"><p>Nie masz jeszcze subskrypcji. Dodaj abonamenty, np. programy, hosting czy telefon, żeby widzieć ich koszt miesięczny.</p>
        <a class="przycisk" href="#dodaj/sub">Dodaj subskrypcję</a></div>`}
  </section>`;
}

// ── zdarzenia ──

async function klikWspolny(e, rysuj) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return false;
  const { akcja, v } = b.dataset;
  if (akcja === 'zaplacone') {
    const p = dane.planowane.find(x => x.id === v);
    if (!p) return true;
    b.disabled = true;
    const t = await oznaczZaplacone(p);
    if (t) {
      const wplyw = ['wpływ', 'spłata-otrzymana'].includes(t.typ);
      toast(`${t.typ === 'przeksięgowanie-wpływ' ? 'Odłożone' : wplyw ? 'Wpłynęło' : 'Zapłacone'}: ${p.nazwa} ${kwotaTxt(Number(t.kwota), t.waluta)}.`, 'ok', 6000,
        { etykieta: 'Cofnij', fn: async () => { await cofnijZaplacone(dane.transakcje.find(x => x.id === t.id) || t); bezSkoku(rysuj); } });
    }
  } else if (akcja === 'pomin') {
    const p = dane.planowane.find(x => x.id === v);
    if (p) await pomin(p);
  } else if (akcja === 'wznow') {
    const p = dane.planowane.find(x => x.id === v);
    if (p) await wznow(p);
  } else if (akcja === 'cofnij') {
    const t = dane.transakcje.find(x => x.id === v);
    if (!t) return true;
    const tak = await okno('Cofnąć rozliczenie?', `<p>Transakcja ${esc(kwotaTxt(Number(t.kwota), t.waluta))} z ${esc(dataSlownie(t.data_operacji).toLowerCase())} zostanie anulowana, a pozycja wróci do planowanych.</p>`,
      [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Cofnij rozliczenie', wartosc: true }]);
    if (!tak) return true;
    await cofnijZaplacone(t);
    toast('Rozliczenie cofnięte.', 'ok');
  } else return false;
  bezSkoku(rysuj);
  return true;
}

export const ekranPlanowane = {
  render: renderPlanowane,
  klik: async e => {
    if (await klikWspolny(e, renderPlanowane)) return;
    const b = e.target.closest('[data-akcja]');
    if (!b) return;
    const { akcja, v } = b.dataset;
    if (akcja === 'okres') stan.okres = v;
    else if (akcja === 'zakladka') stan.zakladka = v;
    else if (akcja === 'panel') stan.panel = !stan.panel;
    else if (akcja === 'wyczysc') ['rodzaje', 'konta', 'kategorie', 'podmioty'].forEach(k => stan[k].clear());
    else if (akcja.startsWith('f-')) { const z = stan[akcja.slice(2)]; if (z.has(v)) z.delete(v); else z.add(v); }
    else return;
    bezSkoku(renderPlanowane);
  },
  wejscie: e => {
    if (e.target.name !== 'szukaj') return;
    stan.szukaj = e.target.value;
    const poz = e.target.selectionStart;
    bezSkoku(renderPlanowane);
    const el = $('.planowane input[name="szukaj"]');
    el.focus();
    el.setSelectionRange(poz, poz);
  },
};

export const ekranSubskrypcje = {
  render: renderSubskrypcje,
  klik: async e => {
    if (await klikWspolny(e, renderSubskrypcje)) return;
    const b = e.target.closest('[data-akcja="widok-sub"]');
    if (!b) return;
    widokSub = b.dataset.v;
    bezSkoku(renderSubskrypcje);
  },
};
