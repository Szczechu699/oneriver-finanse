// Stałe aplikacji stoiska. Dane do płatności są domyślne dla wszystkich urządzeń;
// na danym urządzeniu można je zmienić w Ustawieniach.

export const WERSJA = '0.1.0';
export const WYMAGANE_API = 6;

export const PLATNOSC_DOMYSLNA = {
  odbiorca: 'Darius',
  konto: '96 1140 2004 0000 3402 7777 2198',
  blik: '739 001 013',
};

// [wartość w kolumnie forma_platnosci, etykieta na przycisku]
export const FORMY = [
  ['Przelew', 'Przelew'],
  ['BLIK', 'BLIK na telefon'],
  ['Gotówka', 'Gotówka'],
  ['Karta', 'Karta'],
];
// Formy, przy których klient płaci później – SMS zawiera dane do płatności.
export const PLATNE_POZNIEJ = new Set(['Przelew', 'BLIK']);

export const STATUSY = {
  czeka: 'czeka na płatność',
  oplacone: 'opłacone',
  anulowane: 'anulowane',
};

export const PODMIOTY = ['INCO', 'OFI'];

// Karty arkusza: zapisywane przez stoisko i pobierane tylko do odczytu (cennik z Subiekta).
export const KARTY_ZAPIS = ['ZAMOWIENIA', 'ZAMOWIENIA_POZ', 'KLIENCI'];
export const KARTY_ODCZYT = ['SPRZEDAZ_SGT', 'SPRZEDAZ_SGT_POZ'];
