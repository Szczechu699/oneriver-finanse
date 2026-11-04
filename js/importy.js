// Ekran „Import wyciągu” (#import): plik z banku → dopasowanie do wpisów ręcznych → nowe transakcje z kategoriami.
// Wpisy ręczne zawsze są pierwsze; import raz w miesiącu je potwierdza (status „potwierdzona”) i uzupełnia resztę.
// Każda operacja z wyciągu ma „odcisk” (konto, data, kwota, opis, kolejny numer takiej samej operacji),
// więc ponowny import tego samego lub nakładającego się okresu niczego nie dubluje.

import { $, $$, esc, zaokr, kwotaTxt, dataLok, dodajDni, roznicaDni, dataKrotko, dataSlownie, uuid, odmiana, toast, okno, bezSkoku } from './util.js';
import {
  dane, wczytajDane, konta, atrybuty, glowne, podrzedne, podmioty, podmiotKonta, czyWirtualne, kierunek, czyPrzeks, lista,
} from './dane.js';
import * as sync from './sync.js';
import { ikonaSvg } from './ikony.js';

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
    bank: 'mBank', iban, nazwaRachunku, operacje,
    od: okres ? `${okres[3]}-${okres[2]}-${okres[1]}` : '', do: okres ? `${okres[6]}-${okres[5]}-${okres[4]}` : '',
    kontrola: sumy ? { waluta: sumy[1], wplywy: kwotaZTekstu(sumy[2])?.kwota ?? null, wydatki: kwotaZTekstu(sumy[3])?.kwota ?? null } : null,
  };
}

const PARSERY = [parsujMbank];

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

const ibanKonta = k => String(atrybuty(dane.slownik.find(s => s.lista === 'konta' && s.nazwa === k.nazwa)).iban || '').replace(/\D/g, '');

// ───────────────────────── stan ekranu ─────────────────────────

let imp = null;   // { plik, wynik parsera, konto, wiersze: [...] }
const widok = { filtr: 'wszystkie', zaznaczone: new Set() };

function przygotuj(plikNazwa, p, konto) {
  const pominiete = new Set(dane.importy.flatMap(i => {
    try { return JSON.parse(i.odciski_pominiete || '[]'); } catch { return []; }
  }));
  const znane = new Set(dane.transakcje.filter(t => t.odcisk && t.status !== 'anulowana').map(t => t.odcisk));
  const jednostki = jednostkiDoDopasowania(konto);
  const powtorzenia = new Map();
  const wiersze = p.operacje.map((op, i) => {
    const baza = `${konto}|${op.data}|${op.kwota.toFixed(2)}|${hasz(norm(op.opis))}`;
    const n = (powtorzenia.get(baza) || 0) + 1;
    powtorzenia.set(baza, n);
    const odcisk = `${baza}|${n}`;
    const w = { i, op, odcisk, stan: 'nowa', typ: op.kwota > 0 ? 'wpływ' : 'wydatek', kategoria: '', podkategoria: '', podmiot: podmiotKonta(konto) || '', konto2: '', kontrahent: op.kontrahent, podpowiedz: '' };
    if (znane.has(odcisk)) { w.stan = 'juz'; return w; }
    if (pominiete.has(odcisk)) { w.stan = 'pomin'; w.wczesniejPominieta = true; return w; }
    // przelew z / na własne konto zapisane w aplikacji
    const wlasne = op.rachunek && konta().find(k => k.nazwa !== konto && ibanKonta(k) && ibanKonta(k).endsWith(op.rachunek.slice(-10)));
    if (wlasne) { w.typ = 'przeks'; w.konto2 = wlasne.nazwa; }
    const pk = podpowiedzKategorii(op);
    Object.assign(w, { kategoria: pk.kategoria, podkategoria: pk.podkategoria, podpowiedz: pk.zrodlo });
    if (/przelew własny|spłata karty/i.test(op.kategoria_banku) && !wlasne) w.uwaga = `Bank: „${op.kategoria_banku}” – to może być przeksięgowanie między Twoimi kontami.`;
    return w;
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
  imp = { plikNazwa, p, konto, wiersze, jednostki };
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
  }).join('')}`;
}

function htmlDecyzji(w) {
  const i = w.i;
  if (w.stan === 'juz') return '<span class="znacznik">już w aplikacji</span>';
  if (w.stan === 'pomin') return `<span class="znacznik">${w.wczesniejPominieta ? 'pominięta przy poprzednim imporcie' : 'pominięta'}</span>
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
  const ostatnie = [...dane.importy].sort((a, b) => String(b.utworzono || b.data).localeCompare(String(a.utworzono || a.data))).slice(0, 8);
  $('#widok').innerHTML = `
  <section class="ekran import-ekran">
    <div class="naglowek-sekcji"><h1>Import wyciągu</h1></div>
    <div class="karta-ustawien">
      <h2>Wybierz plik z banku</h2>
      <p>Na razie obsługiwany jest <b>mBank</b>: w serwisie wejdź w Historię operacji, ustaw okres (np. cały miesiąc) i pobierz listę operacji jako <b>CSV</b>.</p>
      <label class="pole"><span class="etykieta">Plik CSV</span><input type="file" name="plik-importu" accept=".csv,text/csv,text/plain"></label>
      <p class="podpowiedz">Najpierw dopiszesz w aplikacji wpisy ręczne, a import je potwierdzi. Operacje, których nie ma w aplikacji, dodasz stąd z kategorią. Ten sam plik można wczytać ponownie – nic się nie zdubluje.</p>
    </div>
    ${ostatnie.length ? `<div class="karta-ustawien"><h2>Ostatnie importy</h2>
      <table class="tabela"><thead><tr><th>Kiedy</th><th>Konto</th><th>Okres</th><th class="liczba">Połączone</th><th class="liczba">Dodane</th><th class="liczba">Pominięte</th></tr></thead>
      <tbody>${ostatnie.map(i => `<tr><td>${esc(dataKrotko(String(i.data || i.utworzono).slice(0, 10)))}</td><td>${esc(i.konto)}</td>
        <td>${i.okres_od ? esc(`${dataKrotko(String(i.okres_od).slice(0, 10))} – ${dataKrotko(String(i.okres_do).slice(0, 10))}`) : ''}</td>
        <td class="liczba">${esc(i.dopasowanych ?? '')}</td><td class="liczba">${esc(i.dodanych ?? '')}</td><td class="liczba">${esc(i.pominietych ?? '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </section>`;
}

function renderKonto() {
  const p = imp.p;
  $('#widok').innerHTML = `
  <section class="ekran import-ekran">
    <div class="naglowek-sekcji"><h1>Import wyciągu</h1></div>
    <form class="karta-ustawien" data-forma="konto-importu">
      <h2>Którego konta dotyczy ten plik?</h2>
      <p>${esc(p.bank)}: <b>${esc(p.nazwaRachunku || 'rachunek')}</b>${p.iban ? ` (…${esc(p.iban.slice(-4))})` : ''}, ${p.operacje.length} ${odmiana(p.operacje.length, 'operacja', 'operacje', 'operacji')}.</p>
      <div class="chipy">${konta().filter(k => !k.wirtualne).map(k =>
        `<button type="button" class="chip konto-chip" style="--k:${esc(k.kolor)}" data-akcja="wybierz-konto" data-v="${esc(k.nazwa)}">${esc(k.nazwa)}</button>`).join('')}</div>
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
      <button type="button" class="przycisk-maly drugorzedny akcja-naglowka" data-akcja="anuluj-import">Inny plik</button></div>
    <div class="kafle-wskaznikow">
      <div class="wskaznik"><span class="etykieta-wsk">Plik</span><b>${p.operacje.length}</b><span class="zmiana">${esc(p.od ? `${dataKrotko(p.od)} – ${dataKrotko(p.do)} ${p.do.slice(0, 4)}` : imp.plikNazwa)}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Wpływy / wydatki</span><b class="mniejsze">+${esc(kwotaTxt(wplywy))}<br>−${esc(kwotaTxt(-wydatki))}</b><span class="zmiana">${p.kontrola ? (zgodne ? '✓ zgodne z sumami banku' : '⚠ nie zgadza się z sumami banku') : ''}</span></div>
      <div class="wskaznik ${l.propozycja ? 'wyroznione' : ''}"><span class="etykieta-wsk">Do zatwierdzenia</span><b>${l.propozycja}</b><span class="zmiana">połączone: ${l.dopasowana}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Nowe</span><b>${l.nowa}</b><span class="zmiana">${l['bez-kategorii']} bez kategorii · już w aplikacji: ${l.juz}</span></div>
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

function render() {
  if (!imp) renderStart();
  else if (!imp.konto) renderKonto();
  else renderPrzeglad();
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
          status: czyWirtualne(w.konto2) ? 'bez ruchu na koncie' : 'oczekuje na wyciąg', zrodlo: 'import (druga strona)' };
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
    imp = null;
    render();
  } catch (e) {
    b.disabled = false;
    toast('Nie udało się zapisać: ' + e.message, 'blad', 7000);
  }
}

async function zapamietajRachunek(konto) {
  if (!imp.p.iban) return;
  const wiersz = dane.slownik.find(s => s.lista === 'konta' && s.nazwa === konto);
  if (!wiersz) return;
  const a = atrybuty(wiersz);
  if (String(a.iban || '').replace(/\D/g, '') === imp.p.iban) return;
  await sync.zapisz('SLOWNIK', [{ ...wiersz, atrybuty: JSON.stringify({ ...a, iban: imp.p.iban }) }]);
  await wczytajDane();
}

// ───────────────────────── zdarzenia ─────────────────────────

async function wczytajPlik(plik) {
  const tekst = await czytajPlik(plik);
  let p = null;
  for (const parser of PARSERY) { p = parser(tekst); if (p) break; }
  if (!p) { toast('Nie rozpoznaję tego pliku. Na razie obsługiwany jest CSV z mBanku (lista operacji).', 'blad', 7000); return; }
  if (!p.operacje.length) { toast('W pliku nie ma żadnych operacji.', 'blad'); return; }
  const konto = p.iban && konta().find(k => ibanKonta(k) === p.iban);
  imp = { plikNazwa: plik.name, p, konto: '' };
  if (konto) przygotuj(plik.name, p, konto.nazwa);
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
    case 'wybierz-konto':
      przygotuj(imp.plikNazwa, imp.p, v);
      zapamietajRachunek(v).catch(() => {});
      break;
    case 'filtr': widok.filtr = v; break;
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

function zmiana(e) {
  const el = e.target;
  if (el.name === 'plik-importu' && el.files?.[0]) { wczytajPlik(el.files[0]); return; }
  const pole = el.dataset.pole;
  if (!pole || !imp) return;
  if (pole.startsWith('m-')) {
    const v = el.value;
    if (!v) return;
    widok.zaznaczone.forEach(n => {
      const w = wiersz(n);
      if (w.stan !== 'nowa') return;
      if (pole === 'm-podmiot') w.podmiot = v;
      else if ((pole === 'm-kategoria-wplyw') === (w.typ === 'wpływ') && w.typ !== 'przeks') {
        [w.kategoria, w.podkategoria] = v.split('||'); w.podpowiedz = '';
      }
    });
    przerysuj();
    return;
  }
  const w = wiersz(el.dataset.i);
  if (pole === 'typ') { w.typ = el.value; if (w.typ !== 'przeks') { w.kategoria = ''; w.podkategoria = ''; } }
  else if (pole === 'kategoria') { [w.kategoria, w.podkategoria = ''] = el.value.split('||'); w.podpowiedz = ''; }
  else if (pole === 'podmiot') w.podmiot = el.value;
  else if (pole === 'konto2') w.konto2 = el.value;
  else if (pole === 'inny' && el.value) {
    if (w.stan === 'propozycja' || w.stan === 'dopasowana') { w.stan = 'propozycja'; }
    polacz(w, el.value);
  }
  przerysuj();
}

export const ekran = { render, klik, zmiana };
