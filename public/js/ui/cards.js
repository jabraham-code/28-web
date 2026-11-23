// Vector playing cards drawn in SVG. No images.
import { rankOf, suitOf, isRed, pointsOf, cardName, RANK_LABEL, h } from './util.js';

const SUIT_PATHS = {
  // all drawn in a 100x100 box
  H: '<path d="M50 92C47 88 8 62 4 36 1 18 13 5 28 5c10 0 18 6 22 15 4-9 12-15 22-15 15 0 27 13 24 31-4 26-43 52-46 56z"/>',
  D: '<path d="M50 3C60 21 74 37 90 50 74 63 60 79 50 97 40 79 26 63 10 50 26 37 40 21 50 3z"/>',
  S: '<path d="M50 4C46 12 6 38 6 62c0 15 11 25 24 25 8 0 14-3 17-8-1 7-5 14-13 17v1h32v-1c-8-3-12-10-13-17 3 5 9 8 17 8 13 0 24-10 24-25C94 38 54 12 50 4z"/>',
  C: '<path d="M50 6a21 21 0 0 0-17 33 21 21 0 1 0 14 34c-1 9-5 18-13 23v1h32v-1c-8-5-12-14-13-23a21 21 0 1 0 14-34A21 21 0 0 0 50 6z"/>',
};

let spriteInstalled = false;
export function installSuitSprite() {
  if (spriteInstalled) return;
  spriteInstalled = true;
  const symbols = Object.entries(SUIT_PATHS)
    .map(([s, p]) => `<symbol id="suit-${s}" viewBox="0 0 100 100">${p}</symbol>`)
    .join('');
  const div = document.createElement('div');
  div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="cardFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#f3efe4"/></linearGradient>
    <linearGradient id="courtR" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde7e4"/><stop offset="1" stop-color="#f8d3cf"/></linearGradient>
    <linearGradient id="courtB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e6ecf2"/><stop offset="1" stop-color="#d4dde6"/></linearGradient>
    <linearGradient id="goldG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7dc95"/><stop offset="1" stop-color="#c8963e"/></linearGradient>
    ${symbols}</defs></svg>`;
  document.body.prepend(div.firstElementChild);
}

/** Inline SVG suit icon for UI text. */
export function suitIcon(s, cls = '') {
  return `<svg class="suit-ico ${isRed(s) ? 'red' : 'black'} ${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#suit-${s}"/></svg>`;
}

const pip = (s, x, y, size, flip = false) => {
  const hs = size / 2;
  const t = flip ? ` transform="rotate(180 ${x} ${y})"` : '';
  return `<use href="#suit-${s}" x="${x - hs}" y="${y - hs}" width="${size}" height="${size}"${t}/>`;
};

// pip layouts in the 100x140 card
const L = 33, C = 50, R = 67;
const LAYOUTS = {
  7: [[L, 30], [R, 30], [C, 50], [L, 70], [R, 70], [L, 110], [R, 110]],
  8: [[L, 30], [R, 30], [C, 50], [L, 70], [R, 70], [C, 90], [L, 110], [R, 110]],
  9: [[L, 28], [R, 28], [L, 56], [R, 56], [C, 70], [L, 84], [R, 84], [L, 112], [R, 112]],
  T: [[L, 28], [R, 28], [C, 43], [L, 56], [R, 56], [L, 84], [R, 84], [C, 97], [L, 112], [R, 112]],
};

const cache = new Map();

export function cardSVG(card) {
  if (cache.has(card)) return cache.get(card);
  const r = rankOf(card), s = suitOf(card);
  const red = isRed(s);
  const ink = red ? '#c62839' : '#17202a';
  const label = RANK_LABEL[r] || r;
  const pts = pointsOf(card);
  const corner = `
    <text x="11" y="${label.length > 1 ? 23 : 24}" text-anchor="middle" class="idx" ${label.length > 1 ? 'textLength="17" lengthAdjust="spacingAndGlyphs" font-size="19"' : 'font-size="22"'} fill="${ink}">${label}</text>
    ${pip(s, 11, 34, 13)}`;
  const badge = pts
    ? `<g class="pt-badge"><circle cx="11" cy="51" r="7.2" fill="url(#goldG)" stroke="#9a6f25" stroke-width=".8"/><text x="11" y="54.6" text-anchor="middle" font-size="10" font-weight="800" fill="#4a3208">${pts}</text></g>`
    : '';
  let center = '';
  if (r === 'A') {
    center = pip(s, 50, 70, 50) + `<circle cx="50" cy="70" r="34" fill="none" stroke="${ink}" stroke-opacity=".12" stroke-width="1.2"/>`;
  } else if (LAYOUTS[r]) {
    center = LAYOUTS[r].map(([x, y]) => pip(s, x, y, 19, y > 72)).join('');
  } else {
    // court cards: framed panel with large serif letter
    center = `
      <rect x="22" y="17" width="56" height="106" rx="6" fill="url(#${red ? 'courtR' : 'courtB'})" stroke="url(#goldG)" stroke-width="1.6"/>
      <rect x="25.5" y="20.5" width="49" height="99" rx="4" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width=".7"/>
      ${pip(s, 50, 36, 17)}
      <text x="50" y="88" text-anchor="middle" class="court" font-size="46" fill="${ink}">${r}</text>
      ${pip(s, 50, 104, 17, true)}`;
  }
  const svg = `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="${ink}">
    <rect x=".75" y=".75" width="98.5" height="138.5" rx="8" fill="url(#cardFace)" stroke="${pts ? '#d3ac5c' : '#cfc8b8'}" stroke-width="${pts ? 1.5 : 1}"/>
    ${corner}${badge}
    <g transform="rotate(180 50 70)">${corner}</g>
    ${center}
  </svg>`;
  cache.set(card, svg);
  return svg;
}

/** Face-up card element. opts.button -> <button>. */
export function createCard(card, opts = {}) {
  const el = h(opts.button ? 'button' : 'div', {
    class: `card face${pointsOf(card) ? ' has-pts' : ''}${isRed(suitOf(card)) ? ' red' : ''}`,
    dataset: { card },
    'aria-label': `${cardName(card)}${pointsOf(card) ? `, ${pointsOf(card)} point${pointsOf(card) > 1 ? 's' : ''}` : ''}`,
    type: opts.button ? 'button' : null,
    role: opts.button ? null : 'img',
  });
  el.innerHTML = cardSVG(card);
  return el;
}

export function createBack(extraClass = '') {
  return h('div', { class: `card back ${extraClass}`, 'aria-hidden': 'true' });
}

/** Turn an existing card element into face/back for `card` (null => back). */
export function setCard(el, card) {
  const key = card || '__back';
  if (el.dataset.key === key) return el;
  el.dataset.key = key;
  if (card) {
    el.className = `card face${pointsOf(card) ? ' has-pts' : ''}`;
    el.dataset.card = card;
    el.innerHTML = cardSVG(card);
    el.setAttribute('aria-label', cardName(card));
    el.setAttribute('role', 'img');
  } else {
    el.className = 'card back';
    delete el.dataset.card;
    el.innerHTML = '';
    el.setAttribute('aria-label', 'Face-down card');
  }
  return el;
}
