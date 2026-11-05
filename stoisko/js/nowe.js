// Ekran „Nowe zamówienie”: produkty z katalogu (warianty gramatur i rozmiarów), ceny klienta (grupa, rabat,
// ceny specjalne) i ręczna cena po rabacie, dostawa, forma płatności. Zatwierdzenie zapisuje zamówienie
// na urządzeniu (także bez internetu) i otwiera SMS albo WhatsApp z podsumowaniem.

import { $, $$, esc, zaokr, kwotaTxt, iloscTxt, liczba, liczbaNaTekst, uuid, dataLok, toast, num, odmiana } from './util.js';
import { dane, wczytaj, szukajProduktow, nastepnyNumer, zapamietajNumer, klientPoTelefonie, telefonE164, klient as klientId,
  produktSymbolu, cenaKlienta, opisCenKlienta, wysylkiAktywne, wysylka, kosztWysylki } from './dane.js';
import { ustawienia, gotowe } from './api.js';
import { FORMY, PLATNE_POZNIEJ, STATUSY } from './konfiguracja.js';
import * as sync from './sync.js';

const SZKIC = 'or-stoisko-szkic';
const pusty = () => ({ koszyk: [], telefon: '', nazwa: '', email: '', forma: 'Przelew', uwagi: '', szukaj: '', grupa: '',
  klientId: '', dostawaId: '', adres: '', kosztTxt: '' });

let s = (() => {
  try { return { ...pusty(), ...JSON.parse(localStorage.getItem(SZKIC)) }; } catch { return pusty(); }
})();
let zapisuje = false;

const zachowaj = () => { try { localStorage.setItem(SZKIC, JSON.stringify(s)); } catch { /* bez znaczenia */ } };

// ───────────────────────── ceny ─────────────────────────

const biezacyKlient = () => klientId(s.klientId);
const cenaBazowa = p => (p.symbol && p.cena_cennik !== '' ? cenaKlienta(biezacyKlient(), p.symbol, num(p.cena_cennik)) : NaN);

/** Cena sztuki: puste pole = cena klienta (albo z cennika); „10%” albo „-10%” = rabat procentowy od ceny z cennika. */
function cena(p) {
  const t = String(p.cenaTxt ?? '').trim();
  const cennik = p.cena_cennik === '' ? NaN : num(p.cena_cennik);
  if (!t) return cenaBazowa(p);
  const proc = /^-?\s*(\d+(?:[.,]\d+)?)\s*%$/.exec(t);
  if (proc) return isFinite(cennik) ? zaokr(cennik * (1 - liczba(proc[1]) / 100)) : NaN;
  return zaokr(liczba(t));
}
const ilosc = p => liczba(p.iloscTxt ?? '1');
const wartosc = p => zaokr(cena(p) * ilosc(p));
const sumaProduktow = () => zaokr(s.koszyk.reduce((a, p) => a + (isFinite(wartosc(p)) ? wartosc(p) : 0), 0));
function kosztDostawy() {
  if (!s.dostawaId) return 0;
  const t = String(s.kosztTxt || '').trim();
  if (t) return isFinite(liczba(t)) ? zaokr(liczba(t)) : 0;
  return kosztWysylki(wysylka(s.dostawaId), sumaProduktow());
}
const suma = () => zaokr(sumaProduktow() + kosztDostawy());

function opisRabatu(p) {
  const c = cena(p);
  if (p.cena_cennik === '' || !isFinite(c)) return '';
  const r = zaokr(num(p.cena_cennik) - c);
  if (Math.abs(r) < 0.005) return '';
  if (r < 0) return `cena wyższa od cennika o ${kwotaTxt(-r)}`;
  return `rabat ${kwotaTxt(r * ilosc(p) || r)} (${Math.round((r / num(p.cena_cennik)) * 100)}%)`;
}

// ───────────────────────── widok ─────────────────────────

function htmlWynikow() {
  if (!dane.produkty.length) {
    return `<p class="pusto">Katalog jest pusty. Połącz się z internetem, żeby go pobrać, albo dodaj pozycję spoza cennika.</p>`;
  }
  const lista = szukajProduktow(s.szukaj, s.grupa, s.szukaj || s.grupa ? 60 : 24);
  if (!lista.length) return `<p class="pusto">Nic nie pasuje do „${esc(s.szukaj)}”. Możesz dodać pozycję spoza cennika.</p>`;
  const wKoszyku = new Map();
  s.koszyk.forEach(p => { if (p.symbol) wKoszyku.set(p.symbol, (wKoszyku.get(p.symbol) || 0) + (ilosc(p) || 0)); });
  const k = biezacyKlient();
  const przycisk = w => {
    const c = cenaKlienta(k, w.symbol, w.cena);
    const ile = wKoszyku.get(w.symbol);
    return `<button type="button" class="wariant${ile ? ' wybrany' : ''}" data-akcja="dodaj" data-symbol="${esc(w.symbol)}">
      ${w.wariant ? `<span class="w-nazwa">${esc(w.wariant)}</span>` : '<span class="w-nazwa">Dodaj</span>'}
      <b>${c !== w.cena ? `<s>${esc(kwotaTxt(w.cena))}</s> ` : ''}${esc(kwotaTxt(c))}</b>
      ${ile ? `<span class="w-ile">×${esc(iloscTxt(ile))}</span>` : ''}</button>`;
  };
  return `${!s.szukaj && !s.grupa ? '<p class="podtytul">Najczęściej sprzedawane</p>' : ''}
    <ul class="produkty">${lista.map(p => `<li class="produkt">
      <div class="p-gora">
        ${p.zdjecie ? `<img class="p-zdj" src="${esc(p.zdjecie)}" alt="" loading="lazy">` : ''}
        <span class="p-nazwa">${esc(p.produkt)}<small>${esc(p.kategoria)}${p.warianty.length === 1 ? ' · ' + esc(p.warianty[0].symbol) : ''}</small></span>
      </div>
      <div class="warianty">${p.warianty.map(przycisk).join('')}</div>
    </li>`).join('')}</ul>`;
}

function htmlPozycji(p) {
  const c = cena(p);
  const w = wartosc(p);
  return `<li data-k="${esc(p.k)}">
    <div class="poz-gora">
      ${p.symbol
        ? `<span class="poz-nazwa">${esc(p.nazwa)}<small>${esc(p.symbol)} · cennik ${esc(kwotaTxt(num(p.cena_cennik)))}${cenaBazowa(p) !== num(p.cena_cennik) ? ' · dla klienta ' + esc(kwotaTxt(cenaBazowa(p))) : ''}</small></span>`
        : `<label class="poz-nazwa"><span class="sr">Nazwa</span><input data-pole="nazwa" value="${esc(p.nazwa)}" placeholder="Nazwa produktu" autocomplete="off"></label>`}
      <button type="button" class="usun" data-akcja="usun" aria-label="Usuń ${esc(p.nazwa || 'pozycję')}">×</button>
    </div>
    <div class="poz-dol">
      <div class="stepper">
        <button type="button" data-akcja="minus" aria-label="Mniej">−</button>
        <input data-pole="ilosc" inputmode="decimal" aria-label="Ilość" value="${esc(p.iloscTxt ?? '1')}">
        <button type="button" data-akcja="plus" aria-label="Więcej">+</button>
      </div>
      <label class="cena"><span>${p.symbol ? 'Cena szt. (po rabacie)' : 'Cena szt.'}</span>
        <input data-pole="cena" inputmode="decimal" autocomplete="off" value="${esc(p.cenaTxt ?? '')}"
          placeholder="${p.symbol ? esc(liczbaNaTekst(cenaBazowa(p))) : '0,00'}"></label>
      <b class="poz-wartosc">${isFinite(w) ? esc(kwotaTxt(w)) : '—'}</b>
    </div>
    <small class="poz-rabat${!isFinite(c) && p.cenaTxt ? ' blad' : ''}">${!isFinite(c) && p.cenaTxt ? 'Nieprawidłowa cena' : esc(opisRabatu(p))}</small>
  </li>`;
}

function htmlKoszyka() {
  if (!s.koszyk.length) return '<p class="pusto">Dotknij produktu, żeby dodać go do zamówienia.</p>';
  return `<ul class="pozycje">${s.koszyk.map(htmlPozycji).join('')}</ul>`;
}

function opisKlienta() {
  const k = biezacyKlient();
  if (k) {
    const ceny = opisCenKlienta(k);
    return `Stały klient: ${k.nazwa || 'bez nazwy'}${k.email ? ' · ' + k.email : ''}${ceny ? ' · ' + ceny : ''}`;
  }
  const e = telefonE164(s.telefon);
  if (!s.telefon) return 'Telefon jest potrzebny do wysłania SMS-a lub WhatsAppa.';
  if (!e) return 'Sprawdź numer – 9 cyfr albo z kierunkowym, np. +44…';
  return 'Nowy klient – zapisze się na liście klientów.';
}

function htmlDostawy() {
  const lista = wysylkiAktywne();
  const w = wysylka(s.dostawaId);
  const auto = kosztWysylki(w, sumaProduktow());
  return `<div class="chipy formy dostawy">
      <button type="button" class="chip" data-akcja="dostawa" data-id="" aria-pressed="${!s.dostawaId}">Na miejscu</button>
      ${lista.map(x => `<button type="button" class="chip" data-akcja="dostawa" data-id="${esc(x.id)}" aria-pressed="${s.dostawaId === String(x.id)}">${esc(x.nazwa)}</button>`).join('')}
    </div>
    ${!lista.length ? '<p class="podpowiedz">Metody wysyłki dodasz w zakładce Sklep.</p>' : ''}
    ${w ? `${w.opis ? `<p class="podpowiedz">${esc(w.opis)}</p>` : ''}
      ${String(w.wymaga_adresu) === 'true' || w.wymaga_adresu === true ? `<label class="pole"><span class="etykieta">Adres dostawy / paczkomat</span>
        <textarea data-pole="adres" rows="2">${esc(s.adres)}</textarea></label>` : ''}
      <label class="pole"><span class="etykieta">Koszt dostawy</span>
        <input data-pole="koszt" inputmode="decimal" autocomplete="off" value="${esc(s.kosztTxt)}" placeholder="${esc(liczbaNaTekst(auto))}">
        <span class="podpowiedz">Z cennika wysyłek: ${esc(kwotaTxt(auto))}${w.darmowa_od !== '' && w.darmowa_od != null ? ` (darmowa od ${esc(kwotaTxt(num(w.darmowa_od)))})` : ''}. Wpisz inną kwotę, żeby ją zmienić.</span></label>` : ''}`;
}

export function render() {
  if (!gotowe()) { location.replace('#ustawienia'); return; }
  const u = ustawienia();
  const kontekst = [u.wydarzenie, u.magazyn, u.podmiot].filter(Boolean).join(' · ');
  $('#widok').innerHTML = `
  <section class="ekran nowe">
    <header class="naglowek-zam">
      <div><span class="etykieta">Nowe zamówienie</span><h1 class="numer">${esc(nastepnyNumer())}</h1></div>
      <a class="kontekst" href="#ustawienia" title="Zmień w Ustawieniach">${esc(kontekst || 'Ustaw wydarzenie i magazyn')}</a>
    </header>
    <div class="uklad-zam">
      <div class="kolumna-produkty">
        <label class="pole szukaj"><span class="sr">Szukaj produktu</span>
          <input type="search" data-pole="szukaj" value="${esc(s.szukaj)}" placeholder="Szukaj: nazwa lub symbol" autocomplete="off" enterkeyhint="search"></label>
        ${dane.grupy.length ? `<div class="chipy male grupy">${dane.grupy.map(g => `<button type="button" class="chip" data-akcja="grupa" data-grupa="${esc(g)}" aria-pressed="${s.grupa === g}">${esc(g)}</button>`).join('')}</div>` : ''}
        <div id="wyniki">${htmlWynikow()}</div>
        <button type="button" class="drugorzedny szeroki" data-akcja="spoza">+ Pozycja spoza cennika</button>
      </div>

      <div class="kolumna-koszyk">
        <article class="panel koszyk" id="panel-koszyka">
          <header><h2>Zamówienie</h2>${s.koszyk.length ? '<button type="button" class="link" data-akcja="wyczysc">Wyczyść</button>' : ''}</header>
          <div id="koszyk">${htmlKoszyka()}</div>
          <div class="suma"><span>Razem<small id="suma-opis">${esc(opisSumy())}</small></span><b id="suma">${esc(kwotaTxt(suma()))}</b></div>
        </article>

        <article class="panel">
          <h2>Klient</h2>
          <label class="pole"><span class="etykieta">Telefon</span>
            <input data-pole="telefon" type="tel" inputmode="tel" autocomplete="off" value="${esc(s.telefon)}" placeholder="np. 600 100 200">
            <span class="podpowiedz" id="opis-klienta">${esc(opisKlienta())}</span></label>
          <label class="pole"><span class="etykieta">Imię i nazwisko</span>
            <input data-pole="nazwa-klienta" autocomplete="off" list="lista-klientow" value="${esc(s.nazwa)}" placeholder="Wpisz albo wybierz stałego klienta">
            <datalist id="lista-klientow">${dane.klienci.filter(k => k.nazwa).map(k => `<option value="${esc(k.nazwa)}">`).join('')}</datalist></label>
          <label class="pole"><span class="etykieta">E-mail (nieobowiązkowo)</span>
            <input data-pole="email" type="email" inputmode="email" autocomplete="off" value="${esc(s.email)}"></label>
        </article>

        <article class="panel">
          <h2>Dostawa</h2>
          <div id="dostawa">${htmlDostawy()}</div>
        </article>

        <article class="panel">
          <h2>Płatność</h2>
          <div class="chipy formy">${FORMY.map(([w, e]) => `<button type="button" class="chip" data-akcja="forma" data-forma="${esc(w)}" aria-pressed="${s.forma === w}">${esc(e)}</button>`).join('')}</div>
          <p class="podpowiedz" id="opis-formy">${PLATNE_POZNIEJ.has(s.forma) ? 'Klient zapłaci później – w wiadomości będą dane do przelewu i BLIK.' : 'Zapłacone na miejscu – wiadomość będzie potwierdzeniem zakupu.'}</p>
          <label class="pole"><span class="etykieta">Uwagi (nieobowiązkowo)</span>
            <textarea data-pole="uwagi" rows="2">${esc(s.uwagi)}</textarea></label>
        </article>

        <div class="zatwierdz">
          <button type="button" class="glowny" data-akcja="zatwierdz" data-kanal="sms">Zatwierdź i wyślij SMS</button>
          <button type="button" class="whatsapp" data-akcja="zatwierdz" data-kanal="wa">Zatwierdź i wyślij WhatsApp</button>
          <button type="button" class="link" data-akcja="zatwierdz" data-kanal="">Zatwierdź bez wiadomości</button>
        </div>
      </div>
    </div>
    <button type="button" class="pasek-sumy" data-akcja="do-koszyka" ${s.koszyk.length ? '' : 'hidden'}>${htmlPaska()}</button>
  </section>`;
}

function htmlPaska() {
  const n = s.koszyk.length;
  return `<span>${n} ${odmiana(n, 'pozycja', 'pozycje', 'pozycji')} · zobacz zamówienie ↓</span><b>${esc(kwotaTxt(suma()))}</b>`;
}
function odswiezPasek() {
  const p = $('.pasek-sumy');
  if (!p) return;
  p.hidden = !s.koszyk.length;
  p.innerHTML = htmlPaska();
}

function opisSumy() {
  const d = kosztDostawy();
  return s.dostawaId ? `produkty ${kwotaTxt(sumaProduktow())} + dostawa ${kwotaTxt(d)}` : '';
}
function odswiezSume() {
  $('#suma').textContent = kwotaTxt(suma());
  $('#suma-opis').textContent = opisSumy();
  odswiezPasek();
}
function odswiezWyniki() { $('#wyniki').innerHTML = htmlWynikow(); }
function odswiezDostawe() { $('#dostawa').innerHTML = htmlDostawy(); }
/** Klient zmienił się – ceny w koszyku i na kartach produktów liczą się od nowa. */
function ustawKlienta(k) {
  const nowyId = k ? String(k.id) : '';
  if (nowyId === s.klientId) return;
  s.klientId = nowyId;
  odswiezKoszyk();
  odswiezWyniki();
}
function odswiezKoszyk() {
  $('#koszyk').innerHTML = htmlKoszyka();
  odswiezSume();
  const nag = $('.koszyk header');
  const w = $('[data-akcja="wyczysc"]', nag);
  if (s.koszyk.length && !w) nag.insertAdjacentHTML('beforeend', '<button type="button" class="link" data-akcja="wyczysc">Wyczyść</button>');
  if (!s.koszyk.length && w) w.remove();
  odswiezPasek();
}
function odswiezPozycje(li, p) {
  const c = cena(p);
  const w = wartosc(p);
  $('.poz-wartosc', li).textContent = isFinite(w) ? kwotaTxt(w) : '—';
  const r = $('.poz-rabat', li);
  const zla = !isFinite(c) && String(p.cenaTxt || '').trim();
  r.textContent = zla ? 'Nieprawidłowa cena' : opisRabatu(p);
  r.classList.toggle('blad', Boolean(zla));
  odswiezSume();
  if (s.dostawaId && !String(s.kosztTxt || '').trim()) {
    const pole = $('[data-pole="koszt"]');
    if (pole) pole.placeholder = liczbaNaTekst(kosztWysylki(wysylka(s.dostawaId), sumaProduktow()));
  }
}

// ───────────────────────── zdarzenia ─────────────────────────

const pozycjaZ = el => {
  const li = el.closest('li[data-k]');
  return li ? [li, s.koszyk.find(p => p.k === li.dataset.k)] : [null, null];
};

function wejscie(e) {
  const pole = e.target.dataset.pole;
  if (!pole) return;
  const v = e.target.value;
  if (pole === 'szukaj') { s.szukaj = v; odswiezWyniki(); }
  else if (pole === 'telefon') {
    s.telefon = v;
    const k = klientPoTelefonie(v);
    if (k) {
      if (!s.nazwa && k.nazwa) { s.nazwa = k.nazwa; $('[data-pole="nazwa-klienta"]').value = k.nazwa; }
      if (!s.email && k.email) { s.email = k.email; $('[data-pole="email"]').value = k.email; }
    }
    ustawKlienta(k || (biezacyKlient() && !telefonE164(biezacyKlient().telefon) ? biezacyKlient() : null));
    $('#opis-klienta').textContent = opisKlienta();
  }
  else if (pole === 'nazwa-klienta') {
    s.nazwa = v;
    const k = dane.klienci.find(x => x.nazwa && String(x.nazwa).trim().toLowerCase() === v.trim().toLowerCase());
    if (k && String(k.id) !== s.klientId) {
      ustawKlienta(k);
      if (k.telefon) { s.telefon = telefonE164(k.telefon) || k.telefon; $('[data-pole="telefon"]').value = s.telefon; }
      if (!s.email && k.email) { s.email = k.email; $('[data-pole="email"]').value = k.email; }
      if (!s.adres && k.adres) s.adres = k.adres;
      $('#opis-klienta').textContent = opisKlienta();
    }
  }
  else if (pole === 'adres') s.adres = v;
  else if (pole === 'koszt') { s.kosztTxt = v; odswiezSume(); }
  else if (pole === 'email') s.email = v;
  else if (pole === 'uwagi') s.uwagi = v;
  else {
    const [li, p] = pozycjaZ(e.target);
    if (!p) return;
    if (pole === 'ilosc') p.iloscTxt = v;
    if (pole === 'cena') p.cenaTxt = v;
    if (pole === 'nazwa') p.nazwa = v;
    odswiezPozycje(li, p);
  }
  zachowaj();
}

function zmiana(e) {
  if (e.target.dataset.pole !== 'cena') return;
  // „10%” zamienia się po wyjściu z pola na wyliczoną cenę, żeby było widać, co trafi do zamówienia.
  const [li, p] = pozycjaZ(e.target);
  if (!p || !/%/.test(p.cenaTxt || '')) return;
  const c = cena(p);
  if (isFinite(c)) { p.cenaTxt = liczbaNaTekst(c); e.target.value = p.cenaTxt; odswiezPozycje(li, p); zachowaj(); }
}

function dodaj(symbol) {
  const prod = produktSymbolu(symbol);
  if (!prod) return;
  const jest = s.koszyk.find(p => p.symbol === symbol && !String(p.cenaTxt || '').trim());
  if (jest) jest.iloscTxt = liczbaNaTekst((ilosc(jest) || 0) + 1);
  else s.koszyk.push({ k: uuid(), symbol, nazwa: prod.nazwa, grupa: prod.kategoria, jm: prod.jm, cena_cennik: prod.cena, iloscTxt: '1', cenaTxt: '' });
  odswiezKoszyk();
  odswiezWyniki();
  toast(`Dodano: ${prod.nazwa}`, 'ok', 1500);
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const akcja = b.dataset.akcja;
  if (akcja === 'dodaj') dodaj(b.dataset.symbol);
  else if (akcja === 'do-koszyka') $('#panel-koszyka').scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (akcja === 'grupa') {
    s.grupa = s.grupa === b.dataset.grupa ? '' : b.dataset.grupa;
    $$('.grupy .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.grupa === s.grupa)));
    odswiezWyniki();
  } else if (akcja === 'spoza') {
    s.koszyk.push({ k: uuid(), symbol: '', nazwa: '', grupa: '', jm: 'szt.', cena_cennik: '', iloscTxt: '1', cenaTxt: '' });
    odswiezKoszyk();
    $(`li[data-k="${s.koszyk[s.koszyk.length - 1].k}"] [data-pole="nazwa"]`)?.focus();
  } else if (akcja === 'usun' || akcja === 'minus' || akcja === 'plus') {
    const [li, p] = pozycjaZ(b);
    if (!p) return;
    if (akcja === 'usun') { s.koszyk = s.koszyk.filter(x => x !== p); odswiezKoszyk(); odswiezWyniki(); }
    else {
      const n = Math.max(1, Math.round(((ilosc(p) || 0) + (akcja === 'plus' ? 1 : -1)) * 1000) / 1000);
      p.iloscTxt = liczbaNaTekst(n);
      $('[data-pole="ilosc"]', li).value = p.iloscTxt;
      odswiezPozycje(li, p);
      odswiezWyniki();
    }
  } else if (akcja === 'wyczysc') {
    s.koszyk = [];
    odswiezKoszyk();
    odswiezWyniki();
  } else if (akcja === 'dostawa') {
    s.dostawaId = b.dataset.id;
    s.kosztTxt = '';
    if (s.dostawaId && !s.adres && biezacyKlient()?.adres) s.adres = biezacyKlient().adres;
    odswiezDostawe();
    odswiezSume();
  } else if (akcja === 'forma') {
    s.forma = b.dataset.forma;
    $$('.formy .chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.forma === s.forma)));
    $('#opis-formy').textContent = PLATNE_POZNIEJ.has(s.forma)
      ? 'Klient zapłaci później – w wiadomości będą dane do przelewu i BLIK.'
      : 'Zapłacone na miejscu – wiadomość będzie potwierdzeniem zakupu.';
  } else if (akcja === 'zatwierdz') {
    await zatwierdz(b.dataset.kanal, b);
    return;
  }
  zachowaj();
}

// ───────────────────────── zapis ─────────────────────────

function sprawdz(kanal) {
  if (!s.koszyk.length) return 'Dodaj przynajmniej jeden produkt.';
  for (const p of s.koszyk) {
    if (!String(p.nazwa || '').trim()) return 'Wpisz nazwę pozycji spoza cennika.';
    if (!(ilosc(p) > 0)) return `Sprawdź ilość: ${p.nazwa}.`;
    if (!isFinite(cena(p)) || cena(p) < 0) return `Sprawdź cenę: ${p.nazwa}.`;
  }
  if (s.telefon && !telefonE164(s.telefon)) return 'Sprawdź numer telefonu klienta.';
  if (kanal && !telefonE164(s.telefon)) return `Wpisz telefon klienta, żeby wysłać ${kanal === 'wa' ? 'WhatsApp' : 'SMS'}.`;
  if (s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) return 'Sprawdź adres e-mail.';
  if (s.dostawaId && String(s.kosztTxt || '').trim() && !isFinite(liczba(s.kosztTxt))) return 'Sprawdź koszt dostawy.';
  const w = wysylka(s.dostawaId);
  if (w && (w.wymaga_adresu === true || String(w.wymaga_adresu) === 'true') && !s.adres.trim()) return 'Wpisz adres dostawy (albo numer paczkomatu).';
  return '';
}

async function zatwierdz(kanal, przycisk) {
  if (zapisuje) return;
  const blad = sprawdz(kanal);
  if (blad) {
    toast(blad, 'blad', 5000);
    if (/telefon/i.test(blad)) $('[data-pole="telefon"]')?.focus();
    return;
  }
  zapisuje = true;
  przycisk.disabled = true;
  try {
    const u = ustawienia();
    const numer = nastepnyNumer();
    const paczki = { KLIENCI: [], ZAMOWIENIA: [], ZAMOWIENIA_POZ: [] };

    // klient: istniejący po telefonie (albo e-mailu), inaczej nowy wiersz w KLIENCI
    let klientId = '';
    let nowy = '';
    const tel = telefonE164(s.telefon);
    const email = s.email.trim();
    const nazwa = s.nazwa.trim();
    if (tel || nazwa || email) {
      const k = biezacyKlient() || (tel && klientPoTelefonie(tel)) || (email && dane.klienci.find(x => String(x.email || '').toLowerCase() === email.toLowerCase())) || null;
      if (k) {
        klientId = k.id;
        const uzup = {};
        if (!k.nazwa && nazwa) uzup.nazwa = nazwa;
        if (!k.email && email) uzup.email = email;
        if (!k.telefon && tel) uzup.telefon = tel;
        if (!k.adres && s.adres.trim()) uzup.adres = s.adres.trim();
        if (Object.keys(uzup).length) paczki.KLIENCI.push({ ...k, ...uzup });
      } else {
        klientId = uuid();
        nowy = 'tak';
        paczki.KLIENCI.push({ id: klientId, symbol_sgt: '', nazwa, nip: '', email, telefon: tel, miasto: '', zrodlo: 'stoisko', adres: s.adres.trim() });
      }
    }

    s.koszyk.forEach((p, i) => {
      const c = cena(p);
      const cennik = p.cena_cennik === '' ? '' : num(p.cena_cennik);
      paczki.ZAMOWIENIA_POZ.push({
        id: `${numer}-${i + 1}`, zamowienie_id: numer, symbol: p.symbol, nazwa: String(p.nazwa).trim(),
        kategoria: p.grupa || '', podkategoria: '', ilosc: ilosc(p), jm: p.jm || 'szt.',
        cena_cennik: cennik, cena: c, cena_reczna: cennik === '' || Math.abs(cennik - c) >= 0.005, wartosc: wartosc(p),
      });
    });

    paczki.ZAMOWIENIA.push({
      id: numer, urzadzenie: u.kto, podmiot: u.podmiot, zrodlo: 'stoisko', data: dataLok(),
      klient_id: klientId, klient_nowy: nowy, wydarzenie: u.wydarzenie, magazyn: u.magazyn,
      forma_platnosci: s.forma, suma_brutto: suma(), wartosc_produktow: sumaProduktow(),
      dostawa_id: s.dostawaId, dostawa: wysylka(s.dostawaId)?.nazwa || '', koszt_dostawy: kosztDostawy(),
      adres_dostawy: s.dostawaId ? s.adres.trim() : '',
      status: PLATNE_POZNIEJ.has(s.forma) ? STATUSY.czeka : STATUSY.oplacone,
      nr_dok_sgt: '', uwagi: s.uwagi.trim(),
    });

    await sync.zapisz(Object.entries(paczki).map(([karta, wiersze]) => ({ karta, wiersze })));
    zapamietajNumer(numer);
    await wczytaj();
    s = { ...pusty(), forma: s.forma };
    zachowaj();
    const ile = paczki.ZAMOWIENIA_POZ.length;
    toast(`Zapisano zamówienie ${numer} (${ile} ${odmiana(ile, 'pozycja', 'pozycje', 'pozycji')}).`, 'ok');
    location.hash = `#zamowienie/${encodeURIComponent(numer)}${kanal ? '/' + kanal : ''}`;
  } catch (err) {
    toast('Nie udało się zapisać zamówienia: ' + err.message, 'blad', 7000);
  } finally {
    zapisuje = false;
    przycisk.disabled = false;
  }
}

export const ekran = { render, klik, wejscie, zmiana };
