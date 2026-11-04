// Dane w pamięci: zamówienia, klienci i cennik zbudowany ze sprzedaży z Subiekta.

import * as db from './db.js';
import { ustawienia } from './api.js';
import { num, zaokr, dataLok, dodajDni, normalizuj } from './util.js';

export const dane = { zamowienia: [], pozycje: [], klienci: [], cennik: [], grupy: [], magazyny: [] };

const numerZam = id => Number(String(id).split('-').pop()) || 0;
let podpis = '';

/** Wczytuje dane z pamięci urządzenia. Zwraca true, gdy coś się zmieniło od poprzedniego wczytania. */
export async function wczytaj() {
  const karty = await Promise.all(['ZAMOWIENIA', 'ZAMOWIENIA_POZ', 'KLIENCI', 'SPRZEDAZ_SGT', 'SPRZEDAZ_SGT_POZ'].map(db.wiersze));
  const nowy = karty.map(l => l.length + ':' + l.reduce((m, w) => (String(w.zmieniono || '') > m ? String(w.zmieniono) : m), '')
    + ':' + l.map(w => w.status || '').join('')).join('|');
  const zmiana = nowy !== podpis;
  podpis = nowy;
  const [z, p, k, dok, poz] = karty;
  dane.zamowienia = z.sort((a, b) => String(b.data).localeCompare(String(a.data)) || numerZam(b.id) - numerZam(a.id) || String(b.id).localeCompare(String(a.id)));
  dane.pozycje = p;
  dane.klienci = k;
  zbudujCennik(dok, poz);
  return zmiana;
}

// ───────────────────────── cennik ─────────────────────────

/**
 * Cena produktu = najczęstsza cena jednostkowa z ostatnich 120 dni jego sprzedaży (przy remisie – najnowsza).
 * Najczęstsza, a nie ostatnia, bo pojedynczy paragon z rabatem nie powinien zmieniać cennika.
 */
function zbudujCennik(dokumenty, pozycje) {
  const daty = new Map();
  const magazyny = new Set();
  dokumenty.forEach(d => {
    if (String(d.status || '').startsWith('usuni')) return;
    daty.set(`${d.podmiot}|${d.dok_id}`, String(d.data || '').slice(0, 10));
    if (d.magazyn) magazyny.add(String(d.magazyn));
  });

  const produkty = new Map();
  pozycje.forEach(p => {
    if (String(p.status || '').startsWith('usuni') || !p.symbol) return;
    const data = daty.get(`${p.podmiot}|${p.dok_id}`);
    if (!data) return;
    const ilosc = num(p.ilosc);
    if (ilosc <= 0) return;
    const cena = zaokr(num(p.brutto) / ilosc);
    if (cena <= 0) return;
    const symbol = String(p.symbol);
    const e = produkty.get(symbol) || { symbol, sprzedaze: [], sprzedano: 0 };
    e.sprzedaze.push({ data, cena, nazwa: String(p.nazwa || symbol), grupa: String(p.grupa || ''), jm: String(p.jm || 'szt.') });
    e.sprzedano += ilosc;
    produkty.set(symbol, e);
  });

  dane.cennik = [...produkty.values()].map(e => {
    e.sprzedaze.sort((a, b) => b.data.localeCompare(a.data));
    const ost = e.sprzedaze[0];
    const granica = dodajDni(ost.data, -120);
    const liczniki = new Map();
    e.sprzedaze.filter(s => s.data >= granica).forEach((s, i) => {
      const l = liczniki.get(s.cena) || { n: 0, pierwszy: i };
      l.n++;
      liczniki.set(s.cena, l);
    });
    const [cena] = [...liczniki.entries()].sort((a, b) => b[1].n - a[1].n || a[1].pierwszy - b[1].pierwszy)[0];
    return {
      symbol: e.symbol, nazwa: ost.nazwa, grupa: ost.grupa, jm: ost.jm, cena,
      sprzedano: e.sprzedano, ostatnio: ost.data, szukaj: normalizuj(e.symbol + ' ' + ost.nazwa + ' ' + ost.grupa),
    };
  }).sort((a, b) => b.sprzedano - a.sprzedano || a.nazwa.localeCompare(b.nazwa, 'pl'));

  const grupy = new Map();
  dane.cennik.forEach(p => { if (p.grupa) grupy.set(p.grupa, (grupy.get(p.grupa) || 0) + p.sprzedano); });
  dane.grupy = [...grupy.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  dane.magazyny = [...magazyny].sort((a, b) => a.localeCompare(b, 'pl'));
}

export function szukajProduktow(tekst, grupa, limit = 30) {
  const slowa = normalizuj(tekst).split(/\s+/).filter(Boolean);
  return dane.cennik
    .filter(p => (!grupa || p.grupa === grupa) && slowa.every(s => p.szukaj.includes(s)))
    .slice(0, limit);
}

// ───────────────────────── zamówienia ─────────────────────────

export const pozycjeZamowienia = id => dane.pozycje
  .filter(p => String(p.zamowienie_id) === String(id))
  .sort((a, b) => numerZam(a.id) - numerZam(b.id));

export const zamowienie = id => dane.zamowienia.find(z => String(z.id) === String(id));
export const klient = id => (id ? dane.klienci.find(k => String(k.id) === String(id)) : null);

const KLUCZ_LICZNIKA = 'or-stoisko-licznik:';

/** Kolejny numer zamówienia: KOD-ROK-NNNN, liczony od najwyższego numeru tego kodu w danym roku. */
export function nastepnyNumer() {
  const { kod } = ustawienia();
  const prefiks = `${kod}-${dataLok().slice(0, 4)}-`;
  let max = Number(localStorage.getItem(KLUCZ_LICZNIKA + prefiks)) || 0;
  dane.zamowienia.forEach(z => {
    if (String(z.id).startsWith(prefiks)) max = Math.max(max, numerZam(z.id));
  });
  return prefiks + String(max + 1).padStart(4, '0');
}

export function zapamietajNumer(numer) {
  const prefiks = numer.slice(0, numer.lastIndexOf('-') + 1);
  const n = numerZam(numer);
  if (n > (Number(localStorage.getItem(KLUCZ_LICZNIKA + prefiks)) || 0)) localStorage.setItem(KLUCZ_LICZNIKA + prefiks, String(n));
}

/** Urządzenia (inne niż to), które używały już tego kodu – dwa urządzenia z jednym kodem nadałyby te same numery. */
export function kodUzywanyPrzez(kod, kto) {
  return [...new Set(dane.zamowienia
    .filter(z => String(z.id).startsWith(kod + '-') && z.urzadzenie && String(z.urzadzenie) !== String(kto || ''))
    .map(z => String(z.urzadzenie)))];
}

// ───────────────────────── telefony ─────────────────────────

/** Numer w formacie +48123456789; 9 cyfr bez kierunkowego = Polska. Zły numer → ''. */
export function telefonE164(t) {
  let s = String(t || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^\d{9}$/.test(s)) s = '+48' + s;
  if (/^48\d{9}$/.test(s)) s = '+' + s;
  return /^\+\d{8,15}$/.test(s) ? s : '';
}

export function telefonCzytelny(t) {
  const e = telefonE164(t);
  if (!e) return String(t || '');
  if (e.startsWith('+48') && e.length === 12) return e.slice(3).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  return e;
}

export function klientPoTelefonie(t) {
  const e = telefonE164(t);
  return e ? dane.klienci.find(k => telefonE164(k.telefon) === e) : null;
}
