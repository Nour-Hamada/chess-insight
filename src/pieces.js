// Original, high-contrast pieces inspired by classic flat chess sets.
// All artwork is local SVG so it remains crisp at every board size.
const SHAPES = {
  p: '<circle cx="50" cy="25" r="12"/><path d="M21 83c0-10 6-15 16-19-2-3-3-6-3-9 0-9 7-16 16-16s16 7 16 16c0 3-1 6-3 9 10 4 16 9 16 19v3H21z"/>',
  r: '<path d="M27 26 24 10q0-3 3-3h7l2 9h8l1-9h10l1 9h8l2-9h7q3 0 3 3l-3 16-5 6 4 41H28l4-41z"/><path d="M21 84c0-8 4-11 12-11h34c8 0 12 3 12 11v3H21z"/>',
  n: '<path d="M25 80c1-13 8-19 18-23-2-4-2-8 0-12-6 5-12 6-17 4l-5 3c-3 1-8-3-9-7-1-2 0-4 3-7 10-10 15-18 18-28l5-3 6 8c23 2 38 21 37 46l-2 19z"/><path d="M22 84c0-8 4-11 12-11h35c8 0 12 3 12 11v3H22z"/>',
  b: '<circle cx="50" cy="11" r="7"/><path d="M47 17c-9 7-17 17-17 30 0 9 3 15 9 19h22c6-4 9-10 9-19 0-13-8-23-17-30z"/><path d="M18 69h64l-4 17H58l-8-6-8 6H22z"/><path d="M53 24c-3 7-5 15-5 23" fill="none"/>',
  q: '<path d="M28 70 19 29 31 51 35 23l10 27 5-30 5 30 10-27 4 28 12-22-9 41z"/><circle cx="18" cy="26" r="6"/><circle cx="35" cy="19" r="6"/><circle cx="50" cy="15" r="6"/><circle cx="65" cy="19" r="6"/><circle cx="82" cy="26" r="6"/><path d="M22 84c0-9 4-13 12-13h32c8 0 12 4 12 13v3H22z"/>',
  k: '<path d="M50 20c-3-4-7-9-7-13a7 7 0 0 1 14 0c0 4-4 9-7 13z"/><path d="M29 70c-2-9-8-14-13-21-6-8-6-18 0-23 8-7 19-2 34 11 15-13 26-18 34-11 6 5 6 15 0 23-5 7-11 12-13 21z"/><path d="m27 41 8 8m38-8-8 8" fill="none" stroke-width="6"/><path d="M22 84c0-9 4-13 12-13h32c8 0 12 4 12 13v3H22z"/>'
};

export function getPieceSvg(color, type) {
  const shape = SHAPES[type];
  if (!shape || (color !== 'w' && color !== 'b')) return '';
  const fill = color === 'w' ? '#f7f7f7' : '#555758';
  const shade = color === 'w' ? '#d4d4d4' : '#393b3c';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><defs><clipPath id="piece-shade-${color}-${type}"><path d="M61 0H100V100H55c11-20 18-40 6-100z"/></clipPath></defs><g fill="${fill}" stroke="#171717" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${shape}</g><g fill="${shade}" stroke="none" opacity=".7" clip-path="url(#piece-shade-${color}-${type})">${shape}</g><g fill="none" stroke="#171717" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${shape}</g></svg>`;
}
