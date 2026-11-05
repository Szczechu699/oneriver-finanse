// Ekran „Sklep” (#sklep): link do formularza zamówień dla klientów, katalog produktów,
// grupy cenowe (np. Hurt −30%) i cennik wysyłek.

import { $, esc, kwotaTxt, num, liczba, liczbaNaTekst, uuid, toast, okno } from './util.js';
import { dane, wczytaj, aktywny, kategorieFormularza } from './dane.js';
import { ADRES_FORMULARZA, PRZYKLADOWE_WYSYLKI } from './konfiguracja.js';
import { wywolaj, ustawienia, wersjaApi } from './api.js';
import * as sync from './sync.js';

const prawda = v => v === true || String(v) === 'true';
const kwotaPola = v => (v === '' || v == null ? '' : liczbaNaTekst(num(v)));

function htmlWysylek() {
  if (!dane.wysylki.length) return '<p class="pusto">Nie ma jeszcze metod wysyłki. Dodaj gotową poniżej albo własną.</p>';
  return `<ul class="lista-edycji">${dane.wysylki.map(w => `<li>
    <form data-forma="wysylka" data-id="${esc(w.id)}" class="edycja-wiersza${aktywny(w) ? '' : ' nieaktywna'}">
      <label class="pole szeroka"><span class="etykieta">Nazwa</span><input name="nazwa" value="${esc(w.nazwa)}" autocomplete="off"></label>
      <label class="pole"><span class="etykieta">Cena</span><input name="cena" inputmode="decimal" value="${esc(kwotaPola(w.cena))}" placeholder="0,00"></label>
      <label class="pole"><span class="etykieta">Darmowa od</span><input name="darmowa_od" inputmode="decimal" value="${esc(kwotaPola(w.darmowa_od))}" placeholder="nigdy"></label>
      <label class="pole"><span class="etykieta">Kolejność</span><input name="kolejnosc" inputmode="numeric" value="${esc(w.kolejnosc ?? '')}"></label>
      <label class="pole szeroka"><span class="etykieta">Opis dla klienta</span><input name="opis" value="${esc(w.opis || '')}" autocomplete="off"></label>
      <label class="przelacznik"><input type="checkbox" name="wymaga_adresu" ${prawda(w.wymaga_adresu) ? 'checked' : ''}> wymaga adresu / paczkomatu</label>
      <label class="przelacznik"><input type="checkbox" name="aktywna" ${aktywny(w) ? 'checked' : ''}> widoczna dla klientów</label>
      <div class="przyciski"><button type="submit">Zapisz</button></div>
    </form></li>`).join('')}</ul>`;
}

function htmlGrup() {
  return `${dane.grupyCenowe.length ? `<ul class="lista-edycji">${dane.grupyCenowe.map(g => `<li>
    <form data-forma="grupa" data-id="${esc(g.id)}" class="edycja-wiersza${aktywny(g) ? '' : ' nieaktywna'}">
      <label class="pole szeroka"><span class="etykieta">Nazwa grupy</span><input name="nazwa" value="${esc(g.nazwa)}" autocomplete="off"></label>
      <label class="pole"><span class="etykieta">Rabat %</span><input name="rabat_proc" inputmode="decimal" value="${esc(String(num(g.rabat_proc)).replace('.', ','))}"></label>
      <label class="przelacznik"><input type="checkbox" name="aktywna" ${aktywny(g) ? 'checked' : ''}> aktywna</label>
      <span class="podpowiedz">${dane.klienci.filter(k => String(k.grupa) === String(g.id)).length} klientów</span>
      <div class="przyciski"><button type="submit">Zapisz</button></div>
    </form></li>`).join('')}</ul>` : '<p class="pusto">Nie ma jeszcze grup cenowych.</p>'}
    <form data-forma="nowa-grupa" class="edycja-wiersza">
      <label class="pole szeroka"><span class="etykieta">Nowa grupa</span><input name="nazwa" placeholder="np. Hurt" autocomplete="off"></label>
      <label class="pole"><span class="etykieta">Rabat %</span><input name="rabat_proc" inputmode="decimal" placeholder="np. 30"></label>
      <div class="przyciski"><button type="submit">Dodaj grupę</button></div>
    </form>`;
}

function render() {
  const kat = dane.cennik.length;
  const produktow = dane.produkty.length;
  const zZdj = dane.produkty.filter(p => p.zdjecie).length;
  const api = wersjaApi();
  const istniejace = new Set(dane.wysylki.map(w => String(w.nazwa)));
  $('#widok').innerHTML = `
  <section class="ekran ustawienia">
    <h1>Sklep</h1>
    ${api && api < 7 ? `<p class="pasek-info blad">Skrypt arkusza ma wersję ${api}. Formularz dla klientów, wysyłki i ceny specjalne działają od wersji 7 – wklej nowy Kod.gs.</p>` : ''}

    <article class="panel">
      <h2>Formularz zamówień dla klientów</h2>
      <p>Jeden link dla wszystkich – klient widzi ceny detaliczne, a po wpisaniu swojego kodu (z karty klienta) swoje ceny.</p>
      <p><a href="${esc(ADRES_FORMULARZA)}" target="_blank" rel="noopener">${esc(ADRES_FORMULARZA)}</a></p>
      <div class="przyciski"><button type="button" data-akcja="kopiuj-formularz">Kopiuj link</button>
        <a class="przycisk drugorzedny" href="${esc(ADRES_FORMULARZA)}" target="_blank" rel="noopener">Otwórz formularz</a></div>
      <form data-forma="kategorie">
        <span class="etykieta">Kategorie widoczne dla klientów</span>
        <div class="kategorie-formularza">${dane.grupy.map(k => `<label class="przelacznik"><input type="checkbox" name="kat" value="${esc(k)}" ${kategorieFormularza().includes(k) ? 'checked' : ''}> ${esc(k)}</label>`).join('')}</div>
        <div class="przyciski"><button type="submit" class="drugorzedny">Zapisz kategorie</button></div>
      </form>
    </article>

    <article class="panel">
      <h2>Poziomy cen</h2>
      <p>Tabele cen detalicznych i hurtowych dla Rapé (rodzaj × gramatura) i Zielarni. Klientowi przypisujesz poziom w jego karcie.</p>
      <p>${dane.poziomy.filter(aktywny).length} poziomów.</p>
      <div class="przyciski"><a class="przycisk" href="#poziomy/rape">Poziomy Rapé</a><a class="przycisk drugorzedny" href="#poziomy/zielarnia">Poziomy Zielarni</a></div>
    </article>

    <article class="panel">
      <h2>Katalog produktów</h2>
      <p>${dane.zKatalogu
        ? `${kat} pozycji w ${produktow} produktach (warianty gramatur i rozmiarów razem)${zZdj ? `, ${zZdj} ze zdjęciem ze sklepu` : ''}. Źródło: arkusz „Cennik OneRiver” (Subiekt), odświeżany co godzinę.`
        : 'Katalog jeszcze nie został pobrany z „Cennik OneRiver” – na razie ceny pochodzą ze sprzedaży z Subiekta.'}</p>
      ${dane.stanyZDnia ? `<p>Stany (INC Główny + ONE Główny + Grazanka, minus rezerwacje) z arkusza magazynu z ${esc(new Date(dane.stanyZDnia).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }))}. Aktualizują się po imporcie stanów z Subiekta w arkuszu magazynu.</p>` : ''}
      <div class="przyciski"><button type="button" data-akcja="odswiez-katalog">Odśwież katalog teraz</button></div>
    </article>

    <article class="panel">
      <h2>Grupy cenowe</h2>
      <p class="podpowiedz">Rabat grupy działa na cały katalog. Klientowi przypisujesz grupę w jego karcie; tam też ustawisz własny rabat albo ceny specjalne na wybrane produkty.</p>
      <div id="grupy">${htmlGrup()}</div>
    </article>

    <article class="panel">
      <h2>Cennik wysyłek</h2>
      <div id="wysylki">${htmlWysylek()}</div>
      <span class="etykieta">Dodaj gotową metodę</span>
      <div class="chipy">${PRZYKLADOWE_WYSYLKI.filter(w => !istniejace.has(w.nazwa)).map((w, i) => `<button type="button" class="chip" data-akcja="dodaj-wysylke" data-i="${PRZYKLADOWE_WYSYLKI.indexOf(w)}">+ ${esc(w.nazwa)}</button>`).join('')}
        <button type="button" class="chip" data-akcja="dodaj-wysylke" data-i="-1">+ Własna metoda</button></div>
    </article>
  </section>`;
}

async function zapiszWiersz(karta, wiersz, komunikat) {
  await sync.zapisz([{ karta, wiersze: [wiersz] }]);
  await wczytaj();
  toast(komunikat, 'ok');
  render();
}

function kwotaZPola(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  const n = liczba(t);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

async function submit(form) {
  const f = form.elements;
  if (form.dataset.forma === 'kategorie') {
    const wybrane = [...form.querySelectorAll('[name=kat]:checked')].map(i => i.value);
    if (!wybrane.length) return toast('Zaznacz przynajmniej jedną kategorię.', 'blad');
    await zapiszWiersz('USTAWIENIA', { id: 'kategorie_formularza', tresc: wybrane.join('|'), opis: 'Kategorie widoczne w formularzu zamówień (oddzielone |)' },
      `Formularz pokazuje: ${wybrane.join(', ')}.`);
    return;
  }
  if (form.dataset.forma === 'wysylka') {
    const w = dane.wysylki.find(x => String(x.id) === form.dataset.id);
    const cena = kwotaZPola(f.cena.value);
    const darmowa = kwotaZPola(f.darmowa_od.value);
    if (!f.nazwa.value.trim()) return toast('Wpisz nazwę metody.', 'blad');
    if (cena === '' || Number.isNaN(cena)) return toast('Wpisz cenę wysyłki (0 dla darmowej).', 'blad');
    if (Number.isNaN(darmowa)) return toast('Sprawdź kwotę „darmowa od”.', 'blad');
    await zapiszWiersz('WYSYLKI', { ...w, nazwa: f.nazwa.value.trim(), opis: f.opis.value.trim(), cena, darmowa_od: darmowa,
      kolejnosc: f.kolejnosc.value.trim() === '' ? '' : Number(f.kolejnosc.value) || 0,
      wymaga_adresu: f.wymaga_adresu.checked, aktywna: f.aktywna.checked }, `Zapisano: ${f.nazwa.value.trim()}.`);
  } else if (form.dataset.forma === 'grupa' || form.dataset.forma === 'nowa-grupa') {
    const nowa = form.dataset.forma === 'nowa-grupa';
    const g = nowa ? { id: uuid(), opis: '' } : dane.grupyCenowe.find(x => String(x.id) === form.dataset.id);
    const rabat = kwotaZPola(f.rabat_proc.value);
    if (!f.nazwa.value.trim()) return toast('Wpisz nazwę grupy.', 'blad');
    if (rabat === '' || Number.isNaN(rabat) || rabat >= 100) return toast('Rabat: liczba od 0 do 99.', 'blad');
    await zapiszWiersz('GRUPY_CENOWE', { ...g, nazwa: f.nazwa.value.trim(), rabat_proc: rabat, aktywna: nowa ? true : f.aktywna.checked },
      `Zapisano grupę ${f.nazwa.value.trim()}.`);
  }
}

async function klik(e) {
  const b = e.target.closest('[data-akcja]');
  if (!b) return;
  const akcja = b.dataset.akcja;
  if (akcja === 'kopiuj-formularz') {
    try { await navigator.clipboard.writeText(ADRES_FORMULARZA); toast('Skopiowano link do formularza.', 'ok'); } catch { toast(ADRES_FORMULARZA, '', 8000); }
  } else if (akcja === 'dodaj-wysylke') {
    const wzor = PRZYKLADOWE_WYSYLKI[Number(b.dataset.i)] || { nazwa: 'Nowa metoda', opis: '', wymaga_adresu: true };
    await zapiszWiersz('WYSYLKI', { id: uuid(), nazwa: wzor.nazwa, opis: wzor.opis, cena: 0, darmowa_od: '', wymaga_adresu: wzor.wymaga_adresu,
      kolejnosc: dane.wysylki.length + 1, aktywna: false }, `Dodano: ${wzor.nazwa}. Wpisz cenę i zaznacz „widoczna dla klientów”.`);
  } else if (akcja === 'odswiez-katalog') {
    if (!navigator.onLine) return toast('Odświeżenie katalogu wymaga internetu.', 'blad');
    b.disabled = true;
    b.textContent = 'Odświeżam… (do minuty)';
    try {
      const w = await wywolaj('odswiezKatalog', { kto: ustawienia().kto }, 300000);
      await sync.synchronizuj();
      await wczytaj();
      toast(`Katalog: ${w.produktow} pozycji${w.zdjec ? `, ${w.zdjec} ze zdjęciem` : ''}${w.na_stanie != null ? `, ${w.na_stanie} na stanie` : ''}.`, 'ok', 6000);
      render();
    } catch (err) {
      toast('Nie udało się odświeżyć katalogu: ' + err.message, 'blad', 8000);
      b.disabled = false;
      b.textContent = 'Odśwież katalog teraz';
    }
  }
}

export const ekran = { render, klik, submit };
