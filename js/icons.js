// Íconos de línea (16px, heredan el color del texto). Mismo estilo que Analytics Counter.
const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  partidos: svg('<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  tabla: svg('<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v16"/>'),
  lideres: svg('<path d="M8 21V11M12 21V4M16 21v-7"/><path d="M4 21h16"/>'),
  goleadores: svg('<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10z"/><path d="M12 3v4M21 10.5l-5 -.5M17.5 19l-3-4.5M6.5 19l3-4.5M3 10.5l5-.5"/>'),
  ranking: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4M8 21h8M9 17h6"/>'),
  buscar: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  cerrar: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

// Logo de Frelytics: un marcador con dos barras, en el color del deporte activo
export const BRAND_MARK = `
  <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
    <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="none" stroke="currentColor" stroke-width="3"/>
    <rect x="8" y="9" width="5" height="14" rx="1.5" fill="currentColor"/>
    <rect x="15.5" y="14" width="5" height="9" rx="1.5" fill="currentColor" opacity=".55"/>
    <path d="M23 9.5 l3 3 -3 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
