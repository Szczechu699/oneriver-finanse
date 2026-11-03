// Ekran „Budżety i cele”: budżety projektów, limity na kategorie, cele oszczędnościowe; formularz budżetu.

import * as sync from './sync.js';
import { $, esc, zaokr, kwotaTxt, dataLok, dataSlownie, dataKrotko, nazwaMiesiaca, uuid, liczba, liczbaNaTekst, odmiana, toast, bezSkoku } from './util.js';
import { dane, wczytajDane, glowne, podmioty, KOLORY, aktywneBudzety, kategorieBudzetu, stanBudzetu, stanCelu } from './dane.js';
import { ustawFiltrBudzetu } from './lista.js';

export function renderBudzety() {
  const lst = aktywneBudzety();
  const projekty = lst.filter(b => b.rodzaj === 'projekt');
  const limity = lst.filter(b => b.rodzaj === 'limit' || !b.rodzaj);
  const cele = lst.filter(b => b.rodzaj === 'cel');
  const zakonczone = dane.budzety.filter(b => b.status === 'zakończony');
  $('#widok').innerHTML = `
  <section class="ekran budzety">
    <div class="naglowek-sekcji">
      <h1>Budżety i cele</h1>
      <div class="przyciski">
        <a class="przycisk drugorzedny" href="#budzet/nowy-cel">Nowy cel</a>
        <a class="przycisk" href="#budzet/nowy">Nowy budżet</a>
      </div>
    </div>
    ${lst.length ? '' : `<div class="pusto-duze">
      <p>Budżet projektu zbiera wydatki wyprawy albo kiermaszu, które przypiszesz przy wpisie. Limit pilnuje miesięcznej kwoty na wybrane kategorie. Cel pokazuje, ile już odłożono, np. na sprzęt albo rezerwę na wyprawę.</p>
      <a class="przycisk" href="#budzet/nowy">Utwórz pierwszy budżet</a></div>`}
    ${projekty.length ? `<h2 class="tytul-grupy">Projekty</h2><div class="karty-budzetow">${projekty.map(kartaBudzetu).join('')}</div>` : ''}
    ${limity.length ? `<h2 class="tytul-grupy">Limity na kategorie</h2><div class="karty-budzetow">${limity.map(kartaBudzetu).join('')}</div>` : ''}
    ${cele.length ? `<h2 class="tytul-grupy">Cele</h2><div class="karty-budzetow">${cele.map(kartaCelu).join('')}</div>` : ''}
    ${zakonczone.length ? `<details class="wiecej"><summary>Zakończone (${zakonczone.length})</summary>
      <div class="karty-budzetow">${zakonczone.map(b => (b.rodzaj === 'cel' ? kartaCelu(b) : kartaBudzetu(b))).join('')}</div></details>` : ''}
  </section>`;
}

function kartaBudzetu(b) {
  const s = stanBudzetu(b);
  const przekroczony = s.zostalo < 0;
  const okres = b.rodzaj === 'projekt'
    ? (b.data_od || b.data_do ? `${b.data_od ? dataKrotko(b.data_od) : '…'} – ${b.data_do ? dataKrotko(b.data_do) : '…'}` : 'bez dat')
    : ({ 'tydzień': 'w tym tygodniu', 'rok': 'w tym roku' }[b.okres] || nazwaMiesiaca(s.od.slice(0, 7)).toLowerCase());
  const kat = kategorieBudzetu(b);
  return `<article class="karta-budzetu ${przekroczony ? 'przekroczony' : ''}" style="--kolor:${esc(b.kolor || KOLORY[0])}">
    <a class="naglowek-karty" href="#budzet/${encodeURIComponent(b.id)}">
      <h3>${esc(b.nazwa)}</h3>
      <span>${esc(okres)}${b.rodzaj !== 'projekt' && kat.length ? `, ${esc(kat.join(', '))}` : ''}${b.podmiot ? `, ${esc(b.podmiot)}` : ''}</span>
    </a>
    <div class="pasek" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(1, s.procent) * 100)}"
      aria-label="Wykorzystanie budżetu"><span style="width:${Math.min(100, s.procent * 100).toFixed(1)}%"></span></div>
    <p class="liczby"><b>${esc(kwotaTxt(s.wydane))}</b> z ${esc(kwotaTxt(s.kwota))}</p>
    <p class="zostalo">${przekroczony ? `Przekroczony o ${esc(kwotaTxt(-s.zostalo))}` : `Zostało ${esc(kwotaTxt(s.zostalo))}`}${s.naDzien ? `, około ${esc(kwotaTxt(s.naDzien))} dziennie do końca` : ''}.</p>
    ${s.wplywy ? `<p class="dodatkowe">Wpływy w tym budżecie: ${esc(kwotaTxt(s.wplywy))}.</p>` : ''}
    ${s.bezKursu ? `<p class="dodatkowe">Bez kursu NBP, niewliczone: ${s.bezKursu}.</p>` : ''}
    <button type="button" class="link" data-akcja="pokaz-transakcje" data-v="${esc(b.id)}">Pokaż transakcje (${s.liczba})</button>
  </article>`;
}

function kartaCelu(c) {
  const s = stanCelu(c);
  const osiagniety = s.zebrano >= s.kwota && s.kwota > 0;
  return `<article class="karta-budzetu cel ${osiagniety ? 'osiagniety' : ''}" style="--kolor:${esc(c.kolor || KOLORY[4])}">
    <a class="naglowek-karty" href="#budzet/${encodeURIComponent(c.id)}">
      <h3>${esc(c.nazwa)}</h3>
      <span>${c.data_do ? `do ${esc(dataSlownie(c.data_do).toLowerCase())}` : 'bez terminu'}${s.dni !== null ? `, ${s.dni} ${odmiana(s.dni, 'dzień', 'dni', 'dni')}` : ''}</span>
    </a>
    <div class="pasek" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(1, s.procent) * 100)}"
      aria-label="Postęp celu"><span style="width:${Math.min(100, s.procent * 100).toFixed(1)}%"></span></div>
    <p class="liczby"><b>${esc(kwotaTxt(s.zebrano))}</b> z ${esc(kwotaTxt(s.kwota))} <span class="procent-celu">${Math.round(s.procent * 100)}%</span></p>
    <p class="zostalo">${osiagniety ? 'Cel osiągnięty.' : `Brakuje ${esc(kwotaTxt(s.brakuje))}${s.miesiecznie ? `, około ${esc(kwotaTxt(s.miesiecznie))} miesięcznie` : ''}.`}</p>
    <button type="button" class="link" data-akcja="pokaz-transakcje" data-v="${esc(c.id)}">Pokaż transakcje (${s.liczba})</button>
  </article>`;
}

// ── formularz ──

let bf = null;

function nowyBudzet(rodzaj = 'projekt') {
  return { id: null, nazwa: '', rodzaj, kwota: '', waluta: 'PLN', okres: 'miesiąc', data_od: rodzaj === 'cel' ? '' : dataLok(), data_do: '',
    kategorie: [], konta: '', podmiot: '', kolor: rodzaj === 'cel' ? KOLORY[4] : KOLORY[0], status: 'aktywny', opis: '', oryginal: null };
}

export function renderFormularz(id) {
  const klucz = id === 'nowy' || id === 'nowy-cel' ? null : id;
  if (!bf || bf.id !== klucz || (!klucz && (id === 'nowy-cel') !== (bf.rodzaj === 'cel') && !bf.dotkniety)) {
    if (!klucz) bf = nowyBudzet(id === 'nowy-cel' ? 'cel' : 'projekt');
    else {
      const b = dane.budzety.find(x => x.id === id);
      if (!b) { location.hash = '#budzety'; return; }
      bf = { ...nowyBudzet(), ...b, rodzaj: b.rodzaj || 'limit', kategorie: kategorieBudzetu(b), kwota: liczbaNaTekst(b.kwota), oryginal: b };
    }
  }
  const r = bf.rodzaj;
  $('#widok').innerHTML = `
  <section class="ekran formularz-budzetu">
    <a class="wstecz" href="#budzety">Budżety i cele</a>
    <h1>${bf.id ? (r === 'cel' ? 'Edycja celu' : 'Edycja budżetu') : (r === 'cel' ? 'Nowy cel' : 'Nowy budżet')}</h1>
    <form class="karta-ustawien" data-forma="budzet" novalidate>
      <fieldset class="pole"><legend>Rodzaj</legend>
        <div class="chipy">${[['projekt', 'Budżet projektu'], ['limit', 'Limit na kategorie'], ['cel', 'Cel']].map(([k, e]) =>
          `<button type="button" class="chip" data-akcja="b-rodzaj" data-v="${k}" aria-pressed="${r === k}" ${bf.id ? 'disabled' : ''}>${e}</button>`).join('')}</div>
        <span class="podpowiedz">${{
          projekt: 'Liczą się transakcje, którym przy wpisie wskażesz ten budżet, np. wyprawa albo kiermasz.',
          limit: 'Aplikacja sama sumuje wydatki z wybranych kategorii w każdym okresie.',
          cel: 'Przypisuj do celu wpływy albo przeksięgowania na konto oszczędnościowe. Wydatki z celu zmniejszają postęp.',
        }[r]}</span>
      </fieldset>
      <div class="rzad">
        <label class="pole"><span class="etykieta">Nazwa</span>
          <input name="nazwa" value="${esc(bf.nazwa)}" placeholder="${{ projekt: 'np. Wyprawa luty 2027', limit: 'np. Wysyłki', cel: 'np. Rezerwa na wyprawę' }[r]}" autocomplete="off" required></label>
        <label class="pole"><span class="etykieta">${r === 'cel' ? 'Kwota docelowa (zł)' : 'Kwota (zł)'}</span>
          <input name="kwota" inputmode="decimal" value="${esc(bf.kwota)}" placeholder="np. 15 000" autocomplete="off" required></label>
      </div>
      ${r === 'projekt' ? `<div class="rzad">
        <label class="pole"><span class="etykieta">Od</span><input type="date" name="data_od" value="${esc(bf.data_od)}"></label>
        <label class="pole"><span class="etykieta">Do</span><input type="date" name="data_do" value="${esc(bf.data_do)}" min="${esc(bf.data_od)}"></label>
      </div>` : ''}
      ${r === 'cel' ? `<label class="pole"><span class="etykieta">Termin (opcjonalnie)</span><input type="date" name="data_do" value="${esc(bf.data_do)}"></label>` : ''}
      ${r === 'limit' ? `
      <fieldset class="pole"><legend>Okres</legend>
        <div class="chipy">${[['miesiąc', 'Co miesiąc'], ['tydzień', 'Co tydzień'], ['rok', 'Co rok']].map(([o, e]) =>
          `<button type="button" class="chip" data-akcja="b-okres" data-v="${o}" aria-pressed="${bf.okres === o}">${e}</button>`).join('')}</div>
      </fieldset>
      <fieldset class="pole"><legend>Kategorie</legend>
        <div class="chipy">${glowne('wydatek').map(k =>
          `<button type="button" class="chip" data-akcja="b-kategoria" data-v="${esc(k.nazwa)}" aria-pressed="${bf.kategorie.includes(k.nazwa)}">${esc(k.nazwa)}</button>`).join('')}</div>
      </fieldset>` : ''}
      ${r !== 'cel' ? `<fieldset class="pole"><legend>Dotyczy</legend>
        <div class="chipy">${['', ...podmioty().filter(p => p !== 'wspólne')].map(p =>
          `<button type="button" class="chip" data-akcja="b-podmiot" data-v="${esc(p)}" aria-pressed="${bf.podmiot === p}">${esc(p || 'Całej firmy')}</button>`).join('')}</div>
      </fieldset>` : ''}
      <fieldset class="pole"><legend>Kolor</legend>
        <div class="kolory">${KOLORY.map(k =>
          `<button type="button" data-akcja="b-kolor" data-v="${k}" aria-pressed="${bf.kolor === k}" style="--k:${k}" aria-label="Kolor ${k}"></button>`).join('')}</div>
      </fieldset>
      <label class="pole"><span class="etykieta">Opis</span><textarea name="opis" rows="2">${esc(bf.opis)}</textarea></label>
      <div class="przyciski">
        <button type="submit">${bf.id ? 'Zapisz zmiany' : (r === 'cel' ? 'Utwórz cel' : 'Utwórz budżet')}</button>
        ${bf.id && bf.status === 'aktywny' ? `<button type="button" class="drugorzedny" data-akcja="b-zakoncz">Zakończ</button>` : ''}
        ${bf.id && bf.status === 'zakończony' ? `<button type="button" class="drugorzedny" data-akcja="b-wznow">Przywróć</button>` : ''}
        <a class="drugorzedny przycisk" href="#budzety">Wróć</a>
      </div>
    </form>
  </section>`;
}

function zbierz() {
  const form = $('form[data-forma="budzet"]');
  if (!form) return;
  ['nazwa', 'kwota', 'data_od', 'data_do', 'opis'].forEach(n => { if (form.elements[n]) bf[n] = form.elements[n].value; });
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const { akcja, v } = b.dataset;
  if (akcja === 'pokaz-transakcje') {
    ustawFiltrBudzetu(v);
    location.hash = '#lista';
    return;
  }
  if (!$('.formularz-budzetu') || !bf) return;
  zbierz();
  bf.dotkniety = true;
  if (akcja === 'b-rodzaj') bf.rodzaj = v;
  else if (akcja === 'b-okres') bf.okres = v;
  else if (akcja === 'b-kategoria') bf.kategorie = bf.kategorie.includes(v) ? bf.kategorie.filter(k => k !== v) : [...bf.kategorie, v];
  else if (akcja === 'b-podmiot') bf.podmiot = v;
  else if (akcja === 'b-kolor') bf.kolor = v;
  else if (akcja === 'b-zakoncz' || akcja === 'b-wznow') {
    await sync.zapisz('BUDZETY', [{ ...bf.oryginal, status: akcja === 'b-zakoncz' ? 'zakończony' : 'aktywny' }]);
    await wczytajDane();
    toast(akcja === 'b-zakoncz' ? 'Zakończono.' : 'Przywrócono.', 'ok');
    bf = null;
    location.hash = '#budzety';
    return;
  } else return;
  bezSkoku(() => renderFormularz(bf.id || (bf.rodzaj === 'cel' ? 'nowy-cel' : 'nowy')));
}

async function zapisz() {
  zbierz();
  const kwota = zaokr(liczba(bf.kwota));
  const r = bf.rodzaj;
  if (!bf.nazwa.trim()) return toast('Wpisz nazwę.', 'blad');
  if (!(kwota > 0)) return toast('Wpisz kwotę.', 'blad');
  if (r === 'limit' && !bf.kategorie.length) return toast('Wybierz co najmniej jedną kategorię.', 'blad');
  if (r === 'projekt' && bf.data_od && bf.data_do && bf.data_do < bf.data_od) return toast('Data końca jest wcześniejsza niż początek.', 'blad');
  const w = {
    ...(bf.oryginal || {}),
    id: bf.id || uuid(), nazwa: bf.nazwa.trim(), rodzaj: r, kwota, waluta: 'PLN',
    okres: r === 'limit' ? bf.okres : '',
    data_od: r === 'projekt' ? bf.data_od : '', data_do: r === 'limit' ? '' : bf.data_do,
    kategorie: r === 'limit' ? bf.kategorie.join(', ') : '', konta: '', podmiot: r === 'cel' ? '' : bf.podmiot,
    kolor: bf.kolor, status: bf.oryginal?.status || 'aktywny', opis: bf.opis.trim(),
  };
  await sync.zapisz('BUDZETY', [w]);
  await wczytajDane();
  toast(bf.id ? 'Zapisano.' : `Utworzono „${w.nazwa}”.`, 'ok');
  bf = null;
  location.hash = '#budzety';
}

export const ekranBudzety = { render: renderBudzety, klik };
export const ekranBudzet = { render: renderFormularz, klik, submit: form => { if (form.dataset.forma === 'budzet') zapisz(); } };
