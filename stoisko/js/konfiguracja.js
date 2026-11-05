// Stałe aplikacji stoiska. Dane do płatności są domyślne dla wszystkich urządzeń;
// na danym urządzeniu można je zmienić w Ustawieniach.

export const WERSJA = '0.2.0';
export const WYMAGANE_API = 7;

// Publiczny formularz zamówień dla klientów (link do wysłania klientowi).
export const ADRES_FORMULARZA = 'https://szczechu699.github.io/oneriver-finanse/zamow/';

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
  nowe: 'nowe',                     // z formularza klienta – czeka na Twoje potwierdzenie
  czeka: 'czeka na płatność',
  oplacone: 'opłacone',
  anulowane: 'anulowane',
};

export const PODMIOTY = ['INCO', 'OFI'];

export const ETYKIETY_STATUSOW = { nowe: 'do potwierdzenia' };

// Kolejność kategorii jak w sklepie oneriver.pl.
export const KOLEJNOSC_KATEGORII = ['Rapé', 'Akcesoria do rapé', 'Zielarnia i olejki', 'Biżuteria', 'Odzież', 'Wystrój wnętrz i inne', 'Instrumenty etniczne'];

// Gotowe metody wysyłki do szybkiego dodania (ceny uzupełniasz sam).
export const PRZYKLADOWE_WYSYLKI = [
  { nazwa: 'Paczkomat InPost', opis: 'Podaj numer paczkomatu, np. WAW123M', wymaga_adresu: true },
  { nazwa: 'Kurier', opis: 'Dostawa pod wskazany adres', wymaga_adresu: true },
  { nazwa: 'Odbiór osobisty – Elsterska 10, Warszawa', opis: '', wymaga_adresu: false },
  { nazwa: 'Wysyłka zagraniczna', opis: 'Podaj pełny adres z krajem', wymaga_adresu: true },
];
