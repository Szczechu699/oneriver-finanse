// Synchronizacja: najpierw wysyłka kolejki (to, co zapisano na urządzeniu), potem pobranie zmian z arkusza.

import * as db from './db.js';
import { wywolaj, ustawienia, skonfigurowane, BladApi } from './api.js';

export const KLUCZE = {
  SLOWNIK: r => `${r.lista}|${r.id}`,
  TRANSAKCJE: r => String(r.id),
};
const KARTY_POBIERANE = Object.keys(KLUCZE);

const sluchacze = new Set();
let stan = { tryb: 'start', oczekujace: 0, ostatnia: null, blad: null };
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

export function stanSynchronizacji() {
  return stan;
}

export async function odswiezLicznik() {
  const k = await db.kolejka();
  ustaw({ oczekujace: k.length, oczekujaceKlucze: new Set(k.map(p => `${p.karta}|${p.klucz}`)) });
}

/** Zapis na urządzeniu + kolejka do wysłania. Działa także bez internetu. */
export async function zapisz(karta, wiersze) {
  const klucz = KLUCZE[karta];
  await db.zapiszWiersze(karta, wiersze, klucz);
  for (const w of wiersze) await db.kolejkaDodaj(karta, klucz(w), w);
  await odswiezLicznik();
  synchronizuj().catch(() => {});
}

function zaokr(n) {
  return Math.round(n * 100) / 100;
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
  for (const [karta, lista] of wgKart) {
    for (let i = 0; i < lista.length; i += 200) {
      const paczka = lista.slice(i, i + 200);
      await wywolaj('zapisz', { karta, kto, wiersze: paczka.map(p => p.wiersz) });
      await db.kolejkaUsun(paczka.map(p => p.nr));
    }
  }
}

async function pobierzZmiany(pelna) {
  const od = {};
  if (!pelna) {
    for (const k of KARTY_POBIERANE) od[k] = (await db.metaPobierz('stan:' + k)) || null;
  }
  const wynik = await wywolaj('pobierzWiele', { karty: KARTY_POBIERANE, od }, 90000);
  const czekajace = new Set((await db.kolejka()).map(p => `${p.karta}|${p.klucz}`));
  for (const karta of KARTY_POBIERANE) {
    const dane = wynik[karta];
    const klucz = KLUCZE[karta];
    const doZapisu = dane.wiersze.filter(w => !czekajace.has(`${karta}|${klucz(w)}`));
    if (pelna || !od[karta]) {
      const zostaw = new Set([...czekajace].filter(k => k.startsWith(karta + '|')).map(k => k.slice(karta.length + 1)));
      await db.wyczyscKarte(karta, zostaw);
    }
    await db.zapiszWiersze(karta, doZapisu, klucz);
    await db.metaZapisz('stan:' + karta, dane.stan);
  }
}

export function synchronizuj({ pelna = false } = {}) {
  if (biezaca) return biezaca;
  biezaca = (async () => {
    await odswiezLicznik();
    if (!skonfigurowane()) {
      ustaw({ tryb: 'brak-ustawien', blad: null });
      return;
    }
    if (!navigator.onLine) {
      ustaw({ tryb: 'offline', blad: null });
      return;
    }
    ustaw({ tryb: 'praca', blad: null });
    try {
      await wyslijKolejke();
      await pobierzZmiany(pelna);
      const teraz = new Date().toISOString();
      await db.metaZapisz('ostatnia', teraz);
      await odswiezLicznik();
      ustaw({ tryb: 'ok', ostatnia: teraz, blad: null, zmiana: Date.now() });
    } catch (e) {
      await odswiezLicznik();
      ustaw({ tryb: navigator.onLine ? 'blad' : 'offline', blad: e.message, zmiana: Date.now(), bladApi: e instanceof BladApi });
    }
  })().finally(() => { biezaca = null; });
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
