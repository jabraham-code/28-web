// Lobby screen: room code + share, game picker (28 / Rummy), table diagram with
// seats (4 for 28, 2–6 around an ellipse for Rummy), host controls, spectators, chat.
import { h, $, esc, initials, teamOf, botBadge, SPARKLE } from './util.js';
import { mountChat } from './chat.js';
import { toast } from './toast.js';

const TARGETS = [3, 5, 7, 10];
const PLAYER_COUNTS = [2, 3, 4, 5, 6];
const POOLS = [101, 201];
const GAMES = {
  '28': { name: '28', title: 'Twenty-Eight', blurb: 'Hidden-trump trick-taking for two teams of two.', mark: '28' },
  rummy: { name: 'Rummy', title: 'Rummy', blurb: '13-card Indian Rummy, pool format, for 2–6 players.', mark: 'R' },
};
const POS28 = ['bottom', 'right', 'top', 'left'];

/** Seat centre (percent of the table box) on an ellipse; seat 0 at the bottom, seat+1 to its right (like 28). */
export function ellipsePos(i, n) {
  const a = Math.PI / 2 - (i * 2 * Math.PI) / n;
  return { x: 50 + 39 * Math.cos(a), y: 50 + 38 * Math.sin(a) };
}

export function mountLobby(root, ctx) {
  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-mark">28</span><span class="brand-name">Twenty-Eight</span></div>
      <div class="topbar-right">
        <button class="btn btn-ghost btn-sm" type="button" data-act="rules">How to play</button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="leave">Leave</button>
      </div>
    </header>
    <div class="lobby-grid">
      <main class="glass lobby-main">
        <div class="room-code-block">
          <div>
            <div class="eyebrow">Room code</div>
            <div class="room-code" aria-live="polite"></div>
          </div>
          <div class="share-btns">
            <button class="btn btn-gold btn-sm" type="button" data-act="copy"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M9 9h10v10H9zM5 15V5h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span>Copy invite link</span></button>
            <button class="btn btn-ghost btn-sm share-native" type="button" data-act="share" hidden>Share</button>
          </div>
        </div>
        <div class="game-pick" role="radiogroup" aria-labelledby="game-pick-label">
          <span class="eyebrow" id="game-pick-label">Game</span>
          <div class="game-cards">
            ${Object.entries(GAMES).map(([id, g]) => `
              <button type="button" role="radio" class="game-card" data-game="${id}">
                <span class="gc-mark gc-${id}" aria-hidden="true">${g.mark}</span>
                <span class="gc-text"><span class="gc-title">${g.title}</span><span class="gc-blurb">${g.blurb}</span></span>
                <span class="gc-check" aria-hidden="true"></span>
              </button>`).join('')}
          </div>
          <p class="gp-hint muted"></p>
        </div>
        <div class="lobby-table-wrap">
          <div class="lobby-table" role="group" aria-label="Seats">
            <div class="lt-felt"><div class="lt-center">
              <div class="lt-teams"></div>
              <div class="lt-hint muted"></div>
            </div></div>
          </div>
        </div>
        <div class="lobby-controls">
          <div class="setting rummy-only players-setting">
            <span class="eyebrow" id="players-label">Players</span>
            <div class="segmented" role="radiogroup" aria-labelledby="players-label">
              ${PLAYER_COUNTS.map((n) => `<button type="button" role="radio" class="seg" data-players="${n}">${n}</button>`).join('')}
            </div>
          </div>
          <div class="setting rummy-only pool-setting">
            <span class="eyebrow" id="pool-label">Pool</span>
            <div class="segmented" role="radiogroup" aria-labelledby="pool-label" aria-describedby="pool-hint">
              ${POOLS.map((n) => `<button type="button" role="radio" class="seg" data-pool="${n}">${n}</button>`).join('')}
            </div>
            <p class="sp-hint muted" id="pool-hint"></p>
          </div>
          <div class="setting only-28 target-setting">
            <span class="eyebrow" id="target-label">Starting points</span>
            <div class="segmented" role="radiogroup" aria-labelledby="target-label" aria-describedby="target-hint">
              ${TARGETS.map((t) => `<button type="button" role="radio" class="seg" data-target="${t}">${t}</button>`).join('')}
            </div>
            <div class="sp-explain">
              <div class="sp-mini" aria-hidden="true"><b class="t0-text sp-n"></b><span class="sp-bar"><i class="t0"></i><i class="t1"></i></span><b class="t1-text sp-n"></b></div>
              <p class="sp-hint muted" id="target-hint"></p>
            </div>
          </div>
          <div class="setting only-28 brain-setting">
            <span class="eyebrow" id="brain-label">Bots</span>
            <div class="segmented brain-seg" role="radiogroup" aria-labelledby="brain-label">
              <button type="button" role="radio" class="seg" data-brain="claude">${SPARKLE}<span>Claude AI</span></button>
              <button type="button" role="radio" class="seg" data-brain="classic">Classic</button>
            </div>
            <p class="brain-hint muted"></p>
          </div>
          <div class="setting timer-setting">
            <span class="eyebrow" id="timer-label">Turn timer</span>
            <div class="segmented" role="radiogroup" aria-labelledby="timer-label">
              ${[0, 20, 30, 45, 60].map((t) => `<button type="button" role="radio" class="seg" data-timer="${t}">${t ? `${t}s` : 'Off'}</button>`).join('')}
            </div>
          </div>
          <div class="setting hints-setting">
            <span class="eyebrow" id="hints-label">Hints</span>
            <div class="segmented" role="radiogroup" aria-labelledby="hints-label">
              <button type="button" role="radio" class="seg" data-hints="on">💡 On</button>
              <button type="button" role="radio" class="seg" data-hints="off">Off</button>
            </div>
          </div>
        </div>
        <div class="lobby-cta">
          <div class="lobby-buttons">
            <button class="btn btn-outline-gold" type="button" data-act="fill"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9.5" cy="13.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="13.5" r="1.5" fill="currentColor"/><path d="M12 4v4" stroke="currentColor" stroke-width="2"/></svg><span class="lbl-long">Fill empty seats with bots</span><span class="lbl-short">Fill with bots</span></button>
            <button class="btn btn-gold btn-lg" type="button" data-act="start">Start game</button>
          </div>
          <p class="start-hint muted" aria-live="polite"></p>
        </div>
      </main>
      <aside class="glass lobby-side">
        <section class="spectators">
          <h3 class="eyebrow">Watching <span class="spec-count"></span></h3>
          <ul class="spec-list"></ul>
          <button class="btn btn-ghost btn-sm" type="button" data-act="stand" hidden>Stand up &amp; watch</button>
        </section>
        <section class="lobby-chat-wrap">
          <h3 class="eyebrow">Chat</h3>
          <div class="lobby-chat"></div>
        </section>
      </aside>
    </div>`;

  mountChat($('.lobby-chat', root), { isVisible: () => !root.hidden });
  if (navigator.share) $('[data-act="share"]', root).hidden = false;

  let room = null;
  const link = () => `${location.origin}/?room=${room?.code || ''}`;

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (b.dataset.game) return b.dataset.game === room?.settings.gameType ? undefined : ctx.call('setSettings', { gameType: b.dataset.game });
    if (b.dataset.players) return ctx.call('setSettings', { players: Number(b.dataset.players) });
    if (b.dataset.pool) return ctx.call('setSettings', { poolLimit: Number(b.dataset.pool) });
    if (b.dataset.target) return ctx.call('setSettings', { targetScore: Number(b.dataset.target) });
    if (b.dataset.brain) return ctx.call('setSettings', { botBrain: b.dataset.brain });
    if (b.dataset.timer) return ctx.call('setSettings', { turnTimer: Number(b.dataset.timer) });
    if (b.dataset.hints) return ctx.call('setSettings', { hints: b.dataset.hints === 'on' });
    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(link());
        toast('Invite link copied', 'ok', 2000);
        b.classList.add('copied');
        setTimeout(() => b.classList.remove('copied'), 1500);
      } catch {
        prompt('Copy this invite link:', link());
      }
    } else if (act === 'share') {
      navigator.share({ title: 'Play 28 with me', text: `Join my 28 table, room ${room.code}`, url: link() }).catch(() => {});
    } else if (act === 'leave') ctx.leave();
    else if (act === 'rules') ctx.rules();
    else if (act === 'start') {
      b.disabled = true;
      try {
        if (await fillBots() !== false) await ctx.call('start');
      } finally { b.disabled = false; }
    }
    else if (act === 'stand') ctx.call('stand');
    else if (act === 'fill') {
      b.disabled = true;
      try { await fillBots(); } finally { b.disabled = false; }
    } else if (act === 'sit') ctx.call('sit', Number(b.dataset.seat));
    else if (act === 'bot') ctx.call('addBot', Number(b.dataset.seat));
    else if (act === 'kick') ctx.call('kick', Number(b.dataset.seat));
  });

  async function fillBots() {
    // An unseated host almost always wants to play: take the first empty seat before bots fill the rest.
    if (room.you.seat == null) {
      const free = room.seats.findIndex((p) => !p);
      if (free >= 0) {
        const r = await ctx.call('sit', free);
        if (r?.ok === false) return false;
        room = { ...room, seats: room.seats.map((p, i) => (i === free ? { playerId: room.you.playerId } : p)), you: { ...room.you, seat: free } };
      }
    }
    for (let s = 0; s < room.seats.length; s++) {
      if (room.seats[s]) continue;
      const r = await ctx.call('addBot', s);
      if (r?.ok === false) return false;
    }
    return true;
  }

  function seatHTML(r, s) {
    const p = r.seats[s];
    const me = r.you.seat === s;
    const host = r.you.isHost;
    const label = `<div class="lt-label">Seat ${s + 1}</div>`;
    if (!p) {
      return `${label}
        <div class="lt-empty">
          ${r.you.seat === s ? '' : `<button class="btn btn-seat" type="button" data-act="sit" data-seat="${s}" aria-label="Sit in seat ${s + 1}">Sit here</button>`}
          ${host ? `<button class="btn btn-ghost btn-xs" type="button" data-act="bot" data-seat="${s}" aria-label="Add bot to seat ${s + 1}">+ Bot</button>` : ''}
        </div>`;
    }
    const isHostSeat = p.playerId === r.hostId;
    return `${label}
      <div class="lt-player${me ? ' me' : ''}${p.connected === false ? ' offline' : ''}">
        <div class="avatar ${isRummy(r) ? 'tn' : `t${teamOf(s)}`}${p.ai === 'claude' ? ' claude' : ''}">${p.isBot ? botIcon() : esc(initials(p.name))}</div>
        <div class="lt-name">${esc(p.name)}</div>
        <div class="lt-tags">
          ${me ? '<span class="tag tag-you">You</span>' : ''}
          ${isHostSeat ? '<span class="tag tag-host">Host</span>' : ''}
          ${botBadge(p)}
          ${p.connected === false ? '<span class="tag tag-off">Offline</span>' : ''}
        </div>
        ${host && !me ? `<button class="icon-btn kick" type="button" data-act="kick" data-seat="${s}" aria-label="Remove ${esc(p.name)} from seat ${s + 1}">×</button>` : ''}
      </div>`;
  }

  const isRummy = (r) => r.settings.gameType === 'rummy';
  const tableEl = $('.lobby-table', root);
  let shape = null;

  /** (Re)build the seat elements when the game type / seat count changes. */
  function buildSeats(r) {
    const n = r.seats.length;
    const key = `${r.settings.gameType}:${n}`;
    if (key === shape) return;
    shape = key;
    tableEl.querySelectorAll('.lt-seat').forEach((el) => el.remove());
    const rummy = isRummy(r);
    tableEl.classList.toggle('rummy', rummy);
    tableEl.dataset.n = String(n);
    for (let s = 0; s < n; s++) {
      const el = document.createElement('div');
      el.dataset.seat = String(s);
      if (rummy) {
        const { x, y } = ellipsePos(s, n);
        el.className = 'lt-seat lt-ring';
        el.style.setProperty('--x', `${x.toFixed(2)}%`);
        el.style.setProperty('--y', `${y.toFixed(2)}%`);
      } else el.className = `lt-seat lt-pos-${POS28[s]} t${s % 2}`;
      tableEl.append(el);
    }
    if (!rummy) $('.lt-teams', root).innerHTML = '<span class="team-dot t0"></span>Seats 1 &amp; 3 <span class="muted">vs</span> <span class="team-dot t1"></span>Seats 2 &amp; 4';
  }

  function render(r) {
    room = r;
    buildSeats(r);
    const rummy = isRummy(r);
    const nSeats = r.seats.length;
    root.querySelector('.lobby-main').dataset.game = r.settings.gameType;
    root.querySelectorAll('.rummy-only').forEach((el) => (el.hidden = !rummy));
    root.querySelectorAll('.only-28').forEach((el) => (el.hidden = rummy));
    if (rummy) $('.lt-teams', root).textContent = `${nSeats} players \u00b7 pool ${r.settings.poolLimit}`;
    const codeEl = $('.room-code', root);
    if (codeEl.dataset.code !== r.code) {
      codeEl.dataset.code = r.code;
      codeEl.innerHTML = r.code.split('').map((c) => `<span>${c}</span>`).join('');
      codeEl.setAttribute('aria-label', `Room code ${r.code.split('').join(' ')}`);
    }
    for (let s = 0; s < nSeats; s++) {
      const el = root.querySelector(`.lt-seat[data-seat="${s}"]`);
      const html = seatHTML(r, s);
      if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
      el.classList.toggle('filled', !!r.seats[s]);
      el.classList.toggle('mine', r.you.seat === s);
    }
    const filled = r.seats.filter(Boolean).length;
    const host = r.you.isHost;
    const segOn = (sel, test) => root.querySelectorAll(sel).forEach((b) => {
      const on = test(b);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = !host;
    });
    segOn('.seg[data-timer]', (b) => Number(b.dataset.timer) === (r.settings.turnTimer ?? 0));
    segOn('.seg[data-hints]', (b) => (b.dataset.hints === 'on') === !!r.settings.hints);
    segOn('.seg[data-players]', (b) => Number(b.dataset.players) === r.settings.players);
    segOn('.seg[data-pool]', (b) => Number(b.dataset.pool) === r.settings.poolLimit);
    $('#pool-hint', root).textContent = `Points add up every deal \u2014 reach ${r.settings.poolLimit ?? 101} and you\u2019re out. Last player standing wins.`;
    root.querySelectorAll('.game-card').forEach((b) => {
      const on = b.dataset.game === r.settings.gameType;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = !host && !on;
      b.classList.toggle('readonly', !host);
      b.tabIndex = host || on ? 0 : -1;
    });
    $('.game-pick', root).classList.toggle('readonly', !host);
    $('.gp-hint', root).textContent = host ? '' : `${GAMES[r.settings.gameType]?.title || 'This game'} \u2014 the host picks the game.`;
    root.querySelectorAll('.seg[data-target]').forEach((b) => {
      const on = Number(b.dataset.target) === r.settings.targetScore;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = !host;
    });
    const sp = r.settings.targetScore;
    root.querySelectorAll('.sp-n').forEach((n) => (n.textContent = sp));
    root.querySelector('.sp-bar').style.setProperty('--n', sp * 2);
    $('#target-hint', root).textContent = `Both teams start with ${sp}. Points move between teams after every hand \u2014 drop below 0 and you lose.`;
    root.querySelector('.lobby-main').classList.toggle('is-host', host);
    const avail = !!r.settings.claudeAvailable;
    const brain = r.settings.botBrain || 'classic';
    const brainSet = $('.brain-setting', root);
    brainSet.querySelectorAll('.seg').forEach((b) => {
      const on = b.dataset.brain === brain;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = !host || (b.dataset.brain === 'claude' && !avail);
    });
    brainSet.classList.toggle('readonly', !host);
    $('.brain-hint', root).textContent = !avail
      ? 'Set ANTHROPIC_API_KEY on the server to enable Claude AI bots.'
      : brain === 'claude' ? 'Bots think with Claude and may chat at the table. Moves can take a few seconds.' : 'Fast rule-based bots.';
    const start = $('[data-act="start"]', root);
    start.hidden = !host;
    const empty = nSeats - filled;
    start.textContent = empty ? `Start with ${empty} bot${empty > 1 ? 's' : ''}` : 'Start game';
    $('[data-act="fill"]', root).hidden = !host || filled === nSeats;
    $('[data-act="stand"]', root).hidden = r.you.seat == null;
    const hostName = r.seats.find((p) => p?.playerId === r.hostId)?.name || r.spectators.find((p) => p.playerId === r.hostId)?.name || 'the host';
    $('.start-hint', root).textContent = host
      ? empty ? `${empty} empty seat${empty === 1 ? '' : 's'} \u2014 invite friends with the link, or let bots fill in.` : 'Everyone is seated. Deal them in!'
      : empty ? `Waiting for players… (${filled}/${nSeats} seated)` : `Waiting for ${hostName} to start the game…`;
    $('.lt-hint', root).textContent = r.you.seat == null ? (rummy ? 'Pick an empty seat to join' : 'Pick an empty seat to join a team') : `You are in seat ${r.you.seat + 1}`;
    const specs = r.spectators || [];
    $('.spec-count', root).textContent = specs.length ? `(${specs.length})` : '';
    const list = $('.spec-list', root);
    const sHtml = specs.length
      ? specs.map((p) => `<li class="${p.connected === false ? 'offline' : ''}"><span class="avatar avatar-sm spec">${esc(initials(p.name))}</span>${esc(p.name)}${p.playerId === r.you.playerId ? ' <span class="tag tag-you">You</span>' : ''}${p.playerId === r.hostId ? ' <span class="tag tag-host">Host</span>' : ''}</li>`).join('')
      : '<li class="muted empty">Nobody is watching</li>';
    if (list.dataset.html !== sHtml) { list.dataset.html = sHtml; list.innerHTML = sHtml; }
  }

  return { render };
}

export function botIcon() {
  return '<svg viewBox="0 0 24 24" class="ico bot-ico" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9.5" cy="13.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="13.5" r="1.5" fill="currentColor"/><path d="M12 4v4M10 4h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}
