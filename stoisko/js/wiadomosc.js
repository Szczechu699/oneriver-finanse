// Treść podsumowania dla klienta oraz linki otwierające SMS i WhatsApp z gotową wiadomością.
// Wiadomość wysyła sprzedawca z telefonu – SMS działa także bez internetu (przez sieć komórkową).

import { ustawienia } from './api.js';
import { PLATNE_POZNIEJ } from './konfiguracja.js';
import { kwotaTxt, iloscTxt, num } from './util.js';
import { telefonE164 } from './dane.js';

const MAKS_POZYCJI = 8;

export function trescWiadomosci(zam, pozycje) {
  const { platnosc } = ustawienia();
  const linie = [`ONE RIVER – zamówienie ${zam.id}`, ''];
  pozycje.slice(0, MAKS_POZYCJI).forEach(p => {
    const ilosc = num(p.ilosc);
    linie.push(`${p.nazwa}: ${ilosc === 1 ? '' : iloscTxt(ilosc) + ' × '}${kwotaTxt(num(p.cena))}`);
  });
  if (pozycje.length > MAKS_POZYCJI) linie.push(`…i jeszcze ${pozycje.length - MAKS_POZYCJI} poz.`);
  if (zam.dostawa) {
    const koszt = num(zam.koszt_dostawy);
    linie.push(`Dostawa – ${zam.dostawa}: ${koszt ? kwotaTxt(koszt) : 'gratis'}`);
    if (zam.adres_dostawy) linie.push(`Adres: ${String(zam.adres_dostawy).replace(/\s*\n\s*/g, ', ')}`);
  }
  linie.push(`Razem: ${kwotaTxt(num(zam.suma_brutto))}`, '');

  if (PLATNE_POZNIEJ.has(zam.forma_platnosci)) {
    linie.push('Płatność:');
    if (platnosc.konto) linie.push(`• przelew: ${platnosc.odbiorca}, nr konta ${platnosc.konto}`);
    if (platnosc.blik) linie.push(`• BLIK na telefon: ${platnosc.blik}`);
    linie.push(`Tytuł: ${zam.id}`);
  } else {
    linie.push(`Zapłacono: ${String(zam.forma_platnosci || '').toLowerCase()}.`);
  }
  linie.push('', 'Dziękujemy! oneriver.pl');
  return linie.join('\n');
}

const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mobilne = () => ios() || /Android/i.test(navigator.userAgent);

/** sms: – iOS przyjmuje treść po „&body=”, Android po „?body=”. */
export function linkSms(telefon, tresc) {
  const nr = telefonE164(telefon);
  return `sms:${nr}${ios() ? '&' : '?'}body=${encodeURIComponent(tresc)}`;
}

/** Na telefonie i tablecie otwiera aplikację WhatsApp bezpośrednio (działa też bez internetu – wiadomość czeka w WhatsAppie). */
export function linkWhatsApp(telefon, tresc) {
  const cyfry = telefonE164(telefon).replace('+', '');
  return mobilne()
    ? `whatsapp://send?phone=${cyfry}&text=${encodeURIComponent(tresc)}`
    : `https://wa.me/${cyfry}?text=${encodeURIComponent(tresc)}`;
}

/** Wiadomość dla osoby wysyłającej (grupa ZAMÓWIENIA na Messengerze albo WhatsApp). */
export function trescDlaWysylki(zam, pozycje, klient) {
  const d = String(zam.data || '').slice(0, 10);
  const data = d ? new Date(d + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '';
  const linie = [`Zamówienie ${zam.id} – do wysyłki`, `Klient: ${klient?.nazwa || '—'}${klient?.telefon ? ', tel. ' + klient.telefon : ''}`, `Data: ${data}`, '', 'Produkty:'];
  pozycje.forEach(p => linie.push(`• ${p.nazwa} × ${iloscTxt(num(p.ilosc))} – ${kwotaTxt(num(p.wartosc))}`));
  if (zam.dostawa) linie.push(`Dostawa: ${zam.dostawa}${zam.adres_dostawy ? ' (' + String(zam.adres_dostawy).replace(/\s*\n\s*/g, ', ') + ')' : ''} – ${kwotaTxt(num(zam.koszt_dostawy))}`);
  linie.push(`Razem z wysyłką: ${kwotaTxt(num(zam.suma_brutto))}`);
  if (zam.kod_nadania) linie.push(`Kod nadania InPost: ${zam.kod_nadania}`);
  if (zam.realizuje) linie.push(`Wysyła: ${zam.realizuje}`);
  if (zam.uwagi) linie.push(`Uwagi: ${zam.uwagi}`);
  return linie.join('\n');
}

/** WhatsApp bez numeru – otwiera wybór czatu (np. grupy) z gotową wiadomością. */
export const linkWhatsAppDoGrupy = tresc => `https://wa.me/?text=${encodeURIComponent(tresc)}`;

/** Otwiera link przez kliknięcie w niewidoczny odnośnik – działa z aplikacjami SMS i WhatsApp na telefonach. */
export function otworzLink(href) {
  const a = document.createElement('a');
  a.href = href;
  if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; }
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
