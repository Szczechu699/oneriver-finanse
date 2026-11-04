// Synchronizacja stoiska z arkuszem:
// 1) kolejka zapisów (zamówienia, pozycje, klienci) → arkusz,
// 2) zmiany z arkusza → urządzenie (zamówienia, klienci i sprzedaż z Subiekta do cennika).

import * as db from './db.js';
import { wywolaj, ustawienia, polaczone, BladApi } from './api.js';

export const KLUCZE = {
  ZAMOWIENIA: r => String(r.id),
  ZAMOWIENIA_POZ: r => String(r.id),
  KLIENCI: r => String(r.id),
  SPRZEDAZ_SGT: r => `${r.podmiot}|${r.dok_id}`,
  SPRZEDAZ_SGT_POZ: r => `${r.podmiot}|${r.ob_id}`,
};

const sluchacze = new Set();
let stan = { tryb: 'start', oczekujace: 0, oczekujaceKlucze: new Set(), ostatnia: null, blad: null };
let biezaca = null;
let ponow = false;

export function obserwuj(fn) { sluchacze.add(fn); fn(stan); return () => sluchacze.delete(fn); }
function ustaw(zmiana) { stan = { ...stan, ...zmiana }; sluchacze.forEach(fn => fn(stan)); }
export const stanSynchronizacji = () => stan;

export async function odswiezLicznik() {
  const k = await db.kolejka();
  ustaw({ oczekujace: k.length, oczekujaceKlucze: new Set(k.map(x => `${x.karta}|${x.klucz}`)) });
}

/** Zapis na urządzeniu + kolejka do wysłania. Działa bez internetu. paczki: [{ karta, wiersze }] */
export async function zapisz(paczki) {
  await db.zapiszZKolejka(paczki.filter(p => p.wiersze.length).map(p => ({ ...p, klucz: KLUCZE[p.karta] })));
  await odswiezLicznik();
  synchronizuj().catch(() => {});
}

async function wyslijKolejke() {
  const pozycje = await db.kolejka();
  if (!pozycje.length) return;
  const kto = ustawienia().kto || 'stoisko';
  // Najpierw klienci, potem zamówienia, na końcu pozycje – w arkuszu nic nie wskazuje na wiersz, którego jeszcze nie ma.
  const kolejnosc = ['KLIENCI', 'ZAMOWIENIA', 'ZAMOWIENIA_POZ'];
  const wgKart = new Map(kolejnosc.map(k => [k, []]));
  pozycje.forEach(p => { if (!wgKart.has(p.karta)) wgKart.set(p.karta, []); wgKart.get(p.karta).push(p); });
  for (const [karta, lista] of wgKart) {
    for (let i = 0; i < lista.length; i += 200) {
      const paczka = lista.slice(i, i + 200);
      await wywolaj('zapisz', { karta, kto, wiersze: paczka.map(p => p.wiersz) });
      await db.kolejkaUsun(paczka.map(p => p.nr));
    }
  }
}

async function pobierzZmiany(pelna) {
  const karty = Object.keys(KLUCZE);
  const od = {};
  if (!pelna) for (const k of karty) od[k] = (await db.metaPobierz('stan:' + k)) || null;
  const wynik = await wywolaj('pobierzWiele', { karty, od }, 90000);
  const czekajace = new Set((await db.kolejka()).map(p => `${p.karta}|${p.klucz}`));
  for (const karta of karty) {
    const dane = wynik[karta];
    if (!dane) continue;
    const klucz = KLUCZE[karta];
    const doZapisu = dane.wiersze.filter(w => !w.ukryty && !czekajace.has(`${karta}|${klucz(w)}`));
    if (pelna || !od[karta]) {
      const zostaw = new Set([...czekajace].filter(k => k.startsWith(karta + '|')).map(k => k.slice(karta.length + 1)));
      await db.wyczyscKarte(karta, zostaw);
    }
    await db.zapiszWiersze(karta, doZapisu, klucz);
    await db.metaZapisz('stan:' + karta, dane.stan);
  }
}

export function synchronizuj({ pelna = false } = {}) {
  if (biezaca) { ponow = true; return biezaca; }
  biezaca = (async () => {
    await odswiezLicznik();
    if (!polaczone()) { ustaw({ tryb: 'brak-ustawien', blad: null }); return; }
    if (!navigator.onLine) { ustaw({ tryb: 'offline', blad: null }); return; }
    ustaw({ tryb: 'praca', blad: null });
    try {
      let bladZapisu = null;
      await wyslijKolejke().catch(e => { if (e instanceof BladApi) bladZapisu = e.message; else throw e; });
      await pobierzZmiany(pelna);
      const teraz = new Date().toISOString();
      await db.metaZapisz('ostatnia', teraz);
      await odswiezLicznik();
      ustaw({ tryb: bladZapisu ? 'blad' : 'ok', ostatnia: teraz, blad: bladZapisu, zmiana: Date.now() });
    } catch (e) {
      await odswiezLicznik();
      ustaw({ tryb: navigator.onLine ? 'blad' : 'offline', blad: e.message, zmiana: Date.now() });
    }
  })().finally(() => {
    biezaca = null;
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
  setInterval(() => { if (document.visibilityState === 'visible') synchronizuj(); }, 90000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchronizuj(); });
  synchronizuj();
}
