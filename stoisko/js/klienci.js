// Ekrany „Klienci” (#klienci) i „Klient” (#klient/<id> albo #klient/nowy):
// dane kontaktowe, grupa cenowa, własny rabat, kod do formularza zamówień i ceny specjalne na wybrane produkty.

import { $, $$, esc, kwotaTxt, num, zaokr, liczba, liczbaNaTekst, uuid, normalizuj, toast, okno, odmiana, dataKrotko } from './util.js';
import { dane, wczytaj, klient, telefonE164, telefonCzytelny, grupaCenowa, rabatKlienta, cenySpecjalneKlienta, produktSymbolu,
  aktywny, nowyKodKlienta, opisCenKlienta, poziomyGrupy } from './dane.js';
import { ADRES_FORMULARZA, NAZWY_GRUP_POZIOMOW } from './konfiguracja.js';
import * as sync from './sync.js';

const stan = { szukaj: '', tylkoZCenami: false, szukajProduktu: '' };

// ───────────────────────── lista ─────────────────────────

function htmlListy() {
  const slowa = normalizuj(stan.szukaj).split(/\s+/).filter(Boolean);
  const l = dane.klienci.filter(k => {
    if (stan.tylkoZCenami && !rabatKlienta(k) && !cenySpecjalneKlienta(k.id).length && !k.kod) return false;
    const t = normalizuj([k.nazwa, k.telefon, k.email, k.kod, grupaCenowa(k.grupa)?.nazwa].join(' '));
    return slowa.every(s => t.includes(s));
  });
  if (!l.length) return '<p class="pusto">Brak klientów dla tego filtra.</p>';
  return `<ul class="lista-zam">${l.slice(0, 300).map(k => `<li><a href="#klient/${encodeURIComponent(k.id)}">
      <span class="lz-klient">${esc(k.nazwa || 'bez nazwy')}<small>${esc([telefonCzytelny(k.telefon), k.email].filter(Boolean).join(' · ') || '—')}</small></span>
      <span class="lz-kwota">${opisCenKlienta(k) ? `<span class="status oplacone">${esc(opisCenKlienta(k))}</span>` : ''}${k.kod ? `<small class="kod">${esc(k.kod)}</small>` : ''}</span>
    </a></li>`).join('')}</ul>`;
}

function renderListy() {
  $('#widok').innerHTML = `
  <section class="ekran">
    <header class="naglowek-zam"><h1>Klienci</h1><a class="przycisk" href="#klient/nowy">+ Nowy klient</a></header>
    <div class="chipy male filtry">
      <button type="button" class="chip" data-filtr="wszyscy" aria-pressed="${!stan.tylkoZCenami}">Wszyscy (${dane.klienci.length})</button>
      <button type="button" class="chip" data-filtr="ceny" aria-pressed="${stan.tylkoZCenami}">Z rabatem lub kodem</button>
    </div>
    <label class="pole szukaj"><span class="sr">Szukaj klienta</span>
      <input type="search" id="szukaj-kl" value="${esc(stan.szukaj)}" placeholder="Nazwa, telefon, e-mail, kod" autocomplete="off"></label>
    <div id="lista-kl">${htmlListy()}</div>
  </section>`;
}

// ───────────────────────── klient ─────────────────────────

let edytowany = null;   // kopia klienta na ekranie (nowy klient ma id już przy otwarciu)

function htmlCenSpecjalnych(k) {
  const ceny = cenySpecjalneKlienta(k.id);
  const r = rabatKlienta(k);
  return `${ceny.length ? `<table class="tabela"><tbody>${ceny.map(c => {
      const p = produktSymbolu(String(c.symbol));
      return `<tr><td>${esc(p?.nazwa || c.symbol)}<small>${esc(c.symbol)}${p ? ' · cennik ' + esc(kwotaTxt(p.cena)) : ''}</small></td>
        <td class="liczba"><b>${esc(kwotaTxt(num(c.cena)))}</b></td>
        <td class="liczba"><button type="button" class="usun" data-akcja="usun-cene" data-id="${esc(c.id)}" aria-label="Usuń cenę specjalną">×</button></td></tr>`;
    }).join('')}</tbody></table>` : `<p class="pusto">Brak cen specjalnych${r ? ` – na wszystkie produkty działa rabat ${esc(String(r).replace('.', ','))}%` : ''}.</p>`}
    <label class="pole"><span class="etykieta">Dodaj cenę specjalną</span>
      <input type="search" id="szukaj-prod" value="${esc(stan.szukajProduktu)}" placeholder="Szukaj produktu: nazwa lub symbol" autocomplete="off"></label>
    <div id="wyniki-prod">${htmlWynikowProduktu()}</div>`;
}

function htmlWynikowProduktu() {
  const slowa = normalizuj(stan.szukajProduktu).split(/\s+/).filter(Boolean);
  if (!slowa.length) return '';
  const l = dane.cennik.filter(p => slowa.every(s => normalizuj(p.symbol + ' ' + p.nazwa).includes(s))).slice(0, 8);
  if (!l.length) return '<p class="pusto">Nic nie pasuje.</p>';
  return `<ul class="pozycje">${l.map(p => `<li data-symbol="${esc(p.symbol)}"><div class="poz-dol cena-spec">
      <span class="poz-nazwa">${esc(p.nazwa)}<small>${esc(p.symbol)} · cennik ${esc(kwotaTxt(p.cena))}</small></span>
      <label class="cena"><span>Cena dla klienta</span><input data-pole="cena-spec" inputmode="decimal" placeholder="${esc(liczbaNaTekst(p.cena))}"></label>
      <button type="button" data-akcja="dodaj-cene">Dodaj</button></div></li>`).join('')}</ul>`;
}

function htmlZamowien(k) {
  const z = dane.zamowienia.filter(x => String(x.klient_id) === String(k.id)).slice(0, 20);
  if (!z.length) return '<p class="pusto">Brak zamówień.</p>';
  return `<ul class="lista-zam">${z.map(x => `<li><a href="#zamowienie/${encodeURIComponent(x.id)}">
    <span class="lz-numer">${esc(x.id)}</span><span class="lz-klient"><small>${esc(dataKrotko(x.data))} · ${esc(x.status || '')}</small></span>
    <span class="lz-kwota"><b>${esc(kwotaTxt(num(x.suma_brutto)))}</b></span></a></li>`).join('')}</ul>`;
}

function renderKlienta(id) {
  const nowy = id === 'nowy';
  if (!edytowany || (nowy ? !edytowany._nowy : String(edytowany.id) !== String(id))) {
    const k = nowy ? null : klient(id);
    if (!nowy && !k) { $('#widok').innerHTML = '<section class="ekran"><h1>Nie ma takiego klienta</h1><p><a href="#klienci">Wróć do listy</a></p></section>'; return; }
    edytowany = nowy ? { id: uuid(), _nowy: true, nazwa: '', telefon: '', email: '', adres: '', grupa: '', rabat_proc: '', kod: '', uwagi: '', zrodlo: 'stoisko' } : { ...k };
    stan.szukajProduktu = '';
  }
  const k = edytowany;
  const grupy = dane.grupyCenowe.filter(aktywny);
  const link = k.kod ? `${ADRES_FORMULARZA}#kod=${encodeURIComponent(k.kod)}` : '';
  $('#widok').innerHTML = `
  <section class="ekran ustawienia">
    <header class="naglowek-zam"><div><span class="etykieta">${k._nowy ? 'Nowy klient' : 'Klient'}</span><h1>${esc(k.nazwa || 'Bez nazwy')}</h1></div>
      <a class="kontekst" href="#klienci">← Klienci</a></header>

    <form class="panel" data-forma="klient" novalidate>
      <h2>Dane</h2>
      <label class="pole"><span class="etykieta">Imię i nazwisko / firma</span><input name="nazwa" autocomplete="off" value="${esc(k.nazwa)}"></label>
      <label class="pole"><span class="etykieta">Telefon</span><input name="telefon" type="tel" inputmode="tel" autocomplete="off" value="${esc(telefonCzytelny(k.telefon))}"></label>
      <label class="pole"><span class="etykieta">E-mail</span><input name="email" type="email" inputmode="email" autocomplete="off" value="${esc(k.email)}"></label>
      <label class="pole"><span class="etykieta">Adres dostawy</span><textarea name="adres" rows="2">${esc(k.adres)}</textarea></label>

      <h2>Ceny</h2>
      ${Object.entries(NAZWY_GRUP_POZIOMOW).map(([g, n]) => {
        const lista = poziomyGrupy(g).filter(aktywny);
        const opcje = rodzaj => lista.filter(p => (p.rodzaj === 'hurt') === (rodzaj === 'hurt'));
        return `<label class="pole"><span class="etykieta">Poziom cen – ${esc(n)}</span>
          <select name="poziom_${g}"><option value="">Ceny katalogowe</option>
            ${['detal', 'hurt'].map(r => opcje(r).length ? `<optgroup label="${r === 'hurt' ? 'Hurtowe' : 'Detaliczne'}">${opcje(r).map(p => `<option value="${esc(p.id)}" ${String(k['poziom_' + g]) === String(p.id) ? 'selected' : ''}>${esc(p.nazwa)}</option>`).join('')}</optgroup>` : '').join('')}
          </select>${!lista.length ? '<span class="podpowiedz">Poziomy ustawisz w Sklep → Poziomy cen.</span>' : ''}</label>`;
      }).join('')}
      <label class="pole"><span class="etykieta">Grupa rabatowa (pozostałe produkty)</span>
        <select name="grupa"><option value="">Detal (bez rabatu)</option>${grupy.map(g => `<option value="${esc(g.id)}" ${String(k.grupa) === String(g.id) ? 'selected' : ''}>${esc(g.nazwa)} – rabat ${esc(String(num(g.rabat_proc)).replace('.', ','))}%</option>`).join('')}</select>
        ${!grupy.length ? '<span class="podpowiedz">Grupy (np. Hurt −30%) dodasz w zakładce Sklep.</span>' : ''}</label>
      <label class="pole"><span class="etykieta">Własny rabat w % (dla produktów bez ceny w poziomie; zastępuje rabat grupy)</span>
        <input name="rabat_proc" inputmode="decimal" autocomplete="off" value="${esc(k.rabat_proc === '' || k.rabat_proc == null ? '' : String(k.rabat_proc).replace('.', ','))}" placeholder="np. 15"></label>

      <h2>Kod do formularza zamówień</h2>
      <p class="podpowiedz">Klient wpisuje kod w formularzu i widzi swoje ceny.</p>
      <div class="z-przyciskiem"><input name="kod" autocomplete="off" autocapitalize="characters" value="${esc(k.kod)}" placeholder="brak kodu">
        <button type="button" class="drugorzedny" data-akcja="nowy-kod">${k.kod ? 'Zmień' : 'Utwórz kod'}</button></div>
      ${link ? `<p class="podpowiedz">Link z kodem: <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></p>
        <div class="przyciski"><button type="button" class="drugorzedny" data-akcja="kopiuj-link">Kopiuj link</button></div>` : ''}

      <label class="pole"><span class="etykieta">Uwagi</span><textarea name="uwagi" rows="2">${esc(k.uwagi)}</textarea></label>
      <div class="przyciski"><button type="submit">Zapisz klienta</button></div>
    </form>

    ${k._nowy ? '' : `<article class="panel"><h2>Ceny specjalne</h2><div id="ceny-spec">${htmlCenSpecjalnych(k)}</div></article>
    <article class="panel"><h2>Zamówienia</h2>${htmlZamowien(k)}</article>`}
  </section>`;
}

function render(arg) {
  if (location.hash.startsWith('#klient/')) renderKlienta(arg || 'nowy');
  else { edytowany = null; renderListy(); }
}

// ───────────────────────── zapis ─────────────────────────

function zFormularza(form) {
  const f = form.elements;
  const rabat = String(f.rabat_proc.value).trim();
  return {
    nazwa: f.nazwa.value.trim(), telefon: f.telefon.value.trim(), email: f.email.value.trim(), adres: f.adres.value.trim(),
    grupa: f.grupa.value, rabat_proc: rabat === '' ? '' : liczba(rabat), poziom_rape: f.poziom_rape.value, poziom_zielarnia: f.poziom_zielarnia.value, kod: f.kod.value.trim().toUpperCase(), uwagi: f.uwagi.value.trim(),
  };
}

async function zapiszKlienta(form) {
  const w = zFormularza(form);
  const tel = w.telefon ? telefonE164(w.telefon) : '';
  const blad = !w.nazwa ? 'Wpisz nazwę klienta.'
    : w.telefon && !tel ? 'Sprawdź numer telefonu.'
    : w.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w.email) ? 'Sprawdź adres e-mail.'
    : w.rabat_proc !== '' && !(w.rabat_proc >= 0 && w.rabat_proc < 100) ? 'Rabat: liczba od 0 do 99.'
    : w.kod && w.kod.replace(/[^A-Z0-9]/g, '').length < 6 ? 'Kod: co najmniej 6 liter lub cyfr.'
    : '';
  if (blad) { toast(blad, 'blad', 5000); return; }
  const czysty = v => String(v || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (w.kod && dane.klienci.some(k => String(k.id) !== String(edytowany.id) && czysty(k.kod) === czysty(w.kod))) {
    toast('Ten kod ma już inny klient.', 'blad', 5000);
    return;
  }
  if (tel && dane.klienci.some(k => String(k.id) !== String(edytowany.id) && telefonE164(k.telefon) === tel)) {
    const dalej = await okno('Ten telefon ma już inny klient', '<p>Zapisać mimo to? Przy zamówieniach klient jest rozpoznawany po telefonie.</p>',
      [{ etykieta: 'Wróć', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Zapisz', wartosc: true }]);
    if (!dalej) return;
  }
  const { _nowy, ...stary } = edytowany;
  const wiersz = { ...stary, ...w, telefon: tel };
  await sync.zapisz([{ karta: 'KLIENCI', wiersze: [wiersz] }]);
  await wczytaj();
  edytowany = { ...wiersz };
  toast(`Zapisano: ${wiersz.nazwa}.`, 'ok');
  if (_nowy) location.replace('#klient/' + encodeURIComponent(wiersz.id));
  else renderKlienta(wiersz.id);
}

async function dodajCene(li) {
  const symbol = li.dataset.symbol;
  const p = produktSymbolu(symbol);
  const t = $('[data-pole="cena-spec"]', li).value.trim();
  const c = zaokr(liczba(t));
  if (!t || !isFinite(c) || c < 0) { toast('Wpisz cenę dla klienta.', 'blad'); return; }
  const istn = cenySpecjalneKlienta(edytowany.id).find(x => String(x.symbol) === symbol);
  await sync.zapisz([{ karta: 'CENY_SPECJALNE', wiersze: [{ id: istn?.id || uuid(), klient_id: edytowany.id, symbol, cena: c, uwagi: '', aktywna: true }] }]);
  await wczytaj();
  stan.szukajProduktu = '';
  toast(`${p?.nazwa || symbol}: ${kwotaTxt(c)} dla klienta.`, 'ok');
  $('#ceny-spec').innerHTML = htmlCenSpecjalnych(edytowany);
}

async function klik(e) {
  const f = e.target.closest('[data-filtr]');
  if (f) {
    stan.tylkoZCenami = f.dataset.filtr === 'ceny';
    $$('.filtry .chip').forEach(c => c.setAttribute('aria-pressed', String(c === f)));
    $('#lista-kl').innerHTML = htmlListy();
    return;
  }
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const akcja = b.dataset.akcja;
  if (akcja === 'nowy-kod') {
    const pole = $('[name="kod"]');
    if (pole.value && !(await okno('Zmienić kod?', '<p>Stary kod przestanie działać w formularzu.</p>',
      [{ etykieta: 'Zostaw', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Zmień kod', wartosc: true }]))) return;
    pole.value = nowyKodKlienta();
    toast('Kod utworzony – zapisz klienta.', 'ok');
  } else if (akcja === 'kopiuj-link') {
    const link = `${ADRES_FORMULARZA}#kod=${encodeURIComponent(edytowany.kod)}`;
    try { await navigator.clipboard.writeText(link); toast('Skopiowano link.', 'ok'); } catch { toast(link, '', 8000); }
  } else if (akcja === 'dodaj-cene') {
    await dodajCene(b.closest('li[data-symbol]'));
  } else if (akcja === 'usun-cene') {
    const c = dane.cenySpecjalne.find(x => String(x.id) === b.dataset.id);
    if (!c) return;
    await sync.zapisz([{ karta: 'CENY_SPECJALNE', wiersze: [{ ...c, aktywna: false }] }]);
    await wczytaj();
    $('#ceny-spec').innerHTML = htmlCenSpecjalnych(edytowany);
  }
}

function wejscie(e) {
  if (e.target.id === 'szukaj-kl') { stan.szukaj = e.target.value; $('#lista-kl').innerHTML = htmlListy(); }
  else if (e.target.id === 'szukaj-prod') { stan.szukajProduktu = e.target.value; $('#wyniki-prod').innerHTML = htmlWynikowProduktu(); }
}

export const ekran = { render, klik, wejscie, submit: form => { if (form.dataset.forma === 'klient') zapiszKlienta(form); } };
