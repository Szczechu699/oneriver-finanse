// Ekran „Dziennik zdarzeń”: kto, kiedy i co zmienił w arkuszu (karta LOG), z filtrami okresu, osoby i modułu.
// Dziennik czyta się prosto z arkusza, więc ten ekran wymaga internetu.

import { $, esc, kwotaTxt, dataLok, dodajDni, dataSlownie, dataKrotko, odmiana } from './util.js';
import { dane } from './dane.js';
import { wywolaj, wersjaApi, skonfigurowane } from './api.js';

const MODULY = {
  TRANSAKCJE: 'Transakcje', PLANOWANE: 'Planowane', POZYCZKI: 'Pożyczki', BUDZETY: 'Budżety i cele',
  SLOWNIK: 'Konta, kategorie, tytuły', SPRZEDAZ_SGT: 'Sprzedaż – paragony', SPRZEDAZ_SGT_POZ: 'Sprzedaż – pozycje',
  DYSK: 'Pliki na Dysku', KOPIA: 'Kopie zapasowe', IMPORTY: 'Importy wyciągów', ZAMOWIENIA: 'Zamówienia',
  ZAMOWIENIA_POZ: 'Zamówienia – pozycje', ROZLICZENIA: 'Rozliczenia', KLIENCI: 'Klienci',
};
const LISTY = { konta: 'Konto', kategorie_kosztow: 'Kategoria', zrodla_przychodu: 'Źródło przychodu', tytuly: 'Tytuł', podmioty: 'Podmiot', waluty: 'Waluta', tagi: 'Tag' };
const OKRESY = [['dzis', 'Dziś'], ['7', '7 dni'], ['30', '30 dni'], ['wszystko', 'Wszystko']];

const stan = { okres: '7', kto: '', karta: '', wpisy: [], osoby: [], wiecej: false, laduje: false, blad: '', zaladowano: false };

function zakres() {
  const dzis = dataLok();
  if (stan.okres === 'dzis') return { od: dzis };
  if (stan.okres === '7') return { od: dodajDni(dzis, -6) };
  if (stan.okres === '30') return { od: dodajDni(dzis, -29) };
  return {};
}

async function pobierz(starsze = false) {
  if (!skonfigurowane()) { stan.blad = 'Połącz aplikację z arkuszem w Ustawieniach.'; return; }
  const api = wersjaApi();
  if (api && api < 5) { stan.blad = `Dziennik wymaga skryptu arkusza w wersji 5 (teraz: ${api}).`; return; }
  stan.laduje = true;
  stan.blad = '';
  rysuj();
  try {
    const przed = starsze && stan.wpisy.length ? stan.wpisy[stan.wpisy.length - 1].kiedy : undefined;
    const w = await wywolaj('dziennik', { ...zakres(), kto: stan.kto || undefined, karta: stan.karta || undefined, przed, limit: 300 }, 60000);
    stan.wpisy = starsze ? [...stan.wpisy, ...w.wpisy] : w.wpisy;
    stan.osoby = w.osoby || [];
    stan.wiecej = w.wiecej;
    stan.zaladowano = true;
  } catch (e) {
    stan.blad = navigator.onLine ? e.message : 'Dziennik czyta się z arkusza – potrzebny jest internet.';
  } finally {
    stan.laduje = false;
  }
  rysuj();
}

// ── opis obiektu, którego dotyczy wpis ──

function obiekt(karta, id) {
  if (karta === 'TRANSAKCJE') {
    const t = dane.transakcje.find(x => x.id === id);
    if (!t) return { tekst: 'transakcja (brak na urządzeniu)' };
    return {
      tekst: `${t.typ} ${kwotaTxt(Number(t.kwota) || 0, t.waluta)} · ${t.kontrahent || t.kategoria || t.zrodlo_przychodu || t.konto || ''} · ${dataKrotko(t.data_operacji)}`,
      href: t.pozyczka_id ? `#pozyczka/${encodeURIComponent(t.pozyczka_id)}` : `#edytuj/${encodeURIComponent(id)}`,
    };
  }
  if (karta === 'PLANOWANE') {
    const p = dane.planowane.find(x => x.id === id);
    return p ? { tekst: `${p.nazwa} ${kwotaTxt(Number(p.kwota) || 0, p.waluta)} (${p.rodzaj})`, href: p.pozyczka_id ? `#pozyczka/${encodeURIComponent(p.pozyczka_id)}` : `#plan/${encodeURIComponent(id)}` } : { tekst: 'pozycja planowana' };
  }
  if (karta === 'POZYCZKI') {
    const p = dane.pozyczki.find(x => x.id === id);
    return p ? { tekst: `${p.osoba} ${kwotaTxt(Number(p.kwota) || 0, p.waluta)}`, href: `#pozyczka/${encodeURIComponent(id)}` } : { tekst: 'pożyczka' };
  }
  if (karta === 'BUDZETY') {
    const b = dane.budzety.find(x => x.id === id);
    return b ? { tekst: b.nazwa, href: `#budzet/${encodeURIComponent(id)}` } : { tekst: 'budżet' };
  }
  if (karta === 'SLOWNIK') {
    const [lista, ...reszta] = id.split('|');
    const w = dane.slownik.find(x => x.lista === lista && x.id === reszta.join('|'));
    return { tekst: `${LISTY[lista] || lista}: ${w?.nazwa || reszta.join('|')}` };
  }
  if (karta === 'SPRZEDAZ_SGT') {
    const [pod, dok] = id.split('|');
    const d = dane.sprzedaz.find(x => x.podmiot === pod && String(x.dok_id) === dok);
    return { tekst: d ? `${d.numer} (${pod}) ${kwotaTxt(Number(d.brutto) || 0)}` : `paragon ${pod} ${dok}` };
  }
  return { tekst: id };
}

function akcja(w) {
  if (w.karta === 'DYSK') return 'Plik';
  if (w.karta === 'KOPIA') return 'Kopia';
  if (w.co === 'nowy wiersz') return 'Dodano';
  if (/status: [^;]*→ anulowan/.test(w.co)) return 'Anulowano';
  return 'Zmieniono';
}

/** Kolejne „nowe wiersze” z tej samej chwili, osoby i karty (np. wklejona sprzedaż) łączymy w jeden wpis. */
function zgrupuj(wpisy) {
  const wynik = [];
  for (const w of wpisy) {
    const ost = wynik[wynik.length - 1];
    if (ost && w.co === 'nowy wiersz' && ost.co === 'nowy wiersz' && ost.kiedy === w.kiedy && ost.kto === w.kto && ost.karta === w.karta) {
      ost.ile = (ost.ile || 1) + 1;
    } else wynik.push({ ...w });
  }
  return wynik;
}

const ladnaKolumna = k => k.replace(/_/g, ' ');

function htmlZmian(co) {
  if (co === 'nowy wiersz') return '';
  const czesci = co.split('; ').map(c => {
    const m = /^([a-z0-9_]+): (.*)$/i.exec(c);
    return m ? `<li><b>${esc(ladnaKolumna(m[1]))}</b>: ${esc(m[2])}</li>` : `<li>${esc(c)}</li>`;
  });
  return `<ul class="zmiany-wpisu">${czesci.join('')}</ul>`;
}

function htmlWpisu(w) {
  const o = w.ile ? null : obiekt(w.karta, w.id);
  const modul = MODULY[w.karta] || w.karta;
  const opis = w.ile
    ? `${w.ile} ${odmiana(w.ile, 'nowy wiersz', 'nowe wiersze', 'nowych wierszy')}`
    : (o.href ? `<a href="${o.href}">${esc(o.tekst)}</a>` : esc(o.tekst));
  return `<li class="wpis-dziennika">
    <span class="godzina-wpisu">${esc(w.kiedy.slice(11, 16))}</span>
    <div class="tresc-wpisu">
      <div class="naglowek-wpisu"><span class="znacznik akcja-${akcja(w).toLowerCase()}">${esc(akcja(w))}</span>
        <span class="modul-wpisu">${esc(modul)}</span>
        <span class="osoba-wpisu">${esc(w.kto)}</span></div>
      <div class="obiekt-wpisu">${w.ile ? esc(opis) : opis}</div>
      ${w.karta === 'DYSK' || w.karta === 'KOPIA' ? `<div class="podpowiedz">${esc(w.co)}</div>` : htmlZmian(w.co)}
    </div>
  </li>`;
}

function rysuj() {
  const widok = $('#widok');
  if (!widok.querySelector('.dziennik')) return;
  const wpisy = zgrupuj(stan.wpisy);
  const dni = new Map();
  wpisy.forEach(w => {
    const d = w.kiedy.slice(0, 10);
    if (!dni.has(d)) dni.set(d, []);
    dni.get(d).push(w);
  });
  $('#wyniki-dziennika').innerHTML = stan.blad ? `<p class="komunikat blad">${esc(stan.blad)}</p>`
    : !stan.zaladowano && stan.laduje ? '<p class="pusto">Wczytuję dziennik z arkusza…</p>'
    : !wpisy.length ? '<p class="pusto">Brak wpisów dla wybranych filtrów.</p>'
    : [...dni.entries()].map(([d, lista]) => `<section class="dzien-dziennika"><h2>${esc(dataSlownie(d))}</h2><ul class="lista-dziennika">${lista.map(htmlWpisu).join('')}</ul></section>`).join('')
      + (stan.wiecej ? `<div class="przyciski"><button type="button" class="drugorzedny" data-akcja="starsze" ${stan.laduje ? 'disabled' : ''}>Pokaż starsze</button></div>` : '');
  const os = $('select[name="kto"]');
  if (os) {
    os.innerHTML = `<option value="">Wszyscy</option>${stan.osoby.map(o => `<option ${o === stan.kto ? 'selected' : ''}>${esc(o)}</option>`).join('')}`;
  }
  $('#stan-dziennika').textContent = stan.laduje ? 'Wczytuję…' : '';
}

function render() {
  $('#widok').innerHTML = `
  <section class="ekran dziennik">
    <div class="naglowek-sekcji"><h1>Dziennik zdarzeń</h1>
      <button type="button" class="przycisk-maly drugorzedny" data-akcja="odswiez">Odśwież</button></div>
    <p class="uwagi-podsumowania">Każda zmiana zapisana w arkuszu: kto (nazwa urządzenia z Ustawień), kiedy i co zmienił. <span id="stan-dziennika" aria-live="polite"></span></p>
    <div class="pasek-filtrow">
      <div class="chipy male" role="group" aria-label="Okres">${OKRESY.map(([o, e]) =>
        `<button type="button" class="chip" data-akcja="okres" data-v="${o}" aria-pressed="${stan.okres === o}">${e}</button>`).join('')}</div>
      <label class="filtr-dziennika"><span class="etykieta">Kto</span><select name="kto"><option value="">Wszyscy</option></select></label>
      <label class="filtr-dziennika"><span class="etykieta">Moduł</span><select name="karta"><option value="">Wszystkie</option>${Object.entries(MODULY).map(([k, n]) =>
        `<option value="${k}" ${stan.karta === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    </div>
    <div id="wyniki-dziennika"></div>
  </section>`;
  rysuj();
  pobierz();
}

function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja: a, v } = b.dataset;
  if (a === 'okres') {
    stan.okres = v;
    document.querySelectorAll('.dziennik [data-akcja="okres"]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
    pobierz();
  } else if (a === 'odswiez') pobierz();
  else if (a === 'starsze') pobierz(true);
}

function zmiana(e) {
  if (e.target.name === 'kto') { stan.kto = e.target.value; pobierz(); }
  else if (e.target.name === 'karta') { stan.karta = e.target.value; pobierz(); }
}

export const ekran = { render, klik, zmiana };
