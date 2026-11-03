// Ekran „Ustawienia”: połączenie z arkuszem, synchronizacja, dane na urządzeniu.

import * as db from './db.js';
import * as sync from './sync.js';
import { ustawienia, zapiszUstawienia, skonfigurowane, wywolaj, wersjaApi } from './api.js';
import { $, esc, toast, okno } from './util.js';
import { dane, wczytajDane, konta } from './dane.js';

export const WERSJA = '0.4.0';
export const WYMAGANE_API = 3;

export function render(komunikat = '') {
  const u = ustawienia();
  const s = sync.stanSynchronizacji();
  const pierwszy = !skonfigurowane();
  const api = wersjaApi();
  $('#widok').innerHTML = `
  <section class="ekran ustawienia">
    ${pierwszy ? `<div class="powitanie">
      <h1>Połącz aplikację z arkuszem</h1>
      <p>Wpisz adres API i token z arkusza „One River – Finanse”. Zapiszą się tylko na tym urządzeniu.</p>
    </div>` : `<h1>Ustawienia</h1>`}

    ${!pierwszy && api && api < WYMAGANE_API ? `<div class="pasek-edycji"><span>Skrypt arkusza ma wersję ${api}, a ta wersja aplikacji potrzebuje ${WYMAGANE_API}. Wklej nowy plik Kod.gs w Apps Script i wdroż nową wersję. Do tego czasu pożyczki zapisują się tylko na tym urządzeniu.</span></div>` : ''}

    <form class="karta-ustawien" data-forma="polaczenie" novalidate>
      <h2>Połączenie z arkuszem</h2>
      <label class="pole"><span class="etykieta">Adres API (kończy się na /exec)</span>
        <input name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(u.url || '')}"
          placeholder="https://script.google.com/macros/s/…/exec" required></label>
      <label class="pole"><span class="etykieta">Token</span>
        <span class="z-przyciskiem"><input name="token" type="password" autocomplete="off" spellcheck="false" value="${esc(u.token || '')}" required>
        <button type="button" class="drugorzedny" data-akcja="pokaz-token">Pokaż</button></span></label>
      <label class="pole"><span class="etykieta">Kto korzysta z tego urządzenia</span>
        <input name="kto" autocomplete="off" value="${esc(u.kto || '')}" placeholder="np. Olek, tablet kiermasz">
        <span class="podpowiedz">Ta nazwa trafia do kolumny „kto” i do dziennika zmian.</span></label>
      <div class="przyciski"><button type="submit">Zapisz i sprawdź połączenie</button></div>
      <p class="komunikat" aria-live="polite">${komunikat}</p>
    </form>

    ${pierwszy ? '' : `<div class="karta-ustawien">
      <h2>Synchronizacja</h2>
      <dl class="info">
        <div><dt>Ostatnia</dt><dd>${s.ostatnia ? esc(new Date(s.ostatnia).toLocaleString('pl-PL')) : 'jeszcze nie było'}</dd></div>
        <div><dt>Zmiany do wysłania</dt><dd>${(s.oczekujace || 0) - (s.plikiOczekujace || 0)}</dd></div>
        <div><dt>Załączniki do wysłania</dt><dd>${s.plikiOczekujace || 0}</dd></div>
        <div><dt>Transakcje na urządzeniu</dt><dd>${dane.transakcje.length}</dd></div>
        <div><dt>Wersja skryptu arkusza</dt><dd>${api || 'nieznana'}</dd></div>
        ${s.blad ? `<div><dt>Ostatni błąd</dt><dd class="blad">${esc(s.blad)}</dd></div>` : ''}
      </dl>
      <div class="przyciski">
        <button type="button" data-akcja="synchronizuj">Synchronizuj teraz</button>
        <button type="button" class="drugorzedny" data-akcja="pelna">Pobierz wszystko od nowa</button>
      </div>
    </div>

    <div class="karta-ustawien">
      <h2>To urządzenie</h2>
      <p>Wersja aplikacji ${WERSJA}. Dane działają bez internetu i wysyłają się same, gdy wróci połączenie.</p>
      <div class="przyciski"><button type="button" class="niebezpieczny" data-akcja="wyczysc">Usuń dane z tego urządzenia</button></div>
    </div>`}
  </section>`;
}

async function zapiszPolaczenie(form) {
  const url = form.elements.url.value.trim();
  const token = form.elements.token.value.trim();
  const kto = form.elements.kto.value.trim();
  const msg = $('.komunikat', form);
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    msg.textContent = 'Adres musi zaczynać się od https://script.google.com/ i kończyć na /exec.';
    msg.className = 'komunikat blad';
    return;
  }
  if (!token) { msg.textContent = 'Wpisz token.'; msg.className = 'komunikat blad'; return; }
  zapiszUstawienia({ url, token, kto });
  msg.textContent = 'Sprawdzam połączenie…';
  msg.className = 'komunikat';
  try {
    const p = await wywolaj('ping', {}, 30000);
    msg.textContent = `Połączono z arkuszem „${p.arkusz}”. Pobieram dane…`;
    msg.className = 'komunikat ok';
    await sync.synchronizuj({ pelna: true });
    await wczytajDane();
    const s = sync.stanSynchronizacji();
    if (s.tryb === 'blad' && !s.plikiOczekujace && !s.oczekujace) {
      render(esc('Połączenie działa, ale synchronizacja się nie udała: ' + s.blad));
    } else {
      toast(`Gotowe. Pobrano ${konta().length} kont i ${dane.transakcje.length} transakcji.`, 'ok');
      location.hash = '#dodaj';
    }
  } catch (e) {
    msg.textContent = e.message;
    msg.className = 'komunikat blad';
  }
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const akcja = b.dataset.akcja;
  if (akcja === 'pokaz-token') {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.textContent = i.type === 'password' ? 'Pokaż' : 'Ukryj';
  } else if (akcja === 'synchronizuj' || akcja === 'pelna') {
    b.disabled = true;
    await sync.synchronizuj({ pelna: akcja === 'pelna' });
    await wczytajDane();
    render();
  } else if (akcja === 'wyczysc') {
    const s = sync.stanSynchronizacji();
    const tak = await okno('Usunąć dane z tego urządzenia?',
      s.oczekujace
        ? `<p class="blad"><b>${s.oczekujace} zmian lub plików nie zostało jeszcze wysłanych i przepadną.</b> Najpierw połącz się z internetem i zsynchronizuj.</p>`
        : `<p>Arkusz zostaje bez zmian. Z urządzenia znikną kopie danych, adres API i token.</p>`,
      [{ etykieta: 'Zostaw dane', wartosc: false, klasa: 'drugorzedny', autofocus: true },
       { etykieta: s.oczekujace ? 'Usuń mimo to' : 'Usuń dane', wartosc: true, klasa: 'niebezpieczny' }]);
    if (!tak) return;
    await db.wyczyscWszystko();
    localStorage.clear();
    location.hash = '#ustawienia';
    location.reload();
  }
}

export const ekran = { render: () => render(), klik, submit: form => { if (form.dataset.forma === 'polaczenie') zapiszPolaczenie(form); } };
