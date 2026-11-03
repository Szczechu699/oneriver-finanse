// Ekran „Podsumowanie”: wskaźniki, wykresy i zestawienia za wybrany okres, z filtrami.
// Kolory serii: wpływy niebieskie, wydatki pomarańczowe (para sprawdzona pod kątem daltonizmu, jasny i ciemny motyw).

import { $, $$, esc, zaokr, fmt2, kwotaTxt, dataLok, dodajDni, przesunDate, roznicaDni, dataKrotko, nazwaMiesiaca, odmiana } from './util.js';
import {
  dane, konta, kolorKonta, glowne, podmioty, ikona, kolorKategorii, czyPrzeks, czyPozyczkowa, kwotaPLN, stanKont,
  aktywnePlanowane, terminy, kierunekPlanu, stanPozyczki, stronaPozyczki, aktywneBudzety, stanBudzetu, stanCelu,
  PRYWATNE, czyPrywatna, kluczPodmiotu, nazwaPodmiotu,
} from './dane.js';
import { filtry as filtryListy } from './lista.js';
import { ikonaSvg } from './ikony.js';

const OKRESY = [['ten-miesiac', 'Ten miesiąc'], ['poprzedni', 'Poprzedni miesiąc'], ['kwartal', 'Ten kwartał'], ['rok', 'Ten rok'], ['12m', 'Ostatnie 12 miesięcy'], ['wlasny', 'Własny']];

const stan = {
  okres: 'ten-miesiac', od: '', do: '', panel: false,
  konta: new Set(), podmioty: new Set(), kategorie: new Set(),
};

function zakres() {
  const dzis = dataLok();
  const poczMies = dzis.slice(0, 7) + '-01';
  const konMies = d => dodajDni(przesunDate(d.slice(0, 7) + '-01', 'miesiąc', 1), -1);
  switch (stan.okres) {
    case 'poprzedni': { const od = przesunDate(poczMies, 'miesiąc', -1); return [od, konMies(od)]; }
    case 'kwartal': {
      const m = Math.floor((Number(dzis.slice(5, 7)) - 1) / 3) * 3 + 1;
      const od = `${dzis.slice(0, 4)}-${String(m).padStart(2, '0')}-01`;
      return [od, dodajDni(przesunDate(od, 'miesiąc', 3), -1)];
    }
    case 'rok': return [dzis.slice(0, 4) + '-01-01', dzis.slice(0, 4) + '-12-31'];
    case '12m': return [przesunDate(poczMies, 'miesiąc', -11), konMies(dzis)];
    case 'wlasny': {
      const od = stan.od || poczMies;
      const do_ = stan.do && stan.do >= od ? stan.do : konMies(od);
      return [od, do_];
    }
    default: return [poczMies, konMies(dzis)];
  }
}

function opisZakresu(od, do_) {
  if (od.slice(8) === '01' && do_ === dodajDni(przesunDate(od, 'miesiąc', 1), -1)) return nazwaMiesiaca(od.slice(0, 7));
  const r = (a, b) => (a.slice(0, 4) === b.slice(0, 4) ? '' : ' ' + a.slice(0, 4));
  return `${dataKrotko(od)}${r(od, do_)} – ${dataKrotko(do_)} ${do_.slice(0, 4)}`;
}

function pasuje(t) {
  if (t.status === 'anulowana') return false;
  if (stan.konta.size && !stan.konta.has(t.konto)) return false;
  if (stan.podmioty.size && !stan.podmioty.has(kluczPodmiotu(t))) return false;
  if (czyPrywatna(t) && !stan.podmioty.has(PRYWATNE)) return false;   // prywatne tylko na wyraźne życzenie
  if (stan.kategorie.size && !stan.kategorie.has(t.kategoria) && !stan.kategorie.has(t.zrodlo_przychodu)) return false;
  return true;
}

/** Wpływy i wydatki (bez przeksięgowań i pożyczek) w zakresie dat. */
function zbierz(od, do_) {
  const wynik = { wplywy: 0, wydatki: 0, bezKursu: 0, czeka: 0, lista: [] };
  for (const t of dane.transakcje) {
    const d = String(t.data_operacji || '');
    if (d < od || d > do_ || !pasuje(t) || czyPrzeks(t) || czyPozyczkowa(t)) continue;
    if (t.typ !== 'wpływ' && t.typ !== 'wydatek') continue;
    if (t.status === 'oczekuje na wyciąg') wynik.czeka++;
    const k = kwotaPLN(t);
    if (k === null) { wynik.bezKursu++; continue; }
    wynik.lista.push({ t, k });
    if (t.typ === 'wpływ') wynik.wplywy += k; else wynik.wydatki += k;
  }
  wynik.wplywy = zaokr(wynik.wplywy);
  wynik.wydatki = zaokr(wynik.wydatki);
  return wynik;
}

function zmiana(teraz, wczesniej) {
  if (!wczesniej) return teraz ? 'brak danych z poprzedniego okresu' : '';
  const p = ((teraz - wczesniej) / Math.abs(wczesniej)) * 100;
  if (Math.abs(p) < 0.5) return 'tak samo jak w poprzednim okresie';
  return `${p > 0 ? '▲' : '▼'} ${fmt2.format(Math.abs(p)).replace(/,00$/, '')}% wobec poprzedniego okresu`;
}

// ── przedziały czasu na wykresie ──

function przedzialy(od, do_) {
  const dni = roznicaDni(do_, od) + 1;
  const wynik = [];
  if (dni <= 35) {
    for (let d = od; d <= do_; d = dodajDni(d, 1)) wynik.push({ od: d, do: d, etykieta: String(Number(d.slice(8))), pelna: dataKrotko(d) });
  } else if (dni <= 125) {
    const pocz = dodajDni(od, -((new Date(od + 'T12:00:00').getDay() + 6) % 7));
    for (let d = pocz; d <= do_; d = dodajDni(d, 7)) {
      const k = dodajDni(d, 6);
      wynik.push({ od: d < od ? od : d, do: k > do_ ? do_ : k, etykieta: dataKrotko(d < od ? od : d), pelna: `${dataKrotko(d < od ? od : d)} – ${dataKrotko(k > do_ ? do_ : k)}` });
    }
  } else {
    for (let d = od.slice(0, 7) + '-01'; d <= do_; d = przesunDate(d, 'miesiąc', 1)) {
      const k = dodajDni(przesunDate(d, 'miesiąc', 1), -1);
      const nazwa = new Date(d + 'T12:00:00').toLocaleDateString('pl-PL', { month: 'short' });
      wynik.push({ od: d < od ? od : d, do: k > do_ ? do_ : k, etykieta: nazwa, pelna: nazwaMiesiaca(d.slice(0, 7)) });
    }
  }
  return wynik;
}

const krotko = n => {
  const a = Math.abs(n);
  if (a >= 1e6) return fmt2.format(n / 1e6).replace(/,00$/, '') + ' mln';
  if (a >= 1e4) return Math.round(n / 1000) + ' tys.';
  if (a >= 1e3) return fmt2.format(n / 1000).replace(/0$/, '').replace(/,0$/, '') + ' tys.';
  return String(Math.round(n));
};

function podzialkaY(max) {
  if (max <= 0) return [0, 1];
  const surowy = max / 4;
  const potega = 10 ** Math.floor(Math.log10(surowy));
  const krok = [1, 2, 2.5, 5, 10].map(x => x * potega).find(x => x >= surowy);
  const linie = [];
  for (let v = 0; v <= max + krok * 0.001; v += krok) linie.push(v);
  if (linie[linie.length - 1] < max) linie.push(linie[linie.length - 1] + krok);
  return linie;
}

// ── wykres słupkowy: wpływy i wydatki w czasie ──

function wykresSlupkowy(kubly, szer) {
  const H = 240, lewo = 52, prawo = 8, gora = 10, dol = 26;
  const W = Math.max(280, szer);
  const max = Math.max(...kubly.map(k => Math.max(k.wplywy, k.wydatki)), 0);
  const linie = podzialkaY(max);
  const skala = linie[linie.length - 1] || 1;
  const pole = (W - lewo - prawo) / kubly.length;
  const szerSlupka = Math.max(2, Math.min(22, (pole - 6) / 2 - 1));
  const y = v => gora + (H - gora - dol) * (1 - v / skala);
  const co = Math.ceil(kubly.length / Math.max(1, Math.floor((W - lewo) / 46)));
  const slupek = (x, v, klasa) => {
    if (v <= 0) return '';
    const yv = y(v), y0 = y(0), r = Math.min(4, szerSlupka / 2, y0 - yv);
    return `<path class="${klasa}" d="M${x},${y0} V${yv + r} Q${x},${yv} ${x + r},${yv} H${x + szerSlupka - r} Q${x + szerSlupka},${yv} ${x + szerSlupka},${yv + r} V${y0} Z"/>`;
  };
  return `<svg class="wykres" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Wpływy i wydatki w czasie">
    ${linie.map(v => `<line class="siatka" x1="${lewo}" x2="${W - prawo}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="os" x="${lewo - 6}" y="${y(v) + 4}" text-anchor="end">${esc(krotko(v))}</text>`).join('')}
    ${kubly.map((k, i) => {
      const x0 = lewo + i * pole + (pole - (szerSlupka * 2 + 2)) / 2;
      return `<g>
        ${slupek(x0, k.wplywy, 'seria-wplywy')}${slupek(x0 + szerSlupka + 2, k.wydatki, 'seria-wydatki')}
        ${i % co === 0 ? `<text class="os" x="${lewo + i * pole + pole / 2}" y="${H - 8}" text-anchor="middle">${esc(k.etykieta)}</text>` : ''}
        <rect class="cel-dotyku" x="${lewo + i * pole}" y="${gora}" width="${pole}" height="${H - gora - dol}" data-i="${i}" tabindex="0"/>
      </g>`;
    }).join('')}
    <line class="os-zero" x1="${lewo}" x2="${W - prawo}" y1="${y(0)}" y2="${y(0)}"/>
  </svg>`;
}

// ── wykres liniowy: wynik narastająco ──

function wykresLiniowy(punkty, szer) {
  const H = 200, lewo = 52, prawo = 10, gora = 12, dol = 26;
  const W = Math.max(280, szer);
  const wart = punkty.map(p => p.v);
  const min = Math.min(0, ...wart), max = Math.max(0, ...wart);
  const linieDod = podzialkaY(max > 0 ? max : 0).filter(v => v > 0);
  const linieUj = min < 0 ? podzialkaY(-min).filter(v => v > 0).map(v => -v) : [];
  const g = Math.max(...linieDod, max, 1), d = Math.min(...linieUj, min, 0);
  const x = i => lewo + (punkty.length > 1 ? (i / (punkty.length - 1)) * (W - lewo - prawo) : (W - lewo - prawo) / 2);
  const y = v => gora + (H - gora - dol) * (g - v) / (g - d || 1);
  const sciezka = punkty.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const co = Math.ceil(punkty.length / Math.max(1, Math.floor((W - lewo) / 56)));
  const ost = punkty[punkty.length - 1];
  return `<svg class="wykres" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Wynik narastająco">
    ${[...linieUj, 0, ...linieDod].map(v => `<line class="${v === 0 ? 'os-zero' : 'siatka'}" x1="${lewo}" x2="${W - prawo}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="os" x="${lewo - 6}" y="${y(v) + 4}" text-anchor="end">${esc(krotko(v))}</text>`).join('')}
    <path class="linia-wyniku" d="${sciezka}"/>
    ${ost ? `<circle class="punkt-wyniku" cx="${x(punkty.length - 1)}" cy="${y(ost.v)}" r="4.5"/>` : ''}
    ${punkty.map((p, i) => (i % co === 0 ? `<text class="os" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(dataKrotko(p.d))}</text>` : '')).join('')}
    <line class="krzyz" x1="0" x2="0" y1="${gora}" y2="${H - dol}" hidden/>
    <rect class="cel-dotyku linia" x="${lewo}" y="${gora}" width="${W - lewo - prawo}" height="${H - gora - dol}" data-n="${punkty.length}"/>
  </svg>`;
}

// ── zestawienia ──

function rankingKategorii(lista, typ, ile = 8) {
  const mapa = new Map();
  lista.filter(x => x.t.typ === typ).forEach(({ t, k }) => {
    const nazwa = (typ === 'wpływ' ? t.zrodlo_przychodu : t.kategoria) || 'Bez kategorii';
    mapa.set(nazwa, (mapa.get(nazwa) || 0) + k);
  });
  const wszystkie = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  const suma = wszystkie.reduce((s, [, v]) => s + v, 0);
  const pokaz = wszystkie.slice(0, ile);
  const reszta = wszystkie.slice(ile).reduce((s, [, v]) => s + v, 0);
  if (reszta > 0) pokaz.push([`Pozostałe (${wszystkie.length - ile})`, reszta, true]);
  return { pozycje: pokaz, suma };
}

function htmlRankingu({ pozycje, suma }, typ) {
  if (!pozycje.length) return `<p class="pusto">Brak ${typ === 'wpływ' ? 'wpływów' : 'wydatków'} w tym okresie.</p>`;
  const max = pozycje[0][1] || 1;
  return `<ol class="ranking">${pozycje.map(([nazwa, v, reszta]) => `
    <li>
      <${reszta ? 'div' : `button type="button" data-akcja="do-listy" data-kategoria="${esc(nazwa)}" data-typ="${typ}"`} class="pozycja-rankingu">
        <span class="ikona" style="--tlo:${esc(reszta ? '#E4E7E5' : kolorKategorii(nazwa, typ))}" aria-hidden="true">${esc(reszta ? '…' : ikona(nazwa, typ))}</span>
        <span class="opis-rankingu"><span class="nazwa">${esc(nazwa)}</span>
          <span class="pasek-rankingu"><span class="${typ === 'wpływ' ? 'seria-wplywy' : 'seria-wydatki'}" style="width:${Math.max(1.5, (v / max) * 100).toFixed(1)}%"></span></span></span>
        <span class="wartosc-rankingu"><b>${esc(kwotaTxt(zaokr(v)))}</b><span>${suma ? Math.round((v / suma) * 100) : 0}%</span></span>
      </${reszta ? 'div' : 'button'}>
    </li>`).join('')}</ol>`;
}

function htmlKontrahentow(lista) {
  const mapa = new Map();
  lista.filter(x => x.t.typ === 'wydatek').forEach(({ t, k }) => {
    const n = String(t.kontrahent || '').trim() || '(bez tytułu)';
    const e = mapa.get(n) || { v: 0, n: 0 };
    e.v += k; e.n++;
    mapa.set(n, e);
  });
  const top = [...mapa.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 8);
  if (!top.length) return '<p class="pusto">Brak wydatków w tym okresie.</p>';
  return `<table class="tabela"><thead><tr><th>Tytuł / kontrahent</th><th class="liczba">Transakcji</th><th class="liczba">Kwota</th></tr></thead>
    <tbody>${top.map(([n, e]) => `<tr><td>${esc(n)}</td><td class="liczba">${e.n}</td><td class="liczba">${esc(kwotaTxt(zaokr(e.v)))}</td></tr>`).join('')}</tbody></table>`;
}

function htmlPodmiotow(lista) {
  const mapa = new Map();
  lista.forEach(({ t, k }) => {
    const p = kluczPodmiotu(t);
    const e = mapa.get(p) || { wpl: 0, wyd: 0 };
    if (t.typ === 'wpływ') e.wpl += k; else e.wyd += k;
    mapa.set(p, e);
  });
  const wiersze = [...podmioty(), ''].map(p => [p, mapa.get(p) || { wpl: 0, wyd: 0 }]).filter(([, e]) => e.wpl || e.wyd);
  if (!wiersze.length) return '<p class="pusto">Brak danych w tym okresie.</p>';
  return `<table class="tabela"><thead><tr><th>Dotyczy</th><th class="liczba">Wpływy</th><th class="liczba">Wydatki</th><th class="liczba">Wynik</th></tr></thead>
    <tbody>${wiersze.map(([p, e]) => `<tr><td>${esc(nazwaPodmiotu(p))}</td><td class="liczba">${esc(kwotaTxt(zaokr(e.wpl)))}</td>
      <td class="liczba">${esc(kwotaTxt(zaokr(e.wyd)))}</td><td class="liczba"><b>${esc(kwotaTxt(zaokr(e.wpl - e.wyd)))}</b></td></tr>`).join('')}</tbody></table>`;
}

function htmlKont() {
  const s = stanKont();
  const l = konta().filter(k => !stan.konta.size || stan.konta.has(k.nazwa));
  return `<ul class="lista-kont">${l.map(k => {
    const salda = Object.entries(s.get(k.nazwa)?.salda || {});
    return `<li><span class="etykieta-konta" style="--k:${esc(k.kolor)}">${esc(k.nazwa)}</span>
      <span class="saldo-konta">${salda.length ? salda.map(([w, v]) => `<b class="${v < 0 ? 'minus' : ''}">${esc(kwotaTxt(v, w))}</b>`).join(' ') : '<span class="pusto">saldo nieustalone</span>'}</span></li>`;
  }).join('')}</ul>`;
}

function htmlPlanuIPozyczek() {
  const dzis = dataLok(), za30 = dodajDni(dzis, 30);
  let wpl = 0, wyd = 0, zal = 0;
  aktywnePlanowane().filter(p => (p.waluta || 'PLN') === 'PLN' && kierunekPlanu(p) !== 'przesunięcie' && p.podmiot !== PRYWATNE).forEach(p => terminy(p, za30).forEach(d => {
    const k = Number(p.kwota) || 0;
    if (d < dzis) zal++;
    if (kierunekPlanu(p) === 'wpływ') wpl += k; else wyd += k;
  }));
  const poz = { 'do-odzyskania': 0, 'do-oddania': 0 };
  dane.pozyczki.filter(p => p.status === 'aktywna' && (p.waluta || 'PLN') === 'PLN' && p.podmiot !== PRYWATNE).forEach(p => { poz[stronaPozyczki(p)] += stanPozyczki(p).pozostalo; });
  return `<dl class="mini">
    <div><dt><a href="#planowane">Planowane wpływy, 30 dni</a></dt><dd>${esc(kwotaTxt(zaokr(wpl)))}</dd></div>
    <div><dt><a href="#planowane">Planowane wydatki, 30 dni</a></dt><dd>${esc(kwotaTxt(zaokr(wyd)))}</dd></div>
    <div><dt><a href="#planowane">Zaległe płatności</a></dt><dd>${zal}</dd></div>
    <div><dt><a href="#pozyczki">Pożyczki do odzyskania</a></dt><dd class="poz-plus">${esc(kwotaTxt(zaokr(poz['do-odzyskania'])))}</dd></div>
    <div><dt><a href="#pozyczki">Pożyczki do oddania</a></dt><dd class="poz-minus">${esc(kwotaTxt(zaokr(poz['do-oddania'])))}</dd></div>
  </dl>`;
}

function htmlBudzetow() {
  const l = aktywneBudzety();
  if (!l.length) return '<p class="pusto">Nie masz budżetów ani celów. <a href="#budzety">Utwórz</a></p>';
  return `<ul class="lista-budzetow">${l.slice(0, 6).map(b => {
    const cel = b.rodzaj === 'cel';
    const s = cel ? stanCelu(b) : stanBudzetu(b);
    const v = cel ? s.zebrano : s.wydane;
    const dop = cel && s.wydano ? `, wydano ${kwotaTxt(s.wydano)}` : '';
    const ponad = !cel && v > s.kwota;
    return `<li><a href="#budzet/${encodeURIComponent(b.id)}"><span class="nazwa">${esc(b.nazwa)}</span>
      <span class="pasek"><span style="width:${Math.min(100, s.procent * 100).toFixed(1)}%;${ponad ? 'background:var(--czerwien)' : cel ? 'background:var(--wplyw)' : ''}"></span></span>
      <span class="wartosc">${cel ? 'odłożono ' : ''}${esc(kwotaTxt(v))} z ${esc(kwotaTxt(s.kwota))}${esc(dop)}</span></a></li>`;
  }).join('')}</ul>`;
}

function panelFiltrow() {
  const grupa = (nazwa, tytul, opcje, wybrane) => `<fieldset class="grupa-filtru"><legend>${esc(tytul)}</legend><div class="chipy male">${opcje.map(([v, e, kolor]) =>
    `<button type="button" class="chip ${kolor ? 'konto-chip' : ''}" ${kolor ? `style="--k:${esc(kolor)}"` : ''} data-akcja="f-${nazwa}" data-v="${esc(v)}" aria-pressed="${wybrane.has(v)}">${esc(e)}</button>`).join('')}</div></fieldset>`;
  return `<div class="panel-filtrow">
    ${grupa('konta', 'Konta', konta().map(k => [k.nazwa, k.nazwa, k.kolor]), stan.konta)}
    ${grupa('podmioty', 'Dotyczy', [...podmioty(), ''].map(p => [p, nazwaPodmiotu(p)]), stan.podmioty)}
    ${grupa('kategorie', 'Kategorie', [...glowne('wydatek').map(k => [k.nazwa, k.nazwa]), ...glowne('wpływ').map(k => [k.nazwa, k.nazwa + ' (wpływ)'])], stan.kategorie)}
    <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="wyczysc">Wyczyść filtry</button>
      <button type="button" data-akcja="panel">Gotowe</button></div>
  </div>`;
}

let daneWykresow = { kubly: [], punkty: [] };

export function render() {
  const [od, do_] = zakres();
  const dzis = dataLok();
  // trwający okres porównujemy „do dziś” z tym samym odcinkiem poprzedniego okresu
  const koniecPor = od <= dzis && dzis < do_ ? dzis : do_;
  const miesiace = { 'ten-miesiac': 1, poprzedni: 1, kwartal: 3, rok: 12, '12m': 12 }[stan.okres];
  const dni = roznicaDni(do_, od) + 1;
  const poprzedni = miesiace
    ? [przesunDate(od, 'miesiąc', -miesiace), przesunDate(koniecPor, 'miesiąc', -miesiace)]
    : [dodajDni(od, -dni), dodajDni(koniecPor, -dni)];
  const teraz = zbierz(od, do_);
  const wczesniej = zbierz(...poprzedni);
  const porownanieDoDzis = koniecPor !== do_;
  const wynik = zaokr(teraz.wplywy - teraz.wydatki);
  const nFiltrow = stan.konta.size + stan.podmioty.size + stan.kategorie.size;

  const kubly = przedzialy(od, do_).map(k => ({ ...k, wplywy: 0, wydatki: 0 }));
  teraz.lista.forEach(({ t, k }) => {
    const kb = kubly.find(x => t.data_operacji >= x.od && t.data_operacji <= x.do);
    if (!kb) return;
    if (t.typ === 'wpływ') kb.wplywy += k; else kb.wydatki += k;
  });
  kubly.forEach(k => { k.wplywy = zaokr(k.wplywy); k.wydatki = zaokr(k.wydatki); });
  const koniecLinii = do_ < dataLok() ? do_ : (od <= dataLok() ? dataLok() : do_);
  const punkty = [];
  let suma = 0;
  const dzienne = new Map();
  teraz.lista.forEach(({ t, k }) => dzienne.set(t.data_operacji, (dzienne.get(t.data_operacji) || 0) + (t.typ === 'wpływ' ? k : -k)));
  for (let d = od; d <= koniecLinii; d = dodajDni(d, 1)) { suma += dzienne.get(d) || 0; punkty.push({ d, v: zaokr(suma) }); }
  daneWykresow = { kubly, punkty };

  const szer = Math.min(($('#widok').clientWidth || 900) - 40, 1200);

  $('#widok').innerHTML = `
  <section class="ekran podsumowanie-ekran">
    <div class="naglowek-sekcji"><h1>Podsumowanie</h1><span class="okres-tytul">${esc(opisZakresu(od, do_))}</span></div>
    <div class="pasek-filtrow">
      <div class="chipy male" role="group" aria-label="Okres analizy">${OKRESY.map(([o, e]) =>
        `<button type="button" class="chip" data-akcja="okres" data-v="${o}" aria-pressed="${stan.okres === o}">${e}</button>`).join('')}</div>
      ${stan.okres === 'wlasny' ? `<div class="zakres-dat">
        <label><span class="etykieta">Od</span><input type="date" name="od" value="${esc(od)}"></label>
        <label><span class="etykieta">Do</span><input type="date" name="do" value="${esc(do_)}" min="${esc(od)}"></label></div>` : ''}
      <button type="button" class="drugorzedny przycisk-ikona" data-akcja="panel" aria-expanded="${stan.panel}">${ikonaSvg('filtr')} Filtry${nFiltrow ? ` <span class="licznik">${nFiltrow}</span>` : ''}</button>
    </div>
    ${stan.panel ? panelFiltrow() : ''}

    <div class="kafle-wskaznikow">
      <div class="wskaznik"><span class="etykieta-wsk"><i class="znak seria-wplywy"></i>Wpływy</span><b>${esc(kwotaTxt(teraz.wplywy))}</b><span class="zmiana">${esc(zmiana(teraz.wplywy, wczesniej.wplywy))}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk"><i class="znak seria-wydatki"></i>Wydatki</span><b>${esc(kwotaTxt(teraz.wydatki))}</b><span class="zmiana">${esc(zmiana(teraz.wydatki, wczesniej.wydatki))}</span></div>
      <div class="wskaznik wyroznione"><span class="etykieta-wsk">Wynik</span><b class="${wynik < 0 ? 'minus' : 'plus'}">${wynik > 0 ? '+' : ''}${esc(kwotaTxt(wynik))}</b><span class="zmiana">poprzednio ${esc(kwotaTxt(zaokr(wczesniej.wplywy - wczesniej.wydatki)))}</span></div>
      <div class="wskaznik"><span class="etykieta-wsk">Czeka na wyciąg</span><b>${teraz.czeka}</b><span class="zmiana">${teraz.lista.length} ${odmiana(teraz.lista.length, 'transakcja', 'transakcje', 'transakcji')} w okresie</span></div>
    </div>
    <p class="uwagi-podsumowania">${stan.podmioty.has(PRYWATNE) ? 'Z prywatnymi' : 'Bez prywatnych'}, bez przeksięgowań, pożyczek i anulowanych${nFiltrow ? ', według filtrów' : ''}. Porównanie ${porownanieDoDzis ? 'do dziś ' : ''}z okresem ${esc(opisZakresu(...poprzedni))}.${teraz.bezKursu ? ` Niewliczone, bo czekają na kurs NBP: ${teraz.bezKursu}.` : ''}</p>

    <div class="siatka-paneli">
      <article class="panel szeroki">
        <header><h2>Wpływy i wydatki</h2>
          <ul class="legenda"><li><i class="znak seria-wplywy"></i>Wpływy</li><li><i class="znak seria-wydatki"></i>Wydatki</li></ul></header>
        <div class="wykres-kontener" data-wykres="slupki">${wykresSlupkowy(kubly, szer - 36)}<div class="dymek" hidden></div></div>
        <details class="tabela-wykresu"><summary>Pokaż jako tabelę</summary>
          <table class="tabela"><thead><tr><th>Okres</th><th class="liczba">Wpływy</th><th class="liczba">Wydatki</th><th class="liczba">Wynik</th></tr></thead>
          <tbody>${kubly.filter(k => k.wplywy || k.wydatki).map(k => `<tr><td>${esc(k.pelna)}</td><td class="liczba">${esc(kwotaTxt(k.wplywy))}</td><td class="liczba">${esc(kwotaTxt(k.wydatki))}</td><td class="liczba">${esc(kwotaTxt(zaokr(k.wplywy - k.wydatki)))}</td></tr>`).join('') || '<tr><td colspan="4">Brak danych</td></tr>'}</tbody></table>
        </details>
      </article>

      <article class="panel szeroki">
        <header><h2>Wynik narastająco</h2><span class="podtytul">${punkty.length ? `na ${esc(dataKrotko(punkty[punkty.length - 1].d))}: <b>${esc(kwotaTxt(punkty[punkty.length - 1].v))}</b>` : ''}</span></header>
        <div class="wykres-kontener" data-wykres="linia">${punkty.length ? wykresLiniowy(punkty, szer - 36) : '<p class="pusto">Okres jeszcze się nie zaczął.</p>'}<div class="dymek" hidden></div></div>
      </article>

      <article class="panel"><header><h2>Wydatki według kategorii</h2></header>${htmlRankingu(rankingKategorii(teraz.lista, 'wydatek'), 'wydatek')}</article>
      <article class="panel"><header><h2>Wpływy według źródła</h2></header>${htmlRankingu(rankingKategorii(teraz.lista, 'wpływ'), 'wpływ')}</article>
      <article class="panel"><header><h2>Najwięksi odbiorcy wydatków</h2></header>${htmlKontrahentow(teraz.lista)}</article>
      <article class="panel"><header><h2>INCO i OFI</h2></header>${htmlPodmiotow(teraz.lista)}</article>
      <article class="panel"><header><h2>Salda kont</h2><span class="podtytul">stan na dziś</span></header>${htmlKont()}</article>
      <article class="panel"><header><h2>Planowane i pożyczki</h2><span class="podtytul">od dziś</span></header>${htmlPlanuIPozyczek()}</article>
      <article class="panel szeroki"><header><h2>Budżety i cele</h2></header>${htmlBudzetow()}</article>
    </div>
  </section>`;
}

// ── dymki na wykresach ──

function pokazDymek(kont, html, px) {
  const d = kont.querySelector('.dymek');
  d.innerHTML = html;
  d.hidden = false;
  const szer = kont.clientWidth;
  const w = d.offsetWidth;
  d.style.left = Math.max(0, Math.min(szer - w, px + 12)) + 'px';
}

function ruch(e) {
  const kont = e.target.closest('.wykres-kontener');
  if (!kont) return;
  const svg = kont.querySelector('svg');
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const skalaX = svg.viewBox.baseVal.width / r.width;
  const px = (e.clientX - r.left);
  if (kont.dataset.wykres === 'slupki') {
    const cel = e.target.closest('.cel-dotyku');
    $$('.cel-dotyku.aktywny', kont).forEach(x => x.classList.remove('aktywny'));
    if (!cel) { kont.querySelector('.dymek').hidden = true; return; }
    cel.classList.add('aktywny');
    const k = daneWykresow.kubly[Number(cel.dataset.i)];
    pokazDymek(kont, `<b>${esc(k.pelna)}</b>
      <span><i class="znak seria-wplywy"></i><b>${esc(kwotaTxt(k.wplywy))}</b> wpływy</span>
      <span><i class="znak seria-wydatki"></i><b>${esc(kwotaTxt(k.wydatki))}</b> wydatki</span>
      <span>wynik <b>${esc(kwotaTxt(zaokr(k.wplywy - k.wydatki)))}</b></span>`, px);
  } else {
    const cel = kont.querySelector('.cel-dotyku.linia');
    const n = daneWykresow.punkty.length;
    if (!cel || !n) return;
    const x0 = Number(cel.getAttribute('x')), w = Number(cel.getAttribute('width'));
    const xv = px * skalaX;
    if (xv < x0 - 4 || xv > x0 + w + 4) { kont.querySelector('.dymek').hidden = true; kont.querySelector('.krzyz').setAttribute('hidden', ''); return; }
    const i = Math.max(0, Math.min(n - 1, Math.round(((xv - x0) / w) * (n - 1))));
    const p = daneWykresow.punkty[i];
    const xk = x0 + (n > 1 ? (i / (n - 1)) * w : w / 2);
    const krzyz = kont.querySelector('.krzyz');
    krzyz.setAttribute('x1', xk); krzyz.setAttribute('x2', xk); krzyz.removeAttribute('hidden');
    pokazDymek(kont, `<b>${esc(dataKrotko(p.d))}</b><span>wynik narastająco <b>${esc(kwotaTxt(p.v))}</b></span>`, xk / skalaX);
  }
}

function wyjscie(e) {
  const kont = e.target.closest?.('.wykres-kontener');
  if (!kont || kont.contains(e.relatedTarget)) return;
  kont.querySelector('.dymek').hidden = true;
  kont.querySelector('.krzyz')?.setAttribute('hidden', '');
  $$('.cel-dotyku.aktywny', kont).forEach(x => x.classList.remove('aktywny'));
}

let podpiete = false;
function podepnij() {
  if (podpiete) return;
  podpiete = true;
  const w = $('#widok');
  w.addEventListener('pointermove', e => { if ($('.podsumowanie-ekran')) ruch(e); });
  w.addEventListener('focusin', e => {
    if (!$('.podsumowanie-ekran') || !e.target.classList?.contains('cel-dotyku')) return;
    const r = e.target.getBoundingClientRect();
    ruch({ target: e.target, clientX: r.left + r.width / 2 });
  });
  w.addEventListener('pointerout', e => { if ($('.podsumowanie-ekran')) wyjscie(e); });
  let zegar;
  window.addEventListener('resize', () => {
    clearTimeout(zegar);
    zegar = setTimeout(() => { if ($('.podsumowanie-ekran')) render(); }, 200);
  });
}

function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'okres') stan.okres = v;
  else if (akcja === 'panel') stan.panel = !stan.panel;
  else if (akcja === 'wyczysc') { stan.konta.clear(); stan.podmioty.clear(); stan.kategorie.clear(); }
  else if (akcja.startsWith('f-')) { const z = stan[akcja.slice(2)]; if (z.has(v)) z.delete(v); else z.add(v); }
  else if (akcja === 'do-listy') {
    const [od, do_] = zakres();
    ['rodzaje', 'konta', 'kategorie', 'podmioty', 'statusy'].forEach(k => filtryListy[k].clear());
    filtryListy.kategorie.add(b.dataset.kategoria);
    filtryListy.rodzaje.add(b.dataset.typ === 'wpływ' ? 'wplywy' : 'wydatki');
    stan.konta.forEach(k => filtryListy.konta.add(k));
    stan.podmioty.forEach(p => filtryListy.podmioty.add(p));
    if (od.slice(0, 7) === do_.slice(0, 7)) { filtryListy.zakres = 'miesiac'; filtryListy.miesiac = od.slice(0, 7); }
    else if (od.slice(0, 4) === do_.slice(0, 4)) { filtryListy.zakres = 'rok'; filtryListy.rok = od.slice(0, 4); }
    else filtryListy.zakres = 'wszystko';
    location.hash = '#lista';
    return;
  } else return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

function zmianaPola(e) {
  if (e.target.name === 'od') stan.od = e.target.value;
  else if (e.target.name === 'do') stan.do = e.target.value;
  else return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

export const ekran = { render: () => { podepnij(); render(); }, klik, zmiana: zmianaPola };
