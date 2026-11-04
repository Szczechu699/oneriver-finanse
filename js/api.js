// Połączenie z API arkusza (Apps Script). Adres, token i nazwa osoby są zapisane tylko na tym urządzeniu.

const KLUCZ_USTAWIEN = 'or-finanse-ustawienia';

export function ustawienia() {
  try {
    return JSON.parse(localStorage.getItem(KLUCZ_USTAWIEN)) || {};
  } catch {
    return {};
  }
}

export function zapiszUstawienia(u) {
  localStorage.setItem(KLUCZ_USTAWIEN, JSON.stringify(u));
}

export function skonfigurowane() {
  const u = ustawienia();
  return Boolean(u.url && u.token);
}

export class BladApi extends Error {}

export async function wywolaj(akcja, dane = {}, limitMs = 45000) {
  const { url, token } = ustawienia();
  if (!url || !token) throw new BladApi('Brak adresu API lub tokenu. Uzupełnij je w Ustawieniach.');
  const przerwij = new AbortController();
  const zegar = setTimeout(() => przerwij.abort(), limitMs);
  let odp;
  try {
    odp = await fetch(url, {
      method: 'POST',
      // text/plain nie wymaga zapytania wstępnego CORS, które Apps Script odrzuca
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...dane, token, akcja }),
      redirect: 'follow',
      signal: przerwij.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Arkusz nie odpowiedział w ciągu ' + Math.round(limitMs / 1000) + ' s.');
    throw new Error('Brak połączenia z arkuszem.');
  } finally {
    clearTimeout(zegar);
  }
  if (!odp.ok) throw new Error('Arkusz odpowiedział błędem ' + odp.status + '.');
  let json;
  try {
    json = await odp.json();
  } catch {
    throw new BladApi('Odpowiedź nie pochodzi z API aplikacji. Sprawdź adres w Ustawieniach.');
  }
  if (json.wersja) {
    try { localStorage.setItem('or-finanse-wersja-api', String(json.wersja)); } catch { /* bez znaczenia */ }
  }
  if (json.uzytkownik) {
    try { localStorage.setItem('or-finanse-uzytkownik', JSON.stringify(json.uzytkownik)); } catch { /* bez znaczenia */ }
  }
  if (!json.ok) throw new BladApi(json.blad || 'Nieznany błąd API.');
  return json.dane;
}

/** Użytkownik tokenu z ostatniej odpowiedzi API: { nazwa, prywatne } (starsze API: brak = pełny dostęp). */
export function uzytkownik() {
  try { return JSON.parse(localStorage.getItem('or-finanse-uzytkownik')) || null; } catch { return null; }
}
export const mozePrywatne = () => uzytkownik()?.prywatne !== false;

export function wersjaApi() {
  try { return Number(localStorage.getItem('or-finanse-wersja-api')) || 0; } catch { return 0; }
}
