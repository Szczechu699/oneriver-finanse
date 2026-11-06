// Kasa: rozliczanie gotówki (karta KASA_LICZENIA).
// Kasy: Elsterska (magazyn INC, także ONE), Grażynka (magazyn GR) i każde wydarzenie osobno (zamówienia ze Stoiska z wpisanym wydarzeniem).
// Sprzedaż gotówkowa = gotówkowe części zamówień ze Stoiska + paragony gotówkowe z Subiektu (bez paragonów zamówień ze Stoiska
// i bez zamówień ze sklepu internetowego). Liczenie: saldo konta kasy + nierozliczona sprzedaż = powinno być; wpisujesz, ile jest;
// zapis księguje utarg (wpływ na konto kasy), ewentualną różnicę i przeksięgowanie do prywatnego konta „Gotówka”.
// Ekrany: #kasa (lista kas), #kasa/<id kasy> (liczenie), #kasa/l:<id liczenia> (szczegóły).

import { $, $$, esc, zaokr, kwotaTxt, dataLok, dataKrotko, uuid, odmiana, toast, okno, bezSkoku, liczba, liczbaNaTekst } from './util.js';
import { dane, wczytajDane, konta, atrybuty, saldoNaDzien, glowne, BEZ_WYCIAGU, kierunek } from './dane.js';
import { mozePrywatne } from './api.js';
import * as sync from './sync.js';

const num = v => (isFinite(Number(String(v ?? '').replace(',', '.'))) ? Number(String(v ?? '').replace(',', '.')) : 0);
const normTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').trim();
const dzien = v => String(v || '').slice(0, 10);

// ───────────────────────── kasy i konta ─────────────────────────

/** Symbol magazynu z zamówienia Stoiska („INC”, „GR”, „ONE”; starsze wpisy tekstowe też). */
export function symbolMagazynu(m) {
  const t = String(m || '');
  if (/^\s*gr\b|gra[zż]/i.test(t)) return 'GR';
  if (/^\s*one\b/i.test(t)) return 'ONE';
  return 'INC';
}
const KASY_STALE = [
  { id: 'ELSTERSKA', nazwa: 'Elsterska', magazyny: ['INC', 'ONE'], opis: 'magazyn INC - Główny', domyslneKonto: 'Kasa OneRiver - magazyn', znacznik: 'INC' },
  { id: 'GRAZYNKA', nazwa: 'Grażynka', magazyny: ['GR'], opis: 'magazyn GR - Grażanka', domyslneKonto: 'Kasa Grażynka', znacznik: 'GR' },
];
const PREFIKS_WYD = 'WYD:';

function kontoKasy(kasa) {
  const l = konta(true);
  if (kasa.wydarzenie) return l.find(k => atrybuty(k).wydarzenia === true)?.nazwa || l.find(k => k.nazwa === 'Kasa wydarzeń')?.nazwa || '';
  return l.find(k => atrybuty(k).magazyn === kasa.znacznik && k.typKonta === 'gotowka')?.nazwa
    || l.find(k => k.nazwa === kasa.domyslneKonto)?.nazwa || '';
}
/** Prywatne konto gotówkowe, na które trafia gotówka z rozliczeń (widzi tylko Darius). */
export const kontoGotowkiPrywatnej = () => konta(true).find(k => k.prywatne && k.typKonta === 'gotowka')?.nazwa || '';

function kasaZId(id) {
  const st = KASY_STALE.find(k => k.id === id);
  if (st) return { ...st, konto: kontoKasy(st) };
  if (String(id).startsWith(PREFIKS_WYD)) {
    const nazwa = String(id).slice(PREFIKS_WYD.length);
    const k = { id, nazwa, wydarzenie: nazwa, opis: 'wydarzenie' };
    return { ...k, konto: kontoKasy(k) };
  }
  return null;
}
const kasaZamowienia = z => (String(z.wydarzenie || '').trim()
  ? PREFIKS_WYD + String(z.wydarzenie).trim()
  : (symbolMagazynu(z.magazyn) === 'GR' ? 'GRAZYNKA' : 'ELSTERSKA'));
const kasaParagonu = d => {
  const m = String(d.magazyn_symbol || '').toUpperCase();
  if (m === 'GR') return 'GRAZYNKA';
  if (m === 'INC' || m === 'ONE') return 'ELSTERSKA';
  return null;
};

// ───────────────────────── zamówienia Stoiska ↔ paragony Subiektu ─────────────────────────

const aktywneZamowienia = () => dane.zamowienia.filter(z => z.status !== 'anulowane' && z.status !== 'nowe');
const czySklepInternetowy = d => /^integrator/i.test(String(d.kontrahent_id || d.kontrahent_symbol || ''));

/**
 * Para zamówienie Stoiska → paragon z Subiektu: po numerze paragonu wpisanym w zamówieniu,
 * a bez niego po dacie, kwocie i kliencie ze Stoiska (symbol „ST…” albo paragon bez kontrahenta).
 * Każdy paragon pasuje do najwyżej jednego zamówienia.
 */
export function paryZamowienParagonow() {
  const zamDoPar = new Map(), parDoZam = new Map();
  const paragony = dane.sprzedaz.filter(d => !czySklepInternetowy(d));
  const kluczP = d => `${d.podmiot}|${d.dok_id}`;
  const zamowienia = aktywneZamowienia();
  // 1) numer paragonu wpisany w zamówieniu
  zamowienia.forEach(z => {
    const nr = normTxt(z.nr_dok_sgt).replace(/^pa\s*/, '');
    if (!nr) return;
    const d = paragony.find(p => !parDoZam.has(kluczP(p)) && normTxt(p.numer).replace(/^pa\s*/, '') === nr);
    if (d) { zamDoPar.set(String(z.id), d); parDoZam.set(kluczP(d), z); }
  });
  // 2) data + kwota + klient ze Stoiska
  zamowienia.forEach(z => {
    if (zamDoPar.has(String(z.id))) return;
    const d = paragony.find(p => !parDoZam.has(kluczP(p)) && dzien(p.data) === dzien(z.data)
      && Math.abs(num(p.brutto) - num(z.suma_brutto)) < 0.011
      && (/^ST/i.test(String(p.kontrahent_id || p.kontrahent_symbol || '')) || !String(p.kontrahent_id || p.kontrahent_symbol || '').trim()));
    if (d) { zamDoPar.set(String(z.id), d); parDoZam.set(kluczP(d), z); }
  });
  return { zamDoPar, parDoZam };
}

// ───────────────────────── sprzedaż gotówkowa do rozliczenia ─────────────────────────

const aktywneLiczenia = () => dane.liczeniaKasy.filter(l => l.status !== 'anulowane');
function pozycjeLiczenia(l) {
  try { return JSON.parse(l.pozycje || '[]'); } catch { return []; }
}
const rozliczoneKlucze = () => new Set(aktywneLiczenia().flatMap(pozycjeLiczenia));

/** Wszystkie pozycje sprzedaży gotówkowej (z przypisaną kasą). */
function sprzedazGotowkowa() {
  const { parDoZam } = paryZamowienParagonow();
  const l = [];
  aktywneZamowienia().forEach(z => {
    const kw = zaokr(num(z.kw_gotowka));
    if (kw <= 0) return;
    l.push({ klucz: 'Z:' + z.id, kasa: kasaZamowienia(z), data: dzien(z.data), kwota: kw, zrodlo: 'Stoisko',
      opis: `Zamówienie ${z.id}`, szczegol: [z.wydarzenie, z.forma_platnosci === 'Mieszana' ? 'płatność dzielona' : ''].filter(Boolean).join(' · ') });
  });
  dane.sprzedaz.forEach(d => {
    const kw = zaokr(num(d.kw_gotowka));
    if (kw <= 0 || czySklepInternetowy(d) || parDoZam.has(`${d.podmiot}|${d.dok_id}`)) return;
    // paragon już rozliczony z wpływem na konto (np. sklep oznaczony jako gotówka) – nie jest gotówką w kasie
    if (dane.rozliczenia.some(r => r.status !== 'anulowane' && r.obiekt_typ === 'paragon' && r.obiekt_id === `${d.podmiot}|${d.dok_id}`)) return;
    const kasa = kasaParagonu(d);
    if (!kasa) return;
    l.push({ klucz: `P:${d.podmiot}|${d.dok_id}`, kasa, data: dzien(d.data), kwota: kw, zrodlo: 'Subiekt',
      opis: `Paragon ${d.numer}`, szczegol: [d.kontrahent, d.podmiot].filter(Boolean).join(' · ') });
  });
  return l.sort((a, b) => a.data.localeCompare(b.data) || a.opis.localeCompare(b.opis, 'pl', { numeric: true }));
}
const nierozliczone = (kasaId, doDnia = '9999') => {
  const r = rozliczoneKlucze();
  return sprzedazGotowkowa().filter(p => p.kasa === kasaId && !r.has(p.klucz) && p.data <= doDnia);
};
const ostatnieLiczenie = kasaId => aktywneLiczenia().filter(l => l.kasa === kasaId).sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.utworzono).localeCompare(String(a.utworzono)))[0];

function listaKas() {
  const wydarzenia = new Set();
  sprzedazGotowkowa().forEach(p => { if (p.kasa.startsWith(PREFIKS_WYD)) wydarzenia.add(p.kasa); });
  aktywneLiczenia().forEach(l => { if (String(l.kasa).startsWith(PREFIKS_WYD)) wydarzenia.add(l.kasa); });
  return [...KASY_STALE.map(k => kasaZId(k.id)), ...[...wydarzenia].sort().map(kasaZId)];
}

// ───────────────────────── widoki ─────────────────────────

export function zakladkiRozliczen(aktywna) {
  return `<div class="zakladki-rozl" role="tablist">
    <a href="#rozliczenia" role="tab" aria-selected="${aktywna === 'bezgotowkowe'}">Paragony – przelew / BLIK / Revolut</a>
    <a href="#kasa" role="tab" aria-selected="${aktywna === 'kasa'}">Paragony gotówkowe – kasa</a>
  </div>`;
}

function renderLista() {
  const dzis = dataLok();
  const kasy = listaKas();
  const karta = k => {
    const n = nierozliczone(k.id);
    const suma = zaokr(n.reduce((s, p) => s + p.kwota, 0));
    const ost = ostatnieLiczenie(k.id);
    const saldo = k.konto ? saldoNaDzien(k.konto, 'PLN', dzis) : 0;
    const zakonczone = k.wydarzenie && !n.length && ost;
    return `<li class="kasa-karta${zakonczone ? ' zakonczona' : ''}">
      <div class="kasa-gora"><b>${esc(k.wydarzenie ? k.nazwa : 'Kasa ' + k.nazwa)}</b><small>${esc(k.opis)}${k.konto ? ' · konto ' + esc(k.konto) : ' · <span class="ostrzezenie">brak konta kasy</span>'}</small></div>
      <dl class="kasa-liczby">
        <div><dt>Nierozliczona sprzedaż gotówkowa</dt><dd>${esc(kwotaTxt(suma))}<small>${n.length} ${odmiana(n.length, 'pozycja', 'pozycje', 'pozycji')}${n.length ? ` od ${esc(dataKrotko(n[0].data))}` : ''}</small></dd></div>
        <div><dt>Saldo konta kasy</dt><dd>${esc(kwotaTxt(saldo))}</dd></div>
        <div><dt>Ostatnie liczenie</dt><dd>${ost ? `<a href="#kasa/l:${encodeURIComponent(ost.id)}">${esc(dataKrotko(dzien(ost.data)))}</a><small>${num(ost.roznica) ? 'różnica ' + esc(kwotaTxt(num(ost.roznica))) : 'bez różnicy'}</small>` : '—'}</dd></div>
      </dl>
      <a class="przycisk${n.length || saldo ? '' : ' drugorzedny'}" href="#kasa/${encodeURIComponent(k.id)}">Rozlicz kasę</a>
    </li>`;
  };
  const historia = aktywneLiczenia().sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.utworzono).localeCompare(String(a.utworzono))).slice(0, 40);
  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran kasa-ekran">
    <div class="naglowek-sekcji"><h1>Rozliczenia</h1></div>
    ${zakladkiRozliczen('kasa')}
    <p class="uwagi-podsumowania">Elsterską i Grażynkę liczysz raz w miesiącu, każde wydarzenie osobno. Sprzedaż ze Stoiska z wpisanym wydarzeniem rozlicza się w kasie wydarzenia, bez wydarzenia – w kasie magazynu.</p>
    <ul class="kasy">${kasy.map(karta).join('')}</ul>
    <h2 class="podtytul-sekcji">Historia liczeń</h2>
    <ul class="lista-rozl">${historia.map(l => `<li class="wiersz-rozl">
      <span class="data-rozl">${esc(dataKrotko(dzien(l.data)))}</span>
      <span class="opis-rozl"><b><a href="#kasa/l:${encodeURIComponent(l.id)}">${esc(l.nazwa_kasy || l.kasa)}</a></b>
        <span>policzono ${esc(kwotaTxt(num(l.policzono)))}${num(l.roznica) ? ` · różnica ${esc(kwotaTxt(num(l.roznica)))}` : ''}${num(l.przekazano) ? ` · do Gotówki ${esc(kwotaTxt(num(l.przekazano)))}` : ''}</span></span>
      <span class="kwoty-rozl"><b>${esc(kwotaTxt(num(l.sprzedaz)))}</b></span>
    </li>`).join('') || '<li class="pusto">Jeszcze nie liczono kasy.</li>'}</ul>
  </section>`;
}

// stan formularza liczenia
let f = null;

function nowyFormularz(kasa) {
  const dzis = dataLok();
  const poz = nierozliczone(kasa.id, dzis);
  const zrodla = glowne('wpływ').map(k => k.nazwa);
  return {
    kasaId: kasa.id, data: dzis, odznaczone: new Set(), policzono: '', opisRoznicy: '', ksiegujRoznice: true,
    przekazac: '', przekazacRecznie: false, zrodlo: zrodla.find(n => /stois|kiermasz/i.test(n)) || zrodla[0] || '', pozycjeStart: poz.map(p => p.klucz),
  };
}

function wyliczenia(kasa) {
  const poz = nierozliczone(kasa.id, f.data);
  const wybrane = poz.filter(p => !f.odznaczone.has(p.klucz));
  const sprzedaz = zaokr(wybrane.reduce((s, p) => s + p.kwota, 0));
  const saldo = kasa.konto ? saldoNaDzien(kasa.konto, 'PLN', f.data) : 0;
  const powinno = zaokr(saldo + sprzedaz);
  const policzono = f.policzono === '' ? null : zaokr(liczba(f.policzono));
  const roznica = policzono === null ? 0 : zaokr(policzono - powinno);
  const przekazac = f.przekazacRecznie ? zaokr(liczba(f.przekazac) || 0) : (policzono ?? 0);
  return { poz, wybrane, sprzedaz, saldo, powinno, policzono, roznica, przekazac, zostaje: zaokr((policzono ?? 0) - przekazac) };
}

function ruchyKasy(kasa, doDnia) {
  if (!kasa.konto) return [];
  const ost = ostatnieLiczenie(kasa.id);
  const od = ost ? dzien(ost.data) : '';
  return dane.transakcje.filter(t => t.konto === kasa.konto && t.status !== 'anulowana' && dzien(t.data_operacji) <= doDnia && (!od || dzien(t.data_operacji) >= od))
    .sort((a, b) => String(a.data_operacji).localeCompare(String(b.data_operacji)));
}

function htmlPodsumowaniaLiczenia(kasa) {
  const w = wyliczenia(kasa);
  return `<dl class="kasa-rachunek">
      <div><dt>Saldo konta kasy na ${esc(dataKrotko(f.data))}</dt><dd>${esc(kwotaTxt(w.saldo))}</dd></div>
      <div><dt>+ sprzedaż gotówkowa (${w.wybrane.length})</dt><dd>${esc(kwotaTxt(w.sprzedaz))}</dd></div>
      <div class="suma"><dt>Powinno być w kasie</dt><dd>${esc(kwotaTxt(w.powinno))}</dd></div>
      ${w.policzono !== null ? `<div class="suma ${w.roznica ? (w.roznica > 0 ? 'nadwyzka' : 'brak') : 'zgodne'}"><dt>Różnica (policzono − powinno)</dt><dd>${w.roznica ? esc(kwotaTxt(w.roznica)) : 'zgadza się ✓'}</dd></div>` : ''}
    </dl>`;
}

function renderLiczenie(id) {
  const kasa = kasaZId(id);
  if (!kasa) { location.replace('#kasa'); return; }
  if (!f || f.kasaId !== kasa.id) f = nowyFormularz(kasa);
  const w = wyliczenia(kasa);
  const gotowkaPryw = kontoGotowkiPrywatnej();
  const ruchy = ruchyKasy(kasa, f.data);
  const zrodla = glowne('wpływ').map(k => k.nazwa);
  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran kasa-ekran">
    <a class="wstecz" href="#kasa">Kasa</a>
    <div class="naglowek-sekcji"><h1>Rozlicz: ${esc(kasa.wydarzenie ? kasa.nazwa : 'Kasa ' + kasa.nazwa)}</h1></div>
    ${!kasa.konto ? `<div class="pasek-edycji"><span>Brak konta gotówkowego dla tej kasy. Dodaj je w Edytuj dane → Konta${kasa.wydarzenie ? ' (np. „Kasa wydarzeń”)' : ''}.</span></div>` : ''}
    <form class="karta-ustawien kasa-formularz" data-forma="kasa" novalidate>
      <label class="pole"><span class="etykieta">Data liczenia</span><input type="date" name="data" value="${esc(f.data)}" max="${esc(dataLok())}"></label>

      <h2>Sprzedaż gotówkowa do rozliczenia</h2>
      ${w.poz.length ? `<ul class="kasa-pozycje">${w.poz.map(p => `<li><label>
          <input type="checkbox" data-akcja="pozycja" data-v="${esc(p.klucz)}" ${f.odznaczone.has(p.klucz) ? '' : 'checked'}>
          <span class="kp-opis"><b>${esc(p.opis)}</b><small>${esc(dataKrotko(p.data))} · ${esc(p.zrodlo)}${p.szczegol ? ' · ' + esc(p.szczegol) : ''}</small></span>
          <span class="kp-kwota">${esc(kwotaTxt(p.kwota))}</span></label></li>`).join('')}</ul>
        <p class="podpowiedz">Odznacz pozycje, których gotówki nie ma w tej kasie (rozliczysz je później).</p>`
        : '<p class="pusto">Brak nierozliczonej sprzedaży gotówkowej do tego dnia.</p>'}

      ${ruchy.length ? `<details class="kasa-ruchy"><summary>Ruchy na koncie kasy od ostatniego liczenia (${ruchy.length}) – są już w saldzie</summary>
        <ul>${ruchy.map(t => `<li><span>${esc(dataKrotko(dzien(t.data_operacji)))}</span><span>${esc(t.kontrahent || t.kategoria || t.zrodlo_przychodu || t.opis || t.typ)}</span>
          <b>${kierunek(t) === 'wpływ' ? '+' : '−'}${esc(kwotaTxt(num(t.kwota)))}</b></li>`).join('')}</ul></details>` : ''}

      <div id="kasa-rachunek">${htmlPodsumowaniaLiczenia(kasa)}</div>

      <label class="pole"><span class="etykieta">Ile gotówki jest w kasie (policzone)</span>
        <input name="policzono" inputmode="decimal" autocomplete="off" value="${esc(f.policzono)}" placeholder="np. 1 250,00"></label>
      <div id="kasa-roznica">${htmlRoznicy(kasa)}</div>

      <h2>Przekazanie gotówki</h2>
      ${gotowkaPryw ? `<label class="pole"><span class="etykieta">Przekaż do konta „${esc(gotowkaPryw)}”</span>
          <input name="przekazac" inputmode="decimal" autocomplete="off" value="${esc(f.przekazacRecznie ? f.przekazac : liczbaNaTekst(w.przekazac))}">
          <span class="podpowiedz" id="kasa-zostaje">Zostaje w kasie: ${esc(kwotaTxt(w.zostaje))}${w.zostaje ? ' (np. na wydawanie reszty)' : ''}</span></label>`
        : `<p class="podpowiedz">${mozePrywatne() ? 'Nie ma prywatnego konta gotówkowego – oznacz konto „Gotówka” jako prywatne w Edytuj dane → Konta.' : 'Przekazanie gotówki do konta prywatnego zapisuje Darius. Ty zapisujesz samo liczenie.'}</p>`}

      <label class="pole"><span class="etykieta">Utarg księgowany jako źródło przychodu</span>
        <select name="zrodlo">${zrodla.map(z => `<option ${z === f.zrodlo ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>

      <div class="przyciski">
        <button type="submit" ${kasa.konto ? '' : 'disabled'}>Zapisz liczenie</button>
        <a class="przycisk drugorzedny" href="#kasa">Wróć</a>
      </div>
    </form>
  </section>`;
}

function htmlRoznicy(kasa) {
  const w = wyliczenia(kasa);
  if (w.policzono === null || !w.roznica) return '';
  return `<label class="pole"><span class="etykieta">Skąd różnica? (nieobowiązkowo)</span>
      <input name="opis_roznicy" value="${esc(f.opisRoznicy)}" autocomplete="off" placeholder="np. wydana reszta, zakup bez paragonu, pomyłka"></label>
    <label class="przelacznik opis"><input type="checkbox" data-akcja="ksieguj-roznice" ${f.ksiegujRoznice ? 'checked' : ''}>
      <span>Zaksięguj różnicę ${esc(kwotaTxt(w.roznica))} na koncie kasy (${w.roznica > 0 ? 'wpływ' : 'wydatek'} „Różnica kasowa”), żeby saldo zgadzało się z gotówką. Bez tego różnica zostaje otwarta.</span></label>`;
}

function odswiezRachunek() {
  const kasa = kasaZId(f.kasaId);
  $('#kasa-rachunek').innerHTML = htmlPodsumowaniaLiczenia(kasa);
  const r = $('#kasa-roznica');
  const fokus = document.activeElement?.name;
  if (fokus !== 'opis_roznicy') r.innerHTML = htmlRoznicy(kasa);
  const w = wyliczenia(kasa);
  const p = $('[name=przekazac]');
  if (p && !f.przekazacRecznie && document.activeElement !== p) p.value = liczbaNaTekst(w.przekazac);
  const z = $('#kasa-zostaje');
  if (z) z.textContent = `Zostaje w kasie: ${kwotaTxt(w.zostaje)}${w.zostaje ? ' (np. na wydawanie reszty)' : ''}`;
}

function renderSzczegoly(id) {
  const l = dane.liczeniaKasy.find(x => String(x.id) === id);
  if (!l) { location.replace('#kasa'); return; }
  const klucze = pozycjeLiczenia(l);
  const wszystkie = new Map(sprzedazGotowkowa().map(p => [p.klucz, p]));
  let idT = [];
  try { idT = JSON.parse(l.transakcje || '[]'); } catch { /* brak */ }
  const tr = idT.map(i => dane.transakcje.find(t => t.id === i)).filter(Boolean);
  $('#widok').innerHTML = `
  <section class="ekran rozliczenia-ekran kasa-ekran">
    <a class="wstecz" href="#kasa">Kasa</a>
    <div class="naglowek-sekcji"><h1>${esc(l.nazwa_kasy || l.kasa)} – liczenie ${esc(dataKrotko(dzien(l.data)))}</h1>${l.status === 'anulowane' ? '<span class="znacznik">anulowane</span>' : ''}</div>
    <dl class="kasa-rachunek">
      <div><dt>Saldo konta kasy przed</dt><dd>${esc(kwotaTxt(num(l.saldo_przed)))}</dd></div>
      <div><dt>Sprzedaż gotówkowa</dt><dd>${esc(kwotaTxt(num(l.sprzedaz)))}</dd></div>
      <div class="suma"><dt>Powinno być</dt><dd>${esc(kwotaTxt(num(l.powinno_byc)))}</dd></div>
      <div class="suma"><dt>Policzono</dt><dd>${esc(kwotaTxt(num(l.policzono)))}</dd></div>
      <div><dt>Różnica</dt><dd>${num(l.roznica) ? esc(kwotaTxt(num(l.roznica))) : 'brak'}${l.opis_roznicy ? `<small>${esc(l.opis_roznicy)}</small>` : ''}</dd></div>
      <div><dt>Przekazano do Gotówki</dt><dd>${esc(kwotaTxt(num(l.przekazano)))}</dd></div>
      <div><dt>Zostało w kasie</dt><dd>${esc(kwotaTxt(num(l.zostawiono)))}</dd></div>
    </dl>
    <h2>Pozycje (${klucze.length})</h2>
    <ul class="kasa-pozycje">${klucze.map(k => { const p = wszystkie.get(k); return `<li><span class="kp-opis"><b>${esc(p?.opis || k)}</b><small>${p ? esc(dataKrotko(p.data)) + ' · ' + esc(p.zrodlo) : ''}</small></span><span class="kp-kwota">${p ? esc(kwotaTxt(p.kwota)) : ''}</span></li>`; }).join('')}</ul>
    ${tr.length ? `<h2>Zaksięgowano</h2><ul class="kasa-pozycje">${tr.map(t => `<li><span class="kp-opis"><b><a href="#edytuj/${encodeURIComponent(t.id)}">${esc(t.opis || t.typ)}</a></b><small>${esc(t.konto)} · ${esc(t.typ)}${t.status === 'anulowana' ? ' · anulowana' : ''}</small></span><span class="kp-kwota">${esc(kwotaTxt(num(t.kwota)))}</span></li>`).join('')}</ul>` : ''}
    ${l.status !== 'anulowane' ? `<div class="przyciski"><button type="button" class="drugorzedny" data-akcja="cofnij-liczenie" data-v="${esc(l.id)}">Cofnij to liczenie</button></div>
      <p class="podpowiedz">Cofnięcie anuluje zaksięgowane wpisy, a pozycje wrócą do rozliczenia.</p>` : ''}
  </section>`;
}

function render(arg) {
  if (!arg) { f = null; renderLista(); }
  else if (arg.startsWith('l:')) renderSzczegoly(arg.slice(2));
  else renderLiczenie(arg);
}

// ───────────────────────── zapis ─────────────────────────

function wierszTransakcji(pola) {
  const kwota = zaokr(pola.kwota);
  return {
    id: uuid(), id_pary: '', podzial_id: '', waluta: 'PLN', kurs: 1, kwota_pln: kwota, kategoria: '', podkategoria: '', zrodlo_przychodu: '',
    kontrahent: '', podmiot: '', budzet: '', cel: '', status: BEZ_WYCIAGU, zrodlo: 'kasa', tagi: 'kasa', nr_dokumentu: '', zalacznik: '', dowod: '',
    ...pola, kwota,
  };
}

async function zapiszLiczenie() {
  const kasa = kasaZId(f.kasaId);
  const w = wyliczenia(kasa);
  if (!kasa.konto) return toast('Brak konta kasy.', 'blad');
  if (w.policzono === null) return toast('Wpisz, ile gotówki policzyłeś.', 'blad');
  const gotowkaPryw = mozePrywatne() ? kontoGotowkiPrywatnej() : '';
  if (gotowkaPryw && (w.przekazac < 0 || w.przekazac > w.policzono + 0.004)) return toast('Kwota przekazania musi być między 0 a policzoną gotówką.', 'blad');
  const nazwaKasy = kasa.wydarzenie ? kasa.nazwa : 'Kasa ' + kasa.nazwa;
  const opisOkresu = `${nazwaKasy}, liczenie ${f.data}`;
  const podmiotKasy = konta(true).find(k => k.nazwa === kasa.konto)?.podmiot || 'INCO';

  const potwierdz = await okno('Zapisać liczenie kasy?', `<ul class="lista-podobnych">
      <li>Utarg ${esc(kwotaTxt(w.sprzedaz))} → wpływ na konto ${esc(kasa.konto)}</li>
      ${w.roznica && f.ksiegujRoznice ? `<li>Różnica kasowa ${esc(kwotaTxt(w.roznica))} → ${w.roznica > 0 ? 'wpływ' : 'wydatek'} na koncie kasy</li>` : ''}
      ${w.roznica && !f.ksiegujRoznice ? `<li>Różnica ${esc(kwotaTxt(w.roznica))} zostaje otwarta</li>` : ''}
      ${gotowkaPryw && w.przekazac > 0 ? `<li>Przekazanie ${esc(kwotaTxt(w.przekazac))} → ${esc(gotowkaPryw)} (zostaje ${esc(kwotaTxt(w.zostaje))})</li>` : ''}
    </ul>`, [{ etykieta: 'Wróć', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Zapisz', wartosc: true, autofocus: true }]);
  if (!potwierdz) return;

  const tr = [];
  if (w.sprzedaz > 0) {
    tr.push(wierszTransakcji({ typ: 'wpływ', konto: kasa.konto, kwota: w.sprzedaz, data_operacji: f.data, zrodlo_przychodu: f.zrodlo,
      podmiot: podmiotKasy, opis: `Utarg gotówkowy – ${opisOkresu} (${w.wybrane.length} ${odmiana(w.wybrane.length, 'pozycja', 'pozycje', 'pozycji')})` }));
  }
  if (w.roznica && f.ksiegujRoznice) {
    tr.push(wierszTransakcji({ typ: w.roznica > 0 ? 'wpływ' : 'wydatek', konto: kasa.konto, kwota: Math.abs(w.roznica), data_operacji: f.data,
      zrodlo_przychodu: w.roznica > 0 ? 'Inne' : '', kategoria: w.roznica < 0 ? 'Inne' : '', podmiot: podmiotKasy,
      opis: `Różnica kasowa – ${opisOkresu}${f.opisRoznicy ? ': ' + f.opisRoznicy : ''}` }));
  }
  const saldoPo = zaokr(w.saldo + w.sprzedaz + (f.ksiegujRoznice ? w.roznica : 0));
  if (gotowkaPryw && w.przekazac > 0) {
    if (w.przekazac > saldoPo + 0.004) return toast('Przekazujesz więcej, niż będzie na koncie kasy.', 'blad');
    const para = uuid();
    tr.push(wierszTransakcji({ typ: 'przeksięgowanie-wypływ', id_pary: para, konto: kasa.konto, kwota: w.przekazac, data_operacji: f.data, opis: `Przekazanie gotówki – ${opisOkresu}` }));
    tr.push(wierszTransakcji({ typ: 'przeksięgowanie-wpływ', id_pary: para, konto: gotowkaPryw, kwota: w.przekazac, data_operacji: f.data, podmiot: 'Prywatne', opis: `Przekazanie gotówki – ${opisOkresu}` }));
  }
  const liczenie = {
    id: 'KASA-' + uuid().slice(0, 8), kasa: kasa.id, nazwa_kasy: nazwaKasy, konto: kasa.konto, data: f.data,
    od: w.wybrane[0]?.data || '', do: f.data, saldo_przed: String(w.saldo), sprzedaz: String(w.sprzedaz), powinno_byc: String(w.powinno),
    policzono: String(w.policzono), roznica: String(w.roznica), opis_roznicy: f.opisRoznicy || '', przekazano: String(gotowkaPryw ? w.przekazac : 0),
    zostawiono: String(gotowkaPryw ? w.zostaje : w.policzono), pozycje: JSON.stringify(w.wybrane.map(p => p.klucz)),
    transakcje: JSON.stringify(tr.map(t => t.id)), status: w.roznica && !f.ksiegujRoznice ? 'różnica otwarta' : 'rozliczone', uwagi: '',
  };
  const paczki = [{ karta: 'KASA_LICZENIA', wiersze: [liczenie] }];
  if (tr.length) paczki.unshift({ karta: 'TRANSAKCJE', wiersze: tr });
  await sync.zapiszWiele(paczki);
  await wczytajDane();
  toast(`Zapisano liczenie: ${nazwaKasy}.`, 'ok');
  f = null;
  location.hash = '#kasa/l:' + encodeURIComponent(liczenie.id);
}

async function cofnijLiczenie(id) {
  const l = dane.liczeniaKasy.find(x => String(x.id) === id);
  if (!l) return;
  const tak = await okno('Cofnąć liczenie?', '<p>Zaksięgowany utarg, różnica i przekazanie zostaną anulowane, a pozycje wrócą do rozliczenia.</p>',
    [{ etykieta: 'Wróć', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Cofnij liczenie', wartosc: true }]);
  if (!tak) return;
  let idT = [];
  try { idT = JSON.parse(l.transakcje || '[]'); } catch { /* brak */ }
  const tr = idT.map(i => dane.transakcje.find(t => t.id === i)).filter(Boolean).map(t => ({ ...t, status: 'anulowana' }));
  const paczki = [{ karta: 'KASA_LICZENIA', wiersze: [{ ...l, status: 'anulowane' }] }];
  if (tr.length) paczki.unshift({ karta: 'TRANSAKCJE', wiersze: tr });
  await sync.zapiszWiele(paczki);
  await wczytajDane();
  toast('Liczenie cofnięte.', 'ok');
  renderSzczegoly(id);
}

// ───────────────────────── zdarzenia ─────────────────────────

function zbierz() {
  const form = $('form[data-forma="kasa"]');
  if (!form || !f) return;
  f.policzono = form.elements.policzono?.value ?? f.policzono;
  if (form.elements.opis_roznicy) f.opisRoznicy = form.elements.opis_roznicy.value;
  if (form.elements.zrodlo) f.zrodlo = form.elements.zrodlo.value;
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'pozycja') { zbierz(); if (b.checked) f.odznaczone.delete(v); else f.odznaczone.add(v); odswiezRachunek(); return; }
  if (akcja === 'ksieguj-roznice') { f.ksiegujRoznice = b.checked; return; }
  if (akcja === 'cofnij-liczenie') { await cofnijLiczenie(v); }
}

function wejscie(e) {
  const n = e.target.name;
  if (!f || !['policzono', 'przekazac', 'opis_roznicy'].includes(n)) return;
  zbierz();
  if (n === 'przekazac') { f.przekazac = e.target.value; f.przekazacRecznie = e.target.value.trim() !== ''; }
  odswiezRachunek();
}

function zmiana(e) {
  if (!f) return;
  if (e.target.name === 'data') {
    zbierz();
    f.data = e.target.value || dataLok();
    bezSkoku(() => renderLiczenie(f.kasaId));
  } else if (e.target.name === 'zrodlo') f.zrodlo = e.target.value;
}

async function submit(form) {
  if (form.dataset.forma !== 'kasa') return;
  zbierz();
  await zapiszLiczenie();
}

export const ekran = { render, klik, wejscie, zmiana, submit };
