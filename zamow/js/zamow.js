// Publiczny formularz zamówień ONE RIVER (na wzór sklepu oneriver.pl/sklep).
// Oferta i ceny przychodzą ze skryptu arkusza (akcja „sklep”); zamówienie wysyła akcja „zamow”.
// Ceny liczy skrypt – przeglądarka tylko je pokazuje. Klient z kodem widzi swoje ceny (grupa, rabat, ceny specjalne).

const API = 'https://script.google.com/macros/s/AKfycbwFcvYtbGMBPlJCT_QDzXfnFvnnEQQt1EqFrjnhEKgeg7lo22JuRwFxOK5-vZGcVwg9CQ/exec';
const NA_STRONE = 24;
const KOLEJNOSC = ['Rapé', 'Akcesoria do rapé', 'Zielarnia i olejki', 'Biżuteria', 'Odzież', 'Wystrój wnętrz i inne', 'Instrumenty etniczne'];
const PAMIEC = 'or-zamow';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const zl = n => fmt.format(n) + ' zł';
const zaokr = n => Math.round(n * 100) / 100;
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

// ───────────────────────── stan ─────────────────────────

const s = {
  oferta: null,          // { produkty, wysylki, klient?, ceny? }
  produkty: [],          // pogrupowane: { klucz, nazwa, kategoria, zdjecie, link, warianty: [{ s, w, c, cena }] }
  kategoria: '', szukaj: '', ile: NA_STRONE,
  koszyk: [],            // [{ s, ilosc }]
  kod: '', widok: 'oferta', wyslane: null,
  dane: { nazwa: '', telefon: '', email: '', adres: '', uwagi: '', dostawa: '', forma: 'Przelew' },
};

function wczytajPamiec() {
  try {
    const p = JSON.parse(localStorage.getItem(PAMIEC)) || {};
    s.koszyk = Array.isArray(p.koszyk) ? p.koszyk : [];
    s.kod = p.kod || '';
    s.dane = { ...s.dane, ...(p.dane || {}) };
  } catch { /* pusto */ }
}
function zachowaj() {
  try { localStorage.setItem(PAMIEC, JSON.stringify({ koszyk: s.koszyk, kod: s.kod, dane: s.dane })); } catch { /* bez znaczenia */ }
}

// ───────────────────────── API ─────────────────────────

async function api(akcja, dane = {}) {
  let odp;
  try {
    odp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...dane, akcja }) });
  } catch {
    throw new Error('Brak połączenia z internetem. Spróbuj ponownie za chwilę.');
  }
  let j;
  try { j = await odp.json(); } catch { throw new Error('Serwer zamówień nie odpowiada. Spróbuj ponownie za chwilę.'); }
  if (!j.ok) throw new Error(j.blad || 'Coś poszło nie tak.');
  return j.dane;
}

async function wczytajOferte() {
  const o = await api('sklep', s.kod ? { kod: s.kod } : {});
  if (s.kod && !o.klient) {
    toast(o.blad_kodu || 'Nie znamy takiego kodu.', 'blad', 6000);
    s.kod = '';
    zachowaj();
  }
  s.oferta = o;
  const ceny = o.ceny || {};
  const mapa = new Map();
  o.produkty.forEach(p => {
    const klucz = p.w ? `${p.k}|${p.p}` : `${p.k}|${p.p}|${p.s}`;
    const g = mapa.get(klucz) || { klucz, nazwa: p.p, kategoria: p.k, zdjecie: '', link: '', warianty: [] };
    g.warianty.push({ s: p.s, w: p.w, c: p.c, cena: ceny[p.s] !== undefined ? ceny[p.s] : p.c, nazwa: p.n });
    if (!g.zdjecie && p.z) { g.zdjecie = p.z; g.link = p.l; }
    mapa.set(klucz, g);
  });
  const waga = w => { const n = parseFloat(String(w).replace(',', '.')); if (isFinite(n)) return n; const r = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'].indexOf(w); return r >= 0 ? 1000 + r : 2000; };
  s.produkty = [...mapa.values()].map(g => {
    g.warianty.sort((a, b) => waga(a.w) - waga(b.w));
    g.szukaj = norm(g.nazwa + ' ' + g.kategoria + ' ' + g.warianty.map(w => w.nazwa).join(' '));
    return g;
  }).sort((a, b) => (KOLEJNOSC.indexOf(a.kategoria) + 1 || 99) - (KOLEJNOSC.indexOf(b.kategoria) + 1 || 99) || (b.zdjecie ? 1 : 0) - (a.zdjecie ? 1 : 0) || a.nazwa.localeCompare(b.nazwa, 'pl'));
  // z koszyka znikają produkty, których nie ma już w ofercie
  const symbole = new Set(o.produkty.map(p => p.s));
  const przed = s.koszyk.length;
  s.koszyk = s.koszyk.filter(k => symbole.has(k.s));
  if (s.koszyk.length < przed) toast('Część produktów z koszyka nie jest już dostępna.', '', 5000);
  zachowaj();
}

const wariant = sym => {
  for (const g of s.produkty) { const w = g.warianty.find(x => x.s === sym); if (w) return { g, w }; }
  return null;
};
const pozycje = () => s.koszyk.map(k => ({ ...k, ...wariant(k.s) })).filter(p => p.w);
const sumaProduktow = () => zaokr(pozycje().reduce((a, p) => a + p.w.cena * p.ilosc, 0));
const dostawa = () => s.oferta?.wysylki.find(w => w.id === s.dane.dostawa);
const kosztDostawy = () => { const d = dostawa(); if (!d) return 0; return d.darmowa_od !== null && sumaProduktow() >= d.darmowa_od ? 0 : d.cena; };

// ───────────────────────── widoki ─────────────────────────

function kategorie() {
  const kat = new Set(s.produkty.map(p => p.kategoria));
  return [...KOLEJNOSC.filter(k => kat.has(k)), ...[...kat].filter(k => !KOLEJNOSC.includes(k))];
}

function htmlKarty(g) {
  const ceny = g.warianty.map(w => w.cena);
  const min = Math.min(...ceny), max = Math.max(...ceny);
  const minKat = Math.min(...g.warianty.map(w => w.c));
  const jedna = g.warianty.length === 1;
  const wKoszyku = g.warianty.reduce((a, w) => a + (s.koszyk.find(k => k.s === w.s)?.ilosc || 0), 0);
  const inicjaly = g.nazwa.replace(/^rap[eé]\s+/i, '').split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
  return `<li class="karta" data-klucz="${esc(g.klucz)}">
    <div class="zdjecie">${g.zdjecie ? `<img src="${esc(g.zdjecie)}" alt="" loading="lazy">` : `<span class="zastepcze" aria-hidden="true">${esc(inicjaly)}</span>`}
      ${wKoszyku ? `<span class="w-koszyku">w koszyku: ${wKoszyku}</span>` : ''}</div>
    <div class="opis">
      <span class="kategoria">${esc(g.kategoria)}</span>
      <h3>${esc(g.nazwa)}</h3>
      <p class="cena">${min !== minKat ? `<s>${esc(zl(minKat))}</s> ` : ''}${jedna || min === max ? esc(zl(min)) : `${esc(zl(min))} – ${esc(zl(max))}`}</p>
      ${jedna ? '' : `<div class="opcje" role="group" aria-label="Wariant">${g.warianty.map((w, i) => `<button type="button" class="opcja" data-akcja="wariant" data-s="${esc(w.s)}" aria-pressed="${i === 0}">${esc(w.w || '—')}<small>${esc(zl(w.cena))}</small></button>`).join('')}</div>`}
      <button type="button" class="do-koszyka" data-akcja="dodaj" data-s="${esc(g.warianty[0].s)}">Dodaj do koszyka</button>
    </div>
  </li>`;
}

function htmlOferty() {
  const slowa = norm(s.szukaj).split(/\s+/).filter(Boolean);
  const lista = s.produkty.filter(g => (!s.kategoria || g.kategoria === s.kategoria) && slowa.every(x => g.szukaj.includes(x)));
  const kl = s.oferta.klient;
  return `
  ${kl ? `<p class="pasek-klienta">Witaj, <b>${esc(kl.nazwa || 'kliencie')}</b>! Widzisz swoje ceny${kl.rabat ? ` (rabat ${esc(String(kl.rabat).replace('.', ','))}%)` : ''}. <button type="button" class="link" data-akcja="wyloguj">To nie ja</button></p>` : ''}
  <section class="wstep">
    <h1>Zamów u nas</h1>
    <p>Wybierz produkty i sposób dostawy. Po złożeniu zamówienia potwierdzimy je SMS-em z danymi do płatności.</p>
  </section>
  <nav class="kategorie" aria-label="Kategorie">
    <button type="button" class="kat" data-akcja="kategoria" data-k="" aria-pressed="${!s.kategoria}">Wszystko</button>
    ${kategorie().map(k => `<button type="button" class="kat" data-akcja="kategoria" data-k="${esc(k)}" aria-pressed="${s.kategoria === k}">${esc(k)}<small>${s.produkty.filter(g => g.kategoria === k).length}</small></button>`).join('')}
  </nav>
  <label class="szukaj"><span class="sr">Szukaj</span><input type="search" id="szukaj" value="${esc(s.szukaj)}" placeholder="Szukaj produktu…" autocomplete="off" enterkeyhint="search"></label>
  <p class="licznik-wynikow">${lista.length} ${lista.length === 1 ? 'produkt' : (lista.length % 10 >= 2 && lista.length % 10 <= 4 && (lista.length % 100 < 12 || lista.length % 100 > 14) ? 'produkty' : 'produktów')}</p>
  <ul class="siatka">${lista.slice(0, s.ile).map(htmlKarty).join('')}</ul>
  ${lista.length > s.ile ? `<p class="wiecej"><button type="button" class="drugorzedny" data-akcja="wiecej">Pokaż więcej (${lista.length - s.ile})</button></p>` : ''}
  ${!lista.length ? '<p class="pusto">Nic nie znaleźliśmy. Spróbuj innej nazwy.</p>' : ''}`;
}

function htmlKoszyka() {
  const poz = pozycje();
  if (!poz.length) {
    return `<section class="zamowienie"><h1>Koszyk</h1><p class="pusto">Koszyk jest pusty.</p>
      <p><button type="button" data-akcja="do-oferty">Wróć do oferty</button></p></section>`;
  }
  const wys = s.oferta.wysylki;
  const d = dostawa();
  const prod = sumaProduktow();
  const koszt = kosztDostawy();
  return `<section class="zamowienie">
    <p><button type="button" class="link" data-akcja="do-oferty">← Wróć do oferty</button></p>
    <h1>Twoje zamówienie</h1>
    <div class="uklad">
      <div>
        <article class="panel">
          <h2>Produkty</h2>
          <ul class="pozycje">${poz.map(p => `<li data-s="${esc(p.s)}">
            ${p.g.zdjecie ? `<img src="${esc(p.g.zdjecie)}" alt="" loading="lazy">` : '<span class="mini-zastepcze" aria-hidden="true"></span>'}
            <span class="poz-nazwa">${esc(p.g.nazwa)}${p.w.w ? ` <small>${esc(p.w.w)}</small>` : ''}<small>${esc(zl(p.w.cena))} / szt.</small></span>
            <span class="stepper"><button type="button" data-akcja="minus" aria-label="Mniej">−</button><b>${p.ilosc}</b><button type="button" data-akcja="plus" aria-label="Więcej">+</button></span>
            <b class="wartosc">${esc(zl(zaokr(p.w.cena * p.ilosc)))}</b>
            <button type="button" class="usun" data-akcja="usun" aria-label="Usuń">×</button>
          </li>`).join('')}</ul>
        </article>

        <form class="panel" id="formularz" novalidate>
          <h2>Twoje dane</h2>
          <label class="pole"><span>Imię i nazwisko *</span><input name="nazwa" autocomplete="name" value="${esc(s.dane.nazwa)}" required></label>
          <label class="pole"><span>Telefon * <small>(potwierdzimy SMS-em)</small></span><input name="telefon" type="tel" inputmode="tel" autocomplete="tel" value="${esc(s.dane.telefon)}" required></label>
          <label class="pole"><span>E-mail</span><input name="email" type="email" inputmode="email" autocomplete="email" value="${esc(s.dane.email)}"></label>

          ${wys.length ? `<h2>Dostawa</h2>
          <div class="wybory">${wys.map(w => `<label class="wybor"><input type="radio" name="dostawa" value="${esc(w.id)}" ${s.dane.dostawa === w.id ? 'checked' : ''}>
            <span><b>${esc(w.nazwa)}</b>${w.opis ? `<small>${esc(w.opis)}</small>` : ''}</span>
            <span class="cena-dostawy">${w.darmowa_od !== null && prod >= w.darmowa_od ? 'gratis' : esc(zl(w.cena))}${w.darmowa_od !== null && prod < w.darmowa_od ? `<small>gratis od ${esc(zl(w.darmowa_od))}</small>` : ''}</span></label>`).join('')}</div>
          ${d?.adres ? `<label class="pole"><span>Adres dostawy lub numer paczkomatu *</span><textarea name="adres" rows="3" autocomplete="street-address">${esc(s.dane.adres)}</textarea></label>` : ''}` : ''}

          <h2>Płatność</h2>
          <div class="wybory">
            <label class="wybor"><input type="radio" name="forma" value="Przelew" ${s.dane.forma === 'Przelew' ? 'checked' : ''}><span><b>Przelew</b><small>Numer konta wyślemy SMS-em</small></span></label>
            <label class="wybor"><input type="radio" name="forma" value="BLIK" ${s.dane.forma === 'BLIK' ? 'checked' : ''}><span><b>BLIK na telefon</b><small>Numer wyślemy SMS-em</small></span></label>
          </div>
          <label class="pole"><span>Uwagi do zamówienia</span><textarea name="uwagi" rows="2">${esc(s.dane.uwagi)}</textarea></label>
          <label class="pulapka" aria-hidden="true">Strona www<input name="www" tabindex="-1" autocomplete="off"></label>
          <p class="drobne">Twoje dane wykorzystamy wyłącznie do realizacji tego zamówienia. Administrator: ONE RIVER sp. z o.o., Warszawa.</p>
        </form>
      </div>

      <aside class="panel podsumowanie">
        <h2>Podsumowanie</h2>
        <dl>
          <div><dt>Produkty</dt><dd>${esc(zl(prod))}</dd></div>
          <div><dt>Dostawa</dt><dd>${d ? (koszt ? esc(zl(koszt)) : 'gratis') : '—'}</dd></div>
          <div class="razem"><dt>Razem</dt><dd>${esc(zl(zaokr(prod + koszt)))}</dd></div>
        </dl>
        ${s.oferta.klient ? `<p class="drobne">Ceny dla: ${esc(s.oferta.klient.nazwa)}</p>` : '<p class="drobne">Masz kod klienta? <button type="button" class="link" data-akcja="kod">Wpisz go</button>, żeby zobaczyć swoje ceny.</p>'}
        <button type="button" class="glowny" data-akcja="wyslij">Zamawiam</button>
        <p class="drobne">Zamówienie potwierdzimy SMS-em z numerem i danymi do płatności.</p>
      </aside>
    </div>
  </section>`;
}

function htmlPodziekowania() {
  const w = s.wyslane;
  return `<section class="dziekujemy">
    <h1>Dziękujemy!</h1>
    <p>Twoje zamówienie ma numer</p>
    <p class="numer">${esc(w.numer)}</p>
    <p>Kwota: <b>${esc(zl(w.suma))}</b>${w.koszt_dostawy ? ` (w tym dostawa ${esc(zl(w.koszt_dostawy))})` : ''}.</p>
    <p>Wkrótce potwierdzimy je SMS-em z danymi do płatności.</p>
    <p><button type="button" data-akcja="do-oferty">Wróć do oferty</button></p>
  </section>`;
}

function render() {
  const n = s.koszyk.reduce((a, k) => a + k.ilosc, 0);
  $('#koszyk-ile').textContent = n;
  $('#koszyk-przycisk').classList.toggle('pelny', n > 0);
  $('#kod-przycisk').textContent = s.oferta?.klient ? (s.oferta.klient.nazwa || 'Twój kod') : 'Mam kod klienta';
  if (!s.oferta) return;
  $('#widok').innerHTML = s.widok === 'koszyk' ? htmlKoszyka() : s.widok === 'dziekujemy' ? htmlPodziekowania() : htmlOferty();
  // pasek koszyka na telefonie
  let pasek = $('.pasek-koszyka');
  if (!pasek) { pasek = document.createElement('button'); pasek.type = 'button'; pasek.className = 'pasek-koszyka'; pasek.dataset.akcja = 'koszyk'; document.body.append(pasek); }
  pasek.hidden = !(n > 0 && s.widok === 'oferta');
  pasek.innerHTML = `<span>Koszyk · ${n} szt.</span><b>${esc(zl(sumaProduktow()))}</b><span>Dalej →</span>`;
}

function odswiezSiatke() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

// ───────────────────────── zdarzenia ─────────────────────────

function toast(tekst, rodzaj = '', czas = 3000) {
  const t = $('#toast');
  t.textContent = tekst;
  t.className = 'widoczny ' + rodzaj;
  clearTimeout(toast.z);
  toast.z = setTimeout(() => { t.className = ''; }, czas);
}

async function oknoKodu() {
  const d = $('#okno');
  d.innerHTML = `<form method="dialog" class="okno">
    <h2>Kod klienta</h2>
    <p>Klienci hurtowi i stali dostali od nas kod – po jego wpisaniu zobaczysz swoje ceny.</p>
    <label class="pole"><span>Kod</span><input name="kod" autocomplete="off" autocapitalize="characters" value="${esc(s.kod)}" placeholder="np. ABCD-1234"></label>
    <div class="przyciski"><button value="" class="drugorzedny">Anuluj</button><button value="ok">Pokaż moje ceny</button></div>
  </form>`;
  d.showModal();
  const wynik = await new Promise(ok => { d.onclose = () => ok(d.returnValue); });
  if (wynik !== 'ok') return;
  const kod = $('[name=kod]', d).value.trim();
  if (!kod) return;
  s.kod = kod;
  await przeladuj();
  if (s.oferta.klient) toast(`Ceny dla: ${s.oferta.klient.nazwa}`, 'ok');
}

async function przeladuj() {
  $('#widok').setAttribute('aria-busy', 'true');
  try {
    await wczytajOferte();
    if (s.oferta.klient) {
      const k = s.oferta.klient;
      if (!s.dane.nazwa && k.nazwa) s.dane.nazwa = k.nazwa;
      if (!s.dane.telefon && k.telefon) s.dane.telefon = k.telefon;
      if (!s.dane.email && k.email) s.dane.email = k.email;
    }
    zachowaj();
    render();
  } catch (e) {
    $('#widok').innerHTML = `<section class="wstep"><h1>Nie udało się wczytać oferty</h1><p>${esc(e.message)}</p><p><button type="button" data-akcja="ponow">Spróbuj ponownie</button></p></section>`;
  } finally {
    $('#widok').removeAttribute('aria-busy');
  }
}

function zbierzFormularz() {
  const f = $('#formularz');
  if (!f) return;
  const e = f.elements;
  s.dane.nazwa = e.nazwa.value;
  s.dane.telefon = e.telefon.value;
  s.dane.email = e.email.value;
  if (e.adres) s.dane.adres = e.adres.value;
  s.dane.uwagi = e.uwagi.value;
  s.dane.dostawa = f.querySelector('[name=dostawa]:checked')?.value || s.dane.dostawa;
  s.dane.forma = f.querySelector('[name=forma]:checked')?.value || 'Przelew';
  zachowaj();
}

async function wyslij(przycisk) {
  zbierzFormularz();
  const f = $('#formularz');
  const d = dostawa();
  const tel = s.dane.telefon.replace(/[^\d+]/g, '');
  const blad = !s.dane.nazwa.trim() ? ['nazwa', 'Podaj imię i nazwisko.']
    : tel.replace('+', '').length < 9 ? ['telefon', 'Podaj numer telefonu – wyślemy na niego potwierdzenie.']
    : s.dane.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.dane.email.trim()) ? ['email', 'Sprawdź adres e-mail.']
    : s.oferta.wysylki.length && !d ? ['dostawa', 'Wybierz sposób dostawy.']
    : d?.adres && !s.dane.adres.trim() ? ['adres', 'Podaj adres dostawy lub numer paczkomatu.']
    : null;
  if (blad) {
    toast(blad[1], 'blad', 5000);
    f.elements[blad[0]]?.focus?.() || f.querySelector(`[name=${blad[0]}]`)?.focus();
    return;
  }
  przycisk.disabled = true;
  przycisk.textContent = 'Wysyłam…';
  try {
    const w = await api('zamow', {
      kod: s.kod || '', www: f.elements.www.value,
      klient: { nazwa: s.dane.nazwa, telefon: s.dane.telefon, email: s.dane.email },
      pozycje: s.koszyk.map(k => ({ symbol: k.s, ilosc: k.ilosc })),
      dostawa_id: d?.id || '', adres: d?.adres ? s.dane.adres : '', uwagi: s.dane.uwagi, forma_platnosci: s.dane.forma,
    });
    s.wyslane = w;
    s.koszyk = [];
    s.dane.uwagi = '';
    zachowaj();
    s.widok = 'dziekujemy';
    location.hash = '#dziekujemy';
    render();
    window.scrollTo(0, 0);
  } catch (e) {
    toast(e.message, 'blad', 8000);
    przycisk.disabled = false;
    przycisk.textContent = 'Zamawiam';
  }
}

function ustawIlosc(sym, ilosc) {
  const k = s.koszyk.find(x => x.s === sym);
  if (!k) return;
  k.ilosc = Math.max(0, Math.min(99, ilosc));
  if (!k.ilosc) s.koszyk = s.koszyk.filter(x => x !== k);
  zachowaj();
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const a = b.dataset.akcja;
  if (a === 'wariant') {
    const karta = b.closest('.karta');
    $$('.opcja', karta).forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    $('.do-koszyka', karta).dataset.s = b.dataset.s;
  } else if (a === 'dodaj') {
    const sym = b.dataset.s;
    const k = s.koszyk.find(x => x.s === sym);
    if (k) k.ilosc = Math.min(99, k.ilosc + 1); else s.koszyk.push({ s: sym, ilosc: 1 });
    zachowaj();
    const ww = wariant(sym);
    toast(`Dodano: ${ww.g.nazwa}${ww.w.w ? ' ' + ww.w.w : ''}`, 'ok', 1800);
    const wybrany = sym;
    odswiezSiatke();
    // zostaw wybrany wariant na karcie
    const karta = [...$$('.karta')].find(c => $$('.opcja', c).some(o => o.dataset.s === wybrany));
    if (karta) { $$('.opcja', karta).forEach(o => o.setAttribute('aria-pressed', String(o.dataset.s === wybrany))); $('.do-koszyka', karta).dataset.s = wybrany; }
  } else if (a === 'kategoria') {
    s.kategoria = b.dataset.k; s.ile = NA_STRONE; render();
  } else if (a === 'wiecej') {
    s.ile += NA_STRONE; odswiezSiatke();
  } else if (a === 'koszyk') {
    s.widok = 'koszyk'; location.hash = '#koszyk'; render(); window.scrollTo(0, 0);
  } else if (a === 'do-oferty') {
    zbierzFormularz(); s.widok = 'oferta'; location.hash = ''; render();
  } else if (a === 'plus' || a === 'minus' || a === 'usun') {
    zbierzFormularz();
    const sym = b.closest('[data-s]').dataset.s;
    const k = s.koszyk.find(x => x.s === sym);
    ustawIlosc(sym, a === 'usun' ? 0 : k.ilosc + (a === 'plus' ? 1 : -1));
    odswiezSiatke();
  } else if (a === 'wyslij') {
    await wyslij(b);
  } else if (a === 'kod') {
    await oknoKodu();
  } else if (a === 'wyloguj') {
    s.kod = ''; await przeladuj();
  } else if (a === 'ponow') {
    await przeladuj();
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'szukaj') {
    s.szukaj = e.target.value;
    s.ile = NA_STRONE;
    const pos = e.target.selectionStart;
    render();
    const i = $('#szukaj'); i.focus(); i.setSelectionRange(pos, pos);
  }
});
document.addEventListener('change', e => {
  if (e.target.closest('#formularz')) {
    zbierzFormularz();
    if (e.target.name === 'dostawa') odswiezSiatke();
  }
});

$('#koszyk-przycisk').addEventListener('click', () => { zbierzFormularz(); s.widok = 'koszyk'; location.hash = '#koszyk'; render(); window.scrollTo(0, 0); });
$('#kod-przycisk').addEventListener('click', () => oknoKodu());
window.addEventListener('hashchange', () => {
  const h = location.hash;
  const nowy = h === '#koszyk' ? 'koszyk' : h === '#dziekujemy' && s.wyslane ? 'dziekujemy' : 'oferta';
  if (nowy !== s.widok) { zbierzFormularz(); s.widok = nowy; render(); }
});

// ───────────────────────── start ─────────────────────────

wczytajPamiec();
const kodZLinku = /[#&]kod=([^&]+)/.exec(location.hash);
if (kodZLinku) { s.kod = decodeURIComponent(kodZLinku[1]); history.replaceState(null, '', location.pathname); }
if (location.hash === '#koszyk') s.widok = 'koszyk';
przeladuj().then(() => { if (kodZLinku && s.oferta?.klient) toast(`Witaj, ${s.oferta.klient.nazwa}! Widzisz swoje ceny.`, 'ok', 5000); });
