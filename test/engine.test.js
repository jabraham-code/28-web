import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANKS, SUITS, POINTS, rankIndex, suitOf, pointsOf, newDeck, shuffle, sortHand } from '../server/cards.js';
import { createGame, applyAction, getView, currentTurn, trickWinnerIndex, scoreDelta } from '../server/engine.js';
import { chooseAction } from '../server/bot.js';

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

// Build a 32-card deck: d1[s] = 4 cards for seat s in deal 1, d2[s] for deal 2.
// Unspecified slots are filled with the lowest-value remaining cards.
function stack(d1 = {}, d2 = {}) {
  const used = new Set([...Object.values(d1), ...Object.values(d2)].flat());
  const filler = newDeck().filter((c) => !used.has(c))
    .sort((a, b) => pointsOf(a) - pointsOf(b) || rankIndex(b) - rankIndex(a));
  const deck = [];
  for (const part of [d1, d2]) {
    for (let s = 0; s < 4; s++) {
      const cards = [...(part[s] || [])];
      while (cards.length < 4) cards.push(filler.shift());
      deck.push(...cards);
    }
  }
  assert.equal(new Set(deck).size, 32);
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

// Scenario deck: trump H with 7H concealed by seat 0.
// seat0: JS 9S AS TS KH QH 8H (+7H)   void D, C
// seat1: JD 9D AD TD JC 9C AC 9H      void S
// seat2: KD QD 8D 7D KC QC 8C 7C      void S, H
// seat3: JH AH TH KS QS 8S 7S TC      void D
const SCENARIO = stack(
  { 0: ['7H', 'JS', '9S', 'AS'], 1: ['JD', '9D', 'AD', 'TD'], 2: ['KD', 'QD', '8D', '7D'], 3: ['JH', 'AH', 'TH', 'KS'] },
  { 0: ['KH', 'QH', '8H', 'TS'], 1: ['JC', '9C', 'AC', '9H'], 2: ['KC', 'QC', '8C', '7C'], 3: ['QS', '8S', '7S', 'TC'] },
);

// Bring the scenario to play with seat 0 bidder at `bid`, trump 7H concealed. firstSeat = dealer+1.
function scenarioGame(dealer = 3) {
  const game = createGame({ dealer, decks: [SCENARIO], rng: mulberry32(1) });
  const first = (dealer + 1) % 4;
  if (first === 0) {
    act(game, 0, { type: 'bid', value: 14 });
    for (const s of [1, 2, 3]) act(game, s, { type: 'pass' });
  } else {
    // dealer 0 -> first seat 1
    act(game, 1, { type: 'bid', value: 14 });
    act(game, 2, { type: 'pass' });
    act(game, 3, { type: 'pass' });
    act(game, 0, { type: 'bid', value: 15 });
    for (const s of [1, 2, 3]) act(game, s, { type: 'pass' });
  }
  assert.equal(game.phase, 'chooseTrump');
  act(game, 0, { type: 'chooseTrump', card: '7H' });
  assert.equal(game.phase, 'bidding2');
  for (let i = 0; i < 4; i++) act(game, (first + i) % 4, { type: 'pass' });
  assert.equal(game.phase, 'playing');
  return game;
}

// ---------------------------------------------------------------------------
// cards

test('ranking and points', () => {
  assert.deepEqual(RANKS, ['J', '9', 'A', 'T', 'K', 'Q', '8', '7']);
  assert.deepEqual(SUITS, ['S', 'H', 'D', 'C']);
  assert.ok(rankIndex('JS') < rankIndex('9S'));
  assert.ok(rankIndex('9S') < rankIndex('AS'));
  assert.ok(rankIndex('TS') < rankIndex('KS'));
  assert.ok(rankIndex('8S') < rankIndex('7S'));
  assert.equal(pointsOf('JH'), 3);
  assert.equal(pointsOf('9H'), 2);
  assert.equal(pointsOf('AH'), 1);
  assert.equal(pointsOf('TH'), 1);
  assert.equal(pointsOf('KH'), 0);
  assert.equal(POINTS.J, 3);
  const deck = newDeck();
  assert.equal(deck.length, 32);
  assert.equal(new Set(deck).size, 32);
  assert.equal(deck.reduce((n, c) => n + pointsOf(c), 0), 28);
  assert.equal(suitOf('TD'), 'D');
  const sh = shuffle(newDeck(), mulberry32(5));
  assert.deepEqual([...sh].sort(), [...deck].sort());
  assert.deepEqual(sortHand(['7D', 'JC', 'AH', '9S', 'JS', 'TH']), ['JS', '9S', 'AH', 'TH', 'JC', '7D']);
});

// ---------------------------------------------------------------------------
// bidding

test('first bidder must bid; redeal only without point cards', () => {
  const game = createGame({ dealer: 3, decks: [SCENARIO], rng: mulberry32(2) });
  assert.equal(game.firstSeat, 0);
  assert.equal(currentTurn(game), 0);
  const v = getView(game, 0);
  assert.deepEqual(v.legal.actions, ['bid']);
  assert.equal(v.legal.minBid, 14);
  reject(game, 0, { type: 'pass' }, /must bid/);
  reject(game, 0, { type: 'redeal' }, /point card/);
  reject(game, 0, { type: 'bid', value: 13 }, /at least 14/);
  reject(game, 0, { type: 'bid', value: 29 });
  reject(game, 1, { type: 'bid', value: 15 }, /Not your turn/);

  // seat 0 with no point cards
  const g2 = createGame({ dealer: 3, decks: [stack({ 0: ['KS', 'QS', '8H', '7D'] }), SCENARIO], rng: mulberry32(3) });
  assert.deepEqual(getView(g2, 0).legal.actions, ['bid', 'redeal']);
  act(g2, 0, { type: 'redeal' });
  assert.equal(g2.dealer, 3, 'same dealer on redeal');
  assert.equal(g2.phase, 'bidding1');
  assert.deepEqual(g2.hands[0], ['7H', 'JS', '9S', 'AS']);
});

test('partner rule: >= 20 when partner holds bid and previous player passed', () => {
  const game = createGame({ dealer: 3, decks: [SCENARIO], rng: mulberry32(4) });
  act(game, 0, { type: 'bid', value: 14 });
  act(game, 1, { type: 'pass' });
  assert.equal(getView(game, 2).legal.minBid, 20);
  reject(game, 2, { type: 'bid', value: 15 }, /at least 20/);
  act(game, 2, { type: 'bid', value: 20 });
  assert.equal(getView(game, 3).legal.minBid, 21);
  act(game, 3, { type: 'pass' });
  // seat 0: partner (2) holds the bid and seat 3 passed -> 20 floor, but 21 already needed
  assert.equal(getView(game, 0).legal.minBid, 21);

  // previous player bid -> normal increment
  const g = createGame({ dealer: 3, decks: [SCENARIO], rng: mulberry32(4) });
  act(g, 0, { type: 'bid', value: 14 });
  act(g, 1, { type: 'bid', value: 15 });
  assert.equal(getView(g, 2).legal.minBid, 16);
  act(g, 2, { type: 'pass' });
  // seat 3: partner (1) holds the bid, seat 2 passed -> 20
  assert.equal(getView(g, 3).legal.minBid, 20);
});

test('3 passes in succession end round 1; passed player may bid again', () => {
  const game = createGame({ dealer: 3, decks: [SCENARIO], rng: mulberry32(4) });
  act(game, 0, { type: 'bid', value: 14 });
  act(game, 1, { type: 'pass' });
  act(game, 2, { type: 'pass' });
  act(game, 3, { type: 'bid', value: 15 });
  act(game, 0, { type: 'pass' });
  // seat 1 passed before and may bid again (partner 3 holds the bid and seat 0 passed -> >= 20)
  assert.equal(getView(game, 1).legal.minBid, 20);
  act(game, 1, { type: 'bid', value: 20 });
  act(game, 2, { type: 'pass' });
  act(game, 3, { type: 'pass' });
  assert.equal(game.phase, 'bidding1');
  act(game, 0, { type: 'pass' });
  assert.equal(game.phase, 'chooseTrump');
  assert.equal(currentTurn(game), 1);
  assert.deepEqual(game.contract, { bid: 20, bidder: 1 });
  const v = getView(game, 1);
  assert.deepEqual(v.legal.actions, ['chooseTrump']);
  assert.equal(v.legal.trumpChoices.length, 4);
  reject(game, 1, { type: 'chooseTrump', card: 'JS' }, /do not hold/);
});

test('round 2: all pass keeps contract; trump hidden from others', () => {
  const game = scenarioGame();
  assert.deepEqual(game.contract, { bid: 14, bidder: 0 });
  assert.equal(game.hands[0].length, 7);
  assert.equal(getView(game, 0).trump.suit, 'H');
  assert.equal(getView(game, 0).trump.card, '7H');
  for (const s of [1, 2, 3, null]) {
    const t = getView(game, s).trump;
    assert.equal(t.suit, null);
    assert.equal(t.card, null);
    assert.equal(t.concealed, true);
  }
  assert.deepEqual(getView(game, 0).handCounts, [7, 8, 8, 8]);
});

test('round 2: min 24, new bidder re-selects trump, old card returns', () => {
  const game = createGame({ dealer: 3, decks: [SCENARIO], rng: mulberry32(4) });
  act(game, 0, { type: 'bid', value: 14 });
  for (const s of [1, 2, 3]) act(game, s, { type: 'pass' });
  act(game, 0, { type: 'chooseTrump', card: '7H' });
  assert.equal(getView(game, 0).legal.minBid, 24);
  act(game, 0, { type: 'pass' });
  reject(game, 1, { type: 'bid', value: 23 }, /at least 24/);
  act(game, 1, { type: 'bid', value: 24 });
  act(game, 2, { type: 'pass' });
  act(game, 3, { type: 'pass' });
  act(game, 0, { type: 'pass' });
  assert.equal(game.phase, 'chooseTrump');
  assert.equal(currentTurn(game), 1);
  assert.ok(game.hands[0].includes('7H'));
  assert.equal(game.hands[0].length, 8);
  assert.equal(getView(game, 0).trump.card, null);
  assert.equal(getView(game, 1).legal.trumpChoices.length, 8);
  act(game, 1, { type: 'chooseTrump', card: '9C' });
  assert.equal(game.phase, 'playing');
  assert.deepEqual(game.contract, { bid: 24, bidder: 1 });
  assert.equal(getView(game, 1).trump.suit, 'C');
  assert.equal(getView(game, 0).trump.suit, null);
  assert.equal(currentTurn(game), 0);
});

test('round 2: same bidder raising keeps trump card', () => {
  const game = createGame({ dealer: 3, decks: [SCENARIO], rng: mulberry32(4) });
  act(game, 0, { type: 'bid', value: 14 });
  for (const s of [1, 2, 3]) act(game, s, { type: 'pass' });
  act(game, 0, { type: 'chooseTrump', card: '7H' });
  act(game, 0, { type: 'bid', value: 25 });
  for (const s of [1, 2, 3]) act(game, s, { type: 'pass' });
  assert.equal(game.phase, 'playing');
  assert.deepEqual(game.contract, { bid: 25, bidder: 0 });
  assert.equal(game.trump.card, '7H');
});

test('four jacks after deal 2 forces automatic redeal by same dealer', () => {
  const deck = stack({ 0: ['JS', 'JH', 'AS', '9S'] }, { 0: ['JD', 'JC'] });
  const game = createGame({ dealer: 3, decks: [deck, SCENARIO], rng: mulberry32(4) });
  act(game, 0, { type: 'bid', value: 14 });
  for (const s of [1, 2, 3]) act(game, s, { type: 'pass' });
  act(game, 0, { type: 'chooseTrump', card: '9S' });
  assert.equal(game.phase, 'bidding1');
  assert.equal(game.dealer, 3);
  assert.equal(game.contract, null);
  assert.deepEqual(game.hands[0], ['7H', 'JS', '9S', 'AS']);
  assert.equal(game.handNumber, 1);
});

// ---------------------------------------------------------------------------
// play restrictions

test('concealed trump: bidder may not lead trump while holding other suits', () => {
  const game = scenarioGame();
  const v = getView(game, 0);
  assert.deepEqual(v.legal.actions, ['play']);
  assert.deepEqual(v.legal.playable, ['JS', '9S', 'AS', 'TS']);
  reject(game, 0, { type: 'play', card: 'KH' }, /may not lead a trump/);
  reject(game, 0, { type: 'playTrumpCard' });
  reject(game, 0, { type: 'callTrump' });
});

test('callTrump: caller must play trump if held; trump power wins', () => {
  const game = scenarioGame();
  act(game, 0, { type: 'play', card: 'AS' });
  const v1 = getView(game, 1);
  assert.ok(v1.legal.actions.includes('callTrump'));
  assert.equal(v1.legal.playable.length, 8);
  reject(game, 2, { type: 'callTrump' }, /Not your turn/);
  act(game, 1, { type: 'callTrump' });
  assert.equal(game.trump.revealed, true);
  assert.ok(game.hands[0].includes('7H'));
  const v1b = getView(game, 1);
  assert.deepEqual(v1b.legal.actions, ['play']);
  assert.deepEqual(v1b.legal.playable, ['9H']);
  reject(game, 1, { type: 'play', card: 'JD' }, /must now play a trump/);
  reject(game, 1, { type: 'callTrump' });
  for (const s of [2, 3]) assert.equal(getView(game, s).trump.suit, 'H');
  act(game, 1, { type: 'play', card: '9H' });
  // seat 2 void in S: any card, face up now (trump revealed)
  act(game, 2, { type: 'play', card: '7D' });
  assert.equal(game.trick.cards[2].faceDown, false);
  reject(game, 3, { type: 'play', card: 'TC' }, /follow suit/);
  act(game, 3, { type: 'play', card: '7S' });
  assert.equal(game.lastTrick.winner, 1);
  assert.equal(game.lastTrick.points, 3);
  assert.deepEqual(game.teamPoints, [0, 3]);
  assert.equal(currentTurn(game), 1);
});

test('concealed trump: bidder void cannot trump from hand; face-down discards; playTrumpCard', () => {
  const game = scenarioGame(0); // first seat 1
  assert.equal(currentTurn(game), 1);
  act(game, 1, { type: 'play', card: 'JD' });
  act(game, 2, { type: 'play', card: '7D' });
  // seat 3 void in D: discard face down
  act(game, 3, { type: 'play', card: '7S' });
  assert.equal(game.trick.cards[2].faceDown, true);
  assert.equal(getView(game, 2).trick.cards[2].card, null);
  assert.equal(getView(game, null).trick.cards[2].card, null);
  assert.equal(getView(game, 3).trick.cards[2].card, '7S');
  assert.ok(!JSON.stringify(getView(game, 0)).includes('"7S"'));
  const v0 = getView(game, 0);
  assert.deepEqual(v0.legal.playable, ['JS', '9S', 'AS', 'TS']);
  assert.ok(v0.legal.actions.includes('playTrumpCard'));
  assert.ok(!v0.legal.actions.includes('callTrump'));
  reject(game, 0, { type: 'play', card: 'KH' }, /may not trump from hand/);
  act(game, 0, { type: 'playTrumpCard' });
  // reveal makes face-down cards visible; 7H has trump power
  assert.equal(game.lastTrick.winner, 0);
  assert.deepEqual(game.lastTrick.cards.map((e) => e.card), ['JD', '7D', '7S', '7H']);
  assert.equal(game.trump.revealed, true);
  assert.equal(game.trump.revealedBy, 0);
  assert.equal(game.trump.revealedInTrick, 0);
  assert.deepEqual(game.teamPoints, [3, 0]);
  // phase two: bidder has no restrictions on lead
  assert.ok(getView(game, 0).legal.playable.includes('KH'));
});

test('face-down card becomes visible immediately on reveal mid-trick', () => {
  const game = scenarioGame(0);
  act(game, 1, { type: 'play', card: 'JD' });
  act(game, 2, { type: 'play', card: '7D' });
  act(game, 3, { type: 'play', card: '7S' });
  assert.equal(getView(game, 1).trick.cards[2].card, null);
  act(game, 0, { type: 'playTrumpCard' });
  // trick done -> lastTrick visible to all
  assert.equal(getView(game, 1).lastTrick.cards[2].card, '7S');
});

test('trump led by another: bidder follows from hand or may playTrumpCard', () => {
  const game = scenarioGame(0);
  // manipulate: seat 1 leads 9H
  game.trick.cards = [];
  act(game, 1, { type: 'play', card: '9H' });
  act(game, 2, { type: 'play', card: '7C' }); // void in H, discard face down
  act(game, 3, { type: 'play', card: 'AH' });
  const v = getView(game, 0);
  assert.deepEqual(v.legal.playable, ['KH', 'QH', '8H']);
  assert.ok(v.legal.actions.includes('playTrumpCard'));
  act(game, 0, { type: 'play', card: 'KH' });
  // trump never revealed: highest heart wins (AH ranks below 9H)
  assert.equal(game.lastTrick.winner, 1);
  assert.equal(game.trump.concealed, true);
});

test('bidder with only trumps may lead one without reveal; empty hand forces playTrumpCard', () => {
  const game = scenarioGame();
  game.hands[0] = ['KH', 'QH'];
  const v = getView(game, 0);
  assert.deepEqual(v.legal.playable, ['KH', 'QH']);
  assert.deepEqual(v.legal.actions, ['play']);
  act(game, 0, { type: 'play', card: 'KH' });
  assert.equal(game.trump.concealed, true);
  assert.equal(game.trick.cards[0].faceDown, false);

  const g = scenarioGame();
  g.hands[0] = [];
  const v2 = getView(g, 0);
  assert.deepEqual(v2.legal.actions, ['playTrumpCard']);
  assert.deepEqual(v2.legal.playable, []);
  act(g, 0, { type: 'playTrumpCard' });
  assert.equal(g.trick.cards[0].card, '7H');
  assert.equal(g.trump.revealed, true);
});

test('non-bidder who can follow may not call trump; cannot call when leading', () => {
  const game = scenarioGame(0);
  reject(game, 1, { type: 'callTrump' }, /leading/);
  act(game, 1, { type: 'play', card: 'JD' });
  reject(game, 2, { type: 'callTrump' }, /follow suit/);
  reject(game, 2, { type: 'play', card: 'KC' }, /follow suit/);
});

// ---------------------------------------------------------------------------
// trump power

const E = (seat, card, discard = false, afterReveal = false) => ({ seat, card, discard, afterReveal });

test('trump power edge cases', () => {
  // trump never revealed: discarded trump has no power
  assert.equal(trickWinnerIndex([E(0, 'AS'), E(1, 'JH', true), E(2, '7S'), E(3, 'KS')], 'H', false), 0);
  // face-down trump discard, revealed later in trick -> has power
  assert.equal(trickWinnerIndex([E(0, 'AS'), E(1, '8H', true), E(2, 'JD', true, true), E(3, 'KS', false, true)], 'H', true), 1);
  // trump led before reveal: following trumps have no power
  const tl = [E(0, 'KH'), E(1, '9H'), E(2, 'JS', true, true)];
  assert.equal(trickWinnerIndex(tl, 'H', true), 1);
  // trump played after reveal has power, even following suit
  assert.equal(trickWinnerIndex([...tl, E(3, '7H', false, true)], 'H', true), 3);
  // revealed in earlier trick: highest trump wins
  assert.equal(trickWinnerIndex([E(0, 'JS', false, true), E(1, '7H', true, true), E(2, 'QH', true, true), E(3, '9S', false, true)], 'H', true), 2);
  // non-led, non-trump discards never win
  assert.equal(trickWinnerIndex([E(0, '7S'), E(1, 'JD', true), E(2, 'JC', true), E(3, '8S')], 'H', false), 3);
});

// ---------------------------------------------------------------------------
// scoring

test('scoring table', () => {
  assert.equal(scoreDelta(14, true), 1);
  assert.equal(scoreDelta(19, false), -2);
  assert.equal(scoreDelta(20, true), 2);
  assert.equal(scoreDelta(24, false), -3);
  assert.equal(scoreDelta(25, true), 3);
  assert.equal(scoreDelta(28, false), -4);
});

function playOutHand(game) {
  let guard = 0;
  while (game.phase === 'playing' && guard++ < 100) {
    const s = currentTurn(game);
    act(game, s, chooseAction(getView(game, s)));
  }
}

test('hand end scoring, match end, dealer rotation', () => {
  const game = scenarioGame();
  playOutHand(game);
  assert.equal(game.phase, 'handEnd');
  assert.equal(currentTurn(game), null);
  const r = game.handResult;
  assert.equal(r.teamPoints[0] + r.teamPoints[1], 28);
  assert.equal(r.made, r.teamPoints[0] >= 14);
  assert.deepEqual(r.delta, [r.made ? 1 : -2, 0]);
  assert.deepEqual(game.scores, r.delta);
  for (const s of [0, 1, 2, 3]) assert.deepEqual(getView(game, s).legal.actions, ['nextHand']);
  assert.deepEqual(getView(game, null).legal.actions, []);
  reject(game, 1, { type: 'pass' });
  act(game, 2, { type: 'nextHand' });
  assert.equal(game.dealer, 0);
  assert.equal(game.firstSeat, 1);
  assert.equal(game.handNumber, 2);
  assert.equal(game.phase, 'bidding1');

  // match end at +target
  const g = scenarioGame();
  g.scores = [5, 0];
  g.hands = g.hands; // play out
  playOutHand(g);
  if (g.handResult.made) {
    assert.equal(g.phase, 'matchEnd');
    assert.equal(g.matchWinner, 0);
  } else {
    assert.equal(g.phase, 'handEnd');
  }
  // match end at -target
  const g2 = scenarioGame();
  g2.scores = [-4, 0];
  playOutHand(g2);
  if (!g2.handResult.made) {
    assert.equal(g2.phase, 'matchEnd');
    assert.equal(g2.matchWinner, 1);
    reject(g2, 0, { type: 'nextHand' }, /over/);
  } else {
    assert.deepEqual(g2.scores, [-3, 0]);
  }
});

// ---------------------------------------------------------------------------
// fuzz

function checkView(game, viewer) {
  const v = getView(game, viewer);
  const json = JSON.stringify(v);
  assert.deepEqual(JSON.parse(json), v, 'view is JSON-safe');
  const bidder = game.contract ? game.contract.bidder : null;
  const t = game.trump;
  const secrets = new Set();
  for (let s = 0; s < 4; s++) if (s !== viewer) for (const c of game.hands[s]) secrets.add(c);
  if (t.revealed) secrets.delete(t.card);
  if (t.concealed && viewer !== bidder) secrets.add(t.card);
  for (const e of game.trick.cards) if (e.faceDown && e.seat !== viewer) secrets.add(e.card);
  // log lines from before the current deal mention cards from earlier deals; only check this deal
  let start = 0;
  v.log.forEach((l, i) => { if (/^Hand \d+:|redeal/.test(l)) start = i + 1; });
  const logTokens = new Set(v.log.slice(start).join(' ').split(/[^A-Z0-9]+/));
  for (const c of secrets) {
    assert.ok(!json.includes(`"${c}"`), `view for ${viewer} leaks ${c}`);
    assert.ok(!logTokens.has(c), `log leaks ${c}`);
  }
  if (t.card && !t.revealed && viewer !== bidder) {
    assert.equal(v.trump.suit, null);
    assert.equal(v.trump.card, null);
  }
  if (viewer !== null) assert.deepEqual(v.hand, sortHand(game.hands[viewer]));
  else assert.deepEqual(v.hand, []);
  if (viewer !== currentTurn(game) && game.phase !== 'handEnd') assert.deepEqual(v.legal.actions, []);
  return v;
}

function checkCards(game) {
  const all = [...game.hands.flat(), ...game.deck, ...game.captured, ...game.trick.cards.map((e) => e.card)];
  if (game.trump.concealed) all.push(game.trump.card);
  assert.equal(all.length, 32, `card count in phase ${game.phase}`);
  assert.equal(new Set(all).size, 32, 'no duplicated cards');
}

test('fuzz: 500 bot matches keep invariants', () => {
  const rng = mulberry32(12345);
  let hands = 0, actions = 0;
  for (let m = 0; m < 500; m++) {
    const game = createGame({ targetScore: 1 + (m % 6), rng: mulberry32(1000 + m) });
    let guard = 0;
    let prevDealer = game.dealer;
    while (game.phase !== 'matchEnd') {
      assert.ok(guard++ < 20000, 'match terminates');
      checkCards(game);
      const views = [0, 1, 2, 3, null].map((s) => checkView(game, s));
      let seat = currentTurn(game);
      if (game.phase === 'handEnd') {
        const r = game.handResult;
        assert.equal(r.teamPoints[0] + r.teamPoints[1], 28);
        assert.equal(game.tricksWon.reduce((a, b) => a + b, 0), 8);
        assert.equal(game.captured.length, 32);
        assert.equal(r.delta[r.biddingTeam], scoreDelta(r.bid, r.made));
        assert.equal(r.delta[1 - r.biddingTeam], 0);
        hands++;
        seat = Math.floor(rng() * 4);
      }
      const v = views[seat];
      assert.ok(v.legal.actions.length > 0, `seat ${seat} has an action in ${game.phase}`);
      // legality accuracy: non-playable cards are rejected
      if (game.phase === 'playing' && rng() < 0.2) {
        for (const c of game.hands[seat]) {
          if (!v.legal.playable.includes(c)) reject(game, seat, { type: 'play', card: c });
        }
        for (const t of ['callTrump', 'playTrumpCard']) {
          if (!v.legal.actions.includes(t)) reject(game, seat, { type: t });
        }
      }
      const a = chooseAction(v);
      const seqBefore = game.seq;
      const r = applyAction(game, seat, a);
      assert.ok(r.ok, `bot action ${JSON.stringify(a)} rejected: ${r.error}`);
      assert.equal(game.seq, seqBefore + 1);
      actions++;
      if (a.type === 'nextHand') {
        assert.equal(game.dealer, (prevDealer + 1) % 4);
        prevDealer = game.dealer;
      }
      if (game.phase === 'matchEnd') {
        const r2 = game.handResult;
        assert.equal(r2.teamPoints[0] + r2.teamPoints[1], 28);
        const w = game.matchWinner;
        assert.ok(game.scores[w] >= game.targetScore || game.scores[1 - w] <= -game.targetScore);
        hands++;
      }
      assert.equal(game.dealer, prevDealer, 'dealer only rotates on nextHand');
    }
  }
  assert.ok(hands >= 500);
  assert.ok(actions > 10000);
});
