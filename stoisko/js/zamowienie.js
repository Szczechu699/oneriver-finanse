// Ekran zamówienia: podsumowanie, wysyłka SMS / WhatsApp (także ponowna), zmiana statusu i numer paragonu z Subiekta.

import { $, esc, kwotaTxt, iloscTxt, num, dataKrotko, toast, okno } from './util.js';
import { wczytaj, zamowienie, pozycjeZamowienia, klient, telefonE164, telefonCzytelny } from './dane.js';
import { STATUSY, PLATNE_POZNIEJ } from './konfiguracja.js';
import { trescWiadomosci, linkSms, linkWhatsApp, otworzLink } from './wiadomosc.js';
import * as sync from './sync.js';

let biezace = null;   // id zamówienia na ekranie
let tresc = '';        // treść wiadomości (sprzedawca może ją poprawić przed wysłaniem)
let autoKanal = '';

const klasaStatusu = st => ({ [STATUSY.czeka]: 'czeka', [STATUSY.oplacone]: 'oplacone', [STATUSY.anulowane]: 'anulowane' }[st] || '');

function render(arg) {
  const [id, kanal] = String(arg || '').split('/');
  const z = zamowienie(id);
  if (!z) {
    $('#widok').innerHTML = `<section class="ekran"><h1>Nie ma takiego zamówienia</h1><p><a href="#lista">Wróć do listy</a></p></section>`;
    return;
  }
  const poz = pozycjeZamowienia(z.id);
  if (biezace !== z.id) { biezace = z.id; tresc = trescWiadomosci(z, poz); }
  const k = klient(z.klient_id);
  const tel = telefonE164(k?.telefon);
  const czeka = sync.stanSynchronizacji().oczekujaceKlucze?.has('ZAMOWIENIA|' + z.id);
  const anulowane = z.status === STATUSY.anulowane;

  $('#widok').innerHTML = `
  <section class="ekran zamowienie">
    <header class="naglowek-zam">
      <div><span class="etykieta">Zamówienie</span><h1 class="numer">${esc(z.id)}</h1></div>
      <span class="status ${klasaStatusu(z.status)}">${esc(z.status || '')}</span>
    </header>
    ${czeka ? '<p class="pasek-info">Zapisane na tym urządzeniu – wyśle się do arkusza, gdy będzie internet.</p>' : ''}

    <div class="uklad-zam">
      <div>
        <article class="panel">
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
        </article>
      </div>

      <div>
        <article class="panel">
          <h2>Pozycje</h2>
          <table class="tabela"><tbody>${poz.map(p => `<tr>
              <td>${esc(p.nazwa)}${p.symbol ? `<small>${esc(p.symbol)}</small>` : ''}</td>
              <td class="liczba">${esc(iloscTxt(num(p.ilosc)))} × ${esc(kwotaTxt(num(p.cena)))}${String(p.cena_reczna) === 'true' && p.cena_cennik !== '' ? `<small>cennik ${esc(kwotaTxt(num(p.cena_cennik)))}</small>` : ''}</td>
              <td class="liczba"><b>${esc(kwotaTxt(num(p.wartosc)))}</b></td></tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="2">Razem</td><td class="liczba"><b>${esc(kwotaTxt(num(z.suma_brutto)))}</b></td></tr></tfoot></table>
        </article>

        <article class="panel">
          <h2>Szczegóły</h2>
          <dl class="info">
            <div><dt>Data</dt><dd>${esc(dataKrotko(z.data))}</dd></div>
            <div><dt>Klient</dt><dd>${k ? esc([k.nazwa, telefonCzytelny(k.telefon), k.email].filter(Boolean).join(' · ')) : '—'}</dd></div>
            <div><dt>Płatność</dt><dd>${esc(z.forma_platnosci || '')}</dd></div>
            <div><dt>Wydarzenie</dt><dd>${esc([z.wydarzenie, z.magazyn, z.podmiot].filter(Boolean).join(' · ') || '—')}</dd></div>
            ${z.uwagi ? `<div><dt>Uwagi</dt><dd>${esc(z.uwagi)}</dd></div>` : ''}
          </dl>
          <form data-forma="paragon" class="z-przyciskiem">
            <label class="pole"><span class="etykieta">Numer paragonu w Subiekcie</span>
              <span class="z-przyciskiem"><input name="nr" value="${esc(z.nr_dok_sgt || '')}" placeholder="np. PA 123/11/2026" autocomplete="off">
              <button type="submit" class="drugorzedny">Zapisz</button></span></label>
          </form>
          <div class="przyciski">
            ${z.status === STATUSY.czeka ? '<button type="button" data-akcja="oplacone">Oznacz jako opłacone</button>' : ''}
            ${!anulowane ? '<button type="button" class="drugorzedny" data-akcja="anuluj">Anuluj zamówienie</button>' : '<button type="button" class="drugorzedny" data-akcja="przywroc">Przywróć zamówienie</button>'}
          </div>
        </article>
        <p><a class="przycisk szeroki" href="#nowe">Nowe zamówienie</a></p>
      </div>
    </div>
  </section>`;

  // Po zatwierdzeniu wiadomość otwiera się sama; gdy przeglądarka to zablokuje, zostaje przycisk.
  if (kanal && autoKanal !== z.id + kanal && tel && !anulowane) {
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
  render(biezace);
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const z = zamowienie(biezace);
  const tel = telefonE164(klient(z?.klient_id)?.telefon);
  const akcja = b.dataset.akcja;
  if (akcja === 'sms' || akcja === 'wa') otworz(akcja, tel);
  else if (akcja === 'kopiuj') {
    try { await navigator.clipboard.writeText(tresc); toast('Skopiowano treść wiadomości.', 'ok'); }
    catch { toast('Nie udało się skopiować – zaznacz tekst ręcznie.', 'blad'); }
  } else if (akcja === 'od-nowa') {
    tresc = trescWiadomosci(z, pozycjeZamowienia(z.id));
    $('#tresc').value = tresc;
  } else if (akcja === 'oplacone') {
    await zmienZamowienie({ status: STATUSY.oplacone }, `Zamówienie ${z.id} opłacone.`);
  } else if (akcja === 'anuluj') {
    const tak = await okno(`Anulować zamówienie ${z.id}?`,
      '<p>Zamówienie zostaje w arkuszu ze statusem „anulowane” i nie liczy się w rozliczeniach. Numer nie zostanie użyty ponownie.</p>',
      [{ etykieta: 'Nie anuluj', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Anuluj zamówienie', wartosc: true, klasa: 'niebezpieczny' }]);
    if (tak) await zmienZamowienie({ status: STATUSY.anulowane }, `Zamówienie ${z.id} anulowane.`);
  } else if (akcja === 'przywroc') {
    await zmienZamowienie({ status: PLATNE_POZNIEJ.has(z.forma_platnosci) ? STATUSY.czeka : STATUSY.oplacone }, `Zamówienie ${z.id} przywrócone.`);
  }
}

function wejscie(e) { if (e.target.id === 'tresc') tresc = e.target.value; }

async function submit(form) {
  if (form.dataset.forma !== 'paragon') return;
  const nr = form.elements.nr.value.trim();
  const z = zamowienie(biezace);
  if (nr === String(z.nr_dok_sgt || '')) return;
  await zmienZamowienie({ nr_dok_sgt: nr }, nr ? `Zapisano paragon ${nr}.` : 'Usunięto numer paragonu.');
}

export const ekran = { render, klik, wejscie, submit };
