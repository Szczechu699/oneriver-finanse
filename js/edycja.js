// „Edytuj dane”: konta (z saldem), kategorie z podkategoriami, tytuły podpowiadające kategorię.

import * as sync from './sync.js';
import { $, $$, esc, zaokr, kwotaTxt, dataLok, uuid, liczba, liczbaNaTekst, odmiana, toast, okno, bezSkoku } from './util.js';
import {
  dane, wczytajDane, atrybuty, aktywna, lista, konta, KOLORY_KONT, KOLORY, waluty, glowne, podrzedne, listaKategorii,
  ikona, kolorKategorii, tytuly, stanKont, kategorieBudzetu, podmioty,
} from './dane.js';
import { ikonaSvg } from './ikony.js';

const EMOJI = ['📦', '🚚', '👥', '🏠', '💡', '🧺', '🛒', '🏷️', '🖨️', '🛠️', '💻', '📱', '🏛️', '🧾', '✈️', '🚗', '⛽', '🍽️', '☕',
  '🎪', '🪶', '🧭', '🌍', '🎁', '📚', '🎓', '💊', '🧴', '👕', '💍', '🌿', '🎵', '🥁', '📣', '📸', '🏦', '💳', '💰', '📈', '🤝', '❓'];

const wierszSlownika = (w, zmiany) => {
  const a = { ...atrybuty(w), ...(zmiany.atrybuty || {}) };
  return { ...w, ...zmiany, atrybuty: JSON.stringify(a) };
};

/**
 * Zmiana nazw (konta, kategorii, podkategorii) we wszystkich wierszach, które ich używają – w arkuszu nazwy są zapisane wprost.
 * reguly: [{ pola, stara, nowa, warunek? }]; każdy wiersz powstaje raz, ze wszystkimi zmianami naraz.
 */
function przemianuj(reguly) {
  const paczki = [];
  for (const [karta, wiersze] of [['TRANSAKCJE', dane.transakcje], ['PLANOWANE', dane.planowane], ['POZYCZKI', dane.pozyczki]]) {
    const zm = [];
    wiersze.forEach(w => {
      let n = null;
      reguly.forEach(r => {
        if (r.warunek && !r.warunek(w)) return;
        if (!r.pola.some(p => w[p] === r.stara)) return;
        n = n || { ...w };
        r.pola.forEach(p => { if (w[p] === r.stara) n[p] = r.nowa; });
      });
      if (n) zm.push(n);
    });
    if (zm.length) paczki.push({ karta, wiersze: zm });
  }
  return paczki;
}
const ileWierszy = paczki => paczki.reduce((s, p) => s + p.wiersze.length, 0);

// ── hub ──

function renderHub() {
  const kafle = [
    ['konta', 'Konta', '#konta', `${konta().length} ${odmiana(konta().length, 'konto', 'konta', 'kont')}`],
    ['kategorie', 'Kategorie', '#kategorie', `${glowne('wydatek').length} wydatków, ${glowne('wpływ').length} wpływów`],
    ['tytuly', 'Tytuły', '#tytuly', `${tytuly().length} ${odmiana(tytuly().length, 'tytuł', 'tytuły', 'tytułów')} z kategorią`],
    ['budzety', 'Budżety i cele', '#budzety', ''],
    ['pozyczki', 'Pożyczki', '#pozyczki', ''],
    ['subskrypcje', 'Subskrypcje', '#subskrypcje', ''],
    ['ustawienia', 'Ustawienia', '#ustawienia', 'połączenie, synchronizacja'],
  ];
  $('#widok').innerHTML = `
  <section class="ekran edycja">
    <h1>Edytuj dane</h1>
    <div class="kafle-danych">${kafle.map(([ik, nazwa, href, opis]) => `
      <a class="kafel-danych" href="${href}">${ikonaSvg(ik)}<b>${esc(nazwa)}</b>${opis ? `<span>${esc(opis)}</span>` : ''}</a>`).join('')}</div>
  </section>`;
}

// ── konta ──

function renderKonta() {
  const stan = stanKont();
  const archiwum = konta(true).filter(k => !aktywna(k));
  const karta = k => {
    const s = stan.get(k.nazwa);
    const salda = Object.entries(s?.salda || {});
    return `<a class="karta-konta" href="#konto/${encodeURIComponent(k.id)}" style="--k:${esc(k.kolor)}">
      <span class="gora-karty"><b>${esc(k.nazwa)}</b><span>${esc(k.waluta || 'różne waluty')}</span></span>
      <span class="saldo">${salda.length ? salda.map(([w, v]) => `<b class="${v < 0 ? 'minus' : 'plus'}">${esc(kwotaTxt(v, w))}</b>`).join('') : '<span class="pusto">saldo nieustalone</span>'}</span>
      <span class="dol-karty">${s?.liczba || 0} ${odmiana(s?.liczba || 0, 'transakcja', 'transakcje', 'transakcji')}${s?.odDaty ? `, saldo od ${esc(s.odDaty)}` : ''}${k.podmiot ? `, domyślnie ${esc(k.podmiot)}` : ''}${k.wirtualne ? ', wirtualne' : ''}</span>
    </a>`;
  };
  $('#widok').innerHTML = `
  <section class="ekran konta-ekran">
    <a class="wstecz" href="#dane">Edytuj dane</a>
    <div class="naglowek-sekcji"><h1>Konta</h1><a class="przycisk" href="#konto/nowe">Nowe konto</a></div>
    <div class="karty-kont">${konta().map(karta).join('')}</div>
    <p class="uwagi-podsumowania">Saldo to saldo początkowe plus wszystkie wpisane transakcje od jego daty. Wpisz saldo początkowe w koncie, żeby zgadzało się z bankiem.</p>
    ${archiwum.length ? `<details class="wiecej"><summary>Zarchiwizowane (${archiwum.length})</summary><div class="karty-kont">${archiwum.map(karta).join('')}</div></details>` : ''}
  </section>`;
}

let kf = null;

function renderKonto(id) {
  if (!kf || kf.klucz !== id) {
    const k = id === 'nowe' ? null : konta(true).find(x => x.id === id);
    if (id !== 'nowe' && !k) { location.hash = '#konta'; return; }
    const a = atrybuty(k);
    kf = {
      klucz: id, oryginal: k, nazwa: k?.nazwa || '', waluta: k ? (a.waluta || '') : 'PLN', typ: a.typ || 'bank',
      kolor: k?.kolor || KOLORY_KONT[konta(true).length % KOLORY_KONT.length], saldo: a.saldo_poczatkowe !== undefined && a.saldo_poczatkowe !== '' ? liczbaNaTekst(a.saldo_poczatkowe) : '',
      data_salda: a.data_salda || '', identyfikator: a.iban || a.email || a.identyfikator || '', aktywne: k ? aktywna(k) : true,
      podmiot: a.podmiot || '',
    };
  }
  $('#widok').innerHTML = `
  <section class="ekran formularz-konta">
    <a class="wstecz" href="#konta">Konta</a>
    <h1>${kf.oryginal ? 'Edycja konta' : 'Nowe konto'}</h1>
    <form class="karta-ustawien" data-forma="konto" novalidate>
      <label class="pole"><span class="etykieta">Nazwa</span><input name="nazwa" value="${esc(kf.nazwa)}" placeholder="np. mBank PLN" autocomplete="off"></label>
      <fieldset class="pole"><legend>Waluta</legend><div class="chipy">${[...waluty(), ''].map(w =>
        `<button type="button" class="chip" data-akcja="k-waluta" data-v="${w}" aria-pressed="${kf.waluta === w}">${w || 'Różne (np. PayPal)'}</button>`).join('')}</div></fieldset>
      <fieldset class="pole"><legend>Rodzaj</legend><div class="chipy">${[['bank', 'Konto bankowe'], ['karta', 'Karta'], ['portfel', 'Portfel elektroniczny'], ['gotowka', 'Gotówka'], ['skarbonka', 'Skarbonka (wirtualna)']].map(([t, e]) =>
        `<button type="button" class="chip" data-akcja="k-typ" data-v="${t}" aria-pressed="${kf.typ === t}">${e}</button>`).join('')}</div>
        ${kf.typ === 'skarbonka' ? '<span class="podpowiedz">Wirtualne konto na cele: przesunięcia do niego nie zmieniają salda prawdziwych kont i nie czekają na wyciąg.</span>' : ''}</fieldset>
      <fieldset class="pole"><legend>Domyślnie dotyczy</legend><div class="chipy">${[...podmioty(), ''].map(p =>
        `<button type="button" class="chip" data-akcja="k-podmiot" data-v="${esc(p)}" aria-pressed="${kf.podmiot === p}">${esc(p || 'Bez domyślnego')}</button>`).join('')}</div>
        <span class="podpowiedz">Podstawi się przy wpisie z tego konta; zawsze można zmienić.</span></fieldset>
      <fieldset class="pole"><legend>Kolor</legend><div class="kolory">${KOLORY_KONT.map(k =>
        `<button type="button" data-akcja="k-kolor" data-v="${k}" aria-pressed="${kf.kolor === k}" style="--k:${k}" aria-label="Kolor ${k}"></button>`).join('')}</div></fieldset>
      <div class="rzad">
        <label class="pole"><span class="etykieta">Saldo początkowe${kf.waluta ? ` (${esc(kf.waluta)})` : ' (PLN)'}</span>
          <input name="saldo" inputmode="decimal" value="${esc(kf.saldo)}" placeholder="np. 5 001,50" autocomplete="off"></label>
        <label class="pole"><span class="etykieta">Na dzień</span><input type="date" name="data_salda" value="${esc(kf.data_salda)}"></label>
      </div>
      <span class="podpowiedz">Wpisz saldo z banku na wybrany dzień. Transakcje sprzed tej daty nie zmienią salda.</span>
      <label class="pole"><span class="etykieta">Numer rachunku lub e-mail konta</span>
        <input name="identyfikator" value="${esc(kf.identyfikator)}" autocomplete="off" spellcheck="false"></label>
      <div class="przyciski">
        <button type="submit">${kf.oryginal ? 'Zapisz zmiany' : 'Dodaj konto'}</button>
        ${kf.oryginal ? `<button type="button" class="drugorzedny" data-akcja="k-archiwum">${kf.aktywne ? 'Zarchiwizuj' : 'Przywróć z archiwum'}</button>` : ''}
        <a class="przycisk drugorzedny" href="#konta">Wróć</a>
      </div>
    </form>
  </section>`;
}

async function zapiszKonto(archiwizuj = null) {
  const form = $('form[data-forma="konto"]');
  ['nazwa', 'saldo', 'data_salda', 'identyfikator'].forEach(n => { kf[n] = form.elements[n].value.trim(); });
  if (!kf.nazwa) return toast('Wpisz nazwę konta.', 'blad');
  const inne = konta(true).find(k => k.nazwa.toLowerCase() === kf.nazwa.toLowerCase() && k.id !== kf.oryginal?.id);
  if (inne) return toast('Konto o takiej nazwie już istnieje.', 'blad');
  const o = kf.oryginal;
  const atr = {
    waluta: kf.waluta, typ: kf.typ, kolor: kf.kolor, podmiot: kf.podmiot, wirtualne: kf.typ === 'skarbonka',
    saldo_poczatkowe: kf.saldo === '' ? '' : zaokr(liczba(kf.saldo)), data_salda: kf.data_salda,
    [kf.identyfikator.includes('@') ? 'email' : 'iban']: kf.identyfikator,
  };
  const w = o
    ? wierszSlownika(o, { nazwa: kf.nazwa, atrybuty: atr, aktywna: archiwizuj === null ? aktywna(o) : !archiwizuj })
    : { lista: 'konta', id: 'KON-' + uuid().slice(0, 8), nazwa: kf.nazwa, rodzic: '', atrybuty: JSON.stringify(atr), aktywna: true, kolejnosc: konta(true).length + 1 };
  const paczki = [{ karta: 'SLOWNIK', wiersze: [w] }];
  if (o && o.nazwa !== kf.nazwa) {
    const zm = przemianuj([{ pola: ['konto', 'konto_docelowe'], stara: o.nazwa, nowa: kf.nazwa }]);
    if (ileWierszy(zm)) {
      const tak = await okno('Zmienić nazwę konta?', `<p>Nazwa zmieni się też w ${ileWierszy(zm)} zapisanych pozycjach.</p>`,
        [{ etykieta: 'Wróć', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Zmień nazwę', wartosc: true, autofocus: true }]);
      if (!tak) return;
    }
    paczki.push(...zm);
  }
  await sync.zapiszWiele(paczki);
  await wczytajDane();
  toast(archiwizuj === true ? 'Konto zarchiwizowane.' : archiwizuj === false ? 'Konto przywrócone.' : 'Zapisano konto.', 'ok');
  kf = null;
  location.hash = '#konta';
}

// ── kategorie ──

let typKategorii = 'wydatek';

function renderKategorie() {
  const pole = typKategorii === 'wpływ' ? 'zrodlo_przychodu' : 'kategoria';
  const liczby = new Map();
  dane.transakcje.forEach(t => { if (t.status !== 'anulowana' && t[pole]) liczby.set(t[pole], (liczby.get(t[pole]) || 0) + 1); });
  const gl = glowne(typKategorii);
  $('#widok').innerHTML = `
  <section class="ekran kategorie">
    <a class="wstecz" href="#dane">Edytuj dane</a>
    <div class="naglowek-sekcji"><h1>Kategorie</h1>
      <a class="przycisk" href="#kategoria/${typKategorii === 'wpływ' ? 'nowa-wplyw' : 'nowa-wydatek'}">Nowa kategoria</a></div>
    <div class="zakladki-ekranu" role="tablist">${[['wydatek', 'Wydatki'], ['wpływ', 'Wpływy']].map(([t, e]) =>
      `<button type="button" role="tab" data-akcja="typ-kat" data-v="${t}" aria-selected="${typKategorii === t}">${e}</button>`).join('')}</div>
    <div class="karty-kategorii">${gl.map((k, i) => {
      const pod = podrzedne(typKategorii, k.nazwa);
      const n = liczby.get(k.nazwa) || 0;
      return `<article class="karta-kategorii">
        <a href="#kategoria/${encodeURIComponent(k.id)}" class="naglowek-kategorii">
          <span class="ikona" style="--tlo:${esc(kolorKategorii(k.nazwa, typKategorii))}" aria-hidden="true">${esc(ikona(k.nazwa, typKategorii))}</span>
          <span><b>${esc(k.nazwa)}</b><span>${n} ${odmiana(n, 'transakcja', 'transakcje', 'transakcji')}</span></span>
        </a>
        <div class="kolejnosc">
          <button type="button" class="usun" data-akcja="w-gore" data-v="${esc(k.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Przesuń wyżej">↑</button>
          <button type="button" class="usun" data-akcja="w-dol" data-v="${esc(k.id)}" ${i === gl.length - 1 ? 'disabled' : ''} aria-label="Przesuń niżej">↓</button>
        </div>
        ${pod.length ? `<div class="chipy male">${pod.map(p => `<span class="etykieta-kategorii" style="--tlo:${esc(kolorKategorii(k.nazwa, typKategorii))}">${esc(p.nazwa)}</span>`).join('')}</div>` : ''}
      </article>`;
    }).join('')}</div>
  </section>`;
}

async function przesun(id, kierunek) {
  const gl = glowne(typKategorii);
  const i = gl.findIndex(k => k.id === id);
  const j = i + kierunek;
  if (i < 0 || j < 0 || j >= gl.length) return;
  const nowa = [...gl];
  [nowa[i], nowa[j]] = [nowa[j], nowa[i]];
  const zmiany = nowa.map((k, n) => ({ ...k, kolejnosc: n + 1 })).filter((k, n) => Number(gl.find(x => x.id === k.id).kolejnosc) !== n + 1);
  await sync.zapisz('SLOWNIK', zmiany);
  await wczytajDane();
}

let katf = null;

function renderKategoria(id) {
  if (!katf || katf.klucz !== id) {
    const nowa = id === 'nowa-wydatek' || id === 'nowa-wplyw';
    const k = nowa ? null : dane.slownik.find(x => x.id === id && (x.lista === 'kategorie_kosztow' || x.lista === 'zrodla_przychodu') && !x.rodzic);
    if (!nowa && !k) { location.hash = '#kategorie'; return; }
    const typ = nowa ? (id === 'nowa-wplyw' ? 'wpływ' : 'wydatek') : (k.lista === 'zrodla_przychodu' ? 'wpływ' : 'wydatek');
    const a = atrybuty(k);
    katf = {
      klucz: id, oryginal: k, typ, nazwa: k?.nazwa || '', ikona: a.ikona || (k ? ikona(k.nazwa, typ) : ''),
      kolor: a.kolor || (k ? kolorKategorii(k.nazwa, typ) : KOLORY[glowne(typ).length % KOLORY.length]),
      pod: k ? podrzedne(typ, k.nazwa, true).map(p => ({ id: p.id, nazwa: p.nazwa, staraNazwa: p.nazwa, aktywna: aktywna(p), oryginal: p })) : [],
      nowaPod: '',
    };
  }
  $('#widok').innerHTML = `
  <section class="ekran formularz-kategorii">
    <a class="wstecz" href="#kategorie">Kategorie</a>
    <h1>${katf.oryginal ? 'Edycja kategorii' : 'Nowa kategoria'}</h1>
    <form class="karta-ustawien" data-forma="kategoria" novalidate>
      <div class="naglowek-kategorii duzy">
        <span class="ikona" style="--tlo:${esc(katf.kolor)}" aria-hidden="true">${esc(katf.ikona || '•')}</span>
        <label class="pole"><span class="etykieta">Nazwa (${katf.typ === 'wpływ' ? 'źródło przychodu' : 'wydatek'})</span>
          <input name="nazwa" value="${esc(katf.nazwa)}" autocomplete="off"></label>
      </div>
      <fieldset class="pole"><legend>Ikona</legend>
        <div class="emoji">${EMOJI.map(e => `<button type="button" data-akcja="kat-ikona" data-v="${e}" aria-pressed="${katf.ikona === e}" aria-label="Ikona ${e}">${e}</button>`).join('')}</div>
        <label class="pole male"><span class="etykieta">Albo wpisz własną (emoji)</span><input name="ikona" value="${esc(katf.ikona)}" maxlength="4" autocomplete="off"></label>
      </fieldset>
      <fieldset class="pole"><legend>Kolor</legend><div class="kolory">${KOLORY.map(k =>
        `<button type="button" data-akcja="kat-kolor" data-v="${k}" aria-pressed="${katf.kolor === k}" style="--k:${k}" aria-label="Kolor ${k}"></button>`).join('')}</div></fieldset>
      <fieldset class="pole"><legend>Podkategorie</legend>
        <div class="podkategorie-edycja">${katf.pod.map((p, i) => `
          <div class="czesc ${p.aktywna ? '' : 'zarchiwizowana'}">
            <input name="pod-${i}" value="${esc(p.nazwa)}" aria-label="Podkategoria ${i + 1}" ${p.aktywna ? '' : 'disabled'}>
            <button type="button" class="usun" data-akcja="pod-archiwum" data-v="${i}" aria-label="${p.aktywna ? 'Zarchiwizuj' : 'Przywróć'}">${p.aktywna ? '×' : '↺'}</button>
          </div>`).join('')}
          <div class="czesc"><input name="nowa-pod" value="${esc(katf.nowaPod)}" placeholder="Nowa podkategoria" autocomplete="off">
            <button type="button" class="usun" data-akcja="pod-dodaj" aria-label="Dodaj podkategorię">+</button></div>
        </div>
      </fieldset>
      <div class="przyciski">
        <button type="submit">${katf.oryginal ? 'Zapisz zmiany' : 'Dodaj kategorię'}</button>
        ${katf.oryginal ? `<button type="button" class="drugorzedny" data-akcja="kat-archiwum">Zarchiwizuj kategorię</button>` : ''}
        <a class="przycisk drugorzedny" href="#kategorie">Wróć</a>
      </div>
    </form>
  </section>`;
}

function zbierzKategorie() {
  const form = $('form[data-forma="kategoria"]');
  if (!form) return;
  katf.nazwa = form.elements.nazwa.value;
  katf.ikona = form.elements.ikona.value.trim();
  katf.nowaPod = form.elements['nowa-pod'].value;
  katf.pod.forEach((p, i) => { const el = form.elements['pod-' + i]; if (el) p.nazwa = el.value; });
}

async function zapiszKategorie(archiwizuj = false) {
  zbierzKategorie();
  const nazwa = katf.nazwa.trim();
  if (!nazwa) return toast('Wpisz nazwę kategorii.', 'blad');
  const lista_ = listaKategorii(katf.typ);
  const dubel = glowne(katf.typ).find(k => k.nazwa.toLowerCase() === nazwa.toLowerCase() && k.id !== katf.oryginal?.id);
  if (dubel) return toast('Taka kategoria już istnieje.', 'blad');
  const o = katf.oryginal;
  const id = o?.id || (katf.typ === 'wpływ' ? 'ZP-' : 'KK-') + uuid().slice(0, 8);
  const atr = { ikona: katf.ikona, kolor: katf.kolor };
  const wiersze = [o
    ? wierszSlownika(o, { nazwa, atrybuty: atr, aktywna: archiwizuj ? false : aktywna(o) })
    : { lista: lista_, id, nazwa, rodzic: '', atrybuty: JSON.stringify(atr), aktywna: true, kolejnosc: glowne(katf.typ).length + 1 }];
  if (katf.nowaPod.trim()) katf.pod.push({ id: null, nazwa: katf.nowaPod.trim(), aktywna: true });
  const pole = katf.typ === 'wpływ' ? 'zrodlo_przychodu' : 'kategoria';
  const reguly = [];
  katf.pod.forEach((p, i) => {
    const n = p.nazwa.trim();
    if (!n) return;
    if (!p.oryginal) wiersze.push({ lista: lista_, id: `${id}-${uuid().slice(0, 6)}`, nazwa: n, rodzic: id, atrybuty: '{}', aktywna: true, kolejnosc: i + 1 });
    else if (p.oryginal.nazwa !== n || aktywna(p.oryginal) !== p.aktywna) {
      wiersze.push({ ...p.oryginal, nazwa: n, aktywna: p.aktywna });
      if (p.oryginal.nazwa !== n && o) reguly.push({ pola: ['podkategoria'], stara: p.oryginal.nazwa, nowa: n, warunek: w => w[pole] === o.nazwa });
    }
  });
  if (o && o.nazwa !== nazwa) reguly.push({ pola: [pole], stara: o.nazwa, nowa: nazwa });
  const paczki = reguly.length ? przemianuj(reguly) : [];
  if (o && o.nazwa !== nazwa) {
    const zm = paczki;
    const budzety = dane.budzety.filter(b => kategorieBudzetu(b).includes(o.nazwa))
      .map(b => ({ ...b, kategorie: kategorieBudzetu(b).map(k => (k === o.nazwa ? nazwa : k)).join(', ') }));
    const tyt = dane.slownik.filter(t => t.lista === 'tytuly' && atrybuty(t).kategoria === o.nazwa)
      .map(t => wierszSlownika(t, { atrybuty: { kategoria: nazwa } }));
    const ile = ileWierszy(zm) + budzety.length + tyt.length;
    if (ile) {
      const tak = await okno('Zmienić nazwę kategorii?', `<p>Nazwa zmieni się też w ${ile} zapisanych pozycjach (transakcje, plany, budżety, tytuły).</p>`,
        [{ etykieta: 'Wróć', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Zmień nazwę', wartosc: true, autofocus: true }]);
      if (!tak) return;
    }
    paczki.push({ karta: 'BUDZETY', wiersze: budzety });
    wiersze.push(...tyt);
  }
  await sync.zapiszWiele([{ karta: 'SLOWNIK', wiersze }, ...paczki]);
  await wczytajDane();
  toast(archiwizuj ? 'Kategoria zarchiwizowana. Stare transakcje ją zachowują.' : 'Zapisano kategorię.', 'ok');
  typKategorii = katf.typ;
  katf = null;
  location.hash = '#kategorie';
}

// ── tytuły ──

let tf = { id: null, nazwa: '', typ: 'wydatek', kat: '' };

function opcjeKategorii(typ, wybrana) {
  return glowne(typ).map(k => [`<option value="${esc(k.nazwa + '||')}" ${wybrana === k.nazwa + '||' ? 'selected' : ''}>${esc(k.nazwa)}</option>`,
    ...podrzedne(typ, k.nazwa).map(p => `<option value="${esc(k.nazwa + '||' + p.nazwa)}" ${wybrana === k.nazwa + '||' + p.nazwa ? 'selected' : ''}>${esc(k.nazwa + ' › ' + p.nazwa)}</option>`)].join('')).join('');
}

function renderTytuly() {
  const zapisane = tytuly().sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'));
  const znane = new Set(zapisane.map(t => t.nazwa.toLowerCase()));
  const historia = new Map();
  dane.transakcje.forEach(t => {
    const k = String(t.kontrahent || '').trim();
    if (!k || t.status === 'anulowana' || t.podzial_id || !['wydatek', 'wpływ'].includes(t.typ) || znane.has(k.toLowerCase())) return;
    const kat = t.typ === 'wpływ' ? t.zrodlo_przychodu : t.kategoria;
    if (!kat) return;
    const h = historia.get(k.toLowerCase()) || { nazwa: k, typ: t.typ, kategoria: kat, podkategoria: t.podkategoria || '', n: 0 };
    h.n++;
    historia.set(k.toLowerCase(), h);
  });
  const propozycje = [...historia.values()].filter(h => h.n >= 2).sort((a, b) => b.n - a.n).slice(0, 10);
  $('#widok').innerHTML = `
  <section class="ekran tytuly">
    <a class="wstecz" href="#dane">Edytuj dane</a>
    <h1>Tytuły</h1>
    <p class="wstep">Tytuł skojarzony z kategorią podpowiada ją przy wpisie. Wystarczy, że wpisany tytuł zawiera zapisany tekst, np. „Allegro” pasuje do „Allegro Lokalnie”.</p>
    <form class="karta-ustawien formularz-tytulu" data-forma="tytul" novalidate>
      <div class="rzad trzy">
        <label class="pole"><span class="etykieta">Tytuł</span><input name="t-nazwa" value="${esc(tf.nazwa)}" placeholder="np. InPost" autocomplete="off"></label>
        <fieldset class="pole"><legend>Rodzaj</legend><div class="chipy">${[['wydatek', 'Wydatek'], ['wpływ', 'Wpływ']].map(([t, e]) =>
          `<button type="button" class="chip" data-akcja="t-typ" data-v="${t}" aria-pressed="${tf.typ === t}">${e}</button>`).join('')}</div></fieldset>
        <label class="pole"><span class="etykieta">Kategoria</span><select name="t-kat"><option value="">Wybierz</option>${opcjeKategorii(tf.typ, tf.kat)}</select></label>
      </div>
      <div class="przyciski"><button type="submit">${tf.id ? 'Zapisz tytuł' : 'Dodaj tytuł'}</button>
        ${tf.id ? '<button type="button" class="drugorzedny" data-akcja="t-nowy">Anuluj edycję</button>' : ''}</div>
    </form>
    ${zapisane.length ? `<section class="dzien"><h2>Zapisane (${zapisane.length})</h2><ul>${zapisane.map(t => `
      <li class="wiersz-tytulu"><span class="srodek"><span class="tytul">${esc(t.nazwa)}</span>
        <span class="etykiety"><span class="etykieta-kategorii" style="--tlo:${esc(kolorKategorii(t.kategoria, t.typ || 'wydatek'))}">${esc(t.kategoria || '?')}${t.podkategoria ? ' › ' + esc(t.podkategoria) : ''}</span>
        ${t.typ === 'wpływ' ? '<span class="znacznik">wpływ</span>' : ''}</span></span>
        <button type="button" class="przycisk-maly drugorzedny" data-akcja="t-edytuj" data-v="${esc(t.id)}">Edytuj</button>
        <button type="button" class="usun" data-akcja="t-usun" data-v="${esc(t.id)}" aria-label="Usuń ${esc(t.nazwa)}">×</button></li>`).join('')}</ul></section>` : ''}
    ${propozycje.length ? `<section class="dzien"><h2>Często wpisywane, jeszcze bez zapisanego tytułu</h2><ul>${propozycje.map((h, i) => `
      <li class="wiersz-tytulu"><span class="srodek"><span class="tytul">${esc(h.nazwa)}</span>
        <span class="etykiety"><span class="etykieta-kategorii" style="--tlo:${esc(kolorKategorii(h.kategoria, h.typ))}">${esc(h.kategoria)}${h.podkategoria ? ' › ' + esc(h.podkategoria) : ''}</span>
        <span class="znacznik">${h.n} razy</span></span></span>
        <button type="button" class="przycisk-maly" data-akcja="t-zapisz-propozycje" data-v="${i}">Zapisz</button></li>`).join('')}</ul></section>` : ''}
  </section>`;
  renderTytuly.propozycje = propozycje;
}

async function zapiszTytul(t) {
  const istniejacy = t.id ? dane.slownik.find(x => x.lista === 'tytuly' && x.id === t.id) : null;
  const w = istniejacy
    ? wierszSlownika(istniejacy, { nazwa: t.nazwa, atrybuty: { typ: t.typ, kategoria: t.kategoria, podkategoria: t.podkategoria } })
    : { lista: 'tytuly', id: 'TYT-' + uuid().slice(0, 8), nazwa: t.nazwa, rodzic: '', aktywna: true, kolejnosc: '',
      atrybuty: JSON.stringify({ typ: t.typ, kategoria: t.kategoria, podkategoria: t.podkategoria }) };
  await sync.zapisz('SLOWNIK', [w]);
  await wczytajDane();
}

// ── zdarzenia ──

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  const tr = location.hash.slice(1).split('/')[0];
  if (akcja === 'typ-kat') { typKategorii = v; bezSkoku(renderKategorie); return; }
  if (akcja === 'w-gore' || akcja === 'w-dol') { await przesun(v, akcja === 'w-gore' ? -1 : 1); bezSkoku(renderKategorie); return; }
  if (tr === 'konto' && kf) {
    const form = $('form[data-forma="konto"]');
    ['nazwa', 'saldo', 'data_salda', 'identyfikator'].forEach(n => { kf[n] = form.elements[n].value; });
    if (akcja === 'k-waluta') kf.waluta = v;
    else if (akcja === 'k-typ') kf.typ = v;
    else if (akcja === 'k-kolor') kf.kolor = v;
    else if (akcja === 'k-podmiot') kf.podmiot = v;
    else if (akcja === 'k-archiwum') { await zapiszKonto(kf.aktywne); return; }
    else return;
    bezSkoku(() => renderKonto(kf.klucz));
    return;
  }
  if (tr === 'kategoria' && katf) {
    zbierzKategorie();
    if (akcja === 'kat-ikona') katf.ikona = v;
    else if (akcja === 'kat-kolor') katf.kolor = v;
    else if (akcja === 'pod-archiwum') katf.pod[Number(v)].aktywna = !katf.pod[Number(v)].aktywna;
    else if (akcja === 'pod-dodaj') { if (katf.nowaPod.trim()) { katf.pod.push({ id: null, nazwa: katf.nowaPod.trim(), aktywna: true }); katf.nowaPod = ''; } }
    else if (akcja === 'kat-archiwum') {
      const tak = await okno('Zarchiwizować kategorię?', '<p>Zniknie z wyboru przy nowych wpisach. Zapisane transakcje ją zachowują.</p>',
        [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Zarchiwizuj', wartosc: true }]);
      if (tak) await zapiszKategorie(true);
      return;
    } else return;
    bezSkoku(() => renderKategoria(katf.klucz));
    return;
  }
  if (tr === 'tytuly') {
    const form = $('form[data-forma="tytul"]');
    if (form) { tf.nazwa = form.elements['t-nazwa'].value; tf.kat = form.elements['t-kat'].value; }
    if (akcja === 't-typ') { tf.typ = v; tf.kat = ''; }
    else if (akcja === 't-nowy') tf = { id: null, nazwa: '', typ: 'wydatek', kat: '' };
    else if (akcja === 't-edytuj') {
      const t = tytuly().find(x => x.id === v);
      if (t) tf = { id: t.id, nazwa: t.nazwa, typ: t.typ || 'wydatek', kat: `${t.kategoria || ''}||${t.podkategoria || ''}` };
      window.scrollTo(0, 0);
    } else if (akcja === 't-usun') {
      const t = dane.slownik.find(x => x.lista === 'tytuly' && x.id === v);
      if (t) { await sync.zapisz('SLOWNIK', [{ ...t, aktywna: false }]); await wczytajDane(); toast('Usunięto tytuł.', 'ok'); }
    } else if (akcja === 't-zapisz-propozycje') {
      const h = renderTytuly.propozycje?.[Number(v)];
      if (h) { await zapiszTytul({ nazwa: h.nazwa, typ: h.typ, kategoria: h.kategoria, podkategoria: h.podkategoria }); toast(`Zapisano tytuł „${h.nazwa}”.`, 'ok'); }
    } else return;
    bezSkoku(renderTytuly);
  }
}

async function submit(form) {
  const forma = form.dataset.forma;
  if (forma === 'konto') await zapiszKonto();
  else if (forma === 'kategoria') await zapiszKategorie();
  else if (forma === 'tytul') {
    tf.nazwa = form.elements['t-nazwa'].value.trim();
    tf.kat = form.elements['t-kat'].value;
    if (!tf.nazwa) return toast('Wpisz tytuł.', 'blad');
    if (!tf.kat) return toast('Wybierz kategorię.', 'blad');
    const [kategoria, podkategoria] = tf.kat.split('||');
    await zapiszTytul({ id: tf.id, nazwa: tf.nazwa, typ: tf.typ, kategoria, podkategoria: podkategoria || '' });
    toast(`Zapisano tytuł „${tf.nazwa}”.`, 'ok');
    tf = { id: null, nazwa: '', typ: tf.typ, kat: '' };
    bezSkoku(renderTytuly);
  }
}

export const ekranDane = { render: renderHub };
export const ekranKonta = { render: renderKonta };
export const ekranKonto = { render: id => renderKonto(id || 'nowe'), klik, submit };
export const ekranKategorie = { render: renderKategorie, klik };
export const ekranKategoria = { render: id => renderKategoria(id || 'nowa-wydatek'), klik, submit };
export const ekranTytuly = { render: renderTytuly, klik, submit };
