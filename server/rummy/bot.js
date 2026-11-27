// Classic heuristic bot for 13-card Rummy. chooseAction(view) always returns an action legal per view.legal.

import {
  isWild, cardPoints, rankValue, isPrintedJoker, analyseHand, makeTerminal, bestArrangement,
} from '../../public/js/shared/rummy-melds.js';

// Heuristic: melds anywhere count, but missing the pure / second sequence is penalised, so the bot
// builds towards a valid declaration. Cost 0 means the hand is a valid declaration.
const BOT_T = makeTerminal({ noPure: 40, noSecondSeq: 20 });
const FIRST_DROP_THRESHOLD = 108; // heuristic cost of an opening hand worth dropping (~10% of opening hands)

function isLegal(view, a) {
  const L = view.legal;
  if (!a || !L || !L.actions.includes(a.type)) return false;
  switch (a.type) {
    case 'draw': return a.from === 'open' ? L.canDrawOpen : a.from === 'closed' ? L.canDrawClosed !== false : false;
    case 'discard': return L.discardable.includes(a.card);
    case 'declare': return view.hand.includes(a.card);
    default: return true;
  }
}

function fallback(view) {
  const L = view.legal;
  const has = (t) => L.actions.includes(t);
  if (has('nextDeal')) return { type: 'nextDeal' };
  if (has('draw')) return { type: 'draw', from: L.canDrawClosed !== false ? 'closed' : 'open' };
  if (has('discard') && L.discardable.length) return { type: 'discard', card: L.discardable[0] };
  if (has('drop')) return { type: 'drop' };
  return null;
}

export function chooseAction(view) {
  if (!view || !view.legal || view.legal.actions.length === 0) return null;
  let a = null;
  try { a = decide(view); } catch { a = null; }
  return isLegal(view, a) ? a : fallback(view);
}

// ---------------------------------------------------------------------------

/** Two loose cards help each other: same suit within 2 ranks, or same rank. */
function related(a, b) {
  if (a === b || isPrintedJoker(a) || isPrintedJoker(b)) return false;
  if (a[0] === b[0]) return a[1] !== b[1];
  if (a[1] !== b[1]) return false;
  const va = rankValue(a), vb = rankValue(b);
  const d = Math.abs(va - vb);
  return (d >= 1 && d <= 2) || (va === 1 && vb >= 12) || (vb === 1 && va >= 12);
}

/** Lower is better. 0 = valid declaration. */
export function handScore(cards, wildRank) {
  const { cost, deadwood } = analyseHand(cards, wildRank, BOT_T);
  if (cost === 0) return 0;
  let s = cost;
  for (const c of deadwood) {
    if (deadwood.some((d) => related(c, d))) s -= cardPoints(c, wildRank) * 0.5;
  }
  return Math.max(0.01, s);
}

/** Best card to let go of from a 14-card hand: { card, score, declare }. */
function pickDiscard(hand, wildRank, allowed) {
  let best = null;
  const seen = new Set();
  const nonJokers = allowed.filter((c) => !isWild(c, wildRank));
  const pool = nonJokers.length ? nonJokers : allowed; // never throw a joker unless forced
  for (const c of pool) {
    const id = c.slice(0, 2);
    if (seen.has(id)) continue;
    seen.add(id);
    const i = hand.indexOf(c);
    const rest = hand.slice(0, i).concat(hand.slice(i + 1));
    const score = handScore(rest, wildRank);
    const val = cardPoints(c, wildRank) + rankValue(c) / 100;
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && val > best.val)) {
      best = { card: c, score, val };
    }
  }
  return best;
}

function decide(view) {
  const L = view.legal;
  const has = (t) => L.actions.includes(t);
  const W = view.wildRank;
  const hand = view.hand;
  if (has('nextDeal')) return { type: 'nextDeal' };

  if (has('drop') && view.step === 'draw') {
    if (L.dropPoints === 20 && shouldFirstDrop(hand, W)) return { type: 'drop' };
    if (!has('draw')) return { type: 'drop' };
    const top = view.openTop;
    if (L.canDrawOpen && top && takeOpen(hand, top, W)) return { type: 'draw', from: 'open' };
    if (L.canDrawClosed !== false) return { type: 'draw', from: 'closed' };
    return { type: 'draw', from: 'open' };
  }

  if (has('discard')) {
    // the card just taken from the open pile may still be the finishing card of a declaration
    const best = pickDiscard(hand, W, L.discardable);
    if (best && best.score === 0 && confirmValid(hand, best.card, W)) return { type: 'declare', card: best.card };
    if (view.justDrew && view.justDrew.from === 'open') {
      const jd = view.justDrew.card;
      const i = hand.indexOf(jd);
      if (handScore(hand.slice(0, i).concat(hand.slice(i + 1)), W) === 0 && confirmValid(hand, jd, W)) return { type: 'declare', card: jd };
    }
    return { type: 'discard', card: best ? best.card : L.discardable[0] };
  }
  return null;
}

function takeOpen(hand, top, W) {
  if (isWild(top, W)) return true;
  if (!hand.some((c) => related(c, top))) return false; // cannot help any meld
  const now = handScore(hand, W);
  const after = pickDiscard([...hand, top], W, hand);
  return after.score === 0 || after.score < now - 1;
}

function shouldFirstDrop(hand, W) {
  if (hand.some((c) => isWild(c, W))) return false;
  const arr = bestArrangement(hand, W);
  if (arr.groups.some((g) => g.type === 'pure')) return false;
  return handScore(hand, W) >= FIRST_DROP_THRESHOLD;
}

function confirmValid(hand, card, W) {
  const i = hand.indexOf(card);
  return bestArrangement(hand.slice(0, i).concat(hand.slice(i + 1)), W).valid;
}
