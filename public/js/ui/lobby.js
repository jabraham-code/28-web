// Lobby screen: room code + share, table diagram with seats, host controls, spectators, chat.
import { h, $, esc, initials, teamOf, botBadge, SPARKLE } from './util.js';
import { mountChat } from './chat.js';
import { toast } from './toast.js';

const TARGETS = [4, 6, 8, 10, 12];

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
        <div class="lobby-table-wrap">
          <div class="lobby-table" role="group" aria-label="Seats">
            <div class="lt-felt"><div class="lt-center">
              <div class="lt-teams"><span class="team-dot t0"></span>Seats 1 &amp; 3 <span class="muted">vs</span> <span class="team-dot t1"></span>Seats 2 &amp; 4</div>
              <div class="lt-hint muted"></div>
            </div></div>
            ${[0, 1, 2, 3].map((s) => `<div class="lt-seat lt-pos-${['bottom', 'right', 'top', 'left'][s]} t${s % 2}" data-seat="${s}"></div>`).join('')}
          </div>
        </div>
        <div class="lobby-controls">
          <div class="setting">
            <span class="eyebrow" id="target-label">Target score</span>
            <div class="segmented" role="radiogroup" aria-labelledby="target-label">
              ${TARGETS.map((t) => `<button type="button" role="radio" class="seg" data-target="${t}">${t}</button>`).join('')}
            </div>
          </div>
          <div class="setting brain-setting">
            <span class="eyebrow" id="brain-label">Bots</span>
            <div class="segmented brain-seg" role="radiogroup" aria-labelledby="brain-label">
              <button type="button" role="radio" class="seg" data-brain="claude">${SPARKLE}<span>Claude AI</span></button>
              <button type="button" role="radio" class="seg" data-brain="classic">Classic</button>
            </div>
            <p class="brain-hint muted"></p>
          </div>
          <div class="lobby-buttons">
            <button class="btn btn-outline-gold" type="button" data-act="fill"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9.5" cy="13.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="13.5" r="1.5" fill="currentColor"/><path d="M12 4v4" stroke="currentColor" stroke-width="2"/></svg><span>Fill empty seats with bots</span></button>
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
    if (b.dataset.target) return ctx.call('setSettings', { targetScore: Number(b.dataset.target) });
    if (b.dataset.brain) return ctx.call('setSettings', { botBrain: b.dataset.brain });
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
    for (let s = 0; s < 4; s++) {
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
        <div class="avatar t${teamOf(s)}${p.ai === 'claude' ? ' claude' : ''}">${p.isBot ? botIcon() : esc(initials(p.name))}</div>
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

  function render(r) {
    room = r;
    const codeEl = $('.room-code', root);
    if (codeEl.dataset.code !== r.code) {
      codeEl.dataset.code = r.code;
      codeEl.innerHTML = r.code.split('').map((c) => `<span>${c}</span>`).join('');
      codeEl.setAttribute('aria-label', `Room code ${r.code.split('').join(' ')}`);
    }
    for (let s = 0; s < 4; s++) {
      const el = root.querySelector(`.lt-seat[data-seat="${s}"]`);
      const html = seatHTML(r, s);
      if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
      el.classList.toggle('filled', !!r.seats[s]);
      el.classList.toggle('mine', r.you.seat === s);
    }
    const filled = r.seats.filter(Boolean).length;
    const host = r.you.isHost;
    root.querySelectorAll('.seg').forEach((b) => {
      const on = Number(b.dataset.target) === r.settings.targetScore;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = !host;
    });
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
    const empty = 4 - filled;
    start.textContent = empty ? `Start with ${empty} bot${empty > 1 ? 's' : ''}` : 'Start game';
    $('[data-act="fill"]', root).hidden = !host || filled === 4;
    $('[data-act="stand"]', root).hidden = r.you.seat == null;
    const hostName = r.seats.find((p) => p?.playerId === r.hostId)?.name || r.spectators.find((p) => p.playerId === r.hostId)?.name || 'the host';
    $('.start-hint', root).textContent = host
      ? filled < 4 ? `${4 - filled} empty seat${filled === 3 ? '' : 's'} \u2014 invite friends with the link, or let bots fill in.` : 'Everyone is seated. Deal them in!'
      : filled < 4 ? `Waiting for players… (${filled}/4 seated)` : `Waiting for ${hostName} to start the game…`;
    $('.lt-hint', root).textContent = r.you.seat == null ? 'Pick an empty seat to join a team' : `You are in seat ${r.you.seat + 1}`;
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
