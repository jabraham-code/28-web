// Rummy card faces: full 52-card ranks (A–K) + printed jokers, ids like "7H1" / "TD2" / "X1".
// Reuses the suit sprite and gradients installed by ui/cards.js (installSuitSprite).
import { h } from '../util.js';

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
export const RANK_LABEL = { T: '10' };
const RANK_NAME = { A: 'Ace', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King' };
const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const isJoker = (id) => !!id && id[0] === 'X';
export const rRank = (id) => (isJoker(id) ? 'X' : id[0]);
export const rSuit = (id) => (isJoker(id) ? null : id[1]);
export const isRedSuit = (s) => s === 'H' || s === 'D';
export const rankLabel = (r) => (r === 'X' ? 'Joker' : RANK_LABEL[r] || r);
export const rankPlural = (r) => (r === 'A' ? 'Aces' : r === 'X' ? 'Jokers' : `${RANK_LABEL[r] || r}s`);
export function rCardName(id) {
  if (isJoker(id)) return 'Joker';
  return `${RANK_NAME[rRank(id)]} of ${SUIT_NAME[rSuit(id)]}`;
}
/** Short text label, e.g. "10♥", "Joker". */
export const rShort = (id) => (isJoker(id) ? 'Joker' : `${rankLabel(rRank(id))}${SUIT_GLYPH[rSuit(id)]}`);
/** The rank that is wild this deal, from the turned-up wild card (printed joker => Aces). */
export const wildRankOf = (wildCard) => (!wildCard ? null : isJoker(wildCard) ? 'A' : rRank(wildCard));
export const isWildCard = (id, wildRank) => isJoker(id) || (!!wildRank && rRank(id) === wildRank);

const pip = (s, x, y, size, flip = false) => {
  const hs = size / 2;
  const t = flip ? ` transform="rotate(180 ${x} ${y})"` : '';
  return `<use href="#suit-${s}" x="${x - hs}" y="${y - hs}" width="${size}" height="${size}"${t}/>`;
};
const L = 35, C = 55, R = 75; // pips sit right of centre: the left strip carries a big index for overlapped hands
const LAYOUTS = {
  2: [[C, 30], [C, 110]],
  3: [[C, 30], [C, 70], [C, 110]],
  4: [[L, 30], [R, 30], [L, 110], [R, 110]],
  5: [[L, 30], [R, 30], [C, 70], [L, 110], [R, 110]],
  6: [[L, 30], [R, 30], [L, 70], [R, 70], [L, 110], [R, 110]],
  7: [[L, 30], [R, 30], [C, 50], [L, 70], [R, 70], [L, 110], [R, 110]],
  8: [[L, 30], [R, 30], [C, 50], [L, 70], [R, 70], [C, 90], [L, 110], [R, 110]],
  9: [[L, 28], [R, 28], [L, 56], [R, 56], [C, 70], [L, 84], [R, 84], [L, 112], [R, 112]],
  T: [[L, 28], [R, 28], [C, 43], [L, 56], [R, 56], [L, 84], [R, 84], [C, 97], [L, 112], [R, 112]],
};
const STAR = (cx, cy, r, fill) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
};

const cache = new Map();
export function rCardSVG(id) {
  const key = isJoker(id) ? 'X' : id.slice(0, 2);
  if (cache.has(key)) return cache.get(key);
  let svg;
  if (key === 'X') svg = jokerSVG();
  else {
    const r = key[0], s = key[1];
    const ink = isRedSuit(s) ? '#c62839' : '#17202a';
    const label = RANK_LABEL[r] || r;
    const corner = `
      <text x="14" y="27" text-anchor="middle" class="idx" ${label.length > 1 ? 'textLength="23" lengthAdjust="spacingAndGlyphs" font-size="25"' : 'font-size="29"'} fill="${ink}">${label}</text>
      ${pip(s, 14, 41, 17)}`;
    let center = '';
    if (r === 'A') center = pip(s, 56, 72, 46) + `<circle cx="56" cy="72" r="31" fill="none" stroke="${ink}" stroke-opacity=".12" stroke-width="1.2"/>`;
    else if (LAYOUTS[r]) center = LAYOUTS[r].map(([x, y]) => pip(s, x, y, r <= '6' && r >= '2' ? 21 : 18, y > 72)).join('');
    else {
      const red = isRedSuit(s);
      center = `
        <rect x="31" y="17" width="52" height="106" rx="6" fill="url(#${red ? 'courtR' : 'courtB'})" stroke="url(#goldG)" stroke-width="1.6"/>
        <rect x="34.5" y="20.5" width="45" height="99" rx="4" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width=".7"/>
        ${pip(s, 57, 36, 16)}
        <text x="57" y="88" text-anchor="middle" class="court" font-size="44" fill="${ink}">${r}</text>
        ${pip(s, 57, 104, 16, true)}`;
    }
    svg = `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="${ink}">
      <rect x=".75" y=".75" width="98.5" height="138.5" rx="8" fill="url(#cardFace)" stroke="#cfc8b8" stroke-width="1"/>
      ${corner}
      <g transform="rotate(180 50 70)">${corner}</g>
      ${center}
    </svg>`;
  }
  cache.set(key, svg);
  return svg;
}

function jokerSVG() {
  const letters = 'JOKER'.split('').map((ch, i) => `<text x="14" y="${50 + i * 12}" text-anchor="middle" font-size="11" font-weight="800" fill="#c62839" class="idx">${ch}</text>`).join('');
  return `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x=".75" y=".75" width="98.5" height="138.5" rx="8" fill="url(#cardFace)" stroke="#d3ac5c" stroke-width="1.5"/>
    ${STAR(14, 22, 11, '#c62839')}
    ${letters}
    <g transform="translate(6 0)">
      <circle cx="52" cy="70" r="33" fill="rgba(232,193,112,.16)"/>
      <path d="M33 90 Q 29 66 17 52 Q 36 55 43 72 Q 45 52 52 37 Q 59 52 61 72 Q 68 55 87 52 Q 75 66 71 90 Z" fill="#c62839" stroke="#7a1020" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M43 72 Q 45 52 52 37 Q 59 52 61 72 Q 56 80 52 90 Q 48 80 43 72 Z" fill="#17202a" opacity=".92"/>
      <circle cx="17" cy="52" r="4.6" fill="url(#goldG)" stroke="#9a6f25" stroke-width=".8"/>
      <circle cx="52" cy="36" r="4.6" fill="url(#goldG)" stroke="#9a6f25" stroke-width=".8"/>
      <circle cx="87" cy="52" r="4.6" fill="url(#goldG)" stroke="#9a6f25" stroke-width=".8"/>
      <rect x="30" y="88" width="44" height="10" rx="3" fill="url(#goldG)" stroke="#9a6f25" stroke-width=".8"/>
      <text x="52" y="120" text-anchor="middle" class="court" font-size="15" letter-spacing="2" fill="#17202a">JOKER</text>
    </g>
  </svg>`;
}

/** Face-up rummy card element. opts: { button, wildRank, mini } */
export function createRCard(id, opts = {}) {
  const wild = isWildCard(id, opts.wildRank);
  const el = h(opts.button ? 'button' : 'div', {
    class: `card face rcard${isJoker(id) ? ' joker' : ''}${wild ? ' wild' : ''}${opts.mini ? ' mini' : ''}`,
    dataset: { card: id },
    'aria-label': `${rCardName(id)}${wild && !isJoker(id) ? ' (wild joker)' : ''}`,
    type: opts.button ? 'button' : null,
    role: opts.button ? null : 'img',
  });
  el.innerHTML = rCardSVG(id);
  return el;
}
/** Keep the wild marker current on an existing card element (the wild rank changes every deal). */
export function syncWild(el, wildRank) {
  const id = el.dataset.card;
  const wild = isWildCard(id, wildRank);
  if (el.classList.contains('wild') !== wild) {
    el.classList.toggle('wild', wild);
    el.setAttribute('aria-label', `${rCardName(id)}${wild && !isJoker(id) ? ' (wild joker)' : ''}`);
  }
}
