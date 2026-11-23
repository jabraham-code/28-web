// Heuristic bot for 28. chooseAction(view) always returns an action legal per view.legal.

import { SUITS, rankIndex, suitOf, pointsOf } from './cards.js';

const bySuit = (cards, s) => cards.filter((c) => suitOf(c) === s);
// Lower value = cheaper card to throw away.
const value = (c) => pointsOf(c) * 10 + (7 - rankIndex(c));

function lowest(cards, avoidSuit = null) {
  return [...cards].sort((a, b) =>
    ((suitOf(a) === avoidSuit) - (suitOf(b) === avoidSuit)) || (value(a) - value(b)))[0];
}
function highestRank(cards) {
  return [...cards].sort((a, b) => rankIndex(a) - rankIndex(b))[0];
}
function lowestRank(cards) {
  return [...cards].sort((a, b) => rankIndex(b) - rankIndex(a))[0];
}

function isLegal(view, a) {
  const L = view.legal;
  if (!a || !L.actions.includes(a.type)) return false;
  switch (a.type) {
    case 'bid': return Number.isInteger(a.value) && L.minBid != null && a.value >= L.minBid && a.value <= L.maxBid;
    case 'play': return L.playable.includes(a.card);
    case 'chooseTrump': return L.trumpChoices.includes(a.card);
    default: return true;
  }
}

function fallback(view) {
  const L = view.legal;
  const has = (t) => L.actions.includes(t);
  if (has('nextHand')) return { type: 'nextHand' };
  if (has('chooseTrump')) return { type: 'chooseTrump', card: L.trumpChoices[0] };
  if (has('play')) return { type: 'play', card: L.playable[0] };
  if (has('pass')) return { type: 'pass' };
  if (has('bid')) return { type: 'bid', value: L.minBid };
  if (has('redeal')) return { type: 'redeal' };
  if (has('playTrumpCard')) return { type: 'playTrumpCard' };
  if (has('callTrump')) return { type: 'callTrump' };
  return null;
}

export function chooseAction(view) {
  if (!view || !view.legal || view.legal.actions.length === 0) return null;
  let a = null;
  try { a = decide(view); } catch { a = null; }
  return isLegal(view, a) ? a : fallback(view);
}

// ---------------------------------------------------------------------------

function suitStrength(cards, s) {
  const sc = bySuit(cards, s);
  return sc.length * 3 + sc.reduce((n, c) => n + pointsOf(c), 0) +
    (sc.some((c) => c[0] === 'J') ? 3 : 0) + (sc.some((c) => c[0] === '9') ? 1 : 0);
}

function bestSuit(cards) {
  let best = null, bs = -1;
  for (const s of SUITS) {
    if (!bySuit(cards, s).length) continue;
    const v = suitStrength(cards, s);
    if (v > bs) { bs = v; best = s; }
  }
  return best;
}

function estimate(cards) {
  const pts = cards.reduce((n, c) => n + pointsOf(c), 0);
  const s = bestSuit(cards);
  const trumps = bySuit(cards, s);
  const hasJ = trumps.some((c) => c[0] === 'J');
  if (cards.length <= 4) {
    return Math.min(22, Math.floor(13 + pts * 0.8 + (trumps.length - 1) * 1.5 + (hasJ ? 1 : 0)));
  }
  return Math.min(28, Math.floor(4 + pts + trumps.length * 1.5 + (hasJ ? 2 : 0)));
}

function decideBid(view) {
  const L = view.legal;
  const me = view.mySeat;
  const partner = (me + 2) % 4;
  const mustBid = !L.actions.includes('pass');
  if (mustBid) return { type: 'bid', value: L.minBid };
  if (L.minBid == null || !L.actions.includes('bid')) return { type: 'pass' };
  const cards = [...view.hand];
  if (view.trump.card) cards.push(view.trump.card); // I'm the bidder holding a concealed card
  let est = estimate(cards);
  if (view.bidding.bidder === partner) est -= 2; // don't fight partner without a reason
  if (view.bidding.round === 2 && view.bidding.bidder === me) est -= 1; // raising self is risky
  return L.minBid <= est ? { type: 'bid', value: L.minBid } : { type: 'pass' };
}

function decideTrump(view) {
  const cards = view.legal.trumpChoices;
  const s = bestSuit(cards);
  return { type: 'chooseTrump', card: lowest(bySuit(cards, s)) };
}

// Visible current winner of the trick.
function trickStatus(view) {
  const cards = view.trick.cards;
  const t = view.trump;
  const led = suitOf(cards[0].card);
  let best = null, power = false;
  for (const e of cards) {
    if (!e.card) continue;
    const isPower = t.revealed && t.suit && suitOf(e.card) === t.suit;
    if (isPower && (!power || rankIndex(e.card) < rankIndex(best.card))) { best = e; power = true; }
    else if (!power && suitOf(e.card) === led && (!best || rankIndex(e.card) < rankIndex(best.card))) best = e;
  }
  return { winner: best, power, led };
}

function beats(card, status, trumpSuit, trumpRevealed) {
  const w = status.winner;
  if (!w) return true;
  const isPower = trumpRevealed && suitOf(card) === trumpSuit;
  if (status.power) return isPower && rankIndex(card) < rankIndex(w.card);
  if (isPower) return true;
  return suitOf(card) === status.led && rankIndex(card) < rankIndex(w.card);
}

function decidePlay(view) {
  const L = view.legal;
  const me = view.mySeat;
  const myTeam = me % 2;
  const t = view.trump;
  const tSuit = t.suit; // null if unknown to me
  const playable = L.playable;
  const cards = view.trick.cards;
  const has = (a) => L.actions.includes(a);

  if (!playable.length) {
    if (has('playTrumpCard')) return { type: 'playTrumpCard' };
    return null;
  }

  // Leading.
  if (cards.length === 0) {
    const isBidTeam = view.contract && view.contract.bidder % 2 === myTeam;
    if (t.revealed && isBidTeam) {
      const trumps = bySuit(playable, tSuit);
      const topTrump = trumps.find((c) => c[0] === 'J');
      if (topTrump) return { type: 'play', card: topTrump };
    }
    const jacks = playable.filter((c) => c[0] === 'J' && suitOf(c) !== tSuit);
    if (jacks.length) return { type: 'play', card: jacks[0] };
    // Lowest card from my longest non-trump suit.
    let pool = playable.filter((c) => suitOf(c) !== tSuit);
    if (!pool.length) pool = playable;
    const longest = SUITS.filter((s) => bySuit(pool, s).length)
      .sort((a, b) => bySuit(pool, b).length - bySuit(pool, a).length)[0];
    return { type: 'play', card: lowest(bySuit(pool, longest)) };
  }

  const status = trickStatus(view);
  const led = status.led;
  const winnerSeat = status.winner ? status.winner.seat : null;
  const partnerWinning = winnerSeat !== null && winnerSeat % 2 === myTeam;
  const lastToPlay = cards.length === 3;
  const trickPts = cards.reduce((n, e) => n + (e.card ? pointsOf(e.card) : 0), 0);
  const canFollow = view.hand.some((c) => suitOf(c) === led);
  const partnerSafe = partnerWinning &&
    (lastToPlay || status.power || (status.winner && status.winner.card[0] === 'J'));

  if (canFollow) {
    if (partnerSafe) {
      const feed = [...playable].sort((a, b) => pointsOf(b) - pointsOf(a) || rankIndex(b) - rankIndex(a))[0];
      return { type: 'play', card: feed };
    }
    if (!partnerWinning) {
      const winners = playable.filter((c) => beats(c, status, tSuit, t.revealed));
      if (winners.length) {
        return { type: 'play', card: lastToPlay ? lowestRank(winners) : highestRank(winners) };
      }
    }
    return { type: 'play', card: lowest(playable) };
  }

  // Cannot follow.
  if (has('callTrump') && !partnerWinning && (trickPts >= 2 || lastToPlay && trickPts >= 1)) {
    return { type: 'callTrump' };
  }
  if (has('playTrumpCard') && !partnerWinning && trickPts >= 3) {
    return { type: 'playTrumpCard' };
  }
  if (t.revealed && tSuit) {
    const trumps = bySuit(playable, tSuit);
    if (!partnerSafe && trumps.length) {
      const winners = trumps.filter((c) => beats(c, status, tSuit, true));
      if (winners.length && (trickPts >= 1 || lastToPlay || !partnerWinning)) {
        return { type: 'play', card: lowestRank(winners) };
      }
    }
    if (partnerSafe) {
      const nonTrump = playable.filter((c) => suitOf(c) !== tSuit && c[0] !== 'J');
      const pool = nonTrump.length ? nonTrump : playable;
      const feed = [...pool].sort((a, b) => pointsOf(b) - pointsOf(a) || rankIndex(b) - rankIndex(a))[0];
      return { type: 'play', card: feed };
    }
  }
  return { type: 'play', card: lowest(playable, tSuit) };
}

function decide(view) {
  const L = view.legal;
  if (L.actions.includes('nextHand')) return { type: 'nextHand' };
  if (L.actions.includes('redeal')) return { type: 'redeal' };
  if (L.actions.includes('chooseTrump')) return decideTrump(view);
  if (view.phase === 'bidding1' || view.phase === 'bidding2') return decideBid(view);
  if (view.phase === 'playing') return decidePlay(view);
  return null;
}
