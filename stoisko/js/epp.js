// Eksport paragonów do pliku EDI++ (EPP 1.11) dla Subiekta GT.
// Układ pól odwzorowany z pliku wyeksportowanego z Subiekta (PA 110/2026, listopad 2026).
// Plik jest w kodowaniu Windows-1250 z końcami linii CRLF.

const CP1250 = { 'ą': 0xB9, 'ć': 0xE6, 'ę': 0xEA, 'ł': 0xB3, 'ń': 0xF1, 'ó': 0xF3, 'ś': 0x9C, 'ź': 0x9F, 'ż': 0xBF,
  'Ą': 0xA5, 'Ć': 0xC6, 'Ę': 0xCA, 'Ł': 0xA3, 'Ń': 0xD1, 'Ó': 0xD3, 'Ś': 0x8C, 'Ź': 0x8F, 'Ż': 0xAF,
  'é': 0xE9, 'É': 0xC9, 'á': 0xE1, 'Á': 0xC1, 'í': 0xED, 'Í': 0xCD, 'ú': 0xFA, 'Ú': 0xDA, 'ü': 0xFC, 'Ü': 0xDC,
  'ö': 0xF6, 'Ö': 0xD6, 'ä': 0xE4, 'Ä': 0xC4, 'ý': 0xFD, 'č': 0xE8, 'š': 0x9A, 'ž': 0x9E, 'ř': 0xF8, 'ô': 0xF4,
  '–': 0x96, '—': 0x97, '„': 0x84, '”': 0x94, '“': 0x93, '’': 0x92, '‘': 0x91, '…': 0x85, '€': 0x80, '§': 0xA7, '°': 0xB0 };
const ZAMIENNIKI = { 'ñ': 'n', 'Ñ': 'N', 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u', 'ç': 'c', 'ã': 'a', 'õ': 'o', 'ê': 'e', 'â': 'a', 'î': 'i' };

/** Tekst → bajty Windows-1250 (znaki spoza strony kodowej zamieniane na najbliższe lub „?”). */
export function naCp1250(tekst) {
  const out = [];
  for (const ch of String(tekst)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (CP1250[ch] !== undefined) out.push(CP1250[ch]);
    else if (ZAMIENNIKI[ch]) out.push(ZAMIENNIKI[ch].charCodeAt(0));
    else out.push(0x3F);
  }
  return new Uint8Array(out);
}

// Subiekt przy imporcie psuje polskie znaki (sprawdzone dla stron kodowych 1250 i 852),
// dlatego wszystkie teksty zapisujemy bez znaków diakrytycznych: ą→a, ł→l, ż/ź→z, ś→s, ó→o …
const BEZ = { 'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'đ': 'd', 'Đ': 'D',
  '–': '-', '—': '-', '„': '"', '”': '"', '“': '"', '’': "'", '‘': "'", '…': '...', '·': '-', '€': 'EUR' };
export const bezPolskich = s => String(s).replace(/[łŁøØßæÆœŒđĐ–—„”“’‘…·€]/g, c => BEZ[c])
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');

// ── formatowanie pól ──
const T = v => (v === '' || v === null || v === undefined) ? '' : '"' + bezPolskich(String(v).replace(/[\r\n]+/g, ' ')).replace(/"/g, '""') + '"';
const K = v => (Math.round(Number(v || 0) * 10000) / 10000).toFixed(4);           // kwota z 4 miejscami
const D = d => { const x = d instanceof Date ? d : new Date(d); const p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}${p(x.getHours())}${p(x.getMinutes())}${p(x.getSeconds())}`; };
const Dzien = d => D(d).slice(0, 8) + '000000';
const linia = pola => pola.join(',');
const zl = n => Math.round(n * 100) / 100;

export const TYP_TOWARU = { towar: 1, 'usługa': 2, usluga: 2, komplet: 8 };

/**
 * Buduje treść pliku EPP.
 * @param {object} firma  { symbol, nazwa, nazwaPelna, miasto, kod, ulica, nip, magazyn, magazynNazwa, magazynOpis, operator }
 * @param {Array} dokumenty  [{ numer, rozszerzenie, data, miejsce, kategoria, podtytul, wystawca, terminDni,
 *    kontrahent: { symbol, nazwa, telefon, email, miasto, kod, ulica } | null,
 *    numerZamowienia, uwagi,
 *    platnosci: { gotowka, karta, kartaNazwa, przelew } – kwoty; brak = całość przelewem,
 *    pozycje: [{ symbol, nazwa, typ: 'towar'|'usługa'|'komplet', jm, ilosc, cena (brutto za szt.), vat, cenaCennik }] }]
 * Płatności w nagłówku: pole 34 forma płatności (reszta z terminem), 36 gotówka przy odbiorze, 56/57 karta.
 */
export function trescEpp(firma, dokumenty, teraz = new Date(), stronaKodowa = 1250) {
  const L = [];
  const sekcja = (naglowek, wiersze) => { L.push('[NAGLOWEK]', naglowek, '', '[ZAWARTOSC]', ...wiersze, ''); };

  L.push('[INFO]', linia(['"1.11"', 3, stronaKodowa, T('Subiekt GT'), T(firma.symbol), T(firma.nazwa), T(firma.nazwaPelna), T(firma.miasto), T(firma.kod),
    T(firma.ulica), T(firma.nip), T(firma.magazyn), T(firma.magazynNazwa), T(firma.magazynOpis), '', 0, '', '', T(firma.operator), D(teraz),
    T('Polska'), T('PL'), '', 0]), '');

  const towary = new Map(), kontrahenci = new Map();
  for (const d of dokumenty) {
    const pelny = d.rozszerzenie ? `${d.numer}/${d.rozszerzenie}/${new Date(d.data).getFullYear()}` : `${d.numer}/${new Date(d.data).getFullYear()}`;
    d._pelny = pelny;
    const poz = d.pozycje.map((p, i) => {
      const brutto = zl(p.cena * p.ilosc), netto = zl(brutto / (1 + p.vat / 100));
      return { ...p, lp: i + 1, typNr: TYP_TOWARU[p.typ] || 1, brutto, netto, vatKw: zl(brutto - netto), cenaNetto: zl(p.cena / (1 + p.vat / 100)) };
    });
    // VAT liczony od sumy brutto w każdej stawce (jak w Subiekcie przy dokumentach od brutto)
    const stawki = {};
    poz.forEach(p => { stawki[p.vat] = (stawki[p.vat] || 0) + p.brutto; });
    let sNetto = 0, sBrutto = 0;
    Object.entries(stawki).forEach(([v, b]) => { sBrutto += b; sNetto += zl(b / (1 + Number(v) / 100)); });
    sBrutto = zl(sBrutto); sNetto = zl(sNetto);
    const termin = new Date(d.data); termin.setDate(termin.getDate() + (d.terminDni ?? 7));
    const k = d.kontrahent;
    const pl = d.platnosci || {};
    const gotowka = zl(Number(pl.gotowka) || 0), karta = zl(Number(pl.karta) || 0);
    const reszta = zl(sBrutto - gotowka - karta);
    const forma = reszta > 0.004 ? 'Przelew' : (karta > 0 && !gotowka ? '' : 'Gotówka');

    L.push('[NAGLOWEK]', linia([T('PA'), 1, 0, d.numer, '', T(d.rozszerzenie || ''), T(pelny), '', '',
      T(d.numerZamowienia || ''), '', T(k?.symbol), T(k?.nazwa), T(k?.nazwa), T(k?.miasto), T(k?.kod), T(k?.ulica), '',
      T(d.kategoria), T(d.podtytul), T(d.miejsce), Dzien(d.data), Dzien(d.data), '', poz.length, 0, T('Detaliczna'),
      K(sNetto), K(zl(sBrutto - sNetto)), K(sBrutto), K(0), '', K(0), T(forma), Dzien(reszta > 0.004 ? termin : d.data), K(gotowka), K(sBrutto), 0, 0, 1, 0, T(';' + (d.wystawca || '')),
      '', '', K(0), K(0), T('PLN'), K(1), T(d.uwagi || ''), '', '', '', 0, 0, 0, T(karta ? (pl.kartaNazwa || 'Karta') : ''), K(karta), '', K(0), T('Polska'), T('PL'), 0]), '');
    L.push('[ZAWARTOSC]', ...poz.map(p => linia([p.lp, p.typNr, T(p.symbol), 1, 1, 0, p.typNr === 2 ? 0 : 1, K(0), K(0), T(p.jm || 'szt.'),
      K(p.ilosc), K(p.ilosc), K(0), K(p.cenaNetto), K(p.cena), K(p.vat), K(p.netto), K(p.vatKw), K(p.brutto), K(0), '', ''])), '');

    poz.forEach(p => { if (!towary.has(p.symbol)) towary.set(p.symbol, p); });
    if (k && !kontrahenci.has(k.symbol)) kontrahenci.set(k.symbol, k);
  }

  const kon = [...kontrahenci.values()];
  sekcja('"KONTRAHENCI"', kon.map(k => linia([4, T(k.symbol), T(k.nazwa), T(k.nazwa), T(k.miasto), T(k.kod), T(k.ulica), '', '', T(k.telefon), '', '',
    T(k.email), '', '', '', '', '', '', '', '', '', '', '', '', '', '', T('Polska'), T('PL'), 0])));
  sekcja('"GRUPYKONTRAHENTOW"', kon.map(k => linia([T(k.symbol), T('Podstawowa')])));
  sekcja('"CECHYKONTRAHENTOW"', []);
  sekcja('"DODATKOWEKONTRAHENTOW"', kon.map(k => linia([T(k.symbol), 0, 1, 0, 0, 0, 0])));

  const tow = [...towary.values()];
  const st = p => T(String(Math.round(p.vat)));
  sekcja('"TOWARY"', tow.map(p => linia([p.typNr, T(p.symbol), '', T(p.ean || ''), T(p.nazwa), '', p.typNr === 2 ? T(p.nazwa) : '', '', '', T(p.jm || 'szt.'),
    st(p), K(p.vat), st(p), K(p.vat), K(0), K(0), '', 0, '', '', p.typNr === 2 ? T(p.jm || 'szt.') : '', K(0), 0, '', '', 0, T(p.jm || 'szt.'), K(0), K(0), '', 0, '', 0, 0, T('0'), '', '', '', '', '', '', ''])));
  sekcja('"CENNIK"', tow.flatMap(p => {
    const b = Number(p.cenaCennik ?? p.cena), n = zl(b / (1 + p.vat / 100));
    return [linia([T(p.symbol), T('Detaliczna'), K(n), K(b), K(n), K(100), K(n)]),
      linia([T(p.symbol), T('Hurtowa'), K(0), K(0), K(5), K(0), K(0)]),
      linia([T(p.symbol), T('Specjalna'), K(0), K(0), K(3), K(0), K(0)])];
  }));
  sekcja('"GRUPYTOWAROW"', tow.map(p => linia([T(p.symbol), T(p.grupa || 'Podstawowa'), ''])));
  sekcja('"CECHYTOWAROW"', []);
  sekcja('"DODATKOWETOWAROW"', tow.map(p => linia([T(p.symbol), 0, 0, K(0), 0, 0, 0])));
  sekcja('"TOWARYKODYCN"', tow.map(p => linia([T(p.symbol), ''])));
  sekcja('"TOWARYGRUPYJPKVAT"', tow.map(p => linia([T(p.symbol), ...Array(13).fill(0)])));
  sekcja('"DATYZAKONCZENIA"', dokumenty.map(d => linia([T('PA ' + d._pelny), Dzien(d.data)])));
  sekcja('"NUMERYIDENTYFIKACYJNENABYWCOW"', []);
  sekcja('"PRZYCZYNYKOREKT"', []);
  sekcja('"DOKUMENTYFISKALNEVAT"', []);
  sekcja('"OPLATYDODATKOWE"', []);
  sekcja('"WYMAGALNOSCMPP"', dokumenty.map(d => linia([T('PA ' + d._pelny), 0])));
  sekcja('"OPLATACUKROWA"', []);
  sekcja('"DOKUMENTYZNACZNIKIJPKVAT"', dokumenty.map(d => linia([T('PA ' + d._pelny), ...Array(30).fill(0)])));
  sekcja('"INFORMACJEWSTO"', []);
  sekcja('"DATYUJECIAKOREKT"', []);
  return L.join('\r\n') + '\r\n';
}

export const FIRMA_INCO = { symbol: 'INC', nazwa: 'Inco_OneRiver', nazwaPelna: 'One River', miasto: 'Warszawa', kod: '00-000',
  ulica: 'Nowogrodzka 64/43', nip: '7011179242', magazyn: 'INC', magazynNazwa: 'Główny', magazynOpis: 'Magazyn główny', operator: 'Aleksander' };
