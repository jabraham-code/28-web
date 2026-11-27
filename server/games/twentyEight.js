// "28" game module: adapts the 28 engine, bots and Claude wiring to the
// generic game-module interface used by server/rooms.js (RUMMY.md §3).

import { createGame, applyAction, getView, currentTurn } from '../engine.js';
import { chooseAction } from '../bot.js';
import { chooseActionLLM, hintLLM, legalOptions, llmAvailable } from '../llmBot.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fallbackActions(view) {
  const l = view.legal || {};
  const acts = l.actions || [];
  const out = [];
  if (acts.includes('chooseTrump') && l.trumpChoices?.length) out.push({ type: 'chooseTrump', card: l.trumpChoices[0] });
  if (acts.includes('play') && l.playable?.length) out.push({ type: 'play', card: l.playable[0] });
  if (acts.includes('pass')) out.push({ type: 'pass' });
  if (acts.includes('bid') && l.minBid != null) out.push({ type: 'bid', value: l.minBid });
  if (acts.includes('playTrumpCard')) out.push({ type: 'playTrumpCard' });
  if (acts.includes('callTrump')) out.push({ type: 'callTrump' });
  if (acts.includes('redeal')) out.push({ type: 'redeal' });
  return out;
}

export default {
  id: '28',
  name: '28',
  nextAction: 'nextHand',
  actionFields: ['value', 'card', 'trump'],

  /** Number of seats at the table for these room settings. */
  seatCount: () => 4,

  createGame: (settings /* , seats */) => createGame({ targetScore: settings.targetScore }),
  applyAction,
  getView,
  currentTurn,

  /** Match over → room behaves like a lobby again. */
  isOver: (view) => view.phase === 'matchEnd',
  /** Between hands: the room auto-sends `nextAction` after a delay. */
  isBetween: (view) => view.phase === 'handEnd',

  /** Classic heuristic bot. */
  botAction: (view) => chooseAction(view),
  fallbackActions,

  /** The numbered legal options (label + action) for this view. */
  options: (view) => legalOptions(view),
  isLegal: (view, action) => legalOptions(view).some((o) => same(o.action, action)),
  hintAction(view) {
    const opts = legalOptions(view);
    let a = null;
    try { a = chooseAction(view); } catch { /* fall through */ }
    if (!a || !opts.some((o) => same(o.action, a))) a = opts[0]?.action ?? null;
    return a;
  },
  describe(action, view) {
    const o = legalOptions(view).find((x) => same(x.action, action));
    return o ? o.label : action.type;
  },

  /** After every applied action: a key that changes when a trick completes → bots pause so humans can see it. */
  pauseKey: (view) => (view.lastTrick ? `${view.handNumber}:${view.lastTrick.index}` : null),

  /** Optional system-chat line after a successful human action. */
  actionNotice(action, view, playerName) {
    if (action.type !== 'endHand') return null;
    const r = view.handResult;
    return `${playerName} ended the hand — contract ${r?.made ? 'made' : 'beaten'}`;
  },

  /** Series counter shape: wins per team. */
  newSeries: () => [0, 0],

  /**
   * Append the finished hand (and match) to room.history. Called after every
   * action; must be idempotent. `name(seat)` gives the display name.
   */
  recordHistory(view, room, name) {
    if (view.phase !== 'handEnd' && view.phase !== 'matchEnd') return;
    const mark = `${view.handNumber}`;
    if (!view.handResult || (room.recorded?.game === room.game && room.recorded.key === mark)) return;
    room.recorded = { game: room.game, key: mark };
    const r = view.handResult;
    room.history.hands.push({
      hand: view.handNumber, dealer: view.dealer, bidder: r.bidder, bidderName: name(r.bidder), bid: r.bid,
      trump: view.trump?.suit ?? null, made: r.made, teamPoints: r.teamPoints, delta: r.delta, scores: view.scores,
    });
    if (view.phase === 'matchEnd' && view.matchWinner != null) {
      room.history.matches.push({ winner: view.matchWinner, scores: view.scores, hands: room.history.hands.length, endedAt: Date.now() });
      room.history.series[view.matchWinner]++;
    }
  },

  /** Claude bots + coach (only 28 supports them for now). */
  claude: {
    available: llmAvailable,
    choose: chooseActionLLM,
    hint: hintLLM,
  },
};
