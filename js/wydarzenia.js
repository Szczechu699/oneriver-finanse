// Ekran „Wydarzenie” (#wydarzenie/<id>): budżet wydarzenia jak tabelka prezesa – koszty i przychody z kwotą planowaną,
// kwota faktyczna liczy się sama z transakcji przypisanych do wydarzenia i pozycji (TRANSAKCJE.budzet + pozycja_budzetu),
// sprzedaż ze Stoiska z tym wydarzeniem, kasa wydarzenia i próg opłacalności (ile biletów trzeba sprzedać).
// Wydarzenie = wiersz BUDZETY z rodzaj „wydarzenie”; pozycje – karta BUDZET_POZYCJE.
// Lista wydarzeń dla Stoiska: wiersze USTAWIENIA z id „wydarzenie:<id>” (opis = nazwa, tresc = JSON z datami i statusem).

import * as sync from './sync.js';
import { $, $$, esc, zaokr, kwotaTxt, dataLok, dataKrotko, dodajDni, uuid, liczba, liczbaNaTekst, odmiana, toast, okno, bezSkoku } from './util.js';
import { dane, wczytajDane, kwotaPLN, czyPrzeks, czyPrywatna } from './dane.js';
import { kasaWydarzenia } from './kasa.js';

export const KATEGORIE_KOSZTOW_WYD = ['Lokal', 'Artyści', 'Technika', 'Promocja i marketing', 'Transport', 'Catering', 'Honoraria zespołu', 'Inne'];
export const KATEGORIE_PRZYCHODOW_WYD = ['Bilety', 'Sponsorzy', 'Inne'];

const num = v => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const tak = p => norm(p.decyzja) !== 'nie';

export const pozycjeWydarzenia = (id, typ) => dane.pozycjeBudzetu
  .filter(p => p.budzet === id && p.status !== 'usunięta' && (!typ || p.typ === typ))
  .sort((a, b) => num(a.kolejnosc) - num(b.kolejnosc) || String(a.utworzono).localeCompare(String(b.utworzono)));

/** Zamówienia Stoiska z tego wydarzenia (po id albo po nazwie wpisanej w Stoisku). */
export const zamowieniaWydarzenia = b => dane.zamowienia.filter(z => z.status !== 'anulowane'
  && (z.wydarzenie_id ? z.wydarzenie_id === b.id : norm(z.wydarzenie) && norm(z.wydarzenie) === norm(b.nazwa)));

// ───────────────────────── obliczenia ─────────────────────────

export function stanWydarzenia(b) {
  const tr = dane.transakcje.filter(t => t.budzet === b.id && t.status !== 'anulowana' && !czyPrzeks(t) && !czyPrywatna(t));
  const znak = t => (t.typ === 'wpływ' || t.typ === 'spłata-otrzymana' ? 1 : -1);   // + przychód, − koszt
  const poz = pozycjeWydarzenia(b.id);
  const idPoz = new Set(poz.map(p => p.id));
  const fakt = new Map();
  let bezKursu = 0;
  const bez = { koszt: [], przychód: [] };
  for (const t of tr) {
    const k = kwotaPLN(t);
    if (k === null) { bezKursu++; continue; }
    const p = idPoz.has(t.pozycja_budzetu) ? poz.find(x => x.id === t.pozycja_budzetu) : null;
    const typ = p ? p.typ : (znak(t) > 0 ? 'przychód' : 'koszt');
    // dla kosztu: wydatek +, zwrot (wpływ) −; dla przychodu: wpływ +, wydatek −
    const wartosc = typ === 'koszt' ? -znak(t) * k : znak(t) * k;
    if (p) fakt.set(p.id, zaokr((fakt.get(p.id) || 0) + wartosc));
    else bez[typ].push({ t, kwota: wartosc });
  }
  const wiersz = p => {
    const plan = num(p.kwota_planowana), f = fakt.get(p.id) || 0;
    let status = '';
    if (p.typ === 'koszt') {
      status = !tak(p) ? 'rezygnacja' : f > 0 && f >= plan - 0.5 ? 'zapłacone' : f > 0 ? 'częściowo' : plan > 0 ? 'do zapłaty' : '';
    } else status = f > 0 && f >= plan - 0.5 ? 'wpłynęło' : f > 0 ? 'częściowo' : plan > 0 ? 'oczekiwane' : '';
    return { p, plan, fakt: f, roznica: zaokr(plan - f), status };
  };
  const koszty = poz.filter(p => p.typ === 'koszt').map(wiersz);
  const przychody = poz.filter(p => p.typ === 'przychód').map(wiersz);
  const suma = (l, f) => zaokr(l.reduce((s, x) => s + f(x), 0));
  const bezKoszty = suma(bez.koszt, x => x.kwota), bezPrzych = suma(bez.przychód, x => x.kwota);

  const zam = zamowieniaWydarzenia(b);
  const stoisko = {
    liczba: zam.length, suma: suma(zam, z => num(z.suma_brutto)), gotowka: suma(zam, z => num(z.kw_gotowka)),
  };
  stoisko.bezgotowka = zaokr(stoisko.suma - stoisko.gotowka);

  const aktywneKoszty = koszty.filter(x => tak(x.p));
  const planKoszty = suma(aktywneKoszty, x => x.plan);
  const faktKoszty = zaokr(suma(koszty, x => x.fakt) + bezKoszty);
  // planowane, a gdy zapłacono już więcej – faktyczne (zaliczka nie zaniża kosztów); wydatki bez pozycji doliczone
  const doPokrycia = zaokr(suma(aktywneKoszty, x => Math.max(x.plan, x.fakt)) + bezKoszty);
  const planPrzych = suma(przychody, x => x.plan);
  const faktPrzych = zaokr(suma(przychody, x => x.fakt) + bezPrzych + stoisko.suma);
  const faktBilety = suma(przychody.filter(x => norm(x.p.kategoria) === 'bilety'), x => x.fakt);

  const cena = num(b.cena_biletu), dni = Math.max(1, Math.round(num(b.dni)) || 1), pojemnosc = num(b.pojemnosc), prow = num(b.prowizja_proc);
  const cenaNetto = cena * (1 - prow / 100);
  const bilety = cenaNetto > 0 ? Math.ceil(doPokrycia / cenaNetto - 1e-9) : null;
  const inne = zaokr(faktPrzych - faktBilety);                     // przychody poza biletami (stoisko, sponsorzy…)
  const biletyPoInnych = cenaNetto > 0 ? Math.max(0, Math.ceil((doPokrycia - inne) / cenaNetto - 1e-9)) : null;
  const naDzien = bilety !== null ? Math.ceil(bilety / dni) : null;
  const sprzedane = cenaNetto > 0 ? Math.floor(faktBilety / cenaNetto + 1e-9) : null;   // przybliżenie z wpływów za bilety
  const brakuje = biletyPoInnych !== null && sprzedane !== null ? Math.max(0, biletyPoInnych - sprzedane) : null;
  return {
    koszty, przychody, bez, bezKoszty, bezPrzych, stoisko, bezKursu,
    planKoszty, faktKoszty, doPokrycia, planPrzych, faktPrzych, faktBilety, inne,
    wynik: zaokr(faktPrzych - faktKoszty),
    prog: { cena, cenaNetto: zaokr(cenaNetto), dni, pojemnosc, prow, bilety, naDzien, biletyPoInnych, sprzedane, brakuje,
      miesci: naDzien !== null && pojemnosc > 0 ? naDzien <= pojemnosc : null },
  };
}

// ───────────────────────── zapis ─────────────────────────

async function zapiszPozycje(wiersze) {
  await sync.zapisz('BUDZET_POZYCJE', wiersze);
  await wczytajDane();
}

/** Lista wydarzeń dla Stoiska (karta USTAWIENIA). Wywoływana po każdej zmianie wydarzenia. */
export async function opublikujWydarzenie(b) {
  await sync.zapisz('USTAWIENIA', [{
    id: 'wydarzenie:' + b.id, opis: b.nazwa,
    tresc: JSON.stringify({ od: b.data_od || '', do: b.data_do || '', miejsce: b.miejsce || '', podmiot: b.podmiot || '', status: b.status || 'aktywny' }),
  }]);
}

/** Domyślne pozycje nowego wydarzenia (jak w tabelce prezesa). */
export function pozycjeStartowe(budzetId) {
  const l = [['koszt', 'Lokal', ''], ['koszt', 'Artyści', ''], ['koszt', 'Technika', 'Nagłośnienie'], ['koszt', 'Technika', 'Światło'],
    ['koszt', 'Promocja i marketing', 'Materiały promocyjne'], ['koszt', 'Transport', ''], ['koszt', 'Catering', 'Catering dla artystów i zespołu'],
    ['przychód', 'Bilety', 'Platforma biletowa']];
  return l.map(([typ, kategoria, pozycja], i) => ({
    id: uuid(), budzet: budzetId, typ, kategoria, pozycja, odpowiedzialny: '', kwota_planowana: '', decyzja: 'tak', uwagi: '', kolejnosc: i + 1, status: 'aktywna',
  }));
}

// ───────────────────────── widok ─────────────────────────

const STATUSY = {
  'zapłacone': 'potw', 'wpłynęło': 'potw', 'częściowo': 'czeka', 'do zapłaty': '', 'oczekiwane': '', 'rezygnacja': 'anul',
};
const zl = v => kwotaTxt(v);
const pustaKw = v => (v ? zl(v) : '—');

function wierszKosztu(b, x) {
  const { p } = x;
  const nie = !tak(p);
  return `<tr class="${nie ? 'rezygnacja' : ''}" data-p="${esc(p.id)}">
    <td data-l="Kategoria"><input name="kategoria" value="${esc(p.kategoria)}" list="kat-koszt" aria-label="Kategoria"></td>
    <td data-l="Pozycja"><input name="pozycja" value="${esc(p.pozycja)}" aria-label="Pozycja"></td>
    <td data-l="Odpowiedzialny"><input name="odpowiedzialny" value="${esc(p.odpowiedzialny)}" list="osoby-wyd" aria-label="Odpowiedzialny"></td>
    <td data-l="Planowana" class="liczba"><input name="kwota_planowana" inputmode="decimal" value="${esc(liczbaNaTekst(p.kwota_planowana))}" aria-label="Kwota planowana"></td>
    <td data-l="Faktyczna" class="liczba"><button type="button" class="link kwota-fakt" data-akcja="przypisz" data-v="${esc(p.id)}" title="Pokaż i przypisz wydatki">${esc(pustaKw(x.fakt))}</button></td>
    <td data-l="Różnica" class="liczba ${x.fakt && x.roznica < 0 ? 'minus-wyd' : ''}">${x.fakt ? esc(zl(x.roznica)) : ''}</td>
    <td data-l="Status">${x.status ? `<span class="znacznik ${STATUSY[x.status] || ''}">${esc(x.status)}</span>` : ''}</td>
    <td data-l="Decyzja"><button type="button" class="chip male-chip" data-akcja="decyzja" data-v="${esc(p.id)}" aria-pressed="${!nie}">${nie ? 'Nie' : 'Tak'}</button></td>
    <td class="akcje-wyd"><a class="przycisk-maly drugorzedny" href="#dodaj/wyd~${encodeURIComponent(b.id)}~${encodeURIComponent(p.id)}" title="Dodaj wydatek do tej pozycji">+ wydatek</a>
      <button type="button" class="ikona-usun" data-akcja="usun-poz" data-v="${esc(p.id)}" aria-label="Usuń pozycję" title="Usuń pozycję">×</button></td>
  </tr>`;
}

function wierszPrzychodu(b, x) {
  const { p } = x;
  return `<tr data-p="${esc(p.id)}">
    <td data-l="Źródło"><input name="kategoria" value="${esc(p.kategoria)}" list="kat-przych" aria-label="Źródło"></td>
    <td data-l="Opis"><input name="pozycja" value="${esc(p.pozycja)}" aria-label="Opis"></td>
    <td data-l="Planowana" class="liczba"><input name="kwota_planowana" inputmode="decimal" value="${esc(liczbaNaTekst(p.kwota_planowana))}" aria-label="Kwota planowana"></td>
    <td data-l="Faktyczna" class="liczba"><button type="button" class="link kwota-fakt" data-akcja="przypisz" data-v="${esc(p.id)}" title="Pokaż i przypisz wpływy">${esc(pustaKw(x.fakt))}</button></td>
    <td data-l="Status">${x.status ? `<span class="znacznik ${STATUSY[x.status] || ''}">${esc(x.status)}</span>` : ''}</td>
    <td class="akcje-wyd"><a class="przycisk-maly drugorzedny" href="#dodaj/wyd~${encodeURIComponent(b.id)}~${encodeURIComponent(p.id)}" title="Dodaj wpływ do tej pozycji">+ wpływ</a>
      <button type="button" class="ikona-usun" data-akcja="usun-poz" data-v="${esc(p.id)}" aria-label="Usuń pozycję" title="Usuń pozycję">×</button></td>
  </tr>`;
}

function render(id) {
  const b = dane.budzety.find(x => x.id === id && x.rodzaj === 'wydarzenie');
  if (!b) { $('#widok').innerHTML = '<section class="ekran"><p class="pusto">Nie ma takiego wydarzenia na tym urządzeniu.</p><a href="#budzety">Budżety</a></section>'; return; }
  const s = stanWydarzenia(b);
  const kasa = kasaWydarzenia(b.nazwa);
  const osoby = [...new Set(dane.pozycjeBudzetu.map(p => String(p.odpowiedzialny || '').trim()).filter(Boolean))];
  const katK = [...new Set([...KATEGORIE_KOSZTOW_WYD, ...dane.pozycjeBudzetu.filter(p => p.typ === 'koszt').map(p => p.kategoria).filter(Boolean)])];
  const katP = [...new Set([...KATEGORIE_PRZYCHODOW_WYD, ...dane.pozycjeBudzetu.filter(p => p.typ === 'przychód').map(p => p.kategoria).filter(Boolean)])];
  const daty = b.data_od || b.data_do ? `${b.data_od ? dataKrotko(b.data_od) : '…'}${b.data_do && b.data_do !== b.data_od ? ' – ' + dataKrotko(b.data_do) : ''}` : 'bez daty';
  const p = s.prog;
  const pole = (n, e, v, pod = '') => `<label class="pole"><span class="etykieta">${e}</span><input name="${n}" inputmode="decimal" value="${esc(liczbaNaTekst(v))}" data-wyd="1" autocomplete="off">${pod ? `<span class="podpowiedz">${pod}</span>` : ''}</label>`;
  $('#widok').innerHTML = `
  <section class="ekran wydarzenie-ekran">
    <a class="wstecz" href="#budzety">Budżety i cele</a>
    <div class="naglowek-sekcji"><h1>${esc(b.nazwa)}</h1>
      <a class="przycisk-maly drugorzedny akcja-naglowka" href="#budzet/${encodeURIComponent(b.id)}">Edytuj dane wydarzenia</a></div>
    <p class="uwagi-podsumowania">${esc([daty, b.miejsce, b.podmiot].filter(Boolean).join(' · '))}${b.status === 'zakończony' ? ' · <b>zakończone</b>' : ''}</p>

    <div class="kafle-wskaznikow">
      <div class="wskaznik"><span class="etykieta-wsk">Koszty</span><b>${esc(zl(s.faktKoszty))}</b><span class="zmiana">plan ${esc(zl(s.planKoszty))}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Przychody</span><b>${esc(zl(s.faktPrzych))}</b><span class="zmiana">${s.stoisko.suma ? `w tym stoisko ${esc(zl(s.stoisko.suma))}` : `plan ${esc(zl(s.planPrzych))}`}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Wynik</span><b class="${s.wynik >= 0 ? 'plus' : 'minus'}">${esc(zl(s.wynik))}</b><span class="zmiana">przychody − koszty (faktyczne)</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Biletów do progu</span><b>${p.bilety === null ? '—' : p.bilety}</b><span class="zmiana">${p.bilety === null ? 'wpisz cenę biletu' : `${p.naDzien} na dzień${p.miesci === null ? '' : p.miesci ? ' · mieści się' : ' · <b>nie mieści się</b>'}`}</span></div>
    </div>

    <h2 class="podtytul-sekcji">Koszty</h2>
    <div class="tabela-wyd-kont"><table class="tabela-wyd">
      <thead><tr><th>Kategoria</th><th>Pozycja</th><th>Odpowiedzialny</th><th class="liczba">Planowana</th><th class="liczba">Faktyczna</th><th class="liczba">Różnica</th><th>Status</th><th>Decyzja</th><th></th></tr></thead>
      <tbody data-typ="koszt">${s.koszty.map(x => wierszKosztu(b, x)).join('')}
      ${s.bez.koszt.length ? `<tr class="bez-pozycji"><td data-l="Kategoria">—</td><td data-l="Pozycja" colspan="3">Wydatki bez pozycji (${s.bez.koszt.length})</td>
        <td data-l="Faktyczna" class="liczba"><button type="button" class="link kwota-fakt" data-akcja="bez-pozycji" data-v="koszt">${esc(zl(s.bezKoszty))}</button></td><td colspan="4" class="podpowiedz">otwórz i wskaż pozycję</td></tr>` : ''}</tbody>
      <tfoot><tr><td colspan="3"><b>RAZEM</b> <span class="podpowiedz">(planowane bez pozycji z decyzją „Nie”)</span></td><td class="liczba"><b>${esc(zl(s.planKoszty))}</b></td><td class="liczba"><b>${esc(zl(s.faktKoszty))}</b></td><td class="liczba">${esc(zl(zaokr(s.planKoszty - s.faktKoszty)))}</td><td colspan="3"></td></tr></tfoot>
    </table></div>
    <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="nowa-poz" data-v="koszt">+ Dodaj koszt</button>
      <button type="button" class="drugorzedny" data-akcja="przypisz-wiele" data-v="koszt">Przypisz wydatki z konta…</button></div>

    <h2 class="podtytul-sekcji">Przychody</h2>
    <div class="tabela-wyd-kont"><table class="tabela-wyd przychody">
      <thead><tr><th>Źródło</th><th>Opis</th><th class="liczba">Planowana</th><th class="liczba">Faktyczna</th><th>Status</th><th></th></tr></thead>
      <tbody data-typ="przychód">${s.przychody.map(x => wierszPrzychodu(b, x)).join('')}
      <tr class="auto-wiersz"><td data-l="Źródło">Stoisko</td><td data-l="Opis">Sprzedaż na stoisku (${s.stoisko.liczba} ${odmiana(s.stoisko.liczba, 'zamówienie', 'zamówienia', 'zamówień')})<br><span class="podpowiedz">gotówka ${esc(zl(s.stoisko.gotowka))} · bezgotówkowo ${esc(zl(s.stoisko.bezgotowka))}</span></td>
        <td data-l="Planowana" class="liczba">—</td><td data-l="Faktyczna" class="liczba"><b>${esc(zl(s.stoisko.suma))}</b></td>
        <td data-l="Kasa" colspan="2">${kasa.pozycji ? `<a class="znacznik czeka" href="#kasa/${encodeURIComponent(kasa.id)}">gotówka do rozliczenia ${esc(zl(kasa.nierozliczona))}</a>` : kasa.liczen ? '<span class="znacznik potw">kasa rozliczona</span>' : s.stoisko.gotowka ? '' : '<span class="podpowiedz">bez gotówki</span>'}</td></tr>
      ${s.bez.przychód.length ? `<tr class="bez-pozycji"><td data-l="Źródło">—</td><td data-l="Opis">Wpływy bez pozycji (${s.bez.przychód.length})</td><td></td>
        <td data-l="Faktyczna" class="liczba"><button type="button" class="link kwota-fakt" data-akcja="bez-pozycji" data-v="przychód">${esc(zl(s.bezPrzych))}</button></td><td colspan="2" class="podpowiedz">otwórz i wskaż pozycję</td></tr>` : ''}</tbody>
      <tfoot><tr><td colspan="2"><b>RAZEM</b></td><td class="liczba"><b>${esc(zl(s.planPrzych))}</b></td><td class="liczba"><b>${esc(zl(s.faktPrzych))}</b></td><td colspan="2"></td></tr></tfoot>
    </table></div>
    <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="nowa-poz" data-v="przychód">+ Dodaj przychód</button>
      <button type="button" class="drugorzedny" data-akcja="przypisz-wiele" data-v="przychód">Przypisz wpływy z konta…</button></div>
    <p class="podpowiedz">Wypłata z platformy biletowej: gdy przyjdzie na konto (import wyciągu), kliknij „Przypisz wpływy z konta…” albo kwotę w wierszu „Bilety”.</p>

    <h2 class="podtytul-sekcji">Próg opłacalności</h2>
    <div class="karta-ustawien prog-wyd">
      <div class="rzad cztery">
        ${pole('cena_biletu', 'Cena biletu (1 dzień, zł)', b.cena_biletu)}
        ${pole('dni', 'Liczba dni', b.dni)}
        ${pole('pojemnosc', 'Pojemność sali (osób/dzień)', b.pojemnosc)}
        ${pole('prowizja_proc', 'Prowizja platformy (%)', b.prowizja_proc, 'opcjonalnie')}
      </div>
      <dl class="info">
        <div><dt>Koszty do pokrycia</dt><dd><b>${esc(zl(s.doPokrycia))}</b> <small>planowane (bez „Nie”), a gdy zapłacono więcej – faktyczne</small></dd></div>
        ${p.prow ? `<div><dt>Z biletu zostaje</dt><dd>${esc(zl(p.cenaNetto))}</dd></div>` : ''}
        <div><dt>Biletów do sprzedania łącznie</dt><dd><b>${p.bilety ?? '—'}</b></dd></div>
        <div><dt>Średnio biletów na dzień</dt><dd>${p.naDzien ?? '—'}</dd></div>
        <div><dt>Czy mieści się na sali?</dt><dd><b class="${p.miesci === false ? 'minus-wyd' : ''}">${p.miesci === null ? '—' : p.miesci ? 'TAK' : 'NIE'}</b></dd></div>
        ${s.inne > 0 && p.biletyPoInnych !== null ? `<div><dt>Po odjęciu innych przychodów (${esc(zl(s.inne))})</dt><dd><b>${p.biletyPoInnych}</b> ${odmiana(p.biletyPoInnych, 'bilet', 'bilety', 'biletów')}</dd></div>` : ''}
        ${s.faktBilety > 0 && p.sprzedane !== null ? `<div><dt>Wpłynęło za bilety</dt><dd>${esc(zl(s.faktBilety))} ≈ ${p.sprzedane} ${odmiana(p.sprzedane, 'bilet', 'bilety', 'biletów')}</dd></div>
        <div><dt>Do progu brakuje</dt><dd><b class="${p.brakuje ? 'minus-wyd' : 'plus'}">${p.brakuje ? `${p.brakuje} ${odmiana(p.brakuje, 'bilet', 'bilety', 'biletów')}` : 'próg osiągnięty'}</b></dd></div>` : ''}
      </dl>
    </div>
    ${s.bezKursu ? `<p class="podpowiedz">${s.bezKursu} ${odmiana(s.bezKursu, 'transakcja w walucie czeka', 'transakcje w walucie czekają', 'transakcji w walucie czeka')} na kurs NBP – jeszcze niewliczone.</p>` : ''}
    <datalist id="kat-koszt">${katK.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
    <datalist id="kat-przych">${katP.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
    <datalist id="osoby-wyd">${osoby.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
  </section>`;
}

const biezacyId = () => decodeURIComponent((location.hash.split('/')[1] || ''));
const biezacy = () => dane.budzety.find(x => x.id === biezacyId());
const odswiez = () => bezSkoku(() => render(biezacyId()));

/** Okno: transakcje do przypisania (zaznaczone = przypisane do tej pozycji). */
async function oknoPrzypisania(b, typ, pozycjaId = null) {
  const kierunek = t => (typ === 'koszt' ? t.typ === 'wydatek' : t.typ === 'wpływ');
  const od = b.data_od ? dodajDni(b.data_od, -120) : '0000', do_ = b.data_do ? dodajDni(b.data_do, 45) : '9999';
  const pozycje = pozycjeWydarzenia(b.id, typ);
  const lista_ = dane.transakcje.filter(t => t.status !== 'anulowana' && kierunek(t) && !czyPrywatna(t)
    && (t.budzet === b.id || (!t.budzet && !t.cel && t.data_operacji >= od && t.data_operacji <= do_)))
    .filter(t => !pozycjaId || t.budzet !== b.id || !t.pozycja_budzetu || t.pozycja_budzetu === pozycjaId || !pozycje.some(p => p.id === t.pozycja_budzetu))
    .sort((a, c) => String(c.data_operacji).localeCompare(String(a.data_operacji))).slice(0, 150);
  const wybrana = pozycjaId ? pozycje.find(p => p.id === pozycjaId) : null;
  const opcjePoz = sel => `<option value="">— bez pozycji —</option>${pozycje.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc([p.kategoria, p.pozycja].filter(Boolean).join(' · '))}</option>`).join('')}`;
  const html = `<p class="podpowiedz">${wybrana ? `Zaznacz ${typ === 'koszt' ? 'wydatki' : 'wpływy'}, które należą do pozycji „${esc([wybrana.kategoria, wybrana.pozycja].filter(Boolean).join(' · '))}”.` : `Zaznacz ${typ === 'koszt' ? 'wydatki' : 'wpływy'} wydarzenia i wskaż pozycję.`} Lista: przypisane do wydarzenia i nieprzypisane z okolic jego dat.</p>
    <input type="search" class="szukaj-przypisz" placeholder="Szukaj: nazwa, kwota, data" aria-label="Szukaj">
    <ul class="lista-przypisz">${lista_.map(t => {
      const zazn = wybrana ? t.budzet === b.id && t.pozycja_budzetu === wybrana.id : t.budzet === b.id;
      return `<li data-szukaj="${esc(norm([t.kontrahent, t.opis, t.kwota, t.data_operacji, t.konto].join(' ')))}"><label>
        <input type="checkbox" name="tr" value="${esc(t.id)}" ${zazn ? 'checked' : ''}>
        <span class="data-rozl">${esc(dataKrotko(t.data_operacji))}</span>
        <span class="opis-przypisz"><b>${esc(t.kontrahent || t.kategoria || t.zrodlo_przychodu || 'bez nazwy')}</b><small>${esc([t.konto, t.kategoria || t.zrodlo_przychodu, t.opis].filter(Boolean).join(' · '))}</small></span>
        <b class="liczba">${esc(kwotaTxt(num(t.kwota), t.waluta))}</b></label>
        ${wybrana ? '' : `<select name="poz-${esc(t.id)}" aria-label="Pozycja">${opcjePoz(t.budzet === b.id ? t.pozycja_budzetu : '')}</select>`}</li>`;
    }).join('') || '<li class="pusto">Brak transakcji z okresu wydarzenia.</li>'}</ul>`;
  const d = $('#okno');
  const pokaz = okno(wybrana ? 'Przypisz do pozycji' : (typ === 'koszt' ? 'Wydatki wydarzenia' : 'Wpływy wydarzenia'), html,
    [{ etykieta: 'Anuluj', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Zapisz', wartosc: true }]);
  d.classList.add('okno-szerokie');
  d.querySelector('.szukaj-przypisz')?.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  d.querySelector('.szukaj-przypisz')?.addEventListener('input', e => {
    const q = norm(e.target.value);
    d.querySelectorAll('.lista-przypisz li[data-szukaj]').forEach(li => { li.hidden = !!q && !li.dataset.szukaj.includes(q); });
  });
  const ok = await pokaz;
  d.classList.remove('okno-szerokie');
  if (!ok) return;
  const zmiany = [];
  for (const t of lista_) {
    const el = d.querySelector(`input[name="tr"][value="${CSS.escape(t.id)}"]`);
    if (!el) continue;
    const pozSel = wybrana ? wybrana.id : (d.querySelector(`select[name="poz-${CSS.escape(t.id)}"]`)?.value || '');
    let nowy;
    if (el.checked) nowy = { budzet: b.id, pozycja_budzetu: pozSel };
    else if (t.budzet === b.id && (!wybrana || t.pozycja_budzetu === wybrana.id)) nowy = wybrana ? { pozycja_budzetu: '' } : { budzet: '', pozycja_budzetu: '' };
    if (!nowy) continue;
    const w = { ...t, ...nowy };
    if (w.budzet !== t.budzet || (w.pozycja_budzetu || '') !== (t.pozycja_budzetu || '')) zmiany.push(w);
  }
  if (!zmiany.length) return;
  await sync.zapisz('TRANSAKCJE', zmiany);
  await wczytajDane();
  toast(`Zapisano przypisanie: ${zmiany.length} ${odmiana(zmiany.length, 'transakcja', 'transakcje', 'transakcji')}.`, 'ok');
  odswiez();
}

async function klik(e) {
  const el = e.target.closest('[data-akcja]');
  if (!el) return;
  const b = biezacy();
  if (!b) return;
  const { akcja, v } = el.dataset;
  if (akcja === 'decyzja') {
    const p = dane.pozycjeBudzetu.find(x => x.id === v);
    if (p) { await zapiszPozycje([{ ...p, decyzja: tak(p) ? 'nie' : 'tak' }]); odswiez(); }
  } else if (akcja === 'nowa-poz') {
    const ist = pozycjeWydarzenia(b.id);
    const nowa = { id: uuid(), budzet: b.id, typ: v, kategoria: '', pozycja: '', odpowiedzialny: '', kwota_planowana: '', decyzja: 'tak', uwagi: '',
      kolejnosc: ist.reduce((m, p) => Math.max(m, num(p.kolejnosc)), 0) + 1, status: 'aktywna' };
    await zapiszPozycje([nowa]);
    odswiez();
    setTimeout(() => $(`tr[data-p="${CSS.escape(nowa.id)}"] input[name="kategoria"]`)?.focus(), 50);
  } else if (akcja === 'usun-poz') {
    const p = dane.pozycjeBudzetu.find(x => x.id === v);
    if (!p) return;
    const ile = dane.transakcje.filter(t => t.pozycja_budzetu === p.id && t.status !== 'anulowana').length;
    const tak_ = await okno('Usunąć pozycję?', `<p>„${esc([p.kategoria, p.pozycja].filter(Boolean).join(' · ') || 'pusta pozycja')}”${ile ? ` ma przypisane ${ile} ${odmiana(ile, 'transakcję', 'transakcje', 'transakcji')} – zostaną w wydarzeniu jako „bez pozycji”.` : ''}</p>`,
      [{ etykieta: 'Anuluj', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Usuń', wartosc: true }]);
    if (!tak_) return;
    await zapiszPozycje([{ ...p, status: 'usunięta' }]);
    odswiez();
  } else if (akcja === 'przypisz') {
    const p = dane.pozycjeBudzetu.find(x => x.id === v);
    if (p) await oknoPrzypisania(b, p.typ, p.id);
  } else if (akcja === 'przypisz-wiele' || akcja === 'bez-pozycji') {
    await oknoPrzypisania(b, v);
  }
}

async function zmiana(e) {
  const el = e.target;
  const b = biezacy();
  if (!b) return;
  if (el.dataset.wyd) {
    const w = { ...b, [el.name]: el.value.trim() === '' ? '' : zaokr(liczba(el.value)) };
    if (String(w[el.name]) === String(b[el.name] ?? '')) return;
    await sync.zapisz('BUDZETY', [w]);
    await wczytajDane();
    odswiez();
    return;
  }
  const tr = el.closest('tr[data-p]');
  if (!tr || !el.name) return;
  const p = dane.pozycjeBudzetu.find(x => x.id === tr.dataset.p);
  if (!p) return;
  const wartosc = el.name === 'kwota_planowana' ? (el.value.trim() === '' ? '' : zaokr(liczba(el.value))) : el.value.trim();
  if (String(wartosc) === String(p[el.name] ?? '')) return;
  await zapiszPozycje([{ ...p, [el.name]: wartosc }]);
  if (el.name === 'kwota_planowana') odswiez();
}

export const ekran = { render, klik, zmiana };
