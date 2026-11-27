import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, REACTIONS } from '../server/rooms.js';
import { legalOptions } from '../server/llmBot.js';

const FAST = { botDelay: 1, trickPause: 2, nextHandDelay: 5, takeoverDelay: 100000, emptyRoomTtl: 500, turnTimerUnit: 1 };
const quiet = { error() {}, warn() {}, log() {} };
let n = 0;
const conn = () => { const c = { id: `f${++n}`, states: [], chats: [], reactions: [], emit(e, d) { if (e === 'room:state') c.states.push(d); else if (e === 'chat:message') c.chats.push(d); else if (e === 'room:reaction') c.reactions.push(d); } }; c.last = () => c.states.at(-1); return c; };
const waitFor = async (pred, ms = 20000) => { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 3)); } };
const managers = [];
after(() => managers.forEach((m) => m.close()));

function setup(opts = {}) {
  const m = new RoomManager({ ...FAST, logger: quiet, llm: null, hint: null, ...opts });
  managers.push(m);
  const host = conn();
  const c = m.handle(host, 'room:create', { name: 'Host' });
  m.handle(host, 'room:sit', { seat: 0 });
  for (const s of [1, 2, 3]) m.handle(host, 'room:addBot', { seat: s });
  return { m, host, code: c.code };
}

test('settings: turn timer and hints validate and appear in the room view', () => {
  const { m, host } = setup();
  assert.equal(host.last().settings.turnTimer, 45);
  assert.equal(host.last().settings.hints, true);
  assert.ok(m.handle(host, 'room:settings', { turnTimer: 20, hints: false }).ok);
  assert.equal(host.last().settings.turnTimer, 20);
  assert.equal(host.last().settings.hints, false);
  assert.equal(m.handle(host, 'room:settings', { turnTimer: 17 }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { hints: 'yes' }).ok, false);
  assert.equal(m.handle(host, 'room:settings', { turnTimer: 17, targetScore: 8 }).ok, false);
  assert.equal(host.last().settings.targetScore, 5, 'invalid combo applies nothing');
});

test('turn timer auto-plays for an idle human and posts a notice', async () => {
  const { m, host } = setup();
  m.handle(host, 'room:settings', { turnTimer: 20 }); // 20 ms with turnTimerUnit 1
  m.handle(host, 'room:start', {});
  await waitFor(() => host.last().game?.handNumber >= 2 || host.last().game?.phase === 'handEnd');
  assert.ok(host.chats.some((c) => c.system && /ran out of time/.test(c.text)));
});

test('turn clock is exposed while a human is to act, absent when timer off', async () => {
  const { m, host } = setup();
  m.handle(host, 'room:settings', { turnTimer: 60 });
  m.handle(host, 'room:start', {});
  await waitFor(() => host.last().game?.turn === 0 && host.last().turnClock);
  const tc = host.last().turnClock;
  assert.equal(tc.seat, 0);
  assert.equal(tc.total, 60);
  m.handle(host, 'room:settings', { turnTimer: 0 });
  assert.equal(host.last().turnClock, null);
});

test('hints: classic fallback, one per turn, respects setting and turn', async () => {
  const { m, host } = setup();
  m.handle(host, 'room:settings', { turnTimer: 0 });
  m.handle(host, 'room:start', {});
  await waitFor(() => host.last().game?.turn === 0);
  const h = await m.handle(host, 'game:hint', {});
  assert.equal(h.ok, true);
  assert.equal(h.source, 'classic');
  assert.ok(legalOptions(host.last().game).some((o) => JSON.stringify(o.action) === JSON.stringify(h.action)));
  assert.ok(h.label);
  assert.equal((await m.handle(host, 'game:hint', {})).ok, false, 'second hint same move');
  m.handle(host, 'room:settings', { hints: false });
  assert.equal((await m.handle(host, 'game:hint', {})).ok, false);
});

test('hints: Claude coach result is used and validated', async () => {
  let calls = 0;
  const hint = async (view) => { calls++; const o = legalOptions(view); return { action: o.at(-1).action, reason: 'Save your Jack for later.' }; };
  const { m, host } = setup({ hint });
  m.handle(host, 'room:settings', { turnTimer: 0 });
  assert.equal(host.last().settings.hintSource, 'claude');
  m.handle(host, 'room:start', {});
  await waitFor(() => host.last().game?.turn === 0);
  const h = await m.handle(host, 'game:hint', {});
  assert.equal(h.source, 'claude');
  assert.equal(h.reason, 'Save your Jack for later.');
  assert.equal(calls, 1);
});

test('reactions broadcast with rate limit and whitelist', () => {
  const { m, host, code } = setup();
  const guest = conn();
  m.handle(guest, 'room:join', { code, name: 'Guest' });
  assert.ok(m.handle(host, 'room:react', { emoji: REACTIONS[0] }).ok);
  assert.equal(guest.reactions.at(-1).emoji, REACTIONS[0]);
  assert.equal(guest.reactions.at(-1).seat, 0);
  assert.equal(m.handle(host, 'room:react', { emoji: '<script>' }).ok, false);
  for (let i = 0; i < 3; i++) m.handle(host, 'room:react', { emoji: '🔥' });
  assert.equal(m.handle(host, 'room:react', { emoji: '🔥' }).ok, false, 'rate limited');
});

test('history records hands, match results and series; resets hands on rematch', async () => {
  const { m, host } = setup();
  m.handle(host, 'room:settings', { turnTimer: 20, targetScore: 1 });
  m.handle(host, 'room:start', {});
  await waitFor(() => host.last().game?.phase === 'matchEnd', 60000);
  const h = host.last().history;
  assert.ok(h.hands.length >= 1);
  const last = h.hands.at(-1);
  assert.ok(['S', 'H', 'D', 'C'].includes(last.trump));
  assert.equal(last.teamPoints[0] + last.teamPoints[1], 28);
  assert.equal(h.matches.length, 1);
  assert.equal(h.series[h.matches[0].winner], 1);
  assert.ok(m.handle(host, 'room:start', {}).ok);
  assert.equal(host.last().history.hands.length, 0);
  assert.equal(host.last().history.matches.length, 1);
});
