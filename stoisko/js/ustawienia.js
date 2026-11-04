// Ekran „Ustawienia”: połączenie z arkuszem, kod urządzenia (początek numerów zamówień),
// wydarzenie i magazyn, dane do płatności w wiadomości, synchronizacja.

import * as db from './db.js';
import * as sync from './sync.js';
import { ustawienia, zapiszUstawienia, polaczone, gotowe, wywolaj, wersjaApi, adresZFinansow } from './api.js';
import { $, esc, toast, okno } from './util.js';
import { dane, wczytaj, nastepnyNumer, kodUzywanyPrzez } from './dane.js';
import { WERSJA, WYMAGANE_API, PODMIOTY, PLATNOSC_DOMYSLNA } from './konfiguracja.js';

function render(komunikat = '', klasa = '') {
  const u = ustawienia();
  const s = sync.stanSynchronizacji();
  const pierwszy = !gotowe();
  const api = wersjaApi();
  const url = u.url || adresZFinansow();
  $('#widok').innerHTML = `
  <section class="ekran ustawienia">
    ${pierwszy ? `<div class="powitanie"><h1>Przygotuj stoisko</h1>
      <p>Połącz aplikację z arkuszem „One River – Finanse” i nadaj temu urządzeniu kod. Ustawienia zapiszą się tylko tutaj.</p></div>` : '<h1>Ustawienia</h1>'}
    ${api && api < WYMAGANE_API ? `<p class="pasek-info blad">Skrypt arkusza ma wersję ${api}, a stoisko potrzebuje ${WYMAGANE_API}.</p>` : ''}

    <form class="panel" data-forma="ustawienia" novalidate>
      <h2>Połączenie z arkuszem</h2>
      <label class="pole"><span class="etykieta">Adres API (kończy się na /exec)</span>
        <input name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(url)}" placeholder="https://script.google.com/macros/s/…/exec">
        ${!u.url && url ? '<span class="podpowiedz">Adres wzięty z aplikacji Finanse na tym urządzeniu.</span>' : ''}</label>
      <label class="pole"><span class="etykieta">Token</span>
        <span class="z-przyciskiem"><input name="token" type="password" autocomplete="off" spellcheck="false" value="${esc(u.token)}">
        <button type="button" class="drugorzedny" data-akcja="pokaz-token">Pokaż</button></span></label>

      <h2>To urządzenie</h2>
      <label class="pole"><span class="etykieta">Nazwa urządzenia</span>
        <input name="kto" autocomplete="off" value="${esc(u.kto)}" placeholder="np. Tablet kiermasz">
        <span class="podpowiedz">Trafia do kolumny „kto” i do dziennika zmian.</span></label>
      <label class="pole"><span class="etykieta">Kod urządzenia (początek numerów zamówień)</span>
        <input name="kod" autocomplete="off" autocapitalize="characters" maxlength="4" value="${esc(u.kod)}" placeholder="np. K1">
        <span class="podpowiedz">1–4 litery lub cyfry. Każde urządzenie musi mieć inny kod – wtedy numery nigdy się nie powtórzą, nawet bez internetu.${u.kod ? ` Następny numer: <b>${esc(nastepnyNumer())}</b>.` : ''}</span></label>

      <h2>Sprzedaż</h2>
      <label class="pole"><span class="etykieta">Podmiot</span>
        <select name="podmiot">${PODMIOTY.map(p => `<option ${u.podmiot === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label class="pole"><span class="etykieta">Magazyn</span>
        <input name="magazyn" list="magazyny" autocomplete="off" value="${esc(u.magazyn)}" placeholder="np. INC Główny">
        <datalist id="magazyny">${dane.magazyny.map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
      <label class="pole"><span class="etykieta">Wydarzenie</span>
        <input name="wydarzenie" autocomplete="off" value="${esc(u.wydarzenie)}" placeholder="np. Kiermasz Koneser, grudzień 2026">
        <span class="podpowiedz">Zapisuje się przy każdym zamówieniu – zmień przed kolejnym wydarzeniem.</span></label>

      <h2>Dane do płatności w wiadomości</h2>
      <label class="pole"><span class="etykieta">Odbiorca przelewu</span>
        <input name="odbiorca" autocomplete="off" value="${esc(u.platnosc.odbiorca)}"></label>
      <label class="pole"><span class="etykieta">Numer konta</span>
        <input name="konto" inputmode="numeric" autocomplete="off" value="${esc(u.platnosc.konto)}"></label>
      <label class="pole"><span class="etykieta">Telefon do BLIK</span>
        <input name="blik" inputmode="tel" autocomplete="off" value="${esc(u.platnosc.blik)}"></label>

      <div class="przyciski"><button type="submit">Zapisz</button>
        ${!pierwszy ? '<a class="przycisk drugorzedny" href="#nowe">Wróć</a>' : ''}</div>
      <p class="komunikat ${klasa}" aria-live="polite">${komunikat}</p>
    </form>

    ${polaczone() ? `<div class="panel">
      <h2>Synchronizacja</h2>
      <dl class="info">
        <div><dt>Ostatnia</dt><dd>${s.ostatnia ? esc(new Date(s.ostatnia).toLocaleString('pl-PL')) : 'jeszcze nie było'}</dd></div>
        <div><dt>Zmiany do wysłania</dt><dd>${s.oczekujace || 0}</dd></div>
        <div><dt>Produkty w cenniku</dt><dd>${dane.cennik.length}</dd></div>
        <div><dt>Zamówienia na urządzeniu</dt><dd>${dane.zamowienia.length}</dd></div>
        <div><dt>Wersja skryptu arkusza</dt><dd>${api || 'nieznana'}</dd></div>
        ${s.blad ? `<div><dt>Ostatni błąd</dt><dd class="blad">${esc(s.blad)}</dd></div>` : ''}
      </dl>
      <div class="przyciski">
        <button type="button" data-akcja="synchronizuj">Synchronizuj teraz</button>
        <button type="button" class="drugorzedny" data-akcja="pelna">Pobierz wszystko od nowa</button>
      </div>
    </div>
    <div class="panel">
      <h2>Aplikacja</h2>
      <p>One River Stoisko ${WERSJA}. Zamówienia zapisują się bez internetu i wysyłają same, gdy wróci połączenie.</p>
      <div class="przyciski"><button type="button" class="niebezpieczny" data-akcja="wyczysc">Usuń dane z tego urządzenia</button></div>
    </div>` : ''}
  </section>`;
}

async function zapisz(form) {
  const f = form.elements;
  const stare = ustawienia();
  const url = f.url.value.trim();
  const token = f.token.value.trim();
  const kod = f.kod.value.trim().toUpperCase();
  const kto = f.kto.value.trim();
  const blad = !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url) ? 'Adres musi zaczynać się od https://script.google.com/ i kończyć na /exec.'
    : !token ? 'Wpisz token.'
    : !kto ? 'Wpisz nazwę urządzenia.'
    : !/^[A-Z0-9]{1,4}$/.test(kod) ? 'Kod urządzenia: 1–4 litery lub cyfry, np. K1.'
    : '';
  if (blad) { render(esc(blad), 'blad'); return; }

  const platnosc = {
    odbiorca: f.odbiorca.value.trim() || PLATNOSC_DOMYSLNA.odbiorca,
    konto: f.konto.value.trim(),
    blik: f.blik.value.trim(),
  };
  zapiszUstawienia({ url, token, kto, kod, podmiot: f.podmiot.value, magazyn: f.magazyn.value.trim(), wydarzenie: f.wydarzenie.value.trim(), platnosc });

  const nowePolaczenie = url !== stare.url || token !== stare.token;
  if (nowePolaczenie) {
    render('Sprawdzam połączenie…');
    try {
      const p = await wywolaj('ping', {}, 30000);
      render(`Połączono z arkuszem „${esc(p.arkusz)}”. Pobieram cennik i zamówienia…`, 'ok');
      await sync.synchronizuj({ pelna: true });
      await wczytaj();
    } catch (e) {
      render(esc(e.message), 'blad');
      return;
    }
  }
  const inne = kodUzywanyPrzez(kod, kto);
  if (inne.length) {
    await okno(`Kod ${kod} ma już inne urządzenie`,
      `<p>Zamówienia z kodem <b>${esc(kod)}</b> wystawiało: ${esc(inne.join(', '))}. Jeśli to inne urządzenie, nadaj temu inny kod (np. ${esc(kod.replace(/\d+$/, n => String(Number(n) + 1)) || kod + '2')}), żeby numery się nie powtarzały.</p>`,
      [{ etykieta: 'Rozumiem', wartosc: true, autofocus: true }]);
  }
  toast(`Zapisano. Następny numer: ${nastepnyNumer()}.`, 'ok');
  location.hash = '#nowe';
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
    await wczytaj();
    const s = sync.stanSynchronizacji();
    render(s.blad ? esc(s.blad) : 'Zsynchronizowano.', s.blad ? 'blad' : 'ok');
  } else if (akcja === 'wyczysc') {
    const s = sync.stanSynchronizacji();
    const tak = await okno('Usunąć dane z tego urządzenia?',
      s.oczekujace
        ? `<p class="blad"><b>${s.oczekujace} zmian nie zostało jeszcze wysłanych i przepadną.</b> Najpierw połącz się z internetem.</p>`
        : '<p>Arkusz zostaje bez zmian. Z urządzenia znikną kopie danych i ustawienia stoiska.</p>',
      [{ etykieta: 'Zostaw dane', wartosc: false, klasa: 'drugorzedny', autofocus: true },
       { etykieta: s.oczekujace ? 'Usuń mimo to' : 'Usuń dane', wartosc: true, klasa: 'niebezpieczny' }]);
    if (!tak) return;
    await db.wyczyscWszystko();
    Object.keys(localStorage).filter(k => k.startsWith('or-stoisko')).forEach(k => localStorage.removeItem(k));
    location.hash = '#ustawienia';
    location.reload();
  }
}

export const ekran = { render, klik, submit: form => { if (form.dataset.forma === 'ustawienia') zapisz(form); } };
