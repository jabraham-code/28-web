// Card helpers for the game of 28.
// Card id: rank + suit, e.g. "JS", "9H", "TD", "7C".

export const SUITS = ['S', 'H', 'D', 'C'];
// High -> low.
export const RANKS = ['J', '9', 'A', 'T', 'K', 'Q', '8', '7'];
export const POINTS = { J: 3, 9: 2, A: 1, T: 1, K: 0, Q: 0, 8: 0, 7: 0 };

// Display order for hands: alternating colours.
const SORT_SUITS = ['S', 'H', 'C', 'D'];

export function rankOf(card) {
  return card[0];
}

export function suitOf(card) {
  return card[1];
}

// 0 = highest (J), 7 = lowest (7). Lower index beats higher index in the same suit.
export function rankIndex(card) {
  return RANKS.indexOf(card[0]);
}

export function pointsOf(card) {
  return POINTS[card[0]] ?? 0;
}

export function isCard(card) {
  return typeof card === 'string' && card.length === 2 &&
    RANKS.includes(card[0]) && SUITS.includes(card[1]);
}

export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

// Fisher-Yates, in place. Returns the same array.
export function shuffle(deck, rng = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Returns a new array sorted by suit (S,H,C,D) then rank high -> low.
export function sortHand(cards) {
  return [...cards].sort((a, b) =>
    (SORT_SUITS.indexOf(suitOf(a)) - SORT_SUITS.indexOf(suitOf(b))) ||
    (rankIndex(a) - rankIndex(b)));
}
