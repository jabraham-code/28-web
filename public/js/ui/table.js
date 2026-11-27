// Game table: HUD, seats/plates, hands, trick area, action bar, drawers, and state-diff animations.
import { h, $, esc, POS, posOf, seatName, teamOf, initials, mapSeatNames, teamLabel, hash, suitOf, SUIT_NAMES, reducedMotion, botBadge, SPARKLE, cardName, rankOf, pointsOf } from './util.js';
import { createCard, createBack, setCard, suitIcon } from './cards.js';
import { flyFrom, flyTo, dealFlights, pulse } from './anim.js';
import { renderBidding, trumpBadgeHTML } from './bidding.js';
import { mountChat, markRead } from './chat.js';
import { botIcon } from './lobby.js';
import { renderHudScore } from './score.js';

const HOLD_MS = 1300;
const SWEEP_MS = 520;
const DEAL_STAGGER = 55;
const DEAL_DUR = 380;

export function mountTable(root, ctx) {
  root.innerHTML = `
    <header class="hud glass-bar">
      <div class="hud-left">
        <span class="brand-mark sm" aria-hidden="true">28</span>
        <div class="hud-meta"><span class="room-tag" title="Room code"></span><span class="hand-no"></span></div>
      </div>
      <div class="hud-scores" aria-label="Match score — open scoreboard" role="button" tabindex="0" title="Open scoreboard">
      </div>
      <div class="hud-contract">
        <div class="contract-chip" aria-live="polite"></div>
        <div class="trump-badge" aria-live="polite"></div>
        <div class="hand-pts" title="Card points captured this hand"></div>
      </div>
      <div class="hud-right">
        <button class="btn btn-ghost btn-xs brain-toggle" type="button" data-act="brain" hidden></button>
        <button class="icon-btn hud-opt" type="button" data-act="log" aria-label="Event log" aria-expanded="false"><svg viewBox="0 0 24 24" class="ico"><path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg></button>
        <button class="icon-btn" type="button" data-act="chat" aria-label="Chat" aria-expanded="false"><svg viewBox="0 0 24 24" class="ico"><path d="M4 5h16v11H9l-5 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg><span class="badge" hidden></span></button>
        <div class="more-wrap">
          <button class="icon-btn" type="button" data-act="more" aria-label="More options" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24" class="ico"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg></button>
          <div class="more-menu glass" role="menu" hidden>
            <button type="button" role="menuitem" data-act="scoreboard"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>Scoreboard</button>
            <button type="button" role="menuitemcheckbox" data-act="sound" aria-checked="true"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path class="snd-on" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path class="snd-off" d="M17 9l5 6M22 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg><span class="snd-label">Sound &amp; vibration: on</span></button>
            <button type="button" role="menuitem" data-act="rules"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>How to play</button>
            <button type="button" role="menuitem" class="menu-compact" data-act="log"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>Event log</button>
            <button type="button" role="menuitem" class="menu-compact" data-act="leave"><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>Leave room</button>
          </div>
        </div>
        <button class="icon-btn hud-opt" type="button" data-act="leave" aria-label="Leave room"><svg viewBox="0 0 24 24" class="ico"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button>
      </div>
      <div class="hand-card" aria-live="polite" hidden></div>
    </header>
    <div class="table-wrap">
      <div class="felt" role="region" aria-label="Card table">
        <div class="felt-rim" aria-hidden="true"></div>
        ${POS.map((p, i) => `
          <div class="seat pos-${p}" data-pos="${i}">
            ${i ? '<div class="fan" aria-hidden="true"></div>' : ''}
            <div class="plate" role="group"></div>
            <div class="bubble" aria-hidden="true"></div>
            <div class="say" role="status"></div>
            <div class="trump-slot" aria-hidden="true"></div>
          </div>`).join('')}
        <div class="trick-area" aria-live="polite" aria-label="Current trick">
          ${POS.map((p) => `<div class="trick-anchor pos-${p}"></div>`).join('')}
        </div>
        <div class="announce" aria-live="assertive"></div>
        <div class="bid-panel glass" hidden></div>
      </div>
      <div class="my-area">
        <div class="action-bar">
          <div class="status-text" aria-live="polite"></div>
          <span class="turn-clock" aria-live="off" hidden></span>
          <div class="action-btns">
            <button class="btn btn-ghost btn-sm hint-btn" type="button" data-act="hint" hidden><span aria-hidden="true">💡</span><span class="hint-label">Hint</span></button>
            <button class="btn btn-gold btn-sm" type="button" data-act="callTrump" hidden>Call trump</button>
            <button class="btn btn-gold btn-sm" type="button" data-act="revealTrump" hidden title="Turn up your trump card, then choose which trump to play">Reveal trump</button>
            <button class="btn btn-ghost btn-sm" type="button" data-act="playTrumpCard" hidden title="Play your face-down trump card into this trick">Play hidden trump</button>
          </div>
        </div>
        <div class="hint-box" role="status" hidden></div>
        <div class="react-wrap">
          <button class="icon-btn react-btn" type="button" data-act="react" aria-label="Send a reaction" aria-haspopup="true" aria-expanded="false"><span aria-hidden="true">😊</span></button>
          <div class="react-pop glass" role="menu" hidden></div>
        </div>
        <div class="hand-row">
          <div class="hand" role="group" aria-label="Your hand"></div>
          <div class="concealed-slot" hidden></div>
        </div>
        <div class="spectator-note" hidden><span class="tag tag-spec">Spectating</span> You are watching from seat 1's side.</div>
      </div>
    </div>
    <aside class="drawer log-drawer glass" aria-label="Event log" hidden>
      <button class="drawer-turn" type="button" data-act="drawer-return" hidden>Your turn — tap to return</button>
      <div class="drawer-head"><h3>Event log</h3><button class="icon-btn" type="button" data-act="log" aria-label="Close log">×</button></div>
      <ol class="log-list"></ol>
    </aside>
    <aside class="drawer chat-drawer glass" aria-label="Chat" hidden>
      <button class="drawer-turn" type="button" data-act="drawer-return" hidden>Your turn — tap to return</button>
      <div class="drawer-head"><h3>Chat</h3><button class="icon-btn" type="button" data-act="chat" aria-label="Close chat">×</button></div>
      <div class="chat-box"></div>
    </aside>`;

  const q = (s) => $(s, root);
  const felt = q('.felt');
  const handEl = q('.hand');
  const concealedEl = q('.concealed-slot');
  const bidPanel = q('.bid-panel');
  const seatEls = [0, 1, 2, 3].map((p) => q(`.seat[data-pos="${p}"]`));
  const anchors = [0, 1, 2, 3].map((p) => q(`.trick-anchor.pos-${POS[p]}`));
  const animLayer = document.getElementById('anim-layer');
  const logDrawer = q('.log-drawer'), chatDrawer = q('.chat-drawer');

  const chatBox = mountChat(q('.chat-box'), { isVisible: () => !chatDrawer.hidden && !root.hidden });

  let room = null; // current RoomView
  let prev = null; // previous GameView
  let prevRoomSeat = undefined;
  const live = new Map(); // seat -> trick element (current trick)
  let hold = null; // { els, timer, winner, index }
  const idleWaiters = [];
  let busy = false;
  let announceTimer = null;

  // -------------------------------------------------------------- events
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'log') { closeMenus(); toggleDrawer(logDrawer, b); }
    else if (act === 'chat') toggleDrawer(chatDrawer, b);
    else if (act === 'drawer-return') { setDrawer(logDrawer, false); setDrawer(chatDrawer, false); }
    else if (act === 'rules') { closeMenus(); ctx.rules(); }
    else if (act === 'more') { const m = q('.more-menu'); const open = m.hidden; closeMenus(); m.hidden = !open; b.setAttribute('aria-expanded', String(open)); }
    else if (act === 'scoreboard') { closeMenus(); ctx.scoreboard(); }
    else if (act === 'sound') { ctx.sounds.toggle(); }
    else if (act === 'hint') askHint(b);
    else if (act === 'react') { const pop = q('.react-pop'); const open = pop.hidden; closeMenus(); pop.hidden = !open; b.setAttribute('aria-expanded', String(open)); }
    else if (b.dataset.emoji) { closeMenus(); ctx.react(b.dataset.emoji); }
    else if (act === 'leave') { closeMenus(); ctx.leave(true); }
    else if (act === 'brain') ctx.call('setSettings', { botBrain: room.settings.botBrain === 'claude' ? 'classic' : 'claude' });
    else if (act === 'callTrump') doAct({ type: 'callTrump' });
    else if (act === 'playTrumpCard') doAct({ type: 'playTrumpCard' });
    else if (act === 'revealTrump') doAct({ type: 'revealTrump' });
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!q('.more-menu').hidden || !q('.react-pop').hidden) closeMenus();
      else if (!chatDrawer.hidden) toggleDrawer(chatDrawer);
      else if (!logDrawer.hidden) toggleDrawer(logDrawer);
    }
  });
  // Touch: first tap selects (lifts) a card, a second tap on the same card plays it; tapping
  // anywhere else deselects. Mouse clicks and keyboard activation play immediately.
  let lastPointer = '';
  let selected = null; // card element currently lifted (touch only)
  const coarse = matchMedia('(pointer: coarse)');
  root.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);
  const touchSelect = (e) => e.detail !== 0 && (lastPointer ? lastPointer === 'touch' : coarse.matches);
  function select(el) {
    if (selected === el) return;
    if (selected) selected.classList.remove('selected');
    selected = el;
    if (el) el.classList.add('selected');
    if (room?.game) renderActionBar(room, room.game);
  }
  function tapOrPlay(e, el, action) {
    if (touchSelect(e) && selected !== el) { select(el); return; }
    select(null);
    doAct(action);
  }
  handEl.addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (!c || !room?.game) return;
    const card = c.dataset.card;
    if (c.classList.contains('playable')) tapOrPlay(e, c, { type: 'play', card });
    else if (c.classList.contains('choosable')) tapOrPlay(e, c, { type: 'chooseTrump', card });
    else select(null);
  });
  concealedEl.addEventListener('click', (e) => {
    const c = e.target.closest('.card.playable');
    if (c) tapOrPlay(e, c, { type: 'playTrumpCard' });
  });
  document.addEventListener('click', (e) => { if (selected && !e.target.closest('.hand .card, .concealed-slot .card')) select(null); });

  const REACTIONS = ['👍', '😂', '😮', '😡', '🔥', '👏', '🙏', '😢'];
  q('.react-pop').innerHTML = REACTIONS.map((e) => `<button type="button" role="menuitem" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('');
  q('.hud-scores').addEventListener('click', () => ctx.scoreboard());
  q('.hud-scores').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.scoreboard(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.more-wrap, .react-wrap')) closeMenus(); });
  function closeMenus() {
    q('.more-menu').hidden = true; q('.react-pop').hidden = true;
    q('[data-act="more"]').setAttribute('aria-expanded', 'false');
    q('[data-act="react"]').setAttribute('aria-expanded', 'false');
  }
  function syncSound(on) {
    const b = q('[data-act="sound"]');
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('off', !on);
    q('.snd-label').textContent = `Sound & vibration: ${on ? 'on' : 'off'}`;
  }
  syncSound(ctx.sounds.enabled);
  ctx.sounds.onChange(syncSound);

  // -------------------------------------------------------------- hints
  let hintSeq = null;
  let lastHint = null;
  async function askHint(btn) {
    if (!room?.game || btn.disabled) return;
    const seq = room.game.seq;
    btn.disabled = true;
    btn.classList.add('busy');
    q('.hint-label').textContent = 'Thinking…';
    try {
      const res = await ctx.hint();
      if (!res?.ok || room?.game?.seq !== seq) return;
      hintSeq = seq;
      lastHint = res;
      showHint(res);
      ctx.sounds.play('hint');
    } finally {
      btn.classList.remove('busy');
      q('.hint-label').textContent = 'Hint';
      renderActionBar(room, room.game);
    }
  }
  function hintTarget(a, apply = false) {
    if (a.type === 'play' || a.type === 'chooseTrump') return handEl.querySelector(`.card[data-card="${a.card}"]`) || bidPanel.querySelector(`.card[data-card="${a.card}"]`);
    if (a.type === 'playTrumpCard') return concealedEl.querySelector('.card') || q('[data-act="playTrumpCard"]');
    if (a.type === 'callTrump') return q('[data-act="callTrump"]');
    if (a.type === 'revealTrump') return q('[data-act="revealTrump"]');
    if (a.type === 'bid') {
      if (apply) bidPanel._setBid?.(a.value); // dial the stepper to the suggested bid
      return bidPanel.querySelector('[data-hint="bid"]');
    }
    return bidPanel.querySelector(`[data-hint="${a.type}"]`);
  }
  function showHint(res) {
    clearHint();
    const box = q('.hint-box');
    box.innerHTML = `<span class="hb-ico" aria-hidden="true">💡</span><span><b>${esc(res.label)}</b>${res.reason ? ` — ${esc(res.reason)}` : ''}</span><span class="hb-src">${res.source === 'claude' ? `${SPARKLE} Claude` : 'Bot'}</span>`;
    box.hidden = false;
    hintTarget(res.action, true)?.classList.add('hinted');
  }
  function clearHint() {
    q('.hint-box').hidden = true;
    root.querySelectorAll('.hinted').forEach((el) => el.classList.remove('hinted'));
  }

  // -------------------------------------------------------------- reactions
  /** Floating emoji above a player's seat (or the table centre for spectators). */
  function react(seat, emoji, name) {
    if (!room?.game) return;
    const anchor = seat == null ? felt : $('.plate', seatEls[posOf(seat, room.you.seat ?? 0)]);
    const r = anchor.getBoundingClientRect();
    const el = h('div', { class: 'reaction-float', 'aria-hidden': 'true' }, h('span', { class: 'rf-emoji' }, emoji), seat == null && name ? h('span', { class: 'rf-name' }, name) : null);
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${seat == null ? r.top + r.height * 0.3 : r.top}px`;
    el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 40)}px`);
    document.body.append(el);
    setTimeout(() => el.remove(), 2200);
  }

  function toggleDrawer(d) {
    const other = d === logDrawer ? chatDrawer : logDrawer;
    const opening = d.hidden;
    if (opening && !other.hidden) setDrawer(other, false);
    setDrawer(d, opening);
  }
  function setDrawer(d, show) {
    d.hidden = !show;
    const which = d === logDrawer ? 'log' : 'chat';
    root.querySelectorAll(`.hud .icon-btn[data-act="${which}"]`).forEach((b) => b.setAttribute('aria-expanded', String(show)));
    root.classList.toggle(`${which}-open`, show);
    if (show && d === chatDrawer) { markRead(); setTimeout(() => chatBox.input.focus(), 50); }
    if (show && d === logDrawer) { const l = q('.log-list'); l.scrollTop = l.scrollHeight; }
  }

  async function doAct(action) {
    if (busy) return;
    busy = true;
    root.classList.add('busy');
    try { await ctx.act(action); } finally { busy = false; root.classList.remove('busy'); }
  }

  function setUnread(n) {
    const badge = q('.hud [data-act="chat"] .badge');
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
    if (n) pulse(badge, 'bump');
  }

  // -------------------------------------------------------------- snapshots (pre-render rects for FLIP)
  function snapshot() {
    const handRects = new Map();
    for (const c of handEl.children) handRects.set(c.dataset.card, c.getBoundingClientRect());
    return {
      handRects,
      handRect: handEl.getBoundingClientRect(),
      concealedRect: concealedEl.hidden ? null : concealedEl.getBoundingClientRect(),
      fanRects: seatEls.map((s) => $('.fan', s)?.getBoundingClientRect() || null),
      plateRects: seatEls.map((s) => $('.plate', s).getBoundingClientRect()),
      trumpRects: seatEls.map((s) => { const t = $('.trump-slot', s); return t.childElementCount ? t.getBoundingClientRect() : null; }),
    };
  }

  // -------------------------------------------------------------- main render
  function render(r) {
    room = r;
    const g = r.game;
    if (!g) return;
    const mySeat = r.you.seat;
    const viewSeat = mySeat ?? 0;
    if (prevRoomSeat !== undefined && prevRoomSeat !== mySeat) prev = null; // perspective changed
    prevRoomSeat = mySeat;
    const first = !prev;
    const snap = first ? null : snapshot();
    const P = (seat) => posOf(seat, viewSeat);

    root.classList.toggle('spectator', mySeat == null);
    q('.spectator-note').hidden = mySeat != null;

    renderHud(r, g);
    renderPlates(r, g, P);
    const dealInfo = first ? null : detectDeal(prev, g);
    renderFans(g, P, dealInfo);
    renderHand(r, g, dealInfo);
    renderConcealed(r, g);
    renderTrumpSlots(r, g, P);
    renderBubbles(r, g, P);
    if (hintSeq !== null && hintSeq !== g.seq) { hintSeq = null; lastHint = null; clearHint(); }
    renderActionBar(r, g);
    if (dealInfo && !reducedMotion()) dealUntil = performance.now() + dealTotal(dealInfo);
    renderBidding(bidPanel, r, ctx);
    deferPanelForDeal();
    if (bidPanelOpen()) { clearTimeout(announceTimer); q('.announce').innerHTML = ''; }
    if (hintSeq === g.seq && lastHint) hintTarget(lastHint.action)?.classList.add('hinted'); // panels may have re-rendered
    felt.dataset.phase = g.phase;
    renderTrick(r, g, P, snap, first);
    renderLog(r, g);
    if (dealInfo) runDeal(g, P, dealInfo, snap);
    if (!first) announcements(r, prev, g);
    prev = g;
  }

  // -------------------------------------------------------------- HUD
  function renderHud(r, g) {
    q('.room-tag').textContent = r.code;
    q('.hand-no').textContent = `Hand ${g.handNumber}`;
    renderHudScore(q('.hud-scores'), r, g, { animate: !!prev }); // tug-of-war score + card points (ui/score.js)
    const bt = q('.brain-toggle');
    const hasBots = r.seats.some((p) => p && (p.isBot || p.botControlled));
    bt.hidden = !(r.you.isHost && r.settings?.claudeAvailable && hasBots);
    const claudeOn = r.settings?.botBrain === 'claude';
    const btHtml = claudeOn ? `${SPARKLE}<span>Claude bots</span>` : '<span>Classic bots</span>';
    if (bt.dataset.html !== btHtml) { bt.dataset.html = btHtml; bt.innerHTML = btHtml; }
    bt.classList.toggle('on', claudeOn);
    bt.title = `Bots use ${claudeOn ? 'Claude AI' : 'classic rules'} \u2014 click to switch to ${claudeOn ? 'classic' : 'Claude AI'}`;
    const c = g.contract;
    const cc = q('.contract-chip');
    // short bidder label: "You", or the name without a "Bot " prefix (phones show ~6 characters)
    const shortName = (seat) => (seat === r.you.seat ? 'You' : seatName(r, seat).replace(/^Bot\s+/i, ''));
    const ccBy = (seat) => `<span class="cc-by" title="${esc(seatName(r, seat))}">${esc(shortName(seat))}</span>`;
    const ccHtml = c
      ? `<span class="cc-label">Contract</span><b class="t${teamOf(c.bidder)}-text">${c.bid}</b>${ccBy(c.bidder)}`
      : g.bidding?.currentBid != null
        ? `<span class="cc-label">High bid</span><b class="t${teamOf(g.bidding.bidder)}-text">${g.bidding.currentBid}</b>${ccBy(g.bidding.bidder)}`
        : '<span class="cc-label">Contract</span><span class="cc-by muted">bidding…</span>';
    if (cc.dataset.html !== ccHtml) { cc.dataset.html = ccHtml; cc.innerHTML = ccHtml; }
    const tb = q('.trump-badge');
    const tbHtml = trumpBadgeHTML(r);
    if (tb.dataset.html !== tbHtml) { tb.dataset.html = tbHtml; tb.innerHTML = tbHtml; tb.classList.toggle('revealed', !!g.trump?.revealed); }
    renderHandCard(r, g);
    const tp = g.teamPoints || [0, 0];
    q('.hand-pts').innerHTML = `<span class="cc-label">Points</span><b class="t0-text">${tp[0]}</b><span class="muted">–</span><b class="t1-text">${tp[1]}</b>`;
  }

  /** Score card under the HUD: card points vs the contract, updated after every trick. */
  function renderHandCard(r, g) {
    const el = q('.hand-card');
    const c = g.contract;
    const show = !!c && (g.phase === 'playing' || g.phase === 'handEnd');
    el.hidden = !show;
    root.classList.toggle('has-hand-card', show);
    if (!show) { el.dataset.html = ''; return; }
    const myTeam = r.you.seat != null ? teamOf(r.you.seat) : null;
    const name = (t) => (myTeam == null ? teamLabel(r, t) : t === myTeam ? 'Us' : 'Them');
    const bt = teamOf(c.bidder), dt = 1 - bt;
    const tp = g.teamPoints || [0, 0];
    const bidPts = tp[bt], defPts = tp[dt];
    const setAt = 29 - c.bid; // defenders need this many to beat the contract
    const done = (g.tricksWon || []).reduce((a, n) => a + n, 0);
    const made = bidPts >= c.bid, set = defPts >= setAt;
    const bidNeed = Math.max(0, c.bid - bidPts), defNeed = Math.max(0, setAt - defPts);
    const status = made ? '<span class="hc-flag ok">Contract made</span>'
      : set ? '<span class="hc-flag bad">Contract beaten</span>'
      : `<span class="hc-need">${name(bt)} need <b>${bidNeed}</b> · ${name(dt)} need <b>${defNeed}</b> to beat it</span><span class="hc-need hc-short" title="${name(bt)} need ${bidNeed} more · ${name(dt)} need ${defNeed} to beat it">need <b>${bidNeed}</b> · beat <b>${defNeed}</b></span>`;
    const html = `
      <span class="hc-side t${bt}"><span class="hc-name">${esc(name(bt))}</span><b>${bidPts}</b><span class="hc-of">/ ${c.bid}</span></span>
      <span class="hc-bar" role="img" aria-label="${esc(name(bt))} ${bidPts} of ${c.bid}; ${esc(name(dt))} ${defPts}">
        <i class="hc-fill t${bt}" style="width:${(bidPts / 28) * 100}%"></i>
        <i class="hc-fill hc-def t${dt}" style="width:${(defPts / 28) * 100}%"></i>
        <i class="hc-mark" style="left:${(c.bid / 28) * 100}%" title="Contract ${c.bid}"></i>
      </span>
      <span class="hc-side hc-right t${dt}"><b>${defPts}</b><span class="hc-name">${esc(name(dt))}</span></span>
      ${status}
      <span class="hc-trick">Trick ${Math.min(8, done + (g.phase === 'playing' ? 1 : 0))}/8</span>`;
    if (el.dataset.html === html) return;
    const changed = el.dataset.html && prev;
    el.dataset.html = html;
    el.innerHTML = html;
    el.classList.toggle('made', made);
    el.classList.toggle('beaten', set);
    if (changed) pulse(el, 'bump');
  }

  // -------------------------------------------------------------- plates
  function renderPlates(r, g, P) {
    for (let seat = 0; seat < 4; seat++) {
      const pos = P(seat);
      const seatEl = seatEls[pos];
      const plate = $('.plate', seatEl);
      const p = r.seats[seat];
      const name = p?.name || `Seat ${seat + 1}`;
      const isTurn = g.turn === seat;
      seatEl.dataset.seat = seat;
      seatEl.className = `seat pos-${POS[pos]} t${teamOf(seat)}${isTurn ? ' turn' : ''}`;
      const key = [seat, name, p?.isBot, p?.botControlled, p?.ai, p?.connected, g.dealer === seat, g.tricksWon?.[seat], r.you.seat === seat, g.contract?.bidder === seat, g.contract?.bidder === seat && g.contract.bid].join('|');
      if (plate.dataset.key !== key) {
        plate.dataset.key = key;
        plate.innerHTML = `
          <div class="avatar t${teamOf(seat)}${p?.ai === 'claude' ? ' claude' : ''}">${p?.isBot ? botIcon() : esc(initials(name))}<span class="ring" aria-hidden="true"></span></div>
          <div class="p-info">
            <div class="p-name">${esc(name)}${r.you.seat === seat ? ' <span class="you">(you)</span>' : ''}</div>
            <div class="p-sub">${r.you.seat === seat ? '' : `<span class="p-count" title="Cards in hand"><svg viewBox="0 0 16 16" class="ico" aria-hidden="true"><rect x="4" y="2" width="8" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>${g.handCounts?.[seat] ?? 0}</span>`}<span class="tricks" title="Tricks won"><svg viewBox="0 0 16 16" class="ico" aria-hidden="true"><rect x="3" y="2" width="8" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="6" y="4" width="7" height="10" rx="1.5" fill="currentColor" opacity=".5"/></svg>${g.tricksWon?.[seat] ?? 0}</span>
              ${botBadge(p)}${p && p.connected === false && !p.botControlled ? '<span class="tag tag-off">Offline</span>' : ''}</div>
          </div>
          ${g.dealer === seat ? '<span class="dealer-chip" title="Dealer">D</span>' : ''}
          ${g.contract?.bidder === seat ? `<span class="bidder-chip" title="Bidder — contract ${g.contract.bid}">Bid ${g.contract.bid}</span>` : ''}
          <span class="thinking" aria-hidden="true"><i></i><i></i><i></i></span>`;
        plate.setAttribute('aria-label', `${name}${g.dealer === seat ? ', dealer' : ''}${g.contract?.bidder === seat ? `, bidder (${g.contract.bid})` : ''},${g.tricksWon?.[seat] ?? 0} tricks${p?.connected === false ? ', disconnected' : ''}`);
      }
      plate.classList.toggle('offline', !!p && p.connected === false);
      const thinking = isTurn && !!p && (p.isBot || p.botControlled) && p.ai === 'claude' && ['bidding1', 'bidding2', 'chooseTrump', 'playing'].includes(g.phase);
      plate.classList.toggle('is-thinking', thinking);
      if (thinking) plate.setAttribute('aria-description', 'thinking'); else plate.removeAttribute('aria-description');
      // timer ring: follows the server's turn clock; decorative 30 s fill when the timer is off
      const ring = $('.ring', plate);
      const tc = r.turnClock && r.turnClock.seat === seat ? r.turnClock : null;
      const ringKey = isTurn ? `${g.seq}|${tc ? tc.total : 'free'}` : '';
      if (ring && ring.dataset.key !== ringKey) {
        ring.dataset.key = ringKey;
        ring.classList.remove('run');
        if (isTurn) {
          void ring.offsetWidth;
          const total = tc ? tc.total / 1000 : 30;
          ring.style.animationDuration = `${total}s`;
          ring.style.animationDelay = tc ? `${-((tc.total - tc.endsIn) / 1000).toFixed(2)}s` : '0s';
          ring.classList.toggle('timed', !!tc);
          ring.classList.add('run');
        }
      }
    }
  }

  // -------------------------------------------------------------- opponents' fans
  function renderFans(g, P, deal) {
    for (let seat = 0; seat < 4; seat++) {
      const pos = P(seat);
      if (pos === 0) continue;
      const fan = $('.fan', seatEls[pos]);
      const n = g.handCounts?.[seat] ?? 0;
      let backs = [...fan.querySelectorAll('.card')];
      while (backs.length > n) backs.pop().remove();
      const had = backs.length;
      while (backs.length < n) { const b = createBack(); fan.append(b); backs.push(b); }
      backs.forEach((b, i) => {
        b.style.setProperty('--i', i);
        b.style.setProperty('--n', n);
        if (deal && i >= had) {
          b.classList.add('deal-in');
          b.style.setProperty('--dd', `${dealDelay(deal, seat, i - had)}ms`);
          b.addEventListener('animationend', () => b.classList.remove('deal-in'), { once: true });
        }
      });
      const cnt = $('.p-count', $('.plate', seatEls[pos]));
      if (cnt) cnt.lastChild.textContent = n;
    }
  }

  // -------------------------------------------------------------- my hand
  function renderHand(r, g, deal) {
    const mySeat = r.you.seat;
    const cards = mySeat == null ? [] : g.hand || [];
    const myTurn = mySeat != null && g.turn === mySeat;
    const acts = myTurn ? g.legal?.actions || [] : [];
    const canPlay = acts.includes('play');
    const playable = new Set(canPlay ? g.legal.playable || [] : []);
    const choosable = new Set(acts.includes('chooseTrump') ? g.legal.trumpChoices || [] : []);
    const existing = new Map([...handEl.children].map((c) => [c.dataset.card, c]));
    const wanted = new Set(cards);
    for (const [c, el] of existing) if (!wanted.has(c)) { el.remove(); existing.delete(c); }
    let newIdx = 0;
    cards.forEach((c, i) => {
      let el = existing.get(c);
      if (!el) {
        el = createCard(c, { button: true });
        if (deal && mySeat != null) {
          el.classList.add('deal-in');
          el.style.setProperty('--dd', `${dealDelay(deal, mySeat, newIdx++)}ms`);
          el.addEventListener('animationend', () => el.classList.remove('deal-in'), { once: true });
        }
      }
      if (handEl.children[i] !== el) handEl.insertBefore(el, handEl.children[i] || null);
      el.style.setProperty('--i', i);
      el.style.setProperty('--n', cards.length);
      const isP = playable.has(c);
      const isC = choosable.has(c);
      el.classList.toggle('playable', isP);
      el.classList.toggle('choosable', isC);
      el.classList.toggle('illegal', (canPlay && !isP) || (choosable.size > 0 && !isC));
      el.disabled = !(isP || isC);
      el.tabIndex = isP || isC ? 0 : -1;
    });
    handEl.style.setProperty('--n', cards.length);
    root.style.setProperty('--hn', cards.length); // desktop: my plate hugs the hand's left edge
    handEl.classList.toggle('my-turn', canPlay);
    if (selected && !(selected.isConnected && (selected.classList.contains('playable') || selected.classList.contains('choosable')))) {
      selected.classList.remove('selected');
      selected = null;
    }
  }

  function renderConcealed(r, g) {
    const t = g.trump || {};
    const mine = r.you.seat != null && g.contract?.bidder === r.you.seat && t.concealed && t.card;
    concealedEl.hidden = !mine;
    q('.hand-row').classList.toggle('has-concealed', !!mine);
    root.style.setProperty('--hc', mine ? 1 : 0); // concealed card beside the hand shifts it left (desktop plate offset)
    if (!mine) { concealedEl.replaceChildren(); return; }
    const can = g.turn === r.you.seat && (g.legal?.actions || []).includes('playTrumpCard');
    let el = concealedEl.querySelector('.card');
    if (!el || el.dataset.card !== t.card) {
      el = createCard(t.card, { button: true });
      concealedEl.replaceChildren(el, h('span', { class: 'concealed-label' }, 'Trump'));
    }
    el.classList.toggle('playable', can);
    el.disabled = !can;
    if (!can && selected === el) { el.classList.remove('selected'); selected = null; }
    el.setAttribute('aria-label', `Your concealed trump card, ${SUIT_NAMES[t.suit] || ''}${can ? ' — click to play it' : ''}`);
  }

  function renderTrumpSlots(r, g, P) {
    const t = g.trump || {};
    const bidder = g.contract?.bidder;
    for (let seat = 0; seat < 4; seat++) {
      const slot = $('.trump-slot', seatEls[P(seat)]);
      const show = t.concealed && bidder === seat && seat !== r.you.seat;
      if (show && !slot.childElementCount) {
        slot.append(createBack('mini'), h('span', { class: 'ts-label' }, 'Trump'));
        slot.title = 'Concealed trump card';
      } else if (!show && slot.childElementCount) slot.replaceChildren();
    }
  }

  function renderBubbles(r, g, P) {
    const bidding = g.phase === 'bidding1' || g.phase === 'bidding2';
    const round = g.bidding?.round;
    const last = {};
    if (bidding) for (const e of g.bidding?.history || []) if (e.round === round) last[e.seat] = e.bid;
    for (let seat = 0; seat < 4; seat++) {
      const b = $('.bubble', seatEls[P(seat)]);
      const has = seat in last;
      const txt = has ? (last[seat] == null ? 'Pass' : String(last[seat])) : '';
      if (b.textContent !== txt) {
        b.textContent = txt;
        b.className = `bubble${has ? ' show' : ''}${has && last[seat] == null ? ' pass' : ''}`;
        if (has && prev) pulse(b, 'pop');
      }
    }
  }

  function renderActionBar(r, g) {
    const me = r.you.seat;
    const myTurn = me != null && g.turn === me;
    const acts = myTurn ? g.legal?.actions || [] : [];
    const hb = q('[data-act="hint"]');
    const decide = ['bid', 'pass', 'chooseTrump', 'play', 'callTrump', 'playTrumpCard', 'revealTrump'].some((a) => acts.includes(a));
    hb.hidden = !(r.settings?.hints && decide);
    if (!hb.classList.contains('busy')) hb.disabled = hintSeq === g.seq;
    q('.react-wrap').hidden = !['playing', 'bidding1', 'bidding2', 'chooseTrump', 'handEnd', 'matchEnd'].includes(g.phase);
    q('[data-act="callTrump"]').hidden = !acts.includes('callTrump');
    q('[data-act="playTrumpCard"]').hidden = !acts.includes('playTrumpCard');
    q('[data-act="revealTrump"]').hidden = !acts.includes('revealTrump');
    let s = '';
    const nm = (seat) => `<span class="t${teamOf(seat)}-text">${esc(seatName(r, seat))}</span>`;
    if (g.phase === 'playing') {
      const lead = g.trick?.cards?.length && g.trick.index !== g.lastTrick?.index ? g.trick.cards[0] : null;
      const leadSuit = lead?.card ? suitOf(lead.card) : null;
      if (myTurn) {
        if (acts.includes('playTrumpCard') && !(g.legal.playable || []).length) s = '<b>Your turn</b> — you must play your concealed trump';
        else if (g.mustPlayTrump === r.you.seat && g.trump?.suit) s = `<b>Your turn</b> — trump is ${suitIcon(g.trump.suit)}: play a trump`;
        else if (acts.includes('revealTrump')) s = `<b>Your turn</b> — ${leadSuit && leadSuit !== g.trump?.suit ? `no ${SUIT_NAMES[leadSuit].toLowerCase()}: discard, or ` : ''}reveal trump and choose one`;
        else if (!lead) s = '<b>Your lead</b> — play any highlighted card';
        else if (acts.includes('callTrump')) s = `<b>Your turn</b> — no ${leadSuit ? SUIT_NAMES[leadSuit].toLowerCase() : 'cards of the led suit'}: discard or call trump`;
        else s = `<b>Your turn</b>${leadSuit ? ` — ${suitIcon(leadSuit)} led` : ''}`;
      } else if (g.turn != null) s = `Waiting for ${nm(g.turn)}<span class="dots"></span>`;
    } else if (g.phase === 'bidding1' || g.phase === 'bidding2') {
      s = myTurn ? '<b>Your bid</b>' : g.turn != null ? `${nm(g.turn)} is bidding<span class="dots"></span>` : '';
    } else if (g.phase === 'chooseTrump') {
      s = myTurn ? '<b>Pick your trump card</b>' : `${nm(g.turn)} is choosing trump<span class="dots"></span>`;
    } else if (g.phase === 'handEnd') s = 'Hand complete';
    else if (g.phase === 'matchEnd') s = 'Match over';
    if (myTurn && selected?.isConnected) {
      const sc = selected.closest('.concealed-slot') ? 'your hidden trump' : esc(cardName(selected.dataset.card));
      s = `<b>Tap again to play</b> — ${sc}`;
    }
    const st = q('.status-text');
    if (st.dataset.html !== s) { st.dataset.html = s; st.innerHTML = s; }
    const myPlay = myTurn && ['playing', 'chooseTrump'].includes(g.phase) && acts.length > 0;
    q('.my-area').classList.toggle('my-turn', myPlay);
    st.classList.toggle('turn-pill', myTurn && acts.length > 0);
    // a drawer covering the table: offer a quick way back when it's my move
    for (const b of root.querySelectorAll('.drawer-turn')) b.hidden = !(myTurn && acts.length > 0);
  }

  // -------------------------------------------------------------- trick area
  function makeTrickCard(seat, card, pos) {
    const wrap = h('div', { class: `trick-card pos-${POS[pos]}`, dataset: { seat } });
    const tilt = (hash(`${seat}${card || ''}${room.game.handNumber}`) - 0.5) * 14;
    wrap.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`);
    const fly = h('div', { class: 'fly' });
    const c = createBack();
    setCard(c, card);
    fly.append(c);
    wrap.append(fly);
    return wrap;
  }

  function sourceRect(seat, card, pos, snap) {
    if (!snap) return null;
    if (seat === room.you.seat) return snap.handRects.get(card) || snap.concealedRect || snap.handRect;
    if (prev?.trump?.concealed && !room.game.trump?.concealed && prev.contract?.bidder === seat && snap.trumpRects[pos]) return snap.trumpRects[pos];
    return snap.fanRects[pos] || snap.plateRects[pos];
  }

  function placeIn(seat, pos, wrap) {
    anchors[pos].append(wrap);
  }

  function renderTrick(r, g, P, snap, first) {
    const lt = g.lastTrick;
    const inPlay = ['playing', 'handEnd', 'matchEnd'].includes(g.phase);
    const newTrickDone = !first && inPlay && lt && (!prev.lastTrick || prev.lastTrick.index !== lt.index || (prev.handNumber !== g.handNumber && prev.phase !== 'handEnd'));
    if (!first && prev.handNumber !== g.handNumber && !newTrickDone) clearAll();

    if (newTrickDone) {
      finishHold(true);
      const els = [];
      for (const { seat, card } of lt.cards) {
        const pos = P(seat);
        let wrap = live.get(seat);
        if (wrap) {
          const c = $('.card', wrap);
          const wasBack = c.classList.contains('back');
          setCard(c, card);
          if (wasBack) pulse(c, 'flip');
        } else {
          wrap = makeTrickCard(seat, card, pos);
          placeIn(seat, pos, wrap);
          flyFrom($('.fly', wrap), sourceRect(seat, card, pos, snap));
        }
        wrap.classList.remove('leading');
        wrap.classList.toggle('winner', seat === lt.winner);
        els.push(wrap);
      }
      live.clear();
      for (const a of anchors) for (const w of [...a.children]) if (!els.includes(w)) w.remove();
      celebrateTrick(lt, els);
      hold = { els, winner: lt.winner, timer: setTimeout(() => sweep(), HOLD_MS + (reducedMotion() ? 0 : 250)) };
    }

    // live (in-progress) trick
    const cards = g.phase === 'playing' && g.trick && !(lt && g.trick.index === lt.index) ? g.trick.cards || [] : [];
    if (cards.length && hold) finishHold(false);
    const present = new Set();
    for (const { seat, card, faceDown } of cards) {
      present.add(seat);
      const pos = P(seat);
      const shown = faceDown && seat !== r.you.seat ? null : card;
      let wrap = live.get(seat);
      if (!wrap) {
        wrap = makeTrickCard(seat, shown, pos);
        if (faceDown) wrap.classList.add('discard');
        live.set(seat, wrap);
        placeIn(seat, pos, wrap);
        if (!first) flyFrom($('.fly', wrap), sourceRect(seat, card, pos, snap));
      } else {
        const c = $('.card', wrap);
        const wasBack = c.classList.contains('back');
        setCard(c, shown);
        if (wasBack && shown) pulse(c, 'flip');
        wrap.classList.toggle('discard', !!faceDown);
      }
      if (faceDown && seat === r.you.seat) wrap.classList.add('my-discard');
    }
    for (const [seat, wrap] of live) if (!present.has(seat)) { wrap.remove(); live.delete(seat); }
    // live "currently winning" marker (only meaningful once 2+ cards are down)
    const lead = cards.length > 1 ? winningSeat(g, cards) : null;
    for (const [seat, wrap] of live) wrap.classList.toggle('leading', seat === lead);
  }

  /** Client-side mirror of engine trickWinnerIndex for the trick in progress (view lacks afterReveal/discard flags). */
  function winningSeat(g, cards) {
    const RANKS = 'J9ATKQ87';
    const ri = (c) => RANKS.indexOf(rankOf(c));
    const known = cards.filter((e) => e.card);
    if (!known.length || !cards[0].card) return null;
    const led = suitOf(cards[0].card);
    const t = g.trump || {};
    let best = null;
    if (t.revealed && t.suit) {
      // a trump-suit card has trump power if it was a non-following discard, or was played after the reveal
      // (reveal happens on the revealer's own turn, so it precedes their card in this trick)
      let revealAt = -1;
      if (t.revealedInTrick != null && t.revealedInTrick < g.trick.index) revealAt = 0;
      else if (t.revealedInTrick === g.trick.index) {
        const k = cards.findIndex((e) => e.seat === t.revealedBy);
        revealAt = k < 0 ? cards.length : k;
      } else if (t.revealedInTrick == null) revealAt = 0;
      cards.forEach((e, i) => {
        if (!e.card || suitOf(e.card) !== t.suit) return;
        const power = suitOf(e.card) !== led || (revealAt >= 0 && i >= revealAt);
        if (power && (!best || ri(e.card) < ri(best.card))) best = e;
      });
      if (best) return best.seat;
    }
    for (const e of known) if (suitOf(e.card) === led && (!best || ri(e.card) < ri(best.card))) best = e;
    return best?.seat ?? null;
  }

  /** Trick completed: glow the winning card, float "+N" from it and show a small pill by the winner's plate. */
  function celebrateTrick(lt, els) {
    const wrap = els.find((w) => Number(w.dataset.seat) === lt.winner);
    if (lt.points && wrap) {
      const f = h('span', { class: 'pts-float', 'aria-hidden': 'true' }, `+${lt.points}`);
      wrap.append(f);
      setTimeout(() => f.remove(), 1400);
    }
    const seatEl = seatEls[posOf(lt.winner, room.you.seat ?? 0)];
    $('.trick-pill', seatEl)?.remove();
    const who = lt.winner === room.you.seat ? 'You take it' : 'Takes the trick';
    const pill = h('div', { class: 'trick-pill', role: 'status', html: `${who}${lt.points ? ` <b>+${lt.points}</b>` : ''}` });
    seatEl.append(pill);
    setTimeout(() => pill.remove(), 1900);
  }

  function sweep() {
    if (!hold) return;
    const hd = hold;
    clearTimeout(hd.timer);
    const winnerPos = posOf(hd.winner, room.you.seat ?? 0);
    const target = $('.plate', seatEls[winnerPos]).getBoundingClientRect();
    const done = Promise.all(hd.els.map((w, i) => flyTo($('.fly', w), target, { duration: SWEEP_MS, delay: i * 30 })));
    done.then(() => {
      hd.els.forEach((w) => w.remove());
      if (hold === hd) { hold = null; flushIdle(); }
    });
  }

  function finishHold(immediate) {
    if (!hold) return;
    const hd = hold;
    hold = null;
    clearTimeout(hd.timer);
    if (immediate || reducedMotion()) hd.els.forEach((w) => w.remove());
    else {
      const winnerPos = posOf(hd.winner, room.you.seat ?? 0);
      const target = $('.plate', seatEls[winnerPos]).getBoundingClientRect();
      hd.els.forEach((w) => flyTo($('.fly', w), target, { duration: 260 }).then(() => w.remove()));
    }
    flushIdle();
  }

  function clearAll() {
    finishHold(true);
    for (const a of anchors) a.replaceChildren();
    live.clear();
  }

  function flushIdle() {
    while (idleWaiters.length && !hold) idleWaiters.shift()();
  }
  /** Run fn once no completed trick is on display (e.g. before showing the hand-end modal). */
  function whenIdle(fn) {
    if (!hold) fn(); else idleWaiters.push(fn);
  }

  // -------------------------------------------------------------- dealing
  function detectDeal(p, g) {
    if (!['bidding1', 'bidding2'].includes(g.phase)) return null;
    const pc = p.handCounts || [0, 0, 0, 0], gc = g.handCounts || [0, 0, 0, 0];
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const newHand = p.handNumber !== g.handNumber;
    const grew = sum(gc) - sum(pc) >= 4;
    const redeal = !newHand && isRedeal(p, g);
    if (!newHand && !grew && !redeal) return null;
    const fresh = newHand || redeal;
    const counts = [0, 1, 2, 3].map((s) => (fresh ? gc[s] : Math.max(0, gc[s] - pc[s])));
    const order = [0, 1, 2, 3].map((i) => (g.dealer + 1 + i) % 4);
    if (fresh) {
      // everything previously displayed is replaced: clear fans and hand
      for (const se of seatEls) $('.fan', se)?.querySelectorAll('.card').forEach((c) => c.remove());
      handEl.replaceChildren();
      clearAll();
    }
    return { counts, order, fresh };
  }

  function isRedeal(p, g) {
    if (g.phase !== 'bidding1' || p.seq === g.seq || p.handNumber !== g.handNumber) return false;
    if ((g.bidding?.history || []).length) return false;
    if (p.phase !== 'bidding1') return true; // e.g. four-jacks redeal after deal 2
    if ((p.bidding?.history || []).length) return true;
    if (p.hand?.length && g.hand?.length && p.hand.join() !== g.hand.join()) return true;
    const newLog = (g.log || []).slice((p.log || []).length > 25 ? -2 : (p.log || []).length).join(' ');
    return /re-?deal|reshuffl/i.test(newLog);
  }

  function dealDelay(deal, seat, k) {
    if (reducedMotion()) return 0;
    const idx = deal.order.indexOf(seat);
    // flights interleave: card k of each seat in order
    let n = 0;
    for (let j = 0; j < k; j++) for (const s of deal.order) if (j < deal.counts[s]) n++;
    for (let s = 0; s < idx; s++) if (k < deal.counts[deal.order[s]]) n++;
    return n * DEAL_STAGGER + DEAL_DUR * 0.8;
  }

  function dealTotal(deal) {
    return deal.counts.reduce((a, b) => a + b, 0) * DEAL_STAGGER + DEAL_DUR;
  }
  /** Keep my bidding panel out of the way until the deal animation has landed. */
  let dealUntil = 0, dealTimer = 0;
  function deferPanelForDeal() {
    const left = dealUntil - performance.now();
    clearTimeout(dealTimer);
    if (left <= 0 || bidPanel.hidden) { delete bidPanel.dataset.deal; return; }
    bidPanel.dataset.deal = '1';
    dealTimer = setTimeout(() => {
      delete bidPanel.dataset.deal;
      if (bidPanelOpen()) { clearTimeout(announceTimer); q('.announce').innerHTML = ''; }
    }, left);
  }
  // phones: the bidding bottom sheet's height positions the status/hint row just above it
  new ResizeObserver(() => root.style.setProperty('--sheet-h', `${bidPanel.offsetHeight}px`)).observe(bidPanel);

  function runDeal(g, P, deal, snap) {
    const from = $('.plate', seatEls[P(g.dealer)]).getBoundingClientRect();
    const targets = deal.order.map((s) => {
      const pos = P(s);
      const rect = pos === 0 ? (room.you.seat != null ? handEl.getBoundingClientRect() : $('.plate', seatEls[0]).getBoundingClientRect()) : $('.fan', seatEls[pos]).getBoundingClientRect();
      return { rect, count: deal.counts[s] };
    });
    dealFlights(animLayer, from, targets, { stagger: DEAL_STAGGER, duration: DEAL_DUR });
  }

  // -------------------------------------------------------------- announcements
  const bidPanelOpen = () => !bidPanel.hidden && bidPanel.classList.contains('my-turn') && !bidPanel.dataset.deal;
  function announce(html, kind = '') {
    if (bidPanelOpen()) return; // never cover my own bidding panel; the panel already shows round/min info
    const a = q('.announce');
    const dur = kind === 'trump' ? 2800 : 2200;
    a.innerHTML = `<div class="ann ${kind}" style="animation-duration:${dur}ms">${html}</div>`;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => (a.innerHTML = ''), dur);
  }

  function announcements(r, p, g) {
    const nm = (seat) => `<span class="t${teamOf(seat)}-text">${esc(seatName(r, seat))}</span>`;
    if (p.handNumber !== g.handNumber) return announce(`Hand ${g.handNumber} · ${nm(g.dealer)} deals`);
    if (!p.trump?.revealed && g.trump?.revealed && g.trump.suit) {
      pulse(q('.trump-badge'), 'trump-pop');
      return announce(`<span class="ann-suit">${suitIcon(g.trump.suit, 'xl')}</span><span>Trump revealed: <b>${SUIT_NAMES[g.trump.suit]}</b>${g.trump.revealedBy != null ? `<small>called by ${nm(g.trump.revealedBy)}</small>` : ''}</span>`, 'trump');
    }
    if (p.phase !== 'bidding2' && g.phase === 'bidding2') return announce('<b>Round 2</b><small>4 more cards · minimum bid 24</small>', 'round');
    if (p.phase !== 'playing' && g.phase === 'playing') return announce(`<b>Contract ${g.contract?.bid}</b><small>${nm(g.contract?.bidder)} bid \u00b7 ${nm(g.firstSeat)} leads</small>`);
    const lt = g.lastTrick;
    if (lt && (p.lastTrick?.index !== lt.index || !p.lastTrick)) return; // shown as a pill by the winner's plate (celebrateTrick)
    if (isRedeal(p, g)) announce(p.phase === 'bidding1' ? '<b>Redeal</b><small>same dealer reshuffles</small>' : '<b>Redeal</b><small>a player held all four Jacks</small>');
  }

  // -------------------------------------------------------------- log
  function renderLog(r, g) {
    const list = q('.log-list');
    const key = (g.log || []).join('\n') + JSON.stringify(r.seats.map((s) => s?.name));
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.innerHTML = (g.log || []).map((l) => `<li>${mapSeatNames(esc(l), r)}</li>`).join('') || '<li class="muted">No events yet</li>';
    list.scrollTop = list.scrollHeight;
  }

  /** Short speech bubble near a player's plate (bot table talk). */
  const sayTimers = new Map();
  function say(seat, text) {
    if (!room?.game || seat == null || !text) return;
    const el = $('.say', seatEls[posOf(seat, room.you.seat ?? 0)]);
    el.textContent = text.length > 90 ? `${text.slice(0, 88)}\u2026` : text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(sayTimers.get(seat));
    sayTimers.set(seat, setTimeout(() => el.classList.remove('show'), 3200));
  }

  function reset() {
    prev = null;
    clearAll();
    handEl.replaceChildren();
    setDrawer(logDrawer, false);
    setDrawer(chatDrawer, false);
  }

  // -------------------------------------------------------------- my turn countdown
  let clockTimer = null;
  function renderClock(r) {
    clearInterval(clockTimer);
    const el = q('.turn-clock');
    const tc = r?.turnClock;
    const mine = tc && r.you.seat != null && tc.seat === r.you.seat;
    el.hidden = !mine;
    if (!mine) return;
    const end = Date.now() + tc.endsIn;
    const tick = () => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      el.textContent = `${s}s`;
      el.classList.toggle('low', s <= 10);
      if (s <= 0) clearInterval(clockTimer);
    };
    tick();
    clockTimer = setInterval(tick, 250);
  }

  return {
    render: (r) => { render(r); renderClock(r); },
    whenIdle, setUnread, reset, say, react, chatVisible: () => !chatDrawer.hidden,
  };
}
