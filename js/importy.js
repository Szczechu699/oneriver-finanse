// Ekran „Import wyciągu” (#import): plik z banku → dopasowanie do wpisów ręcznych → nowe transakcje z kategoriami.
// Wpisy ręczne zawsze są pierwsze; import raz w miesiącu je potwierdza (status „potwierdzona”) i uzupełnia resztę.
// Każda operacja z wyciągu ma „odcisk” (konto, data, kwota, opis, kolejny numer takiej samej operacji),
// więc ponowny import tego samego lub nakładającego się okresu niczego nie dubluje.

import { $, $$, esc, zaokr, kwotaTxt, dataLok, dodajDni, roznicaDni, dataKrotko, dataSlownie, uuid, odmiana, toast, okno, bezSkoku } from './util.js';
import {
  dane, wczytajDane, konta, atrybuty, glowne, podrzedne, podmioty, podmiotKonta, czyWirtualne, kierunek, czyPrzeks, lista,
  statusDlaKonta,
} from './dane.js';
import * as sync from './sync.js';
import { ikonaSvg } from './ikony.js';
import { nowaKategoria } from './kategorie.js';

const WPLYWOWE = new Set(['wpływ', 'przeksięgowanie-wpływ', 'pożyczka-otrzymana', 'spłata-otrzymana']);

// ───────────────────────── odczyt pliku ─────────────────────────

async function czytajPlik(plik) {
  const bajty = new Uint8Array(await plik.arrayBuffer());
  if (bajty[0] === 0xFF && bajty[1] === 0xFE) return new TextDecoder('utf-16le').decode(bajty);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bajty); } catch { return new TextDecoder('windows-1250').decode(bajty); }
}

function podzielCsv(linia, sep = ';') {
  const wynik = [];
  let pole = '', cudzyslow = false;
  for (let i = 0; i < linia.length; i++) {
    const c = linia[i];
    if (cudzyslow) {
      if (c === '"' && linia[i + 1] === '"') { pole += '"'; i++; }
      else if (c === '"') cudzyslow = false;
      else pole += c;
    } else if (c === '"') cudzyslow = true;
    else if (c === sep) { wynik.push(pole); pole = ''; }
    else pole += c;
  }
  wynik.push(pole);
  return wynik;
}

/** „1 234,56 PLN” → { kwota: 1234.56, waluta: 'PLN' } */
function kwotaZTekstu(s) {
  const t = String(s || '').replace(/[\s ]/g, '');
  const m = /^(-?[\d.]*\d(?:,\d+)?)([A-Z]{3})?$/.exec(t);
  if (!m) return null;
  return { kwota: Number(m[1].replace(/\./g, '').replace(',', '.')), waluta: m[2] || '' };
}

const NAZWA_WIELKIMI = s => (s === s.toUpperCase() && /[A-ZĄĆĘŁŃÓŚŹŻ]{3}/.test(s)
  ? s.toLowerCase().replace(/(^|[\s\-'(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  : s);

/** Opis z mBanku → kontrahent, tytuł, rodzaj operacji i rachunek drugiej strony. */
export function rozbierzOpisMbank(opis) {
  const czesci = String(opis).split(/\s{2,}/).map(s => s.trim()).filter(s => s && s !== '.');
  const rachunek = czesci.find(c => /^\d{26}$/.test(c)) || '';
  const rodzajOp = czesci.find(c => /PRZELEW|BLIK|ZAKUP|WYPŁATA|WPŁATA|OPŁATA|PRZYCHODZĄCY|WYCHODZĄCY/.test(c) && c !== czesci[0]) || '';
  let kontrahent = '', tytul = '', rodzaj = 'inne';
  const pierwsza = czesci[0] || '';
  const karta = /^(.*?)\s*ZAKUP PRZY UŻYCIU KARTY/i.exec(opis);
  if (karta) {
    rodzaj = 'karta';
    kontrahent = karta[1].trim();
    tytul = 'Płatność kartą';
  } else if (/BLIK ZAKUP/.test(opis)) {
    rodzaj = 'blik';
    kontrahent = pierwsza.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
    tytul = 'Zakup BLIK';
  } else if (/PRZELEW|BLIK P2P/.test(opis) && pierwsza.includes(',')) {
    rodzaj = /BLIK/.test(opis) ? 'blik' : 'przelew';
    const i = pierwsza.indexOf(',');
    kontrahent = pierwsza.slice(0, i);
    tytul = pierwsza.slice(i + 1);
  } else {
    tytul = czesci.filter(c => c !== rachunek).join(' ');
  }
  kontrahent = kontrahent
    .replace(/\s+\.\s*$/, '')
    .replace(/\s+(UL\.|AL\.|OS\.|PL\.)\s.*$/i, '')
    .replace(/\s+\d{2}-\d{3}\s.*$/, '')
    .trim();
  tytul = tytul
    .replace(/\/OPF\/.*?\/\.PL\//, '')
    .replace(/\s+\.\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { kontrahent: NAZWA_WIELKIMI(kontrahent), tytul, rodzaj, rodzajOp, rachunek };
}

/** mBank „Lista operacji” (CSV, średniki). Zwraca też numer rachunku i sumy z nagłówka do kontroli. */
function parsujMbank(tekst) {
  const linie = tekst.replace(/^﻿/, '').split(/\r?\n/);
  const iNagl = linie.findIndex(l => /^#Data operacji;/i.test(l.trim()));
  if (iNagl < 0) return null;
  const naglowek = podzielCsv(linie[iNagl].trim()).map(c => c.replace(/^#/, '').trim().toLowerCase());
  const kol = nazwa => naglowek.findIndex(c => c.startsWith(nazwa));
  const k = {
    data: kol('data operacji'), ksieg: kol('data księgowania'), opis: kol('opis operacji'), tytul: kol('tytuł'),
    nadawca: kol('nadawca'), rachunek: kol('numer konta'), kategoria: kol('kategoria'), kwota: kol('kwota'),
  };
  const glowa = linie.slice(0, iNagl).join('\n');
  const iban = (/(\d{26})/.exec(glowa.replace(/ /g, '')) || [])[1] || '';
  const nazwaRachunku = (/#dla rachunków:;\s*\n\s*([^;\n]*)/i.exec(glowa) || [])[1]?.trim() || '';
  const okres = /#Za okres:;\s*\n\s*(\d{2})\.(\d{2})\.(\d{4});(\d{2})\.(\d{2})\.(\d{4})/.exec(glowa);
  const sumy = /#Waluta;#Wpływy;#Wydatki;\s*\n\s*([A-Z]{3});([^;]*);([^;]*);/.exec(glowa);
  const operacje = [];
  for (let i = iNagl + 1; i < linie.length; i++) {
    const l = linie[i].trim();
    if (!l || !/^\d{4}-\d{2}-\d{2};/.test(l)) continue;
    const c = podzielCsv(l);
    const kw = kwotaZTekstu(c[k.kwota]);
    if (!kw) continue;
    const opis = k.opis >= 0 ? c[k.opis] : [c[k.nadawca], c[k.tytul]].filter(Boolean).join(', ');
    const r = rozbierzOpisMbank(opis);
    operacje.push({
      data: c[k.data], data_ksiegowania: k.ksieg >= 0 ? c[k.ksieg] : '', opis: opis.replace(/\s{2,}/g, ' ').trim(),
      kwota: kw.kwota, waluta: kw.waluta || 'PLN', kategoria_banku: k.kategoria >= 0 ? c[k.kategoria] : '',
      ...r, rachunek: r.rachunek || (k.rachunek >= 0 ? String(c[k.rachunek] || '').replace(/\D/g, '') : ''), surowy: l,
    });
  }
  return {
    bank: 'mBank',
    sekcje: [{
      waluta: sumy?.[1] || operacje[0]?.waluta || 'PLN', ibany: iban ? [iban] : [], nazwaRachunku, operacje,
      od: okres ? `${okres[3]}-${okres[2]}-${okres[1]}` : '', do: okres ? `${okres[6]}-${okres[5]}-${okres[4]}` : '',
      kontrola: sumy ? { wplywy: kwotaZTekstu(sumy[2])?.kwota ?? null, wydatki: kwotaZTekstu(sumy[3])?.kwota ?? null } : null,
    }],
  };
}

// ── Revolut (wyciąg po polsku albo po angielsku) ──

const MIESIACE = {
  sty: 1, lut: 2, mar: 3, kwi: 4, maj: 5, cze: 6, lip: 7, sie: 8, wrz: 9, 'paź': 10, paz: 10, lis: 11, gru: 12,
  jan: 1, feb: 2, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const dwie = n => String(n).padStart(2, '0');
/** „4 lis 2026”, „4 listopada 2026”, „Nov 4, 2026”, „November 4, 2026” → 2026-11-04 */
function dataRevolut(s) {
  const t = String(s).trim();
  let m = /^(\d{1,2}) (\p{L}{3})\p{L}* (\d{4})$/u.exec(t);
  if (m && MIESIACE[m[2].toLowerCase()]) return `${m[3]}-${dwie(MIESIACE[m[2].toLowerCase()])}-${dwie(m[1])}`;
  m = /^(\p{L}{3})\p{L}* (\d{1,2}), (\d{4})$/u.exec(t);
  if (m && MIESIACE[m[1].toLowerCase()]) return `${m[3]}-${dwie(MIESIACE[m[1].toLowerCase()])}-${dwie(m[2])}`;
  return '';
}
/** „1 205,03 PLN”, „453,03€” (polski) albo „1,205.03 PLN”, „€325.00” (angielski) → liczba */
const kwotaRevolut = s => {
  const t = String(s ?? '');
  let m = /(-?\d[\d  ]*,\d{2})(?!\d)/.exec(t);
  if (m) return Number(m[1].replace(/[  ]/g, '').replace(',', '.'));
  m = /(-?\d[\d,]*\.\d{2})(?!\d)/.exec(t);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

/** Główny opis i linie szczegółów z Revoluta → kontrahent, tytuł, rodzaj. */
function rozbierzOpisRevolut(glowny, szczegoly, typ = '') {
  const linia = (...prefiksy) => {
    for (const p of prefiksy) { const l = szczegoly.find(x => x.startsWith(p)); if (l) return l.slice(p.length).trim(); }
    return '';
  };
  const ref = linia('Dane referencyjne:', 'Reference:');
  const od = linia('Od:', 'From:');
  const doKogo = linia('Do:', 'To:');
  const iban = (/,\s*([A-Z]{2}\d{2}[A-Z0-9]{10,30})\s*$/.exec(od) || [])[1] || '';
  let kontrahent = glowny, tytul = ref, rodzaj = 'inne', uwaga = '';
  let m;
  if ((m = /^(?:Przelew (?:od|do):|Transfer (?:from|to))\s*(.+)$/i.exec(glowny)) && !/Revolut Digital Assets/i.test(glowny)) { kontrahent = m[1]; rodzaj = 'przelew'; }
  else if ((m = /^(?:Płatność od|Payment from)\s+(.+)$/i.exec(glowny))) { kontrahent = m[1]; rodzaj = 'przelew'; }
  else if (/^Revolut /.test(glowny) && od && !/Digital Assets/i.test(glowny)) { kontrahent = od.replace(/,\s*[A-Z]{2}\d{2}[A-Z0-9]+$/, ''); rodzaj = 'przelew'; }
  else if ((m = /^(?:Zasilenie (?:o|z|karty)?|Top-up by)\s*(\*\d+)/i.exec(glowny)) || /TOPUP/i.test(typ)) {
    kontrahent = `Zasilenie ${m ? m[1] : ''}`.trim(); rodzaj = 'zasilenie';
    uwaga = 'Zasilenie z Twojej karty lub konta – to zwykle przeksięgowanie między Twoimi kontami.';
  } else if (/Revolut Digital Assets/i.test(glowny)) {
    kontrahent = 'Revolut Digital Assets'; rodzaj = 'krypto'; tytul = szczegoly[0] || '';
    uwaga = 'Zakup kryptowalut – możesz go pominąć albo zapisać jako przeksięgowanie na konto inwestycyjne.';
  } else if (szczegoly.some(l => /^(Karta|Card):/.test(l)) || doKogo) { rodzaj = 'karta'; tytul = doKogo; }
  return { kontrahent: NAZWA_WIELKIMI(kontrahent.replace(/\s+\.$/, '').trim()), tytul, rodzaj, rachunek: iban.replace(/\D/g, ''), uwaga };
}

let pdfjsObietnica = null;
function zaladujPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsObietnica) {
    pdfjsObietnica = new Promise((ok, blad) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = () => { pdfjsObietnica = null; blad(new Error('Nie udało się wczytać czytnika PDF (potrzebny internet przy pierwszym użyciu).')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsObietnica;
}

// Słowa z wyciągu w obu językach
const TYTUL_WALUTY = /^(?:Wyciąg ([A-Z]{3})|([A-Z]{3}) Statement)$/;
const SEKCJA_KONTA = /^(?:Transakcje na koncie|Account transactions)\b/i;
const SEKCJA_INNA = /^(?:Transakcje oczekujące|Oczekujące|Pending|Transakcje cofnięte|Cofnięte|Reverted|Zestawienie sald|Balance summary|Zwroty|Refunds)\b/i;
const NAGL_DATA = new Set(['Data', 'Date']);
const NAGL_OPIS = new Set(['Opis', 'Description']);
const NAGL_WYD = new Set(['Wydatki', 'Money out']);
const NAGL_WPL = new Set(['Wpływy', 'Money in']);
const KONTO_BIEZACE = /^(?:Konto \(rachunek bieżący\)|Account \(Current Account\))$/;
const STOPKA = /^(?:Zgłoś kradzież|Report lost or stolen|© \d{4} Revolut)/;

/**
 * Wyciąg Revolut w PDF: osobna część na każdą walutę, tabela Data / Opis / Wydatki / Wpływy / Saldo.
 * Bierzemy tylko „Transakcje na koncie” (Account transactions) – oczekujące i cofnięte pomijamy.
 */
async function parsujRevolutPdf(bufor) {
  const pdfjs = await zaladujPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bufor) }).promise;
  const sekcje = new Map();
  let tekstCaly = '';
  let sekcjaKonta = false;          // czy jesteśmy w części „Transakcje na koncie” (przechodzi na kolejną stronę)
  let walutaPoprzednia = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const strona = await doc.getPage(n);
    const elementy = (await strona.getTextContent()).items
      .filter(i => i.str.trim())
      .map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], h: i.height }));
    tekstCaly += elementy.map(e => e.s).join(' ') + ' ';
    const tytul = elementy.map(e => TYTUL_WALUTY.exec(e.s)).find(Boolean);
    if (!tytul) continue;
    const waluta = tytul[1] || tytul[2];
    if (waluta !== walutaPoprzednia) { sekcjaKonta = false; walutaPoprzednia = waluta; }
    if (!sekcje.has(waluta)) sekcje.set(waluta, { waluta, ibany: [], nazwaRachunku: 'Revolut ' + waluta, operacje: [], od: '', do: '', kontrola: null });
    const sek = sekcje.get(waluta);
    elementy.filter(e => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(e.s)).forEach(e => { if (!sek.ibany.includes(e.s)) sek.ibany.push(e.s); });

    // zestawienie sald (pierwsza strona waluty) – do kontroli sum
    const konto = elementy.find(e => KONTO_BIEZACE.test(e.s));
    if (konto) {
      const wiersz = elementy.filter(e => Math.abs(e.y - konto.y) < 1 && e !== konto).sort((a, b) => a.x - b.x).map(e => kwotaRevolut(e.s));
      if (wiersz.length >= 4 && wiersz.every(v => v != null)) sek.kontrola = { start: wiersz[0], wydatki: -wiersz[1], wplywy: wiersz[2], koniec: wiersz[3] };
    }
    for (const e of elementy.filter(x => SEKCJA_KONTA.test(x.s))) {
      const okres = /od (\d{1,2} \p{L}+ \d{4}) do (\d{1,2} \p{L}+ \d{4})/u.exec(e.s) || /from (\p{L}+ \d{1,2}, \d{4}) to (\p{L}+ \d{1,2}, \d{4})/u.exec(e.s);
      if (okres) { sek.od = sek.od || dataRevolut(okres[1]); sek.do = dataRevolut(okres[2]); }
    }

    // nagłówki części na stronie (duża czcionka) – która część obejmuje który wiersz
    const naglowki = elementy.filter(e => e.h > 10 && (SEKCJA_KONTA.test(e.s) || SEKCJA_INNA.test(e.s))).sort((a, b) => b.y - a.y);
    const czescDla = y => {
      const nad = naglowki.filter(h => h.y > y);
      return nad.length ? SEKCJA_KONTA.test(nad[nad.length - 1].s) : sekcjaKonta;
    };
    // nagłówki tabel (Data | Opis | Wydatki | Wpływy)
    const tabele = elementy.filter(e => NAGL_DATA.has(e.s) && elementy.some(o => NAGL_OPIS.has(o.s) && Math.abs(o.y - e.y) < 1))
      .map(e => {
        const kol = zbior => elementy.find(o => zbior.has(o.s) && Math.abs(o.y - e.y) < 1)?.x;
        return { y: e.y, xOpis: kol(NAGL_OPIS), xWyd: kol(NAGL_WYD), xWpl: kol(NAGL_WPL) };
      }).filter(t => t.xOpis && t.xWyd && t.xWpl).sort((a, b) => b.y - a.y);
    const dol = Math.max(...elementy.filter(e => STOPKA.test(e.s)).map(e => e.y), 0) + 4;
    if (naglowki.length) sekcjaKonta = SEKCJA_KONTA.test(naglowki[naglowki.length - 1].s);

    for (const [ti, tab] of tabele.entries()) {
      // tabela kończy się na następnym nagłówku części albo tabeli
      const granica = Math.max(dol, ...naglowki.filter(h => h.y < tab.y).map(h => h.y + 2), ...tabele.slice(ti + 1).map(t => t.y + 2));
      if (!czescDla(tab.y)) continue;
      const tabela = elementy.filter(e => e.y < tab.y - 1 && e.y > granica);
      const daty = tabela.filter(e => e.x < tab.xOpis - 2 && e.h > 6 && dataRevolut(e.s)).sort((a, b) => b.y - a.y);
      daty.forEach((d, i) => {
        const nastepna = daty[i + 1]?.y ?? granica;
        const blok = tabela.filter(e => e.y <= d.y + 1 && e.y > nastepna + 1 && e !== d);
        const wKolumnie = (od, do_) => blok.filter(e => e.x >= od - 2 && e.x < do_ - 2).sort((a, b) => b.y - a.y);
        const opisy = wKolumnie(tab.xOpis, tab.xWyd);
        const glowny = opisy.find(e => e.h > 6)?.s || '';
        const szczegoly = opisy.filter(e => e.h <= 6).map(e => e.s);
        const wyd = wKolumnie(tab.xWyd, tab.xWpl);
        const wpl = wKolumnie(tab.xWpl, tab.xWpl + 75);
        const kwWyd = kwotaRevolut(wyd.find(e => e.h > 6)?.s);
        const kwWpl = kwotaRevolut(wpl.find(e => e.h > 6)?.s);
        const kwota = kwWyd != null ? -kwWyd : kwWpl;
        if (kwota == null) return;
        const oryginal = [...wyd, ...wpl].find(e => e.h <= 6)?.s || '';
        const r = rozbierzOpisRevolut(glowny, szczegoly);
        const opis = [glowny, ...szczegoly.filter(l => !/^(Karta|Card):/.test(l))].join(' · ') + (oryginal ? ` · ${oryginal}` : '');
        sek.operacje.push({
          data: dataRevolut(d.s), data_ksiegowania: '', opis, kwota, waluta, kategoria_banku: '', rodzajOp: r.rodzaj,
          ...r, tytul: r.tytul || (oryginal ? `oryginalnie ${oryginal}` : ''), surowy: [d.s, glowny, ...szczegoly, kwWyd ?? '', kwWpl ?? '', oryginal].join(' | '),
        });
      });
    }
  }
  if (!/Revolut/.test(tekstCaly)) return null;
  const lista_ = [...sekcje.values()];
  lista_.forEach(s => s.operacje.sort((a, b) => b.data.localeCompare(a.data)));
  return { bank: 'Revolut', sekcje: lista_ };
}

/** Revolut CSV (eksport z aplikacji, nagłówki po angielsku albo po polsku). */
function parsujRevolutCsv(tekst) {
  const linie = tekst.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!linie.length) return null;
  const nagl = podzielCsv(linie[0], ',').map(c => c.trim().toLowerCase());
  const kol = (...nazwy) => nagl.findIndex(c => nazwy.includes(c));
  const k = {
    typ: kol('type', 'typ'), produkt: kol('product', 'produkt'), data: kol('completed date', 'data zakończenia', 'data zakonczenia'),
    start: kol('started date', 'data rozpoczęcia'), opis: kol('description', 'opis'), kwota: kol('amount', 'kwota'),
    oplata: kol('fee', 'opłata', 'oplata'), waluta: kol('currency', 'waluta'), stan: kol('state', 'stan'),
  };
  if (k.opis < 0 || k.kwota < 0 || k.waluta < 0 || (k.data < 0 && k.start < 0)) return null;
  const sekcje = new Map();
  for (const l of linie.slice(1)) {
    const c = podzielCsv(l, ',');
    const stan = String(c[k.stan] ?? '').toUpperCase();
    if (stan && !/COMPLETED|ZAKOŃCZON|ZAKONCZON/.test(stan)) continue;
    const produkt = String(c[k.produkt] ?? '');
    if (produkt && !/current|bieżąc|biezac/i.test(produkt)) continue;
    const waluta = String(c[k.waluta]).trim();
    const kwota = zaokr(Number(c[k.kwota]) - (k.oplata >= 0 ? Number(c[k.oplata]) || 0 : 0));
    if (!isFinite(kwota) || !waluta) continue;
    const data = String(c[k.data] || c[k.start] || '').slice(0, 10);
    const opis = String(c[k.opis] || '').trim();
    const typ = String(c[k.typ] || '');
    if (!sekcje.has(waluta)) sekcje.set(waluta, { waluta, ibany: [], nazwaRachunku: 'Revolut ' + waluta, operacje: [], od: '', do: '', kontrola: null });
    const r = rozbierzOpisRevolut(opis, [], typ);
    if (/EXCHANGE|WYMIANA/i.test(typ)) { r.rodzaj = 'wymiana'; r.uwaga = 'Wymiana walut w Revolucie – zapisz jako przeksięgowanie między kontami Revolut.'; }
    sekcje.get(waluta).operacje.push({ data, data_ksiegowania: '', opis: `${typ} · ${opis}`, kwota, waluta, kategoria_banku: typ, rodzajOp: r.rodzaj, ...r, tytul: r.tytul || '', surowy: l });
  }
  if (!sekcje.size) return null;
  const lista_ = [...sekcje.values()];
  lista_.forEach(s => {
    s.operacje.sort((a, b) => b.data.localeCompare(a.data));
    s.od = s.operacje.at(-1)?.data || ''; s.do = s.operacje[0]?.data || '';
  });
  return { bank: 'Revolut', sekcje: lista_ };
}

const PARSERY = [parsujMbank, parsujRevolutCsv];

function hasz(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ───────────────────────── dopasowanie ─────────────────────────

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();

/** Wpisy ręczne czekające na wyciąg na tym koncie; części podziału liczą się razem. */
function jednostkiDoDopasowania(konto) {
  const wynik = [];
  const podzialy = new Map();
  for (const t of dane.transakcje) {
    if (t.konto !== konto || t.status !== 'oczekuje na wyciąg' || t.odcisk) continue;
    if (t.podzial_id) {
      if (!podzialy.has(t.podzial_id)) podzialy.set(t.podzial_id, []);
      podzialy.get(t.podzial_id).push(t);
    } else wynik.push({ id: t.id, wiersze: [t], kwota: Number(t.kwota) || 0, wplyw: WPLYWOWE.has(t.typ), data: t.data_operacji, t });
  }
  for (const [id, cz] of podzialy) {
    wynik.push({ id: 'p:' + id, wiersze: cz, kwota: zaokr(cz.reduce((s, c) => s + (Number(c.kwota) || 0), 0)), wplyw: WPLYWOWE.has(cz[0].typ), data: cz[0].data_operacji, t: cz[0] });
  }
  return wynik;
}

function opisJednostki(j) {
  const t = j.t;
  const nazwa = t.kontrahent || (czyPrzeks(t) ? 'Przeksięgowanie' : '') || t.kategoria || t.zrodlo_przychodu || t.typ;
  return `${nazwa}${j.wiersze.length > 1 ? ` (podział na ${j.wiersze.length})` : ''} · ${kwotaTxt(j.kwota, t.waluta)} · ${dataKrotko(j.data)}`;
}

function kandydaci(op, jednostki) {
  const tekst = norm(op.opis);
  return jednostki
    .filter(j => j.wplyw === op.kwota > 0 && Math.abs(j.kwota - Math.abs(op.kwota)) < 0.005)
    .map(j => {
      const dni = roznicaDni(op.data, j.data);           // dodatnie: wpis ręczny wcześniej niż wyciąg
      if (dni < -5 || dni > 20) return null;
      const nazwa = norm(j.t.kontrahent);
      const slowa = nazwa.split(' ').filter(w => w.length > 2);
      const zgodnaNazwa = slowa.length && slowa.some(w => tekst.includes(w));
      return { j, wynik: Math.abs(dni) + (zgodnaNazwa ? 0 : 4) };
    })
    .filter(Boolean)
    .sort((a, b) => a.wynik - b.wynik);
}

// ───────────────────────── podpowiedzi kategorii ─────────────────────────

function podpowiedzKategorii(op) {
  const typ = op.kwota > 0 ? 'wpływ' : 'wydatek';
  const listaKat = typ === 'wpływ' ? 'zrodla_przychodu' : 'kategorie_kosztow';
  // 1) reguły ze Słownika (np. InPost → Wysyłki)
  const tekst = norm(op.opis);
  for (const r of lista('reguly_kategorii')) {
    const a = atrybuty(r);
    const szukaj = norm(a.tekst || r.nazwa);
    if (!szukaj || !tekst.includes(szukaj)) continue;
    const kat = dane.slownik.find(x => x.lista === listaKat && x.id === r.rodzic);
    if (!kat) continue;
    const pod = podrzedne(typ, kat.nazwa).find(p => norm(p.nazwa) === szukaj || norm(p.nazwa) === norm(a.kontrahent));
    return { kategoria: kat.nazwa, podkategoria: pod?.nazwa || '', zrodlo: 'reguła' };
  }
  // 2) wcześniejsze transakcje z tym samym kontrahentem
  const k = norm(op.kontrahent);
  if (k) {
    const licz = new Map();
    for (const t of dane.transakcje) {
      if (t.status === 'anulowana' || norm(t.kontrahent) !== k) continue;
      const kat = typ === 'wpływ' ? t.zrodlo_przychodu : t.kategoria;
      if (!kat || (typ === 'wpływ') !== (t.typ === 'wpływ')) continue;
      const klucz = kat + '||' + (t.podkategoria || '');
      licz.set(klucz, (licz.get(klucz) || 0) + 1);
    }
    const naj = [...licz.entries()].sort((a, b) => b[1] - a[1])[0];
    if (naj) { const [kategoria, podkategoria] = naj[0].split('||'); return { kategoria, podkategoria, zrodlo: 'historia' }; }
  }
  return { kategoria: '', podkategoria: '', zrodlo: '' };
}

const normIban = s => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const ibanyKonta = k => {
  const a = atrybuty(dane.slownik.find(s => s.lista === 'konta' && s.nazwa === k.nazwa));
  return [a.iban, a.iban2].map(normIban).filter(x => x.length >= 10);
};
const zgodneIbany = (a, b) => {
  const x = normIban(a).replace(/^[A-Z]{2}(?=\d{2})/, ''), y = normIban(b).replace(/^[A-Z]{2}(?=\d{2})/, '');
  return x.length >= 10 && y.length >= 10 && (x.endsWith(y) || y.endsWith(x));
};
/** Konto aplikacji dla części wyciągu: ten sam numer rachunku i ta sama waluta (Revolut ma jeden IBAN dla wszystkich walut). */
function kontoSekcji(sek) {
  const pasujace = konta().filter(k => !k.wirtualne && ibanyKonta(k).some(i => sek.ibany.some(j => zgodneIbany(i, j))));
  return pasujace.find(k => k.waluta === sek.waluta) || (pasujace.length === 1 && !pasujace[0].waluta ? pasujace[0] : null);
}

// ───────────────────────── stan ekranu ─────────────────────────

let imp = null;   // { plikNazwa, bank, sekcje, zrobione, p: bieżąca część (waluta), konto, wiersze }
const widok = { filtr: 'wszystkie', zaznaczone: new Set() };

function przygotuj(plikNazwa, p, konto) {
  const pominiete = new Set(dane.importy.flatMap(i => {
    try { return JSON.parse(i.odciski_pominiete || '[]'); } catch { return []; }
  }));
  const znane = new Set(dane.transakcje.filter(t => t.odcisk && t.status !== 'anulowana').map(t => t.odcisk));
  // Druga zapora przed duplikatami: operacje już zaimportowane na to konto liczone po dacie i kwocie
  // (łapie np. ten sam miesiąc wczytany raz z PDF, a raz z CSV, albo zmieniony opis w banku).
  const wgOdcisku = new Map();
  dane.transakcje.filter(t => t.odcisk && t.status !== 'anulowana' && t.konto === konto).forEach(t => {
    const e = wgOdcisku.get(t.odcisk) || { data: t.data_ksiegowania || t.data_operacji, kwota: 0 };
    e.kwota += (kierunek(t) === 'wpływ' ? 1 : -1) * (Number(t.kwota) || 0);
    wgOdcisku.set(t.odcisk, e);
  });
  const zajeteDataKwota = new Map();
  wgOdcisku.forEach((e, odc) => {
    const k = `${e.data}|${zaokr(e.kwota).toFixed(2)}`;
    zajeteDataKwota.set(k, (zajeteDataKwota.get(k) || 0) + 1);
  });
  const jednostki = jednostkiDoDopasowania(konto);
  const powtorzenia = new Map();
  const wiersze = p.operacje.map((op, i) => {
    const baza = `${konto}|${op.data}|${op.kwota.toFixed(2)}|${hasz(norm(op.opis))}`;
    const n = (powtorzenia.get(baza) || 0) + 1;
    powtorzenia.set(baza, n);
    const odcisk = `${baza}|${n}`;
    const w = { i, op, odcisk, stan: 'nowa', typ: op.kwota > 0 ? 'wpływ' : 'wydatek', kategoria: '', podkategoria: '', podmiot: podmiotKonta(konto) || '', konto2: '', kontrahent: op.kontrahent, podpowiedz: '' };
    const kDK = `${op.data}|${op.kwota.toFixed(2)}`;
    if (znane.has(odcisk)) { w.stan = 'juz'; zajeteDataKwota.set(kDK, (zajeteDataKwota.get(kDK) || 0) - 1); return w; }
    if (pominiete.has(odcisk)) { w.stan = 'pomin'; w.wczesniejPominieta = true; return w; }
    // przelew z / na własne konto zapisane w aplikacji
    const wlasne = op.rachunek && konta().find(k => k.nazwa !== konto && ibanyKonta(k).some(i => zgodneIbany(i, op.rachunek)));
    if (wlasne) { w.typ = 'przeks'; w.konto2 = wlasne.nazwa; }
    const pk = podpowiedzKategorii(op);
    Object.assign(w, { kategoria: pk.kategoria, podkategoria: pk.podkategoria, podpowiedz: pk.zrodlo });
    if (/przelew własny|spłata karty/i.test(op.kategoria_banku) && !wlasne) w.uwaga = `Bank: „${op.kategoria_banku}” – to może być przeksięgowanie między Twoimi kontami.`;
    if (op.uwaga && !wlasne) w.uwaga = op.uwaga;
    if (op.rodzaj === 'wymiana') {
      const druga = /(?:to|na)\s+([A-Z]{3})\b/.exec(op.opis)?.[1];
      const k2 = druga && konta().find(k => k.nazwa !== konto && k.waluta === druga && /revolut/i.test(k.nazwa));
      w.typ = 'przeks'; w.konto2 = k2?.nazwa || '';
    }
    return w;
  });

  wiersze.forEach(w => {
    if (w.stan !== 'nowa') return;
    const kDK = `${w.op.data}|${w.op.kwota.toFixed(2)}`;
    if ((zajeteDataKwota.get(kDK) || 0) > 0) {
      zajeteDataKwota.set(kDK, zajeteDataKwota.get(kDK) - 1);
      w.stan = 'pomin';
      w.duplikat = true;
    }
  });

  // propozycje dopasowań: najlepsze pary jako pierwsze, każdy wpis ręczny tylko raz
  const pary = [];
  wiersze.forEach(w => {
    if (w.stan !== 'nowa') return;
    w.kandydaci = kandydaci(w.op, jednostki);
    w.kandydaci.forEach(k => pary.push({ w, ...k }));
  });
  pary.sort((a, b) => a.wynik - b.wynik);
  const uzyte = new Set();
  pary.forEach(({ w, j }) => {
    if (w.stan !== 'nowa' || uzyte.has(j.id)) return;
    w.stan = 'propozycja';
    w.jednostka = j;
    uzyte.add(j.id);
  });
  Object.assign(imp, { plikNazwa, p, konto, wiersze, jednostki, domyslnyPodmiot: podmiotKonta(konto) || '' });
  widok.zaznaczone.clear();
  widok.filtr = 'wszystkie';
}

const zajete = () => new Set(imp.wiersze.filter(w => (w.stan === 'propozycja' || w.stan === 'dopasowana') && w.jednostka).map(w => w.jednostka.id));

// ───────────────────────── widok ─────────────────────────

function opcjeKategorii(w) {
  const typ = w.typ === 'wpływ' ? 'wpływ' : 'wydatek';
  const wartosc = w.kategoria ? `${w.kategoria}||${w.podkategoria || ''}` : '';
  return `<option value="">— kategoria —</option>${glowne(typ).map(k => {
    const pod = podrzedne(typ, k.nazwa);
    return `<option value="${esc(k.nazwa)}||" ${wartosc === k.nazwa + '||' ? 'selected' : ''}>${esc(k.nazwa)}</option>${pod.map(p =>
      `<option value="${esc(k.nazwa)}||${esc(p.nazwa)}" ${wartosc === `${k.nazwa}||${p.nazwa}` ? 'selected' : ''}>&nbsp;&nbsp;↳ ${esc(p.nazwa)}</option>`).join('')}`;
  }).join('')}<option value="__nowa__">＋ Nowa kategoria lub podkategoria…</option>`;
}

function htmlDecyzji(w) {
  const i = w.i;
  if (w.stan === 'juz') return '<span class="znacznik">już w aplikacji</span>';
  if (w.stan === 'pomin') return `<span class="znacznik">${w.duplikat ? 'prawdopodobnie już w aplikacji – ta sama data i kwota na tym koncie' : w.wczesniejPominieta ? 'pominięta przy poprzednim imporcie' : 'pominięta'}</span>
    <button type="button" class="przycisk-maly drugorzedny" data-akcja="przywroc" data-i="${i}">Przywróć</button>`;
  if (w.stan === 'propozycja' || w.stan === 'dopasowana') {
    const inni = (w.kandydaci || []).filter(k => k.j.id !== w.jednostka.id && !zajete().has(k.j.id));
    return `<div class="dopasowanie ${w.stan}">
      <span>${w.stan === 'dopasowana' ? '✓ Połączona z wpisem' : 'Pasuje do wpisu'}: <b>${esc(opisJednostki(w.jednostka))}</b></span>
      <span class="przyciski-dopasowania">
        ${w.stan === 'propozycja' ? `<button type="button" class="przycisk-maly" data-akcja="zatwierdz" data-i="${i}">Zatwierdź</button>` : ''}
        ${inni.length ? `<select data-pole="inny" data-i="${i}" aria-label="Inny wpis"><option value="">inny wpis (${inni.length})…</option>${inni.map(k =>
          `<option value="${esc(k.j.id)}">${esc(opisJednostki(k.j))}</option>`).join('')}</select>` : ''}
        <button type="button" class="przycisk-maly drugorzedny" data-akcja="odrzuc" data-i="${i}">${w.stan === 'dopasowana' ? 'Rozłącz' : 'To nie to'}</button>
      </span></div>`;
  }
  // nowa
  const wolni = (w.kandydaci || []).filter(k => !zajete().has(k.j.id));
  return `<div class="nowa-z-wyciagu">
    <select data-pole="typ" data-i="${i}" aria-label="Rodzaj">
      <option value="${w.op.kwota > 0 ? 'wpływ' : 'wydatek'}" ${w.typ !== 'przeks' ? 'selected' : ''}>${w.op.kwota > 0 ? 'Wpływ' : 'Wydatek'}</option>
      <option value="przeks" ${w.typ === 'przeks' ? 'selected' : ''}>Przeksięgowanie</option>
    </select>
    ${w.typ === 'przeks'
      ? `<select data-pole="konto2" data-i="${i}" aria-label="Drugie konto"><option value="">— ${w.op.kwota > 0 ? 'z konta' : 'na konto'} —</option>${konta().filter(k => k.nazwa !== imp.konto).map(k =>
          `<option ${k.nazwa === w.konto2 ? 'selected' : ''}>${esc(k.nazwa)}</option>`).join('')}</select>`
      : `<select data-pole="kategoria" data-i="${i}" aria-label="Kategoria" class="${w.kategoria ? '' : 'brak'}">${opcjeKategorii(w)}</select>
         <select data-pole="podmiot" data-i="${i}" aria-label="Podmiot"><option value="">— podmiot —</option>${podmioty().map(p =>
          `<option ${p === w.podmiot ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`}
    <button type="button" class="przycisk-maly drugorzedny" data-akcja="pomin" data-i="${i}">Pomiń</button>
    ${wolni.length ? `<select data-pole="inny" data-i="${i}" aria-label="Połącz z wpisem"><option value="">połącz z wpisem (${wolni.length})…</option>${wolni.map(k =>
      `<option value="${esc(k.j.id)}">${esc(opisJednostki(k.j))}</option>`).join('')}</select>` : ''}
    ${w.podpowiedz ? `<span class="podpowiedz">${w.podpowiedz === 'reguła' ? 'kategoria z reguły' : 'kategoria jak poprzednio u tego kontrahenta'}</span>` : ''}
    ${w.uwaga ? `<span class="podpowiedz uwaga">${esc(w.uwaga)}</span>` : ''}
  </div>`;
}

function htmlWiersza(w) {
  const op = w.op;
  const wyl = w.stan === 'juz';
  return `<li class="wiersz-importu stan-${w.stan}" data-i="${w.i}">
    <label class="wybor">${wyl ? '' : `<input type="checkbox" data-akcja="zaznacz" data-i="${w.i}" ${widok.zaznaczone.has(w.i) ? 'checked' : ''} aria-label="Zaznacz">`}</label>
    <div class="opis-importu">
      <div class="gora-importu"><span class="data-importu">${esc(dataKrotko(op.data))}</span>
        <b>${esc(w.kontrahent || op.tytul || op.opis.slice(0, 60))}</b>
        <span class="kwota-importu ${op.kwota > 0 ? 'plus' : 'minus'}">${op.kwota > 0 ? '+' : '−'}${esc(kwotaTxt(Math.abs(op.kwota), op.waluta))}</span></div>
      <div class="szczegoly-importu">${esc([op.kontrahent ? op.tytul : '', op.kategoria_banku ? `bank: ${op.kategoria_banku}` : ''].filter(Boolean).join(' · '))}</div>
      <div class="decyzja">${htmlDecyzji(w)}</div>
    </div>
  </li>`;
}

const FILTRY = [['wszystkie', 'Wszystkie'], ['propozycja', 'Do zatwierdzenia'], ['nowa', 'Nowe'], ['bez-kategorii', 'Bez kategorii'], ['dopasowana', 'Połączone'], ['pomin', 'Pominięte'], ['juz', 'Już w aplikacji']];

function pasujeFiltr(w) {
  if (widok.filtr === 'wszystkie') return true;
  if (widok.filtr === 'bez-kategorii') return w.stan === 'nowa' && w.typ !== 'przeks' && !w.kategoria;
  return w.stan === widok.filtr;
}

function liczniki() {
  const l = { propozycja: 0, nowa: 0, dopasowana: 0, pomin: 0, juz: 0, 'bez-kategorii': 0 };
  imp.wiersze.forEach(w => { l[w.stan]++; if (w.stan === 'nowa' && w.typ !== 'przeks' && !w.kategoria) l['bez-kategorii']++; });
  return l;
}

function renderStart() {
  const ostatnie = [...dane.importy].sort((a, b) => String(b.utworzono || b.data).localeCompare(String(a.utworzono || a.data))).slice(0, 12);
  $('#widok').innerHTML = `
  <section class="ekran import-ekran">
    <div class="naglowek-sekcji"><h1>Import wyciągu</h1></div>
    <div class="karta-ustawien">
      <h2>Wybierz plik z banku</h2>
      <ul class="banki-importu">
        <li><b>mBank</b> – Historia operacji → ustaw okres (np. cały miesiąc) → pobierz listę operacji jako <b>CSV</b>.</li>
        <li><b>Revolut</b> – wyciąg miesięczny w <b>PDF</b> (wszystkie waluty w jednym pliku) albo eksport <b>CSV</b>. Trzymaj się jednego formatu, żeby operacje się nie zdublowały.</li>
      </ul>
      <label class="pole"><span class="etykieta">Plik z banku (CSV lub PDF)</span><input type="file" name="plik-importu" accept=".csv,.pdf,text/csv,text/plain,application/pdf"></label>
      <p class="podpowiedz">Najpierw dopiszesz w aplikacji wpisy ręczne, a import je potwierdzi. Operacje, których nie ma w aplikacji, dodasz stąd z kategorią. Ten sam plik można wczytać ponownie – nic się nie zdubluje.</p>
    </div>
    ${ostatnie.length ? `<div class="karta-ustawien"><h2>Ostatnie importy</h2>
      <table class="tabela"><thead><tr><th>Kiedy</th><th>Konto</th><th>Okres</th><th class="liczba">Połączone</th><th class="liczba">Dodane</th><th class="liczba">Pominięte</th></tr></thead>
      <tbody>${ostatnie.map(i => `<tr class="${czyWycofany(i) ? 'wycofany' : ''}"><td><a href="#import/${encodeURIComponent(i.partia)}">${esc(dataKrotko(String(i.data || i.utworzono).slice(0, 10)))}</a>${czyWycofany(i) ? ' <span class="znacznik anul">wycofany</span>' : ''}</td><td><a href="#import/${encodeURIComponent(i.partia)}">${esc(i.konto)}</a></td>
        <td>${i.okres_od ? esc(`${dataKrotko(String(i.okres_od).slice(0, 10))} – ${dataKrotko(String(i.okres_do).slice(0, 10))}`) : ''}</td>
        <td class="liczba">${esc(i.dopasowanych ?? '')}</td><td class="liczba">${esc(i.dodanych ?? '')}</td><td class="liczba">${esc(i.pominietych ?? '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </section>`;
}

function renderKonto() {
  const p = imp.p;
  const iban = p.ibany[0] || '';
  const wWalucie = konta().filter(k => !k.wirtualne && (!k.waluta || k.waluta === p.waluta));
  const pozostale = konta().filter(k => !k.wirtualne && !wWalucie.includes(k));
  const chip = k => `<button type="button" class="chip konto-chip" style="--k:${esc(k.kolor)}" data-akcja="wybierz-konto" data-v="${esc(k.nazwa)}">${esc(k.nazwa)}</button>`;
  $('#widok').innerHTML = `
  <section class="ekran import-ekran">
    <div class="naglowek-sekcji"><h1>Import wyciągu</h1></div>
    <form class="karta-ustawien" data-forma="konto-importu">
      <h2>Którego konta dotyczy ten wyciąg?</h2>
      <p>${esc(imp.bank)}: <b>${esc(p.nazwaRachunku || 'rachunek')}</b>${iban ? ` (…${esc(iban.slice(-4))})` : ''}, waluta ${esc(p.waluta)}, ${p.operacje.length} ${odmiana(p.operacje.length, 'operacja', 'operacje', 'operacji')}.</p>
      <div class="chipy">${wWalucie.map(chip).join('')}</div>
      ${pozostale.length ? `<details class="wiecej"><summary>Konta w innych walutach</summary><div class="chipy">${pozostale.map(chip).join('')}</div></details>` : ''}
      <p class="podpowiedz">Zapamiętam numer rachunku przy wybranym koncie – następnym razem konto wybierze się samo.</p>
      <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="anuluj-import">Anuluj</button></div>
    </form>
  </section>`;
}

function renderPrzeglad() {
  const p = imp.p;
  const l = liczniki();
  const wplywy = zaokr(p.operacje.filter(o => o.kwota > 0).reduce((s, o) => s + o.kwota, 0));
  const wydatki = zaokr(p.operacje.filter(o => o.kwota < 0).reduce((s, o) => s + o.kwota, 0));
  const zgodne = p.kontrola && Math.abs((p.kontrola.wplywy ?? wplywy) - wplywy) < 0.01 && Math.abs((p.kontrola.wydatki ?? wydatki) - wydatki) < 0.01;
  const doZapisu = l.dopasowana + l.nowa + imp.wiersze.filter(w => w.stan === 'pomin' && !w.wczesniejPominieta).length;
  const lista_ = imp.wiersze.filter(pasujeFiltr);
  const zazn = widok.zaznaczone.size;
  $('#widok').innerHTML = `
  <section class="ekran import-ekran">
    <div class="naglowek-sekcji"><h1>Import wyciągu</h1><span class="okres-tytul">${esc(imp.konto)}</span>
      ${imp.sekcje.length > 1 ? '<button type="button" class="przycisk-maly drugorzedny akcja-naglowka" data-akcja="do-sekcji">Inne waluty</button>' : ''}
      <button type="button" class="przycisk-maly drugorzedny akcja-naglowka" data-akcja="anuluj-import">Inny plik</button></div>
    <div class="kafle-wskaznikow">
      <div class="wskaznik"><span class="etykieta-wsk">Plik</span><b>${p.operacje.length}</b><span class="zmiana">${esc(p.od ? `${dataKrotko(p.od)} – ${dataKrotko(p.do)} ${p.do.slice(0, 4)}` : imp.plikNazwa)}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Wpływy / wydatki</span><b class="mniejsze">+${esc(kwotaTxt(wplywy, p.waluta))}<br>−${esc(kwotaTxt(Math.abs(wydatki), p.waluta))}</b><span class="zmiana">${p.kontrola ? (zgodne ? '✓ zgodne z sumami banku' : '⚠ nie zgadza się z sumami banku') : ''}${p.kontrola?.koniec != null ? ` · saldo końcowe ${esc(kwotaTxt(p.kontrola.koniec, p.waluta))}` : ''}</span></div>
      <div class="wskaznik ${l.propozycja ? 'wyroznione' : ''}"><span class="etykieta-wsk">Do zatwierdzenia</span><b>${l.propozycja}</b><span class="zmiana">połączone: ${l.dopasowana}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Nowe</span><b>${l.nowa}</b><span class="zmiana">${l['bez-kategorii']} bez kategorii · już w aplikacji: ${l.juz}</span></div>
    </div>
    <div class="podmiot-importu ${imp.domyslnyPodmiot ? '' : 'brak'}">
      <label><span class="etykieta">Podmiot dla operacji z tego konta</span>
        <select data-pole="domyslny-podmiot"><option value="">— wybierz —</option>${podmioty().map(p => `<option ${p === imp.domyslnyPodmiot ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
      <span class="podpowiedz">${imp.domyslnyPodmiot
        ? (imp.domyslnyPodmiot === podmiotKonta(imp.konto) ? `domyślny podmiot konta ${esc(imp.konto)} – pojedyncze operacje zmienisz w wierszach` : `<button type="button" class="link" data-akcja="zapamietaj-podmiot">Ustaw „${esc(imp.domyslnyPodmiot)}” jako domyślny dla konta ${esc(imp.konto)}</button>`)
        : `konto ${esc(imp.konto)} nie ma domyślnego podmiotu – wybierz, a ustawi się we wszystkich nowych operacjach`}</span>
    </div>
    <div class="pasek-filtrow">
      <div class="chipy male" role="group" aria-label="Pokaż">${FILTRY.map(([v, e]) =>
        `<button type="button" class="chip" data-akcja="filtr" data-v="${v}" aria-pressed="${widok.filtr === v}">${e}${v !== 'wszystkie' && l[v] !== undefined ? ` <span class="licznik-chipa">${l[v]}</span>` : ''}</button>`).join('')}</div>
      ${l.propozycja ? `<button type="button" class="przycisk-maly" data-akcja="zatwierdz-wszystkie">Zatwierdź wszystkie propozycje (${l.propozycja})</button>` : ''}
    </div>
    ${zazn ? `<div class="pasek-masowy">
      <span><b>${zazn}</b> zaznaczone</span>
      <select data-pole="m-kategoria-wydatek" aria-label="Kategoria wydatków"><option value="">kategoria wydatków…</option>${opcjeKategorii({ typ: 'wydatek' })}</select>
      <select data-pole="m-kategoria-wplyw" aria-label="Źródło wpływów"><option value="">źródło wpływów…</option>${opcjeKategorii({ typ: 'wpływ' })}</select>
      <select data-pole="m-podmiot" aria-label="Podmiot"><option value="">podmiot…</option>${podmioty().map(p => `<option>${esc(p)}</option>`).join('')}</select>
      <button type="button" class="przycisk-maly drugorzedny" data-akcja="m-pomin">Pomiń</button>
      <button type="button" class="przycisk-maly drugorzedny" data-akcja="m-przywroc">Jako nowe</button>
      <button type="button" class="przycisk-maly drugorzedny" data-akcja="m-odznacz">Odznacz</button>
    </div>` : ''}
    <div class="naglowek-listy-importu"><label><input type="checkbox" data-akcja="zaznacz-wszystkie" ${lista_.length && lista_.every(w => w.stan === 'juz' || widok.zaznaczone.has(w.i)) ? 'checked' : ''}> zaznacz widoczne</label>
      <span>${lista_.length} ${odmiana(lista_.length, 'operacja', 'operacje', 'operacji')}</span></div>
    <ul class="lista-importu">${lista_.map(htmlWiersza).join('') || '<li class="pusto">Brak operacji w tym widoku.</li>'}</ul>
    <div class="pasek-zapisu-importu">
      <span>${l.propozycja ? `Najpierw zatwierdź albo odrzuć ${l.propozycja} ${odmiana(l.propozycja, 'propozycję', 'propozycje', 'propozycji')}.` : `${l.dopasowana} do potwierdzenia, ${l.nowa} nowych${l['bez-kategorii'] ? ` (${l['bez-kategorii']} bez kategorii)` : ''}.`}</span>
      <button type="button" data-akcja="zapisz-import" ${l.propozycja || !doZapisu ? 'disabled' : ''}>Zapisz import</button>
    </div>
  </section>`;
}

function renderSekcje() {
  $('#widok').innerHTML = `
  <section class="ekran import-ekran">
    <div class="naglowek-sekcji"><h1>Import wyciągu</h1><span class="okres-tytul">${esc(imp.bank)}</span>
      <button type="button" class="przycisk-maly drugorzedny akcja-naglowka" data-akcja="anuluj-import">Inny plik</button></div>
    <p class="uwagi-podsumowania">Plik „${esc(imp.plikNazwa)}” zawiera wyciągi w ${imp.sekcje.length} ${odmiana(imp.sekcje.length, 'walucie', 'walutach', 'walutach')}. Każdą walutę importujesz na osobne konto.</p>
    <ul class="lista-sekcji">${imp.sekcje.map((s, i) => {
      const k = kontoSekcji(s);
      const zrobione = imp.zrobione.has(i);
      const kontrola = s.kontrola ? `saldo ${kwotaTxt(s.kontrola.start ?? 0, s.waluta)} → ${kwotaTxt(s.kontrola.koniec ?? 0, s.waluta)}` : '';
      return `<li class="sekcja-wyciagu ${s.operacje.length ? '' : 'pusta'} ${zrobione ? 'zrobiona' : ''}">
        <b class="waluta-sekcji">${esc(s.waluta)}</b>
        <span class="opis-sekcji"><span>${s.operacje.length ? `${s.operacje.length} ${odmiana(s.operacje.length, 'operacja', 'operacje', 'operacji')}` : 'bez operacji'}${s.od ? ` · ${esc(dataKrotko(s.od))} – ${esc(dataKrotko(s.do))}` : ''}</span>
          <span class="podpowiedz">${[k ? `konto: <b>${esc(k.nazwa)}</b>` : (s.operacje.length ? 'konto do wybrania' : ''), kontrola ? esc(kontrola) : ''].filter(Boolean).join(' · ')}</span></span>
        ${s.operacje.length ? `<button type="button" class="przycisk-maly ${zrobione ? 'drugorzedny' : ''}" data-akcja="sekcja" data-v="${i}">${zrobione ? '✓ Zaimportowano – otwórz' : 'Importuj'}</button>` : ''}
      </li>`;
    }).join('')}</ul>
  </section>`;
}

const czyWycofany = i => i.wycofana === true || String(i.wycofana).toUpperCase() === 'TRUE';

// ───────────────────────── podgląd i edycja zapisanego importu (#import/<partia>) ─────────────────────────

function wierszePartii(partia) {
  const glowne_ = dane.transakcje.filter(t => t.partia_importu === partia);
  const pary = new Set(glowne_.filter(t => t.id_pary && t.zrodlo === 'import').map(t => t.id_pary));
  const drugie = dane.transakcje.filter(t => pary.has(t.id_pary) && !t.partia_importu);
  return { glowne_, drugie };
}

function renderPartia(partia) {
  const i = dane.importy.find(x => String(x.partia) === partia);
  if (!i) { $('#widok').innerHTML = '<section class="ekran"><p class="pusto">Nie ma takiego importu na tym urządzeniu.</p><a href="#import">Import wyciągu</a></section>'; return; }
  const { glowne_ } = wierszePartii(partia);
  const lista_ = [...glowne_].sort((a, b) => String(b.data_ksiegowania || b.data_operacji).localeCompare(String(a.data_ksiegowania || a.data_operacji)));
  const wycofany = czyWycofany(i);
  const opcjeKat = t => {
    const typ = t.typ === 'wpływ' ? 'wpływ' : 'wydatek';
    const w = typ === 'wpływ' ? `${t.zrodlo_przychodu || ''}||` : `${t.kategoria || ''}||${t.podkategoria || ''}`;
    return opcjeKategorii({ typ, kategoria: typ === 'wpływ' ? t.zrodlo_przychodu : t.kategoria, podkategoria: typ === 'wpływ' ? '' : t.podkategoria }).replace('<option value="__nowa__">', `<option value="__nowa__" data-w="${esc(w)}">`);
  };
  $('#widok').innerHTML = `
  <section class="ekran import-ekran">
    <a class="wstecz" href="#import">Import wyciągu</a>
    <div class="naglowek-sekcji"><h1>Import ${esc(dataKrotko(String(i.data || '').slice(0, 10)))}</h1><span class="okres-tytul">${esc(i.konto)}</span></div>
    <div class="karta-ustawien">
      <dl class="info">
        <div><dt>Plik</dt><dd>${esc(i.nazwa_pliku || '')}</dd></div>
        <div><dt>Okres</dt><dd>${esc(i.okres_od ? `${String(i.okres_od).slice(0, 10)} – ${String(i.okres_do).slice(0, 10)}` : '')}</dd></div>
        <div><dt>Operacji w pliku</dt><dd>${esc(i.wierszy_w_pliku ?? '')}</dd></div>
        <div><dt>Połączone z wpisami ręcznymi / dodane / pominięte</dt><dd>${esc(i.dopasowanych ?? 0)} / ${esc(i.dodanych ?? 0)} / ${esc(i.pominietych ?? 0)}</dd></div>
        <div><dt>Kto i kiedy</dt><dd>${esc(i.kto || '')} · ${esc(String(i.utworzono || '').replace('T', ' ').slice(0, 16))}</dd></div>
      </dl>
      ${wycofany ? '<p class="komunikat blad">Ten import został wycofany – jego operacje są anulowane, a wpisy ręczne wróciły do „czeka na wyciąg”. Plik można wczytać ponownie.</p>' : `
      <div class="przyciski"><button type="button" class="niebezpieczny" data-akcja="wycofaj-import" data-v="${esc(partia)}">Wycofaj cały import</button></div>
      <p class="podpowiedz">Wycofanie anuluje dodane operacje i ich rozliczenia, a połączone wpisy ręczne wracają do „czeka na wyciąg”. Potem możesz wczytać plik jeszcze raz.</p>`}
    </div>
    <div class="naglowek-listy-importu"><b>Operacje z tego importu (${lista_.length})</b><span>kategorię i podmiot zmienisz od razu tutaj, resztę – w transakcji</span></div>
    <ul class="lista-importu">${lista_.map(t => {
      const wplyw = ['wpływ', 'przeksięgowanie-wpływ', 'pożyczka-otrzymana', 'spłata-otrzymana'].includes(t.typ);
      const edytowalna = t.status !== 'anulowana' && (t.typ === 'wpływ' || t.typ === 'wydatek');
      return `<li class="wiersz-importu ${t.status === 'anulowana' ? 'stan-juz' : ''}">
        <span></span>
        <div class="opis-importu">
          <div class="gora-importu"><span class="data-importu">${esc(dataKrotko(t.data_ksiegowania || t.data_operacji))}</span>
            <b><a href="#edytuj/${encodeURIComponent(t.id)}">${esc(t.kontrahent || t.opis || t.typ)}</a></b>
            <span class="kwota-importu ${wplyw ? 'plus' : 'minus'}">${wplyw ? '+' : '−'}${esc(kwotaTxt(Number(t.kwota) || 0, t.waluta))}</span></div>
          <div class="szczegoly-importu">${esc([t.zrodlo === 'import' ? 'dodana z wyciągu' : 'wpis ręczny potwierdzony wyciągiem', t.opis && t.opis !== t.kontrahent ? t.opis : '', t.status === 'anulowana' ? 'anulowana' : ''].filter(Boolean).join(' · '))}</div>
          ${edytowalna ? `<div class="decyzja nowa-z-wyciagu">
            <select data-pole="p-kategoria" data-id="${esc(t.id)}" aria-label="Kategoria">${opcjeKat(t)}</select>
            <select data-pole="p-podmiot" data-id="${esc(t.id)}" aria-label="Podmiot"><option value="">— podmiot —</option>${podmioty().map(p => `<option ${p === t.podmiot ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
          </div>` : ''}
          ${t.surowy_wiersz ? `<details class="surowy"><summary>wiersz z pliku banku</summary><code>${esc(t.surowy_wiersz)}</code></details>` : ''}
        </div>
      </li>`;
    }).join('') || '<li class="pusto">Brak operacji.</li>'}</ul>
  </section>`;
}

async function wycofajImport(partia) {
  const i = dane.importy.find(x => String(x.partia) === partia);
  const { glowne_, drugie } = wierszePartii(partia);
  const tak = await okno('Wycofać cały import?', `<p>Operacje dodane z wyciągu (${glowne_.filter(t => t.zrodlo === 'import').length}) zostaną anulowane, a wpisy ręczne (${glowne_.filter(t => t.zrodlo !== 'import').length}) wrócą do „czeka na wyciąg”. Rozliczenia tych wpływów z paragonami też zostaną cofnięte.</p>`,
    [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Wycofaj import', wartosc: true, klasa: 'niebezpieczny' }]);
  if (!tak) return;
  const anulowane = new Set();
  const transakcje = [];
  glowne_.forEach(t => {
    if (t.zrodlo === 'import') { transakcje.push({ ...t, status: 'anulowana' }); anulowane.add(t.id); }
    else transakcje.push({ ...t, status: statusDlaKonta(t.konto), odcisk: '', partia_importu: '', data_ksiegowania: '', surowy_wiersz: '' });
  });
  drugie.forEach(t => { transakcje.push({ ...t, status: 'anulowana' }); anulowane.add(t.id); });
  const rozl = dane.rozliczenia.filter(r => anulowane.has(r.transakcja_id) && r.status !== 'anulowane').map(r => ({ ...r, status: 'anulowane' }));
  await sync.zapiszWiele([
    { karta: 'TRANSAKCJE', wiersze: transakcje },
    { karta: 'ROZLICZENIA', wiersze: rozl },
    { karta: 'IMPORTY', wiersze: [{ ...i, wycofana: true, odciski_pominiete: '[]' }] },
  ]);
  await wczytajDane();
  toast('Import wycofany. Możesz wczytać plik ponownie.', 'ok', 6000);
}

async function zmianaWPartii(el) {
  const t = dane.transakcje.find(x => x.id === el.dataset.id);
  if (!t) return;
  let zm;
  if (el.dataset.pole === 'p-podmiot') zm = { podmiot: el.value };
  else {
    let wartosc = el.value;
    const typ = t.typ === 'wpływ' ? 'wpływ' : 'wydatek';
    if (wartosc === '__nowa__') {
      const r = await nowaKategoria(typ);
      if (!r) { bezSkoku(() => renderPartia(t.partia_importu)); return; }
      wartosc = `${r.kategoria}||${r.podkategoria}`;
    }
    const [kat, pod = ''] = wartosc.split('||');
    zm = typ === 'wpływ' ? { zrodlo_przychodu: kat } : { kategoria: kat, podkategoria: pod };
  }
  await sync.zapisz('TRANSAKCJE', [{ ...t, ...zm }]);
  await wczytajDane();
  toast('Zapisano.', 'ok', 1500);
  bezSkoku(() => renderPartia(t.partia_importu));
}

let partiaWidoku = null;

function render(arg) {
  partiaWidoku = arg || null;
  if (arg) { renderPartia(arg); return; }
  if (!imp) renderStart();
  else if (!imp.p) renderSekcje();
  else if (!imp.konto) renderKonto();
  else renderPrzeglad();
}

function otworzSekcje(i) {
  const s = imp.sekcje[i];
  imp.p = s;
  imp.sekcjaNr = i;
  imp.konto = '';
  const k = kontoSekcji(s);
  if (k) przygotuj(imp.plikNazwa, s, k.nazwa);
}

const przerysuj = () => bezSkoku(render);

// ───────────────────────── zapis ─────────────────────────

const kursPLN = (waluta, kwota) => (waluta === 'PLN' ? { kurs: 1, kwota_pln: kwota } : { kurs: '', kwota_pln: '' });

async function zapiszImport(b) {
  const nowe = imp.wiersze.filter(w => w.stan === 'nowa');
  const bladPrzeks = nowe.find(w => w.typ === 'przeks' && !w.konto2);
  if (bladPrzeks) { toast(`Wybierz drugie konto dla przeksięgowania z ${dataKrotko(bladPrzeks.op.data)} (${kwotaTxt(Math.abs(bladPrzeks.op.kwota))}).`, 'blad', 6000); return; }
  const bezKat = nowe.filter(w => w.typ !== 'przeks' && !w.kategoria).length;
  if (bezKat) {
    const tak = await okno('Zapisać bez kategorii?', `<p>${bezKat} ${odmiana(bezKat, 'operacja nie ma', 'operacje nie mają', 'operacji nie ma')} kategorii. Możesz je skategoryzować później w Transakcjach.</p>`,
      [{ etykieta: 'Wróć i uzupełnij', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Zapisz mimo to', wartosc: true }]);
    if (!tak) { widok.filtr = 'bez-kategorii'; przerysuj(); return; }
  }
  b.disabled = true;
  const partia = uuid();
  const dzis = dataLok();
  const wiersze = [];
  let dopasowanych = 0, dodanych = 0;
  const wspolne = (w) => ({ partia_importu: partia, odcisk: w.odcisk, surowy_wiersz: w.op.surowy.slice(0, 2000), data_ksiegowania: w.op.data_ksiegowania || w.op.data });

  for (const w of imp.wiersze) {
    if (w.stan === 'dopasowana') {
      dopasowanych++;
      w.jednostka.wiersze.forEach(t => wiersze.push({ ...t, ...wspolne(w), status: 'potwierdzona' }));
    } else if (w.stan === 'nowa') {
      dodanych++;
      const kw = Math.abs(w.op.kwota);
      const baza = {
        data_operacji: w.op.data, kwota: kw, waluta: w.op.waluta, ...kursPLN(w.op.waluta, kw), podzial_id: '', tagi: '', nr_dokumentu: '',
        zalacznik: '', budzet: '', cel: '', pozyczka_id: '', planowana_id: '', planowany_termin: '', dowod: '', zrodlo: 'import',
      };
      if (w.typ === 'przeks') {
        const para = uuid();
        const wplyw = w.op.kwota > 0;
        const tu = { ...baza, ...wspolne(w), id: uuid(), typ: wplyw ? 'przeksięgowanie-wpływ' : 'przeksięgowanie-wypływ', id_pary: para, konto: imp.konto,
          kategoria: '', podkategoria: '', zrodlo_przychodu: '', kontrahent: '', podmiot: '', opis: w.op.tytul || w.op.opis.slice(0, 200), status: 'potwierdzona' };
        const tam = { ...tu, id: uuid(), typ: wplyw ? 'przeksięgowanie-wypływ' : 'przeksięgowanie-wpływ', konto: w.konto2, partia_importu: '', odcisk: '', surowy_wiersz: '', data_ksiegowania: '',
          status: statusDlaKonta(w.konto2), zrodlo: 'import (druga strona)' };
        wiersze.push(tu, tam);
      } else {
        const wplyw = w.typ === 'wpływ';
        wiersze.push({
          ...baza, ...wspolne(w), id: uuid(), typ: w.typ, id_pary: '', konto: imp.konto,
          kategoria: wplyw ? '' : w.kategoria, podkategoria: wplyw ? '' : w.podkategoria, zrodlo_przychodu: wplyw ? w.kategoria : '',
          kontrahent: w.kontrahent || '', podmiot: w.podmiot, opis: w.op.tytul && w.op.tytul !== w.kontrahent ? w.op.tytul.slice(0, 300) : '', status: 'potwierdzona',
        });
      }
    }
  }
  const pominieteTeraz = imp.wiersze.filter(w => w.stan === 'pomin' && !w.wczesniejPominieta).map(w => w.odcisk);
  const rekord = {
    partia, data: dzis, konto: imp.konto, nazwa_pliku: imp.plikNazwa, wierszy_w_pliku: imp.p.operacje.length,
    dodanych, pominietych: pominieteTeraz.length, dopasowanych, okres_od: imp.p.od || imp.p.operacje.at(-1)?.data || '',
    okres_do: imp.p.do || imp.p.operacje[0]?.data || '', odciski_pominiete: JSON.stringify(pominieteTeraz), wycofana: false,
  };
  try {
    await sync.zapiszWiele([{ karta: 'TRANSAKCJE', wiersze }, { karta: 'IMPORTY', wiersze: [rekord] }]);
    await wczytajDane();
    toast(`Zapisano import: połączone ${dopasowanych}, dodane ${dodanych}, pominięte ${pominieteTeraz.length}.`, 'ok', 6000);
    if (imp.sekcje.length > 1) {
      imp.zrobione.add(imp.sekcjaNr);
      Object.assign(imp, { p: null, konto: '', wiersze: [] });
    } else imp = null;
    render();
  } catch (e) {
    b.disabled = false;
    toast('Nie udało się zapisać: ' + e.message, 'blad', 7000);
  }
}

async function zapamietajRachunek(konto) {
  const iban = imp.p.ibany[0];
  if (!iban) return;
  const wiersz = dane.slownik.find(s => s.lista === 'konta' && s.nazwa === konto);
  if (!wiersz) return;
  const a = atrybuty(wiersz);
  if ([a.iban, a.iban2].some(x => x && zgodneIbany(x, iban))) return;
  const nowe = a.iban ? { ...a, iban2: iban } : { ...a, iban };
  await sync.zapisz('SLOWNIK', [{ ...wiersz, atrybuty: JSON.stringify(nowe) }]);
  await wczytajDane();
}

// ───────────────────────── zdarzenia ─────────────────────────

async function wczytajPlik(plik) {
  let wynik = null;
  try {
    const poczatek = new Uint8Array(await plik.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...poczatek) === '%PDF-') {
      toast('Czytam PDF…', '', 2500);
      wynik = await parsujRevolutPdf(await plik.arrayBuffer());
    } else {
      const tekst = await czytajPlik(plik);
      for (const parser of PARSERY) { wynik = parser(tekst); if (wynik) break; }
    }
  } catch (e) {
    toast('Nie udało się odczytać pliku: ' + e.message, 'blad', 7000);
    return;
  }
  if (!wynik) { toast('Nie rozpoznaję tego pliku. Obsługiwane są: mBank (CSV), Revolut (PDF lub CSV).', 'blad', 7000); return; }
  const sekcje = wynik.sekcje.filter(s => s.operacje.length || s.kontrola).sort((a, b) => (b.operacje.length ? 1 : 0) - (a.operacje.length ? 1 : 0));
  if (!sekcje.some(s => s.operacje.length)) { toast('W pliku nie ma żadnych operacji.', 'blad'); return; }
  imp = { plikNazwa: plik.name, bank: wynik.bank, sekcje, zrobione: new Set(), p: null, konto: '', wiersze: [] };
  const zOperacjami = sekcje.filter(s => s.operacje.length);
  if (zOperacjami.length === 1) otworzSekcje(sekcje.indexOf(zOperacjami[0]));
  render();
}

function wiersz(i) { return imp.wiersze[Number(i)]; }

function polacz(w, idJednostki) {
  const k = (w.kandydaci || []).find(x => x.j.id === idJednostki);
  if (!k) return;
  w.jednostka = k.j;
  w.stan = 'dopasowana';
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  if (b.dataset.akcja === 'wycofaj-import') { await wycofajImport(b.dataset.v); bezSkoku(() => renderPartia(b.dataset.v)); return; }
  const { akcja, v, i } = b.dataset;
  if (akcja === 'zaznacz') {
    if (b.checked) widok.zaznaczone.add(Number(i)); else widok.zaznaczone.delete(Number(i));
    przerysuj(); return;
  }
  if (akcja === 'zaznacz-wszystkie') {
    const widoczne = imp.wiersze.filter(pasujeFiltr).filter(w => w.stan !== 'juz');
    if (b.checked) widoczne.forEach(w => widok.zaznaczone.add(w.i)); else widoczne.forEach(w => widok.zaznaczone.delete(w.i));
    przerysuj(); return;
  }
  switch (akcja) {
    case 'anuluj-import': imp = null; break;
    case 'sekcja': otworzSekcje(Number(v)); break;
    case 'do-sekcji': Object.assign(imp, { p: null, konto: '', wiersze: [] }); break;
    case 'wybierz-konto':
      przygotuj(imp.plikNazwa, imp.p, v);
      zapamietajRachunek(v).catch(() => {});
      break;
    case 'filtr': widok.filtr = v; break;
    case 'zapamietaj-podmiot': {
      const wiersz_ = dane.slownik.find(x => x.lista === 'konta' && x.nazwa === imp.konto);
      if (wiersz_) {
        await sync.zapisz('SLOWNIK', [{ ...wiersz_, atrybuty: JSON.stringify({ ...atrybuty(wiersz_), podmiot: imp.domyslnyPodmiot }) }]);
        await wczytajDane();
        toast(`Konto ${imp.konto} ma teraz domyślny podmiot ${imp.domyslnyPodmiot}.`, 'ok');
      }
      break;
    }
    case 'zatwierdz': wiersz(i).stan = 'dopasowana'; break;
    case 'zatwierdz-wszystkie': imp.wiersze.forEach(w => { if (w.stan === 'propozycja') w.stan = 'dopasowana'; }); break;
    case 'odrzuc': {
      const w = wiersz(i);
      w.kandydaci = (w.kandydaci || []).filter(k => k.j.id !== w.jednostka.id || w.stan === 'dopasowana');
      w.stan = 'nowa'; w.jednostka = null;
      break;
    }
    case 'pomin': wiersz(i).stan = 'pomin'; widok.zaznaczone.delete(Number(i)); break;
    case 'przywroc': { const w = wiersz(i); w.stan = 'nowa'; w.wczesniejPominieta = false; break; }
    case 'm-pomin': widok.zaznaczone.forEach(n => { const w = wiersz(n); if (w.stan === 'nowa') w.stan = 'pomin'; }); widok.zaznaczone.clear(); break;
    case 'm-przywroc': widok.zaznaczone.forEach(n => { const w = wiersz(n); if (w.stan === 'pomin') { w.stan = 'nowa'; w.wczesniejPominieta = false; } }); widok.zaznaczone.clear(); break;
    case 'm-odznacz': widok.zaznaczone.clear(); break;
    case 'zapisz-import': await zapiszImport(b); return;
    default: return;
  }
  przerysuj();
}

async function zmiana(e) {
  const el = e.target;
  if (partiaWidoku && el.dataset.pole?.startsWith('p-')) { await zmianaWPartii(el); return; }
  // „+ Nowa kategoria…” w liście kategorii – okno, potem nowa kategoria od razu wybrana
  if (el.value === '__nowa__' && el.dataset.pole) {
    const pole = el.dataset.pole;
    const typ = pole === 'm-kategoria-wplyw' || (pole === 'kategoria' && wiersz(el.dataset.i).typ === 'wpływ') ? 'wpływ' : 'wydatek';
    const r = await nowaKategoria(typ);
    if (!r) { przerysuj(); return; }
    if (pole === 'kategoria') { const w = wiersz(el.dataset.i); w.kategoria = r.kategoria; w.podkategoria = r.podkategoria; w.podpowiedz = ''; }
    else {
      widok.zaznaczone.forEach(n => {
        const w = wiersz(n);
        if (w.stan === 'nowa' && w.typ !== 'przeks' && (pole === 'm-kategoria-wplyw') === (w.typ === 'wpływ')) { w.kategoria = r.kategoria; w.podkategoria = r.podkategoria; w.podpowiedz = ''; }
      });
    }
    przerysuj();
    return;
  }
  if (el.name === 'plik-importu' && el.files?.[0]) { wczytajPlik(el.files[0]); return; }
  const pole = el.dataset.pole;
  if (!pole || !imp) return;
  if (pole.startsWith('m-')) {
    const v = el.value;
    if (!v) return;
    widok.zaznaczone.forEach(n => {
      const w = wiersz(n);
      if (w.stan !== 'nowa') return;
      if (pole === 'm-podmiot') { w.podmiot = v; w.podmiotRecznie = true; }
      else if ((pole === 'm-kategoria-wplyw') === (w.typ === 'wpływ') && w.typ !== 'przeks') {
        [w.kategoria, w.podkategoria] = v.split('||'); w.podpowiedz = '';
      }
    });
    przerysuj();
    return;
  }
  if (pole === 'domyslny-podmiot') {
    imp.domyslnyPodmiot = el.value;
    imp.wiersze.forEach(w => { if (w.stan === 'nowa' && !w.podmiotRecznie) w.podmiot = el.value; });
    przerysuj();
    return;
  }
  const w = wiersz(el.dataset.i);
  if (pole === 'typ') { w.typ = el.value; if (w.typ !== 'przeks') { w.kategoria = ''; w.podkategoria = ''; } }
  else if (pole === 'kategoria') { [w.kategoria, w.podkategoria = ''] = el.value.split('||'); w.podpowiedz = ''; }
  else if (pole === 'podmiot') { w.podmiot = el.value; w.podmiotRecznie = true; }
  else if (pole === 'konto2') w.konto2 = el.value;
  else if (pole === 'inny' && el.value) {
    if (w.stan === 'propozycja' || w.stan === 'dopasowana') { w.stan = 'propozycja'; }
    polacz(w, el.value);
  }
  przerysuj();
}

export const ekran = { render, klik, zmiana };
