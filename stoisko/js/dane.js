// Dane w pamięci: zamówienia, klienci, katalog produktów (karta KATALOG z „Cennik OneRiver”),
// wysyłki, grupy cenowe i ceny specjalne. Sprzedaż z Subiekta służy do kolejności „najczęściej sprzedawane”
// i jako zapasowy cennik, gdy KATALOG jest jeszcze pusty.

import * as db from './db.js';
import { ustawienia } from './api.js';
import { num, zaokr, dataLok, dodajDni, normalizuj } from './util.js';
import { KOLEJNOSC_KATEGORII, GRUPY_POZIOMOW, KATEGORIE_FORMULARZA_DOMYSLNE } from './konfiguracja.js';

export const dane = {
  zamowienia: [], pozycje: [], klienci: [], cennik: [], produkty: [], grupy: [], magazyny: [],
  wysylki: [], grupyCenowe: [], cenySpecjalne: [], zKatalogu: false,
  poziomy: [], cenyPoziomow: new Map(), ustawienia: new Map(), stanyZDnia: '',
};

const numerZam = id => Number(String(id).split('-').pop()) || 0;
const prawda = v => v === true || /^(true|tak|1)$/i.test(String(v));
export const aktywny = w => w.aktywna === '' || w.aktywna === undefined || prawda(w.aktywna);
let podpis = '';

const KARTY = ['ZAMOWIENIA', 'ZAMOWIENIA_POZ', 'KLIENCI', 'SPRZEDAZ_SGT', 'SPRZEDAZ_SGT_POZ', 'KATALOG', 'WYSYLKI', 'GRUPY_CENOWE', 'CENY_SPECJALNE',
  'POZIOMY_CENOWE', 'CENY_POZIOMOW', 'USTAWIENIA'];

/** Wczytuje dane z pamięci urządzenia. Zwraca true, gdy coś się zmieniło od poprzedniego wczytania. */
export async function wczytaj() {
  const karty = await Promise.all(KARTY.map(db.wiersze));
  const nowy = karty.map(l => l.length + ':' + l.reduce((m, w) => (String(w.zmieniono || '') > m ? String(w.zmieniono) : m), '')
    + ':' + l.map(w => w.status || '').join('')).join('|');
  const zmiana = nowy !== podpis;
  podpis = nowy;
  const [z, p, k, dok, poz, kat, wys, gr, cs, pc, cp, us] = karty;
  dane.poziomy = pc.sort((a, b) => num(a.kolejnosc) - num(b.kolejnosc) || String(a.nazwa).localeCompare(String(b.nazwa), 'pl'));
  dane.cenyPoziomow = new Map(cp.filter(c => c.cena !== '' && c.cena != null).map(c => [`${c.poziom_id}|${c.symbol}`, num(c.cena)]));
  dane.ustawienia = new Map(us.map(u => [String(u.id), String(u.tresc ?? '')]));
  dane.zamowienia = z.sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.utworzono || '').localeCompare(String(a.utworzono || '')) || numerZam(b.id) - numerZam(a.id));
  dane.pozycje = p;
  dane.klienci = k.sort((a, b) => String(a.nazwa || '').localeCompare(String(b.nazwa || ''), 'pl'));
  dane.wysylki = wys.sort((a, b) => num(a.kolejnosc) - num(b.kolejnosc) || String(a.nazwa).localeCompare(String(b.nazwa), 'pl'));
  dane.grupyCenowe = gr.sort((a, b) => num(a.rabat_proc) - num(b.rabat_proc));
  dane.cenySpecjalne = cs;
  zbudujCennik(kat, dok, poz);
  return zmiana;
}

// ───────────────────────── cennik ─────────────────────────

function sprzedazWgSymbolu(dokumenty, pozycje) {
  const daty = new Map();
  const magazyny = new Set();
  dokumenty.forEach(d => {
    if (String(d.status || '').startsWith('usuni')) return;
    daty.set(`${d.podmiot}|${d.dok_id}`, String(d.data || '').slice(0, 10));
    if (d.magazyn) magazyny.add(String(d.magazyn));
  });
  dane.magazyny = [...magazyny].sort((a, b) => a.localeCompare(b, 'pl'));
  const wynik = new Map();
  pozycje.forEach(p => {
    if (String(p.status || '').startsWith('usuni') || !p.symbol) return;
    const data = daty.get(`${p.podmiot}|${p.dok_id}`);
    const ilosc = num(p.ilosc);
    if (!data || ilosc <= 0) return;
    const e = wynik.get(String(p.symbol)) || { sprzedano: 0, sprzedaze: [], nazwa: String(p.nazwa || p.symbol), grupa: String(p.grupa || ''), jm: String(p.jm || 'szt.') };
    e.sprzedano += ilosc;
    e.sprzedaze.push({ data, cena: zaokr(num(p.brutto) / ilosc) });
    wynik.set(String(p.symbol), e);
  });
  return wynik;
}

/** Najczęstsza cena z ostatnich 120 dni sprzedaży – tylko gdy katalogu jeszcze nie ma. */
function cenaZeSprzedazy(e) {
  e.sprzedaze.sort((a, b) => b.data.localeCompare(a.data));
  const granica = dodajDni(e.sprzedaze[0].data, -120);
  const liczniki = new Map();
  e.sprzedaze.filter(s => s.data >= granica && s.cena > 0).forEach((s, i) => {
    const l = liczniki.get(s.cena) || { n: 0, pierwszy: i };
    l.n++;
    liczniki.set(s.cena, l);
  });
  const naj = [...liczniki.entries()].sort((a, b) => b[1].n - a[1].n || a[1].pierwszy - b[1].pierwszy)[0];
  return naj ? naj[0] : 0;
}

/** „Rape Washawa - 12g” → produkt + wariant (tak samo jak skrypt arkusza – dla zapasowego cennika ze sprzedaży). */
function rozbierzNazwe(nazwa) {
  const t = String(nazwa).trim();
  const g = /\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*g\s*$/i.exec(t);
  return g ? { produkt: t.slice(0, g.index).trim(), wariant: g[1].replace('.', ',') + ' g' } : { produkt: t, wariant: '' };
}

const wagaWariantu = w => {
  const n = parseFloat(String(w).replace(',', '.'));
  if (isFinite(n)) return n;
  const r = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].indexOf(String(w).toUpperCase());
  return r >= 0 ? 1000 + r : 2000;
};

function zbudujCennik(katalog, dokumenty, pozycje) {
  const sprzedaz = sprzedazWgSymbolu(dokumenty, pozycje);
  const aktywne = katalog.filter(w => aktywny(w) && num(w.cena) > 0);
  dane.zKatalogu = aktywne.length > 0;

  if (dane.zKatalogu) {
    dane.cennik = aktywne.map(w => ({
      symbol: String(w.id), nazwa: String(w.nazwa), produkt: String(w.produkt || w.nazwa), wariant: String(w.wariant || ''),
      kategoria: String(w.kategoria || 'Inne'), jm: String(w.jm || 'szt.'), cena: num(w.cena), zdjecie: String(w.zdjecie || ''),
      rodzaj: String(w.rodzaj || ''), grupa: String(w.grupa || ''),
      ukryty: prawda(w.ukryty), sprzedano: sprzedaz.get(String(w.id))?.sprzedano || 0,
      stan: w.stan === '' || w.stan == null ? null : num(w.stan),
    }));
    dane.stanyZDnia = String(aktywne.find(w => w.stan_z_dnia)?.stan_z_dnia || '');
  } else {
    dane.cennik = [...sprzedaz.entries()].map(([symbol, e]) => {
      const r = rozbierzNazwe(e.nazwa);
      return { symbol, nazwa: e.nazwa, produkt: r.produkt, wariant: r.wariant, kategoria: e.grupa || 'Inne', jm: e.jm,
        cena: cenaZeSprzedazy(e), zdjecie: '', ukryty: false, sprzedano: e.sprzedano, stan: null };
    }).filter(p => p.cena > 0);
  }

  // produkty: warianty (gramatura, rozmiar) razem; bez wariantu – każdy symbol osobno
  const mapa = new Map();
  dane.cennik.forEach(c => {
    const klucz = c.wariant ? `${c.kategoria}|${c.produkt}` : `${c.kategoria}|${c.produkt}|${c.symbol}`;
    const p = mapa.get(klucz) || { klucz, produkt: c.produkt, kategoria: c.kategoria, warianty: [], sprzedano: 0, zdjecie: '' };
    p.warianty.push(c);
    p.sprzedano += c.sprzedano;
    if (!p.zdjecie && c.zdjecie) p.zdjecie = c.zdjecie;
    mapa.set(klucz, p);
  });
  dane.produkty = [...mapa.values()].map(p => {
    p.warianty.sort((a, b) => wagaWariantu(a.wariant) - wagaWariantu(b.wariant));
    p.szukaj = normalizuj([p.produkt, p.kategoria, ...p.warianty.map(w => w.symbol + ' ' + w.nazwa)].join(' '));
    return p;
  }).sort((a, b) => b.sprzedano - a.sprzedano || a.produkt.localeCompare(b.produkt, 'pl'));

  const kat = new Set(dane.produkty.map(p => p.kategoria));
  dane.grupy = [...KOLEJNOSC_KATEGORII.filter(k => kat.has(k)), ...[...kat].filter(k => !KOLEJNOSC_KATEGORII.includes(k)).sort((a, b) => a.localeCompare(b, 'pl'))];
}

export function szukajProduktow(tekst, kategoria, limit = 30) {
  const slowa = normalizuj(tekst).split(/\s+/).filter(Boolean);
  return dane.produkty
    .filter(p => (!kategoria || p.kategoria === kategoria) && slowa.every(s => p.szukaj.includes(s)))
    .slice(0, limit);
}

export const produktSymbolu = symbol => dane.cennik.find(p => p.symbol === symbol);

// ───────────────────────── ceny klienta ─────────────────────────

export const grupaCenowa = id => dane.grupyCenowe.find(g => String(g.id) === String(id) || String(g.nazwa) === String(id));

/** Rabat klienta w %: jego własny, a gdy go nie ma – rabat grupy cenowej. */
export function rabatKlienta(k) {
  if (!k) return 0;
  if (num(k.rabat_proc) > 0) return num(k.rabat_proc);
  const g = grupaCenowa(k.grupa);
  return g && aktywny(g) ? num(g.rabat_proc) : 0;
}

export const cenySpecjalneKlienta = id => dane.cenySpecjalne.filter(c => String(c.klient_id) === String(id) && aktywny(c) && c.cena !== '');

export const poziom = id => dane.poziomy.find(p => String(p.id) === String(id));
export const poziomyGrupy = grupa => dane.poziomy.filter(p => String(p.grupa) === grupa);
export const cenaPoziomu = (poziomId, symbol) => dane.cenyPoziomow.get(`${poziomId}|${symbol}`);

/** Poziom klienta dla produktu (po kategorii produktu: Rapé → poziom_rape, Zielarnia → poziom_zielarnia). */
export function poziomKlienta(k, symbol) {
  const g = GRUPY_POZIOMOW[produktSymbolu(symbol)?.kategoria];
  if (!k || !g || !k['poziom_' + g]) return null;
  const p = poziom(k['poziom_' + g]);
  return p && aktywny(p) ? p : null;
}

/**
 * Cena dla klienta: cena specjalna produktu → cena z poziomu klienta (Rapé / Zielarnia) → rabat klienta → rabat grupy
 * → cena katalogowa. Tak samo liczy skrypt arkusza w formularzu.
 */
export function cenaKlienta(k, symbol, cenaKatalogowa) {
  if (!k) return cenaKatalogowa;
  const spec = cenySpecjalneKlienta(k.id).find(c => String(c.symbol) === String(symbol));
  if (spec) return num(spec.cena);
  const p = poziomKlienta(k, symbol);
  if (p) { const c = cenaPoziomu(p.id, symbol); if (c !== undefined) return c; }
  const r = rabatKlienta(k);
  return r > 0 ? zaokr(cenaKatalogowa * (1 - r / 100)) : cenaKatalogowa;
}

export function opisCenKlienta(k) {
  if (!k) return '';
  const r = rabatKlienta(k);
  const g = grupaCenowa(k.grupa);
  const spec = cenySpecjalneKlienta(k.id).length;
  const poz = Object.values(GRUPY_POZIOMOW).map(gr => poziom(k['poziom_' + gr])).filter(Boolean).map(p => p.nazwa);
  return [...poz, g ? `grupa ${g.nazwa}` : '', r ? `rabat ${String(r).replace('.', ',')}%` : '', spec ? `${spec} cen specjalnych` : ''].filter(Boolean).join(' · ');
}

/** Wartość z karty USTAWIENIA (pusty tekst, gdy brak). */
export const ustawienieTekst = id => dane.ustawienia.get(id) ?? '';

export function kategorieFormularza() {
  const t = dane.ustawienia.get('kategorie_formularza');
  return t ? t.split('|').map(s => s.trim()).filter(Boolean) : KATEGORIE_FORMULARZA_DOMYSLNE;
}

// ───────────────────────── wysyłki ─────────────────────────

export const wysylkiAktywne = () => dane.wysylki.filter(aktywny);
export const wysylka = id => dane.wysylki.find(w => String(w.id) === String(id));

export function kosztWysylki(w, wartoscProduktow) {
  if (!w) return 0;
  if (w.darmowa_od !== '' && w.darmowa_od != null && wartoscProduktow >= num(w.darmowa_od)) return 0;
  return num(w.cena);
}

// ───────────────────────── zamówienia ─────────────────────────

export const pozycjeZamowienia = id => dane.pozycje
  .filter(p => String(p.zamowienie_id) === String(id) && !String(p.status || '').startsWith('usuni'))
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

// ───────────────────────── telefony i kody ─────────────────────────

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

/** Kod klienta do formularza: 8 znaków bez łatwych do pomylenia (0/O, 1/I/L). */
export function nowyKodKlienta() {
  const znaki = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const zajete = new Set(dane.klienci.map(k => String(k.kod || '').toUpperCase()));
  for (;;) {
    const los = crypto.getRandomValues(new Uint8Array(8));
    const kod = [...los].map(b => znaki[b % znaki.length]).join('');
    const ladny = kod.slice(0, 4) + '-' + kod.slice(4);
    if (!zajete.has(ladny)) return ladny;
  }
}
