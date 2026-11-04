// Szybkie dodawanie kategorii i podkategorii prosto z formularza „Dodaj” i z importu wyciągu.

import { $, esc, uuid, toast, okno } from './util.js';
import { dane, wczytajDane, glowne, podrzedne, listaKategorii, KOLORY } from './dane.js';
import * as sync from './sync.js';

/**
 * Okno „Nowa kategoria”. typ: 'wydatek' albo 'wpływ'; rodzic: nazwa kategorii głównej, gdy dodajemy podkategorię.
 * Zwraca { kategoria, podkategoria } albo null, gdy anulowano.
 */
export async function nowaKategoria(typ, rodzic = '') {
  const gl = glowne(typ);
  const tak = await okno(typ === 'wpływ' ? 'Nowe źródło przychodu' : 'Nowa kategoria', `
    <label class="pole"><span class="etykieta">Nazwa</span><input name="nk-nazwa" autocomplete="off" autofocus></label>
    <label class="pole"><span class="etykieta">Gdzie dodać</span>
      <select name="nk-rodzic"><option value="">jako ${typ === 'wpływ' ? 'nowe źródło przychodu' : 'nową kategorię główną'}</option>${gl.map(k =>
        `<option value="${esc(k.id)}" ${k.nazwa === rodzic ? 'selected' : ''}>jako podkategorię „${esc(k.nazwa)}”</option>`).join('')}</select></label>`,
    [{ etykieta: 'Anuluj', wartosc: false, klasa: 'drugorzedny' }, { etykieta: 'Dodaj', wartosc: true }]);
  if (!tak) return null;
  const nazwa = String($('#okno [name="nk-nazwa"]')?.value || '').trim();
  const rodzicId = $('#okno [name="nk-rodzic"]')?.value || '';
  if (!nazwa) { toast('Wpisz nazwę.', 'blad'); return null; }
  const lista_ = listaKategorii(typ);
  const nadrzedna = gl.find(k => k.id === rodzicId);

  if (nadrzedna) {
    const jest = podrzedne(typ, nadrzedna.nazwa, true).find(p => p.nazwa.toLowerCase() === nazwa.toLowerCase());
    if (jest) return { kategoria: nadrzedna.nazwa, podkategoria: jest.nazwa };
    await sync.zapisz('SLOWNIK', [{
      lista: lista_, id: `${nadrzedna.id}-${uuid().slice(0, 6)}`, nazwa, rodzic: nadrzedna.id, atrybuty: '{}', aktywna: true,
      kolejnosc: podrzedne(typ, nadrzedna.nazwa, true).length + 1,
    }]);
    await wczytajDane();
    toast(`Dodano podkategorię „${nazwa}” w „${nadrzedna.nazwa}”.`, 'ok');
    return { kategoria: nadrzedna.nazwa, podkategoria: nazwa };
  }
  const jest = gl.find(k => k.nazwa.toLowerCase() === nazwa.toLowerCase());
  if (jest) return { kategoria: jest.nazwa, podkategoria: '' };
  await sync.zapisz('SLOWNIK', [{
    lista: lista_, id: (typ === 'wpływ' ? 'ZP-' : 'KK-') + uuid().slice(0, 8), nazwa, rodzic: '',
    atrybuty: JSON.stringify({ kolor: KOLORY[gl.length % KOLORY.length] }), aktywna: true, kolejnosc: gl.length + 1,
  }]);
  await wczytajDane();
  toast(`Dodano ${typ === 'wpływ' ? 'źródło przychodu' : 'kategorię'} „${nazwa}”.`, 'ok');
  return { kategoria: nazwa, podkategoria: '' };
}
