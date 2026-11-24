// Przelew zbiorczy z kodem QR: kilka planowanych płatności do tej samej osoby (np. wynagrodzenie + zwrot za zakupy)
// jednym przelewem. Kod QR w polskim standardzie banków (rekomendacja ZBP, „kod 2D”):
//   NIP|kraj|numer rachunku (26 cyfr)|kwota w groszach (6 cyfr)|nazwa odbiorcy (≤20)|tytuł (≤32)|||
// Po „Zapłacone” każda pozycja dostaje własną transakcję (z kategorią / spłatą pożyczki), wszystkie ze wspólnym
// podzial_id – import wyciągu łączy je z jednym przelewem po sumie części.
// Numery rachunków odbiorców: Słownik, lista „odbiorcy” (nazwa = kontrahent, atrybuty: iban, nazwa_przelewu).

import qrcode from '../vendor/qrcode/qrcode.js';
import * as sync from './sync.js';
import { $, esc, zaokr, kwotaTxt, dataLok, dataKrotko, uuid, liczba, liczbaNaTekst, odmiana, toast, okno } from './util.js';
import { dane, wczytajDane, konta, nastepnyTermin, statusDlaKonta, kierunekPlanu } from './dane.js';
import { dodajSplate, doZaplatyRaty } from './pozyczki.js';

const MAKS_GROSZE = 999999;               // pole kwoty w kodzie ZBP ma 6 cyfr (do 9 999,99 zł)

const bezOgonkow = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
  .replace(/[|\r\n\t]/g, ' ').replace(/\s{2,}/g, ' ').trim();
export const cyfryRachunku = s => String(s || '').replace(/^PL/i, '').replace(/\D/g, '');
const ladnyRachunek = s => cyfryRachunku(s).replace(/^(\d{2})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})$/, '$1 $2 $3 $4 $5 $6 $7');

/** Poprawny polski numer rachunku (NRB): 26 cyfr i suma kontrolna IBAN. */
export function poprawnyRachunek(s) {
  const c = cyfryRachunku(s);
  if (c.length !== 26) return false;
  const przest = c.slice(2) + '2521' + c.slice(0, 2);     // PL = 25 21
  let r = 0;
  for (const z of przest) r = (r * 10 + Number(z)) % 97;
  return r === 1;
}

export function tekstKodu({ rachunek, grosze, nazwa, tytul, nip = '' }) {
  return [String(nip).replace(/\D/g, ''), 'PL', cyfryRachunku(rachunek), grosze > MAKS_GROSZE ? '' : String(grosze).padStart(6, '0'),
    bezOgonkow(nazwa).slice(0, 20), bezOgonkow(tytul).slice(0, 32), '', '', ''].join('|');
}

/** Pozycja planowana, którą można dołączyć do przelewu zbiorczego. */
export const mozeZbiorczo = p => p.status === 'aktywna' && kierunekPlanu(p) === 'wypływ' && (p.waluta || 'PLN') === 'PLN';

export function kwotaPozycji(p) {
  if (p.rodzaj === 'rata') {
    const poz = dane.pozyczki.find(x => x.id === p.pozyczka_id);
    if (poz) return doZaplatyRaty(poz, p);
  }
  return Number(p.kwota) || 0;
}

// ── odbiorcy (Słownik „odbiorcy”) ──

const normNazwa = s => bezOgonkow(s).toLowerCase();
const odbiorcy = () => dane.slownik.filter(x => x.lista === 'odbiorcy' && x.aktywna !== false && String(x.aktywna) !== 'FALSE');
const atrybutyOdb = o => { try { return JSON.parse(o.atrybuty || '{}'); } catch { return {}; } };
function znajdzOdbiorce(nazwa) {
  const n = normNazwa(nazwa);
  return n ? odbiorcy().find(o => normNazwa(o.nazwa) === n) : null;
}
async function zapamietajOdbiorce(nazwa, rachunek, nazwaPrzelewu) {
  const ist = znajdzOdbiorce(nazwa);
  const atr = { ...(ist ? atrybutyOdb(ist) : {}), iban: cyfryRachunku(rachunek), nazwa_przelewu: nazwaPrzelewu };
  await sync.zapisz('SLOWNIK', [{ ...(ist || { lista: 'odbiorcy', id: 'ODB-' + uuid().slice(0, 8), nazwa, rodzic: '', aktywna: true, kolejnosc: odbiorcy().length + 1 }),
    atrybuty: JSON.stringify(atr) }]);
}

// ── kod QR ──

function rysujQR(tekst, skala = 8) {
  const qr = qrcode(0, 'M');
  qr.addData(tekst);
  qr.make();
  const n = qr.getModuleCount(), margines = 4;
  const c = document.createElement('canvas');
  c.width = c.height = (n + 2 * margines) * skala;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect((k + margines) * skala, (r + margines) * skala, skala, skala);
  return c;
}

/** Obrazek do pobrania: kod QR + dane przelewu i lista pozycji pod spodem. */
function obrazek(qr, d) {
  const W = Math.max(qr.width, 720), pad = 28;
  const linie = [
    ['b', d.nazwaPrzelewu], ['', ladnyRachunek(d.rachunek)], ['b', kwotaTxt(d.suma)], ['', 'Tytuł: ' + d.tytul], ['', ''],
    ...d.pozycje.map(x => ['s', `• ${x.nazwa} – ${kwotaTxt(x.kwota)}`]),
  ];
  const H = qr.height + pad + linie.length * 30 + pad;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.drawImage(qr, (W - qr.width) / 2, 0);
  let y = qr.height + pad;
  for (const [s, t] of linie) {
    g.font = `${s === 'b' ? '700 26px' : s === 's' ? '20px' : '22px'} system-ui, sans-serif`;
    g.fillStyle = s === 's' ? '#444' : '#111';
    g.fillText(t.length > 70 ? t.slice(0, 68) + '…' : t, pad, y);
    y += 30;
  }
  return c;
}

// ── okno przelewu zbiorczego ──

/**
 * pozycje: wiersze PLANOWANE. Pokazuje formularz (odbiorca, rachunek, tytuł, opis, konto, data), potem kod QR;
 * „Zapłacone” tworzy transakcje. Zwraca true, gdy coś zapisano.
 */
export async function przelewZbiorczy(pozycje) {
  const lista_ = pozycje.map(p => ({ p, nazwa: p.nazwa || p.kategoria || p.kontrahent, kwota: zaokr(kwotaPozycji(p)) })).filter(x => x.kwota > 0);
  if (!lista_.length) { toast('Zaznaczone pozycje nie mają kwoty do zapłaty.', 'blad'); return false; }
  const suma = zaokr(lista_.reduce((s, x) => s + x.kwota, 0));
  const osoby = [...new Set(lista_.map(x => String(x.p.kontrahent || '').trim()).filter(Boolean))];
  const odb = znajdzOdbiorce(osoby[0] || '');
  const atr = odb ? atrybutyOdb(odb) : {};
  const dzien = dataLok();
  const tytulDomyslny = `One River rozliczenie ${dzien.slice(8, 10)}.${dzien.slice(5, 7)}`;
  const opisDomyslny = lista_.map(x => `${x.nazwa} ${liczbaNaTekst(x.kwota)} zł`).join('; ');
  const kontoDomyslne = lista_[0].p.konto || konta().find(k => k.nazwa === 'mBank PLN')?.nazwa || konta()[0]?.nazwa || '';

  const ok = await okno(`Przelew zbiorczy: ${kwotaTxt(suma)}`, `
    <ul class="lista-zbiorcza">${lista_.map(x => `<li><span>${esc(x.nazwa)}${x.p.kontrahent ? ` <small>${esc(x.p.kontrahent)}</small>` : ''}</span><b>${esc(kwotaTxt(x.kwota))}</b></li>`).join('')}
      <li class="suma"><span>Razem</span><b>${esc(kwotaTxt(suma))}</b></li></ul>
    ${osoby.length > 1 ? `<p class="komunikat blad">Pozycje mają różnych odbiorców (${esc(osoby.join(', '))}) – sprawdź, czy to na pewno jeden przelew.</p>` : ''}
    ${Math.round(suma * 100) > MAKS_GROSZE ? '<p class="komunikat blad">Kod QR banków mieści kwoty do 9 999,99 zł – kwotę wpiszesz w aplikacji banku ręcznie.</p>' : ''}
    <div class="rzad">
      <label class="pole"><span class="etykieta">Odbiorca (w aplikacji)</span><input name="z-osoba" value="${esc(osoby[0] || '')}" autocomplete="off"></label>
      <label class="pole"><span class="etykieta">Nazwa odbiorcy w przelewie</span><input name="z-nazwa" value="${esc(atr.nazwa_przelewu || osoby[0] || '')}" maxlength="60" autocomplete="off"></label>
    </div>
    <label class="pole"><span class="etykieta">Numer rachunku odbiorcy</span><input name="z-rachunek" inputmode="numeric" value="${esc(ladnyRachunek(atr.iban || ''))}" placeholder="26 cyfr" autocomplete="off">
      <span class="podpowiedz">Zapamięta się dla tej osoby.</span></label>
    <label class="pole"><span class="etykieta">Tytuł przelewu (do 32 znaków)</span><input name="z-tytul" value="${esc(tytulDomyslny)}" maxlength="32" autocomplete="off"></label>
    <label class="pole"><span class="etykieta">Za co (zapisze się w transakcjach)</span><textarea name="z-opis" rows="3">${esc(opisDomyslny)}</textarea></label>
    <div class="rzad">
      <label class="pole"><span class="etykieta">Z konta</span><select name="z-konto">${konta().filter(k => k.typ !== 'skarbonka').map(k => `<option ${k.nazwa === kontoDomyslne ? 'selected' : ''}>${esc(k.nazwa)}</option>`).join('')}</select></label>
      <label class="pole"><span class="etykieta">Data przelewu</span><input name="z-data" type="date" value="${dzien}"></label>
    </div>`,
  [{ etykieta: 'Anuluj', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Pokaż kod QR', wartosc: true }]);
  if (!ok) return false;
  const pole = n => $(`#okno [name="${n}"]`)?.value ?? '';
  const d = {
    osoba: pole('z-osoba').trim(), nazwaPrzelewu: pole('z-nazwa').trim(), rachunek: pole('z-rachunek'), tytul: pole('z-tytul').trim() || tytulDomyslny,
    opis: pole('z-opis').trim(), konto: pole('z-konto'), data: pole('z-data') || dzien, suma, pozycje: lista_,
  };
  if (!poprawnyRachunek(d.rachunek)) { toast('Numer rachunku jest niepoprawny (26 cyfr, suma kontrolna).', 'blad', 6000); return false; }
  if (!d.nazwaPrzelewu) { toast('Wpisz nazwę odbiorcy.', 'blad'); return false; }
  zapamietajOdbiorce(d.osoba || d.nazwaPrzelewu, d.rachunek, d.nazwaPrzelewu).catch(() => {});

  const tekst = tekstKodu({ rachunek: d.rachunek, grosze: Math.round(suma * 100), nazwa: d.nazwaPrzelewu, tytul: d.tytul });
  const qr = rysujQR(tekst);
  const img = obrazek(qr, d);
  const url = img.toDataURL('image/png');
  const plik = `Przelew ${bezOgonkow(d.nazwaPrzelewu)} ${liczbaNaTekst(suma)} zl ${d.data}.png`;
  const dane2 = `${d.nazwaPrzelewu}\n${ladnyRachunek(d.rachunek)}\n${liczbaNaTekst(suma)} zł\n${d.tytul}`;

  const pokaz = okno('Kod QR do przelewu', `
    <div class="kod-qr"><img src="${url}" alt="Kod QR przelewu ${esc(kwotaTxt(suma))} dla ${esc(d.nazwaPrzelewu)}"></div>
    <p class="podpowiedz">W aplikacji banku wybierz skanowanie kodu QR (mBank: „Zeskanuj i zapłać”, Erste: skanuj albo dodaj zdjęcie) i nakieruj aparat na kod na ekranie komputera albo wczytaj pobrany obrazek. Sprawdź dane przed zatwierdzeniem.</p>
    <div class="przyciski">
      <a class="przycisk drugorzedny" href="${url}" download="${esc(plik)}">Pobierz obrazek</a>
      ${navigator.canShare ? '<button type="button" class="drugorzedny" data-qr="udostepnij">Udostępnij / zapisz w zdjęciach</button>' : ''}
      <button type="button" class="drugorzedny" data-qr="kopiuj">Kopiuj dane przelewu</button>
    </div>
    <p class="podpowiedz">Po wysłaniu przelewu kliknij „Zapłacone” – każda pozycja dostanie swoją transakcję (z kategorią), a import wyciągu połączy je z tym jednym przelewem.</p>`,
  [{ etykieta: 'Zamknij', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Zapłacone', wartosc: true }]);
  const dlg = $('#okno');
  dlg.classList.add('okno-szerokie');
  dlg.querySelector('[data-qr="kopiuj"]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(dane2); toast('Skopiowano dane przelewu.', 'ok'); } catch { toast(dane2, '', 8000); }
  });
  dlg.querySelector('[data-qr="udostepnij"]')?.addEventListener('click', async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const f = new File([blob], plik, { type: 'image/png' });
      if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: d.tytul });
      else await navigator.share({ title: d.tytul, text: dane2 });
    } catch { /* anulowane */ }
  });
  const zaplacone = await pokaz;
  dlg.classList.remove('okno-szerokie');
  if (!zaplacone) return false;
  await zapiszZaplacone(d);
  toast(`Zapisano przelew zbiorczy ${kwotaTxt(suma)} (${lista_.length} ${odmiana(lista_.length, 'pozycja', 'pozycje', 'pozycji')}).`, 'ok', 6000);
  return true;
}

/** Transakcje do każdej pozycji ze wspólnym podzial_id; raty pożyczek jako spłaty. */
async function zapiszZaplacone(d) {
  const podzial = uuid();
  const dopisek = `Przelew zbiorczy „${d.tytul}”${d.opis ? ': ' + d.opis : ''}`.slice(0, 480);
  const transakcje = [], plany = [];
  for (const { p, kwota } of d.pozycje.filter(x => x.p.rodzaj !== 'rata')) {
    transakcje.push({
      id: uuid(), typ: 'wydatek', id_pary: '', podzial_id: podzial, data_operacji: d.data, konto: d.konto, kwota, waluta: 'PLN', kurs: 1, kwota_pln: kwota,
      kategoria: p.kategoria || '', podkategoria: p.podkategoria || '', zrodlo_przychodu: '', kontrahent: p.kontrahent || d.osoba || p.nazwa || '',
      podmiot: p.podmiot || '', tagi: p.tagi || '', nr_dokumentu: '', opis: [p.opis, dopisek].filter(Boolean).join(' · '), zalacznik: '',
      budzet: p.budzet || '', cel: '', pozyczka_id: '', planowana_id: p.id, planowany_termin: p.nastepna_data,
      status: statusDlaKonta(d.konto), zrodlo: 'ręczny',
    });
    const nastepny = nastepnyTermin(p);
    plany.push(nastepny ? { ...p, nastepna_data: nastepny } : { ...p, status: 'zakończona' });
  }
  if (transakcje.length) {
    await sync.zapiszWiele([{ karta: 'TRANSAKCJE', wiersze: transakcje }, { karta: 'PLANOWANE', wiersze: plany }]);
    await wczytajDane();
  }
  for (const { p, kwota } of d.pozycje.filter(x => x.p.rodzaj === 'rata')) {
    const poz = dane.pozyczki.find(x => x.id === p.pozyczka_id);
    if (poz) await dodajSplate(poz, { kwota, data: d.data, konto: d.konto, rata: p, podzial_id: podzial, opis: dopisek });
  }
}
