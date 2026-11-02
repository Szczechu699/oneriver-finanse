// Lokalna baza w przeglądarce (IndexedDB): kopie kart arkusza, kolejka wysyłki, ustawienia techniczne.

const NAZWA = 'oneriver-finanse';
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
        if (!db.objectStoreNames.contains('kolejka')) {
          db.createObjectStore('kolejka', { keyPath: 'nr', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => blad(r.error);
    });
  }
  return polaczenie;
}

function zadanie(r) {
  return new Promise((ok, blad) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => blad(r.error);
  });
}

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

export async function wiersze(karta) {
  return transakcja(['wiersze'], 'readonly', async t => {
    const lista = await zadanie(t.objectStore('wiersze').index('karta').getAll(karta));
    return lista.map(r => r.dane);
  });
}

export async function zapiszWiersze(karta, lista, kluczFn) {
  if (!lista.length) return;
  return transakcja(['wiersze'], 'readwrite', t => {
    const s = t.objectStore('wiersze');
    lista.forEach(dane => s.put({ karta, klucz: kluczFn(dane), dane }));
  });
}

export async function wyczyscKarte(karta, zostaw = new Set()) {
  return transakcja(['wiersze'], 'readwrite', async t => {
    const s = t.objectStore('wiersze');
    const klucze = await zadanie(s.index('karta').getAllKeys(karta));
    klucze.forEach(k => { if (!zostaw.has(k[1])) s.delete(k); });
  });
}

export async function kolejkaDodaj(karta, klucz, wiersz) {
  return transakcja(['kolejka'], 'readwrite', t => {
    t.objectStore('kolejka').add({ karta, klucz, wiersz, dodano: Date.now() });
  });
}

export async function kolejka() {
  return transakcja(['kolejka'], 'readonly', t => zadanie(t.objectStore('kolejka').getAll()));
}

export async function kolejkaAktualizuj(pozycje) {
  return transakcja(['kolejka'], 'readwrite', t => {
    const s = t.objectStore('kolejka');
    pozycje.forEach(p => s.put(p));
  });
}

export async function kolejkaUsun(numery) {
  return transakcja(['kolejka'], 'readwrite', t => {
    const s = t.objectStore('kolejka');
    numery.forEach(n => s.delete(n));
  });
}

export async function metaPobierz(klucz) {
  return transakcja(['meta'], 'readonly', t => zadanie(t.objectStore('meta').get(klucz)));
}

export async function metaZapisz(klucz, wartosc) {
  return transakcja(['meta'], 'readwrite', t => { t.objectStore('meta').put(wartosc, klucz); });
}

export async function wyczyscWszystko() {
  return transakcja(['wiersze', 'kolejka', 'meta'], 'readwrite', t => {
    t.objectStore('wiersze').clear();
    t.objectStore('kolejka').clear();
    t.objectStore('meta').clear();
  });
}
