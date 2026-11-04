// Rozliczenia: wpływy z banku ↔ paragony z Subiektu (karta ROZLICZENIA).
// Jeden wpływ może rozliczyć kilka paragonów i odwrotnie; kwoty nie muszą się zgadzać (np. wpływ 1240 zł, paragon 240 zł).
// Ekrany: #rozliczenia (listy do rozliczenia), #rozliczenie/<id transakcji>, #rozliczenie/p:<podmiot|dok_id>.

import { $, esc, zaokr, kwotaTxt, dataLok, dodajDni, roznicaDni, dataKrotko, dataSlownie, uuid, odmiana, toast, okno, bezSkoku, liczba, liczbaNaTekst } from './util.js';
import { dane, wczytajDane, glowne, podrzedne, czyKorekta, kolorKonta, czyWirtualne } from './dane.js';
import * as sync from './sync.js';

/** Źródła przychodu, których wpływy rozlicza się z paragonami (puste też – jeszcze nie skategoryzowane). */
export const ZRODLA_SPRZEDAZY = new Set(['Sklep internetowy', 'Stoiska i kiermasze', 'Sprzedaż za granicą', '']);

const num = v => (isFinite(Number(v)) ? Number(v) : 0);
export const kluczParagonu = d => `${d.podmiot}|${d.dok_id}`;
const aktywne = () => dane.rozliczenia.filter(r => r.status !== 'anulowane');

export function rozliczonoTransakcji(id) {
  return zaokr(aktywne().filter(r => r.transakcja_id === id).reduce((s, r) => s + num(r.kwota), 0));
}
export function rozliczonoParagonu(klucz) {
  return zaokr(aktywne().filter(r => r.obiekt_typ === 'paragon' && r.obiekt_id === klucz).reduce((s, r) => s + num(r.kwota), 0));
}
/** Do rozliczenia z bankiem: część bezgotówkowa paragonu (karta, przelew, kredyt; reszta – jeśli brak rozbicia). */
export function bezgotowkowo(d) {
  return zaokr(num(d.brutto) - num(d.kw_gotowka));
}
export const zostaloParagonu = d => zaokr(bezgotowkowo(d) - rozliczonoParagonu(kluczParagonu(d)));

export const czyWplywDoRozliczenia = t => t.typ === 'wpływ' && t.status !== 'anulowana' && !czyKorekta(t)
  && !czyWirtualne(t.konto) && (ZRODLA_SPRZEDAZY.has(t.zrodlo_przychodu || '') || rozliczonoTransakcji(t.id) > 0);
export const zostaloWplywu = t => zaokr(num(t.kwota) - rozliczonoTransakcji(t.id));

// ───────────────────────── propozycje ─────────────────────────

function propozycjeParagonow(t) {
  const reszta = zostaloWplywu(t);
  return dane.sprzedaz
    .map(d => ({ d, zostalo: zostaloParagonu(d) }))
    .filter(x => x.zostalo > 0.004)
    .map(x => {
      const dni = roznicaDni(t.data_operacji, x.d.data);          // dodatnie: paragon wcześniej niż wpływ
      if (dni < -7 || dni > 60) return null;
      const dokladnie = Math.abs(x.zostalo - reszta) < 0.01;
      const miesci = x.zostalo <= reszta + 0.009;
      const tenPodmiot = !t.podmiot || t.podmiot === x.d.podmiot;
      return { ...x, dni, wynik: (dokladnie ? 0 : miesci ? 20 : 60) + Math.abs(dni) + (tenPodmiot ? 0 : 15) + (/przelew|kredyt|miesz/i.test(x.d.forma_platnosci) ? 0 : 5) };
    })
    .filter(Boolean)
    .sort((a, b) => a.wynik - b.wynik);
}

function propozycjeWplywow(d) {
  const reszta = zostaloParagonu(d);
  return dane.transakcje
    .filter(czyWplywDoRozliczenia)
    .map(t => ({ t, zostalo: zostaloWplywu(t) }))
    .filter(x => x.zostalo > 0.004)
    .map(x => {
      const dni = roznicaDni(x.t.data_operacji, d.data);
      if (dni < -7 || dni > 60) return null;
      const dokladnie = Math.abs(x.zostalo - reszta) < 0.01;
      const wystarczy = x.zostalo >= reszta - 0.009;
      return { ...x, dni, wynik: (dokladnie ? 0 : wystarczy ? 20 : 60) + Math.abs(dni) + (!x.t.podmiot || x.t.podmiot === d.podmiot ? 0 : 15) };
    })
    .filter(Boolean)
    .sort((a, b) => a.wynik - b.wynik);
}

// ───────────────────────── zapis ─────────────────────────

async function rozlicz(t, d, kwota) {
  kwota = zaokr(kwota);
  const maks = Math.min(zostaloWplywu(t), zostaloParagonu(d));
  if (!(kwota > 0)) return toast('Wpisz kwotę większą od zera.', 'blad');
  if (kwota > maks + 0.009) return toast(`Najwyżej ${kwotaTxt(maks, t.waluta)} – tyle zostało do rozliczenia.`, 'blad');
  const r = {
    id: uuid(), obiekt_typ: 'paragon', obiekt_id: kluczParagonu(d), transakcja_id: t.id, kwota, waluta: t.waluta || 'PLN',
    kwota_pln: (t.waluta || 'PLN') === 'PLN' ? kwota : (t.kurs ? zaokr(kwota * Number(t.kurs)) : ''), data: dataLok(),
    sposob: 'ręcznie', status: 'aktywne', uwagi: `${d.numer} (${d.podmiot})`,
  };
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

/** Pozostałą (nierozliczoną) część wpływu wydziela jako osobną część z inną kategorią – jak podział transakcji. */
async function wydzielReszte(t, wybor) {
  const rozl = rozliczonoTransakcji(t.id);
  const reszta = zostaloWplywu(t);
  if (!(rozl > 0) || !(reszta > 0)) return;
  const nazwa = wybor.split('||')[0].slice(2);
  const podzialId = t.podzial_id || uuid();
  const kurs = Number(t.kurs) || ((t.waluta || 'PLN') === 'PLN' ? 1 : 0);
  const pln = v => (kurs ? zaokr(v * kurs) : '');
  const glowna = { ...t, kwota: rozl, kwota_pln: pln(rozl), podzial_id: podzialId };
  const czesc = {
    ...t, id: uuid(), kwota: reszta, kwota_pln: pln(reszta), podzial_id: podzialId, typ: 'wpływ',
    zrodlo_przychodu: nazwa, kategoria: '', podkategoria: '',
  };
  await sync.zapisz('TRANSAKCJE', [glowna, czesc]);
  await wczytajDane();
  toast(`Wydzielono ${kwotaTxt(reszta, t.waluta)} jako „${nazwa}”.`, 'ok');
}

// ───────────────────────── widoki ─────────────────────────

const stan = { zakladka: 'wplywy', szukaj: '', biezacy: null };

function wierszWplywu(t) {
  const rozl = rozliczonoTransakcji(t.id);
  return `<li><a class="wiersz-rozl" href="#rozliczenie/${encodeURIComponent(t.id)}">
    <span class="data-rozl">${esc(dataKrotko(t.data_operacji))}</span>
    <span class="opis-rozl"><b>${esc(t.kontrahent || t.opis || 'Wpływ')}</b>
      <span><span class="etykieta-konta" style="--k:${esc(kolorKonta(t.konto))}">${esc(t.konto)}</span> ${esc(t.opis && t.opis !== t.kontrahent ? t.opis : '')}</span></span>
    <span class="kwoty-rozl"><b>${esc(kwotaTxt(num(t.kwota), t.waluta))}</b>
      <span>${rozl ? `rozliczono ${esc(kwotaTxt(rozl, t.waluta))} · ` : ''}zostało ${esc(kwotaTxt(zostaloWplywu(t), t.waluta))}</span></span>
  </a></li>`;
}

function wierszParagonu(d) {
  const rozl = rozliczonoParagonu(kluczParagonu(d));
  return `<li><a class="wiersz-rozl" href="#rozliczenie/p:${encodeURIComponent(kluczParagonu(d))}">
    <span class="data-rozl">${esc(dataKrotko(d.data))}</span>
    <span class="opis-rozl"><b>${esc(d.numer)} <span class="znacznik">${esc(d.podmiot)}</span></b>
      <span>${esc([d.magazyn, d.kontrahent, d.forma_platnosci].filter(Boolean).join(' · '))}</span></span>
    <span class="kwoty-rozl"><b>${esc(kwotaTxt(bezgotowkowo(d)))}</b>
      <span>${rozl ? `rozliczono ${esc(kwotaTxt(rozl))} · ` : ''}zostało ${esc(kwotaTxt(zostaloParagonu(d)))}</span></span>
  </a></li>`;
}

const pasujeSzukaj = (...pola) => !stan.szukaj || pola.join(' ').toLowerCase().includes(stan.szukaj.toLowerCase());

function renderLista() {
  const wplywy = dane.transakcje.filter(t => czyWplywDoRozliczenia(t) && zostaloWplywu(t) > 0.004)
    .filter(t => pasujeSzukaj(t.kontrahent, t.opis, t.kwota, t.konto))
    .sort((a, b) => String(b.data_operacji).localeCompare(String(a.data_operacji)));
  const paragony = dane.sprzedaz.filter(d => zostaloParagonu(d) > 0.004)
    .filter(d => pasujeSzukaj(d.numer, d.kontrahent, d.brutto, d.magazyn))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const rozliczone = aktywne().sort((a, b) => String(b.utworzono || b.data).localeCompare(String(a.utworzono || a.data))).slice(0, 100);
  const sumaW = zaokr(wplywy.reduce((s, t) => s + zostaloWplywu(t), 0));
  const sumaP = zaokr(paragony.reduce((s, d) => s + zostaloParagonu(d), 0));
  const zakladki = [['wplywy', `Wpływy do rozliczenia (${wplywy.length})`], ['paragony', `Paragony do rozliczenia (${paragony.length})`], ['rozliczone', 'Ostatnio rozliczone']];
  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran">
    <div class="naglowek-sekcji"><h1>Rozliczenia</h1></div>
    <p class="uwagi-podsumowania">Wpływy z banku (sprzedaż i nieskategoryzowane) łączysz z paragonami z Subiektu. Kwoty nie muszą być równe – resztę wpływu rozliczysz kolejnym paragonem albo przypiszesz jej kategorię.</p>
    <div class="kafle-wskaznikow dwa">
      <div class="wskaznik"><span class="etykieta-wsk">Wpływy bez paragonu</span><b>${esc(kwotaTxt(sumaW))}</b><span class="zmiana">${wplywy.length} ${odmiana(wplywy.length, 'wpływ', 'wpływy', 'wpływów')}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Paragony bez wpływu</span><b>${esc(kwotaTxt(sumaP))}</b><span class="zmiana">część bezgotówkowa, ${paragony.length} ${odmiana(paragony.length, 'paragon', 'paragony', 'paragonów')}</span></div>
    </div>
    <div class="pasek-filtrow">
      <div class="chipy male" role="tablist">${zakladki.map(([v, e]) => `<button type="button" class="chip" data-akcja="zakladka" data-v="${v}" aria-pressed="${stan.zakladka === v}">${esc(e)}</button>`).join('')}</div>
      <input type="search" name="szukaj-rozl" placeholder="Szukaj: nazwisko, numer, kwota" value="${esc(stan.szukaj)}" class="szukaj-rozl">
    </div>
    ${stan.zakladka === 'wplywy' ? `<ul class="lista-rozl">${wplywy.map(wierszWplywu).join('') || '<li class="pusto">Wszystkie wpływy ze sprzedaży są rozliczone.</li>'}</ul>` : ''}
    ${stan.zakladka === 'paragony' ? `<ul class="lista-rozl">${paragony.map(wierszParagonu).join('') || '<li class="pusto">Brak paragonów bezgotówkowych do rozliczenia.</li>'}</ul>` : ''}
    ${stan.zakladka === 'rozliczone' ? `<ul class="lista-rozl">${rozliczone.map(r => {
      const t = dane.transakcje.find(x => x.id === r.transakcja_id);
      return `<li class="wiersz-rozl">
        <span class="data-rozl">${esc(dataKrotko(String(r.data).slice(0, 10)))}</span>
        <span class="opis-rozl"><b>${esc(r.uwagi || r.obiekt_id)}</b><span>${t ? `<a href="#rozliczenie/${encodeURIComponent(t.id)}">${esc(t.kontrahent || 'wpływ')} · ${esc(dataKrotko(t.data_operacji))}</a>` : 'wpływ niedostępny'}</span></span>
        <span class="kwoty-rozl"><b>${esc(kwotaTxt(num(r.kwota), r.waluta))}</b><button type="button" class="przycisk-maly drugorzedny" data-akcja="cofnij-rozl" data-v="${esc(r.id)}">Cofnij</button></span>
      </li>`;
    }).join('') || '<li class="pusto">Nic jeszcze nie rozliczono.</li>'}</ul>` : ''}
  </section>`;
}

function htmlPowiazanych(rozl, opis) {
  if (!rozl.length) return '';
  return `<ul class="lista-rozl powiazane">${rozl.map(r => `<li class="wiersz-rozl">
    <span class="opis-rozl"><b>${opis(r)}</b><span>rozliczono ${esc(dataKrotko(String(r.data).slice(0, 10)))}</span></span>
    <span class="kwoty-rozl"><b>${esc(kwotaTxt(num(r.kwota), r.waluta))}</b><button type="button" class="przycisk-maly drugorzedny" data-akcja="cofnij-rozl" data-v="${esc(r.id)}">Cofnij</button></span>
  </li>`).join('')}</ul>`;
}

function opcjeReszty() {
  const opcje = glowne('wpływ').map(k => [`P:${k.nazwa}||`, k.nazwa, podrzedne('wpływ', k.nazwa)]);
  return `<option value="">— przypisz źródło przychodu —</option>${opcje.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('')}`;
}

function renderWplyw(id) {
  const t = dane.transakcje.find(x => x.id === id);
  if (!t) { $('#widok').innerHTML = '<section class="ekran"><p class="pusto">Nie ma takiej transakcji na tym urządzeniu.</p><a href="#rozliczenia">Rozliczenia</a></section>'; return; }
  const rozl = aktywne().filter(r => r.transakcja_id === t.id);
  const zostalo = zostaloWplywu(t);
  const propozycje = propozycjeParagonow(t).filter(x => pasujeSzukaj(x.d.numer, x.d.kontrahent, x.d.brutto, x.d.magazyn)).slice(0, 25);
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
        <div><dt>Rozliczono paragonami</dt><dd>${esc(kwotaTxt(rozliczonoTransakcji(t.id), t.waluta))}</dd></div>
        <div><dt>Zostało</dt><dd><b class="${zostalo > 0 ? 'do-rozl' : 'plus'}">${esc(kwotaTxt(zostalo, t.waluta))}</b></dd></div>
      </dl>
      ${htmlPowiazanych(rozl, r => {
        const d = dane.sprzedaz.find(x => kluczParagonu(x) === r.obiekt_id);
        return d ? `<a href="#rozliczenie/p:${encodeURIComponent(r.obiekt_id)}">${esc(d.numer)}</a> <span class="znacznik">${esc(d.podmiot)}</span> ${esc(dataKrotko(d.data))}` : esc(r.uwagi || r.obiekt_id);
      })}
      ${zostalo > 0.004 && rozl.length ? `<div class="reszta-rozl">
        <span>Pozostałe <b>${esc(kwotaTxt(zostalo, t.waluta))}</b> to nie sprzedaż z paragonu?</span>
        <select name="reszta-kat">${opcjeReszty()}</select>
        <button type="button" class="przycisk-maly" data-akcja="wydziel" data-v="${esc(t.id)}">Wydziel jako osobną część</button>
      </div>` : ''}
    </div>
    ${zostalo > 0.004 ? `
    <div class="naglowek-listy-importu"><b>Paragony do wyboru</b>
      <input type="search" name="szukaj-rozl" placeholder="numer, kontrahent, kwota" value="${esc(stan.szukaj)}" class="szukaj-rozl"></div>
    <ul class="lista-rozl">${propozycje.map(({ d, zostalo: zp }) => {
      const domyslna = Math.min(zp, zostalo);
      return `<li class="wiersz-rozl propozycja">
        <span class="data-rozl">${esc(dataKrotko(d.data))}</span>
        <span class="opis-rozl"><b>${esc(d.numer)} <span class="znacznik">${esc(d.podmiot)}</span>${Math.abs(zp - zostalo) < 0.01 ? ' <span class="znacznik potw">ta sama kwota</span>' : ''}</b>
          <span>${esc([d.magazyn, d.kontrahent, d.forma_platnosci].filter(Boolean).join(' · '))} · do rozliczenia ${esc(kwotaTxt(zp))}</span></span>
        <span class="akcja-rozl"><input name="kwota-rozl" data-p="${esc(kluczParagonu(d))}" inputmode="decimal" value="${esc(liczbaNaTekst(domyslna))}" aria-label="Kwota">
          <button type="button" class="przycisk-maly" data-akcja="rozlicz" data-p="${esc(kluczParagonu(d))}" data-t="${esc(t.id)}">Rozlicz</button></span>
      </li>`;
    }).join('') || '<li class="pusto">Brak pasujących paragonów (szukam od 60 dni przed do 7 dni po wpływie). Sprawdź, czy sprzedaż z tego okresu jest wklejona.</li>'}</ul>` : '<p class="komunikat ok">Wpływ jest w całości rozliczony.</p>'}
  </section>`;
}

function renderParagon(klucz) {
  const d = dane.sprzedaz.find(x => kluczParagonu(x) === klucz);
  if (!d) { $('#widok').innerHTML = '<section class="ekran"><p class="pusto">Nie ma takiego paragonu na tym urządzeniu.</p><a href="#rozliczenia">Rozliczenia</a></section>'; return; }
  const rozl = aktywne().filter(r => r.obiekt_typ === 'paragon' && r.obiekt_id === klucz);
  const zostalo = zostaloParagonu(d);
  const poz = dane.sprzedazPoz.filter(p => p.podmiot === d.podmiot && String(p.dok_id) === String(d.dok_id));
  const propozycje = propozycjeWplywow(d).filter(x => pasujeSzukaj(x.t.kontrahent, x.t.opis, x.t.kwota)).slice(0, 25);
  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran">
    <a class="wstecz" href="#rozliczenia">Rozliczenia</a>
    <div class="naglowek-sekcji"><h1>Paragon ${esc(d.numer)}</h1><span class="znacznik">${esc(d.podmiot)}</span></div>
    <div class="karta-ustawien">
      <dl class="info">
        <div><dt>Data, magazyn</dt><dd>${esc(dataSlownie(d.data))} · ${esc(d.magazyn || '')}</dd></div>
        ${d.kontrahent ? `<div><dt>Kontrahent</dt><dd>${esc(d.kontrahent)}</dd></div>` : ''}
        <div><dt>Wartość brutto</dt><dd><b>${esc(kwotaTxt(num(d.brutto)))}</b> (${esc(d.forma_platnosci || '')})</dd></div>
        <div><dt>Bezgotówkowo</dt><dd>${esc(kwotaTxt(bezgotowkowo(d)))}</dd></div>
        <div><dt>Zostało do rozliczenia</dt><dd><b class="${zostalo > 0 ? 'do-rozl' : 'plus'}">${esc(kwotaTxt(zostalo))}</b></dd></div>
      </dl>
      ${poz.length ? `<details><summary>Pozycje (${poz.length})</summary><table class="tabela"><tbody>${poz.map(p => `<tr><td>${esc(p.symbol)}</td><td>${esc(p.nazwa)}</td><td class="liczba">${esc(kwotaTxt(num(p.brutto)))}</td></tr>`).join('')}</tbody></table></details>` : ''}
      ${htmlPowiazanych(rozl, r => {
        const t = dane.transakcje.find(x => x.id === r.transakcja_id);
        return t ? `<a href="#rozliczenie/${encodeURIComponent(t.id)}">${esc(t.kontrahent || 'wpływ')}</a> ${esc(kwotaTxt(num(t.kwota), t.waluta))} · ${esc(dataKrotko(t.data_operacji))}` : 'wpływ niedostępny';
      })}
    </div>
    ${zostalo > 0.004 ? `
    <div class="naglowek-listy-importu"><b>Wpływy do wyboru</b>
      <input type="search" name="szukaj-rozl" placeholder="nazwisko, kwota" value="${esc(stan.szukaj)}" class="szukaj-rozl"></div>
    <ul class="lista-rozl">${propozycje.map(({ t, zostalo: zt }) => `<li class="wiersz-rozl propozycja">
        <span class="data-rozl">${esc(dataKrotko(t.data_operacji))}</span>
        <span class="opis-rozl"><b>${esc(t.kontrahent || 'Wpływ')}${Math.abs(zt - zostalo) < 0.01 ? ' <span class="znacznik potw">ta sama kwota</span>' : ''}</b>
          <span>${esc(t.konto)} · ${esc(t.opis || '')} · zostało ${esc(kwotaTxt(zt, t.waluta))} z ${esc(kwotaTxt(num(t.kwota), t.waluta))}</span></span>
        <span class="akcja-rozl"><input name="kwota-rozl" data-t="${esc(t.id)}" inputmode="decimal" value="${esc(liczbaNaTekst(Math.min(zt, zostalo)))}" aria-label="Kwota">
          <button type="button" class="przycisk-maly" data-akcja="rozlicz" data-p="${esc(klucz)}" data-t="${esc(t.id)}">Rozlicz</button></span>
      </li>`).join('') || '<li class="pusto">Brak pasujących wpływów (szukam od 7 dni przed do 60 dni po paragonie).</li>'}</ul>` : '<p class="komunikat ok">Paragon jest rozliczony.</p>'}
  </section>`;
}

function render(arg) {
  stan.biezacy = arg || null;
  if (!arg) renderLista();
  else if (arg.startsWith('p:')) renderParagon(arg.slice(2));
  else renderWplyw(arg);
}

function rysujBiezacy() { render(stan.biezacy); }

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'zakladka') { stan.zakladka = v; bezSkoku(rysujBiezacy); return; }
  if (akcja === 'cofnij-rozl') {
    const tak = await okno('Cofnąć rozliczenie?', '<p>Paragon i wpływ wrócą do listy do rozliczenia.</p>',
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
  if (akcja === 'wydziel') {
    const t = dane.transakcje.find(x => x.id === v);
    const wybor = $('select[name="reszta-kat"]').value;
    if (!wybor) return toast('Wybierz źródło przychodu dla reszty.', 'blad');
    await wydzielReszte(t, wybor);
    bezSkoku(rysujBiezacy);
  }
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

export const ekran = { render, klik, wejscie };
