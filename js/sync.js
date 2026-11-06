// Synchronizacja z arkuszem:
// 1) załączniki z pamięci urządzenia → Dysk Google (link podmienia się w transakcjach),
// 2) kolejka zapisów → arkusz,
// 3) zmiany z arkusza → urządzenie.

import * as db from './db.js';
import { wywolaj, ustawienia, skonfigurowane, BladApi } from './api.js';

export const KLUCZE = {
  SLOWNIK: r => `${r.lista}|${r.id}`,
  TRANSAKCJE: r => String(r.id),
  PLANOWANE: r => String(r.id),
  BUDZETY: r => String(r.id),
  POZYCZKI: r => String(r.id),
  SPRZEDAZ_SGT: r => `${r.podmiot}|${r.dok_id}`,
  SPRZEDAZ_SGT_POZ: r => `${r.podmiot}|${r.ob_id}`,
  IMPORTY: r => String(r.partia),
  ROZLICZENIA: r => String(r.id),
  ZAMOWIENIA: r => String(r.id),        // zamówienia ze Stoiska (rozliczenia, kasa)
  KASA_LICZENIA: r => String(r.id),     // liczenia kasy (Elsterska, Grażynka, wydarzenia)
};
let kartyPobierane = Object.keys(KLUCZE);

const sluchacze = new Set();
let stan = { tryb: 'start', oczekujace: 0, plikiOczekujace: 0, ostatnia: null, blad: null };
let biezaca = null;

export function obserwuj(fn) {
  sluchacze.add(fn);
  fn(stan);
  return () => sluchacze.delete(fn);
}

function ustaw(zmiana) {
  stan = { ...stan, ...zmiana };
  sluchacze.forEach(fn => fn(stan));
}

export const stanSynchronizacji = () => stan;

export async function odswiezLicznik() {
  const [k, p] = await Promise.all([db.kolejka(), db.pliki()]);
  ustaw({
    oczekujace: k.length + p.length,
    plikiOczekujace: p.length,
    oczekujaceKlucze: new Set(k.map(x => `${x.karta}|${x.klucz}`)),
    oczekujacePliki: new Set(p.map(x => x.plik_id)),
  });
}

/** Zapis na urządzeniu + kolejka do wysłania. Działa także bez internetu. */
export async function zapisz(karta, wiersze, pliki = []) {
  return zapiszWiele([{ karta, wiersze }], pliki);
}

/** Kilka kart naraz (np. pożyczka + transakcja + raty) i jedna synchronizacja po wszystkim. */
export async function zapiszWiele(paczki, pliki = []) {
  for (const p of pliki) await db.plikDodaj(p);
  for (const { karta, wiersze } of paczki) {
    if (!wiersze.length) continue;
    const klucz = KLUCZE[karta];
    await db.zapiszWiersze(karta, wiersze, klucz);
    await db.kolejkaDodajWiele(karta, wiersze.map(w => [klucz(w), w]));
  }
  await odswiezLicznik();
  synchronizuj().catch(() => {});
}

const zaokr = n => Math.round(n * 100) / 100;

function naBase64(blob) {
  return new Promise((ok, blad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => blad(r.error);
    r.readAsDataURL(blob);
  });
}

/** Linia w kolumnie „zalacznik”: „nazwa | link” albo „nazwa | oczekuje:<plik_id>”. Po wysłaniu nazwa = nazwa pliku na Dysku. */
async function podmienZnacznik(plikId, url, nazwaNaDysku) {
  const znacznik = 'oczekuje:' + plikId;
  const podmien = tekst => String(tekst).split('\n')
    .map(l => (l.includes(znacznik) ? `${nazwaNaDysku ? nazwaNaDysku.replace(/\|/g, '-') : l.split(' | ')[0]} | ${url}` : l)).join('\n');
  for (const karta of ['TRANSAKCJE', 'PLANOWANE']) {
    const zmienione = (await db.wiersze(karta))
      .filter(w => String(w.zalacznik || '').includes(znacznik))
      .map(w => ({ ...w, zalacznik: podmien(w.zalacznik) }));
    if (!zmienione.length) continue;
    await db.zapiszWiersze(karta, zmienione, KLUCZE[karta]);
    for (const w of zmienione) await db.kolejkaDodaj(karta, KLUCZE[karta](w), w);
  }
}

async function wyslijPliki() {
  const lista = await db.pliki();
  let blad = null;
  for (const p of lista) {
    try {
      const dane = await naBase64(p.blob);
      const wynik = await wywolaj('zalacznik', {
        plik_id: p.plik_id, nazwa: p.nazwa, mime: p.mime, dane, data: p.data, dowod: p.dowod || null, kto: ustawienia().kto || '',
      }, 180000);
      await podmienZnacznik(p.plik_id, wynik.url, wynik.nazwa);
      await db.plikUsun(p.plik_id);
    } catch (e) {
      blad = 'Załącznik „' + p.nazwa + '”: ' + e.message;
      if (!(e instanceof BladApi)) break;     // brak sieci – reszta poczeka
    }
  }
  return blad;
}

async function uzupelnijKursy(pozycje) {
  const pamiec = new Map();
  const zmienione = [];
  for (const p of pozycje) {
    const w = p.wiersz;
    if (p.karta !== 'TRANSAKCJE' || !w.waluta || w.waluta === 'PLN' || (w.kurs !== '' && w.kurs != null)) continue;
    const data = w.data_operacji;
    if (!data) continue;
    const k = `${w.waluta}|${data}`;
    if (!pamiec.has(k)) {
      // Brak kursu nie blokuje wysyłki – wiersz pójdzie bez kursu, uzupełni się przy następnej edycji.
      pamiec.set(k, await wywolaj('kursNBP', { waluta: w.waluta, data }).catch(() => null));
    }
    const kurs = pamiec.get(k);
    if (!kurs) continue;
    w.kurs = kurs.kurs;
    w.kwota_pln = zaokr(Number(w.kwota) * kurs.kurs);
    zmienione.push(p);
  }
  if (zmienione.length) {
    await db.kolejkaAktualizuj(zmienione);
    await db.zapiszWiersze('TRANSAKCJE', zmienione.map(p => p.wiersz), KLUCZE.TRANSAKCJE);
  }
}

async function wyslijKolejke() {
  const pozycje = await db.kolejka();
  if (!pozycje.length) return;
  await uzupelnijKursy(pozycje);
  const kto = ustawienia().kto || 'tablet';
  const wgKart = new Map();
  pozycje.forEach(p => {
    if (!wgKart.has(p.karta)) wgKart.set(p.karta, []);
    wgKart.get(p.karta).push(p);
  });
  let pierwszyBlad = null;
  for (const [karta, lista] of wgKart) {
    try {
      for (let i = 0; i < lista.length; i += 200) {
        const paczka = lista.slice(i, i + 200);
        await wywolaj('zapisz', { karta, kto, wiersze: paczka.map(p => p.wiersz) });
        await db.kolejkaUsun(paczka.map(p => p.nr));
      }
    } catch (e) {
      // Błąd jednej karty (np. starsze API bez karty BUDZETY) nie wstrzymuje pozostałych.
      if (!(e instanceof BladApi)) throw e;
      pierwszyBlad = pierwszyBlad || e;
    }
  }
  if (pierwszyBlad) throw pierwszyBlad;
}

async function pobierzZmiany(pelna) {
  const od = {};
  if (!pelna) {
    for (const k of kartyPobierane) od[k] = (await db.metaPobierz('stan:' + k)) || null;
  }
  let wynik;
  try {
    wynik = await wywolaj('pobierzWiele', { karty: kartyPobierane, od }, 90000);
  } catch (e) {
    // Starsze API nie zna nowej karty – pobieramy resztę, zamiast stać w miejscu.
    const m = /Nieznana karta: (\w+)/.exec(e.message || '');
    if (!m || !kartyPobierane.includes(m[1])) throw e;
    kartyPobierane = kartyPobierane.filter(k => k !== m[1]);
    return pobierzZmiany(pelna);
  }
  const czekajace = new Set((await db.kolejka()).map(p => `${p.karta}|${p.klucz}`));
  for (const karta of kartyPobierane) {
    const dane = wynik[karta];
    const klucz = KLUCZE[karta];
    // wiersze prywatne, których ten użytkownik nie widzi, przychodzą jako sam klucz z „ukryty” – usuwamy kopię z urządzenia
    const ukryte = dane.wiersze.filter(w => w.ukryty === true || w.ukryty === 'true');
    if (ukryte.length) await db.usunWiersze(karta, ukryte.map(klucz));
    const doZapisu = dane.wiersze.filter(w => !(w.ukryty === true || w.ukryty === 'true') && !czekajace.has(`${karta}|${klucz(w)}`));
    if (pelna || !od[karta]) {
      const zostaw = new Set([...czekajace].filter(k => k.startsWith(karta + '|')).map(k => k.slice(karta.length + 1)));
      await db.wyczyscKarte(karta, zostaw);
    }
    await db.zapiszWiersze(karta, doZapisu, klucz);
    await db.metaZapisz('stan:' + karta, dane.stan);
  }
}

let ponow = false;

export function synchronizuj({ pelna = false } = {}) {
  if (biezaca) { ponow = true; return biezaca; }
  biezaca = (async () => {
    await odswiezLicznik();
    if (!skonfigurowane()) { ustaw({ tryb: 'brak-ustawien', blad: null }); return; }
    if (!navigator.onLine) { ustaw({ tryb: 'offline', blad: null }); return; }
    ustaw({ tryb: 'praca', blad: null });
    try {
      kartyPobierane = Object.keys(KLUCZE);
      const bladPliku = await wyslijPliki();
      let bladZapisu = null;
      await wyslijKolejke().catch(e => { if (e instanceof BladApi) bladZapisu = e.message; else throw e; });
      await pobierzZmiany(pelna);
      const teraz = new Date().toISOString();
      await db.metaZapisz('ostatnia', teraz);
      await odswiezLicznik();
      const blad = bladZapisu || bladPliku;
      ustaw({ tryb: blad ? 'blad' : 'ok', ostatnia: teraz, blad, zmiana: Date.now() });
    } catch (e) {
      await odswiezLicznik();
      ustaw({ tryb: navigator.onLine ? 'blad' : 'offline', blad: e.message, zmiana: Date.now(), bladApi: e instanceof BladApi });
    }
  })().finally(() => {
    biezaca = null;
    // zapis dodany w trakcie synchronizacji – wysyłamy od razu, zamiast czekać na kolejną
    if (ponow && stan.tryb === 'ok' && stan.oczekujace) { ponow = false; synchronizuj(); }
    ponow = false;
  });
  return biezaca;
}

export async function start() {
  ustaw({ ostatnia: (await db.metaPobierz('ostatnia')) || null });
  await odswiezLicznik();
  window.addEventListener('online', () => synchronizuj());
  window.addEventListener('offline', () => ustaw({ tryb: 'offline' }));
  setInterval(() => { if (document.visibilityState === 'visible') synchronizuj(); }, 120000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchronizuj(); });
  synchronizuj();
}
