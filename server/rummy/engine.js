// Pure game engine for 13-card Indian Rummy (Pool format). No I/O. Deterministic given rng / decks.
// See RUMMY.md sections 1 & 2.

import {
  newDeck, isCardId, isPrintedJoker, wildRankFor, bestArrangement, cardPoints, MAX_POINTS,
} from '../../public/js/shared/rummy-melds.js';

export { bestArrangement, cardPoints };

const LOG_MAX = 40;
const HAND_SIZE = 13;
const FIRST_DROP = 20;
const MIDDLE_DROP = 40;
const DECK_SIZE = 106;

const isSeatNum = (s) => Number.isInteger(s) && s >= 0 && s <= 5;

/** Next seat after `seat` in table order among `list` (cyclic). */
function nextIn(list, seat) {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.find((s) => s > seat) ?? sorted[0];
}

// Fisher-Yates, in place.
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function log(game, msg) {
  game.log.push(msg);
  if (game.log.length > LOG_MAX) game.log.splice(0, game.log.length - LOG_MAX);
}

function validateDeck(deck) {
  if (!Array.isArray(deck) || deck.length !== DECK_SIZE || new Set(deck).size !== DECK_SIZE || !deck.every(isCardId)) {
    throw new Error('stacked deck must be the 106 distinct rummy cards');
  }
  return [...deck];
}

// ---------------------------------------------------------------------------
// Creation / dealing
// ---------------------------------------------------------------------------

/**
 * createGame({ seats, poolLimit = 101, dealer, rng = Math.random, decks })
 * seats: 2..6 distinct seat numbers in 0..5. poolLimit: any positive integer (rooms offer 101 / 201).
 * decks (testing aid): pre-arranged 106-card arrays used for successive deals. Layout of a deal with
 * N players, taking players in turn order starting after the dealer: player k gets deck[13k..13k+12],
 * then deck[13N] is the wild card, deck[13N+1] starts the open pile and the rest is the closed deck
 * (drawn from the front).
 */
export function createGame({ seats, poolLimit = 101, dealer, rng = Math.random, decks } = {}) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 6 || !seats.every(isSeatNum) || new Set(seats).size !== seats.length) {
    throw new Error('seats must be 2..6 distinct seat numbers 0..5');
  }
  if (!Number.isInteger(poolLimit) || poolLimit < 1) throw new Error('poolLimit must be a positive integer');
  const sorted = [...seats].sort((a, b) => a - b);
  if (dealer == null) dealer = sorted[Math.floor(rng() * sorted.length)];
  if (!sorted.includes(dealer)) throw new Error('dealer must be one of the seats');
  const game = {
    gameType: 'rummy',
    seats: sorted,
    poolLimit,
    dealer,
    dealNumber: 0,
    seq: 0,
    phase: null,
    turn: null,
    step: null,
    hands: {},
    closed: [],
    open: [],
    wildCard: null,
    wildRank: null,
    inDeal: [],
    active: [],
    eliminated: [],
    scores: Object.fromEntries(sorted.map((s) => [s, 0])),
    dropped: {},
    drawn: {},
    justDrew: null,
    dealResult: null,
    matchWinner: null,
    log: [],
    stackedDecks: (decks || []).map(validateDeck),
  };
  setRng(game, rng);
  startDeal(game);
  return game;
}

/** Attach (or re-attach after deserialisation) the rng. Not enumerable, so JSON-safe. */
export function setRng(game, rng) {
  Object.defineProperty(game, 'rng', { value: rng, writable: true, configurable: true, enumerable: false });
}

function remaining(game) {
  return game.seats.filter((s) => !game.eliminated.includes(s));
}

function startDeal(game) {
  game.dealNumber += 1;
  const players = remaining(game);
  const first = nextIn(players, game.dealer);
  const order = [];
  for (let s = first, k = 0; k < players.length; k++, s = nextIn(players, s)) order.push(s);
  const deck = game.stackedDecks.length ? game.stackedDecks.shift() : shuffle(newDeck(), game.rng || Math.random);
  game.hands = {};
  order.forEach((s, k) => { game.hands[s] = deck.slice(HAND_SIZE * k, HAND_SIZE * (k + 1)); });
  const n = HAND_SIZE * order.length;
  game.wildCard = deck[n];
  game.wildRank = wildRankFor(game.wildCard);
  game.open = [deck[n + 1]];
  game.closed = deck.slice(n + 2);
  game.inDeal = [...players];
  game.active = [...players];
  game.dropped = {};
  game.drawn = Object.fromEntries(players.map((s) => [s, 0]));
  game.justDrew = null;
  game.dealResult = null;
  game.phase = 'playing';
  game.turn = first;
  game.step = 'draw';
  log(game, `Deal ${game.dealNumber}: seat ${game.dealer} deals; wild card ${game.wildCard} (${isPrintedJoker(game.wildCard) ? 'Aces' : game.wildRank + 's'} wild)`);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function currentTurn(game) {
  return game.phase === 'playing' ? game.turn : null;
}

export function applyAction(game, seat, action) {
  let err;
  try {
    err = dispatch(game, seat, action);
  } catch (e) {
    err = 'Internal error: ' + (e && e.message);
  }
  if (err) return { ok: false, error: err };
  game.seq += 1;
  return { ok: true };
}

function dispatch(game, seat, action) {
  if (!game.seats.includes(seat)) return 'Invalid seat';
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return 'Invalid action';
  if (game.phase === 'matchEnd') return 'The match is over';
  if (action.type === 'nextDeal') {
    if (game.phase !== 'dealEnd') return 'The deal is not over';
    if (game.eliminated.includes(seat)) return 'You have been eliminated';
    game.dealer = nextIn(remaining(game), game.dealer);
    startDeal(game);
    return null;
  }
  if (game.phase === 'dealEnd') return 'The deal is over; waiting for the next deal';
  if (!['draw', 'discard', 'declare', 'drop'].includes(action.type)) return `Unknown action type "${action.type}"`;
  if (!game.active.includes(seat)) return 'You are not in this deal';
  if (game.turn !== seat) return 'Not your turn';
  switch (action.type) {
    case 'draw': return doDraw(game, seat, action.from);
    case 'discard': return doDiscard(game, seat, action.card);
    case 'declare': return doDeclare(game, seat, action.card);
    case 'drop': return doDrop(game, seat);
  }
  return 'Unknown action';
}

function canDrawClosed(game) {
  return game.closed.length > 0 || game.open.length > 1;
}

function doDraw(game, seat, from) {
  if (game.step !== 'draw') return 'You have already drawn';
  if (from !== 'closed' && from !== 'open') return 'Draw from "closed" or "open"';
  let card;
  if (from === 'open') {
    if (!game.open.length) return 'The open pile is empty';
    card = game.open.pop();
    log(game, `Seat ${seat} took ${card} from the open pile`);
  } else {
    if (!canDrawClosed(game)) return 'The closed deck is empty';
    if (!game.closed.length) {
      const top = game.open.pop();
      game.closed = shuffle(game.open, game.rng || Math.random);
      game.open = [top];
      log(game, `Closed deck reshuffled from the open pile (${game.closed.length} cards)`);
    }
    card = game.closed.shift();
    log(game, `Seat ${seat} drew from the closed deck`);
  }
  game.hands[seat].push(card);
  game.drawn[seat] += 1;
  game.justDrew = { card, from };
  game.step = 'discard';
  return null;
}

function discardError(game, seat, card) {
  if (game.step !== 'discard') return 'Draw a card first';
  if (typeof card !== 'string' || !game.hands[seat].includes(card)) return 'You do not hold that card';
  return null;
}

function doDiscard(game, seat, card) {
  const err = discardError(game, seat, card);
  if (err) return err;
  if (game.justDrew && game.justDrew.from === 'open' && game.justDrew.card === card) {
    return 'You cannot discard the card you just took from the open pile';
  }
  const hand = game.hands[seat];
  hand.splice(hand.indexOf(card), 1);
  game.open.push(card);
  log(game, `Seat ${seat} discarded ${card}`);
  advance(game, seat);
  return null;
}

function advance(game, seat) {
  game.turn = nextIn(game.active, seat);
  game.step = 'draw';
  game.justDrew = null;
}

function doDrop(game, seat) {
  if (game.step !== 'draw') return 'You can only drop before drawing';
  const pts = game.drawn[seat] ? MIDDLE_DROP : FIRST_DROP;
  game.dropped[seat] = pts;
  game.active = game.active.filter((s) => s !== seat);
  log(game, `Seat ${seat} dropped (${pts})`);
  if (game.active.length === 1) {
    endDeal(game, { declarer: null, valid: false, wrongShow: false, winner: game.active[0], finishCard: null });
  } else {
    advance(game, seat);
  }
  return null;
}

function doDeclare(game, seat, card) {
  const err = discardError(game, seat, card);
  if (err) return err;
  const hand = game.hands[seat];
  hand.splice(hand.indexOf(card), 1);
  const arr = bestArrangement(hand, game.wildRank);
  if (arr.valid) {
    log(game, `Seat ${seat} declared: valid show`);
    endDeal(game, { declarer: seat, valid: true, wrongShow: false, winner: seat, finishCard: card }, { [seat]: arr });
  } else {
    log(game, `Seat ${seat} declared: wrong show (${MAX_POINTS})`);
    endDeal(game, { declarer: seat, valid: false, wrongShow: true, winner: null, finishCard: card }, { [seat]: arr });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deal end / pool
// ---------------------------------------------------------------------------

function endDeal(game, result, known = {}) {
  const points = {};
  const hands = {};
  for (const s of game.inDeal) {
    const arr = known[s] || bestArrangement(game.hands[s], game.wildRank);
    hands[s] = { groups: arr.groups.map((g) => ({ type: g.type, cards: [...g.cards] })), deadwood: [...arr.deadwood] };
    if (game.dropped[s] != null) points[s] = game.dropped[s];
    else if (result.wrongShow) points[s] = s === result.declarer ? MAX_POINTS : 0;
    else if (s === result.winner) points[s] = 0;
    else points[s] = arr.points;
  }
  for (const s of game.inDeal) game.scores[s] += points[s];
  game.dealResult = { ...result, points, hands };
  log(game, `Deal ${game.dealNumber} points: ` + game.inDeal.map((s) => `seat ${s} ${points[s]}`).join(', '));
  const newlyOut = game.inDeal.filter((s) => game.scores[s] >= game.poolLimit);
  for (const s of newlyOut) {
    game.eliminated.push(s);
    log(game, `Seat ${s} is eliminated (${game.scores[s]})`);
  }
  game.active = game.active.filter((s) => !game.eliminated.includes(s));
  game.turn = null;
  game.step = null;
  game.justDrew = null;
  const left = remaining(game);
  if (left.length <= 1) {
    game.phase = 'matchEnd';
    game.matchWinner = left.length === 1 ? left[0]
      : [...newlyOut].sort((a, b) => game.scores[a] - game.scores[b] || a - b)[0];
    log(game, `Seat ${game.matchWinner} wins the match`);
  } else {
    game.phase = 'dealEnd';
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function computeLegal(game, me) {
  const none = { actions: [], canDrawOpen: false, canDrawClosed: false, discardable: [], dropPoints: null };
  if (me === null) return none;
  if (game.phase === 'dealEnd') {
    return game.eliminated.includes(me) ? none : { ...none, actions: ['nextDeal'] };
  }
  if (game.phase !== 'playing' || game.turn !== me) return none;
  if (game.step === 'draw') {
    const canOpen = game.open.length > 0, canClosed = canDrawClosed(game);
    return {
      actions: [...(canOpen || canClosed ? ['draw'] : []), 'drop'],
      canDrawOpen: canOpen,
      canDrawClosed: canClosed,
      discardable: [],
      dropPoints: game.drawn[me] ? MIDDLE_DROP : FIRST_DROP,
    };
  }
  const jd = game.justDrew;
  return {
    actions: ['discard', 'declare'],
    canDrawOpen: false,
    canDrawClosed: false,
    discardable: game.hands[me].filter((c) => !(jd && jd.from === 'open' && c === jd.card)),
    dropPoints: null,
  };
}

export function getView(game, seat) {
  const me = game.seats.includes(seat) ? seat : null;
  const r = game.dealResult;
  return {
    gameType: 'rummy',
    phase: game.phase,
    seq: game.seq,
    dealNumber: game.dealNumber,
    dealer: game.dealer,
    seats: [...game.seats],
    active: [...game.active],
    eliminated: [...game.eliminated],
    turn: currentTurn(game),
    step: game.phase === 'playing' ? game.step : null,
    mySeat: me,
    hand: me !== null && game.hands[me] ? [...game.hands[me]] : [],
    handCounts: Object.fromEntries(game.seats.map((s) => [s, game.hands[s] ? game.hands[s].length : 0])),
    closedCount: game.closed.length,
    openTop: game.open.length ? game.open[game.open.length - 1] : null,
    openCount: game.open.length,
    wildCard: game.wildCard,
    wildRank: game.wildRank,
    justDrew: me !== null && game.phase === 'playing' && game.turn === me && game.justDrew ? { ...game.justDrew } : null,
    scores: { ...game.scores },
    poolLimit: game.poolLimit,
    dropped: { ...game.dropped },
    dealResult: r ? {
      declarer: r.declarer,
      valid: r.valid,
      wrongShow: r.wrongShow,
      winner: r.winner,
      finishCard: r.finishCard,
      points: { ...r.points },
      hands: Object.fromEntries(Object.entries(r.hands).map(([s, h]) => [s, {
        groups: h.groups.map((g) => ({ type: g.type, cards: [...g.cards] })), deadwood: [...h.deadwood],
      }])),
    } : null,
    matchWinner: game.matchWinner,
    legal: computeLegal(game, me),
    log: [...game.log],
  };
}
