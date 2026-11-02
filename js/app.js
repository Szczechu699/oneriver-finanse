import * as db from './db.js';
import { ustawienia, zapiszUstawienia, skonfigurowane, wywolaj } from './api.js';
import * as sync from './sync.js';

const WERSJA = '0.1.0';

// ───────────────────────── narzędzia ─────────────────────────

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const zaokr = n => Math.round(n * 100) / 100;
const fmt2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const symbol = w => (w === 'PLN' ? 'zł' : w);
const kwotaTxt = (n, w = 'PLN') => fmt2.format(n) + ' ' + symbol(w);

function dataLok(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dodajDni(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dataLok(d);
}
const roznicaDni = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
function dataSlownie(iso) {
  const dzis = dataLok();
  if (iso === dzis) return 'Dziś';
  if (iso === dodajDni(dzis, -1)) return 'Wczoraj';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
}
const godzina = iso => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
function nazwaMiesiaca(ym) {
  const t = new Date(ym + '-15T12:00:00').toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

function toast(tekst, rodzaj = '', czas = 3500, akcja = null) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(tekst)}</span>${akcja ? `<button type="button">${esc(akcja.etykieta)}</button>` : ''}`;
  t.className = 'widoczny ' + rodzaj;
  if (akcja) t.querySelector('button').onclick = () => { t.className = ''; akcja.fn(); };
  clearTimeout(toast.zegar);
  toast.zegar = setTimeout(() => { t.className = ''; }, czas);
}

function okno(tytul, trescHtml, przyciski) {
  const d = $('#okno');
  d.innerHTML = `<form method="dialog" class="okno">
      <h2>${esc(tytul)}</h2>
      <div class="okno-tresc">${trescHtml}</div>
      <div class="okno-przyciski">${przyciski.map((p, i) =>
        `<button value="${i}" class="${p.klasa || ''}" ${p.autofocus ? 'autofocus' : ''}>${esc(p.etykieta)}</button>`).join('')}</div>
    </form>`;
  return new Promise(ok => {
    d.onclose = () => ok(przyciski[Number(d.returnValue)]?.wartosc ?? null);
    d.returnValue = '';
    d.showModal();
  });
}

// ───────────────────────── dane lokalne ─────────────────────────

const dane = { slownik: [], transakcje: [] };
async function wczytajDane() {
  [dane.slownik, dane.transakcje] = await Promise.all([db.wiersze('SLOWNIK'), db.wiersze('TRANSAKCJE')]);
}

function atrybuty(w) {
  if (!w || !w.atrybuty) return {};
  if (typeof w.atrybuty === 'object') return w.atrybuty;
  try { return JSON.parse(w.atrybuty) || {}; } catch { return {}; }
}
const aktywna = w => !(w.aktywna === false || String(w.aktywna).toUpperCase() === 'FALSE');
function lista(nazwa) {
  return dane.slownik
    .filter(w => w.lista === nazwa && aktywna(w))
    .sort((a, b) => (Number(a.kolejnosc) || 999) - (Number(b.kolejnosc) || 999) || String(a.nazwa).localeCompare(String(b.nazwa), 'pl'));
}
const konta = () => lista('konta').map(k => ({ ...k, waluta: atrybuty(k).waluta || '' }));
const walutaKonta = nazwa => konta().find(k => k.nazwa === nazwa)?.waluta || '';
function waluty() {
  const w = lista('waluty').map(x => x.nazwa);
  return w.length ? w : ['PLN', 'EUR', 'USD'];
}
const listaKategorii = typ => (typ === 'wpływ' ? 'zrodla_przychodu' : 'kategorie_kosztow');
const glowne = typ => lista(listaKategorii(typ)).filter(k => !k.rodzic);
function podrzedne(typ, nazwaRodzica) {
  const l = lista(listaKategorii(typ));
  const rodzic = l.find(k => k.nazwa === nazwaRodzica && !k.rodzic);
  return rodzic ? l.filter(k => k.rodzic === rodzic.id) : [];
}
function podmioty() {
  const p = lista('podmioty').map(x => x.nazwa);
  return [...(p.length ? p : ['INCO', 'OFI']), 'wspólne'];
}

const IKONY = [
  [/wysy|paczk|kurier/i, '📦'], [/wypłat|wynagr/i, '👥'], [/czynsz|media/i, '🏠'], [/towar|zakup/i, '🧺'],
  [/opakow|druk|etykiet/i, '🏷️'], [/usług/i, '🛠️'], [/program|abonam/i, '💻'], [/zus|podat/i, '🏛️'],
  [/podróż/i, '✈️'], [/sklep/i, '🛒'], [/stoisk|kiermasz/i, '🎪'], [/ceremon|warsztat/i, '🪶'],
  [/wypraw/i, '🧭'], [/granic/i, '🌍'],
];
const KOLORY = ['#CDE6DF', '#F3DDA9', '#E8D2E2', '#D2E3F3', '#DDE8C6', '#F1D5CB', '#DBD5EF', '#C8DED3', '#EEE3C1', '#D9DCE0'];
function ikona(nazwa, typ) {
  const w = lista(listaKategorii(typ)).find(k => k.nazwa === nazwa);
  const a = atrybuty(w);
  if (a.ikona) return a.ikona;
  const m = IKONY.find(([r]) => r.test(nazwa || ''));
  return m ? m[1] : '•';
}
function kolorKategorii(nazwa, typ) {
  const l = glowne(typ);
  const i = l.findIndex(k => k.nazwa === nazwa);
  return atrybuty(l[i]).kolor || KOLORY[(i < 0 ? 9 : i) % KOLORY.length];
}

const czyPrzeks = t => String(t.typ || '').startsWith('przeksięgowanie');
const kierunek = t => (t.typ === 'wpływ' || t.typ === 'przeksięgowanie-wpływ' ? 'wpływ' : 'wypływ');
function kwotaPLN(t) {
  if (t.waluta === 'PLN' || !t.waluta) return Number(t.kwota) || 0;
  if (t.kwota_pln !== '' && t.kwota_pln != null) return Number(t.kwota_pln);
  return null;
}
const czeka = t => sync.stanSynchronizacji().oczekujaceKlucze?.has('TRANSAKCJE|' + t.id);

function pamiec() {
  try { return JSON.parse(localStorage.getItem('or-finanse-ostatnie')) || {}; } catch { return {}; }
}
function zapamietaj(zmiana) {
  localStorage.setItem('or-finanse-ostatnie', JSON.stringify({ ...pamiec(), ...zmiana }));
}

// ───────────────────────── nawigacja ─────────────────────────

function trasa() {
  const h = location.hash.slice(1) || (skonfigurowane() ? 'dodaj' : 'ustawienia');
  const [widok, arg] = h.split('/');
  return { widok, arg: arg ? decodeURIComponent(arg) : null };
}

function render() {
  const { widok, arg } = trasa();
  document.querySelectorAll('.zakladki a').forEach(a => {
    const aktywny = a.dataset.widok === widok || (widok === 'edytuj' && a.dataset.widok === 'lista');
    if (aktywny) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (widok === 'lista') renderLista();
  else if (widok === 'ustawienia') renderUstawienia();
  else if (widok === 'edytuj') renderDodaj(arg);
  else renderDodaj();
}

// ───────────────────────── formularz transakcji ─────────────────────────

let f = null;

function nowyFormularz(zostaw = {}) {
  const pam = pamiec();
  return {
    tryb: 'nowy', id: null, id_pary: null, oryginaly: [],
    typ: zostaw.typ || 'wydatek',
    kwota: '', waluta: zostaw.waluta || '',
    konto: zostaw.konto || pam.konto || '',
    konto_docelowe: '', kwota_do: '',
    kategoria: '', podkategoria: '',
    kontrahent: '', podmiot: zostaw.podmiot ?? pam.podmiot ?? '',
    tagi: '', data: zostaw.data || dataLok(),
    nr_dokumentu: '', opis: '',
    podpowiedz: '',
  };
}

function formularzZTransakcji(t) {
  const nf = nowyFormularz();
  const wspolne = { tryb: 'edycja', data: t.data_operacji || dataLok(), tagi: t.tagi || '', nr_dokumentu: t.nr_dokumentu || '', opis: t.opis || '' };
  if (czyPrzeks(t) && t.id_pary) {
    const nogi = dane.transakcje.filter(x => x.id_pary === t.id_pary);
    const z = nogi.find(x => x.typ === 'przeksięgowanie-wypływ') || t;
    const na = nogi.find(x => x.typ === 'przeksięgowanie-wpływ');
    return {
      ...nf, ...wspolne, typ: 'przeksięgowanie', id: z.id, id_pary: t.id_pary, oryginaly: nogi,
      kwota: liczbaNaTekst(z.kwota), waluta: z.waluta, konto: z.konto,
      konto_docelowe: na?.konto || '', kwota_do: na && na.waluta !== z.waluta ? liczbaNaTekst(na.kwota) : '',
    };
  }
  return {
    ...nf, ...wspolne, typ: t.typ === 'wpływ' ? 'wpływ' : 'wydatek', id: t.id, oryginaly: [t],
    kwota: liczbaNaTekst(t.kwota), waluta: t.waluta || '', konto: t.konto || '',
    kategoria: t.typ === 'wpływ' ? (t.zrodlo_przychodu || '') : (t.kategoria || ''),
    podkategoria: t.podkategoria || '', kontrahent: t.kontrahent || '', podmiot: t.podmiot || '',
  };
}

const liczbaNaTekst = n => (n === '' || n == null ? '' : String(zaokr(Number(n))).replace('.', ','));
const wartosc = s => (s || '').split('+').reduce((a, c) => a + (parseFloat(c.replace(',', '.')) || 0), 0);
function grupuj(s) {
  const [c, d] = s.split(',');
  const cg = (c || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return d !== undefined ? cg + ',' + d : cg;
}
const walutaFormularza = () => walutaKonta(f.konto) || f.waluta || 'PLN';
const walutaDocelowa = () => walutaKonta(f.konto_docelowe) || walutaFormularza();

function klawisz(k) {
  let s = f.kwota;
  const ost = s.split('+').pop();
  if (k === 'C') s = '';
  else if (k === '⌫') s = s.slice(0, -1);
  else if (k === '+') { if (s && !/[+,]$/.test(s)) s += '+'; }
  else if (k === ',') { if (!ost.includes(',')) s += ost === '' ? '0,' : ','; }
  else {
    if (ost.includes(',') && ost.split(',')[1].length >= 2) return;
    if (ost.replace(',', '').length >= 9) return;
    if (ost === '0') s = s.slice(0, -1);
    s += k;
  }
  f.kwota = s;
  odswiezKwote();
}

function odswiezKwote() {
  const el = $('.kwota');
  if (!el) return;
  const czesci = f.kwota.split('+');
  const ost = czesci[czesci.length - 1];
  const suma = wartosc(f.kwota);
  el.querySelector('.wyrazenie').textContent = czesci.length > 1 ? czesci.map(grupuj).join(' + ') + ' =' : '';
  el.querySelector('.wartosc').textContent = czesci.length > 1 ? fmt2.format(suma) : grupuj(ost || '0');
  el.querySelector('.waluta').textContent = symbol(walutaFormularza());
  const btn = $('.zapisz');
  if (btn) btn.innerHTML = etykietaZapisu();
}

function etykietaZapisu() {
  const s = wartosc(f.kwota);
  const co = { wydatek: 'wydatek', 'wpływ': 'wpływ', 'przeksięgowanie': 'przeksięgowanie' }[f.typ];
  const czas = f.tryb === 'edycja' ? 'Zapisz zmiany' : 'Zapisz ' + co;
  return `${esc(czas)}${s > 0 ? ` <span>${esc(kwotaTxt(s, walutaFormularza()))}</span>` : ''}`;
}

function kontrahenci() {
  const ost = new Map();
  dane.transakcje.forEach(t => {
    const k = String(t.kontrahent || '').trim();
    if (!k || t.status === 'anulowana') return;
    const d = t.data_operacji || '';
    if (!ost.has(k) || ost.get(k) < d) ost.set(k, d);
  });
  return [...ost.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 300).map(e => e[0]);
}

function ostatniDlaKontrahenta(nazwa, typ) {
  const n = nazwa.trim().toLowerCase();
  if (!n) return null;
  return dane.transakcje
    .filter(t => String(t.kontrahent || '').trim().toLowerCase() === n && t.typ === typ && t.status !== 'anulowana')
    .sort((a, b) => String(b.data_operacji).localeCompare(String(a.data_operacji)) || String(b.utworzono || '').localeCompare(String(a.utworzono || '')))[0] || null;
}

function przyciskiKont(pole, wybrane, pomin = '') {
  const l = konta();
  if (!l.length) return `<p class="pusto">Brak kont. Zsynchronizuj aplikację z arkuszem w Ustawieniach.</p>`;
  return `<div class="chipy">${l.filter(k => k.nazwa !== pomin).map(k => `
      <button type="button" class="chip" data-akcja="${pole}" data-v="${esc(k.nazwa)}" aria-pressed="${k.nazwa === wybrane}">
        ${esc(k.nazwa)}</button>`).join('')}</div>`;
}

function siatkaKategorii() {
  const l = glowne(f.typ);
  if (!l.length) return `<p class="pusto">Brak pozycji w Słowniku.</p>`;
  return `<div class="siatka">${l.map((k, i) => `
      <button type="button" class="kafel" data-akcja="kategoria" data-v="${esc(k.nazwa)}" aria-pressed="${k.nazwa === f.kategoria}"
        style="--tlo:${esc(atrybuty(k).kolor || KOLORY[i % KOLORY.length])}">
        <span class="ikona" aria-hidden="true">${esc(atrybuty(k).ikona || ikona(k.nazwa, f.typ))}</span>
        <span class="nazwa">${esc(k.nazwa)}</span>
      </button>`).join('')}</div>`;
}

function renderDodaj(idEdycji = null) {
  if (idEdycji) {
    if (!f || f.tryb !== 'edycja' || (f.id !== idEdycji && !f.oryginaly.some(o => o.id === idEdycji))) {
      const t = dane.transakcje.find(x => x.id === idEdycji);
      if (!t) {
        $('#widok').innerHTML = `<section class="ekran-wiadomosc"><h1>Nie ma takiej transakcji</h1>
          <p>Mogła zostać usunięta z arkusza. Wróć do listy.</p><a class="przycisk" href="#lista">Lista transakcji</a></section>`;
        return;
      }
      f = formularzZTransakcji(t);
    }
  } else if (!f || f.tryb === 'edycja') {
    f = nowyFormularz();
  }
  if (!f.konto && konta().length) f.konto = konta()[0].nazwa;

  const przeks = f.typ === 'przeksięgowanie';
  const kontoBezWaluty = f.konto && !walutaKonta(f.konto);
  const rozneWaluty = przeks && f.konto_docelowe && walutaDocelowa() !== walutaFormularza();
  const pod = przeks ? [] : podrzedne(f.typ, f.kategoria);
  const anulowana = f.oryginaly.some(o => o.status === 'anulowana');
  const potwierdzona = f.oryginaly.some(o => o.status === 'potwierdzona');

  $('#widok').innerHTML = `
  <section class="dodaj typ-${{ wydatek: 'wydatek', 'wpływ': 'wplyw', 'przeksięgowanie': 'przeks' }[f.typ]}">
    <div class="kolumna-kwoty">
      <div class="panel-kwoty">
        <div class="typy" role="group" aria-label="Rodzaj transakcji">
          ${['wydatek', 'wpływ', 'przeksięgowanie'].map(t => `
            <button type="button" data-akcja="typ" data-v="${t}" aria-pressed="${f.typ === t}" ${f.tryb === 'edycja' ? 'disabled' : ''}>
              ${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
        <div class="kwota" aria-live="polite" aria-label="Kwota">
          <span class="wyrazenie"></span>
          <span class="wiersz-kwoty"><span class="wartosc"></span><span class="waluta"></span></span>
        </div>
      </div>
      <div class="tkanina" aria-hidden="true"></div>
      <div class="klawiatura" role="group" aria-label="Klawiatura kwoty">
        ${['7', '8', '9', 'C', '4', '5', '6', '⌫', '1', '2', '3', '+', ',', '0'].map(k => `
          <button type="button" data-akcja="klawisz" data-v="${k}" class="${/\d/.test(k) ? '' : 'funkcja'} ${k === '0' ? 'szeroki' : ''}"
            aria-label="${{ 'C': 'Wyczyść', '⌫': 'Usuń ostatnią cyfrę', '+': 'Dodaj kolejną kwotę', ',': 'Przecinek' }[k] || k}">${k}</button>`).join('')}
      </div>
    </div>

    <form class="kolumna-szczegolow" novalidate>
      ${f.tryb === 'edycja' ? `<div class="pasek-edycji">
          <span>Edytujesz transakcję${anulowana ? ' (anulowaną)' : ''}${potwierdzona ? '. Jest już potwierdzona wyciągiem' : ''}.</span>
          <a href="#lista">Wróć do listy</a></div>` : ''}

      <fieldset class="pole">
        <legend>${przeks ? 'Z konta' : 'Konto'}</legend>
        ${przyciskiKont('konto', f.konto)}
        ${kontoBezWaluty ? `<div class="chipy male" role="group" aria-label="Waluta">${waluty().map(w => `
          <button type="button" class="chip" data-akcja="waluta" data-v="${w}" aria-pressed="${walutaFormularza() === w}">${w}</button>`).join('')}</div>` : ''}
      </fieldset>

      ${przeks ? `
      <fieldset class="pole">
        <legend>Na konto</legend>
        ${przyciskiKont('konto_docelowe', f.konto_docelowe, f.konto)}
      </fieldset>
      ${rozneWaluty ? `<label class="pole">
        <span class="etykieta">Kwota, która wpłynęła na ${esc(f.konto_docelowe)} (${esc(walutaDocelowa())})</span>
        <input name="kwota_do" inputmode="decimal" autocomplete="off" value="${esc(f.kwota_do)}" placeholder="np. 230,45">
      </label>` : ''}` : `
      <fieldset class="pole">
        <legend>${f.typ === 'wpływ' ? 'Źródło przychodu' : 'Kategoria'}</legend>
        ${siatkaKategorii()}
        ${pod.length ? `<div class="chipy male podkategorie" role="group" aria-label="Podkategoria">${pod.map(p => `
          <button type="button" class="chip" data-akcja="podkategoria" data-v="${esc(p.nazwa)}" aria-pressed="${p.nazwa === f.podkategoria}">${esc(p.nazwa)}</button>`).join('')}</div>` : ''}
      </fieldset>`}

      <div class="rzad">
        <fieldset class="pole">
          <legend>Data operacji</legend>
          <div class="data">
            <input type="date" name="data" value="${esc(f.data)}" max="${dodajDni(dataLok(), 365)}" required>
            <button type="button" class="chip" data-akcja="data" data-v="0" aria-pressed="${f.data === dataLok()}">Dziś</button>
            <button type="button" class="chip" data-akcja="data" data-v="-1" aria-pressed="${f.data === dodajDni(dataLok(), -1)}">Wczoraj</button>
          </div>
        </fieldset>
        ${przeks ? '' : `<fieldset class="pole">
          <legend>Dotyczy</legend>
          <div class="chipy">${podmioty().map(p => `
            <button type="button" class="chip" data-akcja="podmiot" data-v="${esc(p)}" aria-pressed="${f.podmiot === p}">${esc(p === 'wspólne' ? 'Wspólne' : p)}</button>`).join('')}</div>
        </fieldset>`}
      </div>

      ${przeks ? '' : `<label class="pole">
        <span class="etykieta">Kontrahent</span>
        <input name="kontrahent" list="lista-kontrahentow" autocomplete="off" value="${esc(f.kontrahent)}" placeholder="np. Allegro, InPost, imię i nazwisko">
        <datalist id="lista-kontrahentow">${kontrahenci().map(k => `<option value="${esc(k)}">`).join('')}</datalist>
        <span class="podpowiedz" aria-live="polite">${esc(f.podpowiedz)}</span>
      </label>`}

      <details class="wiecej" ${f.tagi || f.nr_dokumentu || f.opis ? 'open' : ''}>
        <summary>Opis, numer dokumentu, tagi</summary>
        <label class="pole"><span class="etykieta">Opis</span>
          <textarea name="opis" rows="2" placeholder="Co to było?">${esc(f.opis)}</textarea></label>
        <div class="rzad">
          <label class="pole"><span class="etykieta">Numer dokumentu</span>
            <input name="nr_dokumentu" autocomplete="off" value="${esc(f.nr_dokumentu)}" placeholder="faktura, paragon"></label>
          <label class="pole"><span class="etykieta">Tagi, po przecinku</span>
            <input name="tagi" list="lista-tagow" autocomplete="off" value="${esc(f.tagi)}" placeholder="np. Kiermasz Koneser">
            <datalist id="lista-tagow">${lista('tagi').map(t => `<option value="${esc(t.nazwa)}">`).join('')}</datalist></label>
        </div>
      </details>

      <div class="pasek-zapisu">
        ${f.tryb === 'edycja' && !anulowana ? `<button type="button" class="drugorzedny" data-akcja="anuluj-transakcje">Anuluj transakcję</button>` : ''}
        <button type="submit" class="zapisz">${etykietaZapisu()}</button>
      </div>
    </form>
  </section>`;
  odswiezKwote();
}

function zbierzPola() {
  const form = $('.kolumna-szczegolow');
  if (!form) return;
  ['data', 'kontrahent', 'opis', 'nr_dokumentu', 'tagi', 'kwota_do'].forEach(n => {
    const el = form.elements[n];
    if (el) f[n] = el.value;
  });
}

function bledyFormularza(kwota) {
  if (!(kwota > 0)) return 'Wpisz kwotę większą od zera.';
  if (!f.konto) return 'Wybierz konto.';
  if (!f.data) return 'Wybierz datę operacji.';
  if (f.typ === 'przeksięgowanie') {
    if (!f.konto_docelowe) return 'Wybierz konto, na które idą pieniądze.';
    if (f.konto_docelowe === f.konto) return 'Konto źródłowe i docelowe muszą być różne.';
    if (walutaDocelowa() !== walutaFormularza() && !(wartosc(f.kwota_do) > 0)) return 'Wpisz kwotę, która wpłynęła na konto docelowe.';
  } else if (!f.kategoria) {
    return f.typ === 'wpływ' ? 'Wybierz źródło przychodu.' : 'Wybierz kategorię.';
  }
  return null;
}

function kursDlaWiersza(orig, waluta, data, kwota) {
  if (waluta === 'PLN') return { kurs: 1, kwota_pln: kwota };
  if (orig && orig.waluta === waluta && orig.data_operacji === data && orig.kurs !== '' && orig.kurs != null) {
    return { kurs: Number(orig.kurs), kwota_pln: zaokr(kwota * Number(orig.kurs)) };
  }
  return { kurs: '', kwota_pln: '' };
}

async function zapiszFormularz() {
  zbierzPola();
  const kwota = zaokr(wartosc(f.kwota));
  const blad = bledyFormularza(kwota);
  if (blad) { toast(blad, 'blad'); return; }

  const waluta = walutaFormularza();
  const wspolne = {
    data_operacji: f.data, tagi: f.tagi.split(',').map(s => s.trim()).filter(Boolean).join(', '),
    nr_dokumentu: f.nr_dokumentu.trim(), opis: f.opis.trim(),
  };
  let wiersze;

  if (f.typ === 'przeksięgowanie') {
    const para = f.id_pary || uuid();
    const origZ = f.oryginaly.find(o => o.typ === 'przeksięgowanie-wypływ');
    const origNa = f.oryginaly.find(o => o.typ === 'przeksięgowanie-wpływ');
    const walNa = walutaDocelowa();
    const kwotaNa = walNa === waluta ? kwota : zaokr(wartosc(f.kwota_do));
    const noga = (orig, typ, konto, kw, wal) => ({
      ...(orig || {}), ...wspolne,
      id: orig?.id || uuid(), typ, id_pary: para, konto, kwota: kw, waluta: wal,
      ...kursDlaWiersza(orig, wal, f.data, kw),
      kategoria: '', podkategoria: '', zrodlo_przychodu: '', kontrahent: '', podmiot: '',
      status: orig?.status || 'oczekuje na wyciąg', zrodlo: orig?.zrodlo || 'ręczny',
    });
    wiersze = [
      noga(origZ, 'przeksięgowanie-wypływ', f.konto, kwota, waluta),
      noga(origNa, 'przeksięgowanie-wpływ', f.konto_docelowe, kwotaNa, walNa),
    ];
  } else {
    const orig = f.oryginaly[0];
    const w = {
      ...(orig || {}), ...wspolne,
      id: orig?.id || uuid(), typ: f.typ, id_pary: '', konto: f.konto, kwota, waluta,
      ...kursDlaWiersza(orig, waluta, f.data, kwota),
      kategoria: f.typ === 'wydatek' ? f.kategoria : '',
      podkategoria: f.typ === 'wydatek' ? f.podkategoria : '',
      zrodlo_przychodu: f.typ === 'wpływ' ? f.kategoria : '',
      kontrahent: f.kontrahent.trim(), podmiot: f.podmiot,
      status: orig?.status || 'oczekuje na wyciąg', zrodlo: orig?.zrodlo || 'ręczny',
    };
    const podobne = dane.transakcje.filter(t => t.id !== w.id && t.status !== 'anulowana' && t.konto === w.konto
      && t.waluta === w.waluta && Math.abs(Number(t.kwota) - kwota) < 0.005 && kierunek(t) === kierunek(w)
      && Math.abs(roznicaDni(t.data_operacji, w.data_operacji)) <= 3);
    if (podobne.length && f.tryb === 'nowy') {
      const decyzja = await okno('Taka transakcja może już być zapisana',
        `<p>Na koncie ${esc(w.konto)} jest już ${podobne.length === 1 ? 'operacja' : 'kilka operacji'} na ${esc(kwotaTxt(kwota, waluta))} z podobną datą:</p>
         <ul class="lista-podobnych">${podobne.slice(0, 5).map(t => `<li><b>${esc(dataSlownie(t.data_operacji))}</b>
           ${esc(t.kontrahent || t.kategoria || t.zrodlo_przychodu || '')} <span>${esc(t.status || '')}</span></li>`).join('')}</ul>
         <p>Zapisz tylko wtedy, gdy to naprawdę inna operacja.</p>`,
        [{ etykieta: 'Wróć do formularza', wartosc: false, klasa: 'drugorzedny', autofocus: true },
         { etykieta: 'To inna operacja, zapisz', wartosc: true }]);
      if (!decyzja) return;
    }
    wiersze = [w];
  }

  await sync.zapisz('TRANSAKCJE', wiersze);
  zapamietaj({ konto: f.konto, podmiot: f.podmiot });
  await wczytajDane();
  const offline = !navigator.onLine;
  if (f.tryb === 'edycja') {
    toast('Zapisano zmiany.' + (offline ? ' Wyślę je po powrocie internetu.' : ''), 'ok');
    f = null;
    location.hash = '#lista';
  } else {
    toast(`Zapisano ${f.typ} ${kwotaTxt(kwota, waluta)}.` + (offline ? ' Wyślę go po powrocie internetu.' : ''), 'ok');
    f = nowyFormularz({ typ: f.typ, konto: f.konto, waluta: f.waluta, data: f.data, podmiot: f.podmiot });
    renderDodaj();
  }
}

async function anulujTransakcje() {
  const tak = await okno('Anulować tę transakcję?',
    `<p>Zostanie w arkuszu ze statusem „anulowana” i przestanie liczyć się w podsumowaniach. Możesz to cofnąć, edytując ją w arkuszu.</p>`,
    [{ etykieta: 'Nie anuluj', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Anuluj transakcję', wartosc: true, klasa: 'niebezpieczny' }]);
  if (!tak) return;
  await sync.zapisz('TRANSAKCJE', f.oryginaly.map(o => ({ ...o, status: 'anulowana' })));
  await wczytajDane();
  toast('Transakcja anulowana.', 'ok');
  f = null;
  location.hash = '#lista';
}

function obslugaDodaj(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b || !$('.dodaj')) return;
  const { akcja, v } = b.dataset;
  zbierzPola();
  switch (akcja) {
    case 'klawisz': klawisz(v); return;
    case 'typ':
      if (f.typ !== v) { f.typ = v; f.kategoria = ''; f.podkategoria = ''; f.podpowiedz = ''; }
      break;
    case 'konto':
      f.konto = v; f.waluta = '';
      if (f.konto_docelowe === v) f.konto_docelowe = '';
      break;
    case 'konto_docelowe': f.konto_docelowe = v; break;
    case 'waluta': f.waluta = v; break;
    case 'kategoria':
      if (f.kategoria !== v) f.podkategoria = '';
      f.kategoria = v; f.podpowiedz = '';
      break;
    case 'podkategoria': f.podkategoria = f.podkategoria === v ? '' : v; break;
    case 'podmiot': f.podmiot = f.podmiot === v ? '' : v; break;
    case 'data': f.data = dodajDni(dataLok(), Number(v)); break;
    case 'anuluj-transakcje': anulujTransakcje(); return;
    default: return;
  }
  const przewin = window.scrollY;
  renderDodaj(f.tryb === 'edycja' ? f.id : null);
  window.scrollTo(0, przewin);
}

function kontrahentZmieniony(e) {
  if (e.target.name !== 'kontrahent' || !$('.dodaj')) return;
  f.kontrahent = e.target.value;
  if (f.tryb !== 'nowy' || f.kategoria) return;
  const ost = ostatniDlaKontrahenta(f.kontrahent, f.typ);
  if (!ost) return;
  zbierzPola();
  f.kategoria = f.typ === 'wpływ' ? ost.zrodlo_przychodu : ost.kategoria;
  f.podkategoria = ost.podkategoria || '';
  if (!f.podmiot) f.podmiot = ost.podmiot || '';
  if (!f.tagi) f.tagi = ost.tagi || '';
  f.podpowiedz = f.kategoria ? `Podstawiono jak w ostatnim wpisie: ${f.kategoria}${f.podkategoria ? ', ' + f.podkategoria : ''}.` : '';
  const przewin = window.scrollY;
  renderDodaj();
  window.scrollTo(0, przewin);
}

// ───────────────────────── lista transakcji ─────────────────────────

const filtry = { miesiac: dataLok().slice(0, 7), konto: '', szukaj: '', anulowane: false };

function renderLista() {
  const wszystkie = dane.transakcje.filter(t => String(t.data_operacji || '').startsWith(filtry.miesiac));
  const szukaj = filtry.szukaj.trim().toLowerCase();
  const widoczne = wszystkie.filter(t =>
    (filtry.anulowane || t.status !== 'anulowana')
    && (!filtry.konto || t.konto === filtry.konto)
    && (!szukaj || [t.kontrahent, t.kategoria, t.podkategoria, t.zrodlo_przychodu, t.opis, t.tagi, t.nr_dokumentu, String(t.kwota)]
      .some(x => String(x || '').toLowerCase().includes(szukaj))));

  let wplywy = 0, wydatki = 0, bezKursu = 0, czekaNaWyciag = 0;
  wszystkie.forEach(t => {
    if (t.status === 'anulowana' || czyPrzeks(t)) return;
    if (t.status === 'oczekuje na wyciąg') czekaNaWyciag++;
    const k = kwotaPLN(t);
    if (k === null) { bezKursu++; return; }
    if (t.typ === 'wpływ') wplywy += k; else if (t.typ === 'wydatek') wydatki += k;
  });

  // przeksięgowanie pokazujemy raz – stroną wypływu
  const pokazane = widoczne.filter(t => t.typ !== 'przeksięgowanie-wpływ' || !widoczne.some(x => x.id_pary === t.id_pary && x.typ === 'przeksięgowanie-wypływ'));
  const dni = new Map();
  pokazane
    .sort((a, b) => String(b.data_operacji).localeCompare(String(a.data_operacji)) || String(b.utworzono || '').localeCompare(String(a.utworzono || '')))
    .forEach(t => {
      if (!dni.has(t.data_operacji)) dni.set(t.data_operacji, []);
      dni.get(t.data_operacji).push(t);
    });

  const wynik = wplywy - wydatki;
  $('#widok').innerHTML = `
  <section class="lista">
    <div class="naglowek-listy">
      <div class="miesiac">
        <button type="button" data-akcja="miesiac" data-v="-1" aria-label="Poprzedni miesiąc">‹</button>
        <h1>${esc(nazwaMiesiaca(filtry.miesiac))}</h1>
        <button type="button" data-akcja="miesiac" data-v="1" aria-label="Następny miesiąc">›</button>
      </div>
      <dl class="podsumowanie">
        <div class="plus"><dt>Wpływy</dt><dd>${esc(kwotaTxt(wplywy))}</dd></div>
        <div class="minus"><dt>Wydatki</dt><dd>${esc(kwotaTxt(wydatki))}</dd></div>
        <div class="${wynik < 0 ? 'minus' : 'plus'}"><dt>Wynik</dt><dd>${esc(kwotaTxt(wynik))}</dd></div>
      </dl>
      <p class="uwagi-podsumowania">${[
        'Bez przeksięgowań i anulowanych',
        czekaNaWyciag ? `${ileTransakcji(czekaNaWyciag)} na potwierdzenie wyciągiem` : '',
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
        <p>${wszystkie.length ? 'Nic nie pasuje do filtrów.' : 'W tym miesiącu nie ma jeszcze transakcji.'}</p>
        <a class="przycisk" href="#dodaj">Dodaj transakcję</a>
      </div>`}
  </section>`;
}

function ileTransakcji(n) {
  const d = n % 10, s = n % 100;
  if (n === 1) return '1 transakcja czeka';
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return `${n} transakcje czekają`;
  return `${n} transakcji czeka`;
}

function wierszListy(t) {
  const przeks = czyPrzeks(t);
  let tytul, opis, kwota, klasa, ik, tlo;
  if (przeks) {
    const druga = dane.transakcje.find(x => x.id_pary === t.id_pary && x.id !== t.id);
    const [z, na] = t.typ === 'przeksięgowanie-wypływ' ? [t, druga] : [druga, t];
    tytul = 'Przeksięgowanie';
    opis = `${z?.konto || '?'} na ${na?.konto || '?'}`;
    kwota = kwotaTxt(Number(t.kwota), t.waluta);
    klasa = 'przeks'; ik = '⇄'; tlo = '#D3E4E2';
  } else {
    const typ = t.typ === 'wpływ' ? 'wpływ' : 'wydatek';
    const kat = typ === 'wpływ' ? t.zrodlo_przychodu : t.kategoria;
    tytul = t.kontrahent || kat || 'Bez kategorii';
    opis = [t.kontrahent ? kat : '', t.podkategoria, t.konto, t.podmiot && t.podmiot !== 'wspólne' ? t.podmiot : ''].filter(Boolean).join(', ');
    kwota = (typ === 'wpływ' ? '+' : '−') + kwotaTxt(Number(t.kwota), t.waluta);
    klasa = typ === 'wpływ' ? 'plus' : 'minus';
    ik = ikona(kat, typ); tlo = kolorKategorii(kat, typ);
  }
  const znaczniki = [
    t.status === 'oczekuje na wyciąg' ? '<span class="znacznik czeka">czeka na wyciąg</span>' : '',
    t.status === 'anulowana' ? '<span class="znacznik anul">anulowana</span>' : '',
    czeka(t) ? '<span class="znacznik wysylka">do wysłania</span>' : '',
  ].join('');
  return `<li class="${t.status === 'anulowana' ? 'anulowana' : ''}">
    <a href="#edytuj/${encodeURIComponent(t.id)}">
      <span class="ikona" style="--tlo:${esc(tlo)}" aria-hidden="true">${esc(ik)}</span>
      <span class="srodek"><span class="tytul">${esc(tytul)}</span>
        <span class="opis">${esc(opis)}${t.opis ? ` <i>${esc(t.opis)}</i>` : ''}</span>
        ${znaczniki ? `<span class="znaczniki">${znaczniki}</span>` : ''}</span>
      <span class="kwota-wiersza ${klasa}">${esc(kwota)}</span>
    </a></li>`;
}

function obslugaListy(e) {
  const b = e.target.closest('[data-akcja="miesiac"]');
  if (!b || !$('.lista')) return;
  const d = new Date(filtry.miesiac + '-15T12:00:00');
  d.setMonth(d.getMonth() + Number(b.dataset.v));
  filtry.miesiac = dataLok(d).slice(0, 7);
  renderLista();
}

function filtrListy(e) {
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

// ───────────────────────── ustawienia ─────────────────────────

function renderUstawienia(komunikat = '') {
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
        <div><dt>Do wysłania</dt><dd>${s.oczekujace || 0}</dd></div>
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

async function zapiszPolaczenie(form) {
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
    if (s.tryb === 'blad') {
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

async function obslugaUstawien(e) {
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
        ? `<p class="blad"><b>${s.oczekujace} zmian nie zostało jeszcze wysłanych do arkusza i przepadną.</b> Najpierw połącz się z internetem i zsynchronizuj.</p>`
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

// ───────────────────────── start ─────────────────────────

let ostatniaZmiana = 0;

function pokazStan(s) {
  const b = $('#sync');
  let tekst, klasa = '';
  switch (s.tryb) {
    case 'praca': tekst = 'Synchronizuję…'; klasa = 'praca'; break;
    case 'offline': tekst = s.oczekujace ? `Bez internetu, ${s.oczekujace} do wysłania` : 'Bez internetu'; klasa = 'offline'; break;
    case 'blad': tekst = 'Synchronizacja nie powiodła się'; klasa = 'blad'; break;
    case 'brak-ustawien': tekst = 'Połącz z arkuszem'; klasa = 'blad'; break;
    case 'start': tekst = 'Uruchamianie…'; break;
    default:
      if (s.oczekujace) { tekst = `${s.oczekujace} do wysłania`; klasa = 'offline'; }
      else tekst = s.ostatnia ? 'Zsynchronizowano ' + godzina(s.ostatnia) : 'Synchronizuj';
  }
  b.textContent = tekst;
  b.className = 'sync ' + klasa;
  b.title = s.blad || 'Kliknij, aby zsynchronizować';
  if (s.zmiana && s.zmiana !== ostatniaZmiana) {
    ostatniaZmiana = s.zmiana;
    wczytajDane().then(() => {
      const aktywny = document.activeElement;
      const pisze = aktywny && /INPUT|TEXTAREA|SELECT/.test(aktywny.tagName);
      if (!pisze && !$('#okno').open) {
        const przewin = window.scrollY;
        render();
        window.scrollTo(0, przewin);
      }
    });
  }
}

async function start() {
  await wczytajDane();
  render();
  sync.obserwuj(pokazStan);
  await sync.start();

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  const widok = $('#widok');
  widok.addEventListener('click', e => { obslugaDodaj(e); obslugaListy(e); obslugaUstawien(e); });
  widok.addEventListener('change', e => { kontrahentZmieniony(e); filtrListy(e); });
  widok.addEventListener('input', e => {
    if (e.target.name === 'szukaj') filtrListy(e);
    if ($('.dodaj') && e.target.name === 'data') f.data = e.target.value;
  });
  widok.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.dataset.forma === 'polaczenie') zapiszPolaczenie(e.target);
    else if (e.target.classList.contains('kolumna-szczegolow')) zapiszFormularz();
  });

  $('#sync').addEventListener('click', () => {
    const s = sync.stanSynchronizacji();
    if (s.tryb === 'brak-ustawien') { location.hash = '#ustawienia'; return; }
    if (s.tryb === 'blad' && s.blad) toast(s.blad, 'blad', 6000);
    sync.synchronizuj();
  });

  document.addEventListener('keydown', e => {
    if (!$('.dodaj') || $('#okno').open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    const mapa = { Backspace: '⌫', Escape: 'C', Delete: 'C', '.': ',', ',': ',', '+': '+' };
    if (/^\d$/.test(e.key)) { klawisz(e.key); e.preventDefault(); }
    else if (mapa[e.key]) { klawisz(mapa[e.key]); e.preventDefault(); }
    else if (e.key === 'Enter') { zapiszFormularz(); e.preventDefault(); }
  });

  window.addEventListener('beforeunload', e => {
    if (sync.stanSynchronizacji().oczekujace && !navigator.onLine) { e.preventDefault(); e.returnValue = ''; }
  });

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nowy = reg.installing;
        nowy?.addEventListener('statechange', () => {
          if (nowy.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Jest nowa wersja aplikacji.', '', 15000, { etykieta: 'Odśwież', fn: () => location.reload() });
          }
        });
      });
    }).catch(() => {});
  }
}

start();
