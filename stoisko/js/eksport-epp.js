// Eksport zamówień do pliku EPP dla Subiekta GT (Operacje → Odbierz z… → Plik EDI++ → „Dodaj na podstawie”).
// Subiekt nadaje własny numer paragonu; numer zamówienia ze Stoiska trafia do Uwag paragonu.

import { dane, klient, pozycjeZamowienia, produktSymbolu, telefonE164 } from './dane.js';
import { platnosciZamowienia } from './wiadomosc.js';
import { ustawienia } from './api.js';
import { czyTransport, SYMBOL_TRANSPORTU, STATUSY } from './konfiguracja.js';
import { trescEpp, naCp1250, FIRMA_INCO } from './epp.js';
import { num, dataLok } from './util.js';
import * as sync from './sync.js';

const FIRMY = { INCO: FIRMA_INCO, OFI: { ...FIRMA_INCO, symbol: 'OFI', nazwa: 'OFI_OneRiver' } };
const VAT = 23; // wszystkie pozycje cennika mają 23% (sprawdzone w „Cennik OneRiver”)

const symbolKontrahenta = k => {
  const tel = telefonE164(k.telefon);
  if (tel) return ('ST' + tel.replace(/\D/g, '')).slice(0, 20);
  return ('ST' + String(k.id).replace(/[^A-Za-z0-9]/g, '')).slice(0, 20);
};

function adres(k) {
  const a = String(k.adres || '').replace(/\s*\n\s*/g, ', ').trim();
  // adres paczkomatu (np. „WAWR01BAPP, Wawrochy 5d, …”) to nie adres klienta
  if (/^[A-Z]{3,}\d{2,}[A-Z0-9]*\b/.test(a)) return { ulica: '', kod: '', miasto: '' };
  const m = /^(.*?)[,\s]*(\d{2}-\d{3})\s+(.+)$/.exec(a);
  return m ? { ulica: m[1].trim(), kod: m[2], miasto: m[3].trim() } : { ulica: a, kod: '', miasto: '' };
}

/** Zamówienie → dokument dla generatora EPP albo komunikat, dlaczego się nie da. */
export function dokumentZamowienia(z) {
  if (z.status === STATUSY.anulowane) return { blad: `${z.id}: zamówienie anulowane.` };
  const poz = pozycjeZamowienia(z.id);
  if (!poz.length) return { blad: `${z.id}: brak pozycji.` };
  const bezSymbolu = poz.filter(p => !String(p.symbol || '').trim());
  if (bezSymbolu.length) return { blad: `${z.id}: pozycja spoza cennika („${bezSymbolu[0].nazwa}”) – dodaj ten paragon w Subiekcie ręcznie.` };

  const pozycje = poz.map(p => {
    const ilosc = num(p.ilosc) || 1;
    const cena = Math.round((num(p.wartosc) / ilosc || num(p.cena)) * 100) / 100;
    if (czyTransport(p.symbol)) return { symbol: SYMBOL_TRANSPORTU, nazwa: 'Transport', typ: 'usługa', jm: 'szt.', ilosc, cena, vat: VAT, cenaCennik: cena };
    const k = produktSymbolu(p.symbol);
    return { symbol: String(p.symbol), nazwa: k?.nazwa || p.nazwa, typ: k?.rodzaj || 'towar', grupa: k?.grupa || '', jm: p.jm || k?.jm || 'szt.',
      ilosc, cena, vat: VAT, cenaCennik: num(p.cena_cennik) || k?.cena || cena };
  });

  const pl = { gotowka: 0, karta: 0 };
  platnosciZamowienia(z).forEach(p => {
    if (p.forma === 'Gotówka') pl.gotowka += p.kwota;
    else if (p.forma === 'Karta') pl.karta += p.kwota;
  });
  const opisPl = platnosciZamowienia(z).map(p => `${p.forma} ${p.kwota.toFixed(2)}${p.zaplacone ? '' : ' (czeka)'}`).join(', ');

  const kl = klient(z.klient_id);
  const kontrahent = kl ? { symbol: symbolKontrahenta(kl), nazwa: kl.nazwa || telefonE164(kl.telefon) || 'Klient Stoiska',
    telefon: kl.telefon || '', email: kl.email || '', ...adres(kl) } : null;
  const data = new Date(String(z.data || dataLok()).slice(0, 10) + 'T12:00:00');
  const uwagi = [`Stoisko ${z.id}`, z.wydarzenie, z.nr_przesylki ? `InPost ${z.nr_przesylki}` : '', opisPl].filter(Boolean).join(' - ');

  return { dokument: {
    numer: Number(String(z.id).split('-').pop()) || 1, pelnyNumer: String(z.id), numerZamowienia: String(z.id), data,
    miejsce: 'Warszawa', kategoria: 'Detal', podtytul: 'Sprzedaz detaliczna', wystawca: ustawienia().kto || 'Stoisko',
    terminDni: 7, uwagi: uwagi.slice(0, 255), kontrahent, platnosci: pl, pozycje,
  }, podmiot: String(z.podmiot || 'INCO').toUpperCase() === 'OFI' ? 'OFI' : 'INCO' };
}

function pobierzPlik(nazwa, bajty) {
  const url = URL.createObjectURL(new Blob([bajty], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = nazwa; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Tworzy plik(i) EPP z podanych zamówień (osobny plik dla każdego podmiotu), pobiera je
 * i zapisuje w zamówieniach datę eksportu (kolumna epp_eksport).
 * Zwraca { wyeksportowane: [id], bledy: [tekst] }.
 */
export async function eksportujEpp(ids) {
  const grupy = new Map(), bledy = [], ok = [];
  ids.map(id => dane.zamowienia.find(z => String(z.id) === String(id))).filter(Boolean)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.id).localeCompare(String(b.id), 'pl', { numeric: true })).forEach(z => {
    const w = dokumentZamowienia(z);
    if (w.blad) { bledy.push(w.blad); return; }
    if (!grupy.has(w.podmiot)) grupy.set(w.podmiot, []);
    grupy.get(w.podmiot).push(w.dokument);
    ok.push(z);
  });
  if (!ok.length) return { wyeksportowane: [], bledy };
  const kiedy = new Date();
  const znacznik = `${dataLok()}_${String(kiedy.getHours()).padStart(2, '0')}${String(kiedy.getMinutes()).padStart(2, '0')}`;
  grupy.forEach((dok, podmiot) => {
    const nazwa = dok.length === 1 ? `Stoisko_${dok[0].pelnyNumer}.epp` : `Stoisko_${podmiot}_${znacznik}_${dok.length}szt.epp`;
    pobierzPlik(nazwa, naCp1250(trescEpp(FIRMY[podmiot], dok, kiedy)));
  });
  await sync.zapisz([{ karta: 'ZAMOWIENIA', wiersze: ok.map(z => ({ ...z, epp_eksport: kiedy.toISOString() })) }]);
  return { wyeksportowane: ok.map(z => z.id), bledy };
}
