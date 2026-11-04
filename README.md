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
Przy nowej wersji podbić WERSJA w `stoisko/sw.js` i `stoisko/js/konfiguracja.js`.
