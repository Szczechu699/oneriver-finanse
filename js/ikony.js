// Proste ikony liniowe (24×24), rysowane kolorem tekstu.

const SCIEZKI = {
  dodaj: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  lista: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  planowane: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h6"/>',
  subskrypcje: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  pozyczki: '<path d="M3 8h13l-3-3M21 16H8l3 3"/>',
  budzety: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  dane: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  ustawienia: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  wiecej: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  filtr: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  szukaj: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  konta: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>',
  kategorie: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><circle cx="17.5" cy="7.5" r="3.5"/><path d="M4 20l3.5-6 3.5 6z"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tytuly: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  cele: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
};

export const ikonaSvg = (nazwa, klasa = 'ik') =>
  `<svg class="${klasa}" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SCIEZKI[nazwa] || ''}</svg>`;
