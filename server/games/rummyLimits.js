// Rummy room-setting limits (kept separate from server/games/rummy.js so the
// room layer can validate settings even if the rummy engine fails to load).
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_PLAYERS = 4;
export const POOL_LIMITS = Object.freeze([101, 201]);
export const DEFAULT_POOL_LIMIT = 101;
