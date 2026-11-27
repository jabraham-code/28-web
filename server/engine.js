// Pure game engine for 28. No I/O. Deterministic given rng.
// See SPEC.md sections 1 & 2.

import { rankIndex, suitOf, pointsOf, newDeck, shuffle, sortHand, isCard } from './cards.js';

const LOG_MAX = 30;
const MAX_BID = 28;

const next = (s) => (s + 1) % 4;
const teamOf = (s) => s % 2;
const partnerOf = (s) => (s + 2) % 4;
const isSeat = (s) => Number.isInteger(s) && s >= 0 && s <= 3;
const hasPointCard = (cards) => cards.some((c) => pointsOf(c) > 0);

// ---------------------------------------------------------------------------
// Creation / dealing
// ---------------------------------------------------------------------------

/**
 * createGame({ targetScore = 5, dealer = random seat, rng = Math.random, decks })
 * `decks` (testing aid, optional): array of pre-arranged 32-card decks used for the
 * `targetScore` is each team's STARTING points. Hand results are exchanged between the
 * teams (winner gains what the loser gives up); a team that drops below zero loses the match.
 * next deals in order before falling back to rng shuffles. Deal layout: seat s receives
 * deck[4s..4s+3] in deal 1 and deck[16+4s..16+4s+3] in deal 2.
 */
export function createGame({ targetScore = 5, dealer, rng = Math.random, decks } = {}) {
  if (!Number.isInteger(targetScore) || targetScore < 1) throw new Error('targetScore must be a positive integer');
  if (dealer == null) dealer = Math.floor(rng() * 4);
  if (!isSeat(dealer)) throw new Error('dealer must be a seat 0..3');
  const game = {
    targetScore,
    dealer,
    firstSeat: next(dealer),
    handNumber: 0,
    seq: 0,
    phase: null,
    turn: null,
    scores: [targetScore, targetScore],
    matchWinner: null,
    log: [],
    stackedDecks: (decks || []).map((d) => validateDeck([...d])),
  };
  setRng(game, rng);
  startHand(game);
  return game;
}

/** Attach (or re-attach after deserialisation) the rng. Not enumerable, so JSON-safe. */
export function setRng(game, rng) {
  Object.defineProperty(game, 'rng', { value: rng, writable: true, configurable: true, enumerable: false });
}

function validateDeck(deck) {
  if (deck.length !== 32 || new Set(deck).size !== 32 || !deck.every(isCard)) {
    throw new Error('stacked deck must be 32 distinct cards');
  }
  return deck;
}

function log(game, msg) {
  game.log.push(msg);
  if (game.log.length > LOG_MAX) game.log.splice(0, game.log.length - LOG_MAX);
}

function startHand(game) {
  game.handNumber += 1;
  game.firstSeat = next(game.dealer);
  log(game, `Hand ${game.handNumber}: seat ${game.dealer} deals`);
  deal(game);
}

function deal(game) {
  const deck = game.stackedDecks.length ? game.stackedDecks.shift() : shuffle(newDeck(), game.rng || Math.random);
  game.hands = [0, 1, 2, 3].map((s) => deck.slice(4 * s, 4 * s + 4));
  game.deck = deck.slice(16);
  game.phase = 'bidding1';
  game.turn = game.firstSeat;
  game.bidding = { round: 1, currentBid: null, bidder: null, history: [], passesInRow: 0, bidsThisRound: 0, turnsThisRound: 0, trumpPicks: {} };
  game.contract = null;
  game.trump = { suit: null, card: null, concealed: false, revealed: false, revealedBy: null, revealedInTrick: null };
  game.mustPlayTrump = null;
  game.trick = { index: 0, leader: game.firstSeat, cards: [] };
  game.lastTrick = null;
  game.tricksWon = [0, 0, 0, 0];
  game.teamPoints = [0, 0];
  game.captured = [];
  game.handResult = null;
}

function dealSecond(game) {
  for (let s = 0; s < 4; s++) game.hands[s].push(...game.deck.slice(4 * s, 4 * s + 4));
  game.deck = [];
}

// ---------------------------------------------------------------------------
// Rules helpers
// ---------------------------------------------------------------------------

// Minimum bid to overcall your partner when the opponent in between passed.
export const PARTNER_MIN = 18;
// Second round (after all 8 cards are dealt): only these bids are allowed.
export const ROUND2_BIDS = [20, 24, 28];

function minBidFor(game, seat) {
  const b = game.bidding;
  let min;
  if (b.round === 1) {
    min = b.currentBid == null ? 14 : b.currentBid + 1;
    // Partner rule: partner holds the bid and the opponent before me did not raise it.
    if (b.bidder != null && b.bidder === partnerOf(seat)) {
      const prev = (seat + 3) % 4;
      const lastPrev = [...b.history].reverse().find((h) => h.round === 1 && h.seat === prev);
      if (lastPrev && lastPrev.bid === null) min = Math.max(min, PARTNER_MIN);
    }
  } else {
    // Second round: only 20, 24 or 28, higher than the current bid.
    min = ROUND2_BIDS.find((v) => v > b.currentBid) ?? null;
    if (min == null) return null;
  }
  return min > MAX_BID ? null : min;
}

/** Every bid value allowed now, given the minimum. */
function allowedBids(game, min) {
  if (game.bidding.round === 2) return ROUND2_BIDS.filter((v) => v >= min);
  const out = [];
  for (let v = min; v <= MAX_BID; v++) out.push(v);
  return out;
}

function isFirstBid(game) {
  return game.phase === 'bidding1' && game.bidding.history.length === 0;
}

function ledSuit(game) {
  const c = game.trick.cards[0];
  return c ? suitOf(c.card) : null;
}

function trumpConcealed(game) {
  return game.trump.concealed;
}

/** Returns an error string if `seat` may not play `card` from hand now, else null. */
function playError(game, seat, card) {
  const hand = game.hands[seat];
  if (!isCard(card)) return 'Invalid card';
  if (!hand.includes(card)) return 'You do not hold that card';
  const trump = game.trump;
  const suit = suitOf(card);

  if (game.mustPlayTrump === seat) {
    if (hand.some((c) => suitOf(c) === trump.suit) && suit !== trump.suit) {
      return 'You called for trump and must now play a trump';
    }
    return null;
  }

  const isBidder = seat === game.contract.bidder;
  const led = ledSuit(game);

  if (led === null) {
    if (isBidder && trumpConcealed(game) && suit === trump.suit && hand.some((c) => suitOf(c) !== trump.suit)) {
      return 'The bidder may not lead a trump while trump is concealed';
    }
    return null;
  }

  const canFollow = hand.some((c) => suitOf(c) === led);
  if (canFollow) {
    return suit === led ? null : 'You must follow suit';
  }
  // Exception: once another player has already put a trump-suit card into this
  // trick, the bidder may also play a trump from hand without revealing.
  const othersPlayedTrump = game.trick.cards.some((e) => e.seat !== seat && e.card && suitOf(e.card) === trump.suit);
  if (isBidder && trumpConcealed(game) && led !== trump.suit && suit === trump.suit &&
      hand.some((c) => suitOf(c) !== trump.suit) && !othersPlayedTrump) {
    return 'While trump is concealed the bidder may not trump from hand: discard a non-trump or play the concealed trump card';
  }
  return null;
}

function callTrumpError(game, seat) {
  if (game.phase !== 'playing') return 'Not in play';
  if (seat === game.contract.bidder) return 'The bidder cannot call for trump';
  if (!trumpConcealed(game)) return 'Trump is not concealed';
  const led = ledSuit(game);
  if (led === null) return 'You cannot call for trump when leading';
  if (game.hands[seat].some((c) => suitOf(c) === led)) return 'You can follow suit, so you cannot call for trump';
  return null;
}

function playTrumpCardError(game, seat) {
  if (game.phase !== 'playing') return 'Not in play';
  if (seat !== game.contract.bidder) return 'Only the bidder can play the concealed trump card';
  if (!trumpConcealed(game)) return 'There is no concealed trump card';
  const hand = game.hands[seat];
  if (hand.length === 0) return null; // forced
  const led = ledSuit(game);
  if (led === null) return 'You cannot lead the concealed trump card while you hold other cards';
  if (led === game.trump.suit) return null;
  if (hand.some((c) => suitOf(c) === led)) return 'You must follow suit';
  return null;
}

function computeLegal(game, seat) {
  const legal = { actions: [], minBid: null, maxBid: MAX_BID, bidValues: [], playable: [], trumpChoices: [] };
  if (!isSeat(seat)) return legal;
  if (game.phase === 'handEnd') {
    legal.actions.push('nextHand');
    return legal;
  }
  if (game.turn !== seat) return legal;
  switch (game.phase) {
    case 'bidding1':
    case 'bidding2': {
      const min = minBidFor(game, seat);
      if (isFirstBid(game)) {
        legal.actions.push('bid');
        if (!hasPointCard(game.hands[seat])) legal.actions.push('redeal');
      } else {
        if (min != null) legal.actions.push('bid');
        legal.actions.push('pass');
      }
      legal.minBid = min;
      legal.bidValues = min == null ? [] : allowedBids(game, min);
      break;
    }
    case 'chooseTrump':
      legal.actions.push('chooseTrump');
      legal.trumpChoices = sortHand(game.hands[seat]);
      break;
    case 'playing': {
      legal.playable = sortHand(game.hands[seat].filter((c) => playError(game, seat, c) === null));
      if (legal.playable.length) legal.actions.push('play');
      if (callTrumpError(game, seat) === null && game.mustPlayTrump !== seat) legal.actions.push('callTrump');
      if (playTrumpCardError(game, seat) === null) {
        legal.actions.push('playTrumpCard');
        if (game.hands[seat].length) legal.actions.push('revealTrump'); // nothing to choose from with an empty hand
      }
      break;
    }
  }
  return legal;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function currentTurn(game) {
  return game.phase === 'handEnd' || game.phase === 'matchEnd' ? null : game.turn;
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
  if (!isSeat(seat)) return 'Invalid seat';
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return 'Invalid action';
  if (game.phase === 'matchEnd') return 'The match is over';
  if (action.type === 'nextHand') {
    if (game.phase !== 'handEnd') return 'The hand is not over';
    game.dealer = next(game.dealer);
    startHand(game);
    return null;
  }
  if (game.phase === 'handEnd') return 'The hand is over; waiting for next hand';
  if (action.type === 'endHand') return doEndHand(game, seat); // any seated player, not turn-bound
  if (game.turn !== seat) return 'Not your turn';
  switch (action.type) {
    case 'bid': return doBid(game, seat, action.value, action.trump);
    case 'pass': return doPass(game, seat);
    case 'redeal': return doRedeal(game, seat);
    case 'chooseTrump': return doChooseTrump(game, seat, action.card);
    case 'play': return doPlay(game, seat, action.card);
    case 'callTrump': return doCallTrump(game, seat);
    case 'playTrumpCard': return doPlayTrumpCard(game, seat);
    case 'revealTrump': return doRevealTrump(game, seat);
    default: return `Unknown action type "${action.type}"`;
  }
}

function inBidding(game) {
  return game.phase === 'bidding1' || game.phase === 'bidding2';
}

function doBid(game, seat, value, trump) {
  if (!inBidding(game)) return 'Not in bidding';
  if (!Number.isInteger(value)) return 'Bid must be an integer';
  const min = minBidFor(game, seat);
  if (min == null) return 'No higher bid is possible';
  if (value > MAX_BID) return `Bid cannot exceed ${MAX_BID}`;
  if (value < min) return `Bid must be at least ${min}`;
  if (game.bidding.round === 2 && !ROUND2_BIDS.includes(value)) return 'In the second round you can only bid 20, 24 or 28';
  const b = game.bidding;
  // Optional: name the trump card together with the bid (kept secret; applied if this bid wins).
  if (trump != null) {
    if (!isCard(trump)) return 'Invalid trump card';
    if (!game.hands[seat].includes(trump)) return 'You do not hold that trump card';
    if (b.round === 2 && game.contract && game.contract.bidder === seat) return 'You already have a trump card';
    b.trumpPicks[seat] = trump;
  } else delete b.trumpPicks[seat];
  b.currentBid = value;
  b.bidder = seat;
  b.history.push({ seat, round: b.round, bid: value });
  b.passesInRow = 0;
  b.bidsThisRound += 1;
  log(game, `Seat ${seat} bid ${value}`);
  return afterBidTurn(game, seat);
}

function doPass(game, seat) {
  if (!inBidding(game)) return 'Not in bidding';
  if (isFirstBid(game)) return 'The first bidder must bid';
  const b = game.bidding;
  b.history.push({ seat, round: b.round, bid: null });
  b.passesInRow += 1;
  log(game, `Seat ${seat} passed`);
  return afterBidTurn(game, seat);
}

// Each deal has a single bidding round: every player gets exactly one turn.
function afterBidTurn(game, seat) {
  const b = game.bidding;
  b.turnsThisRound += 1;
  if (b.turnsThisRound >= 4) return b.round === 1 ? endRound1(game) : endRound2(game);
  game.turn = next(seat);
  return null;
}

function doRedeal(game, seat) {
  if (!isFirstBid(game)) return 'Redeal is only allowed for the first bidder before any bid';
  if (hasPointCard(game.hands[seat])) return 'You hold a point card, so you must bid';
  log(game, `Seat ${seat} has no points and asked for a redeal`);
  deal(game);
  return null;
}

function endRound1(game) {
  const b = game.bidding;
  game.contract = { bid: b.currentBid, bidder: b.bidder };
  log(game, `Seat ${b.bidder} wins the first round at ${b.currentBid}`);
  game.phase = 'chooseTrump';
  game.turn = b.bidder;
  return applyTrumpPick(game);
}

/** If the winning bidder named a trump card with their bid, place it now. */
function applyTrumpPick(game) {
  const b = game.bidding;
  const card = b.trumpPicks[b.bidder];
  b.trumpPicks = {};
  if (card && game.hands[b.bidder].includes(card)) return doChooseTrump(game, b.bidder, card);
  return null;
}

function endRound2(game) {
  const b = game.bidding;
  const old = game.contract.bidder;
  game.contract = { bid: b.currentBid, bidder: b.bidder };
  if (b.bidsThisRound === 0) log(game, `Contract stands: seat ${old} at ${b.currentBid}`);
  else log(game, `Seat ${b.bidder} wins the second round at ${b.currentBid}`);
  if (b.bidder !== old) {
    game.hands[old].push(game.trump.card);
    game.trump = { suit: null, card: null, concealed: false, revealed: false, revealedBy: null, revealedInTrick: null };
    game.phase = 'chooseTrump';
    game.turn = b.bidder;
    return applyTrumpPick(game);
  }
  startPlay(game);
  return null;
}

function doChooseTrump(game, seat, card) {
  if (game.phase !== 'chooseTrump') return 'Not choosing trump';
  if (seat !== game.contract.bidder) return 'Only the bidder chooses trump';
  if (!isCard(card)) return 'Invalid card';
  const hand = game.hands[seat];
  const i = hand.indexOf(card);
  if (i < 0) return 'You do not hold that card';
  hand.splice(i, 1);
  game.trump = { suit: suitOf(card), card, concealed: true, revealed: false, revealedBy: null, revealedInTrick: null };
  log(game, `Seat ${seat} placed a trump card face down`);
  if (game.bidding.round === 1) {
    dealSecond(game);
    const jacks = game.hands.findIndex((h) => h.filter((c) => c[0] === 'J').length === 4);
    if (jacks >= 0) {
      log(game, `Seat ${jacks} holds all four Jacks: redeal`);
      deal(game);
      return null;
    }
    const b = game.bidding;
    b.round = 2;
    b.passesInRow = 0;
    b.bidsThisRound = 0;
    b.turnsThisRound = 0;
    b.trumpPicks = {};
    game.phase = 'bidding2';
    game.turn = game.firstSeat;
    return null;
  }
  startPlay(game);
  return null;
}

function startPlay(game) {
  game.phase = 'playing';
  game.turn = game.firstSeat;
  game.trick = { index: 0, leader: game.firstSeat, cards: [] };
  log(game, `Play begins: contract ${game.contract.bid} by seat ${game.contract.bidder}`);
}

function reveal(game, seat) {
  const t = game.trump;
  t.revealed = true;
  t.concealed = false;
  t.revealedBy = seat;
  t.revealedInTrick = game.trick.index;
  for (const e of game.trick.cards) e.faceDown = false;
}

function doPlay(game, seat, card) {
  if (game.phase !== 'playing') return 'Not in play';
  const err = playError(game, seat, card);
  if (err) return err;
  const hand = game.hands[seat];
  hand.splice(hand.indexOf(card), 1);
  const led = ledSuit(game);
  const discard = led !== null && suitOf(card) !== led;
  const faceDown = false; // house rule: discards are always played face up
  game.trick.cards.push({ seat, card, faceDown, discard, afterReveal: game.trump.revealed });
  game.mustPlayTrump = null;
  log(game, faceDown ? `Seat ${seat} played a card face down` : `Seat ${seat} played ${card}`);
  advance(game, seat);
  return null;
}

function doCallTrump(game, seat) {
  const err = callTrumpError(game, seat);
  if (err) return err;
  const bidder = game.contract.bidder;
  reveal(game, seat);
  game.hands[bidder].push(game.trump.card);
  log(game, `Seat ${seat} called for trump: ${game.trump.card} (trump ${game.trump.suit})`);
  game.mustPlayTrump = seat;
  return null;
}

function doPlayTrumpCard(game, seat) {
  const err = playTrumpCardError(game, seat);
  if (err) return err;
  const card = game.trump.card;
  const led = ledSuit(game);
  reveal(game, seat);
  game.trick.cards.push({ seat, card, faceDown: false, discard: led !== null && suitOf(card) !== led, afterReveal: true });
  log(game, `Seat ${seat} revealed and played the trump card ${card}`);
  advance(game, seat);
  return null;
}

/**
 * Bidder reveals the concealed trump without committing to it: the card goes
 * back into their hand and they must now play a trump of their choice.
 */
function doRevealTrump(game, seat) {
  if (game.phase === 'playing' && seat === game.contract.bidder && game.hands[seat].length === 0) return 'Play your concealed trump card';
  const err = playTrumpCardError(game, seat);
  if (err) return err.replace('play the concealed trump card', 'reveal trump');
  reveal(game, seat);
  game.hands[seat].push(game.trump.card);
  log(game, `Seat ${seat} revealed the trump card ${game.trump.card} (trump ${game.trump.suit})`);
  game.mustPlayTrump = seat;
  return null;
}

/** Index into trick.cards of the winning entry. Exported for tests. */
export function trickWinnerIndex(cards, trumpSuit, trumpRevealed) {
  const led = suitOf(cards[0].card);
  let best = -1;
  if (trumpRevealed) {
    cards.forEach((e, i) => {
      if (suitOf(e.card) === trumpSuit && (e.afterReveal || e.discard)) {
        if (best < 0 || rankIndex(e.card) < rankIndex(cards[best].card)) best = i;
      }
    });
    if (best >= 0) return best;
  }
  cards.forEach((e, i) => {
    if (suitOf(e.card) === led && (best < 0 || rankIndex(e.card) < rankIndex(cards[best].card))) best = i;
  });
  return best;
}

function advance(game, seat) {
  const trick = game.trick;
  if (trick.cards.length < 4) {
    game.turn = next(seat);
    return;
  }
  const wi = trickWinnerIndex(trick.cards, game.trump.suit, game.trump.revealed);
  const winner = trick.cards[wi].seat;
  const points = trick.cards.reduce((n, e) => n + pointsOf(e.card), 0);
  game.tricksWon[winner] += 1;
  game.teamPoints[teamOf(winner)] += points;
  game.captured.push(...trick.cards.map((e) => e.card));
  game.lastTrick = { index: trick.index, cards: trick.cards.map((e) => ({ seat: e.seat, card: e.card })), winner, points };
  log(game, `Seat ${winner} won trick ${trick.index + 1} (${points} pts)`);
  if (trick.index === 7) {
    game.trick = { index: 7, leader: winner, cards: [] };
    scoreHand(game);
    return;
  }
  game.trick = { index: trick.index + 1, leader: winner, cards: [] };
  game.turn = winner;
}

/**
 * 'made' when the bidding team already has the contract, 'beaten' when the
 * defenders hold enough points that it can no longer be made, else null.
 */
export function handDecided(game) {
  if (game.phase !== 'playing' || !game.contract) return null;
  const bt = teamOf(game.contract.bidder);
  if (game.teamPoints[bt] >= game.contract.bid) return 'made';
  if (game.teamPoints[1 - bt] > 28 - game.contract.bid) return 'beaten';
  return null;
}

/** Finish the hand early once its result can no longer change. */
function doEndHand(game, seat) {
  const d = handDecided(game);
  if (!d) return game.phase === 'playing' ? 'The contract is not decided yet' : 'Not in play';
  log(game, `Seat ${seat} ended the hand early (contract ${d})`);
  game.endedEarly = true;
  scoreHand(game);
  return null;
}

export function scoreDelta(bid, made) {
  if (bid <= 19) return made ? 1 : -2;
  if (bid <= 24) return made ? 2 : -3;
  return made ? 3 : -4;
}

function scoreHand(game) {
  const { bid, bidder } = game.contract;
  const bt = teamOf(bidder);
  const made = game.teamPoints[bt] >= bid;
  const delta = [0, 0];
  delta[bt] = scoreDelta(bid, made);
  delta[1 - bt] = -delta[bt]; // points are exchanged between the teams
  game.scores[0] += delta[0];
  game.scores[1] += delta[1];
  game.handResult = { bid, bidder, biddingTeam: bt, teamPoints: [...game.teamPoints], made, delta, endedEarly: !!game.endedEarly };
  game.endedEarly = false;
  log(game, `Team ${bt} ${made ? 'made' : 'failed'} ${bid} with ${game.teamPoints[bt]} points (${delta[bt] > 0 ? '+' : ''}${delta[bt]})`);
  if (game.scores[0] < 0) game.matchWinner = 1;
  else if (game.scores[1] < 0) game.matchWinner = 0;
  game.turn = null;
  if (game.matchWinner != null) {
    game.phase = 'matchEnd';
    log(game, `Team ${game.matchWinner} wins the match`);
  } else {
    game.phase = 'handEnd';
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function getView(game, seat) {
  const me = isSeat(seat) ? seat : null;
  const t = game.trump;
  const isBidder = me !== null && game.contract && me === game.contract.bidder && t.card != null;
  const canSeeTrump = t.revealed || isBidder;
  return {
    phase: game.phase,
    seq: game.seq,
    handNumber: game.handNumber,
    dealer: game.dealer,
    firstSeat: game.firstSeat,
    turn: currentTurn(game),
    mySeat: me,
    hand: me === null ? [] : sortHand(game.hands[me]),
    handCounts: game.hands.map((h) => h.length),
    bidding: {
      round: game.bidding.round,
      currentBid: game.bidding.currentBid,
      bidder: game.bidding.bidder,
      history: game.bidding.history.map((h) => ({ ...h })),
    },
    mustPlayTrump: game.mustPlayTrump,
    decided: handDecided(game),
    canEndHand: me !== null && handDecided(game) !== null,
    contract: game.contract ? { ...game.contract } : null,
    trump: {
      concealed: t.concealed,
      revealed: t.revealed,
      suit: canSeeTrump ? t.suit : null,
      card: canSeeTrump ? t.card : null,
      revealedBy: t.revealedBy,
      revealedInTrick: t.revealedInTrick,
    },
    trick: {
      index: game.trick.index,
      leader: game.trick.leader,
      cards: game.trick.cards.map((e) => ({
        seat: e.seat,
        card: e.faceDown && e.seat !== me ? null : e.card,
        faceDown: e.faceDown,
      })),
    },
    lastTrick: game.lastTrick
      ? { ...game.lastTrick, cards: game.lastTrick.cards.map((e) => ({ ...e })) }
      : null,
    tricksWon: [...game.tricksWon],
    teamPoints: [...game.teamPoints],
    scores: [...game.scores],
    targetScore: game.targetScore,
    legal: computeLegal(game, me),
    handResult: game.handResult
      ? { ...game.handResult, teamPoints: [...game.handResult.teamPoints], delta: [...game.handResult.delta] }
      : null,
    matchWinner: game.matchWinner,
    log: [...game.log],
  };
}
