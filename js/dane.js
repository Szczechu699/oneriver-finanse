// Dane z urządzenia i wszystko, co z nich wynika: Słownik, grupy transakcji, budżety, terminy planowanych.

import * as db from './db.js';
import * as sync from './sync.js';
import { dataLok, dodajDni, przesunDate, roznicaDni, zaokr } from './util.js';

export const dane = { slownik: [], transakcje: [], planowane: [], budzety: [] };

export async function wczytajDane() {
  [dane.slownik, dane.transakcje, dane.planowane, dane.budzety] = await Promise.all(
    ['SLOWNIK', 'TRANSAKCJE', 'PLANOWANE', 'BUDZETY'].map(k => db.wiersze(k)));
}

// ── Słownik ──
export function atrybuty(w) {
  if (!w || !w.atrybuty) return {};
  if (typeof w.atrybuty === 'object') return w.atrybuty;
  try { return JSON.parse(w.atrybuty) || {}; } catch { return {}; }
}
const kolejnosc = w => (w.kolejnosc === '' || w.kolejnosc == null || isNaN(Number(w.kolejnosc)) ? 999 : Number(w.kolejnosc));
const aktywna = w => !(w.aktywna === false || String(w.aktywna).toUpperCase() === 'FALSE');
export function lista(nazwa) {
  return dane.slownik
    .filter(w => w.lista === nazwa && aktywna(w))
    .sort((a, b) => kolejnosc(a) - kolejnosc(b) || String(a.nazwa).localeCompare(String(b.nazwa), 'pl'));
}
export const konta = () => lista('konta').map(k => ({ ...k, waluta: atrybuty(k).waluta || '' }));
export const walutaKonta = nazwa => konta().find(k => k.nazwa === nazwa)?.waluta || '';
export function waluty() {
  const w = lista('waluty').map(x => x.nazwa);
  return w.length ? w : ['PLN', 'EUR', 'USD'];
}
export const listaKategorii = typ => (typ === 'wpływ' ? 'zrodla_przychodu' : 'kategorie_kosztow');
export const glowne = typ => lista(listaKategorii(typ)).filter(k => !k.rodzic);
export function podrzedne(typ, nazwaRodzica) {
  const l = lista(listaKategorii(typ));
  const rodzic = l.find(k => k.nazwa === nazwaRodzica && !k.rodzic);
  return rodzic ? l.filter(k => k.rodzic === rodzic.id) : [];
}
export function podmioty() {
  const p = lista('podmioty').map(x => x.nazwa);
  return [...(p.length ? p : ['INCO', 'OFI']), 'wspólne'];
}

const IKONY = [
  [/wymian/i, '💱'], [/wysy|paczk|kurier/i, '📦'], [/wypłat|wynagr/i, '👥'], [/czynsz|media/i, '🏠'], [/towar|zakup/i, '🧺'],
  [/opakow|druk|etykiet/i, '🏷️'], [/usług/i, '🛠️'], [/program|abonam/i, '💻'], [/zus|podat/i, '🏛️'],
  [/podróż/i, '✈️'], [/sklep/i, '🛒'], [/stoisk|kiermasz/i, '🎪'], [/ceremon|warsztat/i, '🪶'],
  [/wypraw/i, '🧭'], [/granic/i, '🌍'],
];
export const KOLORY = ['#CDE6DF', '#F3DDA9', '#E8D2E2', '#D2E3F3', '#DDE8C6', '#F1D5CB', '#DBD5EF', '#C8DED3', '#EEE3C1', '#D9DCE0'];
export function ikona(nazwa, typ) {
  const w = lista(listaKategorii(typ)).find(k => k.nazwa === nazwa);
  const a = atrybuty(w);
  if (a.ikona) return a.ikona;
  const m = IKONY.find(([r]) => r.test(nazwa || ''));
  return m ? m[1] : '•';
}
export function kolorKategorii(nazwa, typ) {
  const l = glowne(typ);
  const i = l.findIndex(k => k.nazwa === nazwa);
  return atrybuty(l[i]).kolor || KOLORY[(i < 0 ? 9 : i) % KOLORY.length];
}

// ── transakcje ──
export const WYMIANA = 'Wymiana walut';
export const czyPrzeks = t => String(t.typ || '').startsWith('przeksięgowanie');
export const kierunek = t => (t.typ === 'wpływ' || t.typ === 'przeksięgowanie-wpływ' ? 'wpływ' : 'wypływ');
export function kwotaPLN(t) {
  if (t.waluta === 'PLN' || !t.waluta) return Number(t.kwota) || 0;
  if (t.kwota_pln !== '' && t.kwota_pln != null) return Number(t.kwota_pln);
  return null;
}
export const czekaNaWysylke = t => sync.stanSynchronizacji().oczekujaceKlucze?.has('TRANSAKCJE|' + t.id);

/**
 * Transakcje widziane tak, jak widzi je człowiek i wyciąg bankowy:
 * podział = jedna pozycja (suma części), przeksięgowanie i wymiana = jedna pozycja (strona wypływu).
 */
export function grupy(lista_ = dane.transakcje) {
  const wynik = [];
  const wgPodzialu = new Map();
  const wgPary = new Map();
  for (const t of lista_) {
    if (t.podzial_id) {
      if (!wgPodzialu.has(t.podzial_id)) wgPodzialu.set(t.podzial_id, []);
      wgPodzialu.get(t.podzial_id).push(t);
    } else if (czyPrzeks(t) && t.id_pary) {
      if (!wgPary.has(t.id_pary)) wgPary.set(t.id_pary, []);
      wgPary.get(t.id_pary).push(t);
    } else {
      wynik.push({ rodzaj: 'pojedyncza', glowna: t, czesci: [t], kwota: Number(t.kwota) || 0 });
    }
  }
  for (const czesci of wgPodzialu.values()) {
    const aktywne = czesci.filter(c => c.status !== 'anulowana');
    const pokaz = aktywne.length ? aktywne : czesci;
    pokaz.sort((a, b) => (Number(b.kwota) || 0) - (Number(a.kwota) || 0));
    wynik.push({ rodzaj: 'podzial', glowna: pokaz[0], czesci: pokaz, wszystkie: czesci, kwota: zaokr(pokaz.reduce((s, c) => s + (Number(c.kwota) || 0), 0)) });
  }
  for (const nogi of wgPary.values()) {
    const z = nogi.find(n => n.typ === 'przeksięgowanie-wypływ') || nogi[0];
    const na = nogi.find(n => n.typ === 'przeksięgowanie-wpływ');
    wynik.push({ rodzaj: z.kategoria === WYMIANA ? 'wymiana' : 'przeksiegowanie', glowna: z, czesci: nogi, z, na, kwota: Number(z.kwota) || 0 });
  }
  return wynik;
}

export function grupaDla(id) {
  const t = dane.transakcje.find(x => x.id === id);
  if (!t) return null;
  const pasujace = t.podzial_id
    ? dane.transakcje.filter(x => x.podzial_id === t.podzial_id)
    : (czyPrzeks(t) && t.id_pary ? dane.transakcje.filter(x => x.id_pary === t.id_pary) : [t]);
  return grupy(pasujace)[0] || null;
}

// ── załączniki ──
export function zalaczniki(tekst) {
  return String(tekst || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.lastIndexOf(' | ');
    const nazwa = i >= 0 ? l.slice(0, i) : 'Załącznik';
    const cel = i >= 0 ? l.slice(i + 3) : l;
    const oczekuje = cel.startsWith('oczekuje:');
    return { nazwa, url: oczekuje ? '' : cel, plik_id: oczekuje ? cel.slice(9) : '', linia: l };
  });
}

// ── planowane ──
export const RYTMY = { 'dzień': ['dzień', 'dni', 'dni'], 'tydzień': ['tydzień', 'tygodnie', 'tygodni'], 'miesiąc': ['miesiąc', 'miesiące', 'miesięcy'], 'rok': ['rok', 'lata', 'lat'] };
export function opisRytmu(p) {
  if (p.rodzaj === 'jednorazowa') return 'jednorazowo';
  const n = Number(p.co_ile) || 1;
  const formy = RYTMY[p.powtarzanie] || RYTMY['miesiąc'];
  if (n === 1) return { 'dzień': 'codziennie', 'tydzień': 'co tydzień', 'miesiąc': 'co miesiąc', 'rok': 'co rok' }[p.powtarzanie] || 'co miesiąc';
  const d = n % 10, s = n % 100;
  return `co ${n} ${d >= 2 && d <= 4 && (s < 12 || s > 14) ? formy[1] : formy[2]}`;
}
export const aktywnePlanowane = () => dane.planowane.filter(p => p.status === 'aktywna');
export function nastepnyTermin(p) {
  if (p.rodzaj === 'jednorazowa') return null;
  const nowa = przesunDate(p.nastepna_data, p.powtarzanie || 'miesiąc', Number(p.co_ile) || 1, p.data_start || p.nastepna_data);
  if (p.data_koniec && nowa > p.data_koniec) return null;
  return nowa;
}
export function miesiecznyKoszt(p) {
  const n = Number(p.co_ile) || 1;
  const k = Number(p.kwota) || 0;
  return { 'dzień': k * 30.44 / n, 'tydzień': k * 4.345 / n, 'miesiąc': k / n, 'rok': k / 12 / n }[p.powtarzanie || 'miesiąc'] ?? k;
}
export const poTerminie = () => aktywnePlanowane().filter(p => p.nastepna_data && p.nastepna_data < dataLok());

// ── budżety ──
export const aktywneBudzety = () => dane.budzety.filter(b => b.status !== 'anulowany' && b.status !== 'zakończony');

/** Zakres dat bieżącego okresu budżetu [od, do] (włącznie). */
export function okresBudzetu(b, dzien = dataLok()) {
  if (b.rodzaj === 'projekt') return [b.data_od || '0000-01-01', b.data_do || '9999-12-31'];
  if (b.okres === 'tydzień') {
    const d = new Date(dzien + 'T12:00:00');
    const pon = dodajDni(dzien, -((d.getDay() + 6) % 7));
    return [pon, dodajDni(pon, 6)];
  }
  if (b.okres === 'rok') return [dzien.slice(0, 4) + '-01-01', dzien.slice(0, 4) + '-12-31'];
  const od = dzien.slice(0, 7) + '-01';
  return [od, dodajDni(przesunDate(od, 'miesiąc', 1), -1)];
}

export const kategorieBudzetu = b => String(b.kategorie || '').split(',').map(s => s.trim()).filter(Boolean);

export function stanBudzetu(b, dzien = dataLok()) {
  const [od, do_] = okresBudzetu(b, dzien);
  const kat = new Set(kategorieBudzetu(b));
  let wydane = 0, wplywy = 0, bezKursu = 0, liczba = 0;
  for (const t of dane.transakcje) {
    if (t.status === 'anulowana' || czyPrzeks(t)) continue;
    const d = t.data_operacji || '';
    if (b.rodzaj === 'projekt') {
      if (t.budzet !== b.id) continue;
    } else {
      if (t.typ !== 'wydatek' || !kat.has(t.kategoria) || d < od || d > do_) continue;
      if (b.podmiot && t.podmiot !== b.podmiot) continue;
    }
    const k = kwotaPLN(t);
    if (k === null) { bezKursu++; continue; }
    liczba++;
    if (t.typ === 'wpływ') wplywy += k; else wydane += k;
  }
  const kwota = Number(b.kwota) || 0;
  const zostalo = kwota - wydane;
  const koniec = do_ < '9999' ? do_ : null;
  const dniDoKonca = koniec && koniec >= dzien ? roznicaDni(koniec, dzien) + 1 : null;
  return {
    od, do: do_, wydane: zaokr(wydane), wplywy: zaokr(wplywy), kwota, zostalo: zaokr(zostalo),
    procent: kwota > 0 ? wydane / kwota : 0, bezKursu, liczba,
    naDzien: dniDoKonca && zostalo > 0 ? zaokr(zostalo / dniDoKonca) : null, dniDoKonca,
  };
}

/** Budżety projektów, które można wybrać przy wpisie z tą datą. */
export const budzetyDoWyboru = data => aktywneBudzety().filter(b => b.rodzaj === 'projekt'
  && (!b.data_od || data >= b.data_od) && (!b.data_do || data <= dodajDni(b.data_do, 30)));
