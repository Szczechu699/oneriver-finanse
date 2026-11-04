// Drobne narzędzia wspólne dla ekranów stoiska.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const zaokr = n => Math.round(n * 100) / 100;
export const fmt2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const kwotaTxt = n => fmt2.format(n) + ' zł';
export const iloscTxt = n => fmt2.format(n).replace(/,00$/, '');
export const num = v => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

export function dataLok(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function dodajDni(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dataLok(d);
}
export const dataKrotko = iso => (iso ? new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const godzina = iso => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

/** Kwota wpisana przez człowieka: „1 234,5”, „12.50”. Pusty tekst → NaN. */
export function liczba(s) {
  const t = String(s ?? '').replace(/[\s  ]|zł/gi, '').replace(',', '.');
  if (t === '') return NaN;
  return Number(t);
}
export const liczbaNaTekst = n => (n === '' || n == null || !isFinite(n) ? '' : String(zaokr(Number(n))).replace('.', ','));

/** Bez polskich znaków i wielkości liter – do wyszukiwania. */
export const normalizuj = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

export function odmiana(n, jedna, kilka, wiele) {
  const d = n % 10, s = n % 100;
  if (n === 1) return jedna;
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return kilka;
  return wiele;
}

export function toast(tekst, rodzaj = '', czas = 3500) {
  const t = $('#toast');
  t.textContent = tekst;
  t.className = 'widoczny ' + rodzaj;
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

export function bezSkoku(fn) {
  const y = window.scrollY;
  fn();
  window.scrollTo(0, y);
}
