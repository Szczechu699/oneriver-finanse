// Ekran zamówienia: podsumowanie, wysyłka SMS / WhatsApp (także ponowna), zmiana statusu i numer paragonu z Subiekta.
// Zamówienie z formularza klienta (status „nowe”) najpierw się sprawdza: ceny po rabacie, ilości, koszt dostawy,
// forma płatności – i dopiero „Potwierdź” wysyła klientowi podsumowanie z danymi do płatności.

import { $, $$, esc, kwotaTxt, iloscTxt, num, zaokr, liczba, liczbaNaTekst, dataKrotko, toast, okno } from './util.js';
import { wczytaj, zamowienie, pozycjeZamowienia, klient, telefonE164, telefonCzytelny, opisCenKlienta } from './dane.js';
import { STATUSY, PLATNE_POZNIEJ, FORMY, ETYKIETY_STATUSOW, OSOBY_WYSYLKI, czyTransport } from './konfiguracja.js';
import { eksportujEpp } from './eksport-epp.js';
import { ustawienia } from './api.js';
import { trescWiadomosci, trescDlaWysylki, linkSms, linkWhatsApp, linkWhatsAppDoGrupy, otworzLink, platnosciZamowienia } from './wiadomosc.js';
import { dataLok } from './util.js';
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
        ${!nowe && z.dostawa && !anulowane ? `<article class="panel do-grupy"><h2>Do grupy ZAMÓWIENIA</h2>${htmlWysylki(z)}</article>` : ''}
      </div>

      <div>
        ${nowe ? '' : `<article class="panel">
          <h2>Pozycje</h2>
          <table class="tabela"><tbody>${poz.filter(p => !czyTransport(p.symbol)).map(p => `<tr>
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
            <div><dt>Płatność</dt><dd>${platnosciZamowienia(z).map(p => `${esc(p.forma)} ${esc(kwotaTxt(p.kwota))} – ${p.zaplacone ? 'zapłacone' : '<b>czeka</b>'}`).join('<br>')}</dd></div>
            ${z.dostawa ? `<div><dt>Dostawa</dt><dd>${esc(z.dostawa)}${z.adres_dostawy ? '<br>' + esc(z.adres_dostawy) : ''}${z.nr_przesylki ? `<br><small>nr przesyłki ${esc(z.nr_przesylki)}</small>` : ''}</dd></div>` : ''}
          </dl>
          ${z.dostawa && !anulowane && !z.nr_przesylki ? htmlInpost(z, k) : ''}
          <dl class="info">
            <div><dt>Wydarzenie</dt><dd>${esc([z.wydarzenie, z.magazyn, z.podmiot].filter(Boolean).join(' · ') || '—')}</dd></div>
            ${z.uwagi ? `<div><dt>Uwagi</dt><dd>${esc(z.uwagi)}</dd></div>` : ''}
          </dl>
          ${nowe ? '' : `<form data-forma="paragon" class="z-przyciskiem">
            <label class="pole"><span class="etykieta">Numer paragonu w Subiekcie</span>
              <span class="z-przyciskiem"><input name="nr" value="${esc(z.nr_dok_sgt || '')}" placeholder="np. PA 123/11/2026" autocomplete="off">
              <button type="submit" class="drugorzedny">Zapisz</button></span></label>
          </form>
          ${!anulowane ? `<p class="podpowiedz">${z.epp_eksport ? `Plik EPP pobrany ${esc(dataKrotko(String(z.epp_eksport).slice(0, 10)))}.` : 'Paragon do Subiekta: pobierz plik EPP i wczytaj go w Subiekcie (Operacje → Odbierz z… → Plik EDI++).'}
            <button type="button" class="link" data-akcja="epp">${z.epp_eksport ? 'Pobierz ponownie' : 'Pobierz plik EPP'}</button></p>` : ''}
          <div class="przyciski">
            ${!anulowane ? `<a class="przycisk" href="#edytuj/${encodeURIComponent(z.id)}">Edytuj zamówienie</a>` : ''}
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

/** Dane do nadania paczki w aplikacji InPost Mobile – każde pole osobno do skopiowania. */
function htmlInpost(z, k) {
  const tel = telefonE164(k?.telefon);
  const pola = [
    ['Odbiorca', k?.nazwa || ''],
    ['Telefon', tel.startsWith('+48') ? tel.slice(3) : tel],
    ['E-mail', k?.email || ''],
    [/paczkomat/i.test(z.dostawa) ? 'Paczkomat' : 'Adres', z.adres_dostawy || ''],
  ].filter(([, v]) => v);
  return `<div class="inpost"><span class="etykieta">Nadanie w InPost Mobile – dotknij, żeby skopiować</span>
    <div class="kopiuj-pola">${pola.map(([n, v]) => `<button type="button" class="drugorzedny" data-akcja="kopiuj-pole" data-tekst="${esc(v)}"><small>${esc(n)}</small>${esc(v)}</button>`).join('')}</div></div>`;
}

/** Kod nadania z InPost Mobile, osoba wysyłająca i przekazanie zamówienia do grupy ZAMÓWIENIA. */
function htmlWysylki(z) {
  return `<form data-forma="wysylka" class="wysylka">
      <label class="pole"><span class="etykieta">Kod nadania z InPost</span>
        <input name="kod" value="${esc(z.kod_nadania || '')}" autocomplete="off" inputmode="text" placeholder="wklej kod z aplikacji InPost"></label>
      <span class="etykieta">Kto wysyła</span>
      <div class="chipy">${OSOBY_WYSYLKI.map(o => `<label class="chip-radio"><input type="radio" name="kto" value="${esc(o)}" ${z.realizuje === o ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>
      <div class="przyciski">
        <button type="submit" data-kanal="udostepnij">Zapisz i wyślij na Messenger</button>
        <button type="submit" data-kanal="wa-grupa" class="whatsapp">Zapisz i wyślij na WhatsApp</button>
      </div>
      ${z.nadano ? `<p class="podpowiedz">Przekazano do wysyłki: ${esc(z.realizuje || '')}, ${esc(dataKrotko(z.nadano))}.</p>` : ''}
    </form>`;
}

async function przekazWysylke(form, kanal) {
  const z = zamowienie(biezace);
  const kod = form.elements.kod.value.trim();
  const kto = form.querySelector('[name=kto]:checked')?.value || '';
  if (!kto) { toast('Wybierz, kto wysyła.', 'blad'); return; }
  if (!kod && !(await okno('Bez kodu nadania?', '<p>Kod z aplikacji InPost nie jest wpisany. Wysłać wiadomość bez niego?</p>',
    [{ etykieta: 'Wpiszę kod', wartosc: false, klasa: 'drugorzedny', autofocus: true }, { etykieta: 'Wyślij bez kodu', wartosc: true }]))) return;
  const nowy = { ...z, kod_nadania: kod, realizuje: kto, nadano: z.nadano || dataLok() };
  const tekst = trescDlaWysylki(nowy, pozycjeZamowienia(z.id), klient(z.klient_id));
  // najpierw udostępnienie (przeglądarka pozwala na nie tylko zaraz po dotknięciu), potem zapis
  if (kanal === 'udostepnij' && navigator.share) {
    try { await navigator.share({ text: tekst }); } catch (e) { if (e.name !== 'AbortError') toast('Nie udało się udostępnić – tekst skopiowany.', 'blad'); }
  } else if (kanal === 'udostepnij') {
    try { await navigator.clipboard.writeText(tekst); } catch { /* bez schowka */ }
    toast('Tekst skopiowany – wklej go w grupie ZAMÓWIENIA na Messengerze.', 'ok', 6000);
  } else {
    otworzLink(linkWhatsAppDoGrupy(tekst));
  }
  await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: [nowy] }]);
  await wczytaj();
  render(z.id);
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
  if (akcja === 'epp') {
    try {
      const w = await eksportujEpp([z.id]);
      if (w.bledy.length) toast(w.bledy.join(' '), 'blad', 8000);
      else { await wczytaj(); toast(`Pobrano plik EPP dla ${z.id}.`, 'ok'); render(biezace); }
    } catch (err) { toast('Nie udało się utworzyć pliku: ' + err.message, 'blad'); }
    return;
  }
  else if (akcja === 'potwierdz') await potwierdz(b.dataset.kanal, b);
  else if (akcja === 'kopiuj-pole') {
    try { await navigator.clipboard.writeText(b.dataset.tekst); toast(`Skopiowano: ${b.dataset.tekst}`, 'ok', 2000); }
    catch { toast(b.dataset.tekst, '', 6000); }
  }
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
    const pl = platnosciZamowienia(z).map(p => ({ ...p, zaplacone: true }));
    await zmienZamowienie({ status: STATUSY.oplacone, platnosci: JSON.stringify(pl), zaplacono: num(z.suma_brutto) }, `Zamówienie ${z.id} opłacone.`);
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

async function submit(form, e) {
  if (form.dataset.forma === 'wysylka') { await przekazWysylke(form, e?.submitter?.dataset.kanal || 'udostepnij'); return; }
  if (form.dataset.forma !== 'paragon') return;
  const nr = form.elements.nr.value.trim();
  const z = zamowienie(biezace);
  if (nr === String(z.nr_dok_sgt || '')) return;
  await zmienZamowienie({ nr_dok_sgt: nr }, nr ? `Zapisano paragon ${nr}.` : 'Usunięto numer paragonu.');
}

export const ekran = { render, klik, wejscie, submit };
