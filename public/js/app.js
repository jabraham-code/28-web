// 28 Online — app shell: wires Net (SPEC §4) to the UI screens.
import { Net } from './net.js';
import { $ } from './ui/util.js';
import { installSuitSprite } from './ui/cards.js';
import { toast } from './ui/toast.js';
import { mountLobby } from './ui/lobby.js';
import { mountTable } from './ui/table.js';
import { initChat, addMessage, clearChat, markRead } from './ui/chat.js';
import { showRules, showHandEnd, hideHandEnd, showMatchEnd, hideMatchEnd, isOpen } from './ui/modals.js';

installSuitSprite();

const NAME_KEY = '28.name';
const screens = { landing: $('#screen-landing'), lobby: $('#screen-lobby'), game: $('#screen-game') };
let current = 'landing';
let net;

try {
  net = new Net();
} catch (err) {
  console.error(err);
  setLandingMsg('Could not reach the game server. Please reload.', true);
}

if (net && new URLSearchParams(location.search).has('debug')) window.__net = net; // dev/testing hook

// ------------------------------------------------------------------ actions
async function call(method, ...args) {
  if (!net) return { ok: false, error: 'Not connected' };
  let res;
  try { res = await net[method](...args); } catch (e) { res = { ok: false, error: e?.message || 'Something went wrong' }; }
  if (res && res.ok === false) toast(res.error || 'That did not work');
  return res;
}

const ctx = {
  call,
  act: (action) => call('action', action),
  start: () => call('start'),
  rules: () => showRules(),
  async leave(confirmFirst = false) {
    const g = net?.state?.game;
    if (confirmFirst && g && !['matchEnd'].includes(g.phase) && net.state.you.seat != null &&
      !confirm('Leave this game? A bot will take over your seat after a while.')) return;
    await call('leave');
    toLanding();
  },
};

initChat({
  send: (text) => call('chat', text),
  onUnreadChange: (n) => table.setUnread(n),
});

const lobby = mountLobby(screens.lobby, ctx);
const table = mountTable(screens.game, ctx);

// ------------------------------------------------------------------ screens
function show(name) {
  if (current === name) return;
  current = name;
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  document.body.dataset.screen = name;
  if (name === 'game' && table.chatVisible()) markRead();
}

function toLanding() {
  hideHandEnd();
  hideMatchEnd();
  table.reset();
  clearChat();
  setRoomParam(null);
  show('landing');
  $('#name-input').focus();
}

function setRoomParam(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

// ------------------------------------------------------------------ render
let lastHandEndShown = null;
let matchShownSeq = null;

function render(room) {
  if (!room) return toLanding();
  setRoomParam(room.code);
  document.title = `28 · Room ${room.code}`;
  if (room.status === 'lobby' || !room.game) {
    hideHandEnd();
    hideMatchEnd();
    matchShownSeq = null;
    lobby.render(room);
    show('lobby');
    return;
  }
  show('game');
  table.render(room);
  const g = room.game;

  if (g.phase === 'handEnd') {
    const key = `${g.handNumber}`;
    if (lastHandEndShown !== key) {
      lastHandEndShown = key;
      table.whenIdle(() => {
        const s = net.state?.game;
        if (s?.phase === 'handEnd' && s.handNumber === g.handNumber) showHandEnd(net.state, ctx);
      });
    }
  } else if (isOpen('handEnd')) hideHandEnd();

  if (g.phase === 'matchEnd') {
    if (matchShownSeq == null) {
      matchShownSeq = g.seq;
      table.whenIdle(() => { if (net.state?.game?.phase === 'matchEnd') { hideHandEnd(); showMatchEnd(net.state, ctx); } });
    } else if (isOpen('matchEnd')) {
      // keep host/play-again controls current (e.g. host changed)
    }
  } else if (matchShownSeq != null) {
    matchShownSeq = null;
    hideMatchEnd();
  }
}

// ------------------------------------------------------------------ connection pill
const pill = $('#conn-pill');
let pillTimer;
function setStatus(st) {
  clearTimeout(pillTimer);
  pill.dataset.status = st;
  document.body.dataset.conn = st;
  pill.innerHTML = `<span class="pill-dot"></span>${st === 'connected' ? 'Connected' : st === 'reconnecting' ? 'Reconnecting…' : 'Offline — trying to reconnect'}`;
  pill.hidden = false;
  if (st === 'connected') pillTimer = setTimeout(() => (pill.hidden = true), 1600);
}

// ------------------------------------------------------------------ landing
const nameInput = $('#name-input');
const codeInput = $('#code-input');
const params = new URLSearchParams(location.search);
const paramCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

function storedName() {
  try { return localStorage.getItem(NAME_KEY) || net?.session?.name || ''; } catch { return ''; }
}
nameInput.value = storedName();
if (paramCode) {
  codeInput.value = paramCode;
  $('#landing-form').classList.add('invited');
  setLandingMsg(`You’ve been invited to room <b>${paramCode}</b>. Enter your name and join.`);
}

function setLandingMsg(html, bad = false) {
  const m = $('#landing-msg');
  m.innerHTML = html || '';
  m.classList.toggle('bad', bad);
}

function getName() {
  const n = nameInput.value.trim().slice(0, 20);
  if (!n) {
    nameInput.focus();
    nameInput.classList.add('shake');
    setTimeout(() => nameInput.classList.remove('shake'), 500);
    setLandingMsg('Please enter your name first.', true);
    return null;
  }
  try { localStorage.setItem(NAME_KEY, n); } catch {}
  return n;
}

async function withBusy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('loading');
  try { await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); }
}

$('#create-btn').addEventListener('click', (e) => {
  const name = getName();
  if (!name) return;
  withBusy(e.currentTarget, async () => {
    const res = await call('createRoom', name);
    if (res?.ok) setLandingMsg('');
  });
});

$('#landing-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = getName();
  if (!name) return;
  const code = codeInput.value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    codeInput.focus();
    setLandingMsg('Room codes are 4 letters.', true);
    return;
  }
  withBusy($('#join-btn'), async () => {
    const res = await call('joinRoom', code, name);
    if (res?.ok) setLandingMsg('');
  });
});

codeInput.addEventListener('input', () => {
  const pos = codeInput.selectionStart;
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  codeInput.setSelectionRange(pos, pos);
});
$('#landing-rules').addEventListener('click', () => showRules());

// ------------------------------------------------------------------ boot
document.body.dataset.screen = 'landing';
if (net) {
  net.on('state', render);
  net.on('chat', (m) => {
    addMessage(m);
    if (m.bot && current === 'game') table.say(m.seat, m.text);
  });
  net.on('status', setStatus);
  const s = net.session;
  if (s && (!paramCode || paramCode === s.code)) {
    setLandingMsg(`Rejoining room <b>${s.code}</b>…`);
    net.tryResume().then((ok) => {
      if (!ok && current === 'landing') setLandingMsg(paramCode ? `Room <b>${paramCode}</b> — enter your name and join.` : '');
      else if (ok) setLandingMsg('');
    });
  } else (paramCode ? nameInput.value ? $('#join-btn') : nameInput : nameInput).focus();
}
