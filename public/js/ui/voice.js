// Voice chat controls (lobby + game top bars) and talking indicators on seats.
import { toast } from './toast.js';

const ICONS = {
  headset: '<svg viewBox="0 0 24 24" class="ico"><path d="M4 14v-2a8 8 0 0 1 16 0v2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="3" y="13" width="4" height="7" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="17" y="13" width="4" height="7" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  mic: '<svg viewBox="0 0 24 24" class="ico"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" class="ico"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  people: '<svg viewBox="0 0 24 24" class="ico"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {import('../voice.js').Voice} voice
 * @param {() => object|null} getRoom latest RoomView
 */
export function mountVoice(voice, getRoom) {
  const bars = [];
  const anchors = [
    document.querySelector('#screen-game .hud-right'),
    document.querySelector('#screen-lobby .topbar-right'),
  ].filter(Boolean);

  for (const anchor of anchors) {
    const bar = document.createElement('div');
    bar.className = 'voice-bar';
    bar.innerHTML = `
      <button class="icon-btn v-join" type="button" aria-label="Join voice chat" title="Join voice chat">${ICONS.headset}</button>
      <button class="icon-btn v-mute" type="button" hidden></button>
      <button class="icon-btn v-list" type="button" aria-label="Voice chat participants" aria-expanded="false" hidden>${ICONS.people}<span class="badge v-count"></span></button>
      <div class="voice-pop glass" role="dialog" aria-label="Voice chat" hidden></div>`;
    anchor.prepend(bar);
    bars.push(bar);

    bar.querySelector('.v-join').addEventListener('click', async () => {
      try { await voice.join(); } catch (e) { toast(e.message || 'Could not start voice chat'); }
    });
    bar.querySelector('.v-mute').addEventListener('click', () => voice.setMuted(!voice.muted));
    const listBtn = bar.querySelector('.v-list');
    const pop = bar.querySelector('.voice-pop');
    listBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      pop.hidden = !open;
      listBtn.setAttribute('aria-expanded', String(open));
      if (open) renderPop(pop);
    });
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'leave-voice') { voice.leave(); closePops(); }
      else if (b.dataset.act === 'peer-mute') voice.setPeerMuted(b.dataset.pid, !voice.peerMuted.has(b.dataset.pid));
      else if (b.dataset.act === 'self-mute') voice.setMuted(!voice.muted);
    });
  }
  document.addEventListener('click', closePops);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops(); });

  function closePops() {
    for (const bar of bars) {
      bar.querySelector('.voice-pop').hidden = true;
      bar.querySelector('.v-list').setAttribute('aria-expanded', 'false');
    }
  }

  function participants(r) {
    if (!r) return [];
    const list = [];
    r.seats.forEach((p, seat) => { if (p?.voice) list.push({ ...p, seat }); });
    for (const p of r.spectators || []) if (p.voice) list.push({ ...p, seat: null });
    return list;
  }

  function renderPop(pop) {
    const r = getRoom();
    const me = r?.you?.playerId;
    const list = participants(r);
    pop.innerHTML = `
      <div class="vp-head">Voice chat <span>${list.length} connected</span></div>
      <ul class="vp-list">
        ${list.map((p) => {
          const mine = p.playerId === me;
          const talking = voice.speaking.has(mine ? 'me' : p.playerId);
          const locallyMuted = voice.peerMuted.has(p.playerId);
          return `<li class="${talking ? 'talking' : ''}">
            <span class="vp-dot ${p.seat == null ? '' : `t${p.seat % 2}`}"></span>
            <span class="vp-name">${esc(p.name)}${mine ? ' <em>(you)</em>' : ''}${p.muted ? ' <em class="vp-muted">muted</em>' : ''}</span>
            ${mine
              ? `<button class="btn btn-ghost btn-xs" type="button" data-act="self-mute">${voice.muted ? 'Unmute' : 'Mute'}</button>`
              : `<button class="btn btn-ghost btn-xs" type="button" data-act="peer-mute" data-pid="${esc(p.playerId)}" aria-pressed="${locallyMuted}">${locallyMuted ? 'Unmute' : 'Silence'}</button>`}
          </li>`;
        }).join('')}
      </ul>
      <button class="btn btn-ghost btn-sm vp-leave" type="button" data-act="leave-voice">Leave voice chat</button>`;
  }

  function update() {
    const r = getRoom();
    const list = participants(r);
    for (const bar of bars) {
      const join = bar.querySelector('.v-join');
      const mute = bar.querySelector('.v-mute');
      const listBtn = bar.querySelector('.v-list');
      join.hidden = voice.active;
      join.disabled = voice.joining;
      join.classList.toggle('busy', voice.joining);
      mute.hidden = !voice.active;
      listBtn.hidden = !voice.active;
      if (voice.active) {
        mute.innerHTML = voice.muted ? ICONS.micOff : ICONS.mic;
        mute.classList.toggle('v-off', voice.muted);
        mute.classList.toggle('v-live', !voice.muted && voice.speaking.has('me'));
        const label = voice.muted ? 'Unmute microphone' : 'Mute microphone';
        mute.setAttribute('aria-label', label);
        mute.title = label;
        mute.setAttribute('aria-pressed', String(voice.muted));
        bar.querySelector('.v-count').textContent = list.length;
        const pop = bar.querySelector('.voice-pop');
        if (!pop.hidden) renderPop(pop);
      } else {
        bar.querySelector('.voice-pop').hidden = true;
      }
    }
    paintSeats(r);
  }

  function paintSeats(r) {
    if (!r) return;
    const me = r.you?.playerId;
    for (let seat = 0; seat < 4; seat++) {
      const p = r.seats[seat];
      const inVoice = !!p?.voice;
      const talking = inVoice && voice.speaking.has(p.playerId === me ? 'me' : p.playerId);
      const targets = [
        document.querySelector(`#screen-game .seat[data-seat="${seat}"] .plate`),
        document.querySelector(`#screen-lobby .lt-seat[data-seat="${seat}"]`),
      ];
      for (const el of targets) {
        if (!el) continue;
        el.classList.toggle('v-in', inVoice);
        el.classList.toggle('v-muted', inVoice && !!p.muted);
        el.classList.toggle('v-speaking', talking);
      }
    }
  }

  voice.onChange(update);
  update();
  return { update };
}
