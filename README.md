# One River – Finanse

Aplikacja finansowa ONE RIVER sp. z o.o. (PWA na tablet, praca offline).

- Baza danych: arkusz Google „One River – Finanse” przez API w Apps Script (token).
- Sprzedaż pochodzi z Subiekta GT (INCO i OFI); aplikacja jej nie księguje.
- Moduły: transakcje ręczne, import wyciągów (mBank, Revolut, PayPal), rozliczenia zamówień z wpływami,
  transakcje planowane i subskrypcje, zamówienia z tabletu, raporty.

Szczegóły: brief projektu „Aplikacja finansowa One River – brief projektu”.

## One River Stoisko (`/stoisko/`)

Osobna aplikacja na tablet/telefon przy stoisku: rejestr sprzedaży z cennikiem z Subiekta (cena po rabacie),
numery zamówień KOD-ROK-NNNN (każde urządzenie ma własny kod), praca bez internetu, podsumowanie dla klienta
przez SMS albo WhatsApp z danymi do płatności. Zapisuje do kart ZAMOWIENIA, ZAMOWIENIA_POZ i KLIENCI tego samego arkusza.
Od 0.2.0: katalog z karty KATALOG (przepisywanej przez skrypt arkusza z „Cennik OneRiver”), warianty gramatur
i rozmiarów, ceny klientów (grupa cenowa, rabat, ceny specjalne), dostawa, ekrany Klienci i Sklep (wysyłki, grupy),
potwierdzanie zamówień z formularza. Od 0.3.0: poziomy cen detal/hurt (Rapé, Zielarnia), stany magazynowe,
kod nadania InPost, osoba wysyłająca i przekazanie zamówienia przez Messenger/WhatsApp. Przy nowej wersji podbić WERSJA w `stoisko/sw.js` i `stoisko/js/konfiguracja.js`.

## Formularz zamówień dla klientów (`/zamow/`)

Publiczna strona na wzór sklepu oneriver.pl: oferta z karty KATALOG, kod klienta (ceny specjalne), koszyk, dostawa.
Korzysta z publicznych akcji skryptu arkusza (`sklep`, `zamow`, wersja 7) – bez tokenu; ceny liczy skrypt.
Zamówienie trafia do ZAMOWIENIA ze statusem „nowe” (numer W-RRRR-NNNN) i czeka na potwierdzenie w Stoisku.
