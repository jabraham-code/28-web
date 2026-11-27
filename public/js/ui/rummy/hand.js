// My-hand model for rummy: the player's own grouping of cards (stable across server updates),
// sorting helpers and the row layout used to fit 13–14 cards on any screen.
import { RANKS, rRank, rSuit, isJoker, isWildCard } from './rcards.js';
import { bestArrangement } from './melds.js';

let gid = 0;
export const newGroup = (cards = []) => ({ id: `g${++gid}`, cards: [...cards] });

const SUIT_ORDER = ['S', 'H', 'C', 'D']; // alternate colours
const rv = (c) => (isJoker(c) ? 99 : RANKS.indexOf(rRank(c)));
const byRank = (a, b) => rv(a) - rv(b) || SUIT_ORDER.indexOf(rSuit(a)) - SUIT_ORDER.indexOf(rSuit(b)) || (a < b ? -1 : 1);
const bySuitRank = (a, b) => SUIT_ORDER.indexOf(rSuit(a)) - SUIT_ORDER.indexOf(rSuit(b)) || rv(a) - rv(b) || (a < b ? -1 : 1);

/** Keep the player's groups; drop cards that left the hand, append new cards as one new group. */
export function syncGroups(groups, hand) {
  const inHand = new Set(hand);
  const seen = new Set();
  let out = groups.map((g) => ({ ...g, cards: g.cards.filter((c) => inHand.has(c) && !seen.has(c) && seen.add(c)) })).filter((g) => g.cards.length);
  const fresh = hand.filter((c) => !seen.has(c));
  if (fresh.length) out = [...out, newGroup(fresh)];
  return { groups: out, fresh };
}

/** One group per suit (rank order), wild jokers in their own group at the end. */
export function sortBySuit(hand, wildRank) {
  const wild = hand.filter((c) => isWildCard(c, wildRank)).sort(byRank);
  const rest = hand.filter((c) => !isWildCard(c, wildRank));
  const groups = SUIT_ORDER.map((s) => rest.filter((c) => rSuit(c) === s).sort(bySuitRank)).filter((g) => g.length).map((g) => newGroup(g));
  if (wild.length) groups.push(newGroup(wild));
  return groups;
}

/** Same ranks together (pairs and sets), the remaining singles in rank order, wild jokers last. */
export function sortByRank(hand, wildRank) {
  const wild = hand.filter((c) => isWildCard(c, wildRank)).sort(byRank);
  const rest = hand.filter((c) => !isWildCard(c, wildRank)).sort(byRank);
  const byR = new Map();
  for (const c of rest) { const r = rRank(c); byR.set(r, [...(byR.get(r) || []), c]); }
  const multi = [], singles = [];
  for (const cards of byR.values()) (cards.length > 1 ? multi.push(newGroup(cards)) : singles.push(...cards));
  const groups = [...multi];
  if (singles.length) groups.push(newGroup(singles));
  if (wild.length) groups.push(newGroup(wild));
  return groups;
}

/** Engine-style best arrangement: melds first (pure, impure, sets), deadwood last. */
export function arrangeBest(hand, wildRank) {
  const a = bestArrangement(hand, wildRank);
  const order = { pure: 0, impure: 1, set: 2 };
  const groups = [...(a.groups || [])].sort((x, y) => order[x.type] - order[y.type]).map((g) => newGroup(g.cards));
  const used = new Set(groups.flatMap((g) => g.cards));
  const dead = hand.filter((c) => !used.has(c));
  if (dead.length) groups.push(...sortBySuit(dead, wildRank)); // leftovers by suit (wild jokers last)
  return groups;
}

/** Move `cards` into group `targetId` at `index` (end when null); targetId null => a new group at `newAt`. */
export function moveCards(groups, cards, targetId, index = null, newAt = null) {
  const set = new Set(cards);
  const ordered = groups.flatMap((g) => g.cards).filter((c) => set.has(c)); // keep visual order
  const target = groups.find((g) => g.id === targetId);
  let insertAt = index;
  if (target && insertAt != null) insertAt -= target.cards.slice(0, insertAt).filter((c) => set.has(c)).length;
  const firstIdx = groups.findIndex((g) => g.cards.some((c) => set.has(c)));
  let out = groups.map((g) => ({ ...g, cards: g.cards.filter((c) => !set.has(c)) }));
  if (target) {
    const t = out.find((g) => g.id === targetId);
    const at = insertAt == null ? t.cards.length : Math.max(0, Math.min(t.cards.length, insertAt));
    t.cards.splice(at, 0, ...ordered);
  } else {
    const g = newGroup(ordered);
    const at = newAt ?? (firstIdx < 0 ? out.length : firstIdx + 1);
    out.splice(Math.min(at, out.length), 0, g);
  }
  return out.filter((g) => g.cards.length);
}

/** "Group": the selected cards become a new group where the first of them was. */
export function groupSelected(groups, cards) {
  const set = new Set(cards);
  const firstIdx = groups.findIndex((g) => g.cards.some((c) => set.has(c)));
  const before = groups.slice(0, firstIdx).filter((g) => g.cards.some((c) => !set.has(c))).length;
  const keepFirst = groups[firstIdx]?.cards.some((c) => !set.has(c));
  return moveCards(groups, cards, null, null, before + (keepFirst ? 1 : 0));
}

/** "Ungroup": the groups touching the selection are merged into one loose group at the end (suit order). */
export function ungroup(groups, cards) {
  const set = new Set(cards);
  const hit = groups.filter((g) => g.cards.some((c) => set.has(c)));
  if (!hit.length) return groups;
  const loose = hit.flatMap((g) => g.cards).sort(bySuitRank);
  return [...groups.filter((g) => !hit.includes(g)), newGroup(loose)];
}

/**
 * Fit groups into rows. Returns { rows: [[groupIndex...]], step, cw }.
 * W: available width, cw: card width, minStep: smallest visible strip per overlapped card,
 * maxRows: how many rows the screen can afford.
 */
export function layoutRows(sizes, { W, cw, gap, minStep, maxStep, maxRows = 2 }) {
  const G = sizes.length;
  if (!G) return { rows: [], step: maxStep, cw };
  const stepFor = (idx) => {
    const n = idx.reduce((a, i) => a + sizes[i], 0);
    const extra = n - idx.length;
    if (extra <= 0) return maxStep;
    return (W - idx.length * cw - (idx.length - 1) * gap) / extra;
  };
  const all = sizes.map((_, i) => i);
  let best = null;
  const consider = (rows) => {
    const step = Math.min(maxStep, ...rows.map(stepFor));
    if (!best || step > best.step + 0.5) best = { rows, step };
    return step >= minStep;
  };
  if (consider([all])) return { ...best, step: Math.min(maxStep, best.step), cw };
  for (let r = 2; r <= Math.min(maxRows, G); r++) {
    // contiguous partitions into r rows (G is small)
    let found = null;
    const splits = (start, left, acc) => {
      if (left === 1) {
        const rows = [...acc, all.slice(start)];
        const step = Math.min(maxStep, ...rows.map(stepFor));
        const widest = Math.max(...rows.map((r) => r.reduce((a, i) => a + sizes[i], 0) * 100 + r.length)); // balance rows on ties
        if (!found || step > found.step + 0.5 || (Math.abs(step - found.step) <= 0.5 && widest < found.widest)) found = { rows, step, widest };
        return;
      }
      for (let k = start + 1; k <= G - left + 1; k++) splits(k, left - 1, [...acc, all.slice(start, k)]);
    };
    splits(0, r, []);
    if (found && consider(found.rows)) return { ...best, cw };
  }
  return { ...best, cw };
}
