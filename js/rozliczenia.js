// Rozliczenia: wpływy z banku ↔ paragony z Subiektu (karta ROZLICZENIA).
// Jeden wpływ może rozliczyć kilka paragonów i odwrotnie; kwoty nie muszą się zgadzać (np. wpływ 1240 zł, paragon 240 zł).
// Część wpływu, która nie jest sprzedażą z paragonu, oznacza się „bez paragonu” (też wiersz w ROZLICZENIA).
// Ekrany: #rozliczenia (wspólna lista), #rozliczenia/auto (dopasowania automatyczne),
//         #rozliczenie/<id transakcji>, #rozliczenie/p:<podmiot|dok_id>.

import { $, $$, esc, zaokr, kwotaTxt, dataLok, roznicaDni, dataKrotko, dataSlownie, uuid, odmiana, toast, okno, bezSkoku, liczba, liczbaNaTekst } from './util.js';
import { dane, wczytajDane, glowne, czyKorekta, kolorKonta, konta, PRYWATNE } from './dane.js';
import * as sync from './sync.js';

const num = v => (isFinite(Number(v)) ? Number(v) : 0);
export const kluczParagonu = d => `${d.podmiot}|${d.dok_id}`;
const aktywne = () => dane.rozliczenia.filter(r => r.status !== 'anulowane');
/** Różnica groszowa (np. paragon 292,02 zł, przelew 292,00 zł) nie zostawia paragonu „otwartego”. */
const GROSZE = 0.1;
const POWODY = ['Nie jest sprzedażą (zwrot, pożyczka, darowizna)', 'Zaliczka lub przedpłata', 'Sprzedaż bez paragonu', 'Inne'];

export function rozliczonoTransakcji(id) {
  return zaokr(aktywne().filter(r => r.transakcja_id === id).reduce((s, r) => s + num(r.kwota), 0));
}
export function rozliczonoParagonu(klucz) {
  return zaokr(aktywne().filter(r => r.obiekt_typ === 'paragon' && r.obiekt_id === klucz).reduce((s, r) => s + num(r.kwota), 0));
}
/** Część bezgotówkowa paragonu (karta, przelew, kredyt). */
export const bezgotowkowo = d => zaokr(num(d.brutto) - num(d.kw_gotowka));
/** Paragon „gotówkowy” w Subiekcie – w sklepie internetowym bywa tak oznaczony mimo zapłaty przelewem. */
export const gotowkowy = d => bezgotowkowo(d) <= 0.004;
const doRozliczenia = d => (gotowkowy(d) ? zaokr(num(d.brutto)) : bezgotowkowo(d));
export const zostaloParagonu = d => zaokr(doRozliczenia(d) - rozliczonoParagonu(kluczParagonu(d)));

const kontoGotowkowe = nazwa => konta(true).find(k => k.nazwa === nazwa)?.typKonta === 'gotowka';
/** Każdy wpływ na konto bankowe (poza prywatnymi, korektami i Skarbonką) może rozliczać paragony. */
export const czyWplywDoRozliczenia = t => t.typ === 'wpływ' && t.status !== 'anulowana' && !czyKorekta(t)
  && t.podmiot !== PRYWATNE && t.konto && !kontoGotowkowe(t.konto) && !konta(true).find(k => k.nazwa === t.konto)?.wirtualne;
export const zostaloWplywu = t => zaokr(num(t.kwota) - rozliczonoTransakcji(t.id));

// ───────────────────────── podobieństwo nazw ─────────────────────────

const POMIJANE = new Set(['nieznany', 'ceremonia', 'przelew', 'telefon', 'blik', 'srodkow', 'od', 'dla', 'one', 'river', 'oneriver', 'darius', 'darek', 'dariusz', 'slusarczyk', 'zamowienie', 'tel']);
const slowa = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
  .split(/[^a-z]+/).filter(w => w.length > 2 && !POMIJANE.has(w));
function zgodnaNazwa(d, t) {
  const p = slowa(d.kontrahent);
  if (!p.length) return false;
  const w = new Set(slowa(`${t.kontrahent} ${t.opis}`));
  return p.some(x => w.has(x));
}

// ───────────────────────── propozycje ─────────────────────────

const otwarteParagony = () => dane.sprzedaz.filter(d => num(d.brutto) > 0 && zostaloParagonu(d) > GROSZE);
const otwarteWplywy = () => dane.transakcje.filter(t => czyWplywDoRozliczenia(t) && zostaloWplywu(t) > 0.004);

function ocena(t, d, resztaW, resztaP) {
  const dni = roznicaDni(t.data_operacji, d.data);
  if (Math.abs(dni) > 45) return null;
  const nazwa = zgodnaNazwa(d, t);
  const dokladnie = Math.abs(resztaW - resztaP) < GROSZE;
  const wynik = (dokladnie ? 0 : resztaP <= resztaW + 0.009 ? 25 : 60) + (nazwa ? 0 : 30) + Math.min(Math.abs(dni), 30) + (gotowkowy(d) ? 10 : 0);
  return { dni, nazwa, dokladnie, wynik };
}

function propozycjeParagonow(t) {
  const reszta = zostaloWplywu(t);
  return otwarteParagony().map(d => {
    const zostalo = zostaloParagonu(d);
    const o = ocena(t, d, reszta, zostalo);
    return o && { d, zostalo, ...o };
  }).filter(Boolean).sort((a, b) => a.wynik - b.wynik);
}

function propozycjeWplywow(d) {
  const reszta = zostaloParagonu(d);
  return otwarteWplywy().map(t => {
    const zostalo = zostaloWplywu(t);
    const o = ocena(t, d, zostalo, reszta);
    return o && { t, zostalo, ...o };
  }).filter(Boolean).sort((a, b) => a.wynik - b.wynik);
}

/** Pary o tej samej kwocie: „pewne”, gdy zgadza się też nazwisko; „prawdopodobne”, gdy kwota jest jedyna w okolicy. */
function paryAutomatyczne() {
  const W = otwarteWplywy(), P = otwarteParagony();
  const kandydaci = [];
  for (const t of W) {
    const zw = zostaloWplywu(t);
    for (const d of P) {
      const zp = zostaloParagonu(d);
      if (Math.abs(zw - zp) >= GROSZE) continue;
      const dni = roznicaDni(t.data_operacji, d.data);
      if (Math.abs(dni) > 30) continue;
      const nazwa = zgodnaNazwa(d, t);
      if (!nazwa && gotowkowy(d)) continue;          // gotówkowy paragon tylko przy zgodnym nazwisku
      kandydaci.push({ t, d, kwota: Math.min(zw, zp), dni, nazwa, wynik: (nazwa ? 0 : 40) + Math.abs(dni) });
    }
  }
  kandydaci.sort((a, b) => a.wynik - b.wynik);
  const ileDlaW = new Map(), ileDlaP = new Map();
  kandydaci.forEach(k => { ileDlaW.set(k.t.id, (ileDlaW.get(k.t.id) || 0) + 1); ileDlaP.set(kluczParagonu(k.d), (ileDlaP.get(kluczParagonu(k.d)) || 0) + 1); });
  const uzyteW = new Set(), uzyteP = new Set(), wynik = [];
  for (const k of kandydaci) {
    const kp = kluczParagonu(k.d);
    if (uzyteW.has(k.t.id) || uzyteP.has(kp)) continue;
    const pewne = k.nazwa;
    const jedyne = ileDlaW.get(k.t.id) === 1 && ileDlaP.get(kp) === 1;
    if (!pewne && !jedyne) continue;
    uzyteW.add(k.t.id); uzyteP.add(kp);
    wynik.push({ ...k, pewne });
  }
  return wynik;
}

// ───────────────────────── zapis ─────────────────────────

function wierszRozliczenia(t, kwota, obiekt) {
  const waluta = t.waluta || 'PLN';
  return {
    id: uuid(), transakcja_id: t.id, kwota: zaokr(kwota), waluta,
    kwota_pln: waluta === 'PLN' ? zaokr(kwota) : (t.kurs ? zaokr(kwota * Number(t.kurs)) : ''), data: dataLok(),
    status: 'aktywne', ...obiekt,
  };
}
const zParagonem = (t, d, kwota, sposob = 'ręcznie') => wierszRozliczenia(t, kwota, {
  obiekt_typ: 'paragon', obiekt_id: kluczParagonu(d), sposob, uwagi: `${d.numer} (${d.podmiot})`,
});

async function rozlicz(t, d, kwota) {
  kwota = zaokr(kwota);
  const maks = Math.min(zostaloWplywu(t), zostaloParagonu(d));
  if (!(kwota > 0)) return toast('Wpisz kwotę większą od zera.', 'blad');
  if (kwota > maks + 0.009) return toast(`Najwyżej ${kwotaTxt(maks, t.waluta)} – tyle zostało do rozliczenia.`, 'blad');
  const r = zParagonem(t, d, kwota);
  await sync.zapisz('ROZLICZENIA', [r]);
  await wczytajDane();
  toast(`Rozliczono ${kwotaTxt(kwota, t.waluta)} z paragonem ${d.numer}.`, 'ok', 5000,
    { etykieta: 'Cofnij', fn: async () => { await cofnij(r.id); bezSkoku(rysujBiezacy); } });
}

async function cofnij(idRozl) {
  const r = dane.rozliczenia.find(x => x.id === idRozl);
  if (!r) return;
  await sync.zapisz('ROZLICZENIA', [{ ...r, status: 'anulowane' }]);
  await wczytajDane();
}

async function bezParagonu(t, powod) {
  const reszta = zostaloWplywu(t);
  if (!(reszta > 0)) return;
  await sync.zapisz('ROZLICZENIA', [wierszRozliczenia(t, reszta, { obiekt_typ: 'bez-paragonu', obiekt_id: '', sposob: 'ręcznie', uwagi: powod })]);
  await wczytajDane();
  toast(`${kwotaTxt(reszta, t.waluta)} oznaczone jako bez paragonu.`, 'ok');
}

/** Pozostałą część wpływu wydziela jako osobną część z innym źródłem przychodu – jak podział transakcji. */
async function wydzielReszte(t, wybor) {
  const rozl = rozliczonoTransakcji(t.id);
  const reszta = zostaloWplywu(t);
  if (!(rozl > 0) || !(reszta > 0)) return;
  const nazwa = wybor;
  const podzialId = t.podzial_id || uuid();
  const kurs = Number(t.kurs) || ((t.waluta || 'PLN') === 'PLN' ? 1 : 0);
  const pln = v => (kurs ? zaokr(v * kurs) : '');
  const glowna = { ...t, kwota: rozl, kwota_pln: pln(rozl), podzial_id: podzialId };
  const czesc = { ...t, id: uuid(), kwota: reszta, kwota_pln: pln(reszta), podzial_id: podzialId, typ: 'wpływ', zrodlo_przychodu: nazwa, kategoria: '', podkategoria: '' };
  await sync.zapiszWiele([
    { karta: 'TRANSAKCJE', wiersze: [glowna, czesc] },
    { karta: 'ROZLICZENIA', wiersze: [wierszRozliczenia(czesc, reszta, { obiekt_typ: 'bez-paragonu', obiekt_id: '', sposob: 'wydzielone', uwagi: `Wydzielone: ${nazwa}` })] },
  ]);
  await wczytajDane();
  toast(`Wydzielono ${kwotaTxt(reszta, t.waluta)} jako „${nazwa}”.`, 'ok');
}

// ───────────────────────── widoki ─────────────────────────

const stan = { filtr: 'wszystko', szukaj: '', gotowkowe: false, biezacy: null, auto: null };

function wierszWplywu(t) {
  const rozl = rozliczonoTransakcji(t.id);
  return `<li><a class="wiersz-rozl" href="#rozliczenie/${encodeURIComponent(t.id)}">
    <span class="data-rozl">${esc(dataKrotko(t.data_operacji))}</span>
    <span class="opis-rozl"><b><span class="rodzaj-rozl wplyw">wpływ</span> ${esc(t.kontrahent || 'Wpływ')}</b>
      <span><span class="etykieta-konta" style="--k:${esc(kolorKonta(t.konto))}">${esc(t.konto)}</span> ${esc(t.opis && t.opis !== t.kontrahent ? t.opis : '')}</span></span>
    <span class="kwoty-rozl"><b>${esc(kwotaTxt(num(t.kwota), t.waluta))}</b>
      <span>${rozl ? `rozliczono ${esc(kwotaTxt(rozl, t.waluta))} · ` : ''}zostało ${esc(kwotaTxt(zostaloWplywu(t), t.waluta))}</span></span>
  </a></li>`;
}

function wierszParagonu(d) {
  const rozl = rozliczonoParagonu(kluczParagonu(d));
  return `<li><a class="wiersz-rozl" href="#rozliczenie/p:${encodeURIComponent(kluczParagonu(d))}">
    <span class="data-rozl">${esc(dataKrotko(d.data))}</span>
    <span class="opis-rozl"><b><span class="rodzaj-rozl paragon">paragon</span> ${esc(d.numer)} <span class="znacznik">${esc(d.podmiot)}</span></b>
      <span>${esc([d.kontrahent, d.magazyn, d.forma_platnosci].filter(Boolean).join(' · '))}</span></span>
    <span class="kwoty-rozl"><b>${esc(kwotaTxt(num(d.brutto)))}</b>
      <span>${rozl ? `rozliczono ${esc(kwotaTxt(rozl))} · ` : ''}zostało ${esc(kwotaTxt(zostaloParagonu(d)))}</span></span>
  </a></li>`;
}

const pasujeSzukaj = (...pola) => !stan.szukaj || pola.join(' ').toLowerCase().includes(stan.szukaj.toLowerCase());

function renderLista() {
  const wplywy = otwarteWplywy().filter(t => pasujeSzukaj(t.kontrahent, t.opis, t.kwota, t.konto));
  const paragonyWszystkie = otwarteParagony().filter(d => !gotowkowy(d) || stan.gotowkowe || rozliczonoParagonu(kluczParagonu(d)) > 0);
  const paragony = paragonyWszystkie.filter(d => pasujeSzukaj(d.numer, d.kontrahent, d.brutto, d.magazyn));
  const sumaW = zaokr(otwarteWplywy().reduce((s, t) => s + zostaloWplywu(t), 0));
  const bezgot = otwarteParagony().filter(d => !gotowkowy(d));
  const sumaP = zaokr(bezgot.reduce((s, d) => s + zostaloParagonu(d), 0));
  const auto = paryAutomatyczne();
  const elementy = [
    ...(stan.filtr === 'paragony' ? [] : wplywy.map(t => ({ data: t.data_operacji, html: wierszWplywu(t) }))),
    ...(stan.filtr === 'wplywy' ? [] : paragony.map(d => ({ data: d.data, html: wierszParagonu(d) }))),
  ].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const rozliczone = aktywne().sort((a, b) => String(b.utworzono || b.data).localeCompare(String(a.utworzono || a.data))).slice(0, 150);
  const filtry = [['wszystko', 'Wszystko'], ['wplywy', `Wpływy (${wplywy.length})`], ['paragony', `Paragony (${paragony.length})`], ['rozliczone', 'Rozliczone']];

  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran">
    <div class="naglowek-sekcji"><h1>Rozliczenia</h1></div>
    <div class="kafle-wskaznikow dwa">
      <div class="wskaznik"><span class="etykieta-wsk">Wpływy bez paragonu</span><b>${esc(kwotaTxt(sumaW))}</b><span class="zmiana">${otwarteWplywy().length} ${odmiana(otwarteWplywy().length, 'wpływ', 'wpływy', 'wpływów')} (bez prywatnych)</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Paragony bezgotówkowe bez wpływu</span><b>${esc(kwotaTxt(sumaP))}</b><span class="zmiana">${bezgot.length} ${odmiana(bezgot.length, 'paragon', 'paragony', 'paragonów')}</span></div>
    </div>
    ${auto.length ? `<div class="pasek-rozliczenia"><span>Znalazłem <b>${auto.length}</b> ${odmiana(auto.length, 'parę', 'pary', 'par')} wpływ–paragon o tej samej kwocie (${auto.filter(a => a.pewne).length} ze zgodnym nazwiskiem).</span>
      <a class="przycisk-maly" href="#rozliczenia/auto">Przejrzyj i rozlicz</a></div>` : ''}
    <div class="pasek-filtrow">
      <div class="chipy male">${filtry.map(([v, e]) => `<button type="button" class="chip" data-akcja="filtr" data-v="${v}" aria-pressed="${stan.filtr === v}">${esc(e)}</button>`).join('')}</div>
      <input type="search" name="szukaj-rozl" placeholder="Szukaj: nazwisko, numer, kwota" value="${esc(stan.szukaj)}" class="szukaj-rozl">
    </div>
    ${stan.filtr !== 'rozliczone' ? `
      <label class="przelacznik male-przel"><input type="checkbox" name="gotowkowe" ${stan.gotowkowe ? 'checked' : ''}> Pokaż też paragony gotówkowe (sklep internetowy bywa w Subiekcie oznaczony jako gotówka)</label>
      <ul class="lista-rozl">${elementy.map(e => e.html).join('') || '<li class="pusto">Nic do rozliczenia.</li>'}</ul>` : `
      <ul class="lista-rozl">${rozliczone.map(r => {
        const t = dane.transakcje.find(x => x.id === r.transakcja_id);
        return `<li class="wiersz-rozl">
          <span class="data-rozl">${esc(dataKrotko(String(r.data).slice(0, 10)))}</span>
          <span class="opis-rozl"><b>${r.obiekt_typ === 'paragon' ? esc(r.uwagi || r.obiekt_id) : `bez paragonu: ${esc(r.uwagi || '')}`}</b>
            <span>${t ? `<a href="#rozliczenie/${encodeURIComponent(t.id)}">${esc(t.kontrahent || 'wpływ')} · ${esc(dataKrotko(t.data_operacji))}</a>` : 'wpływ niedostępny'}${r.sposob === 'automatycznie' ? ' · automatycznie' : ''}</span></span>
          <span class="kwoty-rozl"><b>${esc(kwotaTxt(num(r.kwota), r.waluta))}</b><button type="button" class="przycisk-maly drugorzedny" data-akcja="cofnij-rozl" data-v="${esc(r.id)}">Cofnij</button></span>
        </li>`;
      }).join('') || '<li class="pusto">Nic jeszcze nie rozliczono.</li>'}</ul>`}
  </section>`;
}

function renderAuto() {
  if (!stan.auto) {
    stan.auto = paryAutomatyczne();
    stan.autoZazn = new Set(stan.auto.map((a, i) => (a.pewne ? i : null)).filter(i => i !== null));
  }
  const pary = stan.auto;
  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran">
    <a class="wstecz" href="#rozliczenia">Rozliczenia</a>
    <div class="naglowek-sekcji"><h1>Dopasowania automatyczne</h1></div>
    <p class="uwagi-podsumowania">Ta sama kwota, daty w odstępie do 30 dni. Zaznaczone są pary ze zgodnym nazwiskiem; „prawdopodobne” (tylko kwota) sprawdź i zaznacz sam.</p>
    <ul class="lista-rozl">${pary.map((a, i) => `<li class="wiersz-rozl auto ${a.pewne ? 'pewne' : ''}">
      <label class="wybor"><input type="checkbox" data-akcja="auto-zazn" data-v="${i}" ${stan.autoZazn.has(i) ? 'checked' : ''}></label>
      <span class="opis-rozl"><b>${esc(a.t.kontrahent || 'wpływ')} <span class="strzalka">↔</span> ${esc(a.d.numer)} <span class="znacznik">${esc(a.d.podmiot)}</span> ${esc(a.d.kontrahent || '')}</b>
        <span>wpływ ${esc(dataKrotko(a.t.data_operacji))} (${esc(a.t.konto)}) · paragon ${esc(dataKrotko(a.d.data))}, ${esc(a.d.forma_platnosci || '')} · ${a.pewne ? '<span class="znacznik potw">zgodne nazwisko</span>' : '<span class="znacznik czeka">tylko kwota</span>'}</span></span>
      <span class="kwoty-rozl"><b>${esc(kwotaTxt(a.kwota, a.t.waluta))}</b></span>
    </li>`).join('') || '<li class="pusto">Brak par o tej samej kwocie.</li>'}</ul>
    ${pary.length ? `<div class="pasek-zapisu-importu"><span>Zaznaczone: <b>${stan.autoZazn.size}</b> z ${pary.length}</span>
      <button type="button" data-akcja="auto-rozlicz" ${stan.autoZazn.size ? '' : 'disabled'}>Rozlicz zaznaczone</button></div>` : ''}
  </section>`;
}

function htmlPowiazanych(rozl, opis) {
  if (!rozl.length) return '';
  return `<ul class="lista-rozl powiazane">${rozl.map(r => `<li class="wiersz-rozl">
    <span class="opis-rozl"><b>${opis(r)}</b><span>rozliczono ${esc(dataKrotko(String(r.data).slice(0, 10)))}</span></span>
    <span class="kwoty-rozl"><b>${esc(kwotaTxt(num(r.kwota), r.waluta))}</b><button type="button" class="przycisk-maly drugorzedny" data-akcja="cofnij-rozl" data-v="${esc(r.id)}">Cofnij</button></span>
  </li>`).join('')}</ul>`;
}

function renderWplyw(id) {
  const t = dane.transakcje.find(x => x.id === id);
  if (!t) { $('#widok').innerHTML = '<section class="ekran"><p class="pusto">Nie ma takiej transakcji na tym urządzeniu.</p><a href="#rozliczenia">Rozliczenia</a></section>'; return; }
  const rozl = aktywne().filter(r => r.transakcja_id === t.id);
  const zostalo = zostaloWplywu(t);
  const propozycje = propozycjeParagonow(t).filter(x => pasujeSzukaj(x.d.numer, x.d.kontrahent, x.d.brutto, x.d.magazyn)).slice(0, 30);
  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran">
    <a class="wstecz" href="#rozliczenia">Rozliczenia</a>
    <div class="naglowek-sekcji"><h1>Rozlicz wpływ</h1><a class="przycisk-maly drugorzedny akcja-naglowka" href="#edytuj/${encodeURIComponent(t.id)}">Otwórz transakcję</a></div>
    <div class="karta-ustawien">
      <dl class="info">
        <div><dt>Od</dt><dd><b>${esc(t.kontrahent || '—')}</b></dd></div>
        ${t.opis ? `<div><dt>Tytuł</dt><dd>${esc(t.opis)}</dd></div>` : ''}
        <div><dt>Data, konto</dt><dd>${esc(dataSlownie(t.data_operacji))} · ${esc(t.konto)}</dd></div>
        <div><dt>Kwota wpływu</dt><dd><b>${esc(kwotaTxt(num(t.kwota), t.waluta))}</b></dd></div>
        <div><dt>Rozliczono</dt><dd>${esc(kwotaTxt(rozliczonoTransakcji(t.id), t.waluta))}</dd></div>
        <div><dt>Zostało</dt><dd><b class="${zostalo > 0 ? 'do-rozl' : 'plus'}">${esc(kwotaTxt(zostalo, t.waluta))}</b></dd></div>
      </dl>
      ${htmlPowiazanych(rozl, r => {
        if (r.obiekt_typ !== 'paragon') return `bez paragonu: ${esc(r.uwagi || '')}`;
        const d = dane.sprzedaz.find(x => kluczParagonu(x) === r.obiekt_id);
        return d ? `<a href="#rozliczenie/p:${encodeURIComponent(r.obiekt_id)}">${esc(d.numer)}</a> <span class="znacznik">${esc(d.podmiot)}</span> ${esc(d.kontrahent || '')} ${esc(dataKrotko(d.data))}` : esc(r.uwagi || r.obiekt_id);
      })}
      ${zostalo > 0.004 ? `<div class="reszta-rozl">
        <span>${rozl.length ? 'Pozostałe' : 'Cały wpływ'} <b>${esc(kwotaTxt(zostalo, t.waluta))}</b> nie dotyczy paragonu?</span>
        <select name="powod">${POWODY.map(p => `<option>${esc(p)}</option>`).join('')}</select>
        <button type="button" class="przycisk-maly drugorzedny" data-akcja="bez-paragonu" data-v="${esc(t.id)}">Oznacz jako bez paragonu</button>
        ${rozl.some(r => r.obiekt_typ === 'paragon') ? `<span class="podpowiedz">albo wydziel jako osobną część:</span>
          <select name="reszta-kat"><option value="">— źródło przychodu —</option>${glowne('wpływ').map(k => `<option>${esc(k.nazwa)}</option>`).join('')}</select>
          <button type="button" class="przycisk-maly drugorzedny" data-akcja="wydziel" data-v="${esc(t.id)}">Wydziel</button>` : ''}
      </div>` : ''}
    </div>
    ${zostalo > 0.004 ? `
    <div class="naglowek-listy-importu"><b>Paragony do wyboru</b>
      <input type="search" name="szukaj-rozl" placeholder="numer, kontrahent, kwota" value="${esc(stan.szukaj)}" class="szukaj-rozl"></div>
    <ul class="lista-rozl">${propozycje.map(({ d, zostalo: zp, dokladnie, nazwa }) => `<li class="wiersz-rozl propozycja">
        <span class="data-rozl">${esc(dataKrotko(d.data))}</span>
        <span class="opis-rozl"><b>${esc(d.numer)} <span class="znacznik">${esc(d.podmiot)}</span> ${esc(d.kontrahent || '')}
          ${dokladnie ? '<span class="znacznik potw">ta sama kwota</span>' : ''}${nazwa ? '<span class="znacznik potw">zgodne nazwisko</span>' : ''}</b>
          <span>${esc([d.magazyn, d.forma_platnosci].filter(Boolean).join(' · '))} · do rozliczenia ${esc(kwotaTxt(zp))}</span></span>
        <span class="akcja-rozl"><input name="kwota-rozl" inputmode="decimal" value="${esc(liczbaNaTekst(Math.min(zp, zostalo)))}" aria-label="Kwota">
          <button type="button" class="przycisk-maly" data-akcja="rozlicz" data-p="${esc(kluczParagonu(d))}" data-t="${esc(t.id)}">Rozlicz</button></span>
      </li>`).join('') || '<li class="pusto">Brak paragonów z okresu ±45 dni od wpływu. Sprawdź, czy sprzedaż z tego okresu jest wklejona.</li>'}</ul>` : '<p class="komunikat ok">Wpływ jest w całości rozliczony.</p>'}
  </section>`;
}

function renderParagon(klucz) {
  const d = dane.sprzedaz.find(x => kluczParagonu(x) === klucz);
  if (!d) { $('#widok').innerHTML = '<section class="ekran"><p class="pusto">Nie ma takiego paragonu na tym urządzeniu.</p><a href="#rozliczenia">Rozliczenia</a></section>'; return; }
  const rozl = aktywne().filter(r => r.obiekt_typ === 'paragon' && r.obiekt_id === klucz);
  const zostalo = zostaloParagonu(d);
  const poz = dane.sprzedazPoz.filter(p => p.podmiot === d.podmiot && String(p.dok_id) === String(d.dok_id));
  const propozycje = propozycjeWplywow(d).filter(x => pasujeSzukaj(x.t.kontrahent, x.t.opis, x.t.kwota)).slice(0, 30);
  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran">
    <a class="wstecz" href="#rozliczenia">Rozliczenia</a>
    <div class="naglowek-sekcji"><h1>Paragon ${esc(d.numer)}</h1><span class="znacznik">${esc(d.podmiot)}</span></div>
    <div class="karta-ustawien">
      <dl class="info">
        <div><dt>Data, magazyn</dt><dd>${esc(dataSlownie(d.data))} · ${esc(d.magazyn || '')}</dd></div>
        ${d.kontrahent ? `<div><dt>Kontrahent</dt><dd>${esc(d.kontrahent)}</dd></div>` : ''}
        <div><dt>Wartość brutto</dt><dd><b>${esc(kwotaTxt(num(d.brutto)))}</b> (${esc(d.forma_platnosci || '')})</dd></div>
        <div><dt>Zostało do rozliczenia</dt><dd><b class="${zostalo > 0 ? 'do-rozl' : 'plus'}">${esc(kwotaTxt(zostalo))}</b></dd></div>
      </dl>
      ${gotowkowy(d) ? '<p class="podpowiedz">W Subiekcie paragon jest gotówkowy. Jeśli zapłata przyszła przelewem, rozlicz go z wpływem poniżej.</p>' : ''}
      ${poz.length ? `<details><summary>Pozycje (${poz.length})</summary><table class="tabela"><tbody>${poz.map(p => `<tr><td>${esc(p.symbol)}</td><td>${esc(p.nazwa)}</td><td class="liczba">${esc(kwotaTxt(num(p.brutto)))}</td></tr>`).join('')}</tbody></table></details>` : ''}
      ${htmlPowiazanych(rozl, r => {
        const t = dane.transakcje.find(x => x.id === r.transakcja_id);
        return t ? `<a href="#rozliczenie/${encodeURIComponent(t.id)}">${esc(t.kontrahent || 'wpływ')}</a> ${esc(kwotaTxt(num(t.kwota), t.waluta))} · ${esc(dataKrotko(t.data_operacji))}` : 'wpływ niedostępny';
      })}
    </div>
    ${zostalo > GROSZE ? `
    <div class="naglowek-listy-importu"><b>Wpływy do wyboru</b>
      <input type="search" name="szukaj-rozl" placeholder="nazwisko, kwota" value="${esc(stan.szukaj)}" class="szukaj-rozl"></div>
    <ul class="lista-rozl">${propozycje.map(({ t, zostalo: zt, dokladnie, nazwa }) => `<li class="wiersz-rozl propozycja">
        <span class="data-rozl">${esc(dataKrotko(t.data_operacji))}</span>
        <span class="opis-rozl"><b>${esc(t.kontrahent || 'Wpływ')} ${dokladnie ? '<span class="znacznik potw">ta sama kwota</span>' : ''}${nazwa ? '<span class="znacznik potw">zgodne nazwisko</span>' : ''}</b>
          <span>${esc(t.konto)} · ${esc(t.opis || '')} · zostało ${esc(kwotaTxt(zt, t.waluta))} z ${esc(kwotaTxt(num(t.kwota), t.waluta))}</span></span>
        <span class="akcja-rozl"><input name="kwota-rozl" inputmode="decimal" value="${esc(liczbaNaTekst(Math.min(zt, zostalo)))}" aria-label="Kwota">
          <button type="button" class="przycisk-maly" data-akcja="rozlicz" data-p="${esc(klucz)}" data-t="${esc(t.id)}">Rozlicz</button></span>
      </li>`).join('') || '<li class="pusto">Brak wpływów z okresu ±45 dni od paragonu.</li>'}</ul>` : '<p class="komunikat ok">Paragon jest rozliczony.</p>'}
  </section>`;
}

function render(arg) {
  stan.biezacy = arg || null;
  if (arg !== 'auto') stan.auto = null;
  if (!arg) renderLista();
  else if (arg === 'auto') renderAuto();
  else if (arg.startsWith('p:')) renderParagon(arg.slice(2));
  else renderWplyw(arg);
}

function rysujBiezacy() { render(stan.biezacy); }

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'filtr') { stan.filtr = v; bezSkoku(rysujBiezacy); return; }
  if (akcja === 'auto-zazn') { if (b.checked) stan.autoZazn.add(Number(v)); else stan.autoZazn.delete(Number(v)); bezSkoku(renderAuto); return; }
  if (akcja === 'auto-rozlicz') {
    b.disabled = true;
    const wiersze = [...stan.autoZazn].map(i => stan.auto[i]).map(a => zParagonem(a.t, a.d, a.kwota, 'automatycznie'));
    await sync.zapisz('ROZLICZENIA', wiersze);
    await wczytajDane();
    toast(`Rozliczono ${wiersze.length} ${odmiana(wiersze.length, 'parę', 'pary', 'par')}.`, 'ok');
    stan.auto = null;
    location.hash = '#rozliczenia';
    return;
  }
  if (akcja === 'cofnij-rozl') {
    const tak = await okno('Cofnąć rozliczenie?', '<p>Kwota wróci do rozliczenia.</p>',
      [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Cofnij', wartosc: true }]);
    if (!tak) return;
    await cofnij(v);
    bezSkoku(rysujBiezacy);
    return;
  }
  if (akcja === 'rozlicz') {
    const t = dane.transakcje.find(x => x.id === b.dataset.t);
    const d = dane.sprzedaz.find(x => kluczParagonu(x) === b.dataset.p);
    if (!t || !d) return;
    const pole = b.closest('.wiersz-rozl').querySelector('input[name="kwota-rozl"]');
    b.disabled = true;
    await rozlicz(t, d, liczba(pole.value));
    bezSkoku(rysujBiezacy);
    return;
  }
  if (akcja === 'bez-paragonu') {
    await bezParagonu(dane.transakcje.find(x => x.id === v), $('select[name="powod"]').value);
    bezSkoku(rysujBiezacy);
    return;
  }
  if (akcja === 'wydziel') {
    const wybor = $('select[name="reszta-kat"]').value;
    if (!wybor) return toast('Wybierz źródło przychodu dla reszty.', 'blad');
    await wydzielReszte(dane.transakcje.find(x => x.id === v), wybor);
    bezSkoku(rysujBiezacy);
  }
}

function zmiana(e) {
  if (e.target.name === 'gotowkowe') { stan.gotowkowe = e.target.checked; bezSkoku(rysujBiezacy); }
}

let zegar = null;
function wejscie(e) {
  if (e.target.name !== 'szukaj-rozl') return;
  stan.szukaj = e.target.value;
  clearTimeout(zegar);
  zegar = setTimeout(() => {
    const poz = e.target.selectionStart;
    bezSkoku(rysujBiezacy);
    const el = $('input[name="szukaj-rozl"]');
    if (el) { el.focus(); el.setSelectionRange(poz, poz); }
  }, 250);
}

export const ekran = { render, klik, zmiana, wejscie };
