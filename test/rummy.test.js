import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDeck, isWild, cardPoints, wildRankFor, classifyGroup, bestArrangement, bestDiscard, handPoints,
  findDeclaration, isValidDeclaration, rankOf, suitOf, deckOf, isPrintedJoker, RANKS,
} from '../public/js/shared/rummy-melds.js';
import { createGame, applyAction, getView, currentTurn } from '../server/rummy/engine.js';
import rummy, { chooseAction } from '../server/rummy/index.js';

// ---------------------------------------------------------------------------
// helpers

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a 106-card deck: hands in turn order (after the dealer), then wild, open start, closed front. */
function stack({ hands, wild, open, closed = [] }) {
  const used = [...hands.flat(), wild, open, ...closed];
  const set = new Set(used);
  assert.equal(set.size, used.length, 'stack: duplicate card');
  for (const h of hands) assert.equal(h.length, 13);
  const deck = [...hands.flat(), wild, open, ...closed, ...newDeck().filter((c) => !set.has(c))];
  assert.equal(deck.length, 106);
  return deck;
}

function act(game, seat, action) {
  const r = applyAction(game, seat, action);
  assert.ok(r.ok, `expected ok for seat ${seat} ${JSON.stringify(action)}: ${r.error}`);
}
function reject(game, seat, action, re) {
  const before = JSON.stringify(game);
  const r = applyAction(game, seat, action);
  assert.equal(r.ok, false, `expected rejection of ${JSON.stringify(action)}`);
  assert.equal(typeof r.error, 'string');
  if (re) assert.match(r.error, re);
  assert.equal(JSON.stringify(game), before, 'rejected action must not mutate');
}
const pts = (cards, w) => cards.reduce((n, c) => n + cardPoints(c, w), 0);

const VALID13 = ['AH1', '2H1', '3H1', '4S1', '5S1', '6S1', '7D1', '8D1', '9D1', 'KC1', 'KS1', 'KH1', 'QD1']; // + KD1, discard QD1
const SEAT_B = ['TS1', 'JS1', 'QS1', '3C1', '4C1', '5C1', '9H1', '9S1', '9C1', '7C1', '8H1', '6D1', 'KH2']; // 31 with 2s wild
const JUNK0 = ['KS2', 'QH2', 'JC2', 'TD2', '9S2', '8H2', '7C2', '6S2', '5H2', '4D2', '3S2', 'KC2', 'QS2']; // 102 -> 80
const JUNK1 = ['AS2', '3H2', '5D2', '7S2', '9H2', 'JD2', 'QH1', 'AC2', '4C2', '6H2', '8D2', 'TC2', 'QD2'];

// ---------------------------------------------------------------------------
// cards

test('cards: 106 distinct ids, parsing, points, wild', () => {
  const d = newDeck();
  assert.equal(d.length, 106);
  assert.equal(new Set(d).size, 106);
  assert.equal(d.filter(isPrintedJoker).length, 2);
  assert.equal(rankOf('TD2'), 'T'); assert.equal(suitOf('TD2'), 'D'); assert.equal(deckOf('TD2'), 2);
  assert.equal(suitOf('X1'), null);
  assert.equal(wildRankFor('5H1'), '5');
  assert.equal(wildRankFor('X2'), 'A', 'printed joker turned up -> Aces wild');
  assert.equal(cardPoints('AS1', '5'), 10);
  assert.equal(cardPoints('KS1', '5'), 10);
  assert.equal(cardPoints('TS1', '5'), 10);
  assert.equal(cardPoints('7S1', '5'), 7);
  assert.equal(cardPoints('5S1', '5'), 0, 'wild joker 0');
  assert.equal(cardPoints('X1', '5'), 0, 'printed joker 0');
  assert.equal(cardPoints('AS1', 'A'), 0);
  assert.ok(isWild('X1', '9') && isWild('9C2', '9') && !isWild('8C2', '9'));
});

// ---------------------------------------------------------------------------
// classification

test('classifyGroup: sequences, aces, no wrap-around', () => {
  const W = '5';
  assert.equal(classifyGroup(['AH1', '2H1', '3H1'], W), 'pure', 'A low');
  assert.equal(classifyGroup(['QH1', 'KH1', 'AH1'], W), 'pure', 'A high');
  assert.equal(classifyGroup(['KH1', 'AH1', '2H1'], W), null, 'no wrap-around');
  assert.equal(classifyGroup(['JH1', 'QH1', 'KH1', 'AH1'], W), 'pure');
  assert.equal(classifyGroup(['7H1', '8H1', '9H1', 'TH1', 'JH1'], W), 'pure');
  assert.equal(classifyGroup(['7H1', '8H1'], W), null, 'too short');
  assert.equal(classifyGroup(['7H1', '8H1', '9S1'], W), null, 'mixed suits');
  assert.equal(classifyGroup(['7H1', '8H1', '8H2'], W), null, 'duplicate rank');
  assert.equal(classifyGroup(['7H1', '9H1', 'TH1'], W), null, 'gap without joker');
});

test('classifyGroup: wild rank natural in pure sequence; jokers make it impure', () => {
  const W = '5';
  assert.equal(classifyGroup(['4H1', '5H1', '6H1'], W), 'pure', 'wild 5H in its natural place');
  assert.equal(classifyGroup(['4H1', '5S1', '6H1'], W), 'impure', '5S substitutes 5H');
  assert.equal(classifyGroup(['4H1', 'X1', '6H1'], W), 'impure');
  assert.equal(classifyGroup(['4H1', '6H1', 'X1'], W), 'impure', 'order does not matter');
  assert.equal(classifyGroup(['4H1', 'X1', 'X2'], W), 'impure', 'one natural + two jokers');
  assert.equal(classifyGroup(['QH1', 'AH1', 'X1'], W), 'impure', 'Q _ A with joker as K');
  assert.equal(classifyGroup(['KH1', '2H1', 'X1'], W), null, 'K-?-2 would wrap');
  assert.equal(classifyGroup(['4H1', '8H1', 'X1', 'X2'], W), null, 'gap too wide');
  assert.equal(classifyGroup(['4H1', '7H1', 'X1', 'X2'], W), 'impure');
  assert.equal(classifyGroup(['X1', 'X2', '5D1'], W), 'impure', 'all jokers count as an impure sequence');
  // printed joker turned up: Aces are wild
  assert.equal(classifyGroup(['3D1', 'AS1', '5D1'], 'A'), 'impure');
  assert.equal(classifyGroup(['AD1', '2D1', '3D1'], 'A'), 'pure', 'natural ace still pure');
});

test('classifyGroup: sets', () => {
  const W = '5';
  assert.equal(classifyGroup(['7H1', '7S1', '7D1'], W), 'set');
  assert.equal(classifyGroup(['7H1', '7S1', '7D1', '7C2'], W), 'set', '4-card set');
  assert.equal(classifyGroup(['7H1', '7H2', '7D1'], W), null, 'same suit twice');
  assert.equal(classifyGroup(['7H1', '7S1', '7D1', '7C1', '7H2'], W), null, 'max 4');
  assert.equal(classifyGroup(['7H1', '7S1', 'X1'], W), 'set', 'joker in set');
  assert.equal(classifyGroup(['7H1', '7S1', '5C1', 'X2'], W), 'set', 'two jokers, 4 cards');
  assert.equal(classifyGroup(['7H1', '7S1', '7D1', '7C1', 'X1'], W), null, 'set with joker too long');
  assert.equal(classifyGroup(['7H1', '7H2', 'X1'], W), null, 'duplicate suit even with joker');
  assert.equal(classifyGroup(['7H1', '8S1', 'X1'], W), null);
});

// ---------------------------------------------------------------------------
// bestArrangement

function checkArrangement(cards, w, arr) {
  const all = [...arr.groups.flatMap((g) => g.cards), ...arr.deadwood];
  assert.deepEqual([...all].sort(), [...cards].sort(), 'arrangement covers the hand exactly');
  for (const g of arr.groups) assert.equal(classifyGroup(g.cards, w) === null, false, `group ${g.cards} is a meld`);
}

test('bestArrangement: valid hand (wild rank natural in pure sequence)', () => {
  const hand = ['AH1', '2H1', '3H1', '4S1', '5S1', '6S1', '7D1', '8D1', '9D1', 'KC1', 'KS1', 'KH1', 'KD1'];
  const a = bestArrangement(hand, '2');
  checkArrangement(hand, '2', a);
  assert.equal(a.valid, true);
  assert.equal(a.points, 0);
  assert.deepEqual(a.deadwood, []);
  assert.equal(a.groups.filter((g) => g.type === 'pure').length, 3);
  assert.ok(isValidDeclaration(hand, '2'));
});

test('bestArrangement: case A - two sequences incl. pure, sets also count', () => {
  const W = '2';
  const a = bestArrangement(SEAT_B, W);
  checkArrangement(SEAT_B, W, a);
  assert.equal(a.valid, false);
  assert.equal(a.points, 31);
  assert.deepEqual([...a.deadwood].sort(), ['6D1', '7C1', '8H1', 'KH2']);
  // impure second sequence with a joker
  const h2 = ['4H1', '5H1', '6H1', '9S1', 'X1', 'JS1', '7C1', '7D1', '7S1', 'KD1', 'QC1', '3D1', '8D1'];
  const b = bestArrangement(h2, '2');
  checkArrangement(h2, '2', b);
  assert.equal(b.points, 10 + 10 + 3 + 8);
  assert.ok(b.groups.some((g) => g.type === 'impure'));
});

test('bestArrangement: case B - pure sequence only, sets do not count', () => {
  const W = '2';
  // pure 4H5H6H; set of 9s (no second sequence) -> the set's cards count
  const hand = ['4H1', '5H1', '6H1', '9S1', '9D1', '9C1', 'KD1', 'QC1', '3D1', '8D1', 'JH1', 'TS1', '7C1'];
  const a = bestArrangement(hand, W);
  checkArrangement(hand, W, a);
  assert.equal(a.points, Math.min(80, pts(hand, W) - 15));
  assert.deepEqual(a.groups.map((g) => g.type), ['pure']);
  // a smaller hand under the cap
  const h2 = ['4H1', '5H1', '6H1', '3S1', '3D1', '3C1', '4D1', '7S1', '8C1', '9D1', '6C2', '4S2', '6D1'];
  const b = bestArrangement(h2, 'K');
  assert.equal(b.points, pts(h2, 'K') - 15);
  assert.ok(b.points < 80);
});

test('bestArrangement: case C - no pure sequence, every card counts; capped at 80', () => {
  // impure sequences and sets but no pure sequence
  const h = ['4H1', 'X1', '6H1', '3S1', '3D1', '3C1', '4D1', '7S1', '8C1', '9D1', '6C2', '4S2', '6D1'];
  const a = bestArrangement(h, 'K');
  assert.equal(a.points, pts(h, 'K'));
  assert.deepEqual(a.groups, []);
  assert.equal(a.valid, false);
  assert.equal(bestArrangement(JUNK0, '2').points, 80, 'cap');
  assert.equal(pts(JUNK0, '2'), 102);
  assert.equal(handPoints(JUNK0, '2'), 80);
});

test('bestArrangement: needs a pure sequence even with two impure ones', () => {
  const W = '2';
  const h = ['4H1', 'X1', '6H1', '8S1', '2C1', 'TS1', 'KD1', 'KC1', 'KS1', '7D1', '7S1', '7C1', '7H1'];
  const a = bestArrangement(h, W);
  assert.equal(a.valid, false);
  assert.equal(a.points, Math.min(80, pts(h, W)));
  assert.equal(pts(h, W), 86);
  // with a pure sequence instead it is valid
  const h2 = ['4H1', '5H1', '6H1', '8S1', '2C1', 'TS1', 'KD1', 'KC1', 'KS1', '7D1', '7S1', '7C1', '7H1'];
  const b = bestArrangement(h2, W);
  assert.equal(b.valid, true);
  checkArrangement(h2, W, b);
});

test('bestArrangement: jokers fill sets and sequences, spare jokers are absorbed', () => {
  const W = '9';
  const h = ['AH1', '2H1', '3H1', '5S1', '9D1', '7S1', 'KC1', 'KS1', 'X1', '4C1', '9C2', 'X2', '9H2'];
  const a = bestArrangement(h, W);
  checkArrangement(h, W, a);
  assert.equal(a.valid, true, JSON.stringify(a));
  // printed joker turned up -> Aces wild
  const h2 = ['3D1', '4D1', '5D1', '7C1', 'AS1', '9C1', 'QH1', 'QS1', 'AD2', '2S1', '3S1', '4S1', '6H1'];
  const b = bestArrangement(h2, wildRankFor('X1'));
  checkArrangement(h2, 'A', b);
  assert.equal(b.points, 6, '7C A 9C impure, Q Q A set, only 6H left');
});

test('bestArrangement: two-deck duplicates', () => {
  const W = 'K';
  const h = ['5H1', '6H1', '7H1', '5H2', '6H2', '7H2', '9C1', '9S1', '9D1', '9C2', 'JS1', 'JD1', 'JH1'];
  const a = bestArrangement(h, W);
  checkArrangement(h, W, a);
  assert.equal(a.valid, false, '9C twice cannot be in one set');
  assert.equal(a.points, 9);
});

test('bestDiscard / findDeclaration', () => {
  const W = '2';
  const h14 = [...VALID13, 'KD1'];
  assert.equal(bestDiscard(h14, W), 'QD1');
  assert.equal(findDeclaration(h14, W), 'QD1');
  assert.equal(findDeclaration([...JUNK0, 'AS1'], W), null);
  // ties: discard the higher card
  const h = [...SEAT_B, '3D2'];
  const d = bestDiscard(h, W);
  assert.ok(['KH2'].includes(d), d);
  assert.equal(bestDiscard(h, W, { exclude: ['KH2'] }), '8H1');
});

test('benchmark: bestArrangement on 13-14 cards with 2-4 jokers is fast', () => {
  const rng = mulberry32(42);
  const deck = newDeck();
  const times = [];
  for (let k = 0; k < 600; k++) {
    const wild = RANKS[Math.floor(rng() * 13)];
    const n = 13 + (k % 2), jk = 2 + (k % 3);
    const shuffled = [...deck].sort(() => rng() - 0.5);
    // bias towards melds: pick most cards from two suits
    const suits = ['S', 'H', 'D', 'C'].sort(() => rng() - 0.5).slice(0, 2);
    const nat = shuffled.filter((c) => !isWild(c, wild) && (rng() < 0.3 || suits.includes(c[1])));
    const hand = shuffled.filter((c) => isWild(c, wild)).slice(0, jk).concat(nat.slice(0, n - jk));
    const t0 = performance.now();
    bestArrangement(hand, wild);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p99 = times[Math.floor(times.length * 0.99)];
  console.log(`bestArrangement: avg ${avg.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${times[times.length - 1].toFixed(3)} ms`);
  assert.ok(avg < 5, `avg ${avg} ms`);
});

// ---------------------------------------------------------------------------
// engine

function twoPlayer({ hands = [VALID13, SEAT_B], wild = '2C1', open = 'AD2', closed = ['KD1'] } = {}) {
  return createGame({ seats: [0, 1], dealer: 1, decks: [stack({ hands, wild, open, closed })] });
}

test('createGame: validation and deal layout', () => {
  assert.throws(() => createGame({ seats: [0] }));
  assert.throws(() => createGame({ seats: [0, 1, 2, 3, 4, 5, 6] }));
  assert.throws(() => createGame({ seats: [0, 0] }));
  assert.throws(() => createGame({ seats: [0, 1], dealer: 3 }));
  const g = twoPlayer();
  assert.equal(g.phase, 'playing');
  assert.equal(currentTurn(g), 0);
  assert.deepEqual(g.hands[0], VALID13);
  assert.deepEqual(g.hands[1], SEAT_B);
  assert.equal(g.wildCard, '2C1');
  assert.equal(g.wildRank, '2');
  const v = getView(g, 0);
  assert.equal(v.gameType, 'rummy');
  assert.equal(v.openTop, 'AD2');
  assert.equal(v.openCount, 1);
  assert.equal(v.closedCount, 106 - 26 - 2);
  assert.equal(v.step, 'draw');
  assert.deepEqual(v.legal.actions, ['draw', 'drop']);
  assert.equal(v.legal.dropPoints, 20);
  assert.equal(v.legal.canDrawOpen, true);
  // printed joker turned up -> aces wild
  const g2 = createGame({ seats: [2, 4, 5], dealer: 5, decks: [stack({ hands: [JUNK0, JUNK1, SEAT_B], wild: 'X1', open: 'AD2' })] });
  assert.equal(g2.wildRank, 'A');
  assert.equal(currentTurn(g2), 2, 'first player after dealer 5 wraps to 2');
  assert.deepEqual(g2.hands[4], JUNK1);
});

test('engine: draw / discard rules', () => {
  const g = twoPlayer();
  reject(g, 1, { type: 'draw', from: 'closed' }, /turn/);
  reject(g, 0, { type: 'discard', card: 'QD1' }, /Draw/);
  reject(g, 0, { type: 'draw', from: 'nowhere' });
  reject(g, 0, { type: 'bogus' }, /Unknown/);
  reject(g, 7, { type: 'draw', from: 'closed' }, /seat/);
  reject(g, 0, { type: 'nextDeal' }, /not over/);
  act(g, 0, { type: 'draw', from: 'open' });
  assert.deepEqual(getView(g, 0).justDrew, { card: 'AD2', from: 'open' });
  assert.equal(getView(g, 1).justDrew, null, 'others do not see justDrew');
  assert.equal(getView(g, 0).openTop, null);
  assert.ok(!getView(g, 0).legal.discardable.includes('AD2'));
  assert.deepEqual(getView(g, 0).legal.actions, ['discard', 'declare']);
  reject(g, 0, { type: 'discard', card: 'AD2' }, /just took/);
  reject(g, 0, { type: 'draw', from: 'closed' }, /already/);
  reject(g, 0, { type: 'drop' }, /before drawing/);
  reject(g, 0, { type: 'discard', card: 'KD1' }, /hold/);
  act(g, 0, { type: 'discard', card: 'QD1' });
  assert.equal(currentTurn(g), 1);
  assert.equal(getView(g, 1).openTop, 'QD1');
  assert.equal(g.hands[0].length, 13);
  // a card drawn from the closed deck may be discarded immediately
  act(g, 1, { type: 'draw', from: 'closed' });
  assert.equal(g.hands[1].at(-1), 'KD1');
  act(g, 1, { type: 'discard', card: 'KD1' });
  assert.equal(getView(g, 0).openTop, 'KD1');
  assert.equal(getView(g, 0).legal.dropPoints, 40, 'drawn already -> middle drop');
  assert.equal(g.seq, 4);
});

test('engine: closed deck reshuffles from the open pile (minus top)', () => {
  const g = twoPlayer();
  // move all closed cards onto the open pile below the top card
  g.open = [...g.closed, ...g.open];
  g.closed = [];
  const top = g.open.at(-1);
  const n = g.open.length;
  act(g, 0, { type: 'draw', from: 'closed' });
  assert.equal(g.open.length, 1);
  assert.equal(g.open[0], top);
  assert.equal(g.closed.length, n - 2);
  const all = [...g.hands[0], ...g.hands[1], ...g.closed, ...g.open, g.wildCard];
  assert.equal(new Set(all).size, 106);
  assert.ok(g.log.some((l) => /reshuffled/.test(l)));
  // nothing to reshuffle: closed draw impossible
  const g2 = twoPlayer();
  g2.closed = [];
  const v = getView(g2, 0);
  assert.equal(v.legal.canDrawClosed, false);
  reject(g2, 0, { type: 'draw', from: 'closed' }, /empty/);
  act(g2, 0, { type: 'draw', from: 'open' });
});

test('engine: valid declaration scores the others by best arrangement', () => {
  const g = twoPlayer();
  act(g, 0, { type: 'draw', from: 'closed' });
  act(g, 0, { type: 'declare', card: 'QD1' });
  assert.equal(g.phase, 'dealEnd');
  assert.equal(currentTurn(g), null);
  const r = getView(g, 1).dealResult;
  assert.equal(r.declarer, 0);
  assert.equal(r.valid, true);
  assert.equal(r.wrongShow, false);
  assert.equal(r.winner, 0);
  assert.equal(r.finishCard, 'QD1');
  assert.deepEqual(r.points, { 0: 0, 1: 31 });
  assert.deepEqual(g.scores, { 0: 0, 1: 31 });
  assert.deepEqual(r.hands[0].deadwood, []);
  assert.equal(r.hands[1].groups.length, 3);
  // all hands revealed at deal end
  assert.ok(JSON.stringify(getView(g, 0)).includes('"TS1"'));
  for (const s of [0, 1, null]) {
    const v = getView(g, s);
    assert.deepEqual(v.legal.actions, s === null ? [] : ['nextDeal']);
  }
  reject(g, 0, { type: 'draw', from: 'closed' }, /over/);
  act(g, 1, { type: 'nextDeal' });
  assert.equal(g.phase, 'playing');
  assert.equal(g.dealNumber, 2);
  assert.equal(g.dealer, 0, 'dealer rotates');
  assert.equal(currentTurn(g), 1);
  assert.equal(g.hands[0].length + g.hands[1].length, 26);
});

test('engine: wrong show costs the declarer 80, others 0', () => {
  const g = twoPlayer({ hands: [JUNK0, SEAT_B], closed: ['KD1'] });
  act(g, 0, { type: 'draw', from: 'closed' });
  act(g, 0, { type: 'declare', card: 'KD1' });
  const r = g.dealResult;
  assert.equal(r.wrongShow, true);
  assert.equal(r.valid, false);
  assert.equal(r.winner, null);
  assert.deepEqual(r.points, { 0: 80, 1: 0 });
  assert.equal(g.phase, 'dealEnd');
});

test('engine: first drop 20, middle drop 40, last player standing wins the deal', () => {
  const g = createGame({ seats: [0, 1, 2], dealer: 2, decks: [stack({ hands: [JUNK0, SEAT_B, JUNK1], wild: '2C1', open: 'AD2' })] });
  act(g, 0, { type: 'drop' });
  assert.deepEqual(g.active, [1, 2]);
  assert.equal(currentTurn(g), 1);
  assert.deepEqual(getView(g, 1).dropped, { 0: 20 });
  reject(g, 0, { type: 'draw', from: 'closed' }, /not in this deal/);
  act(g, 1, { type: 'draw', from: 'closed' });
  act(g, 1, { type: 'discard', card: g.hands[1].at(-1) });
  assert.equal(currentTurn(g), 2, 'dropped seat skipped');
  act(g, 2, { type: 'draw', from: 'closed' });
  act(g, 2, { type: 'discard', card: g.hands[2].at(-1) });
  assert.equal(currentTurn(g), 1);
  act(g, 1, { type: 'drop' });
  assert.equal(g.phase, 'dealEnd');
  const r = g.dealResult;
  assert.equal(r.winner, 2);
  assert.equal(r.declarer, null);
  assert.deepEqual(r.points, { 0: 20, 1: 40, 2: 0 });
  assert.deepEqual(g.scores, { 0: 20, 1: 40, 2: 0 });
  assert.deepEqual(Object.keys(r.hands).sort(), ['0', '1', '2']);
});

test('engine: elimination at the pool limit, dealer skips eliminated seats, match end', () => {
  const g = createGame({
    seats: [0, 1, 2], dealer: 2,
    decks: [stack({ hands: [JUNK0, VALID13, JUNK1], wild: '2C1', open: 'AD2', closed: ['8C1', 'KD1'] })],
  });
  g.scores = { 0: 30, 1: 0, 2: 10 };
  act(g, 0, { type: 'draw', from: 'closed' });
  act(g, 0, { type: 'discard', card: '8C1' });
  act(g, 1, { type: 'draw', from: 'closed' });
  act(g, 1, { type: 'declare', card: 'QD1' });
  const r = g.dealResult;
  assert.equal(r.valid, true);
  assert.equal(r.points[0], 80);
  assert.equal(r.points[2], bestArrangement(JUNK1, '2').points);
  assert.equal(g.scores[0], 110);
  assert.deepEqual(g.eliminated, [0]);
  assert.equal(g.phase, 'dealEnd');
  reject(g, 0, { type: 'nextDeal' }, /eliminated/);
  assert.deepEqual(getView(g, 0).legal.actions, []);
  act(g, 2, { type: 'nextDeal' });
  assert.equal(g.dealer, 1, 'next after 2 skipping eliminated 0');
  assert.deepEqual(g.active, [1, 2]);
  assert.equal(currentTurn(g), 2);
  assert.equal(getView(g, 0).handCounts[1], 13);
  // finish: seat 2 wrong-shows past the limit
  g.scores[2] = 50;
  act(g, 2, { type: 'draw', from: 'closed' });
  act(g, 2, { type: 'declare', card: g.hands[2][0] });
  if (g.dealResult.wrongShow) {
    assert.equal(g.phase, 'matchEnd');
    assert.equal(g.matchWinner, 1);
    assert.equal(currentTurn(g), null);
    reject(g, 1, { type: 'nextDeal' }, /match is over/);
    assert.deepEqual(getView(g, 1).legal.actions, []);
  }
});

test('engine: 201 pool keeps going; 2-player match end', () => {
  const g = twoPlayer();
  g.poolLimit = 201;
  g.scores = { 0: 0, 1: 190 };
  act(g, 0, { type: 'draw', from: 'closed' });
  act(g, 0, { type: 'declare', card: 'QD1' });
  assert.equal(g.scores[1], 221);
  assert.equal(g.phase, 'matchEnd');
  assert.equal(g.matchWinner, 0);
  assert.equal(getView(g, 1).matchWinner, 0);
});

test('view: never leaks other hands, closed deck, or others\' justDrew', () => {
  const g = twoPlayer();
  act(g, 0, { type: 'draw', from: 'closed' }); // KD1 secretly
  for (const viewer of [1, null]) {
    const v = getView(g, viewer);
    const json = JSON.stringify(v);
    for (const c of [...g.hands[0], ...g.closed]) assert.ok(!json.includes(`"${c}"`), `leaks ${c}`);
    assert.ok(!v.log.join(' ').includes('KD1'));
    assert.equal(v.justDrew, null);
  }
  const me = getView(g, 0);
  assert.deepEqual(me.hand, g.hands[0]);
  assert.deepEqual(me.justDrew, { card: 'KD1', from: 'closed' });
  assert.deepEqual(getView(g, null).hand, []);
  assert.deepEqual(getView(g, 1).legal.actions, []);
  assert.deepEqual(me.handCounts, { 0: 14, 1: 13 });
  assert.equal(getView(g, 1).dealResult, null);
});

test('module object exposes the game interface', () => {
  for (const k of ['createGame', 'applyAction', 'getView', 'currentTurn', 'chooseAction']) {
    assert.equal(typeof rummy[k], 'function', k);
  }
});

test('bot: declares a valid hand, takes useful open cards, nextDeal at deal end', () => {
  const g = twoPlayer();
  act(g, 0, { type: 'draw', from: 'closed' });
  assert.deepEqual(chooseAction(getView(g, 0)), { type: 'declare', card: 'QD1' });
  act(g, 0, { type: 'declare', card: 'QD1' });
  assert.deepEqual(chooseAction(getView(g, 1)), { type: 'nextDeal' });
  // open top completes the set of kings -> take it
  const g2 = twoPlayer({ open: 'KD1', closed: ['8C2'] });
  assert.deepEqual(chooseAction(getView(g2, 0)), { type: 'draw', from: 'open' });
  // open top joker -> take it
  const g3 = twoPlayer({ open: 'X1', closed: ['KD1'] });
  assert.deepEqual(chooseAction(getView(g3, 0)), { type: 'draw', from: 'open' });
  // useless open card -> closed
  const g4 = twoPlayer({ hands: [SEAT_B, VALID13], open: 'AD1', closed: ['8C2'] });
  assert.deepEqual(chooseAction(getView(g4, 0)), { type: 'draw', from: 'closed' });
  assert.equal(chooseAction(getView(g4, 1)), null, 'not my turn');
});

// ---------------------------------------------------------------------------
// fuzz

function nextIn(list, seat) {
  const s = [...list].sort((a, b) => a - b);
  return s.find((x) => x > seat) ?? s[0];
}

function checkCards(game) {
  const all = [...Object.values(game.hands).flat(), ...game.closed, ...game.open, game.wildCard];
  if (game.dealResult && game.dealResult.finishCard) all.push(game.dealResult.finishCard);
  assert.equal(all.length, 106, `card count in ${game.phase}`);
  assert.equal(new Set(all).size, 106, 'no duplicated cards');
}

const CARD_RE = /\b(?:[A2-9TJQK][SHDC][12]|X[12])\b/g;

function checkView(game, viewer, publicCards) {
  const v = getView(game, viewer);
  const json = JSON.stringify(v);
  assert.deepEqual(JSON.parse(json), v, 'JSON-safe');
  if (game.phase === 'playing') {
    const { log, ...rest } = v;
    const shown = new Set(JSON.stringify(rest).match(CARD_RE) || []);
    const secrets = [...game.closed];
    for (const s of game.seats) if (s !== viewer && game.hands[s]) secrets.push(...game.hands[s]);
    for (const c of secrets) assert.ok(!shown.has(c), `view for ${viewer} leaks ${c}`);
    let start = 0;
    log.forEach((l, i) => { if (/^Deal \d+:/.test(l)) start = i; });
    for (const tok of log.slice(start + 1).join(' ').match(CARD_RE) || []) {
      assert.ok(publicCards.has(tok), `log mentions non-public card ${tok}`);
    }
    if (viewer !== currentTurn(game)) {
      assert.deepEqual(v.legal.actions, []);
      assert.equal(v.justDrew, null);
    }
  }
  if (viewer !== null && game.hands[viewer]) assert.deepEqual(v.hand, game.hands[viewer]);
  return v;
}

test('fuzz: 200 bot matches with 2-6 players keep invariants', () => {
  const rng = mulberry32(777);
  let deals = 0, actions = 0, declares = 0, drops = 0, rejects = 0;
  for (let m = 0; m < 200; m++) {
    const n = 2 + (m % 5);
    const all = [0, 1, 2, 3, 4, 5].sort(() => rng() - 0.5).slice(0, n);
    const game = createGame({ seats: all, poolLimit: m % 5 === 0 ? 201 : 101, rng: mulberry32(5000 + m) });
    let guard = 0;
    let dealNo = 0;
    let publicCards = new Set();
    let prevScores = { ...game.scores };
    while (game.phase !== 'matchEnd') {
      assert.ok(guard++ < 50000, 'match terminates');
      if (game.dealNumber !== dealNo) { dealNo = game.dealNumber; publicCards = new Set([game.wildCard]); }
      publicCards.add(getView(game, null).openTop);
      checkCards(game);
      const views = Object.fromEntries([...game.seats, null].map((s) => [s, checkView(game, s, publicCards)]));
      let seat = currentTurn(game);
      if (game.phase === 'dealEnd') {
        const live = game.seats.filter((s) => !game.eliminated.includes(s));
        seat = live[Math.floor(rng() * live.length)];
        for (const s of game.eliminated) assert.deepEqual(views[s].legal.actions, []);
      } else {
        assert.ok(game.active.includes(seat));
        // illegal actions are rejected without mutation
        if (rng() < 0.15) {
          const other = game.seats.find((s) => s !== seat);
          reject(game, other, { type: 'draw', from: 'closed' });
          reject(game, seat, { type: 'nextDeal' });
          if (game.step === 'discard') {
            reject(game, seat, { type: 'draw', from: 'open' });
            reject(game, seat, { type: 'drop' });
            const jd = game.justDrew;
            if (jd.from === 'open') reject(game, seat, { type: 'discard', card: jd.card });
          } else {
            reject(game, seat, { type: 'discard', card: game.hands[seat][0] });
            reject(game, seat, { type: 'declare', card: game.hands[seat][0] });
          }
          rejects++;
        }
      }
      const v = views[seat];
      assert.ok(v.legal.actions.length > 0, `seat ${seat} can act in ${game.phase}`);
      const a = chooseAction(v);
      assert.ok(a && v.legal.actions.includes(a.type), `bot chose a listed action ${JSON.stringify(a)}`);
      if (a.type === 'discard') assert.ok(v.legal.discardable.includes(a.card));
      const seqBefore = game.seq;
      const prevDealer = game.dealer;
      const r = applyAction(game, seat, a);
      assert.ok(r.ok, `bot action ${JSON.stringify(a)} rejected: ${r.error}`);
      assert.equal(game.seq, seqBefore + 1);
      actions++;
      if (a.type === 'declare') declares++;
      if (a.type === 'drop') drops++;
      if (a.type === 'nextDeal') {
        assert.equal(game.dealer, nextIn(game.seats.filter((s) => !game.eliminated.includes(s)), prevDealer));
        assert.equal(Object.keys(game.hands).length, game.seats.length - game.eliminated.length);
      }
      if (game.phase === 'dealEnd' || game.phase === 'matchEnd') {
        if (a.type === 'declare' || a.type === 'drop') {
          deals++;
          const res = game.dealResult;
          for (const s of game.inDeal) {
            assert.equal(game.scores[s], prevScores[s] + res.points[s]);
            assert.ok(res.points[s] >= 0 && res.points[s] <= 80);
            const h = res.hands[s];
            for (const gr of h.groups) assert.ok(classifyGroup(gr.cards, game.wildRank), `revealed group ${gr.cards}`);
          }
          if (res.valid) {
            assert.equal(res.points[res.declarer], 0);
            for (const s of game.inDeal) {
              if (s !== res.declarer && game.dropped[s] == null) assert.equal(res.points[s], bestArrangement(game.hands[s], game.wildRank).points);
            }
          }
          for (const s of game.seats) {
            assert.equal(game.eliminated.includes(s), game.scores[s] >= game.poolLimit, 'eliminated iff over the limit');
          }
          prevScores = { ...game.scores };
        }
      }
    }
    const live = game.seats.filter((s) => !game.eliminated.includes(s));
    assert.ok(live.length <= 1);
    assert.equal(game.matchWinner, live.length ? live[0] : game.matchWinner);
    assert.ok(game.seats.includes(game.matchWinner));
    assert.equal(currentTurn(game), null);
  }
  assert.ok(deals >= 200);
  assert.ok(declares > 0 && drops > 0 && rejects > 0);
  console.log(`fuzz: ${deals} deals, ${actions} actions, ${declares} declarations, ${drops} drops`);
});
