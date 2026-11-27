// 13-card Indian Rummy: card helpers, meld validation and hand scoring.
// Pure ES module with no Node or DOM dependencies: used by the server engine, the bots
// and the browser UI. See RUMMY.md section 1.
//
// Card ids: rank + suit + deck number ("7H1", "TD2", "AS1"); printed jokers "X1", "X2".

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
export const SUITS = ['S', 'H', 'D', 'C'];
export const MAX_POINTS = 80;

const RV = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13 };
const INF = 1e9;
const EPS = 1 / 1024;
const ALL = newDeck();
const ALL_SET = new Set(ALL);

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

export function isPrintedJoker(card) {
  return typeof card === 'string' && card[0] === 'X';
}
/** Rank character ('A'..'K'), or 'X' for a printed joker. */
export function rankOf(card) {
  return card[0];
}
/** Suit character, or null for a printed joker. */
export function suitOf(card) {
  return isPrintedJoker(card) ? null : card[1];
}
/** Deck number (1 or 2). */
export function deckOf(card) {
  return Number(card[card.length - 1]);
}
/** Numeric rank, A = 1 .. K = 13 (null for printed jokers). */
export function rankValue(card) {
  return RV[card[0]] ?? null;
}
export function isCardId(card) {
  return typeof card === 'string' && ALL_SET.has(card);
}
/** The 106 card ids (2 x 52 + 2 printed jokers), in a fixed order. */
export function newDeck() {
  const out = [];
  for (const d of [1, 2]) for (const s of SUITS) for (const r of RANKS) out.push(r + s + d);
  out.push('X1', 'X2');
  return out;
}
/** Wild rank for a turned-up wild card: its rank, or 'A' when it is a printed joker. */
export function wildRankFor(wildCard) {
  return isPrintedJoker(wildCard) ? 'A' : wildCard[0];
}
export function isWild(card, wildRank) {
  return isPrintedJoker(card) || card[0] === wildRank;
}
export function cardPoints(card, wildRank) {
  if (isWild(card, wildRank)) return 0;
  const v = RV[card[0]];
  return v === 1 || v >= 10 ? 10 : v;
}
/** Display / sort helper: suit-major, rank-minor (A low); printed jokers last. */
export function sortCards(cards, by = 'suit') {
  const key = (c) => {
    if (isPrintedJoker(c)) return 1e6;
    const s = SUITS.indexOf(c[1]), r = RV[c[0]];
    return by === 'rank' ? r * 10 + s : s * 100 + r;
  };
  return [...cards].sort((a, b) => key(a) - key(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Group classification (for any group of cards, e.g. the UI's manual groups)
// ---------------------------------------------------------------------------

// Smallest span covering the given distinct rank values, trying Ace low and Ace high.
function spanOf(values) {
  let lo = Infinity, hi = -Infinity, hasAce = false;
  for (const v of values) { if (v === 1) hasAce = true; if (v < lo) lo = v; if (v > hi) hi = v; }
  let span = hi - lo + 1;
  if (hasAce) {
    let lo2 = Infinity, hi2 = -Infinity;
    for (const v0 of values) { const v = v0 === 1 ? 14 : v0; if (v < lo2) lo2 = v; if (v > hi2) hi2 = v; }
    span = Math.min(span, hi2 - lo2 + 1);
  }
  return span;
}

/**
 * classifyGroup(cards, wildRank) -> 'pure' | 'impure' | 'set' | null
 * pure: 3+ consecutive same-suit cards, no joker substitutes (a wild-rank card in its natural place is fine).
 * impure: a sequence using jokers (printed or wild-rank) as substitutes. A group of only jokers counts as impure.
 * set: 3-4 cards of one rank, all different suits, jokers may substitute.
 */
export function classifyGroup(cards, wildRank) {
  if (!Array.isArray(cards) || cards.length < 3) return null;
  if (new Set(cards).size !== cards.length || !cards.every(isCardId)) return null;
  const n = cards.length;
  // pure: every card natural
  if (!cards.some(isPrintedJoker)) {
    const suit = cards[0][1];
    if (cards.every((c) => c[1] === suit)) {
      const vals = cards.map((c) => RV[c[0]]);
      if (new Set(vals).size === n && spanOf(vals) === n && n <= 13) return 'pure';
    }
  }
  const nat = cards.filter((c) => !isWild(c, wildRank));
  if (nat.length === 0) return 'impure';
  // impure sequence
  const suit = nat[0][1];
  if (n <= 13 && nat.every((c) => c[1] === suit)) {
    const vals = nat.map((c) => RV[c[0]]);
    if (new Set(vals).size === nat.length && spanOf(vals) <= n) return 'impure';
  }
  // set
  const rank = nat[0][0];
  if (n <= 4 && nat.every((c) => c[0] === rank) && new Set(nat.map((c) => c[1])).size === nat.length) return 'set';
  return null;
}

// ---------------------------------------------------------------------------
// Arrangement search
// ---------------------------------------------------------------------------
//
// Jokers (printed + wild-rank cards) are a pooled resource. Wild-rank cards that could sit in a
// pure sequence as their natural self are tried both ways ("designated natural" or joker).
// For each designation we enumerate candidate melds over the natural cards (bitmasks + the
// number of jokers they need), then a memoised DFS removes the lowest remaining card each step
// (either as deadwood, or together with a candidate meld containing it).
// State flags: p = has a pure sequence, s = number of sequences (capped at 2),
// np = used a non-pure meld. The terminal table T[p*6 + s*2 + np] adds the case cost.

const SCORE_TERMINAL = (() => {
  const t = new Array(12).fill(INF);
  for (let s = 0; s < 3; s++) for (let np = 0; np < 2; np++) {
    // case A (2 sequences incl. a pure one): any melds; case B (pure only): only pure melds excluded.
    // Case B carries a tiny tie-break so an equally scored valid layout (case A) is preferred.
    if (s >= 2) t[6 + s * 2 + np] = 0;
    else if (np === 0) t[6 + s * 2 + np] = EPS;
  }
  return t;
})();

/** Build a terminal table from penalties (for heuristic evaluations, e.g. bots). */
export function makeTerminal({ noPure = 0, noSecondSeq = 0, score = false } = {}) {
  if (score) return SCORE_TERMINAL;
  const t = new Array(12);
  for (let p = 0; p < 2; p++) for (let s = 0; s < 3; s++) for (let np = 0; np < 2; np++) {
    t[p * 6 + s * 2 + np] = (p ? 0 : noPure) + (s >= 2 ? 0 : noSecondSeq);
  }
  return t;
}

function near(a, b) {
  const va = RV[a[0]], vb = RV[b[0]];
  const d = Math.abs(va - vb);
  if (d > 0 && d <= 2) return true;
  if (va === 1 && 14 - vb <= 2) return true;
  if (vb === 1 && 14 - va <= 2) return true;
  return false;
}

/** Candidate melds over `nat` (natural cards). `pureOnly[i]`: card i may only be in pure sequences. */
function candidates(nat, J, pureOnly) {
  const n = nat.length;
  const map = new Map(); // key mask*4+kind -> min jokers
  const add = (mask, k, kind) => {
    const key = mask * 4 + kind;
    const prev = map.get(key);
    if (prev === undefined || k < prev) map.set(key, k);
  };
  // sequences, per suit
  for (const suit of SUITS) {
    const idx = [];
    for (let i = 0; i < n; i++) if (nat[i][1] === suit) idx.push(i);
    if (!idx.length) continue;
    for (const aceHigh of [false, true]) {
      const val = (i) => { const v = RV[nat[i][0]]; return aceHigh && v === 1 ? 14 : v; };
      // group by rank value, ascending
      const byV = new Map();
      for (const i of idx) { const v = val(i); if (!byV.has(v)) byV.set(v, []); byV.get(v).push(i); }
      const vals = [...byV.keys()].sort((a, b) => a - b);
      if (aceHigh && !byV.has(14)) continue;
      const rec = (pos, mask, count, lo, hi, anyPureOnly, hasAce) => {
        if (count > 0) {
          const gaps = hi - lo + 1 - count;
          if (gaps > J) return;
          if (!aceHigh || hasAce) {
            const k = Math.max(gaps, 3 - count);
            if (k <= J) {
              if (k === 0) add(mask, 0, 0);
              else if (!anyPureOnly) add(mask, k, 1);
            }
          }
        }
        for (let q = pos; q < vals.length; q++) {
          const v = vals[q];
          if (count > 0 && v - hi - 1 > J) break; // gap only grows
          for (const i of byV.get(v)) {
            rec(q + 1, mask | (1 << i), count + 1, count ? lo : v, v, anyPureOnly || pureOnly[i], hasAce || v === 14);
          }
        }
      };
      rec(0, 0, 0, 0, 0, false, false);
    }
  }
  // sets, per rank (natural cards that are not wild-designated)
  const byRank = new Map();
  for (let i = 0; i < n; i++) if (!pureOnly[i]) {
    const r = nat[i][0];
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(i);
  }
  for (const list of byRank.values()) {
    if (list.length < 2) continue;
    const m = list.length;
    for (let sub = 1; sub < 1 << m; sub++) {
      let mask = 0, count = 0, suits = 0, ok = true;
      for (let b = 0; b < m; b++) if (sub & (1 << b)) {
        const i = list[b];
        const sb = 1 << SUITS.indexOf(nat[i][1]);
        if (suits & sb) { ok = false; break; }
        suits |= sb; mask |= 1 << i; count++;
      }
      if (!ok || count < 2 || count > 4) continue;
      const k = Math.max(0, 3 - count);
      if (k <= J) add(mask, k, 2);
    }
  }
  // bucket by lowest bit
  const byLow = Array.from({ length: n }, () => []);
  for (const [key, k] of map) {
    const kind = key % 4, mask = (key - kind) / 4;
    const low = 31 - Math.clz32(mask & -mask);
    byLow[low].push({ mask, k, kind });
  }
  return byLow;
}

function solveOne(nat, pts, pureOnly, J, T, reconstruct) {
  const n = nat.length;
  const byLow = candidates(nat, J, pureOnly);
  const memo = new Map();
  const choice = reconstruct ? new Map() : null;
  const dfs = (rem, j, p, s, np) => {
    if (rem === 0) {
      let c = T[p * 6 + s * 2 + np];
      let useJ = false;
      if (j >= 3) { // the leftover jokers alone can form an (impure) sequence
        const c2 = T[p * 6 + Math.min(2, s + 1) * 2 + 1];
        if (c2 < c) { c = c2; useJ = true; }
      }
      if (choice) choice.set((rem * 16 + j) * 12 + p * 6 + s * 2 + np, useJ ? -2 : -3);
      return c;
    }
    const key = (rem * 16 + j) * 12 + p * 6 + s * 2 + np;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const i = 31 - Math.clz32(rem & -rem);
    let best = pts[i] + dfs(rem & ~(1 << i), j, p, s, np);
    let bestC = -1;
    const list = byLow[i];
    for (let ci = 0; ci < list.length; ci++) {
      const m = list[ci];
      if (m.k > j || (m.mask & rem) !== m.mask) continue;
      const v = dfs(rem & ~m.mask, j - m.k, m.kind === 0 ? 1 : p, m.kind < 2 ? (s < 2 ? s + 1 : 2) : s, m.kind === 0 ? np : 1);
      if (v < best) { best = v; bestC = ci; }
    }
    memo.set(key, best);
    if (choice) choice.set(key, bestC);
    return best;
  };
  const full = n >= 31 ? 0 : (1 << n) - 1;
  const cost = dfs(full, J, 0, 0, 0);
  if (!reconstruct || cost >= INF) return { cost };
  // walk the choices
  const melds = [];
  const dead = [];
  let rem = full, j = J, p = 0, s = 0, np = 0, jokerSeq = false;
  for (;;) {
    const key = (rem * 16 + j) * 12 + p * 6 + s * 2 + np;
    const c = choice.get(key);
    if (rem === 0) { jokerSeq = c === -2; break; }
    const i = 31 - Math.clz32(rem & -rem);
    if (c === -1) { dead.push(i); rem &= ~(1 << i); continue; }
    const m = byLow[i][c];
    melds.push(m);
    rem &= ~m.mask; j -= m.k;
    if (m.kind === 0) p = 1; else np = 1;
    if (m.kind < 2) s = Math.min(2, s + 1);
  }
  if (jokerSeq) { s = Math.min(2, s + 1); np = 1; }
  return { cost, melds, dead, jokersLeft: j, jokerSeq, p, s, np };
}

function splitHand(cards, wildRank) {
  const printed = [], wild = [], nat = [];
  for (const c of cards) {
    if (isPrintedJoker(c)) printed.push(c);
    else if (c[0] === wildRank) wild.push(c);
    else nat.push(c);
  }
  // wild-rank cards worth trying as natural members of a pure sequence
  const useful = wild.filter((w) => nat.some((x) => x[1] === w[1] && near(w, x)));
  return { printed, wild, nat, useful };
}

/** Core search. Returns the best (lowest cost) designation result. */
function search(cards, wildRank, T, reconstruct) {
  const { printed, wild, nat, useful } = splitHand(cards, wildRank);
  let best = null;
  const U = useful.length;
  // all-designated first, so ties prefer showing wild-rank cards as their natural selves
  for (let sub = (1 << U) - 1; sub >= 0; sub--) {
    const desig = useful.filter((_, b) => sub & (1 << b));
    const natural = nat.concat(desig);
    const pts = natural.map((c) => cardPoints(c, wildRank));
    const pureOnly = natural.map((_, i) => i >= nat.length);
    const jokers = printed.concat(wild.filter((w) => !desig.includes(w)));
    const r = solveOne(natural, pts, pureOnly, jokers.length, T, reconstruct);
    if (!best || r.cost < best.cost) best = { ...r, natural, jokers, nDesig: desig.length, natCount: nat.length };
  }
  return best;
}

/** Heuristic/score cost only (no arrangement), e.g. for bots. */
export function evaluateHand(cards, wildRank, terminal = SCORE_TERMINAL) {
  return search(cards, wildRank, terminal, false).cost;
}

/**
 * Cost plus the natural (non-wild) cards left out of melds under a custom terminal table
 * (see makeTerminal). Used by bots to look at what is still loose in a hand.
 */
export function analyseHand(cards, wildRank, terminal = SCORE_TERMINAL) {
  const r = search(cards, wildRank, terminal, true);
  if (!r || r.cost >= INF) return { cost: r ? r.cost : INF, deadwood: cards.filter((c) => !isWild(c, wildRank)) };
  return { cost: r.cost, deadwood: r.dead.map((i) => r.natural[i]).filter((c) => !isWild(c, wildRank)) };
}

/** Lay out a sequence: naturals in rank order, jokers filling the gaps, extras at the ends. */
function orderSequence(nats, jokers) {
  if (!nats.length) return [...jokers];
  const vals = nats.map((c) => RV[c[0]]);
  let useHigh = false;
  if (vals.includes(1)) {
    const lowSpan = Math.max(...vals) - Math.min(...vals);
    const hv = vals.map((v) => (v === 1 ? 14 : v));
    useHigh = Math.max(...hv) - Math.min(...hv) < lowSpan;
  }
  const v = (c) => { const x = RV[c[0]]; return useHigh && x === 1 ? 14 : x; };
  const sorted = [...nats].sort((a, b) => v(a) - v(b));
  const js = [...jokers];
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    for (let g = v(sorted[i - 1]) + 1; g < v(sorted[i]) && js.length; g++) out.push(js.shift());
    out.push(sorted[i]);
  }
  let hi = v(sorted[sorted.length - 1]);
  while (js.length && hi < 14) { out.push(js.shift()); hi++; }
  while (js.length) out.unshift(js.shift());
  return out;
}

/**
 * bestArrangement(cards, wildRank) -> { groups:[{type, cards}], deadwood:[ids], points, valid }
 * Minimises points over the three scoring cases of RUMMY.md section 1 (capped at 80).
 * valid: at least two sequences, one of them pure, and no deadwood (a valid declaration).
 */
export function bestArrangement(cards, wildRank) {
  if (cards.length > 28) throw new Error('bestArrangement: too many cards');
  const total = cards.reduce((n, c) => n + cardPoints(c, wildRank), 0);
  const r = search(cards, wildRank, SCORE_TERMINAL, true);
  if (!r || r.cost >= INF || r.cost > total) {
    return { groups: [], deadwood: [...cards], points: Math.min(MAX_POINTS, total), valid: false };
  }
  const { natural, melds, dead } = r;
  const jokers = [...r.jokers];
  const groups = melds.map((m) => {
    const nats = natural.filter((_, i) => m.mask & (1 << i));
    const js = jokers.splice(0, m.k);
    const type = m.kind === 0 ? 'pure' : m.kind === 1 ? 'impure' : 'set';
    return { type, cards: type === 'set' ? nats.concat(js) : orderSequence(nats, js) };
  });
  const deadNat = dead.map((i) => natural[i]);
  const caseA = r.p === 1 && r.s >= 2;
  let deadwood;
  if (caseA) {
    // spare jokers and unused wild-rank cards join a meld; only real deadwood remains
    const spare = jokers.concat(deadNat.filter((c) => isWild(c, wildRank)));
    deadwood = deadNat.filter((c) => !isWild(c, wildRank));
    if (r.jokerSeq) groups.push({ type: 'impure', cards: spare.splice(0) });
    if (spare.length) {
      let g = groups.find((x) => x.type === 'impure');
      if (!g) { const pures = groups.filter((x) => x.type === 'pure'); g = pures.length >= 2 ? pures[pures.length - 1] : null; }
      if (!g) g = groups.find((x) => x.type === 'set' && x.cards.length + spare.length <= 4);
      if (g) {
        if (g.type === 'set') g.cards.push(...spare);
        else {
          const nats = g.cards.filter((c) => !isPrintedJoker(c) && !(g.type === 'impure' && isWild(c, wildRank)));
          const js = g.cards.filter((c) => !nats.includes(c)).concat(spare);
          g.cards = orderSequence(nats, js);
          g.type = classifyGroup(g.cards, wildRank) || 'impure';
        }
      } else deadwood.push(...spare); // cannot happen with two sequences; kept for safety
    }
  } else {
    deadwood = deadNat.concat(jokers);
  }
  const valid = caseA && deadwood.length === 0 && cards.length >= 3;
  const points = valid ? 0 : Math.min(MAX_POINTS, Math.floor(r.cost));
  return { groups, deadwood, points, valid };
}

/** Points of the best arrangement (cost only, no layout). */
export function handPoints(cards, wildRank) {
  const total = cards.reduce((n, c) => n + cardPoints(c, wildRank), 0);
  const c = Math.floor(evaluateHand(cards, wildRank, SCORE_TERMINAL));
  return Math.min(MAX_POINTS, c, total);
}

/**
 * bestDiscard(cards14, wildRank, { exclude }) -> card id whose removal minimises the points of
 * the remaining cards. Ties: discard the higher-value card; never a joker over a non-joker on a tie.
 */
export function bestDiscard(cards, wildRank, { exclude = [] } = {}) {
  let best = null, bestPts = Infinity, bestVal = -1;
  const seen = new Set();
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (exclude.includes(c)) continue;
    const id = isPrintedJoker(c) ? 'X' : c.slice(0, 2);
    if (seen.has(id)) continue;
    seen.add(id);
    const rest = cards.slice(0, i).concat(cards.slice(i + 1));
    const p = handPoints(rest, wildRank);
    const val = isWild(c, wildRank) ? -0.5 : cardPoints(c, wildRank) + RV[c[0]] / 100;
    if (p < bestPts || (p === bestPts && val > bestVal)) { best = c; bestPts = p; bestVal = val; }
  }
  return best;
}

/** A finishing card that leaves a valid declaration, or null. Prefers the highest-value card. */
export function findDeclaration(cards, wildRank, { exclude = [] } = {}) {
  let best = null, bestVal = -1;
  const seen = new Set();
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (exclude.includes(c)) continue;
    const id = isPrintedJoker(c) ? 'X' : c.slice(0, 2);
    if (seen.has(id)) continue;
    seen.add(id);
    const rest = cards.slice(0, i).concat(cards.slice(i + 1));
    if (evaluateHand(rest, wildRank, VALID_TERMINAL) === 0) {
      const val = isWild(c, wildRank) ? -1 : cardPoints(c, wildRank);
      if (val > bestVal) { best = c; bestVal = val; }
    }
  }
  return best;
}

// Valid iff 2 sequences incl. a pure one and zero deadwood (wild/jokers deadwood cost 0 and are absorbable).
const VALID_TERMINAL = (() => {
  const t = new Array(12).fill(INF);
  for (let np = 0; np < 2; np++) t[6 + 2 * 2 + np] = 0;
  return t;
})();

/** True iff `cards` (13) form a valid declaration. */
export function isValidDeclaration(cards, wildRank) {
  return evaluateHand(cards, wildRank, VALID_TERMINAL) === 0;
}
