// Lokalna baza stoiska (IndexedDB): kopie kart arkusza, kolejka wysyłki, ustawienia techniczne.
// Osobna od bazy aplikacji Finanse, nawet gdy obie działają na tym samym urządzeniu.

const NAZWA = 'oneriver-stoisko';
const WERSJA_BAZY = 1;
let polaczenie = null;

function otworz() {
  if (!polaczenie) {
    polaczenie = new Promise((ok, blad) => {
      const r = indexedDB.open(NAZWA, WERSJA_BAZY);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('wiersze')) {
          const s = db.createObjectStore('wiersze', { keyPath: ['karta', 'klucz'] });
          s.createIndex('karta', 'karta');
        }
        if (!db.objectStoreNames.contains('kolejka')) db.createObjectStore('kolejka', { keyPath: 'nr', autoIncrement: true });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => blad(r.error);
    });
  }
  return polaczenie;
}

const zadanie = r => new Promise((ok, blad) => { r.onsuccess = () => ok(r.result); r.onerror = () => blad(r.error); });

async function transakcja(magazyny, tryb, fn) {
  const db = await otworz();
  return new Promise((ok, blad) => {
    const t = db.transaction(magazyny, tryb);
    let wynik;
    Promise.resolve(fn(t)).then(w => { wynik = w; }, blad);
    t.oncomplete = () => ok(wynik);
    t.onerror = () => blad(t.error);
    t.onabort = () => blad(t.error || new Error('Przerwano zapis w pamięci urządzenia.'));
  });
}

export const wiersze = karta => transakcja(['wiersze'], 'readonly', async t =>
  (await zadanie(t.objectStore('wiersze').index('karta').getAll(karta))).map(r => r.dane));

export async function zapiszWiersze(karta, lista, kluczFn) {
  if (!lista.length) return;
  return transakcja(['wiersze'], 'readwrite', t => {
    const s = t.objectStore('wiersze');
    lista.forEach(dane => s.put({ karta, klucz: kluczFn(dane), dane }));
  });
}

export const wyczyscKarte = (karta, zostaw = new Set()) => transakcja(['wiersze'], 'readwrite', async t => {
  const s = t.objectStore('wiersze');
  const klucze = await zadanie(s.index('karta').getAllKeys(karta));
  klucze.forEach(k => { if (!zostaw.has(k[1])) s.delete(k); });
});

/** Zapis wierszy kilku kart i ich kolejki w jednej transakcji – albo wszystko, albo nic. */
export const zapiszZKolejka = paczki => transakcja(['wiersze', 'kolejka'], 'readwrite', t => {
  const w = t.objectStore('wiersze');
  const k = t.objectStore('kolejka');
  const dodano = Date.now();
  paczki.forEach(({ karta, wiersze: lista, klucz }) => lista.forEach(dane => {
    w.put({ karta, klucz: klucz(dane), dane });
    k.add({ karta, klucz: klucz(dane), wiersz: dane, dodano });
  }));
});

export const kolejka = () => transakcja(['kolejka'], 'readonly', t => zadanie(t.objectStore('kolejka').getAll()));
export const kolejkaUsun = numery => transakcja(['kolejka'], 'readwrite', t => {
  const s = t.objectStore('kolejka');
  numery.forEach(n => s.delete(n));
});

export const metaPobierz = klucz => transakcja(['meta'], 'readonly', t => zadanie(t.objectStore('meta').get(klucz)));
export const metaZapisz = (klucz, wartosc) => transakcja(['meta'], 'readwrite', t => { t.objectStore('meta').put(wartosc, klucz); });

export const wyczyscWszystko = () => transakcja(['wiersze', 'kolejka', 'meta'], 'readwrite', t => {
  ['wiersze', 'kolejka', 'meta'].forEach(n => t.objectStore(n).clear());
});
