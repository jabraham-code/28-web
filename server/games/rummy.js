// Rummy game module (13-card Indian Rummy, pool format — RUMMY.md): adapts
// server/rummy/index.js to the generic game-module interface used by
// server/rooms.js. Claude bots/hints are out of scope for rummy: the classic
// rummy bot plays and suggests hints.

import { createGame, applyAction, getView, currentTurn, chooseAction } from '../rummy/index.js';

export { MIN_PLAYERS, MAX_PLAYERS, POOL_LIMITS } from './rummyLimits.js';

const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const RANK_NAMES = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10' };

/** "7H1" → "7 of Hearts", "X2" → "Joker"; wild-rank cards are marked. */
export function cardName(card, wildRank) {
  if (typeof card !== 'string' || !card) return 'a card';
  if (card[0] === 'X') return 'Joker';
  const r = card[0];
  const base = `${RANK_NAMES[r] || r} of ${SUIT_NAMES[card[1]] || card[1]}`;
  return wildRank && r === wildRank ? `${base} (wild joker)` : base;
}

const legalOf = (view) => view?.legal || { actions: [] };
const dropLabel = (view) => `Drop out of this deal${view?.legal?.dropPoints ? ` (${view.legal.dropPoints} points)` : ''}`;

function options(view) {
  const l = legalOf(view);
  const acts = l.actions || [];
  const out = [];
  if (acts.includes('draw')) {
    if (l.canDrawClosed !== false) out.push({ label: 'Draw from the closed deck', action: { type: 'draw', from: 'closed' } });
    if (l.canDrawOpen && view.openTop) out.push({ label: `Pick up ${cardName(view.openTop, view.wildRank)} from the open pile`, action: { type: 'draw', from: 'open' } });
  }
  if (acts.includes('discard')) for (const c of l.discardable || []) out.push({ label: `Discard ${cardName(c, view.wildRank)}`, action: { type: 'discard', card: c } });
  if (acts.includes('drop')) out.push({ label: dropLabel(view), action: { type: 'drop' } });
  return out;
}

function isLegal(view, action) {
  const l = legalOf(view);
  const acts = l.actions || [];
  if (!action || !acts.includes(action.type)) return false;
  switch (action.type) {
    case 'draw': return (action.from === 'closed' && l.canDrawClosed !== false) || (action.from === 'open' && !!l.canDrawOpen);
    case 'discard': return (l.discardable || []).includes(action.card);
    case 'declare': return (view.hand || []).includes(action.card);
    default: return true;
  }
}

function fallbackActions(view) {
  const l = legalOf(view);
  const acts = l.actions || [];
  const out = [];
  if (acts.includes('draw')) out.push({ type: 'draw', from: l.canDrawClosed === false ? 'open' : 'closed' });
  if (acts.includes('discard')) for (const c of (l.discardable || []).slice(0, 3)) out.push({ type: 'discard', card: c });
  if (acts.includes('nextDeal')) out.push({ type: 'nextDeal' });
  if (acts.includes('drop')) out.push({ type: 'drop' });
  return out;
}

function describe(action, view) {
  if (!action) return '';
  const w = view?.wildRank;
  switch (action.type) {
    case 'draw': return action.from === 'open' ? `Pick up ${cardName(view?.openTop, w)} from the open pile` : 'Draw from the closed deck';
    case 'discard': return `Discard ${cardName(action.card, w)}`;
    case 'declare': return `Declare — finish with ${cardName(action.card, w)}`;
    case 'drop': return dropLabel(view);
    case 'nextDeal': return 'Next deal';
    default: return action.type;
  }
}

export default {
  id: 'rummy',
  name: 'Rummy',
  nextAction: 'nextDeal',
  actionFields: ['from', 'card'],
  clockPerTurn: true, // one turn-timer deadline covers draw + discard

  seatCount: (settings) => settings.players,

  createGame: (settings, seats) => createGame({ seats, poolLimit: settings.poolLimit }),
  applyAction,
  getView,
  currentTurn,

  isOver: (view) => view.phase === 'matchEnd',
  isBetween: (view) => view.phase === 'dealEnd',

  botAction: (view) => chooseAction(view),
  fallbackActions,
  options,
  isLegal,
  hintAction(view) {
    let a = null;
    try { a = chooseAction(view); } catch { /* fall through */ }
    if (!a || !isLegal(view, a)) a = fallbackActions(view)[0] ?? null;
    return a;
  },
  describe,

  pauseKey: () => null,
  actionNotice(action, view, playerName) {
    if (action.type === 'drop') return `${playerName} dropped out of this deal`;
    return null;
  },

  /** Series counter shape: match wins per seat. */
  newSeries: (settings) => Array(settings.players).fill(0),

  recordHistory(view, room, name) {
    if (view.phase !== 'dealEnd' && view.phase !== 'matchEnd') return;
    const r = view.dealResult;
    const mark = `${view.dealNumber}`;
    if (!r || (room.recorded?.game === room.game && room.recorded.key === mark)) return;
    room.recorded = { game: room.game, key: mark };
    room.history.hands.push({
      deal: view.dealNumber,
      dealer: view.dealer,
      declarer: r.declarer ?? null,
      declarerName: r.declarer != null ? name(r.declarer) : null,
      valid: !!r.valid,
      wrongShow: !!r.wrongShow,
      winner: r.winner ?? null,
      winnerName: r.winner != null ? name(r.winner) : null,
      points: { ...r.points },
      scores: { ...view.scores },
      eliminated: [...(view.eliminated || [])],
    });
    if (view.phase === 'matchEnd' && view.matchWinner != null) {
      room.history.matches.push({
        winner: view.matchWinner,
        winnerName: name(view.matchWinner),
        winnerId: room.seats[view.matchWinner] ?? null,
        scores: { ...view.scores },
        hands: room.history.hands.length,
        endedAt: Date.now(),
      });
      if (view.matchWinner < room.history.series.length) room.history.series[view.matchWinner]++;
    }
  },

  claude: null,
};
