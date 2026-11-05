// Ekran zamówienia: podsumowanie, wysyłka SMS / WhatsApp (także ponowna), zmiana statusu i numer paragonu z Subiekta.
// Zamówienie z formularza klienta (status „nowe”) najpierw się sprawdza: ceny po rabacie, ilości, koszt dostawy,
// forma płatności – i dopiero „Potwierdź” wysyła klientowi podsumowanie z danymi do płatności.

import { $, $$, esc, kwotaTxt, iloscTxt, num, zaokr, liczba, liczbaNaTekst, dataKrotko, toast, okno } from './util.js';
import { wczytaj, zamowienie, pozycjeZamowienia, klient, telefonE164, telefonCzytelny, opisCenKlienta } from './dane.js';
import { STATUSY, PLATNE_POZNIEJ, FORMY, ETYKIETY_STATUSOW } from './konfiguracja.js';
import { ustawienia } from './api.js';
import { trescWiadomosci, linkSms, linkWhatsApp, otworzLink } from './wiadomosc.js';
import * as sync from './sync.js';

let biezace = null;   // id zamówienia na ekranie
let tresc = '';        // treść wiadomości (sprzedawca może ją poprawić przed wysłaniem)
let autoKanal = '';
let edycja = null;     // { pozycje: Map(id → { cenaTxt, iloscTxt }), kosztTxt, forma } – dla zamówień „nowe”
let zapisuje = false;

const klasaStatusu = st => ({ [STATUSY.nowe]: 'nowe', [STATUSY.czeka]: 'czeka', [STATUSY.oplacone]: 'oplacone', [STATUSY.anulowane]: 'anulowane' }[st] || '');
export const etykietaStatusu = st => ETYKIETY_STATUSOW[st] || st || '';

// ───────────────────────── sprawdzanie zamówienia z formularza ─────────────────────────

function zacznijEdycje(z, poz) {
  edycja = { id: z.id, pozycje: new Map(poz.map(p => [p.id, { cenaTxt: '', iloscTxt: liczbaNaTekst(num(p.ilosc)) }])), kosztTxt: '', forma: z.forma_platnosci || 'Przelew' };
}
const cenaEd = p => { const t = String(edycja.pozycje.get(p.id)?.cenaTxt || '').trim(); return t ? zaokr(liczba(t)) : num(p.cena); };
const iloscEd = p => liczba(edycja.pozycje.get(p.id)?.iloscTxt ?? p.ilosc);
const wartoscEd = p => zaokr(cenaEd(p) * iloscEd(p));
const kosztEd = z => { const t = String(edycja.kosztTxt || '').trim(); return t ? zaokr(liczba(t)) : num(z.koszt_dostawy); };
const sumaProdEd = poz => zaokr(poz.reduce((a, p) => a + (isFinite(wartoscEd(p)) ? wartoscEd(p) : 0), 0));

function htmlEdycji(z, poz, tel) {
  return `<article class="panel do-potwierdzenia">
      <h2>Sprawdź zamówienie z formularza</h2>
      <p class="podpowiedz">Klient widział ceny ${esc(opisCenKlienta(klient(z.klient_id)) || 'detaliczne')}. Możesz wpisać cenę po rabacie, zmienić ilość i koszt dostawy.</p>
      <ul class="pozycje">${poz.map(p => `<li data-poz="${esc(p.id)}">
        <div class="poz-gora"><span class="poz-nazwa">${esc(p.nazwa)}<small>${esc(p.symbol)} · cennik ${esc(kwotaTxt(num(p.cena_cennik)))}${num(p.cena) !== num(p.cena_cennik) ? ' · klient ' + esc(kwotaTxt(num(p.cena))) : ''}</small></span></div>
        <div class="poz-dol">
          <label class="cena ilosc-ed"><span>Ilość</span><input data-ed="ilosc" inputmode="decimal" value="${esc(edycja.pozycje.get(p.id).iloscTxt)}"></label>
          <label class="cena"><span>Cena szt. (po rabacie)</span><input data-ed="cena" inputmode="decimal" autocomplete="off" value="${esc(edycja.pozycje.get(p.id).cenaTxt)}" placeholder="${esc(liczbaNaTekst(num(p.cena)))}"></label>
          <b class="poz-wartosc">${esc(kwotaTxt(wartoscEd(p)))}</b>
        </div></li>`).join('')}</ul>
      ${z.dostawa ? `<label class="pole"><span class="etykieta">Koszt dostawy – ${esc(z.dostawa)}</span>
        <input data-ed="koszt" inputmode="decimal" value="${esc(edycja.kosztTxt)}" placeholder="${esc(liczbaNaTekst(num(z.koszt_dostawy)))}"></label>` : ''}
      <span class="etykieta">Płatność</span>
      <div class="chipy formy">${FORMY.filter(([w]) => PLATNE_POZNIEJ.has(w)).map(([w, e]) => `<button type="button" class="chip" data-akcja="forma-ed" data-forma="${esc(w)}" aria-pressed="${edycja.forma === w}">${esc(e)}</button>`).join('')}</div>
      <div class="suma"><span>Razem</span><b id="suma-ed">${esc(kwotaTxt(zaokr(sumaProdEd(poz) + kosztEd(z))))}</b></div>
      <div class="zatwierdz">
        <button type="button" class="glowny" data-akcja="potwierdz" data-kanal="sms" ${tel ? '' : 'disabled'}>Potwierdź i wyślij SMS</button>
        <button type="button" class="whatsapp" data-akcja="potwierdz" data-kanal="wa" ${tel ? '' : 'disabled'}>Potwierdź i wyślij WhatsApp</button>
        <button type="button" class="link" data-akcja="potwierdz" data-kanal="">Potwierdź bez wiadomości</button>
        <button type="button" class="link" data-akcja="anuluj">Odrzuć zamówienie</button>
      </div>
    </article>`;
}

async function potwierdz(kanal, przycisk) {
  if (zapisuje) return;
  const z = zamowienie(biezace);
  const poz = pozycjeZamowienia(z.id);
  for (const p of poz) {
    if (!(iloscEd(p) > 0)) return toast(`Sprawdź ilość: ${p.nazwa}.`, 'blad', 5000);
    if (!isFinite(cenaEd(p)) || cenaEd(p) < 0) return toast(`Sprawdź cenę: ${p.nazwa}.`, 'blad', 5000);
  }
  if (!isFinite(kosztEd(z)) || kosztEd(z) < 0) return toast('Sprawdź koszt dostawy.', 'blad', 5000);
  zapisuje = true;
  przycisk.disabled = true;
  try {
    const u = ustawienia();
    const pozycje = poz.map(p => ({
      ...p, ilosc: iloscEd(p), cena: cenaEd(p), wartosc: wartoscEd(p),
      cena_reczna: p.cena_cennik === '' || Math.abs(num(p.cena_cennik) - cenaEd(p)) >= 0.005,
    }));
    const wartosc = sumaProdEd(poz);
    const koszt = kosztEd(z);
    await sync.zapisz([
      { karta: 'ZAMOWIENIA_POZ', wiersze: pozycje },
      { karta: 'ZAMOWIENIA', wiersze: [{
        ...z, status: STATUSY.czeka, forma_platnosci: edycja.forma, wartosc_produktow: wartosc, koszt_dostawy: koszt,
        suma_brutto: zaokr(wartosc + koszt), podmiot: z.podmiot || u.podmiot, magazyn: z.magazyn || u.magazyn,
      }] },
    ]);
    await wczytaj();
    edycja = null;
    biezace = null;   // treść wiadomości z nowymi cenami
    toast(`Potwierdzono zamówienie ${z.id}.`, 'ok');
    render(z.id + (kanal ? '/' + kanal : ''));
  } catch (err) {
    toast('Nie udało się zapisać: ' + err.message, 'blad', 7000);
  } finally {
    zapisuje = false;
    przycisk.disabled = false;
  }
}

// ───────────────────────── widok ─────────────────────────

function render(arg) {
  const [id, kanal] = String(arg || '').split('/');
  const z = zamowienie(id);
  if (!z) {
    $('#widok').innerHTML = `<section class="ekran"><h1>Nie ma takiego zamówienia</h1><p><a href="#lista">Wróć do listy</a></p></section>`;
    return;
  }
  const poz = pozycjeZamowienia(z.id);
  if (biezace !== z.id) { biezace = z.id; tresc = trescWiadomosci(z, poz); }
  const nowe = z.status === STATUSY.nowe;
  if (nowe && edycja?.id !== z.id) zacznijEdycje(z, poz);
  const k = klient(z.klient_id);
  const tel = telefonE164(k?.telefon);
  const czeka = sync.stanSynchronizacji().oczekujaceKlucze?.has('ZAMOWIENIA|' + z.id);
  const anulowane = z.status === STATUSY.anulowane;

  $('#widok').innerHTML = `
  <section class="ekran zamowienie">
    <header class="naglowek-zam">
      <div><span class="etykieta">Zamówienie${z.zrodlo === 'formularz' ? ' z formularza' : ''}</span><h1 class="numer">${esc(z.id)}</h1></div>
      <span class="status ${klasaStatusu(z.status)}">${esc(etykietaStatusu(z.status))}</span>
    </header>
    ${czeka ? '<p class="pasek-info">Zapisane na tym urządzeniu – wyśle się do arkusza, gdy będzie internet.</p>' : ''}

    <div class="uklad-zam">
      <div>
        ${nowe ? htmlEdycji(z, poz, tel) : `<article class="panel">
          <h2>Wiadomość do klienta</h2>
          ${tel ? `<p class="podpowiedz">Do: <b>${esc(k.nazwa || '')}</b> ${esc(telefonCzytelny(tel))}</p>` : '<p class="podpowiedz blad">To zamówienie nie ma telefonu klienta.</p>'}
          <label class="pole"><span class="sr">Treść wiadomości</span>
            <textarea id="tresc" rows="15" ${anulowane ? 'disabled' : ''}>${esc(tresc)}</textarea></label>
          <div class="zatwierdz">
            <button type="button" class="glowny" data-akcja="sms" ${tel && !anulowane ? '' : 'disabled'}>Wyślij SMS</button>
            <button type="button" class="whatsapp" data-akcja="wa" ${tel && !anulowane ? '' : 'disabled'}>Wyślij WhatsApp</button>
            <button type="button" class="link" data-akcja="kopiuj">Kopiuj treść</button>
            <button type="button" class="link" data-akcja="od-nowa">Przywróć treść</button>
          </div>
        </article>`}
      </div>

      <div>
        ${nowe ? '' : `<article class="panel">
          <h2>Pozycje</h2>
          <table class="tabela"><tbody>${poz.map(p => `<tr>
              <td>${esc(p.nazwa)}${p.symbol ? `<small>${esc(p.symbol)}</small>` : ''}</td>
              <td class="liczba">${esc(iloscTxt(num(p.ilosc)))} × ${esc(kwotaTxt(num(p.cena)))}${String(p.cena_reczna) === 'true' && p.cena_cennik !== '' ? `<small>cennik ${esc(kwotaTxt(num(p.cena_cennik)))}</small>` : ''}</td>
              <td class="liczba"><b>${esc(kwotaTxt(num(p.wartosc)))}</b></td></tr>`).join('')}
              ${z.dostawa ? `<tr><td>Dostawa<small>${esc(z.dostawa)}</small></td><td></td><td class="liczba"><b>${esc(kwotaTxt(num(z.koszt_dostawy)))}</b></td></tr>` : ''}</tbody>
            <tfoot><tr><td colspan="2">Razem</td><td class="liczba"><b>${esc(kwotaTxt(num(z.suma_brutto)))}</b></td></tr></tfoot></table>
        </article>`}

        <article class="panel">
          <h2>Szczegóły</h2>
          <dl class="info">
            <div><dt>Data</dt><dd>${esc(dataKrotko(z.data))}</dd></div>
            <div><dt>Klient</dt><dd>${k ? `<a href="#klient/${encodeURIComponent(k.id)}">${esc([k.nazwa, telefonCzytelny(k.telefon), k.email].filter(Boolean).join(' · '))}</a>` : '—'}</dd></div>
            <div><dt>Płatność</dt><dd>${esc(z.forma_platnosci || '')}</dd></div>
            ${z.dostawa ? `<div><dt>Dostawa</dt><dd>${esc(z.dostawa)}${z.adres_dostawy ? '<br>' + esc(z.adres_dostawy) : ''}</dd></div>` : ''}
            <div><dt>Wydarzenie</dt><dd>${esc([z.wydarzenie, z.magazyn, z.podmiot].filter(Boolean).join(' · ') || '—')}</dd></div>
            ${z.uwagi ? `<div><dt>Uwagi</dt><dd>${esc(z.uwagi)}</dd></div>` : ''}
          </dl>
          ${nowe ? '' : `<form data-forma="paragon" class="z-przyciskiem">
            <label class="pole"><span class="etykieta">Numer paragonu w Subiekcie</span>
              <span class="z-przyciskiem"><input name="nr" value="${esc(z.nr_dok_sgt || '')}" placeholder="np. PA 123/11/2026" autocomplete="off">
              <button type="submit" class="drugorzedny">Zapisz</button></span></label>
          </form>
          <div class="przyciski">
            ${z.status === STATUSY.czeka ? '<button type="button" data-akcja="oplacone">Oznacz jako opłacone</button>' : ''}
            ${!anulowane ? '<button type="button" class="drugorzedny" data-akcja="anuluj">Anuluj zamówienie</button>' : '<button type="button" class="drugorzedny" data-akcja="przywroc">Przywróć zamówienie</button>'}
          </div>`}
        </article>
        <p><a class="przycisk szeroki" href="#nowe">Nowe zamówienie</a></p>
      </div>
    </div>
  </section>`;

  // Po zatwierdzeniu wiadomość otwiera się sama; gdy przeglądarka to zablokuje, zostaje przycisk.
  if (kanal && autoKanal !== z.id + kanal && tel && !anulowane && !nowe) {
    autoKanal = z.id + kanal;
    history.replaceState(null, '', '#zamowienie/' + encodeURIComponent(z.id));
    otworz(kanal, tel);
  }
}

function otworz(kanal, tel) {
  otworzLink(kanal === 'wa' ? linkWhatsApp(tel, tresc) : linkSms(tel, tresc));
}

async function zmienZamowienie(zmiana, komunikat) {
  const z = zamowienie(biezace);
  await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: [{ ...z, ...zmiana }] }]);
  await wczytaj();
  toast(komunikat, 'ok');
  edycja = null;
  render(biezace);
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const z = zamowienie(biezace);
  const tel = telefonE164(klient(z?.klient_id)?.telefon);
  const akcja = b.dataset.akcja;
  if (akcja === 'sms' || akcja === 'wa') otworz(akcja, tel);
  else if (akcja === 'potwierdz') await potwierdz(b.dataset.kanal, b);
  else if (akcja === 'forma-ed') {
    edycja.forma = b.dataset.forma;
    $$('[data-akcja="forma-ed"]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.forma === edycja.forma)));
  } else if (akcja === 'kopiuj') {
    try { await navigator.clipboard.writeText(tresc); toast('Skopiowano treść wiadomości.', 'ok'); }
    catch { toast('Nie udało się skopiować – zaznacz tekst ręcznie.', 'blad'); }
  } else if (akcja === 'od-nowa') {
    tresc = trescWiadomosci(z, pozycjeZamowienia(z.id));
    $('#tresc').value = tresc;
  } else if (akcja === 'oplacone') {
    await zmienZamowienie({ status: STATUSY.oplacone }, `Zamówienie ${z.id} opłacone.`);
  } else if (akcja === 'anuluj') {
    const tak = await okno(`${z.status === STATUSY.nowe ? 'Odrzucić' : 'Anulować'} zamówienie ${z.id}?`,
      '<p>Zamówienie zostaje w arkuszu ze statusem „anulowane” i nie liczy się w rozliczeniach. Numer nie zostanie użyty ponownie.</p>',
      [{ etykieta: 'Nie', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: z.status === STATUSY.nowe ? 'Odrzuć' : 'Anuluj zamówienie', wartosc: true, klasa: 'niebezpieczny' }]);
    if (tak) await zmienZamowienie({ status: STATUSY.anulowane }, `Zamówienie ${z.id} anulowane.`);
  } else if (akcja === 'przywroc') {
    await zmienZamowienie({ status: PLATNE_POZNIEJ.has(z.forma_platnosci) ? STATUSY.czeka : STATUSY.oplacone }, `Zamówienie ${z.id} przywrócone.`);
  }
}

function wejscie(e) {
  if (e.target.id === 'tresc') { tresc = e.target.value; return; }
  const pole = e.target.dataset.ed;
  if (!pole || !edycja) return;
  const z = zamowienie(biezace);
  const poz = pozycjeZamowienia(z.id);
  if (pole === 'koszt') edycja.kosztTxt = e.target.value;
  else {
    const li = e.target.closest('[data-poz]');
    const st = edycja.pozycje.get(li.dataset.poz);
    if (pole === 'cena') st.cenaTxt = e.target.value;
    if (pole === 'ilosc') st.iloscTxt = e.target.value;
    const p = poz.find(x => x.id === li.dataset.poz);
    const w = wartoscEd(p);
    $('.poz-wartosc', li).textContent = isFinite(w) ? kwotaTxt(w) : '—';
  }
  const s = zaokr(sumaProdEd(poz) + kosztEd(z));
  $('#suma-ed').textContent = isFinite(s) ? kwotaTxt(s) : '—';
}

async function submit(form) {
  if (form.dataset.forma !== 'paragon') return;
  const nr = form.elements.nr.value.trim();
  const z = zamowienie(biezace);
  if (nr === String(z.nr_dok_sgt || '')) return;
  await zmienZamowienie({ nr_dok_sgt: nr }, nr ? `Zapisano paragon ${nr}.` : 'Usunięto numer paragonu.');
}

export const ekran = { render, klik, wejscie, submit };
