// Dane z urządzenia i wszystko, co z nich wynika: Słownik, grupy transakcji, konta, pożyczki, budżety, cele, planowane.

import * as db from './db.js';
import * as sync from './sync.js';
import { dataLok, dodajDni, przesunDate, roznicaDni, zaokr } from './util.js';

export const dane = { slownik: [], transakcje: [], planowane: [], budzety: [], pozyczki: [], sprzedaz: [], sprzedazPoz: [], importy: [] };

export async function wczytajDane() {
  [dane.slownik, dane.transakcje, dane.planowane, dane.budzety, dane.pozyczki, dane.sprzedaz, dane.sprzedazPoz, dane.importy] = await Promise.all(
    ['SLOWNIK', 'TRANSAKCJE', 'PLANOWANE', 'BUDZETY', 'POZYCZKI', 'SPRZEDAZ_SGT', 'SPRZEDAZ_SGT_POZ', 'IMPORTY'].map(k => db.wiersze(k)));
}

// ── Słownik ──
export function atrybuty(w) {
  if (!w || !w.atrybuty) return {};
  if (typeof w.atrybuty === 'object') return w.atrybuty;
  try { return JSON.parse(w.atrybuty) || {}; } catch { return {}; }
}
const kolejnosc = w => (w.kolejnosc === '' || w.kolejnosc == null || isNaN(Number(w.kolejnosc)) ? 999 : Number(w.kolejnosc));
export const aktywna = w => !(w.aktywna === false || String(w.aktywna).toUpperCase() === 'FALSE');
export function lista(nazwa, zArchiwum = false) {
  return dane.slownik
    .filter(w => w.lista === nazwa && (zArchiwum || aktywna(w)))
    .sort((a, b) => kolejnosc(a) - kolejnosc(b) || String(a.nazwa).localeCompare(String(b.nazwa), 'pl'));
}

// Mocniejsze kolory dla kont (paski, etykiety), pastelowe dla kategorii (tła ikon).
export const KOLORY_KONT = ['#E2B93B', '#4C9BD6', '#D9544F', '#6B4F3F', '#3BB3C3', '#A35DC0', '#E57F5A', '#3F4448', '#4E9A62', '#C44F84'];
export const KOLORY = ['#CDE6DF', '#F3DDA9', '#E8D2E2', '#D2E3F3', '#DDE8C6', '#F1D5CB', '#DBD5EF', '#C8DED3', '#EEE3C1', '#D9DCE0',
  '#F6C9C9', '#C9E8F6', '#FBE3B8', '#D7F0D2', '#E5D7F6', '#F7D9EC'];

export const konta = (zArchiwum = false) => lista('konta', zArchiwum).map((k, i) => {
  const a = atrybuty(k);
  return {
    ...k, waluta: a.waluta || '', kolor: a.kolor || KOLORY_KONT[i % KOLORY_KONT.length], typKonta: a.typ || 'bank',
    podmiot: a.podmiot || '', wirtualne: Boolean(a.wirtualne) || a.typ === 'skarbonka',
  };
});
export const czyWirtualne = nazwa => Boolean(konta(true).find(k => k.nazwa === nazwa)?.wirtualne);
export const podmiotKonta = nazwa => konta(true).find(k => k.nazwa === nazwa)?.podmiot || '';
export const SKARBONKA = 'Skarbonka';
export const walutaKonta = nazwa => konta(true).find(k => k.nazwa === nazwa)?.waluta || '';
export const kolorKonta = nazwa => konta(true).find(k => k.nazwa === nazwa)?.kolor || '#8A9592';
export function waluty() {
  const w = lista('waluty').map(x => x.nazwa);
  return w.length ? w : ['PLN', 'EUR', 'USD'];
}
export const listaKategorii = typ => (typ === 'wpływ' ? 'zrodla_przychodu' : 'kategorie_kosztow');
export const glowne = typ => lista(listaKategorii(typ)).filter(k => !k.rodzic);
export function podrzedne(typ, nazwaRodzica, zArchiwum = false) {
  const l = lista(listaKategorii(typ), zArchiwum);
  const rodzic = l.find(k => k.nazwa === nazwaRodzica && !k.rodzic);
  return rodzic ? l.filter(k => k.rodzic === rodzic.id) : [];
}
// Podmioty: INCO (firmowe nieoficjalne), OFI (firmowe oficjalne), Prywatne – zapisywane, ale pomijane w analizach.
export const PRYWATNE = 'Prywatne';
export function podmioty() {
  const p = lista('podmioty').map(x => x.nazwa);
  const l = p.length ? p : ['INCO', 'OFI'];
  return l.includes(PRYWATNE) ? l : [...l, PRYWATNE];
}
export const czyPrywatna = t => t.podmiot === PRYWATNE;
/** Etykieta podmiotu; puste i dawne „wspólne” = nieprzypisane. */
export const kluczPodmiotu = t => (t.podmiot && t.podmiot !== 'wspólne' ? t.podmiot : '');
export const nazwaPodmiotu = p => p || 'Bez podmiotu';

const IKONY = [
  [/wymian/i, '💱'], [/wysy|paczk|kurier/i, '📦'], [/wypłat|wynagr/i, '👥'], [/czynsz|media/i, '🏠'], [/towar|zakup/i, '🧺'],
  [/opakow|druk|etykiet/i, '🏷️'], [/usług/i, '🛠️'], [/program|abonam/i, '💻'], [/zus|podat/i, '🏛️'],
  [/podróż/i, '✈️'], [/sklep/i, '🛒'], [/stoisk|kiermasz/i, '🎪'], [/ceremon|warsztat/i, '🪶'],
  [/wypraw/i, '🧭'], [/granic/i, '🌍'],
];
export function ikona(nazwa, typ) {
  const w = lista(listaKategorii(typ), true).find(k => k.nazwa === nazwa && !k.rodzic);
  const a = atrybuty(w);
  if (a.ikona) return a.ikona;
  const m = IKONY.find(([r]) => r.test(nazwa || ''));
  return m ? m[1] : '•';
}
export function kolorKategorii(nazwa, typ) {
  const l = lista(listaKategorii(typ), true).filter(k => !k.rodzic);
  const i = l.findIndex(k => k.nazwa === nazwa);
  return atrybuty(l[i]).kolor || KOLORY[(i < 0 ? 9 : i) % 10];
}

// ── tytuły: stałe skojarzenia tytułu z kategorią ──
export const tytuly = () => lista('tytuly').map(t => ({ ...t, ...atrybuty(t) }));

/** Podpowiedzi przy wpisywaniu tytułu: najpierw zapisane tytuły, potem historia transakcji. */
export function podpowiedziTytulu(tekst, typ, ile = 5) {
  const q = String(tekst || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const wynik = [];
  const widziane = new Set();
  const dodaj = p => {
    const klucz = p.tytul.toLowerCase() + '|' + p.kategoria;
    if (widziane.has(klucz) || !p.kategoria) return;
    widziane.add(klucz);
    wynik.push(p);
  };
  tytuly().filter(t => (t.typ || 'wydatek') === typ)
    .filter(t => t.nazwa.toLowerCase().includes(q) || q.includes(t.nazwa.toLowerCase()))
    .forEach(t => dodaj({ tytul: t.nazwa, kategoria: t.kategoria || '', podkategoria: t.podkategoria || '', zrodlo: 'tytuł' }));
  const historia = new Map();
  dane.transakcje.forEach(t => {
    const k = String(t.kontrahent || '').trim();
    if (!k || t.typ !== typ || t.status === 'anulowana' || t.podzial_id || !k.toLowerCase().includes(q)) return;
    const kat = typ === 'wpływ' ? t.zrodlo_przychodu : t.kategoria;
    const stary = historia.get(k.toLowerCase());
    if (!stary || String(stary.data) < String(t.data_operacji)) {
      historia.set(k.toLowerCase(), { tytul: k, kategoria: kat || '', podkategoria: t.podkategoria || '', data: t.data_operacji, zrodlo: 'historia' });
    }
  });
  [...historia.values()]
    .sort((a, b) => (a.tytul.toLowerCase().startsWith(q) ? 0 : 1) - (b.tytul.toLowerCase().startsWith(q) ? 0 : 1) || String(b.data).localeCompare(String(a.data)))
    .forEach(dodaj);
  return wynik.slice(0, ile);
}

// ── transakcje ──
export const WYMIANA = 'Wymiana walut';
export const TYPY_POZYCZEK = ['pożyczka-udzielona', 'pożyczka-otrzymana', 'spłata-otrzymana', 'spłata-oddana'];
const WPLYWY = new Set(['wpływ', 'przeksięgowanie-wpływ', 'pożyczka-otrzymana', 'spłata-otrzymana']);
export const czyPrzeks = t => String(t.typ || '').startsWith('przeksięgowanie');
export const czyPozyczkowa = t => TYPY_POZYCZEK.includes(t.typ);
export const czyZakupZaMnie = t => t.typ === 'wydatek' && !t.konto && Boolean(t.pozyczka_id);
export const kierunek = t => (WPLYWY.has(t.typ) ? 'wpływ' : 'wypływ');
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
      wynik.push({ rodzaj: czyPozyczkowa(t) || czyZakupZaMnie(t) ? 'pozyczka' : 'pojedyncza', glowna: t, czesci: [t], kwota: Number(t.kwota) || 0 });
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

// ── konta: saldo = saldo początkowe + ruchy od daty salda ──
export function stanKont() {
  const stan = new Map();
  konta(true).forEach(k => {
    const a = atrybuty(k);
    const waluta = k.waluta || 'PLN';
    const salda = {};
    if (a.saldo_poczatkowe !== undefined && a.saldo_poczatkowe !== '') salda[waluta] = Number(a.saldo_poczatkowe) || 0;
    stan.set(k.nazwa, { konto: k, salda, liczba: 0, odDaty: a.data_salda || '' });
  });
  for (const t of dane.transakcje) {
    if (!t.konto || t.status === 'anulowana') continue;
    const s = stan.get(t.konto);
    if (!s) continue;
    // przesunięcia do Skarbonki to tylko zapis – nie zmieniają salda prawdziwego konta
    if (t.status === 'bez ruchu na koncie' && !s.konto.wirtualne) continue;
    s.liczba++;
    if (s.odDaty && String(t.data_operacji) < s.odDaty) continue;
    const w = t.waluta || s.konto.waluta || 'PLN';
    s.salda[w] = zaokr((s.salda[w] || 0) + (kierunek(t) === 'wpływ' ? 1 : -1) * (Number(t.kwota) || 0));
  }
  return stan;
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
export function formaRytmu(jednostka, n) {
  const f = RYTMY[jednostka] || RYTMY['miesiąc'];
  if (n === 1) return f[0];
  const d = n % 10, s = n % 100;
  return d >= 2 && d <= 4 && (s < 12 || s > 14) ? f[1] : f[2];
}
export function opisRytmu(p) {
  if (p.rodzaj === 'jednorazowa') return 'jednorazowo';
  if (p.rodzaj === 'rata') return 'rata pożyczki';
  const n = Number(p.co_ile) || 1;
  if (n === 1) return { 'dzień': 'codziennie', 'tydzień': 'co tydzień', 'miesiąc': 'co miesiąc', 'rok': 'co rok' }[p.powtarzanie] || 'co miesiąc';
  return `co ${n} ${formaRytmu(p.powtarzanie, n)}`;
}
export const aktywnePlanowane = () => dane.planowane.filter(p => p.status === 'aktywna');
export const jednorazowa = p => p.rodzaj === 'jednorazowa' || p.rodzaj === 'rata';
export function nastepnyTermin(p, od = p.nastepna_data) {
  if (jednorazowa(p)) return null;
  const nowa = przesunDate(od, p.powtarzanie || 'miesiąc', Number(p.co_ile) || 1, p.data_start || p.nastepna_data);
  if (p.data_koniec && nowa > p.data_koniec) return null;
  return nowa;
}
/** Wszystkie terminy pozycji planowanej do daty „do” włącznie (od najbliższego, także zaległego). */
export function terminy(p, do_) {
  const wynik = [];
  let d = p.nastepna_data;
  while (d && d <= do_ && wynik.length < 400) {
    wynik.push(d);
    d = nastepnyTermin(p, d);
  }
  return wynik;
}
export function miesiecznyKoszt(p) {
  if (jednorazowa(p)) return 0;
  const n = Number(p.co_ile) || 1;
  const k = Number(p.kwota) || 0;
  return { 'dzień': k * 30.44 / n, 'tydzień': k * 4.345 / n, 'miesiąc': k / n, 'rok': k / 12 / n }[p.powtarzanie || 'miesiąc'] ?? k;
}
export const poTerminie = () => aktywnePlanowane().filter(p => p.nastepna_data && p.nastepna_data < dataLok());
export const kierunekPlanu = p => (p.typ === 'wpływ' || p.typ === 'spłata-otrzymana' ? 'wpływ' : p.typ === 'przeksięgowanie' ? 'przesunięcie' : 'wypływ');

// ── pożyczki ──
export const RODZAJE_POZYCZEK = {
  udzielona: { etykieta: 'Pożyczam komuś', krotko: 'Pożyczyłem', osoba: 'Komu', typ: 'pożyczka-udzielona', splata: 'spłata-otrzymana', strona: 'do-odzyskania' },
  otrzymana: { etykieta: 'Pożyczam od kogoś', krotko: 'Pożyczyłem od', osoba: 'Od kogo', typ: 'pożyczka-otrzymana', splata: 'spłata-oddana', strona: 'do-oddania' },
  'zakup-za-mnie': { etykieta: 'Ktoś zapłacił za mnie', krotko: 'Zapłacił za mnie', osoba: 'Kto zapłacił', typ: 'wydatek', splata: 'spłata-oddana', strona: 'do-oddania' },
};
export const stronaPozyczki = p => RODZAJE_POZYCZEK[p.rodzaj]?.strona || 'do-oddania';

/** Rozkład kwoty na raty: równe kwoty, ostatnia wyrównuje grosze. */
export function harmonogram(kwota, liczbaRat, pierwsza, jednostka = 'miesiąc', co = 1) {
  const n = Math.max(1, Math.min(120, Math.floor(liczbaRat) || 1));
  const rata = Math.floor((kwota / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({
    nr: i + 1, z: n,
    data: i === 0 ? pierwsza : przesunDate(pierwsza, jednostka, i * (Number(co) || 1), pierwsza),
    kwota: i === n - 1 ? zaokr(kwota - rata * (n - 1)) : rata,
  }));
}

export function stanPozyczki(p) {
  const kwota = Number(p.kwota) || 0;
  const typSplaty = RODZAJE_POZYCZEK[p.rodzaj]?.splata;
  const splaty = dane.transakcje
    .filter(t => t.pozyczka_id === p.id && t.typ === typSplaty && t.status !== 'anulowana')
    .sort((a, b) => String(a.data_operacji).localeCompare(String(b.data_operacji)));
  const splacono = zaokr(splaty.reduce((s, t) => s + (Number(t.kwota) || 0), 0));
  const raty = dane.planowane.filter(x => x.pozyczka_id === p.id && x.status !== 'anulowana')
    .sort((a, b) => String(a.nastepna_data).localeCompare(String(b.nastepna_data)));
  const nastepna = raty.find(r => r.status === 'aktywna');
  return {
    kwota, splacono, pozostalo: zaokr(Math.max(0, kwota - splacono)), procent: kwota > 0 ? Math.min(1, splacono / kwota) : 0,
    splaty, raty, nastepna, poTerminie: raty.filter(r => r.status === 'aktywna' && r.nastepna_data < dataLok()).length,
  };
}

// ── budżety i cele ──
export const aktywneBudzety = () => dane.budzety.filter(b => b.status !== 'anulowany' && b.status !== 'zakończony');
export const aktywneCele = () => aktywneBudzety().filter(b => b.rodzaj === 'cel');

/** Zakres dat bieżącego okresu budżetu [od, do] (włącznie). */
export function okresBudzetu(b, dzien = dataLok()) {
  if (b.rodzaj === 'projekt' || b.rodzaj === 'cel') return [b.data_od || '0000-01-01', b.data_do || '9999-12-31'];
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
    if (t.status === 'anulowana' || czyPrzeks(t) || czyPozyczkowa(t) || czyPrywatna(t)) continue;
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

export const kontoCelu = c => c.konta || SKARBONKA;

/**
 * Cel: odłożono = przeksięgowania i wpływy przypisane do celu (minus wycofane z celu),
 * wydano = wydatki przypisane do celu, zostało w celu = odłożono − wydano.
 */
export function stanCelu(c, dzien = dataLok()) {
  let zebrano = 0, wydano = 0, bezKursu = 0, liczba = 0;
  for (const t of dane.transakcje) {
    if (t.cel !== c.id || t.status === 'anulowana') continue;
    const k = kwotaPLN(t);
    if (k === null) { bezKursu++; continue; }
    liczba++;
    if (t.typ === 'wydatek') wydano += k;
    else if (t.typ === 'wpływ' || t.typ === 'przeksięgowanie-wpływ') zebrano += k;
    else if (t.typ === 'przeksięgowanie-wypływ') zebrano -= k;
  }
  const kwota = Number(c.kwota) || 0;
  const brakuje = Math.max(0, kwota - zebrano);
  const dni = c.data_do && c.data_do >= dzien ? roznicaDni(c.data_do, dzien) : null;
  return {
    kwota, zebrano: zaokr(zebrano), wydano: zaokr(wydano), zostalo: zaokr(zebrano - wydano), brakuje: zaokr(brakuje),
    procent: kwota > 0 ? Math.max(0, zebrano / kwota) : 0,
    bezKursu, liczba, dni, miesiecznie: dni && brakuje > 0 ? zaokr(brakuje / Math.max(1, dni / 30.44)) : null,
  };
}

/** Budżety projektów, które można wybrać przy wpisie z tą datą. */
export const budzetyDoWyboru = data => aktywneBudzety().filter(b => b.rodzaj === 'projekt'
  && (!b.data_od || data >= b.data_od) && (!b.data_do || data <= dodajDni(b.data_do, 30)));
