// Pożyczki: udzielone, otrzymane i „ktoś zapłacił za mnie”. Rejestr, raty jako pozycje planowane, spłaty.
//
// Raty mają stałe kwoty z harmonogramu. Która rata jest spłacona, wynika z sumy spłat:
// rata jest zapłacona, gdy suma spłat pokrywa ją razem ze wszystkimi wcześniejszymi.
// Dzięki temu cofnięcie spłaty zawsze przywraca właściwy stan rat.

import * as sync from './sync.js';
import { $, esc, zaokr, kwotaTxt, dataLok, dodajDni, dataSlownie, dataKrotko, uuid, liczba, liczbaNaTekst, toast, okno, bezSkoku, odmiana } from './util.js';
import {
  dane, wczytajDane, konta, kolorKonta, RODZAJE_POZYCZEK, stronaPozyczki, harmonogram, stanPozyczki, ikona, kolorKategorii,
  statusDlaKonta,
} from './dane.js';

const PUSTA_TRANSAKCJA = {
  id: '', typ: '', id_pary: '', podzial_id: '', data_operacji: '', konto: '', kwota: 0, waluta: 'PLN', kurs: '', kwota_pln: '',
  kategoria: '', podkategoria: '', zrodlo_przychodu: '', kontrahent: '', podmiot: '', tagi: '', nr_dokumentu: '', opis: '',
  zalacznik: '', budzet: '', cel: '', planowana_id: '', planowany_termin: '', pozyczka_id: '', status: 'oczekuje na wyciąg', zrodlo: 'ręczny',
};

function kursy(waluta, kwota) {
  return waluta === 'PLN' ? { kurs: 1, kwota_pln: kwota } : { kurs: '', kwota_pln: '' };
}

// ── zapis nowej pożyczki ──

/**
 * d: rodzaj, osoba, kwota, waluta, konto, data, zwrot ('jednorazowo' | 'raty' | 'bez-terminu'), termin,
 *    liczba_rat, co_ile, powtarzanie, pierwsza_rata, konto_splat, kategoria, podkategoria, podmiot, opis, tagi, zalacznik
 */
export async function zapiszPozyczke(d, pliki = []) {
  const r = RODZAJE_POZYCZEK[d.rodzaj];
  const id = uuid();
  const zakup = d.rodzaj === 'zakup-za-mnie';
  const raty = d.zwrot === 'raty'
    ? harmonogram(d.kwota, Number(d.liczba_rat), d.pierwsza_rata, d.powtarzanie, Number(d.co_ile))
    : d.zwrot === 'jednorazowo' ? [{ nr: 1, z: 1, data: d.termin, kwota: d.kwota }] : [];

  const t = {
    ...PUSTA_TRANSAKCJA, id: uuid(), typ: r.typ, data_operacji: d.data, konto: zakup ? '' : d.konto,
    kwota: d.kwota, waluta: d.waluta, ...kursy(d.waluta, d.kwota),
    kategoria: zakup ? d.kategoria : '', podkategoria: zakup ? d.podkategoria : '',
    kontrahent: d.osoba, podmiot: d.podmiot, tagi: d.tagi, opis: d.opis, zalacznik: d.zalacznik, pozyczka_id: id,
    status: zakup ? 'bez ruchu na koncie' : statusDlaKonta(d.konto),
  };
  const p = {
    id, rodzaj: d.rodzaj, osoba: d.osoba, kwota: d.kwota, waluta: d.waluta, konto: zakup ? '' : d.konto, data: d.data,
    splata: d.zwrot, liczba_rat: raty.length || '', powtarzanie: d.zwrot === 'raty' ? d.powtarzanie : '',
    co_ile: d.zwrot === 'raty' ? Number(d.co_ile) || 1 : '', pierwsza_rata: raty[0]?.data || '',
    kategoria: zakup ? d.kategoria : '', podkategoria: zakup ? d.podkategoria : '', podmiot: d.podmiot,
    status: 'aktywna', opis: d.opis, transakcja_id: t.id, tagi: d.tagi,
  };
  const plany = raty.map(x => ({
    id: uuid(), nazwa: tytulRaty(p, x), typ: r.splata, rodzaj: 'rata', kwota: x.kwota, waluta: d.waluta,
    konto: d.konto_splat || d.konto || '', konto_docelowe: '', kategoria: '', podkategoria: '', zrodlo_przychodu: '',
    kontrahent: d.osoba, podmiot: d.podmiot, tagi: d.tagi, data_start: x.data, powtarzanie: '', co_ile: '', data_koniec: '',
    nastepna_data: x.data, przypomnienie_dni: 3, status: 'aktywna', opis: d.opis, budzet: '', pozyczka_id: id,
  }));
  await sync.zapiszWiele([
    { karta: 'POZYCZKI', wiersze: [p] },
    { karta: 'TRANSAKCJE', wiersze: [t] },
    { karta: 'PLANOWANE', wiersze: plany },
  ], pliki);
  await wczytajDane();
  return { pozyczka: p, transakcja: t, raty: plany };
}

function tytulRaty(p, x) {
  const kto = p.rodzaj === 'udzielona' ? `Zwrot od ${p.osoba}` : `Spłata dla ${p.osoba}`;
  return x.z > 1 ? `${kto}, rata ${x.nr}/${x.z}` : kto;
}

// ── spłaty ──

/** Ile zostało do zapłaty w danej racie po uwzględnieniu dotychczasowych spłat. */
export function doZaplatyRaty(p, rata) {
  const s = stanPozyczki(p);
  let narastajaco = 0;
  for (const r of s.raty) {
    narastajaco = zaokr(narastajaco + (Number(r.kwota) || 0));
    if (r.id === rata.id) {
      const pokryte = Math.max(0, Math.min(Number(r.kwota) || 0, s.splacono - (narastajaco - (Number(r.kwota) || 0))));
      return zaokr(Math.min((Number(r.kwota) || 0) - pokryte, s.pozostalo));
    }
  }
  return zaokr(Math.min(Number(rata.kwota) || 0, s.pozostalo));
}

/** Uzgadnia statusy rat i samej pożyczki z sumą spłat. Zwraca paczki do zapisu. */
function uzgodnij(p) {
  const s = stanPozyczki(p);
  const plany = [];
  if (p.status === 'aktywna' || p.status === 'spłacona') {
    let narastajaco = 0;
    for (const r of s.raty) {
      narastajaco = zaokr(narastajaco + (Number(r.kwota) || 0));
      const powinna = s.splacono + 0.005 >= narastajaco ? 'zakończona' : 'aktywna';
      if (r.status !== powinna) plany.push({ ...r, status: powinna });
    }
  }
  let status = p.status;
  if (p.status === 'aktywna' && s.pozostalo <= 0) status = 'spłacona';
  if (p.status === 'spłacona' && s.pozostalo > 0) status = 'aktywna';
  return [
    { karta: 'PLANOWANE', wiersze: plany },
    { karta: 'POZYCZKI', wiersze: status !== p.status ? [{ ...p, status }] : [] },
  ];
}

async function zapiszIUzgodnij(pozyczkaId, paczki) {
  await sync.zapiszWiele(paczki);
  await wczytajDane();
  const p = dane.pozyczki.find(x => x.id === pozyczkaId);
  if (!p) return;
  await sync.zapiszWiele(uzgodnij(p));
  await wczytajDane();
}

export async function dodajSplate(p, { kwota, data, konto, rata = null }) {
  const r = RODZAJE_POZYCZEK[p.rodzaj];
  const t = {
    ...PUSTA_TRANSAKCJA, id: uuid(), typ: r.splata, data_operacji: data, konto, kwota, waluta: p.waluta || 'PLN',
    ...kursy(p.waluta || 'PLN', kwota), kontrahent: p.osoba, podmiot: p.podmiot || '', pozyczka_id: p.id,
    planowana_id: rata?.id || '', planowany_termin: rata?.nastepna_data || '', status: statusDlaKonta(konto),
    opis: rata ? rata.nazwa : (p.rodzaj === 'udzielona' ? `Zwrot od ${p.osoba}` : `Spłata dla ${p.osoba}`),
  };
  await zapiszIUzgodnij(p.id, [{ karta: 'TRANSAKCJE', wiersze: [t] }]);
  return t;
}

/** „Wpłynęło” / „Zapłacone” przy racie – spłata pozostałej części tej raty. */
export async function zaplacRate(rata) {
  const p = dane.pozyczki.find(x => x.id === rata.pozyczka_id);
  if (!p) return null;
  const kwota = doZaplatyRaty(p, rata);
  if (!(kwota > 0)) {
    await zapiszIUzgodnij(p.id, []);
    return null;
  }
  return dodajSplate(p, { kwota, data: dataLok(), konto: rata.konto || p.konto, rata });
}

export async function cofnijSplate(t) {
  await zapiszIUzgodnij(t.pozyczka_id, [{ karta: 'TRANSAKCJE', wiersze: [{ ...t, status: 'anulowana' }] }]);
}

// ── ekran: rejestr pożyczek ──

let zakladka = 'do-odzyskania';

const sumaWalut = mapa => Object.entries(mapa).filter(([, v]) => Math.abs(v) >= 0.005).map(([w, v]) => kwotaTxt(v, w)).join(' + ') || kwotaTxt(0);

export function render(arg) {
  if (arg) return renderSzczegoly(arg);
  const wszystkie = dane.pozyczki.filter(p => p.status !== 'anulowana');
  const stany = new Map(wszystkie.map(p => [p.id, stanPozyczki(p)]));
  const doOdzyskania = {}, doOddania = {};
  wszystkie.filter(p => p.status === 'aktywna').forEach(p => {
    const cel = stronaPozyczki(p) === 'do-odzyskania' ? doOdzyskania : doOddania;
    const w = p.waluta || 'PLN';
    cel[w] = zaokr((cel[w] || 0) + stany.get(p.id).pozostalo);
  });
  const widoczne = wszystkie.filter(p => zakladka === 'zakonczone'
    ? p.status !== 'aktywna'
    : p.status === 'aktywna' && stronaPozyczki(p) === zakladka)
    .sort((a, b) => String(stany.get(a.id).nastepna?.nastepna_data || '9999').localeCompare(String(stany.get(b.id).nastepna?.nastepna_data || '9999'))
      || String(b.data).localeCompare(String(a.data)));

  $('#widok').innerHTML = `
  <section class="ekran pozyczki">
    <div class="naglowek-sekcji">
      <h1>Pożyczki</h1>
      <a class="przycisk" href="#dodaj/pozyczka">Nowa pożyczka</a>
    </div>
    <div class="podsumowanie dwa">
      <button type="button" class="kafel-sumy pozyczka-plus" data-akcja="zakladka" data-v="do-odzyskania" aria-pressed="${zakladka === 'do-odzyskania'}">
        <span>Do odzyskania</span><b>${esc(sumaWalut(doOdzyskania))}</b></button>
      <button type="button" class="kafel-sumy pozyczka-minus" data-akcja="zakladka" data-v="do-oddania" aria-pressed="${zakladka === 'do-oddania'}">
        <span>Do oddania</span><b>${esc(sumaWalut(doOddania))}</b></button>
    </div>
    <div class="zakladki-ekranu" role="tablist">
      ${[['do-odzyskania', 'Pożyczyłem'], ['do-oddania', 'Jestem winien'], ['zakonczone', 'Zakończone']].map(([z, e]) =>
        `<button type="button" role="tab" data-akcja="zakladka" data-v="${z}" aria-selected="${zakladka === z}">${e}</button>`).join('')}
    </div>
    ${widoczne.length ? `<div class="karty-pozyczek">${widoczne.map(p => kartaPozyczki(p, stany.get(p.id))).join('')}</div>` : `
      <div class="pusto-duze"><p>${{
        'do-odzyskania': 'Nikt nie jest Ci winien pieniędzy.',
        'do-oddania': 'Nie masz długów do oddania.',
        zakonczone: 'Nie ma jeszcze zakończonych pożyczek.',
      }[zakladka]}</p><a class="przycisk" href="#dodaj/pozyczka">Zapisz pożyczkę</a></div>`}
  </section>`;
}

function kartaPozyczki(p, s) {
  const plus = stronaPozyczki(p) === 'do-odzyskania';
  const termin = s.nastepna
    ? `${s.raty.length > 1 ? 'Następna rata' : 'Termin zwrotu'} ${dataKrotko(s.nastepna.nastepna_data)}: ${kwotaTxt(doZaplatyRaty(p, s.nastepna), p.waluta)}`
    : (p.status === 'aktywna' ? 'Bez terminu zwrotu' : { 'spłacona': 'Spłacona', 'zamknięta': 'Zamknięta bez pełnej spłaty' }[p.status] || p.status);
  return `<a class="karta-pozyczki ${plus ? 'pozyczka-plus' : 'pozyczka-minus'}" href="#pozyczka/${encodeURIComponent(p.id)}">
    <span class="gora-karty"><b>${esc(p.osoba)}</b><span>${esc(RODZAJE_POZYCZEK[p.rodzaj]?.krotko || '')}, ${esc(dataKrotko(p.data))}</span></span>
    <span class="kwoty-karty"><b>${esc(kwotaTxt(s.pozostalo, p.waluta))}</b> zostało z ${esc(kwotaTxt(s.kwota, p.waluta))}</span>
    <span class="pasek"><span style="width:${(s.procent * 100).toFixed(1)}%"></span></span>
    <span class="dol-karty">${esc(termin)}${s.poTerminie ? ` <span class="znacznik anul">${s.poTerminie} po terminie</span>` : ''}</span>
  </a>`;
}

// ── ekran: szczegóły pożyczki ──

function renderSzczegoly(id) {
  const p = dane.pozyczki.find(x => x.id === id);
  if (!p) {
    $('#widok').innerHTML = `<section class="ekran-wiadomosc"><h1>Nie ma takiej pożyczki</h1><a class="przycisk" href="#pozyczki">Pożyczki</a></section>`;
    return;
  }
  const s = stanPozyczki(p);
  const plus = stronaPozyczki(p) === 'do-odzyskania';
  const r = RODZAJE_POZYCZEK[p.rodzaj];
  const dzis = dataLok();
  const slowoZaplaty = plus ? 'Wpłynęło' : 'Zapłacone';
  const pierwotna = dane.transakcje.find(t => t.id === p.transakcja_id);
  $('#widok').innerHTML = `
  <section class="ekran szczegoly-pozyczki ${plus ? 'pozyczka-plus' : 'pozyczka-minus'}">
    <a class="wstecz" href="#pozyczki">Pożyczki</a>
    <header class="naglowek-pozyczki">
      <h1>${esc(p.osoba)}</h1>
      <p>${esc(r?.etykieta || '')}, ${esc(dataSlownie(p.data).toLowerCase())}${p.konto ? `, konto ${esc(p.konto)}` : ''}${p.kategoria ? `, ${esc(p.kategoria)}${p.podkategoria ? ' › ' + esc(p.podkategoria) : ''}` : ''}${p.podmiot && p.podmiot !== 'wspólne' ? `, ${esc(p.podmiot)}` : ''}</p>
      ${p.opis ? `<p class="opis-pozyczki">${esc(p.opis)}</p>` : ''}
      <div class="pasek duzy"><span style="width:${(s.procent * 100).toFixed(1)}%"></span></div>
      <dl class="info poziomo">
        <div><dt>${plus ? 'Pożyczyłem' : 'Pożyczka'}</dt><dd>${esc(kwotaTxt(s.kwota, p.waluta))}</dd></div>
        <div><dt>${plus ? 'Wróciło' : 'Oddałem'}</dt><dd>${esc(kwotaTxt(s.splacono, p.waluta))}</dd></div>
        <div><dt>Zostało</dt><dd><b>${esc(kwotaTxt(s.pozostalo, p.waluta))}</b></dd></div>
      </dl>
      ${p.status !== 'aktywna' ? `<p class="status-pozyczki">${esc({ 'spłacona': 'Pożyczka spłacona.', 'zamknięta': 'Zamknięta bez pełnej spłaty.', anulowana: 'Pożyczka anulowana.' }[p.status] || p.status)}</p>` : ''}
      <div class="przyciski">
        ${p.status === 'aktywna' ? `<button type="button" data-akcja="dodaj-splate">${plus ? 'Zapisz zwrot' : 'Zapisz spłatę'}</button>` : ''}
        ${p.status === 'aktywna' ? `<button type="button" class="drugorzedny" data-akcja="zamknij">Zamknij bez spłaty</button>` : ''}
        ${p.status === 'zamknięta' ? `<button type="button" class="drugorzedny" data-akcja="przywroc">Przywróć pożyczkę</button>` : ''}
        ${!s.splaty.length && p.status !== 'anulowana' ? `<button type="button" class="drugorzedny" data-akcja="anuluj">Anuluj wpis pożyczki</button>` : ''}
      </div>
    </header>

    ${s.raty.length ? `<section class="dzien">
      <h2>${s.raty.length > 1 ? 'Raty' : 'Termin zwrotu'}</h2>
      <ul>${s.raty.map(rata => {
        const zaplacona = rata.status === 'zakończona';
        const zostaje = zaplacona ? 0 : doZaplatyRaty(p, rata);
        const czesciowo = !zaplacona && zostaje < Number(rata.kwota) - 0.005;
        const po = !zaplacona && rata.nastepna_data < dzis;
        return `<li class="wiersz-raty ${zaplacona ? 'rozliczona' : ''}">
          <span class="srodek"><span class="tytul">${esc(dataSlownie(rata.nastepna_data))}</span>
            <span class="opis">${esc(rata.nazwa)}${czesciowo ? `, zostało ${esc(kwotaTxt(zostaje, p.waluta))}` : ''}</span>
            ${po ? '<span class="znaczniki"><span class="znacznik anul">po terminie</span></span>' : ''}</span>
          <span class="kwota-wiersza">${esc(kwotaTxt(Number(rata.kwota), p.waluta))}</span>
          ${zaplacona ? `<span class="znacznik rozliczono">${slowoZaplaty}</span>`
            : p.status === 'aktywna' ? `<button type="button" class="przycisk-maly" data-akcja="zaplac-rate" data-v="${esc(rata.id)}">${slowoZaplaty}</button>` : ''}
        </li>`;
      }).join('')}</ul>
    </section>` : ''}

    <section class="dzien">
      <h2>${plus ? 'Zwroty' : 'Spłaty'}</h2>
      ${s.splaty.length ? `<ul>${s.splaty.map(t => `<li class="wiersz-raty">
          <span class="srodek"><span class="tytul">${esc(dataSlownie(t.data_operacji))}</span>
            <span class="opis">${t.konto ? `<span class="etykieta-konta" style="--k:${esc(kolorKonta(t.konto))}">${esc(t.konto)}</span>` : ''} ${esc(t.status || '')}</span></span>
          <span class="kwota-wiersza ${plus ? 'plus' : 'minus'}">${plus ? '+' : '−'}${esc(kwotaTxt(Number(t.kwota), t.waluta))}</span>
          <button type="button" class="przycisk-maly drugorzedny" data-akcja="cofnij-splate" data-v="${esc(t.id)}">Cofnij</button>
        </li>`).join('')}</ul>` : `<p class="pusto">Jeszcze nic ${plus ? 'nie wróciło' : 'nie spłacono'}.</p>`}
    </section>
    ${pierwotna ? `<p class="uwagi-podsumowania">Wpis pożyczki: ${esc(dataSlownie(pierwotna.data_operacji))}, ${esc(pierwotna.status)}.</p>` : ''}
  </section>`;
}

async function oknoSplaty(p) {
  const s = stanPozyczki(p);
  const plus = stronaPozyczki(p) === 'do-odzyskania';
  const domyslna = s.nastepna ? doZaplatyRaty(p, s.nastepna) : s.pozostalo;
  const kontoDomyslne = s.nastepna?.konto || p.konto || konta()[0]?.nazwa || '';
  const ok = await okno(plus ? `Zwrot od: ${p.osoba}` : `Spłata dla: ${p.osoba}`, `
    <label class="pole"><span class="etykieta">Kwota (${esc(p.waluta || 'PLN')}), zostało ${esc(kwotaTxt(s.pozostalo, p.waluta))}</span>
      <input name="s-kwota" inputmode="decimal" value="${esc(liczbaNaTekst(domyslna))}" autocomplete="off"></label>
    <label class="pole"><span class="etykieta">Data</span><input name="s-data" type="date" value="${dataLok()}"></label>
    <label class="pole"><span class="etykieta">${plus ? 'Wpłynęło na konto' : 'Zapłacono z konta'}</span>
      <select name="s-konto">${konta().map(k => `<option ${k.nazwa === kontoDomyslne ? 'selected' : ''}>${esc(k.nazwa)}</option>`).join('')}</select></label>`,
  [{ etykieta: 'Wróć', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Zapisz', wartosc: true, autofocus: true }]);
  if (!ok) return;
  const kwota = zaokr(liczba($('#okno [name="s-kwota"]').value));
  const data = $('#okno [name="s-data"]').value || dataLok();
  const konto = $('#okno [name="s-konto"]').value;
  if (!(kwota > 0)) { toast('Wpisz kwotę większą od zera.', 'blad'); return; }
  if (kwota > s.pozostalo + 0.005) {
    const tak = await okno('Kwota większa niż dług', `<p>Zostało ${esc(kwotaTxt(s.pozostalo, p.waluta))}, a wpisano ${esc(kwotaTxt(kwota, p.waluta))}. Zapisać mimo to?</p>`,
      [{ etykieta: 'Popraw', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Zapisz', wartosc: true }]);
    if (!tak) return;
  }
  await dodajSplate(p, { kwota, data, konto });
  toast(`Zapisano ${plus ? 'zwrot' : 'spłatę'} ${kwotaTxt(kwota, p.waluta)}.`, 'ok');
}

export async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'zakladka') { zakladka = v; bezSkoku(() => render()); return; }
  const id = decodeURIComponent(location.hash.split('/')[1] || '');
  const p = dane.pozyczki.find(x => x.id === id);
  if (!p) return;
  if (akcja === 'dodaj-splate') await oknoSplaty(p);
  else if (akcja === 'zaplac-rate') {
    b.disabled = true;
    const rata = dane.planowane.find(x => x.id === v);
    const t = rata && await zaplacRate(rata);
    if (t) toast(`Zapisano ${kwotaTxt(Number(t.kwota), t.waluta)}.`, 'ok');
  } else if (akcja === 'cofnij-splate') {
    const t = dane.transakcje.find(x => x.id === v);
    if (!t) return;
    const tak = await okno('Cofnąć tę spłatę?', `<p>Transakcja ${esc(kwotaTxt(Number(t.kwota), t.waluta))} z ${esc(dataSlownie(t.data_operacji).toLowerCase())} zostanie anulowana, a raty wrócą do rozliczenia.</p>`,
      [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Cofnij spłatę', wartosc: true, klasa: 'niebezpieczny' }]);
    if (!tak) return;
    await cofnijSplate(t);
    toast('Spłata cofnięta.', 'ok');
  } else if (akcja === 'zamknij') {
    const tak = await okno('Zamknąć pożyczkę bez pełnej spłaty?', '<p>Pozostałe raty znikną z planowanych. Pożyczkę można później przywrócić.</p>',
      [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Zamknij', wartosc: true }]);
    if (!tak) return;
    const raty = dane.planowane.filter(x => x.pozyczka_id === p.id && x.status === 'aktywna').map(x => ({ ...x, status: 'wstrzymana' }));
    await sync.zapiszWiele([{ karta: 'POZYCZKI', wiersze: [{ ...p, status: 'zamknięta' }] }, { karta: 'PLANOWANE', wiersze: raty }]);
    await wczytajDane();
  } else if (akcja === 'przywroc') {
    const raty = dane.planowane.filter(x => x.pozyczka_id === p.id && x.status === 'wstrzymana').map(x => ({ ...x, status: 'aktywna' }));
    await zapiszIUzgodnij(p.id, [{ karta: 'POZYCZKI', wiersze: [{ ...p, status: 'aktywna' }] }, { karta: 'PLANOWANE', wiersze: raty }]);
  } else if (akcja === 'anuluj') {
    const tak = await okno('Anulować wpis pożyczki?', '<p>Pożyczka, jej transakcja i raty dostaną status „anulowana”. Użyj tego, gdy wpis był pomyłką.</p>',
      [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Anuluj wpis', wartosc: true, klasa: 'niebezpieczny' }]);
    if (!tak) return;
    await sync.zapiszWiele([
      { karta: 'POZYCZKI', wiersze: [{ ...p, status: 'anulowana' }] },
      { karta: 'TRANSAKCJE', wiersze: dane.transakcje.filter(t => t.pozyczka_id === p.id).map(t => ({ ...t, status: 'anulowana' })) },
      { karta: 'PLANOWANE', wiersze: dane.planowane.filter(x => x.pozyczka_id === p.id).map(x => ({ ...x, status: 'anulowana' })) },
    ]);
    await wczytajDane();
    toast('Pożyczka anulowana.', 'ok');
    location.hash = '#pozyczki';
    return;
  } else return;
  bezSkoku(() => render(p.id));
}

export const ekran = { render, klik };
