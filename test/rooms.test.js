import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

const FAST = { botDelay: 2, trickPause: 4, nextHandDelay: 10, takeoverDelay: 40, emptyRoomTtl: 200 };
const quiet = { error() {}, warn() {}, log() {} };

let connSeq = 0;
function fakeConn() {
  const c = {
    id: `c${++connSeq}`,
    states: [],
    chats: [],
    emit(event, data) {
      if (event === 'room:state') c.states.push(data);
      else if (event === 'chat:message') c.chats.push(data);
    },
    get state() { return c.states[c.states.length - 1] ?? null; },
  };
  return c;
}

async function waitFor(pred, timeout = 15000, msg = 'condition') {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${msg}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const managers = [];
function mgr(opts = {}) {
  const m = new RoomManager({ ...FAST, logger: quiet, ...opts });
  managers.push(m);
  return m;
}
after(() => managers.forEach((m) => m.close()));

test('create / join / sit / addBot / start with personalised views', () => {
  const m = mgr();
  const host = fakeConn();
  const guest = fakeConn();

  const created = m.handle(host, 'room:create', { name: '  Alice   the Great  ' });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-HJ-NP-Z]{4}$/);
  assert.ok(created.playerId && created.token);
  assert.equal(host.state.you.isHost, true);
  assert.equal(host.state.spectators[0].name, 'Alice the Great');
  assert.equal(host.state.status, 'lobby');

  assert.equal(m.handle(guest, 'room:join', { code: 'zzzz', name: 'Bob' }).ok, false);
  assert.equal(m.handle(guest, 'room:join', { code: created.code, name: '   ' }).ok, false);
  const joined = m.handle(guest, 'room:join', { code: ` ${created.code.toLowerCase()} `, name: 'B'.repeat(40) });
  assert.equal(joined.ok, true);
  assert.equal(joined.code, created.code);
  assert.equal(guest.state.spectators.find((s) => s.playerId === joined.playerId).name.length, 20);
  assert.equal(guest.state.you.isHost, false);

  assert.equal(m.handle(host, 'room:sit', { seat: 0 }).ok, true);
  assert.equal(m.handle(guest, 'room:sit', { seat: 0 }).ok, false, 'seat taken');
  assert.equal(m.handle(guest, 'room:sit', { seat: 5 }).ok, false, 'invalid seat');
  assert.equal(m.handle(guest, 'room:sit', { seat: 1 }).ok, true);
  assert.equal(m.handle(guest, 'room:sit', { seat: 2 }).ok, true, 'moves seat');
  assert.equal(guest.state.seats[1], null);
  assert.equal(guest.state.seats[2].playerId, joined.playerId);
  assert.equal(guest.state.you.seat, 2);

  assert.equal(m.handle(host, 'room:start', {}).ok, false, 'needs 4 seats');
  assert.equal(m.handle(host, 'room:addBot', { seat: 2 }).ok, false, 'seat taken');
  assert.equal(m.handle(host, 'room:addBot', { seat: 1 }).ok, true);
  assert.equal(m.handle(host, 'room:addBot', { seat: 3 }).ok, true);
  assert.equal(host.state.seats[1].isBot, true);
  assert.equal(m.handle(host, 'room:settings', { targetScore: 0 }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { targetScore: 4 }).ok, true);
  assert.equal(host.state.settings.targetScore, 4);

  assert.equal(m.handle(host, 'room:start', {}).ok, true);
  assert.equal(host.state.status, 'playing');
  assert.equal(host.state.game.mySeat, 0);
  assert.equal(guest.state.game.mySeat, 2);
  assert.equal(host.state.game.targetScore, 4);
  assert.notDeepEqual(host.state.game.hand, guest.state.game.hand);

  // lobby-only operations are rejected mid-game
  assert.equal(m.handle(guest, 'room:stand', {}).ok, false);
  assert.equal(m.handle(host, 'room:kick', { seat: 1 }).ok, false);
  assert.equal(m.handle(host, 'room:start', {}).ok, false);
});

test('host-only guards and kick', () => {
  const m = mgr();
  const host = fakeConn();
  const guest = fakeConn();
  const { code } = m.handle(host, 'room:create', { name: 'Host' });
  m.handle(guest, 'room:join', { code, name: 'Guest' });
  m.handle(guest, 'room:sit', { seat: 1 });

  for (const [ev, payload] of [
    ['room:addBot', { seat: 0 }],
    ['room:kick', { seat: 1 }],
    ['room:settings', { targetScore: 8 }],
    ['room:start', {}],
  ]) {
    const res = m.handle(guest, ev, payload);
    assert.equal(res.ok, false, ev);
    assert.match(res.error, /host/i);
  }
  const outsider = fakeConn();
  assert.equal(m.handle(outsider, 'room:addBot', { seat: 0 }).ok, false);
  assert.equal(m.handle(outsider, 'game:action', { type: 'pass' }).ok, false);
  assert.equal(m.handle(outsider, 'bogus:event', {}).ok, false);

  assert.equal(m.handle(host, 'room:kick', { seat: 1 }).ok, true);
  assert.equal(guest.state.seats[1], null);
  assert.equal(guest.state.spectators.some((s) => s.name === 'Guest'), true, 'kicked human becomes spectator');
  m.handle(host, 'room:addBot', { seat: 3 });
  assert.equal(m.handle(host, 'room:kick', { seat: 3 }).ok, true);
  assert.equal(host.state.seats[3], null);
});

test('host transfers when host leaves; last human leaving deletes room', () => {
  const m = mgr();
  const host = fakeConn();
  const guest = fakeConn();
  const { code } = m.handle(host, 'room:create', { name: 'Host' });
  const g = m.handle(guest, 'room:join', { code, name: 'Guest' });
  assert.equal(m.handle(host, 'room:leave', {}).ok, true);
  assert.equal(guest.state.hostId, g.playerId);
  assert.equal(guest.state.you.isHost, true);
  assert.equal(m.handle(guest, 'room:addBot', { seat: 0 }).ok, true);
  m.handle(guest, 'room:leave', {});
  assert.equal(m.getRoom(code), null);
});

test('chat broadcast, length cap and rate limit', () => {
  const m = mgr();
  const a = fakeConn();
  const b = fakeConn();
  const { code } = m.handle(a, 'room:create', { name: 'A' });
  m.handle(b, 'room:join', { code, name: 'B' });
  assert.equal(m.handle(a, 'chat:send', { text: 'x'.repeat(500) }).ok, true);
  assert.equal(b.chats[0].text.length, 200);
  assert.equal(b.chats[0].name, 'A');
  assert.equal(b.chats[0].seat, null);
  assert.equal(typeof b.chats[0].ts, 'number');
  assert.equal(m.handle(a, 'chat:send', { text: '   ' }).ok, false);
  for (let i = 0; i < 4; i++) assert.equal(m.handle(a, 'chat:send', { text: `m${i}` }).ok, true);
  assert.equal(m.handle(a, 'chat:send', { text: 'spam' }).ok, false);
  assert.equal(b.chats.length, 5);
  assert.equal(m.handle(b, 'chat:send', { text: 'hi' }).ok, true, 'limit is per player');
});

test('full game with 4 bots reaches handEnd and auto-advances to next hand', async () => {
  const m = mgr();
  const host = fakeConn();
  const { code } = m.handle(host, 'room:create', { name: 'Watcher' });
  for (let s = 0; s < 4; s++) assert.equal(m.handle(host, 'room:addBot', { seat: s }).ok, true);
  assert.equal(m.handle(host, 'room:start', {}).ok, true);
  assert.equal(host.state.game.mySeat, null, 'spectator view');

  await waitFor(() => host.states.some((s) => s.game?.phase === 'handEnd'), 20000, 'handEnd');
  const endState = host.states.find((s) => s.game?.phase === 'handEnd');
  assert.ok(endState.game.handResult);
  assert.equal(endState.game.tricksWon.reduce((a, b) => a + b, 0), 8);
  assert.equal(endState.game.teamPoints[0] + endState.game.teamPoints[1], 28);
  const firstHand = endState.game.handNumber;
  await waitFor(() => host.state.game.handNumber > firstHand || host.state.game.phase === 'matchEnd', 5000, 'auto nextHand');
  // seq increases monotonically across broadcasts
  const seqs = host.states.filter((s) => s.game).map((s) => s.game.seq);
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] >= seqs[i - 1]);
  m.handle(host, 'room:leave', {});
  assert.equal(m.getRoom(code), null);
});

test('trick pause delays bots after a completed trick', async () => {
  const m = mgr({ botDelay: 1, trickPause: 120, nextHandDelay: 10000 });
  const host = fakeConn();
  m.handle(host, 'room:create', { name: 'W' });
  for (let s = 0; s < 4; s++) m.handle(host, 'room:addBot', { seat: s });
  m.handle(host, 'room:start', {});
  await waitFor(() => host.state.game.lastTrick, 20000, 'first trick');
  const t0 = Date.now();
  const seq = host.state.game.seq;
  await waitFor(() => host.state.game.seq > seq, 5000, 'next bot action');
  assert.ok(Date.now() - t0 >= 90, `bot waited ${Date.now() - t0}ms`);
});

test('reconnection with token, bot takeover after disconnect, and handback', async () => {
  const m = mgr();
  const human = fakeConn();
  const watcher = fakeConn();
  const res = m.handle(human, 'room:create', { name: 'Hum' });
  m.handle(watcher, 'room:join', { code: res.code, name: 'Watch' });
  m.handle(human, 'room:sit', { seat: 0 });
  for (const s of [1, 2, 3]) m.handle(human, 'room:addBot', { seat: s });
  m.handle(human, 'room:start', {});

  // simple reconnect in-game
  m.disconnect(human);
  assert.equal(watcher.state.seats[0].connected, false);
  assert.equal(watcher.state.seats[0].playerId, res.playerId, 'seat kept while disconnected');
  const human2 = fakeConn();
  const re = m.handle(human2, 'room:join', { code: res.code, name: 'Hum', token: res.token });
  assert.equal(re.ok, true);
  assert.equal(re.playerId, res.playerId);
  assert.equal(re.token, res.token);
  assert.equal(human2.state.you.seat, 0);
  assert.equal(human2.state.you.isHost, true);
  assert.equal(human2.state.seats[0].connected, true);
  assert.equal(human2.state.game.mySeat, 0);
  assert.ok(human2.state.game.hand.length > 0);
  // stale conn no longer acts for the player
  assert.equal(m.handle(human, 'room:stand', {}).ok, false);

  // bad token joins as a new player instead
  const other = fakeConn();
  const o = m.handle(other, 'room:join', { code: res.code, name: 'Other', token: 'nope' });
  assert.notEqual(o.playerId, res.playerId);

  // disconnect long enough for takeover: bot plays the human's seat to handEnd
  m.disconnect(human2);
  await waitFor(() => watcher.state.seats[0].botControlled, 2000, 'takeover');
  await waitFor(() => watcher.states.some((s) => s.game?.phase === 'handEnd'), 20000, 'handEnd under takeover');
  const human3 = fakeConn();
  m.handle(human3, 'room:join', { code: res.code, name: 'Hum', token: res.token });
  assert.equal(human3.state.seats[0].botControlled, false, 'handed back');
  assert.equal(human3.state.seats[0].connected, true);
});

test('room with no connected humans is cleaned up after TTL', async () => {
  const m = mgr({ emptyRoomTtl: 30 });
  const a = fakeConn();
  const { code, token } = m.handle(a, 'room:create', { name: 'A' });
  m.disconnect(a);
  assert.ok(m.getRoom(code));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(m.getRoom(code), null);
  assert.equal(m.handle(fakeConn(), 'room:join', { code, name: 'A', token }).ok, false);
});

test('socket.io integration: create, join, healthz', async (t) => {
  let ioc;
  try {
    ioc = (await import('socket.io-client')).io;
  } catch {
    t.skip('socket.io-client not installed');
    return;
  }
  const { createAppServer } = await import('../server/index.js');
  const srv = createAppServer({ roomOptions: { ...FAST, logger: quiet } });
  await new Promise((r) => srv.server.listen(0, r));
  const url = `http://localhost:${srv.server.address().port}`;
  try {
    const health = await (await fetch(`${url}/healthz`)).json();
    assert.equal(health.ok, true);

    const c1 = ioc(url, { transports: ['websocket'], forceNew: true });
    const c2 = ioc(url, { transports: ['websocket'], forceNew: true });
    const req = (c, ev, p) => new Promise((r) => c.emit(ev, p, r));
    let last2 = null;
    c2.on('room:state', (s) => { last2 = s; });
    const r1 = await req(c1, 'room:create', { name: 'One' });
    assert.equal(r1.ok, true);
    const r2 = await req(c2, 'room:join', { code: r1.code, name: 'Two' });
    assert.equal(r2.ok, true);
    assert.equal((await req(c2, 'room:addBot', { seat: 0 })).ok, false);
    assert.equal((await req(c1, 'room:addBot', { seat: 0 })).ok, true);
    await waitFor(() => last2?.seats[0]?.isBot, 2000, 'state broadcast');
    assert.equal(last2.you.playerId, r2.playerId);
    c1.close();
    c2.close();
  } finally {
    await srv.close();
  }
});
