import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/rooms.js';

const quiet = { error() {}, warn() {}, log() {} };
let n = 0;
const conn = () => {
  const c = { id: `v${++n}`, states: [], events: [], emit(e, d) { if (e === 'room:state') c.states.push(d); else c.events.push([e, d]); } };
  return c;
};
const managers = [];
after(() => managers.forEach((m) => m.close()));

function room() {
  const m = new RoomManager({ logger: quiet, llm: null });
  managers.push(m);
  const a = conn(), b = conn(), c = conn();
  const ra = m.handle(a, 'room:create', { name: 'A' });
  const rb = m.handle(b, 'room:join', { code: ra.code, name: 'B' });
  const rc = m.handle(c, 'room:join', { code: ra.code, name: 'C' });
  return { m, a, b, c, ida: ra.playerId, idb: rb.playerId, idc: rc.playerId, code: ra.code };
}

test('join returns existing peers and ICE servers; state shows voice + muted', () => {
  const { m, a, b, ida, idb } = room();
  const ja = m.handle(a, 'voice:join', {});
  assert.equal(ja.ok, true);
  assert.deepEqual(ja.peers, []);
  assert.ok(ja.iceServers[0].urls.length > 0);
  const jb = m.handle(b, 'voice:join', {});
  assert.deepEqual(jb.peers, [ida]);
  assert.ok(m.handle(b, 'voice:mute', { muted: true }).ok);
  const st = a.states.at(-1);
  const pb = st.spectators.find((p) => p.playerId === idb);
  assert.equal(pb.voice, true);
  assert.equal(pb.muted, true);
});

test('signals relay only between voice participants in the same room', () => {
  const { m, a, b, c, ida, idb, idc } = room();
  m.handle(a, 'voice:join', {});
  m.handle(b, 'voice:join', {});
  assert.ok(m.handle(b, 'voice:signal', { to: ida, data: { sdp: { type: 'offer', sdp: 'x' } } }).ok);
  assert.deepEqual(a.events.at(-1), ['voice:signal', { from: idb, data: { sdp: { type: 'offer', sdp: 'x' } } }]);
  assert.equal(m.handle(b, 'voice:signal', { to: idc, data: {} }).ok, false, 'target not in voice');
  assert.equal(m.handle(c, 'voice:signal', { to: ida, data: {} }).ok, false, 'sender not in voice');
  assert.equal(m.handle(b, 'voice:signal', { to: ida, data: { big: 'x'.repeat(20000) } }).ok, false, 'size cap');
  // a different room cannot reach us
  const o = room();
  o.m.handle(o.a, 'voice:join', {});
  assert.equal(o.m.handle(o.a, 'voice:signal', { to: ida, data: {} }).ok, false);
});

test('leave / disconnect notify peers and clear voice state', () => {
  const { m, a, b, ida, idb } = room();
  m.handle(a, 'voice:join', {});
  m.handle(b, 'voice:join', {});
  m.handle(b, 'voice:leave', {});
  assert.deepEqual(a.events.at(-1), ['voice:peer-left', { playerId: idb }]);
  m.handle(b, 'voice:join', {});
  m.disconnect(a);
  assert.deepEqual(b.events.at(-1), ['voice:peer-left', { playerId: ida }]);
  const pa = b.states.at(-1).spectators.find((p) => p.playerId === ida);
  assert.equal(pa.voice, false);
});

test('TURN server from env is offered', () => {
  process.env.TURN_URL = 'turn:turn.example.com:3478';
  process.env.TURN_USERNAME = 'u';
  process.env.TURN_CREDENTIAL = 'p';
  try {
    const { m, a } = room();
    const ice = m.handle(a, 'voice:join', {}).iceServers;
    assert.deepEqual(ice[1], { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'p' });
  } finally {
    delete process.env.TURN_URL; delete process.env.TURN_USERNAME; delete process.env.TURN_CREDENTIAL;
  }
});
