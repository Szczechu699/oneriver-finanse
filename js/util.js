// Drobne narzędzia wspólne dla wszystkich ekranów.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const zaokr = n => Math.round(n * 100) / 100;
export const fmt2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt4 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const symbol = w => (w === 'PLN' || !w ? 'zł' : w);
export const kwotaTxt = (n, w = 'PLN') => fmt2.format(n) + ' ' + symbol(w);

export function dataLok(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function dodajDni(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dataLok(d);
}
export const roznicaDni = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);

/** Przesuwa datę o n jednostek; dla miesięcy i lat trzyma się dnia z kotwicy (np. 31 → ostatni dzień krótszego miesiąca). */
export function przesunDate(iso, jednostka, n = 1, kotwica = iso) {
  const d = new Date(iso + 'T12:00:00');
  if (jednostka === 'dzień') d.setDate(d.getDate() + n);
  else if (jednostka === 'tydzień') d.setDate(d.getDate() + 7 * n);
  else {
    const dzien = Number(String(kotwica).slice(8, 10)) || d.getDate();
    const mies = d.getMonth() + (jednostka === 'rok' ? 12 * n : n);
    const nowa = new Date(d.getFullYear(), mies, 1, 12);
    const ostatni = new Date(nowa.getFullYear(), nowa.getMonth() + 1, 0).getDate();
    nowa.setDate(Math.min(dzien, ostatni));
    return dataLok(nowa);
  }
  return dataLok(d);
}

export function dataSlownie(iso) {
  if (!iso) return '';
  const dzis = dataLok();
  if (iso === dzis) return 'Dziś';
  if (iso === dodajDni(dzis, -1)) return 'Wczoraj';
  if (iso === dodajDni(dzis, 1)) return 'Jutro';
  const opcje = { weekday: 'long', day: 'numeric', month: 'long' };
  if (iso.slice(0, 4) !== dzis.slice(0, 4)) opcje.year = 'numeric';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', opcje);
}
export const dataKrotko = iso => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : '');
export const godzina = iso => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
export function nazwaMiesiaca(ym) {
  const t = new Date(ym + '-15T12:00:00').toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

/** Kwota wpisana przez człowieka: „1 234,5”, „12.50”, „12,5+7”. */
export const liczba = s => String(s ?? '').replace(/\s| | /g, '').split('+')
  .reduce((a, c) => a + (parseFloat(c.replace(',', '.')) || 0), 0);
export const liczbaNaTekst = n => (n === '' || n == null ? '' : String(zaokr(Number(n))).replace('.', ','));

export function odmiana(n, jedna, kilka, wiele) {
  const d = n % 10, s = n % 100;
  if (n === 1) return jedna;
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return kilka;
  return wiele;
}

export function toast(tekst, rodzaj = '', czas = 3500, akcja = null) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(tekst)}</span>${akcja ? `<button type="button">${esc(akcja.etykieta)}</button>` : ''}`;
  t.className = 'widoczny ' + rodzaj;
  if (akcja) t.querySelector('button').onclick = () => { t.className = ''; akcja.fn(); };
  clearTimeout(toast.zegar);
  toast.zegar = setTimeout(() => { t.className = ''; }, czas);
}

export function okno(tytul, trescHtml, przyciski) {
  const d = $('#okno');
  d.innerHTML = `<form method="dialog" class="okno">
      <h2>${esc(tytul)}</h2>
      <div class="okno-tresc">${trescHtml}</div>
      <div class="okno-przyciski">${przyciski.map((p, i) =>
        `<button value="${i}" class="${p.klasa || ''}" ${p.autofocus ? 'autofocus' : ''}>${esc(p.etykieta)}</button>`).join('')}</div>
    </form>`;
  return new Promise(ok => {
    d.onclose = () => ok(przyciski[Number(d.returnValue)]?.wartosc ?? null);
    d.returnValue = '';
    d.showModal();
  });
}

/** Zachowuje przewinięcie przy ponownym rysowaniu ekranu. */
export function bezSkoku(fn) {
  const y = window.scrollY;
  fn();
  window.scrollTo(0, y);
}
