// Game-module registry. Each module implements the interface documented in
// RUMMY.md §3 / SPEC.md §5 (see server/games/twentyEight.js for the reference).
//
// Rummy is loaded defensively: if its engine fails to load, the server still
// runs 28 and rejects `gameType: "rummy"`.

import twentyEight from './twentyEight.js';

let rummy = null;
try {
  rummy = (await import('./rummy.js')).default;
} catch (err) {
  console.error('[games] Rummy unavailable:', err?.message || err);
}

export const GAMES = Object.freeze(Object.fromEntries([['28', twentyEight], ...(rummy ? [['rummy', rummy]] : [])]));
export const GAME_TYPES = Object.freeze(Object.keys(GAMES));
export const DEFAULT_GAME = '28';

export function getGame(id) {
  return GAMES[id] ?? null;
}
