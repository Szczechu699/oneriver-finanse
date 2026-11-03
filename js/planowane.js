// Ekrany „Planowane” (bilans, zaległe, rozliczone) i „Subskrypcje” (mapa kosztów).

import * as sync from './sync.js';
import { $, esc, zaokr, kwotaTxt, dataLok, dodajDni, przesunDate, roznicaDni, dataSlownie, dataKrotko, uuid, odmiana, toast, okno, bezSkoku } from './util.js';
import {
  dane, wczytajDane, kolorKonta, ikona, kolorKategorii, KOLORY, opisRytmu, aktywnePlanowane, nastepnyTermin, terminy,
  miesiecznyKoszt, kierunekPlanu, RODZAJE_POZYCZEK, stanPozyczki,
} from './dane.js';
import { zaplacRate, cofnijSplate, doZaplatyRaty } from './pozyczki.js';
import { ikonaSvg } from './ikony.js';

// ── wspólne: zapłacone / cofnij / pomiń ──

export async function oznaczZaplacone(p) {
  if (p.rodzaj === 'rata') return zaplacRate(p);
  const kwota = Number(p.kwota) || 0;
  const waluta = p.waluta || 'PLN';
  const t = {
    id: uuid(), typ: p.typ === 'wpływ' ? 'wpływ' : 'wydatek', id_pary: '', podzial_id: '', data_operacji: dataLok(),
    konto: p.konto, kwota, waluta, kurs: waluta === 'PLN' ? 1 : '', kwota_pln: waluta === 'PLN' ? kwota : '',
    kategoria: p.kategoria || '', podkategoria: p.podkategoria || '', zrodlo_przychodu: p.zrodlo_przychodu || '',
    kontrahent: p.kontrahent || p.nazwa || '', podmiot: p.podmiot || '', tagi: p.tagi || '', nr_dokumentu: '', opis: p.opis || '',
    zalacznik: '', budzet: p.budzet || '', cel: '', pozyczka_id: '', planowana_id: p.id, planowany_termin: p.nastepna_data,
    status: 'oczekuje na wyciąg', zrodlo: 'ręczny',
  };
  const nastepny = nastepnyTermin(p);
  const plan = nastepny ? { ...p, nastepna_data: nastepny } : { ...p, status: 'zakończona' };
  await sync.zapiszWiele([{ karta: 'TRANSAKCJE', wiersze: [t] }, { karta: 'PLANOWANE', wiersze: [plan] }]);
  await wczytajDane();
  return t;
}

export async function cofnijZaplacone(t) {
  if (t.pozyczka_id) return cofnijSplate(t);
  const p = dane.planowane.find(x => x.id === t.planowana_id);
  const paczki = [{ karta: 'TRANSAKCJE', wiersze: [{ ...t, status: 'anulowana' }] }];
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

function wierszRozliczonej(t) {
  const p = dane.planowane.find(x => x.id === t.planowana_id);
  const wplyw = ['wpływ', 'spłata-otrzymana'].includes(t.typ);
  return `<li class="wiersz-planu rozliczona">
    <a href="${t.pozyczka_id ? `#pozyczka/${encodeURIComponent(t.pozyczka_id)}` : `#edytuj/${encodeURIComponent(t.id)}`}">
      <span class="ikona" style="--tlo:#E4E7E5" aria-hidden="true">✓</span>
      <span class="srodek"><span class="tytul">${esc(p?.nazwa || t.kontrahent || t.kategoria)}</span>
        <span class="opis">${esc(wplyw ? 'Wpłynęło' : 'Zapłacone')} ${esc(dataSlownie(t.data_operacji).toLowerCase())}${t.planowany_termin ? `, termin ${esc(dataKrotko(t.planowany_termin))}` : ''}</span></span>
      <span class="kwota-wiersza">${wplyw ? '+' : '−'}${esc(kwotaTxt(Number(t.kwota), t.waluta))}</span>
    </a>
    <div class="akcje-planu">
      <button type="button" class="znacznik-przycisk" data-akcja="cofnij" data-v="${esc(t.id)}" title="Cofnij rozliczenie">${esc(wplyw ? 'Wpłynęło' : 'Zapłacone')}, cofnij</button>
    </div>
  </li>`;
}

// ── Planowane ──

const stan = { okres: 'miesiac', zakladka: 'wszystko', szukaj: '' };
const OKRESY = [['miesiac', 'Do końca miesiąca'], ['30', '30 dni'], ['90', '3 miesiące'], ['365', '12 miesięcy']];

function koniecOkresu() {
  const dzis = dataLok();
  if (stan.okres === 'miesiac') return dodajDni(przesunDate(dzis.slice(0, 7) + '-01', 'miesiąc', 1), -1);
  if (stan.okres === '30') return dodajDni(dzis, 30);
  if (stan.okres === '90') return przesunDate(dzis, 'miesiąc', 3);
  return przesunDate(dzis, 'miesiąc', 12);
}

function bilans() {
  const dzis = dataLok();
  const koniec = koniecOkresu();
  const b = { wplywy: 0, wydatki: 0, zalWpl: 0, zalWyd: 0, nZal: 0, obce: {}, srednio: 0 };
  aktywnePlanowane().forEach(p => {
    const w = p.waluta || 'PLN';
    const wplyw = kierunekPlanu(p) === 'wpływ';
    const ts = terminy(p, koniec);
    ts.forEach((d, i) => {
      const kw = i === 0 ? kwotaPlanu(p) : Number(p.kwota) || 0;
      if (w !== 'PLN') { b.obce[w] = zaokr((b.obce[w] || 0) + (wplyw ? kw : -kw)); return; }
      if (d < dzis) { b.nZal++; if (wplyw) b.zalWpl += kw; else b.zalWyd += kw; }
      else if (wplyw) b.wplywy += kw; else b.wydatki += kw;
    });
    if (w === 'PLN') b.srednio += (wplyw ? 1 : -1) * miesiecznyKoszt(p);
  });
  return b;
}

export function renderPlanowane() {
  const dzis = dataLok();
  const b = bilans();
  const saldo = b.wplywy - b.wydatki;
  const q = stan.szukaj.trim().toLowerCase();
  const wszystkie = aktywnePlanowane()
    .filter(p => stan.zakladka === 'wszystko' || (stan.zakladka === 'zalegle' ? p.nastepna_data < dzis : p.nastepna_data >= dzis))
    .filter(p => !q || [p.nazwa, p.kontrahent, p.kategoria, p.zrodlo_przychodu, p.konto, p.opis].some(x => String(x || '').toLowerCase().includes(q)))
    .sort((a, b2) => String(a.nastepna_data).localeCompare(String(b2.nastepna_data)) || String(a.nazwa).localeCompare(String(b2.nazwa), 'pl'));
  const dni = new Map();
  wszystkie.forEach(p => { if (!dni.has(p.nastepna_data)) dni.set(p.nastepna_data, []); dni.get(p.nastepna_data).push(p); });
  const rozliczone = dane.transakcje.filter(t => t.planowana_id && t.status !== 'anulowana' && t.data_operacji >= dodajDni(dzis, -31))
    .sort((a, b2) => String(b2.data_operacji).localeCompare(String(a.data_operacji)) || String(b2.utworzono || '').localeCompare(String(a.utworzono || '')));
  const obce = Object.entries(b.obce).filter(([, v]) => Math.abs(v) >= 0.005);

  $('#widok').innerHTML = `
  <section class="ekran planowane">
    <div class="naglowek-sekcji">
      <h1>Planowane</h1>
      <a class="przycisk" href="#dodaj/plan">Zaplanuj płatność</a>
    </div>
    <div class="chipy male okresy" role="group" aria-label="Okres bilansu">${OKRESY.map(([o, e]) =>
      `<button type="button" class="chip" data-akcja="okres" data-v="${o}" aria-pressed="${stan.okres === o}">${e}</button>`).join('')}</div>
    <dl class="podsumowanie cztery">
      <div class="plus"><dt>Planowane wpływy</dt><dd>${esc(kwotaTxt(b.wplywy))}</dd></div>
      <div class="minus"><dt>Planowane wydatki</dt><dd>${esc(kwotaTxt(b.wydatki))}</dd></div>
      <div class="${saldo < 0 ? 'minus' : 'plus'} wyroznione"><dt>Bilans</dt><dd>${saldo > 0 ? '+' : ''}${esc(kwotaTxt(saldo))}</dd></div>
      <div class="${b.nZal ? 'minus' : ''}"><dt>Zaległe (${b.nZal})</dt><dd>${esc(kwotaTxt(b.zalWpl - b.zalWyd))}</dd></div>
    </dl>
    <p class="uwagi-podsumowania">Od dziś do ${esc(dataSlownie(koniecOkresu()).toLowerCase())}, z ratami pożyczek. Pozycje cykliczne średnio miesięcznie: ${b.srednio > 0 ? '+' : ''}${esc(kwotaTxt(zaokr(b.srednio)))}.${obce.length ? ` W innych walutach: ${obce.map(([w, v]) => (v > 0 ? '+' : '') + esc(kwotaTxt(v, w))).join(', ')}.` : ''}${b.nZal ? ` Zaległe: wpływy ${esc(kwotaTxt(b.zalWpl))}, wydatki ${esc(kwotaTxt(b.zalWyd))}.` : ''}</p>
    <div class="filtry dwa">
      <div class="zakladki-ekranu" role="tablist">${[['wszystko', 'Wszystko'], ['nadchodzace', 'Nadchodzące'], ['zalegle', 'Zaległe']].map(([z, e]) =>
        `<button type="button" role="tab" data-akcja="zakladka" data-v="${z}" aria-selected="${stan.zakladka === z}">${e}</button>`).join('')}</div>
      <input type="search" name="szukaj" value="${esc(stan.szukaj)}" placeholder="Szukaj" aria-label="Szukaj w planowanych">
    </div>
    ${dni.size ? [...dni.entries()].map(([d, lst]) => `
      <section class="dzien ${d < dzis ? 'po-terminie' : ''}">
        <h2>${esc(dataSlownie(d))} <span>${esc(relatywnie(d))}</span></h2>
        <ul>${lst.map(wierszPlanu).join('')}</ul>
      </section>`).join('') : `
      <div class="pusto-duze"><p>${aktywnePlanowane().length ? 'Nic tu nie pasuje.' : 'Nie masz jeszcze nic zaplanowanego. Przy wpisie wybierz „Nadchodząca” albo „Powtarzalna”, np. dla czynszu, ZUS czy abonamentu.'}</p></div>`}
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

export function renderSubskrypcje() {
  const subs = aktywnePlanowane().filter(p => p.rodzaj === 'subskrypcja');
  const zaplacono = id => zaokr(dane.transakcje.filter(t => t.planowana_id === id && t.status !== 'anulowana')
    .reduce((s, t) => s + (t.waluta === 'PLN' ? Number(t.kwota) : Number(t.kwota_pln) || 0), 0));
  const pozycje = subs.map(p => {
    const kurs = kursPrzyblizony(p.waluta || 'PLN');
    const mies = miesiecznyKoszt(p) * (kurs || 0);
    const wartosc = widokSub === 'miesiecznie' ? mies : widokSub === 'rocznie' ? mies * 12 : zaplacono(p.id);
    return { p, wartosc: zaokr(wartosc), mies: zaokr(mies), bezKursu: !kurs };
  }).sort((a, b) => b.wartosc - a.wartosc);
  const suma = zaokr(pozycje.reduce((s, x) => s + x.wartosc, 0));
  const naMapie = pozycje.filter(x => x.wartosc > 0);
  const proporcja = window.innerWidth < 720 ? 1.15 : 2.8;
  const prost = mapaProstokatow(naMapie.map(x => x.wartosc), 100 * proporcja, 100);
  const nadchodzace = [...subs].sort((a, b) => String(a.nastepna_data).localeCompare(String(b.nastepna_data)));
  const dni = new Map();
  nadchodzace.forEach(p => { if (!dni.has(p.nastepna_data)) dni.set(p.nastepna_data, []); dni.get(p.nastepna_data).push(p); });
  const dzis = dataLok();

  $('#widok').innerHTML = `
  <section class="ekran subskrypcje">
    <div class="naglowek-sekcji">
      <h1>Subskrypcje</h1>
      <a class="przycisk" href="#dodaj/sub">Dodaj subskrypcję</a>
    </div>
    <div class="suma-sub">
      <b>${esc(kwotaTxt(suma))}</b>
      <span>${{ miesiecznie: 'miesięcznie', rocznie: 'rocznie', zaplacono: 'zapłacono dotąd' }[widokSub]}${subs.length ? `, ${subs.length} ${odmiana(subs.length, 'subskrypcja', 'subskrypcje', 'subskrypcji')}` : ''}</span>
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
    ${dni.size ? [...dni.entries()].map(([d, lst]) => `
      <section class="dzien ${d < dzis ? 'po-terminie' : ''}">
        <h2>${esc(dataSlownie(d))} <span>${esc(relatywnie(d))}</span></h2>
        <ul>${lst.map(wierszPlanu).join('')}</ul>
      </section>`).join('') : `
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
      toast(`${wplyw ? 'Wpłynęło' : 'Zapłacone'}: ${p.nazwa} ${kwotaTxt(Number(t.kwota), t.waluta)}.`, 'ok', 6000,
        { etykieta: 'Cofnij', fn: async () => { await cofnijZaplacone(dane.transakcje.find(x => x.id === t.id) || t); bezSkoku(rysuj); } });
    }
  } else if (akcja === 'pomin') {
    const p = dane.planowane.find(x => x.id === v);
    if (p) await pomin(p);
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
    if (b.dataset.akcja === 'okres') stan.okres = b.dataset.v;
    else if (b.dataset.akcja === 'zakladka') stan.zakladka = b.dataset.v;
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
