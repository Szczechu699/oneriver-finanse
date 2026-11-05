// Ekran „Poziomy cen” (#poziomy, #poziomy/<grupa>/<poziom>): poziomy cenowe detal i hurt osobno dla Rapé i Zielarni.
// Poziom = tabela cen: wiersze – rodzaje (produkty), kolumny – gramatury. Puste pole = cena katalogowa.
// Szybkie wypełnianie ustawia cenę dla wszystkich produktów o tej samej cenie katalogowej i gramaturze
// (np. 6 g za 75 zł → 70 zł), a droższe rodzaje (np. 85 zł) wypełnia się osobnym wierszem.

import { $, $$, esc, kwotaTxt, num, zaokr, liczba, liczbaNaTekst, uuid, toast, okno } from './util.js';
import { dane, wczytaj, aktywny, poziom, poziomyGrupy, cenaPoziomu } from './dane.js';
import { NAZWY_GRUP_POZIOMOW } from './konfiguracja.js';
import * as sync from './sync.js';

const stan = { grupa: 'rape', poziomId: '', widok: 'edycja', zmiany: new Map() };   // zmiany: symbol → tekst ceny
const KATEGORIA = Object.fromEntries(Object.entries(NAZWY_GRUP_POZIOMOW));

const wagaWariantu = w => {
  const n = parseFloat(String(w).replace(',', '.'));
  if (isFinite(n)) return n;
  const r = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].indexOf(String(w).toUpperCase());
  return r >= 0 ? 1000 + r : 2000;
};

/**
 * Produkty grupy (wiersze) i kolumny wariantów. Kolumny są pozycjami (najmniejsza, średnia, największa gramatura),
 * żeby rodzaje z innymi gramaturami (np. Apurina 5/10/20 g) stały w tych samych kolumnach co 6/12/24 g.
 * Nagłówek kolumny = najczęstszy wariant na tej pozycji; inny wariant widać w komórce.
 */
function tabelaGrupy(grupa) {
  const produkty = dane.produkty.filter(p => p.kategoria === KATEGORIA[grupa]).sort((a, b) => a.produkt.localeCompare(b.produkt, 'pl'));
  const ile = Math.max(1, ...produkty.map(p => p.warianty.length));
  const kolumny = Array.from({ length: ile }, (_, i) => {
    const licz = new Map();
    produkty.forEach(p => { const w = p.warianty[i]; if (w) licz.set(w.wariant || '', (licz.get(w.wariant || '') || 0) + 1); });
    return [...licz.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  });
  return { produkty, kolumny };
}

const komorka = (p, kol, i) => p.warianty[i];
const inny = (w, kol) => (w.wariant || '') !== kol ? `<small class="inny-wariant">${esc(w.wariant)}</small>` : '';
const wartoscPola = (symbol, poziomId) => (stan.zmiany.has(symbol) ? stan.zmiany.get(symbol) : liczbaNaTekst(cenaPoziomu(poziomId, symbol) ?? ''));

// ───────────────────────── widoki ─────────────────────────

function htmlEdycji(p, { produkty, kolumny }) {
  // szybkie wypełnianie: pary (gramatura, cena katalogowa)
  const pary = new Map();
  produkty.forEach(pr => pr.warianty.forEach(w => {
    const k = `${w.wariant || ''}|${w.cena}`;
    const e = pary.get(k) || { wariant: w.wariant || '', cena: w.cena, ile: 0 };
    e.ile++;
    pary.set(k, e);
  }));
  const listaPar = [...pary.values()].sort((a, b) => wagaWariantu(a.wariant) - wagaWariantu(b.wariant) || a.cena - b.cena);
  return `
    <article class="panel">
      <h2>Szybkie wypełnianie – ${esc(p.nazwa)}</h2>
      <p class="podpowiedz">Wpisz cenę w poziomie dla każdej ceny katalogowej – trafi do wszystkich rodzajów z tą ceną. Potem możesz poprawić pojedyncze pola w tabeli.</p>
      <ul class="szybkie">${listaPar.map(x => `<li data-wariant="${esc(x.wariant)}" data-cena="${x.cena}">
        <span>${esc(x.wariant || 'cena')} · katalog <b>${esc(kwotaTxt(x.cena))}</b> <small>(${x.ile} ${x.ile === 1 ? 'rodzaj' : 'rodzaje'})</small></span>
        <input inputmode="decimal" placeholder="cena" aria-label="Cena w poziomie dla ${esc(x.wariant)} za ${esc(kwotaTxt(x.cena))}">
        <button type="button" class="drugorzedny" data-akcja="wypelnij">Wypełnij</button></li>`).join('')}</ul>
    </article>
    <article class="panel">
      <header><h2>Ceny w poziomie ${esc(p.nazwa)}</h2><span class="podpowiedz">puste = cena katalogowa</span></header>
      <div class="przewijana"><table class="macierz">
        <thead><tr><th>Rodzaj</th>${kolumny.map(k => `<th>${esc(k || 'cena')}</th>`).join('')}</tr></thead>
        <tbody>${produkty.map(pr => `<tr><th>${esc(pr.produkt.replace(/^rap[eé]\s+/i, ''))}</th>${kolumny.map((k, i) => {
          const w = komorka(pr, k, i);
          if (!w) return '<td class="brak">—</td>';
          const zm = stan.zmiany.has(w.symbol);
          return `<td>${inny(w, k)}<input data-symbol="${esc(w.symbol)}" inputmode="decimal" class="${zm ? 'zmienione' : ''}" value="${esc(wartoscPola(w.symbol, p.id))}" placeholder="${esc(liczbaNaTekst(w.cena))}" aria-label="${esc(pr.produkt)} ${esc(k)}"></td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <div class="przyciski"><button type="button" data-akcja="zapisz-ceny" ${stan.zmiany.size ? '' : 'disabled'}>Zapisz zmiany${stan.zmiany.size ? ` (${stan.zmiany.size})` : ''}</button>
        ${stan.zmiany.size ? '<button type="button" class="drugorzedny" data-akcja="porzuc">Porzuć zmiany</button>' : ''}</div>
    </article>`;
}

function htmlPorownania({ produkty, kolumny }, poziomy) {
  if (!poziomy.length) return '<p class="pusto">Dodaj poziom, żeby porównać ceny.</p>';
  return `<article class="panel"><h2>Porównanie poziomów</h2>
    <div class="przewijana"><table class="macierz porownanie">
      <thead><tr><th rowspan="2">Rodzaj</th>${kolumny.map(k => `<th colspan="${poziomy.length + 1}" class="grupa-kol">${esc(k || 'cena')}</th>`).join('')}</tr>
        <tr>${kolumny.map(() => `<th>Katalog</th>${poziomy.map(p => `<th title="${esc(p.nazwa)}">${esc(p.nazwa)}</th>`).join('')}`).join('')}</tr></thead>
      <tbody>${produkty.map(pr => `<tr><th>${esc(pr.produkt.replace(/^rap[eé]\s+/i, ''))}</th>${kolumny.map((k, i) => {
        const w = komorka(pr, k, i);
        if (!w) return `<td class="brak" colspan="${poziomy.length + 1}">—</td>`;
        return `<td class="katalog">${inny(w, k)}${esc(liczbaNaTekst(w.cena))}</td>${poziomy.map(p => { const c = cenaPoziomu(p.id, w.symbol); return `<td>${c === undefined ? '<span class="pusto">·</span>' : esc(liczbaNaTekst(c))}</td>`; }).join('')}`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div></article>`;
}

function render(arg) {
  const [g, pid] = String(arg || '').split('/');
  if (g && NAZWY_GRUP_POZIOMOW[g]) stan.grupa = g;
  const poziomy = poziomyGrupy(stan.grupa).filter(aktywny);
  if (pid !== undefined) stan.widok = 'edycja';
  if (pid !== undefined && pid !== stan.poziomId) { stan.poziomId = pid; stan.zmiany.clear(); }
  if (!poziomy.some(p => String(p.id) === stan.poziomId)) { stan.poziomId = poziomy[0]?.id ? String(poziomy[0].id) : ''; stan.zmiany.clear(); }
  const p = poziom(stan.poziomId);
  const tab = tabelaGrupy(stan.grupa);
  const detal = poziomy.filter(x => x.rodzaj !== 'hurt');
  const hurt = poziomy.filter(x => x.rodzaj === 'hurt');
  const chip = x => `<a class="chip" href="#poziomy/${stan.grupa}/${encodeURIComponent(x.id)}" aria-pressed="${String(x.id) === stan.poziomId && stan.widok === 'edycja'}">${esc(x.nazwa)}</a>`;
  $('#widok').innerHTML = `
  <section class="ekran poziomy">
    <header class="naglowek-zam"><div><span class="etykieta">Ceny dla klientów</span><h1>Poziomy cen</h1></div><a class="kontekst" href="#sklep">← Sklep</a></header>
    <div class="chipy">${Object.entries(NAZWY_GRUP_POZIOMOW).map(([k, n]) => `<a class="chip" href="#poziomy/${k}" aria-pressed="${stan.grupa === k}">${esc(n)}</a>`).join('')}</div>
    <p class="podpowiedz">${tab.produkty.length} rodzajów w katalogu. Poziom przypisujesz klientowi w jego karcie – osobno dla Rapé i Zielarni.</p>

    <article class="panel">
      <h2>Poziomy ${esc(NAZWY_GRUP_POZIOMOW[stan.grupa])}</h2>
      <span class="etykieta">Detaliczne</span>
      <div class="chipy male">${detal.map(chip).join('') || '<span class="pusto">brak</span>'}</div>
      <span class="etykieta">Hurtowe</span>
      <div class="chipy male">${hurt.map(chip).join('') || '<span class="pusto">brak</span>'}</div>
      <div class="chipy male"><button type="button" class="chip" data-akcja="porownaj" aria-pressed="${stan.widok === 'porownanie'}">Porównaj wszystkie</button></div>
      <form data-forma="nowy-poziom" class="edycja-wiersza">
        <label class="pole szeroka"><span class="etykieta">Nowy poziom</span><input name="nazwa" placeholder="np. Hurt 2" autocomplete="off"></label>
        <label class="pole"><span class="etykieta">Rodzaj</span><select name="rodzaj"><option value="detal">detal</option><option value="hurt">hurt</option></select></label>
        <div class="przyciski"><button type="submit">Dodaj poziom</button></div>
      </form>
      ${p ? `<form data-forma="poziom" class="edycja-wiersza">
        <label class="pole szeroka"><span class="etykieta">Nazwa wybranego poziomu</span><input name="nazwa" value="${esc(p.nazwa)}" autocomplete="off"></label>
        <label class="pole"><span class="etykieta">Rodzaj</span><select name="rodzaj"><option value="detal" ${p.rodzaj !== 'hurt' ? 'selected' : ''}>detal</option><option value="hurt" ${p.rodzaj === 'hurt' ? 'selected' : ''}>hurt</option></select></label>
        <span class="podpowiedz">${dane.klienci.filter(k => String(k['poziom_' + stan.grupa]) === String(p.id)).length} klientów</span>
        <div class="przyciski"><button type="submit" class="drugorzedny">Zapisz nazwę</button><button type="button" class="drugorzedny" data-akcja="usun-poziom">Wyłącz poziom</button></div>
      </form>` : ''}
    </article>

    ${stan.widok === 'porownanie' ? htmlPorownania(tab, poziomy) : p ? htmlEdycji(p, tab) : ''}
  </section>`;
}

function odswiezPrzyciskZapisu() {
  const b = $('[data-akcja="zapisz-ceny"]');
  if (!b) return;
  b.disabled = !stan.zmiany.size;
  b.textContent = `Zapisz zmiany${stan.zmiany.size ? ` (${stan.zmiany.size})` : ''}`;
}

// ───────────────────────── zdarzenia ─────────────────────────

function wejscie(e) {
  const s = e.target.dataset.symbol;
  if (!s) return;
  const zapisana = liczbaNaTekst(cenaPoziomu(stan.poziomId, s) ?? '');
  if (e.target.value.trim() === zapisana) stan.zmiany.delete(s); else stan.zmiany.set(s, e.target.value.trim());
  e.target.classList.toggle('zmienione', stan.zmiany.has(s));
  odswiezPrzyciskZapisu();
}

async function zapiszCeny(b) {
  const wiersze = [];
  for (const [symbol, t] of stan.zmiany) {
    const c = t === '' ? '' : zaokr(liczba(t));
    if (c !== '' && (!isFinite(c) || c < 0)) { toast(`Sprawdź cenę: ${symbol}.`, 'blad', 5000); $(`[data-symbol="${CSS.escape(symbol)}"]`)?.focus(); return; }
    wiersze.push({ id: `${stan.poziomId}|${symbol}`, poziom_id: stan.poziomId, symbol, cena: c });
  }
  b.disabled = true;
  await sync.zapisz([{ karta: 'CENY_POZIOMOW', wiersze }]);
  await wczytaj();
  stan.zmiany.clear();
  toast(`Zapisano ${wiersze.length} cen w poziomie ${poziom(stan.poziomId)?.nazwa}.`, 'ok');
  render(`${stan.grupa}/${stan.poziomId}`);
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const a = b.dataset.akcja;
  if (a === 'wypelnij') {
    const li = b.closest('li');
    const t = $('input', li).value.trim();
    const c = zaokr(liczba(t));
    if (!t || !isFinite(c) || c < 0) { toast('Wpisz cenę.', 'blad'); return; }
    const wariant = li.dataset.wariant, cena = num(li.dataset.cena);
    let n = 0;
    tabelaGrupy(stan.grupa).produkty.forEach(pr => pr.warianty.forEach(w => {
      if ((w.wariant || '') !== wariant || w.cena !== cena) return;
      stan.zmiany.set(w.symbol, liczbaNaTekst(c));
      const pole = $(`[data-symbol="${CSS.escape(w.symbol)}"]`);
      if (pole) { pole.value = liczbaNaTekst(c); pole.classList.add('zmienione'); }
      n++;
    }));
    toast(`Wypełniono ${n} pól – sprawdź i zapisz.`, 'ok');
    odswiezPrzyciskZapisu();
  } else if (a === 'zapisz-ceny') {
    await zapiszCeny(b);
  } else if (a === 'porzuc') {
    stan.zmiany.clear();
    render(`${stan.grupa}/${stan.poziomId}`);
  } else if (a === 'porownaj') {
    stan.widok = stan.widok === 'porownanie' ? 'edycja' : 'porownanie';
    render(stan.grupa);
  } else if (a === 'usun-poziom') {
    const p = poziom(stan.poziomId);
    const tak = await okno(`Wyłączyć poziom ${p.nazwa}?`, '<p>Klienci z tym poziomem dostaną ceny katalogowe (albo swój rabat). Ceny poziomu zostają w arkuszu – można go włączyć ponownie w karcie POZIOMY_CENOWE.</p>',
      [{ etykieta: 'Zostaw', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Wyłącz', wartosc: true, klasa: 'niebezpieczny' }]);
    if (!tak) return;
    await sync.zapisz([{ karta: 'POZIOMY_CENOWE', wiersze: [{ ...p, aktywna: false }] }]);
    await wczytaj();
    stan.poziomId = '';
    render(stan.grupa);
  }
}

async function submit(form) {
  const f = form.elements;
  const nazwa = f.nazwa.value.trim();
  if (!nazwa) { toast('Wpisz nazwę poziomu.', 'blad'); return; }
  if (form.dataset.forma === 'nowy-poziom') {
    const id = uuid();
    await sync.zapisz([{ karta: 'POZIOMY_CENOWE', wiersze: [{ id, nazwa, rodzaj: f.rodzaj.value, grupa: stan.grupa, kolejnosc: dane.poziomy.length + 1, aktywna: true }] }]);
    await wczytaj();
    stan.widok = 'edycja';
    toast(`Dodano poziom ${nazwa}. Wypełnij ceny.`, 'ok');
    location.hash = `#poziomy/${stan.grupa}/${encodeURIComponent(id)}`;
  } else if (form.dataset.forma === 'poziom') {
    const p = poziom(stan.poziomId);
    await sync.zapisz([{ karta: 'POZIOMY_CENOWE', wiersze: [{ ...p, nazwa, rodzaj: f.rodzaj.value }] }]);
    await wczytaj();
    toast('Zapisano.', 'ok');
    render(`${stan.grupa}/${stan.poziomId}`);
  }
}

export const ekran = { render, klik, wejscie, submit };
