// Client meld helpers. Prefers the shared engine module (/js/shared/rummy-melds.js, same code as the
// server) and falls back to a local implementation of the RUMMY.md §1 rules while it is unavailable.
import { RANKS, isJoker, rRank, rSuit, isWildCard } from './rcards.js';

// ------------------------------------------------------------------ local fallback
const VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 1])); // A=1 .. K=13
function fbPoints(id, wildRank) {
  if (isWildCard(id, wildRank)) return 0;
  const r = rRank(id);
  return ['A', 'K', 'Q', 'J', 'T'].includes(r) ? 10 : Number(r);
}
function seqFits(vals, jokers) {
  // vals: natural values of one suit; can jokers fill the gaps of a run (Ace low or high, no wrap-around)?
  const n = vals.length + jokers;
  if (n > 13) return false;
  if (!vals.length) return true;
  const fits = (vs) => {
    const s = [...vs].sort((a, b) => a - b);
    if (new Set(s).size !== s.length) return false;
    return s[s.length - 1] - s[0] + 1 - s.length <= jokers;
  };
  return fits(vals) || (vals.includes(1) && fits(vals.map((v) => (v === 1 ? 14 : v))));
}
function fbClassify(cards, wildRank) {
  if (!cards || cards.length < 3) return null;
  const printed = cards.filter(isJoker);
  const real = cards.filter((c) => !isJoker(c));
  // pure: every card natural (wild-rank cards as themselves)
  if (!printed.length && new Set(real.map(rSuit)).size === 1 && seqFits(real.map((c) => VAL[rRank(c)]), 0)) return 'pure';
  const jokers = cards.filter((c) => isWildCard(c, wildRank));
  const nat = cards.filter((c) => !isWildCard(c, wildRank));
  if (nat.length && new Set(nat.map(rSuit)).size === 1 && seqFits(nat.map((c) => VAL[rRank(c)]), jokers.length)) return 'impure';
  if (cards.length <= 4) {
    const base = nat.length ? nat : real;
    if (base.length && new Set(base.map(rRank)).size === 1 && new Set(base.map(rSuit)).size === base.length) return 'set';
  }
  if (!nat.length) return 'impure'; // all jokers
  return null;
}
function fbBest(cards, wildRank) {
  const n = cards.length;
  const pts = cards.map((c) => fbPoints(c, wildRank));
  const total = pts.reduce((a, b) => a + b, 0);
  const melds = []; // { mask, type }
  for (let m = 1; m < 1 << n; m++) {
    let k = 0; for (let x = m; x; x &= x - 1) k++;
    if (k < 3) continue;
    const sub = cards.filter((_, i) => m & (1 << i));
    const t = fbClassify(sub, wildRank);
    if (t) melds.push({ mask: m, type: t });
  }
  const byLow = Array.from({ length: n }, () => []);
  for (const md of melds) byLow[31 - Math.clz32(md.mask & -md.mask)].push(md);
  const ptsOf = (mask) => { let s = 0; for (let i = 0; i < n; i++) if (mask & (1 << i)) s += pts[i]; return s; };
  // dp over decided-card masks; state key p (has pure 0/1), s (sequences 0..2) -> min deadwood
  function solve(filter) {
    const memo = new Map();
    const full = (1 << n) - 1;
    const rec = (mask) => {
      if (mask === full) return { '00': { dw: 0 } };
      if (memo.has(mask)) return memo.get(mask);
      let c = 0; while (mask & (1 << c)) c++;
      const out = {};
      const put = (key, dw, choice) => { if (!out[key] || dw < out[key].dw) out[key] = { dw, ...choice }; };
      const skip = rec(mask | (1 << c));
      for (const [k, v] of Object.entries(skip)) put(k, v.dw + pts[c], { meld: null, next: mask | (1 << c), sub: k });
      for (const md of byLow[c]) {
        if (md.mask & mask || !filter(md)) continue;
        const r = rec(mask | md.mask);
        for (const [k, v] of Object.entries(r)) {
          const p = Math.max(+k[0], md.type === 'pure' ? 1 : 0);
          const s = Math.min(2, +k[1] + (md.type === 'set' ? 0 : 1));
          put(`${p}${s}`, v.dw, { meld: md, next: mask | md.mask, sub: k });
        }
      }
      memo.set(mask, out);
      return out;
    };
    // reconstruct
    const walk = (key) => {
      const groups = [], dead = [];
      let mask = 0, k = key;
      while (mask !== full) {
        const e = rec(mask)[k];
        if (!e || e.next == null) break;
        if (e.meld) groups.push({ type: e.meld.type, cards: cards.filter((_, i) => e.meld.mask & (1 << i)) });
        else { let c = 0; while (mask & (1 << c)) c++; dead.push(cards[c]); }
        mask = e.next; k = e.sub;
      }
      return { groups, deadwood: dead };
    };
    return { root: rec(0), walk };
  }
  if (!n) return { groups: [], deadwood: [], points: 0, valid: false };
  const all = solve(() => true);
  let best = { points: Math.min(80, total), groups: [], deadwood: [...cards], valid: false };
  if (all.root['12']) {
    const dw = all.root['12'].dw;
    if (dw < best.points || dw === 0) {
      const w = all.walk('12');
      // leftover zero-point jokers can join any sequence
      const loose = w.deadwood.filter((c) => isWildCard(c, wildRank));
      const host = w.groups.find((g) => g.type === 'impure') || w.groups.find((g) => g.type !== 'set' && w.groups.filter((x) => x.type === 'pure').length > 1);
      if (loose.length && host) { host.cards.push(...loose); host.type = fbClassify(host.cards, wildRank) || host.type; w.deadwood = w.deadwood.filter((c) => !loose.includes(c)); }
      best = { points: Math.min(80, dw), ...w, valid: !w.deadwood.length && n === 13 };
    }
  }
  // pure sequence but no second sequence: only pure sequences are excluded
  const pure = solve((md) => md.type === 'pure');
  for (const k of ['10', '11', '12']) {
    const e = pure.root[k];
    if (e && Math.min(80, e.dw) < best.points) { const w = pure.walk(k); best = { points: Math.min(80, e.dw), ...w, valid: false }; }
  }
  return best;
}

const fallback = {
  classifyGroup: fbClassify,
  bestArrangement: fbBest,
  cardPoints: fbPoints,
  isWild: (c, w) => isWildCard(c, w),
};

let impl = fallback;
export let usingShared = false;
/** Resolves once the shared module has loaded (or failed to). */
export const meldsReady = import('/js/shared/rummy-melds.js')
  .then((m) => {
    impl = { ...fallback };
    for (const k of ['classifyGroup', 'bestArrangement', 'cardPoints', 'isWild', 'handPoints']) if (typeof m[k] === 'function') impl[k] = m[k];
    usingShared = true;
    cacheA.clear(); cacheD.clear();
  })
  .catch(() => {});

export const classifyGroup = (cards, wildRank) => { try { return impl.classifyGroup(cards, wildRank) || null; } catch { return null; } };
export const cardPoints = (c, wildRank) => impl.cardPoints(c, wildRank);

const cacheA = new Map();
/** bestArrangement with a small memo (render calls it often for the same hand). */
export function bestArrangement(cards, wildRank) {
  const key = `${wildRank}|${[...cards].sort().join(',')}`;
  if (cacheA.has(key)) return cacheA.get(key);
  let res;
  try { res = impl.bestArrangement(cards, wildRank); } catch { res = fbBest(cards, wildRank); }
  if (cacheA.size > 200) cacheA.clear();
  cacheA.set(key, res);
  return res;
}

const cacheD = new Map();
/** Best finishing/discard card for a 14-card hand: { card, points, arrangement } (arrangement of the other 13). */
export function bestDiscard(cards, wildRank, { exclude = null } = {}) {
  const key = `${wildRank}|${exclude}|${[...cards].sort().join(',')}`;
  if (cacheD.has(key)) return cacheD.get(key);
  let best = null;
  const seen = new Set();
  for (const c of cards) {
    if (c === exclude) continue;
    const face = c[0] === 'X' ? 'X' : c.slice(0, 2);
    if (seen.has(face)) continue; // the twin from the other deck scores the same
    seen.add(face);
    const rest = cards.filter((x) => x !== c);
    const pts = impl.handPoints ? impl.handPoints(rest, wildRank) : bestArrangement(rest, wildRank).points;
    // prefer the lowest remaining points; on ties throw the highest-value card (never a joker)
    const val = (cw) => (impl.isWild(cw, wildRank) ? -1 : cardPoints(cw, wildRank));
    if (!best || pts < best.points || (pts === best.points && val(c) > val(best.card))) best = { card: c, points: pts };
  }
  if (best) { best.arrangement = bestArrangement(cards.filter((x) => x !== best.card), wildRank); best.points = best.arrangement.points; }
  if (cacheD.size > 50) cacheD.clear();
  cacheD.set(key, best);
  return best;
}
