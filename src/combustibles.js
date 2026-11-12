// Combustibles y sus iconos.
// Los iconos siguen la norma europea EN 16942, la misma etiqueta que llevan los surtidores
// y la tapa del depósito: círculo = gasolina (E5, E10), cuadrado = gasóleo (B7),
// rombo = combustibles gaseosos (LPG, CNG). La forma identifica la familia sin depender del color,
// que queda reservado para el precio (barato / medio / caro). AdBlue no tiene etiqueta EN 16942:
// se dibuja como una gota.
export const COMBUSTIBLES = [
  { k: 'g95', nombre: 'Gasolina 95', corto: '95', sub: 'Gasolina E5', forma: 'circulo', codigo: 'E5' },
  { k: 'diesel', nombre: 'Diésel', corto: 'Diésel', sub: 'Gasóleo A, B7', forma: 'cuadrado', codigo: 'B7' },
  { k: 'g98', nombre: 'Gasolina 98', corto: '98', sub: 'Gasolina E5', forma: 'circulo', codigo: 'E5' },
  { k: 'dieselPlus', nombre: 'Diésel+', corto: 'Diésel+', sub: 'Gasóleo premium, B7', forma: 'cuadrado', codigo: 'B7' },
  { k: 'g95e10', nombre: '95 E10', corto: 'E10', sub: 'Gasolina E10', forma: 'circulo', codigo: 'E10' },
  { k: 'glp', nombre: 'GLP', corto: 'GLP', sub: 'Autogás, LPG', forma: 'rombo', codigo: 'LPG' },
  { k: 'gnc', nombre: 'GNC', corto: 'GNC', sub: 'Gas natural, CNG', forma: 'rombo', codigo: 'CNG' },
  { k: 'adblue', nombre: 'AdBlue', corto: 'AdBlue', sub: 'Aditivo para diésel', forma: 'gota', codigo: '' },
];

export const combustible = (k) => COMBUSTIBLES.find((c) => c.k === k);

const FORMAS = {
  circulo: '<circle cx="16" cy="16" r="14.5"/>',
  cuadrado: '<rect x="2" y="2" width="28" height="28" rx="3.5"/>',
  rombo: '<path d="M16 1.25 30.75 16 16 30.75 1.25 16Z"/>',
  gota: '<path d="M16 2.5c5.6 7.3 10.5 12.7 10.5 18.2a10.5 10.5 0 0 1-21 0C5.5 15.2 10.4 9.8 16 2.5Z"/>',
};

// Etiqueta EN 16942 en SVG (hereda el color del texto). Es decorativa: el nombre va al lado.
export function iconoCombustible(c, clase = 'h-7 w-7') {
  const tam = c.codigo.length >= 3 ? 8.6 : 11;
  const texto = c.codigo
    ? `<text x="16" y="16.5" dominant-baseline="central" text-anchor="middle" font-size="${tam}" font-weight="800" fill="currentColor" stroke="none">${c.codigo}</text>`
    : '';
  return `<svg viewBox="0 0 32 32" class="${clase} shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">${FORMAS[c.forma]}${texto}</svg>`;
}
