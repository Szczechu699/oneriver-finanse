// Ekran „Dodaj”: wpis transakcji na wzór Cashew, także edycja transakcji i pozycji planowanych.

import * as sync from './sync.js';
import { wywolaj } from './api.js';
import {
  $, esc, zaokr, fmt2, fmt4, symbol, kwotaTxt, dataLok, dodajDni, roznicaDni, dataSlownie, uuid,
  liczba, liczbaNaTekst, toast, okno, bezSkoku, nazwaMiesiaca,
} from './util.js';
import {
  dane, wczytajDane, atrybuty, lista, konta, walutaKonta, waluty, glowne, podrzedne, podmioty, ikona, KOLORY,
  kierunek, grupy, grupaDla, zalaczniki, WYMIANA, RYTMY, budzetyDoWyboru, aktywneBudzety, stanBudzetu, kategorieBudzetu,
} from './dane.js';

let f = null;
const MAKS_MB = 15;

function pamiec() {
  try { return JSON.parse(localStorage.getItem('or-finanse-ostatnie')) || {}; } catch { return {}; }
}
function zapamietaj(zmiana) {
  localStorage.setItem('or-finanse-ostatnie', JSON.stringify({ ...pamiec(), ...zmiana }));
}

function nowyFormularz(zostaw = {}) {
  const pam = pamiec();
  return {
    tryb: 'nowy', planId: null, rodzajWpisu: 'zwykła', oryginaly: [], planOryginal: null,
    typ: zostaw.typ || 'wydatek',
    kwota: '', waluta: zostaw.waluta || '',
    konto: zostaw.konto || pam.konto || '',
    konto_docelowe: '', kwota_do: '',
    kategoria: '', podkategoria: '', podzial: null, podzialId: null,
    kontrahent: '', podmiot: zostaw.podmiot ?? pam.podmiot ?? '',
    tagi: '', data: zostaw.data || dataLok(),
    nr_dokumentu: '', opis: '', budzet: '',
    zalaczniki: [],
    powtarzanie: 'miesiąc', co_ile: '1', data_koniec: '', subskrypcja: false,
    podpowiedz: '', nbp: {},
  };
}

export function resetuj() { f = null; }

// ── wczytanie do edycji ──

function formularzZGrupy(g) {
  const t = g.glowna;
  const nf = nowyFormularz();
  const wspolne = {
    tryb: 'edycja', data: t.data_operacji || dataLok(), tagi: t.tagi || '', nr_dokumentu: t.nr_dokumentu || '',
    opis: t.opis || '', zalaczniki: zalaczniki(t.zalacznik),
  };
  if (g.rodzaj === 'przeksiegowanie' || g.rodzaj === 'wymiana') {
    return {
      ...nf, ...wspolne, typ: g.rodzaj === 'wymiana' ? 'wymiana' : 'przeksięgowanie', oryginaly: g.czesci,
      kwota: liczbaNaTekst(g.z.kwota), waluta: g.z.waluta, konto: g.z.konto,
      konto_docelowe: g.na?.konto || '', kwota_do: g.na && g.na.waluta !== g.z.waluta ? liczbaNaTekst(g.na.kwota) : '',
    };
  }
  const typ = t.typ === 'wpływ' ? 'wpływ' : 'wydatek';
  const kat = c => (typ === 'wpływ' ? c.zrodlo_przychodu || '' : c.kategoria || '');
  return {
    ...nf, ...wspolne, typ, oryginaly: g.czesci,
    kwota: liczbaNaTekst(g.kwota), waluta: t.waluta || '', konto: t.konto || '',
    kategoria: g.rodzaj === 'podzial' ? '' : kat(t), podkategoria: g.rodzaj === 'podzial' ? '' : (t.podkategoria || ''),
    podzial: g.rodzaj === 'podzial' ? g.czesci.map(c => ({ kategoria: kat(c), podkategoria: c.podkategoria || '', kwota: liczbaNaTekst(c.kwota) })) : null,
    podzialId: t.podzial_id || null,
    kontrahent: t.kontrahent || '', podmiot: t.podmiot || '', budzet: t.budzet || '',
  };
}

function formularzZPlanu(p) {
  const nf = nowyFormularz();
  const typ = p.typ === 'wpływ' ? 'wpływ' : 'wydatek';
  return {
    ...nf, tryb: 'edycja', planId: p.id, planOryginal: p,
    rodzajWpisu: p.rodzaj === 'jednorazowa' ? 'nadchodząca' : 'powtarzalna', subskrypcja: p.rodzaj === 'subskrypcja',
    typ, kwota: liczbaNaTekst(p.kwota), waluta: p.waluta || '', konto: p.konto || '',
    kategoria: typ === 'wpływ' ? (p.zrodlo_przychodu || '') : (p.kategoria || ''), podkategoria: p.podkategoria || '',
    kontrahent: p.kontrahent || '', podmiot: p.podmiot || '', tagi: p.tagi || '', opis: p.opis || '',
    data: p.nastepna_data || p.data_start || dataLok(), budzet: p.budzet || '',
    powtarzanie: p.powtarzanie || 'miesiąc', co_ile: String(p.co_ile || 1), data_koniec: p.data_koniec || '',
  };
}

// ── kwota ──

function grupujCyfry(s) {
  const [c, d] = s.split(',');
  const cg = (c || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return d !== undefined ? cg + ',' + d : cg;
}
const walutaFormularza = () => walutaKonta(f.konto) || f.waluta || 'PLN';
const walutaDocelowa = () => walutaKonta(f.konto_docelowe) || (f.typ === 'wymiana' ? '' : walutaFormularza());
const czyPlan = () => f.rodzajWpisu !== 'zwykła';
const czyMiedzyKontami = () => f.typ === 'przeksięgowanie' || f.typ === 'wymiana';

export function klawisz(k) {
  if (!f || !$('.dodaj')) return;
  let s = f.kwota;
  const ost = s.split('+').pop();
  if (k === 'C') s = '';
  else if (k === '⌫') s = s.slice(0, -1);
  else if (k === '+') { if (s && !/[+,]$/.test(s)) s += '+'; }
  else if (k === ',') { if (!ost.includes(',')) s += ost === '' ? '0,' : ','; }
  else {
    if (ost.includes(',') && ost.split(',')[1].length >= 2) return;
    if (ost.replace(',', '').length >= 9) return;
    if (ost === '0') s = s.slice(0, -1);
    s += k;
  }
  f.kwota = s;
  odswiezKwote();
}

function odswiezKwote() {
  const el = $('.kwota');
  if (!el) return;
  const czesci = f.kwota.split('+');
  const suma = liczba(f.kwota);
  el.querySelector('.wyrazenie').textContent = czesci.length > 1 ? czesci.map(grupujCyfry).join(' + ') + ' =' : '';
  el.querySelector('.wartosc').textContent = czesci.length > 1 ? fmt2.format(suma) : grupujCyfry(czesci[0] || '0');
  el.querySelector('.waluta').textContent = symbol(walutaFormularza());
  const btn = $('.zapisz');
  if (btn) btn.innerHTML = etykietaZapisu();
  odswiezReszte();
  odswiezKursWymiany();
}

function etykietaZapisu() {
  const s = liczba(f.kwota);
  let tekst;
  if (f.tryb === 'edycja') tekst = 'Zapisz zmiany';
  else if (czyPlan()) tekst = f.typ === 'wpływ' ? 'Zaplanuj wpływ' : 'Zaplanuj wydatek';
  else tekst = { wydatek: 'Zapisz wydatek', 'wpływ': 'Zapisz wpływ', 'przeksięgowanie': 'Zapisz przeksięgowanie', wymiana: 'Zapisz wymianę' }[f.typ];
  return `${esc(tekst)}${s > 0 ? ` <span>${esc(kwotaTxt(s, walutaFormularza()))}</span>` : ''}`;
}

// ── podział na kategorie ──

function sumaPodzialu() {
  return zaokr((f.podzial || []).reduce((s, c) => s + liczba(c.kwota), 0));
}
function odswiezReszte() {
  const el = $('.reszta');
  if (!el || !f.podzial) return;
  const roznica = zaokr(liczba(f.kwota) - sumaPodzialu());
  const w = walutaFormularza();
  el.className = 'reszta ' + (Math.abs(roznica) < 0.005 ? 'ok' : 'brak');
  el.textContent = Math.abs(roznica) < 0.005
    ? `Rozdzielono całą kwotę ${kwotaTxt(sumaPodzialu(), w)}.`
    : roznica > 0 ? `Do rozdzielenia zostało ${kwotaTxt(roznica, w)}.` : `Części są większe od kwoty o ${kwotaTxt(-roznica, w)}.`;
}

function opcjeKategorii(typ, wybrana, wybranaPod) {
  const opcje = ['<option value="">Wybierz kategorię</option>'];
  glowne(typ).forEach(k => {
    opcje.push(`<option value="${esc(k.nazwa + '||')}" ${k.nazwa === wybrana && !wybranaPod ? 'selected' : ''}>${esc(k.nazwa)}</option>`);
    podrzedne(typ, k.nazwa).forEach(p => opcje.push(
      `<option value="${esc(k.nazwa + '||' + p.nazwa)}" ${k.nazwa === wybrana && p.nazwa === wybranaPod ? 'selected' : ''}>${esc(k.nazwa + ' › ' + p.nazwa)}</option>`));
  });
  return opcje.join('');
}

function htmlPodzialu() {
  return `<div class="podzial">
    ${f.podzial.map((c, i) => `
      <div class="czesc">
        <select name="podzial-kat" data-i="${i}" aria-label="Kategoria części ${i + 1}">${opcjeKategorii(f.typ, c.kategoria, c.podkategoria)}</select>
        <input name="podzial-kwota" data-i="${i}" inputmode="decimal" autocomplete="off" value="${esc(c.kwota)}" placeholder="kwota" aria-label="Kwota części ${i + 1}">
        <button type="button" class="usun" data-akcja="usun-czesc" data-v="${i}" aria-label="Usuń część ${i + 1}" ${f.podzial.length <= 2 ? 'disabled' : ''}>×</button>
      </div>`).join('')}
    <p class="reszta" aria-live="polite"></p>
    <div class="chipy">
      <button type="button" class="chip" data-akcja="dodaj-czesc">Dodaj część</button>
      <button type="button" class="chip" data-akcja="bez-podzialu">Bez podziału</button>
    </div>
  </div>`;
}

// ── wymiana walut ──

function kursWymiany() {
  const z = liczba(f.kwota), na = liczba(f.kwota_do);
  const wz = walutaFormularza(), wn = walutaDocelowa();
  if (!(z > 0) || !(na > 0) || !wn || wz === wn) return null;
  if (wn !== 'PLN') return { obca: wn, wKrajowej: wz, kurs: z / na };
  return { obca: wz, wKrajowej: wn, kurs: na / z };
}

function odswiezKursWymiany() {
  const el = $('.kurs-wymiany');
  if (!el || f.typ !== 'wymiana') return;
  const k = kursWymiany();
  if (!k) { el.textContent = 'Wpisz obie kwoty, a policzę kurs wymiany.'; return; }
  let tekst = `Kurs wymiany: 1 ${k.obca} = ${fmt4.format(k.kurs)} ${k.wKrajowej}.`;
  if (k.wKrajowej === 'PLN') {
    const klucz = `${k.obca}|${f.data}`;
    const nbp = f.nbp[klucz];
    if (nbp && nbp !== 'czeka' && nbp !== 'brak') {
      const roznica = (k.kurs / nbp.kurs - 1) * 100;
      tekst += ` Kurs NBP (tabela z ${dataSlownie(nbp.data_tabeli).toLowerCase()}): ${fmt4.format(nbp.kurs)}, różnica ${roznica > 0 ? '+' : ''}${fmt2.format(roznica)}%.`;
    } else if (!nbp && navigator.onLine) {
      f.nbp[klucz] = 'czeka';
      wywolaj('kursNBP', { waluta: k.obca, data: f.data })
        .then(w => { f.nbp[klucz] = w; }, () => { f.nbp[klucz] = 'brak'; })
        .then(odswiezKursWymiany);
    }
  }
  el.textContent = tekst;
}

// ── fragmenty ekranu ──

function przyciskiKont(pole, wybrane, filtr = () => true) {
  const l = konta().filter(filtr);
  if (!konta().length) return `<p class="pusto">Brak kont. Zsynchronizuj aplikację z arkuszem w Ustawieniach.</p>`;
  if (!l.length) return `<p class="pusto">Brak kont w innej walucie.</p>`;
  return `<div class="chipy">${l.map(k => `
      <button type="button" class="chip" data-akcja="${pole}" data-v="${esc(k.nazwa)}" aria-pressed="${k.nazwa === wybrane}">
        ${esc(k.nazwa)}</button>`).join('')}</div>`;
}

function siatkaKategorii() {
  const l = glowne(f.typ);
  if (!l.length) return `<p class="pusto">Brak pozycji w Słowniku.</p>`;
  return `<div class="siatka">${l.map((k, i) => `
      <button type="button" class="kafel" data-akcja="kategoria" data-v="${esc(k.nazwa)}" aria-pressed="${k.nazwa === f.kategoria}"
        style="--tlo:${esc(atrybuty(k).kolor || KOLORY[i % KOLORY.length])}">
        <span class="ikona" aria-hidden="true">${esc(atrybuty(k).ikona || ikona(k.nazwa, f.typ))}</span>
        <span class="nazwa">${esc(k.nazwa)}</span>
      </button>`).join('')}</div>`;
}

function podpowiedzLimitu() {
  if (f.typ !== 'wydatek') return '';
  const kat = f.podzial ? f.podzial.map(c => c.kategoria) : [f.kategoria];
  const limity = aktywneBudzety().filter(b => b.rodzaj === 'limit' && kategorieBudzetu(b).some(k => kat.includes(k)));
  return limity.map(b => {
    const s = stanBudzetu(b, f.data);
    const okres = b.okres === 'miesiąc' || !b.okres ? nazwaMiesiaca(s.od.slice(0, 7)).toLowerCase() : `${dataSlownie(s.od).toLowerCase()} – ${dataSlownie(s.do).toLowerCase()}`;
    return `<p class="limit ${s.zostalo < 0 ? 'przekroczony' : ''}">Limit „${esc(b.nazwa)}”: ${s.zostalo >= 0
      ? `zostało ${esc(kwotaTxt(s.zostalo))} z ${esc(kwotaTxt(s.kwota))}`
      : `przekroczony o ${esc(kwotaTxt(-s.zostalo))}`} (${esc(okres)}).</p>`;
  }).join('');
}

function htmlZalacznikow() {
  const pliki = f.zalaczniki;
  return `<fieldset class="pole">
    <legend>Załączniki</legend>
    ${pliki.length ? `<ul class="zalaczniki">${pliki.map((z, i) => `
      <li>${z.url ? `<a href="${esc(z.url)}" target="_blank" rel="noopener">${esc(z.nazwa)}</a>` : `<span>${esc(z.nazwa)}</span>`}
        ${!z.url ? `<span class="znacznik wysylka">${z.nowy ? 'nowy' : 'czeka na wysłanie'}</span>` : ''}
        <button type="button" class="usun" data-akcja="usun-zalacznik" data-v="${i}" aria-label="Usuń ${esc(z.nazwa)}">×</button></li>`).join('')}</ul>` : ''}
    <div class="chipy">
      <label class="chip"><input type="file" accept="image/*" capture="environment" data-plik="aparat" hidden>Zrób zdjęcie</label>
      <label class="chip"><input type="file" accept="image/*" multiple data-plik="zdjecie" hidden>Wybierz zdjęcie</label>
      <label class="chip"><input type="file" accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" multiple data-plik="plik" hidden>Wybierz plik</label>
    </div>
    <span class="podpowiedz">Pliki trafią do folderu „One River – Finanse – załączniki” na Dysku Google.</span>
  </fieldset>`;
}

function htmlPlanu() {
  if (f.rodzajWpisu === 'zwykła') return '';
  if (f.rodzajWpisu === 'nadchodząca') return '';
  return `<div class="plan">
    <div class="rzad">
      <label class="pole"><span class="etykieta">Powtarzaj co</span>
        <span class="co-ile">
          <input name="co_ile" type="number" min="1" max="99" inputmode="numeric" value="${esc(f.co_ile)}" aria-label="Ile">
          <select name="powtarzanie" aria-label="Jednostka">${Object.keys(RYTMY).map(r => {
            const n = Number(f.co_ile) || 1;
            const forma = n === 1 ? RYTMY[r][0] : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? RYTMY[r][1] : RYTMY[r][2]);
            return `<option value="${r}" ${f.powtarzanie === r ? 'selected' : ''}>${forma}</option>`;
          }).join('')}</select>
        </span></label>
      <label class="pole"><span class="etykieta">Do kiedy (puste = bez końca)</span>
        <input name="data_koniec" type="date" value="${esc(f.data_koniec)}" min="${esc(f.data)}"></label>
    </div>
    <label class="przelacznik duzy"><input type="checkbox" name="subskrypcja" ${f.subskrypcja ? 'checked' : ''}> To subskrypcja lub abonament</label>
  </div>`;
}

// ── ekran ──

export function renderDodaj(trasa = null, id = null) {
  if (trasa === 'edytuj') {
    if (!f || f.tryb !== 'edycja' || f.planId || !f.oryginaly.some(o => o.id === id)) {
      const g = grupaDla(id);
      if (!g) return brak('Nie ma takiej transakcji', 'Mogła zostać usunięta z arkusza.', '#lista', 'Lista transakcji');
      f = formularzZGrupy(g);
    }
  } else if (trasa === 'plan') {
    if (!f || f.planId !== id) {
      const p = dane.planowane.find(x => x.id === id);
      if (!p) return brak('Nie ma takiej pozycji planowanej', 'Mogła zostać usunięta z arkusza.', '#planowane', 'Planowane');
      f = formularzZPlanu(p);
    }
  } else if (trasa === 'nowy-plan') {
    if (!f || f.tryb === 'edycja' || f.rodzajWpisu === 'zwykła') {
      f = nowyFormularz();
      f.rodzajWpisu = 'nadchodząca';
    }
  } else if (!f || f.tryb === 'edycja') {
    f = nowyFormularz();
  }
  if (!f.konto && konta().length) f.konto = konta()[0].nazwa;
  if (czyMiedzyKontami() || f.podzial) f.rodzajWpisu = f.planId ? f.rodzajWpisu : 'zwykła';

  const miedzy = czyMiedzyKontami();
  const wymiana = f.typ === 'wymiana';
  const plan = czyPlan();
  const kontoBezWaluty = f.konto && !walutaKonta(f.konto);
  const potrzebnaDruga = miedzy && f.konto_docelowe && walutaDocelowa() !== walutaFormularza();
  const pod = miedzy || f.podzial ? [] : podrzedne(f.typ, f.kategoria);
  const anulowana = f.planId ? f.planOryginal?.status === 'anulowana' : f.oryginaly.length && f.oryginaly.every(o => o.status === 'anulowana');
  const potwierdzona = f.oryginaly.some(o => o.status === 'potwierdzona');
  const budzety = budzetyDoWyboru(f.data);
  const wybranyBudzet = f.budzet && dane.budzety.find(b => b.id === f.budzet);
  if (wybranyBudzet && !budzety.includes(wybranyBudzet)) budzety.push(wybranyBudzet);
  const klasaTypu = { wydatek: 'wydatek', 'wpływ': 'wplyw', 'przeksięgowanie': 'przeks', wymiana: 'wymiana' }[f.typ];

  $('#widok').innerHTML = `
  <section class="dodaj typ-${klasaTypu}">
    <div class="kolumna-kwoty">
      <div class="panel-kwoty">
        <div class="typy" role="group" aria-label="Rodzaj transakcji">
          ${[['wydatek', 'Wydatek'], ['wpływ', 'Wpływ'], ['przeksięgowanie', 'Przeksięgowanie'], ['wymiana', 'Wymiana']].map(([t, e]) => `
            <button type="button" data-akcja="typ" data-v="${t}" aria-pressed="${f.typ === t}" ${f.tryb === 'edycja' ? 'disabled' : ''}>${e}</button>`).join('')}
        </div>
        <div class="kwota" aria-live="polite" aria-label="Kwota">
          <span class="wyrazenie"></span>
          <span class="wiersz-kwoty"><span class="wartosc"></span><span class="waluta"></span></span>
          ${wymiana ? '<span class="podpis-kwoty">kwota sprzedana</span>' : ''}
        </div>
      </div>
      <div class="tkanina" aria-hidden="true"></div>
      <div class="klawiatura" role="group" aria-label="Klawiatura kwoty">
        ${['7', '8', '9', 'C', '4', '5', '6', '⌫', '1', '2', '3', '+', ',', '0'].map(k => `
          <button type="button" data-akcja="klawisz" data-v="${k}" class="${/\d/.test(k) ? '' : 'funkcja'} ${k === '0' ? 'szeroki' : ''}"
            aria-label="${{ 'C': 'Wyczyść', '⌫': 'Usuń ostatnią cyfrę', '+': 'Dodaj kolejną kwotę', ',': 'Przecinek' }[k] || k}">${k}</button>`).join('')}
      </div>
    </div>

    <form class="kolumna-szczegolow" novalidate>
      ${f.tryb === 'edycja' ? `<div class="pasek-edycji">
          <span>${f.planId ? 'Edytujesz pozycję planowaną' : 'Edytujesz transakcję'}${anulowana ? ' (anulowaną)' : ''}${potwierdzona ? '. Jest już potwierdzona wyciągiem' : ''}.</span>
          <a href="${f.planId ? '#planowane' : '#lista'}">Wróć do listy</a></div>` : ''}

      ${!miedzy && !f.podzial && (f.tryb === 'nowy' || f.planId) ? `
      <fieldset class="pole">
        <legend>Rodzaj wpisu</legend>
        <div class="chipy">${[['zwykła', 'Zwykła'], ['nadchodząca', 'Nadchodząca'], ['powtarzalna', 'Powtarzalna']].map(([r, e]) => `
          <button type="button" class="chip" data-akcja="rodzaj-wpisu" data-v="${r}" aria-pressed="${f.rodzajWpisu === r}"
            ${f.planId && r === 'zwykła' ? 'disabled' : ''}>${e}</button>`).join('')}</div>
        ${plan ? `<span class="podpowiedz">${f.rodzajWpisu === 'nadchodząca'
          ? 'Trafi do „Planowanych”. Gdy zapłacisz, oznaczysz ją jednym dotknięciem.'
          : 'Trafi do „Planowanych” i będzie wracać w wybranym rytmie.'}</span>` : ''}
      </fieldset>` : ''}

      <fieldset class="pole">
        <legend>${miedzy ? 'Z konta' : 'Konto'}</legend>
        ${przyciskiKont('konto', f.konto)}
        ${kontoBezWaluty ? `<div class="chipy male" role="group" aria-label="Waluta">${waluty().map(w => `
          <button type="button" class="chip" data-akcja="waluta" data-v="${w}" aria-pressed="${walutaFormularza() === w}">${w}</button>`).join('')}</div>` : ''}
      </fieldset>

      ${miedzy ? `
      <fieldset class="pole">
        <legend>Na konto</legend>
        ${przyciskiKont('konto_docelowe', f.konto_docelowe, k => k.nazwa !== f.konto && (!wymiana || (k.waluta && k.waluta !== walutaFormularza())))}
      </fieldset>
      ${potrzebnaDruga || (wymiana && f.konto_docelowe) ? `<label class="pole">
        <span class="etykieta">${wymiana ? 'Kwota kupiona' : 'Kwota, która wpłynęła'} na ${esc(f.konto_docelowe)}${walutaDocelowa() ? ` (${esc(walutaDocelowa())})` : ''}</span>
        <input name="kwota_do" inputmode="decimal" autocomplete="off" value="${esc(f.kwota_do)}" placeholder="np. 230,45">
        ${wymiana ? '<span class="podpowiedz kurs-wymiany" aria-live="polite"></span>' : ''}
      </label>` : ''}` : `
      <fieldset class="pole">
        <legend>${f.typ === 'wpływ' ? 'Źródło przychodu' : 'Kategoria'}</legend>
        ${f.podzial ? htmlPodzialu() : `
          ${siatkaKategorii()}
          ${pod.length ? `<div class="chipy male podkategorie" role="group" aria-label="Podkategoria">${pod.map(p => `
            <button type="button" class="chip" data-akcja="podkategoria" data-v="${esc(p.nazwa)}" aria-pressed="${p.nazwa === f.podkategoria}">${esc(p.nazwa)}</button>`).join('')}</div>` : ''}
          ${!plan ? `<button type="button" class="link" data-akcja="podziel">Podziel na kilka kategorii</button>` : ''}`}
        ${podpowiedzLimitu()}
      </fieldset>`}

      <div class="rzad">
        <fieldset class="pole">
          <legend>${plan ? (f.rodzajWpisu === 'nadchodząca' ? 'Termin płatności' : (f.planId ? 'Najbliższy termin' : 'Pierwszy termin')) : 'Data operacji'}</legend>
          <div class="data">
            <input type="date" name="data" value="${esc(f.data)}" required>
            ${plan ? '' : `<button type="button" class="chip" data-akcja="data" data-v="0" aria-pressed="${f.data === dataLok()}">Dziś</button>
            <button type="button" class="chip" data-akcja="data" data-v="-1" aria-pressed="${f.data === dodajDni(dataLok(), -1)}">Wczoraj</button>`}
          </div>
        </fieldset>
        ${miedzy ? '' : `<fieldset class="pole">
          <legend>Dotyczy</legend>
          <div class="chipy">${podmioty().map(p => `
            <button type="button" class="chip" data-akcja="podmiot" data-v="${esc(p)}" aria-pressed="${f.podmiot === p}">${esc(p === 'wspólne' ? 'Wspólne' : p)}</button>`).join('')}</div>
        </fieldset>`}
      </div>

      ${htmlPlanu()}

      ${miedzy ? '' : `<label class="pole">
        <span class="etykieta">Kontrahent</span>
        <input name="kontrahent" list="lista-kontrahentow" autocomplete="off" value="${esc(f.kontrahent)}" placeholder="np. Allegro, InPost, imię i nazwisko">
        <datalist id="lista-kontrahentow">${kontrahenci().map(k => `<option value="${esc(k)}">`).join('')}</datalist>
        <span class="podpowiedz" aria-live="polite">${esc(f.podpowiedz)}</span>
      </label>`}

      ${!miedzy && budzety.length ? `<fieldset class="pole">
        <legend>Budżet</legend>
        <div class="chipy">
          <button type="button" class="chip" data-akcja="budzet" data-v="" aria-pressed="${!f.budzet}">Bez budżetu</button>
          ${budzety.map(b => `<button type="button" class="chip" data-akcja="budzet" data-v="${esc(b.id)}" aria-pressed="${f.budzet === b.id}">${esc(b.nazwa)}</button>`).join('')}
        </div>
      </fieldset>` : ''}

      ${plan ? '' : htmlZalacznikow()}

      <details class="wiecej" ${f.tagi || f.nr_dokumentu || f.opis ? 'open' : ''}>
        <summary>Opis, numer dokumentu, tagi</summary>
        <label class="pole"><span class="etykieta">Opis</span>
          <textarea name="opis" rows="2" placeholder="Co to było?">${esc(f.opis)}</textarea></label>
        <div class="rzad">
          ${plan ? '' : `<label class="pole"><span class="etykieta">Numer dokumentu</span>
            <input name="nr_dokumentu" autocomplete="off" value="${esc(f.nr_dokumentu)}" placeholder="faktura, paragon"></label>`}
          <label class="pole"><span class="etykieta">Tagi, po przecinku</span>
            <input name="tagi" list="lista-tagow" autocomplete="off" value="${esc(f.tagi)}" placeholder="np. Kiermasz Koneser">
            <datalist id="lista-tagow">${lista('tagi').map(t => `<option value="${esc(t.nazwa)}">`).join('')}</datalist></label>
        </div>
      </details>

      <div class="pasek-zapisu">
        ${f.tryb === 'edycja' && !anulowana ? `<button type="button" class="drugorzedny" data-akcja="anuluj">${f.planId ? 'Usuń z planu' : 'Anuluj transakcję'}</button>` : ''}
        <button type="submit" class="zapisz">${etykietaZapisu()}</button>
      </div>
    </form>
  </section>`;
  odswiezKwote();
}

function brak(tytul, tekst, link, etykieta) {
  $('#widok').innerHTML = `<section class="ekran-wiadomosc"><h1>${esc(tytul)}</h1>
    <p>${esc(tekst)}</p><a class="przycisk" href="${link}">${esc(etykieta)}</a></section>`;
}

function kontrahenci() {
  const ost = new Map();
  dane.transakcje.forEach(t => {
    const k = String(t.kontrahent || '').trim();
    if (!k || t.status === 'anulowana') return;
    const d = t.data_operacji || '';
    if (!ost.has(k) || ost.get(k) < d) ost.set(k, d);
  });
  return [...ost.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 300).map(e => e[0]);
}

function ostatniDlaKontrahenta(nazwa, typ) {
  const n = nazwa.trim().toLowerCase();
  if (!n) return null;
  return dane.transakcje
    .filter(t => String(t.kontrahent || '').trim().toLowerCase() === n && t.typ === typ && t.status !== 'anulowana' && !t.podzial_id)
    .sort((a, b) => String(b.data_operacji).localeCompare(String(a.data_operacji)) || String(b.utworzono || '').localeCompare(String(a.utworzono || '')))[0] || null;
}

// ── zdarzenia ──

function zbierzPola() {
  const form = $('.kolumna-szczegolow');
  if (!form || !f) return;
  ['data', 'kontrahent', 'opis', 'nr_dokumentu', 'tagi', 'kwota_do', 'co_ile', 'powtarzanie', 'data_koniec'].forEach(n => {
    const el = form.elements[n];
    if (el) f[n] = el.value;
  });
  if (form.elements.subskrypcja) f.subskrypcja = form.elements.subskrypcja.checked;
}

const przerysuj = () => bezSkoku(() => renderDodaj(f.tryb === 'edycja' ? (f.planId ? 'plan' : 'edytuj') : null, f.planId || f.oryginaly[0]?.id));

export function obsluzKlik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b || !$('.dodaj') || !f) return;
  const { akcja, v } = b.dataset;
  zbierzPola();
  switch (akcja) {
    case 'klawisz': klawisz(v); return;
    case 'typ':
      if (f.typ !== v) {
        f.typ = v; f.kategoria = ''; f.podkategoria = ''; f.podpowiedz = ''; f.podzial = null; f.kwota_do = '';
        if (v === 'wymiana' && f.konto_docelowe && walutaKonta(f.konto_docelowe) === walutaFormularza()) f.konto_docelowe = '';
      }
      break;
    case 'rodzaj-wpisu': f.rodzajWpisu = v; if (v !== 'zwykła' && f.data < dataLok()) f.data = dataLok(); break;
    case 'konto':
      f.konto = v; f.waluta = '';
      if (f.konto_docelowe === v || (f.typ === 'wymiana' && walutaKonta(f.konto_docelowe) === walutaFormularza())) f.konto_docelowe = '';
      break;
    case 'konto_docelowe': f.konto_docelowe = v; break;
    case 'waluta': f.waluta = v; break;
    case 'kategoria':
      if (f.kategoria !== v) f.podkategoria = '';
      f.kategoria = v; f.podpowiedz = '';
      break;
    case 'podkategoria': f.podkategoria = f.podkategoria === v ? '' : v; break;
    case 'podmiot': f.podmiot = f.podmiot === v ? '' : v; break;
    case 'budzet': f.budzet = v; break;
    case 'data': f.data = dodajDni(dataLok(), Number(v)); break;
    case 'podziel':
      f.podzial = [{ kategoria: f.kategoria, podkategoria: f.podkategoria, kwota: '' }, { kategoria: '', podkategoria: '', kwota: '' }];
      break;
    case 'dodaj-czesc': {
      const reszta = zaokr(liczba(f.kwota) - sumaPodzialu());
      f.podzial.push({ kategoria: '', podkategoria: '', kwota: reszta > 0 ? liczbaNaTekst(reszta) : '' });
      break;
    }
    case 'usun-czesc': f.podzial.splice(Number(v), 1); break;
    case 'bez-podzialu': {
      const najwieksza = [...f.podzial].sort((a, b) => liczba(b.kwota) - liczba(a.kwota))[0];
      f.kategoria = najwieksza?.kategoria || ''; f.podkategoria = najwieksza?.podkategoria || ''; f.podzial = null;
      break;
    }
    case 'usun-zalacznik': f.zalaczniki.splice(Number(v), 1); break;
    case 'anuluj': anuluj(); return;
    default: return;
  }
  przerysuj();
}

export function obsluzWejscie(e) {
  if (!$('.dodaj') || !f) return;
  const el = e.target;
  if (el.name === 'podzial-kwota') { f.podzial[Number(el.dataset.i)].kwota = el.value; odswiezReszte(); }
  else if (el.name === 'kwota_do') { f.kwota_do = el.value; odswiezKursWymiany(); }
  else if (el.name === 'data') f.data = el.value;
}

export async function obsluzZmiane(e) {
  if (!$('.dodaj') || !f) return;
  const el = e.target;
  if (el.name === 'podzial-kat') {
    const [k, p] = el.value.split('||');
    Object.assign(f.podzial[Number(el.dataset.i)], { kategoria: k, podkategoria: p || '' });
    zbierzPola();
    if (f.typ === 'wydatek') przerysuj();
  } else if (el.dataset.plik) {
    await dodajPliki([...el.files], el.dataset.plik === 'aparat');
    el.value = '';
  } else if (el.name === 'co_ile' || el.name === 'powtarzanie') {
    zbierzPola();
    przerysuj();
  } else if (el.name === 'data' && (czyPlan() || budzetyDoWyboru(el.value).length || f.typ === 'wymiana')) {
    zbierzPola();
    przerysuj();
  } else if (el.name === 'kontrahent') {
    kontrahentZmieniony(el.value);
  }
}

function kontrahentZmieniony(wartosc) {
  f.kontrahent = wartosc;
  if (f.tryb !== 'nowy' || f.kategoria || f.podzial) return;
  const ost = ostatniDlaKontrahenta(f.kontrahent, f.typ);
  if (!ost) return;
  zbierzPola();
  f.kategoria = f.typ === 'wpływ' ? ost.zrodlo_przychodu : ost.kategoria;
  f.podkategoria = ost.podkategoria || '';
  if (!f.podmiot) f.podmiot = ost.podmiot || '';
  if (!f.tagi) f.tagi = ost.tagi || '';
  f.podpowiedz = f.kategoria ? `Podstawiono jak w ostatnim wpisie: ${f.kategoria}${f.podkategoria ? ', ' + f.podkategoria : ''}.` : '';
  przerysuj();
}

async function zmniejszZdjecie(plik) {
  if (!plik.type.startsWith('image/') || /gif|svg/.test(plik.type)) return { blob: plik, mime: plik.type || 'application/octet-stream' };
  try {
    const obraz = await createImageBitmap(plik, { imageOrientation: 'from-image' });
    const skala = Math.min(1, 1800 / Math.max(obraz.width, obraz.height));
    const c = document.createElement('canvas');
    c.width = Math.round(obraz.width * skala);
    c.height = Math.round(obraz.height * skala);
    c.getContext('2d').drawImage(obraz, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob) throw new Error('canvas');
    return { blob, mime: 'image/jpeg' };
  } catch {
    return { blob: plik, mime: plik.type };
  }
}

async function dodajPliki(lista_, zAparatu) {
  zbierzPola();
  for (const plik of lista_) {
    const { blob, mime } = await zmniejszZdjecie(plik);
    if (blob.size > MAKS_MB * 1024 * 1024) { toast(`Plik „${plik.name}” jest za duży (maks. ${MAKS_MB} MB).`, 'blad', 5000); continue; }
    const teraz = new Date();
    const znacznik = `${dataLok(teraz).replace(/-/g, '')}-${String(teraz.getHours()).padStart(2, '0')}${String(teraz.getMinutes()).padStart(2, '0')}${String(teraz.getSeconds()).padStart(2, '0')}`;
    let nazwa = zAparatu || /^image\.\w+$/i.test(plik.name) ? `zdjecie-${znacznik}.jpg` : plik.name;
    if (mime === 'image/jpeg' && !/\.jpe?g$/i.test(nazwa)) nazwa = nazwa.replace(/\.[^.]+$/, '') + '.jpg';
    f.zalaczniki.push({ nazwa: nazwa.replace(/\|/g, '-'), plik_id: uuid(), blob, mime, nowy: true, url: '' });
  }
  przerysuj();
}

// ── zapis ──

function blad(kwota) {
  if (!(kwota > 0)) return 'Wpisz kwotę większą od zera.';
  if (!f.konto) return 'Wybierz konto.';
  if (!f.data) return czyPlan() ? 'Wybierz termin.' : 'Wybierz datę operacji.';
  if (czyMiedzyKontami()) {
    if (!f.konto_docelowe) return 'Wybierz konto, na które idą pieniądze.';
    if (f.konto_docelowe === f.konto) return 'Konto źródłowe i docelowe muszą być różne.';
    if ((f.typ === 'wymiana' || walutaDocelowa() !== walutaFormularza()) && !(liczba(f.kwota_do) > 0)) {
      return f.typ === 'wymiana' ? 'Wpisz kwotę kupioną.' : 'Wpisz kwotę, która wpłynęła na konto docelowe.';
    }
    if (f.typ === 'wymiana' && walutaDocelowa() === walutaFormularza()) return 'Przy wymianie konta muszą mieć różne waluty.';
    return null;
  }
  if (f.podzial) {
    if (f.podzial.some(c => !c.kategoria)) return 'Wybierz kategorię w każdej części.';
    if (f.podzial.some(c => !(liczba(c.kwota) > 0))) return 'Wpisz kwotę w każdej części.';
    if (Math.abs(sumaPodzialu() - kwota) >= 0.005) return 'Suma części musi być równa kwocie transakcji.';
    return null;
  }
  if (!f.kategoria) return f.typ === 'wpływ' ? 'Wybierz źródło przychodu.' : 'Wybierz kategorię.';
  if (czyPlan() && f.rodzajWpisu === 'powtarzalna' && !(Number(f.co_ile) >= 1)) return 'Podaj, co ile ma się powtarzać.';
  return null;
}

function kurs(orig, waluta, data, kwota) {
  if (waluta === 'PLN') return { kurs: 1, kwota_pln: kwota };
  if (orig && orig.waluta === waluta && orig.data_operacji === data && orig.kurs !== '' && orig.kurs != null) {
    return { kurs: Number(orig.kurs), kwota_pln: zaokr(kwota * Number(orig.kurs)) };
  }
  return { kurs: '', kwota_pln: '' };
}

function tekstZalacznikow() {
  return f.zalaczniki.map(z => z.nowy ? `${z.nazwa} | oczekuje:${z.plik_id}` : z.linia).join('\n');
}

async function zapiszPlan(kwota) {
  const o = f.planOryginal;
  const rodzaj = f.rodzajWpisu === 'nadchodząca' ? 'jednorazowa' : (f.subskrypcja ? 'subskrypcja' : 'cykliczna');
  const p = {
    ...(o || {}),
    id: o?.id || uuid(), nazwa: f.kontrahent.trim() || f.kategoria, typ: f.typ, rodzaj, kwota, waluta: walutaFormularza(),
    konto: f.konto, konto_docelowe: '',
    kategoria: f.typ === 'wydatek' ? f.kategoria : '', podkategoria: f.typ === 'wydatek' ? f.podkategoria : '',
    zrodlo_przychodu: f.typ === 'wpływ' ? f.kategoria : '',
    kontrahent: f.kontrahent.trim(), podmiot: f.podmiot, tagi: normTagi(), opis: f.opis.trim(), budzet: f.budzet,
    data_start: o?.data_start || f.data, nastepna_data: f.data,
    powtarzanie: rodzaj === 'jednorazowa' ? '' : f.powtarzanie, co_ile: rodzaj === 'jednorazowa' ? '' : Number(f.co_ile) || 1,
    data_koniec: rodzaj === 'jednorazowa' ? '' : f.data_koniec,
    przypomnienie_dni: o?.przypomnienie_dni ?? 3, status: o?.status || 'aktywna',
  };
  await sync.zapisz('PLANOWANE', [p]);
  return p;
}

const normTagi = () => f.tagi.split(',').map(s => s.trim()).filter(Boolean).join(', ');

export async function zapiszFormularz() {
  if (!f || !$('.dodaj')) return;
  zbierzPola();
  const kwota = zaokr(liczba(f.kwota));
  const komunikat = blad(kwota);
  if (komunikat) { toast(komunikat, 'blad'); return; }
  const waluta = walutaFormularza();

  if (czyPlan()) {
    await zapiszPlan(kwota);
    zapamietaj({ konto: f.konto, podmiot: f.podmiot });
    await wczytajDane();
    toast(f.tryb === 'edycja' ? 'Zapisano zmiany w planie.' : `Zaplanowano ${f.typ} ${kwotaTxt(kwota, waluta)} na ${dataSlownie(f.data).toLowerCase()}.`, 'ok');
    const byl = f.tryb;
    f = byl === 'edycja' ? null : nowyFormularz({ typ: f.typ, konto: f.konto, waluta: f.waluta, podmiot: f.podmiot });
    if (byl === 'edycja') location.hash = '#planowane'; else renderDodaj();
    return;
  }

  const nowePliki = f.zalaczniki.filter(z => z.nowy).map(z => ({ plik_id: z.plik_id, nazwa: z.nazwa, mime: z.mime, blob: z.blob, data: f.data }));
  const wspolne = {
    data_operacji: f.data, tagi: normTagi(), nr_dokumentu: f.nr_dokumentu.trim(), opis: f.opis.trim(), zalacznik: tekstZalacznikow(),
  };
  const nowyStatus = orig => (orig && orig.status !== 'anulowana' ? orig.status : 'oczekuje na wyciąg');
  let wiersze;

  if (czyMiedzyKontami()) {
    const origZ = f.oryginaly.find(o => o.typ === 'przeksięgowanie-wypływ');
    const origNa = f.oryginaly.find(o => o.typ === 'przeksięgowanie-wpływ');
    const para = origZ?.id_pary || origNa?.id_pary || uuid();
    const walNa = walutaDocelowa() || waluta;
    const kwotaNa = walNa === waluta && f.typ !== 'wymiana' ? kwota : zaokr(liczba(f.kwota_do));
    const noga = (orig, typ, konto, kw, wal) => ({
      ...(orig || {}), ...wspolne,
      id: orig?.id || uuid(), typ, id_pary: para, podzial_id: '', konto, kwota: kw, waluta: wal,
      ...kurs(orig, wal, f.data, kw),
      kategoria: f.typ === 'wymiana' ? WYMIANA : '', podkategoria: '', zrodlo_przychodu: '', kontrahent: '', podmiot: '', budzet: '',
      status: nowyStatus(orig), zrodlo: orig?.zrodlo || 'ręczny',
    });
    wiersze = [
      noga(origZ, 'przeksięgowanie-wypływ', f.konto, kwota, waluta),
      noga(origNa, 'przeksięgowanie-wpływ', f.konto_docelowe, kwotaNa, walNa),
    ];
  } else {
    const czesci = f.podzial
      ? f.podzial.map(c => ({ kategoria: c.kategoria, podkategoria: c.podkategoria, kwota: zaokr(liczba(c.kwota)) }))
      : [{ kategoria: f.kategoria, podkategoria: f.podkategoria, kwota }];
    const podzialId = f.podzial ? (f.podzialId || uuid()) : '';
    const aktywneOryg = f.oryginaly.filter(o => o.status !== 'anulowana');
    wiersze = czesci.map((c, i) => {
      const orig = aktywneOryg[i];
      return {
        ...(orig || {}), ...wspolne,
        id: orig?.id || uuid(), typ: f.typ, id_pary: '', podzial_id: podzialId, konto: f.konto, kwota: c.kwota, waluta,
        ...kurs(orig, waluta, f.data, c.kwota),
        kategoria: f.typ === 'wydatek' ? c.kategoria : '', podkategoria: f.typ === 'wydatek' ? c.podkategoria : '',
        zrodlo_przychodu: f.typ === 'wpływ' ? c.kategoria : '',
        kontrahent: f.kontrahent.trim(), podmiot: f.podmiot, budzet: f.budzet,
        status: nowyStatus(orig), zrodlo: orig?.zrodlo || 'ręczny',
      };
    });
    // części, które zniknęły przy edycji podziału – anulujemy, bo w arkuszu niczego nie kasujemy
    aktywneOryg.slice(czesci.length).forEach(o => wiersze.push({ ...o, status: 'anulowana' }));

    if (f.tryb === 'nowy') {
      const moje = { konto: f.konto, waluta, kwota, data_operacji: f.data, typ: f.typ };
      const podobne = grupy().filter(g => g.rodzaj !== 'przeksiegowanie' && g.rodzaj !== 'wymiana'
        && g.glowna.status !== 'anulowana' && g.glowna.konto === moje.konto && g.glowna.waluta === moje.waluta
        && Math.abs(g.kwota - kwota) < 0.005 && kierunek(g.glowna) === kierunek(moje)
        && Math.abs(roznicaDni(g.glowna.data_operacji, f.data)) <= 3);
      if (podobne.length) {
        const decyzja = await okno('Taka transakcja może już być zapisana',
          `<p>Na koncie ${esc(f.konto)} jest już ${podobne.length === 1 ? 'operacja' : 'kilka operacji'} na ${esc(kwotaTxt(kwota, waluta))} z podobną datą:</p>
           <ul class="lista-podobnych">${podobne.slice(0, 5).map(g => `<li><b>${esc(dataSlownie(g.glowna.data_operacji))}</b>
             ${esc(g.glowna.kontrahent || g.glowna.kategoria || g.glowna.zrodlo_przychodu || '')} <span>${esc(g.glowna.status || '')}</span></li>`).join('')}</ul>
           <p>Zapisz tylko wtedy, gdy to naprawdę inna operacja.</p>`,
          [{ etykieta: 'Wróć do formularza', wartosc: false, klasa: 'drugorzedny', autofocus: true },
           { etykieta: 'To inna operacja, zapisz', wartosc: true }]);
        if (!decyzja) return;
      }
    }
  }

  await sync.zapisz('TRANSAKCJE', wiersze, nowePliki);
  zapamietaj({ konto: f.konto, podmiot: f.podmiot });
  await wczytajDane();
  const offline = !navigator.onLine;
  if (f.tryb === 'edycja') {
    toast('Zapisano zmiany.' + (offline ? ' Wyślę je po powrocie internetu.' : ''), 'ok');
    f = null;
    location.hash = '#lista';
  } else {
    const co = { wydatek: 'wydatek', 'wpływ': 'wpływ', 'przeksięgowanie': 'przeksięgowanie', wymiana: 'wymianę' }[f.typ];
    toast(`Zapisano ${co} ${kwotaTxt(kwota, waluta)}${f.podzial ? ` w ${f.podzial.length} częściach` : ''}.`
      + (offline ? ' Wyślę po powrocie internetu.' : ''), 'ok');
    f = nowyFormularz({ typ: f.typ, konto: f.konto, waluta: f.waluta, data: f.data, podmiot: f.podmiot });
    renderDodaj();
  }
}

async function anuluj() {
  const plan = Boolean(f.planId);
  const tak = await okno(plan ? 'Usunąć tę pozycję z planu?' : 'Anulować tę transakcję?',
    plan
      ? '<p>Przestanie pojawiać się w „Planowanych”. W arkuszu zostanie ze statusem „anulowana”.</p>'
      : '<p>Zostanie w arkuszu ze statusem „anulowana” i przestanie liczyć się w podsumowaniach i budżetach.</p>',
    [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true },
     { etykieta: plan ? 'Usuń z planu' : 'Anuluj transakcję', wartosc: true, klasa: 'niebezpieczny' }]);
  if (!tak) return;
  if (plan) await sync.zapisz('PLANOWANE', [{ ...f.planOryginal, status: 'anulowana' }]);
  else await sync.zapisz('TRANSAKCJE', f.oryginaly.map(o => ({ ...o, status: 'anulowana' })));
  await wczytajDane();
  toast(plan ? 'Usunięto z planu.' : 'Transakcja anulowana.', 'ok');
  f = null;
  location.hash = plan ? '#planowane' : '#lista';
}

export const pisze = () => Boolean(f && $('.dodaj'));
