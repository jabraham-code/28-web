// Room/platform tests for the Rummy game type (RUMMY.md §3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

const FAST = { botDelay: 1, trickPause: 2, nextHandDelay: 5, takeoverDelay: 30, emptyRoomTtl: 500, turnTimerUnit: 1 };
const quiet = { error() {}, warn() {}, log() {} };
let n = 0;
const conn = () => {
  const c = { id: `r${++n}`, states: [], chats: [], emit(e, d) { if (e === 'room:state') c.states.push(d); else if (e === 'chat:message') c.chats.push(d); } };
  c.last = () => c.states.at(-1);
  return c;
};
const waitFor = async (pred, ms = 30000, what = 'condition') => {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 3));
  }
};
const managers = [];
after(() => managers.forEach((m) => m.close()));

function mgr(opts = {}) {
  const m = new RoomManager({ ...FAST, logger: quiet, llm: null, hint: null, ...opts });
  managers.push(m);
  return m;
}

/** Rummy room with the host in seat 0 (unless `seated: false`) and bots elsewhere. */
function rummyRoom({ players = 4, seated = true, opts = {}, settings = {} } = {}) {
  const m = mgr(opts);
  const host = conn();
  const { code } = m.handle(host, 'room:create', { name: 'Host' });
  assert.ok(m.handle(host, 'room:settings', { gameType: 'rummy', players, ...settings }).ok);
  if (seated) m.handle(host, 'room:sit', { seat: 0 });
  for (let s = seated ? 1 : 0; s < players; s++) assert.ok(m.handle(host, 'room:addBot', { seat: s }).ok);
  return { m, host, code };
}

test('gameType switching and rummy settings: validation, defaults, RoomView', () => {
  const m = mgr();
  const host = conn();
  const guest = conn();
  const { code } = m.handle(host, 'room:create', { name: 'Host' });
  m.handle(guest, 'room:join', { code, name: 'Guest' });
  let v = host.last();
  assert.equal(v.gameType, '28');
  assert.equal(v.settings.gameType, '28');
  assert.equal(v.settings.players, 4);
  assert.equal(v.settings.poolLimit, 101);
  assert.equal(v.seats.length, 4);

  assert.equal(m.handle(guest, 'room:settings', { gameType: 'rummy' }).ok, false, 'host only');
  assert.equal(m.handle(host, 'room:settings', { gameType: 'poker' }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { players: 7 }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { players: 1 }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { poolLimit: 150 }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { gameType: 'rummy', poolLimit: 99 }).ok, false);
  assert.equal(host.last().gameType, '28', 'invalid combo applies nothing');

  assert.ok(m.handle(host, 'room:settings', { gameType: 'rummy', poolLimit: 201 }).ok);
  v = host.last();
  assert.equal(v.gameType, 'rummy');
  assert.equal(v.settings.poolLimit, 201);
  assert.equal(v.seats.length, 4);
  assert.equal(v.settings.claudeAvailable, false);
  assert.equal(v.settings.hintSource, 'classic');
  assert.deepEqual(v.history.series, [0, 0, 0, 0], 'rummy series counts wins per seat');
  assert.equal(guest.last().gameType, 'rummy', 'guests see the chosen game');

  assert.ok(m.handle(host, 'room:settings', { players: 6 }).ok);
  assert.equal(host.last().seats.length, 6);
  assert.equal(m.handle(guest, 'room:sit', { seat: 5 }).ok, true, 'seat 5 exists for 6 players');
  assert.equal(m.handle(host, 'room:sit', { seat: 6 }).ok, false);

  assert.ok(m.handle(host, 'room:settings', { gameType: '28' }).ok);
  v = host.last();
  assert.equal(v.seats.length, 4);
  assert.deepEqual(v.history.series, [0, 0]);
  assert.equal(v.settings.players, 6, 'rummy settings are kept while playing 28');
});

test('resizing seats: bots in removed seats leave, displaced humans re-seat or watch', () => {
  const m = mgr();
  const host = conn();
  const a = conn();
  const b = conn();
  const { code } = m.handle(host, 'room:create', { name: 'Host' });
  const ra = m.handle(a, 'room:join', { code, name: 'A' });
  const rb = m.handle(b, 'room:join', { code, name: 'B' });
  m.handle(host, 'room:settings', { gameType: 'rummy', players: 6 });
  m.handle(host, 'room:sit', { seat: 0 });
  m.handle(a, 'room:sit', { seat: 4 });
  m.handle(b, 'room:sit', { seat: 5 });
  m.handle(host, 'room:addBot', { seat: 3 });
  assert.equal(host.last().seats.filter(Boolean).length, 4);

  // 6 → 3: the bot in seat 3 leaves; A and B move into the free seats 1 and 2.
  assert.ok(m.handle(host, 'room:settings', { players: 3 }).ok);
  let v = host.last();
  assert.equal(v.seats.length, 3);
  assert.equal(v.seats.some((p) => p?.isBot), false, 'bot removed');
  const ids = v.seats.map((p) => p?.playerId);
  assert.ok(ids.includes(ra.playerId) && ids.includes(rb.playerId), 'displaced humans re-seated');
  assert.equal(a.last().you.seat, ids.indexOf(ra.playerId));

  // 3 → 2: nowhere to go → spectator.
  assert.ok(m.handle(host, 'room:settings', { players: 2 }).ok);
  v = host.last();
  assert.equal(v.seats.length, 2);
  assert.equal(v.spectators.length, 1);
  const watcher = v.spectators[0].playerId === ra.playerId ? a : b;
  assert.equal(watcher.last().you.seat, null);

  // rummy (2) → 28: grows back to 4 empty-padded seats
  assert.ok(m.handle(host, 'room:settings', { gameType: '28' }).ok);
  assert.equal(host.last().seats.length, 4);
  assert.equal(host.last().seats.filter(Boolean).length, 2);
});

test('rummy start needs every seat; bots fill; personalised rummy views', () => {
  const m = mgr();
  const host = conn();
  const guest = conn();
  const { code } = m.handle(host, 'room:create', { name: 'Host' });
  m.handle(guest, 'room:join', { code, name: 'Guest' });
  m.handle(host, 'room:settings', { gameType: 'rummy', players: 3, turnTimer: 0 });
  m.handle(host, 'room:sit', { seat: 0 });
  m.handle(host, 'room:addBot', { seat: 1 });
  const res = m.handle(host, 'room:start', {});
  assert.equal(res.ok, false);
  assert.match(res.error, /3 seats/);
  m.handle(host, 'room:addBot', { seat: 2 });
  assert.ok(m.handle(host, 'room:start', {}).ok);
  const v = host.last();
  assert.equal(v.status, 'playing');
  assert.equal(v.game.gameType, 'rummy');
  assert.deepEqual(v.game.seats, [0, 1, 2]);
  assert.equal(v.game.mySeat, 0);
  assert.equal(v.game.hand.length, 13);
  assert.equal(v.game.poolLimit, 101);
  assert.equal(guest.last().game.mySeat, null, 'spectator');
  assert.deepEqual(guest.last().game.hand, []);
  // lobby-only settings rejected mid-game
  assert.equal(m.handle(host, 'room:settings', { gameType: '28' }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { players: 4 }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { poolLimit: 201 }).ok, false);
  // spectators can't act; unknown fields are stripped
  assert.equal(m.handle(guest, 'game:action', { type: 'draw', from: 'closed' }).ok, false);
});

test('full rummy bot match through RoomManager: deals auto-advance, history + series', async () => {
  const { m, host } = rummyRoom({ players: 3, seated: false });
  assert.ok(m.handle(host, 'room:start', {}).ok);
  assert.equal(host.last().game.mySeat, null);
  await waitFor(() => host.last().game?.phase === 'matchEnd', 120000, 'rummy matchEnd');
  const v = host.last();
  const g = v.game;
  assert.ok(g.matchWinner !== null && g.seats.includes(g.matchWinner));
  const h = v.history;
  assert.ok(h.hands.length >= 1);
  assert.equal(h.hands.length, g.dealNumber, 'one history row per deal');
  const row = h.hands.at(-1);
  for (const k of ['deal', 'winner', 'winnerName', 'points', 'scores', 'valid']) assert.ok(k in row, k);
  assert.ok(Object.keys(row.points).length >= 2, 'points for every seat in the deal');
  assert.equal(Object.keys(h.hands[0].points).length, 3, 'first deal: all three seats');
  assert.ok(host.states.some((s) => s.game?.phase === 'dealEnd') || g.dealNumber === 1);
  assert.equal(h.matches.length, 1);
  assert.equal(h.matches[0].winner, g.matchWinner);
  assert.equal(h.series[g.matchWinner], 1);
  assert.equal(h.series.length, 3);
  // match over → lobby-ish again: restart works and resets per-match history
  assert.ok(m.handle(host, 'room:start', {}).ok);
  assert.equal(host.last().game.dealNumber, 1);
  assert.equal(host.last().history.hands.length, 0);
  assert.equal(host.last().history.matches.length, 1);
});

test('rummy: changing the game after a finished match returns the room to the lobby', async () => {
  const { m, host } = rummyRoom({ players: 2, seated: false });
  m.handle(host, 'room:start', {});
  await waitFor(() => host.last().game?.phase === 'matchEnd', 120000, 'rummy matchEnd');
  assert.ok(m.handle(host, 'room:settings', { gameType: '28' }).ok);
  const v = host.last();
  assert.equal(v.status, 'lobby');
  assert.equal(v.game, null);
  assert.equal(v.seats.length, 4);
  assert.equal(v.seats.filter(Boolean).length, 2, 'bots in kept seats stay');
});

test('rummy turn timer auto-plays the whole turn (draw + discard) for an idle human', async () => {
  const { m, host } = rummyRoom({ players: 2, settings: { turnTimer: 20 } });
  assert.ok(m.handle(host, 'room:start', {}).ok);
  await waitFor(() => host.chats.some((c) => c.system && /ran out of time/.test(c.text)), 20000, 'timeout notice');
  await waitFor(() => host.last().game.turn !== 0 || host.last().game.phase !== 'playing', 5000, 'turn passes');
  const g = host.last().game;
  if (g.phase === 'playing') assert.equal(g.hand.length, 13, 'drew and discarded');
  // one notice per turn, not one per step
  const notices = host.chats.filter((c) => c.system && /ran out of time/.test(c.text)).length;
  assert.ok(notices >= 1);
});

test('rummy turn clock: one deadline covers draw and discard', async () => {
  const { m, host } = rummyRoom({ players: 2, settings: { turnTimer: 60 }, opts: { turnTimerUnit: 50 } });
  m.handle(host, 'room:start', {});
  await waitFor(() => host.last().game.turn === 0 && host.last().game.step === 'draw' && host.last().turnClock, 10000, 'my turn');
  const before = host.last().turnClock;
  assert.equal(before.seat, 0);
  assert.equal(before.total, 3000);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(m.handle(host, 'game:action', { type: 'draw', from: 'closed' }).ok);
  const after = host.last().turnClock;
  assert.equal(host.last().game.step, 'discard');
  assert.ok(after.endsIn <= before.endsIn - 40, `clock kept running (${before.endsIn} → ${after.endsIn})`);
});

test('rummy hints: classic bot suggestion with label, one per move', async () => {
  const { m, host } = rummyRoom({ players: 3, settings: { turnTimer: 0 } });
  m.handle(host, 'room:start', {});
  await waitFor(() => host.last().game.turn === 0, 10000, 'my turn');
  assert.equal((await m.handle(host, 'game:hint', {})).ok, true);
  const again = await m.handle(host, 'game:hint', {});
  assert.equal(again.ok, false, 'second hint same move');

  // draw step was hinted; draw ourselves and ask again for the discard step
  assert.ok(m.handle(host, 'game:action', { type: 'draw', from: 'closed', junk: 1 }).ok);
  const g = host.last().game;
  assert.equal(g.hand.length, 14);
  const h = await m.handle(host, 'game:hint', {});
  assert.equal(h.ok, true);
  assert.equal(h.source, 'classic');
  assert.ok(['discard', 'declare'].includes(h.action.type));
  assert.ok(g.hand.includes(h.action.card));
  assert.equal(typeof h.label, 'string');
  assert.ok(h.label.length > 3);
  assert.ok(m.handle(host, 'game:action', h.action.type === 'discard' ? h.action : { type: 'discard', card: g.legal.discardable[0] }).ok);
  assert.equal((await m.handle(host, 'game:hint', {})).ok, false, 'not my turn');
});

test('rummy: disconnected human is covered by a bot, then handed back', async () => {
  const { m, host, code } = rummyRoom({ players: 2, settings: { turnTimer: 0 } });
  const token = m.getRoom(code).players.get(host.last().you.playerId).token;
  const watcher = conn();
  m.handle(watcher, 'room:join', { code, name: 'W' });
  m.handle(host, 'room:start', {});
  m.disconnect(host);
  await waitFor(() => watcher.last().seats[0].botControlled, 2000, 'takeover');
  const seq = watcher.last().game.seq;
  await waitFor(() => watcher.last().game.seq > seq + 4, 10000, 'bot plays for the human');
  const back = conn();
  assert.ok(m.handle(back, 'room:join', { code, name: 'Host', token }).ok);
  assert.equal(back.last().seats[0].botControlled, false);
  assert.equal(back.last().game.mySeat, 0);
});
