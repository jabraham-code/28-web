import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';
import { legalOptions } from '../server/llmBot.js';

const FAST = { botDelay: 1, trickPause: 2, nextHandDelay: 5, takeoverDelay: 40, emptyRoomTtl: 200 };
const quiet = { error() {}, warn() {}, log() {} };
let n = 0;
const conn = () => { const c = { id: `l${++n}`, states: [], chats: [], emit(e, d) { if (e === 'room:state') c.states.push(d); else if (e === 'chat:message') c.chats.push(d); } }; return c; };
const waitFor = async (pred, ms = 20000) => { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };
const managers = [];
after(() => managers.forEach((m) => m.close()));

function setup(llm) {
  const m = new RoomManager({ ...FAST, logger: quiet, llm });
  managers.push(m);
  const host = conn();
  m.handle(host, 'room:create', { name: 'Host' });
  m.handle(host, 'room:sit', { seat: 0 });
  for (const s of [1, 2, 3]) m.handle(host, 'room:addBot', { seat: s });
  return { m, host };
}

// Host plays the first legal option whenever it is their turn.
function autoplayHost(m, host) {
  const iv = setInterval(() => {
    const g = host.states.at(-1)?.game;
    if (!g) return;
    if (g.phase === 'handEnd') { m.handle(host, 'game:action', { type: 'nextHand' }); return; }
    if (g.turn !== 0) return;
    const o = legalOptions(g);
    if (o.length) m.handle(host, 'game:action', o[o.length - 1].action.type === 'redeal' ? o[0].action : o[0].action);
  }, 3);
  return () => clearInterval(iv);
}

test('Claude brain drives bots, chats, and the hand completes', async () => {
  let calls = 0;
  const llm = async (view, names) => {
    calls++;
    assert.equal(names.length, 4);
    await new Promise((r) => setTimeout(r, 3));
    const o = legalOptions(view);
    return { action: o[0].action, say: calls === 1 ? 'Good luck all!' : '' };
  };
  const { m, host } = setup(llm);
  assert.equal(host.states.at(-1).settings.botBrain, 'claude');
  assert.equal(host.states.at(-1).settings.claudeAvailable, true);
  assert.equal(host.states.at(-1).seats[1].ai, 'claude');
  assert.ok(m.handle(host, 'room:start', {}).ok);
  const stop = autoplayHost(m, host);
  await waitFor(() => host.states.at(-1).game?.phase === 'handEnd' || host.states.at(-1).game?.handNumber > 1);
  stop();
  assert.ok(calls > 0);
  assert.ok(host.chats.some((c) => c.bot && c.text === 'Good luck all!'));
});

test('failing / invalid Claude responses fall back to the classic bot', async () => {
  let k = 0;
  const llm = async () => { k++; if (k % 2) throw new Error('boom'); return { action: { type: 'play', card: 'XX' }, say: '' }; };
  const { m, host } = setup(llm);
  m.handle(host, 'room:start', {});
  const stop = autoplayHost(m, host);
  await waitFor(() => host.states.at(-1).game?.phase === 'handEnd' || host.states.at(-1).game?.handNumber > 1);
  stop();
  assert.ok(k > 0);
});

test('host can switch bot brain; claude unavailable without a key', () => {
  const { m, host } = setup(async () => null);
  assert.ok(m.handle(host, 'room:settings', { botBrain: 'classic' }).ok);
  assert.equal(host.states.at(-1).seats[1].ai, 'classic');
  const m2 = new RoomManager({ ...FAST, logger: quiet, llm: null }); managers.push(m2);
  const h2 = conn(); m2.handle(h2, 'room:create', { name: 'X' });
  assert.equal(h2.states.at(-1).settings.claudeAvailable, false);
  assert.equal(m2.handle(h2, 'room:settings', { botBrain: 'claude' }).ok, false);
});
