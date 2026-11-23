// Game table: HUD, seats/plates, hands, trick area, action bar, drawers, and state-diff animations.
import { h, $, esc, POS, posOf, seatName, teamOf, initials, mapSeatNames, teamLabel, hash, suitOf, SUIT_NAMES, reducedMotion, botBadge, SPARKLE } from './util.js';
import { createCard, createBack, setCard, suitIcon } from './cards.js';
import { flyFrom, flyTo, dealFlights, pulse } from './anim.js';
import { renderBidding, trumpBadgeHTML } from './bidding.js';
import { mountChat, markRead } from './chat.js';
import { botIcon } from './lobby.js';

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
      <div class="hud-scores" aria-label="Match score">
        ${[0, 1].map((t) => `<div class="score t${t}"><div class="s-top"><span class="team-dot t${t}"></span><span class="s-name"></span></div><div class="s-row"><span class="s-val">0</span><span class="s-target"></span></div><div class="s-bar" aria-hidden="true"><i></i></div></div>`).join('')}
      </div>
      <div class="hud-contract">
        <div class="contract-chip" aria-live="polite"></div>
        <div class="trump-badge" aria-live="polite"></div>
        <div class="hand-pts" title="Card points captured this hand"></div>
      </div>
      <div class="hud-right">
        <button class="btn btn-ghost btn-xs brain-toggle" type="button" data-act="brain" hidden></button>
        <button class="icon-btn" type="button" data-act="log" aria-label="Event log" aria-expanded="false"><svg viewBox="0 0 24 24" class="ico"><path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg></button>
        <button class="icon-btn" type="button" data-act="chat" aria-label="Chat" aria-expanded="false"><svg viewBox="0 0 24 24" class="ico"><path d="M4 5h16v11H9l-5 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg><span class="badge" hidden></span></button>
        <button class="icon-btn" type="button" data-act="rules" aria-label="How to play"><svg viewBox="0 0 24 24" class="ico"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg></button>
        <button class="icon-btn" type="button" data-act="leave" aria-label="Leave room"><svg viewBox="0 0 24 24" class="ico"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button>
      </div>
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
          <div class="action-btns">
            <button class="btn btn-gold btn-sm" type="button" data-act="callTrump" hidden>Call trump</button>
            <button class="btn btn-gold btn-sm" type="button" data-act="playTrumpCard" hidden>Play concealed trump</button>
          </div>
        </div>
        <div class="hand-row">
          <div class="hand" role="group" aria-label="Your hand"></div>
          <div class="concealed-slot" hidden></div>
        </div>
        <div class="spectator-note" hidden><span class="tag tag-spec">Spectating</span> You are watching from seat 1's side.</div>
      </div>
    </div>
    <aside class="drawer log-drawer glass" aria-label="Event log" hidden>
      <div class="drawer-head"><h3>Event log</h3><button class="icon-btn" type="button" data-act="log" aria-label="Close log">×</button></div>
      <ol class="log-list"></ol>
    </aside>
    <aside class="drawer chat-drawer glass" aria-label="Chat" hidden>
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
    if (act === 'log') toggleDrawer(logDrawer, b);
    else if (act === 'chat') toggleDrawer(chatDrawer, b);
    else if (act === 'rules') ctx.rules();
    else if (act === 'leave') ctx.leave(true);
    else if (act === 'brain') ctx.call('setSettings', { botBrain: room.settings.botBrain === 'claude' ? 'classic' : 'claude' });
    else if (act === 'callTrump') doAct({ type: 'callTrump' });
    else if (act === 'playTrumpCard') doAct({ type: 'playTrumpCard' });
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!chatDrawer.hidden) toggleDrawer(chatDrawer);
      else if (!logDrawer.hidden) toggleDrawer(logDrawer);
    }
  });
  handEl.addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (!c || !room?.game) return;
    const card = c.dataset.card;
    if (c.classList.contains('playable')) doAct({ type: 'play', card });
    else if (c.classList.contains('choosable')) doAct({ type: 'chooseTrump', card });
  });
  concealedEl.addEventListener('click', (e) => {
    if (e.target.closest('.card.playable')) doAct({ type: 'playTrumpCard' });
  });

  function toggleDrawer(d) {
    const other = d === logDrawer ? chatDrawer : logDrawer;
    const opening = d.hidden;
    if (opening && !other.hidden) setDrawer(other, false);
    setDrawer(d, opening);
  }
  function setDrawer(d, show) {
    d.hidden = !show;
    const which = d === logDrawer ? 'log' : 'chat';
    root.querySelectorAll(`.hud [data-act="${which}"]`).forEach((b) => b.setAttribute('aria-expanded', String(show)));
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
    renderActionBar(r, g);
    renderBidding(bidPanel, r, ctx);
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
    const myTeam = r.you.seat != null ? teamOf(r.you.seat) : null;
    for (const t of [0, 1]) {
      const el = q(`.score.t${t}`);
      $('.s-name', el).textContent = myTeam == null ? teamLabel(r, t) : t === myTeam ? 'Us' : 'Them';
      el.title = teamLabel(r, t);
      const v = $('.s-val', el);
      if (v.textContent !== String(g.scores[t])) { v.textContent = g.scores[t]; if (prev) pulse(v, 'bump'); }
      $('.s-target', el).textContent = `/ ${g.targetScore}`;
      const pct = Math.max(-1, Math.min(1, g.scores[t] / g.targetScore));
      const bar = $('.s-bar i', el);
      bar.style.width = `${Math.abs(pct) * 50}%`;
      bar.style.left = pct >= 0 ? '50%' : `${50 - Math.abs(pct) * 50}%`;
      bar.classList.toggle('neg', pct < 0);
      el.classList.toggle('mine', t === myTeam);
    }
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
    const ccHtml = c
      ? `<span class="cc-label">Contract</span><b class="t${teamOf(c.bidder)}-text">${c.bid}</b><span class="cc-by">${esc(seatName(r, c.bidder))}</span>`
      : g.bidding?.currentBid != null
        ? `<span class="cc-label">High bid</span><b class="t${teamOf(g.bidding.bidder)}-text">${g.bidding.currentBid}</b><span class="cc-by">${esc(seatName(r, g.bidding.bidder))}</span>`
        : '<span class="cc-label">Contract</span><span class="cc-by muted">bidding…</span>';
    if (cc.dataset.html !== ccHtml) { cc.dataset.html = ccHtml; cc.innerHTML = ccHtml; }
    const tb = q('.trump-badge');
    const tbHtml = trumpBadgeHTML(r);
    if (tb.dataset.html !== tbHtml) { tb.dataset.html = tbHtml; tb.innerHTML = tbHtml; tb.classList.toggle('revealed', !!g.trump?.revealed); }
    const tp = g.teamPoints || [0, 0];
    q('.hand-pts').innerHTML = `<span class="cc-label">Points</span><b class="t0-text">${tp[0]}</b><span class="muted">–</span><b class="t1-text">${tp[1]}</b>`;
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
      const key = [seat, name, p?.isBot, p?.botControlled, p?.ai, p?.connected, g.dealer === seat, g.tricksWon?.[seat], r.you.seat === seat, g.contract?.bidder === seat].join('|');
      if (plate.dataset.key !== key) {
        plate.dataset.key = key;
        plate.innerHTML = `
          <div class="avatar t${teamOf(seat)}${p?.ai === 'claude' ? ' claude' : ''}">${p?.isBot ? botIcon() : esc(initials(name))}<span class="ring" aria-hidden="true"></span></div>
          <div class="p-info">
            <div class="p-name">${esc(name)}${r.you.seat === seat ? ' <span class="you">(you)</span>' : ''}</div>
            <div class="p-sub"><span class="tricks" title="Tricks won"><svg viewBox="0 0 16 16" class="ico" aria-hidden="true"><rect x="3" y="2" width="8" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="6" y="4" width="7" height="10" rx="1.5" fill="currentColor" opacity=".5"/></svg>${g.tricksWon?.[seat] ?? 0}</span>
              ${botBadge(p)}${p && p.connected === false && !p.botControlled ? '<span class="tag tag-off">Offline</span>' : ''}${g.contract?.bidder === seat ? '<span class="tag tag-bidder">Bidder</span>' : ''}</div>
          </div>
          ${g.dealer === seat ? '<span class="dealer-chip" title="Dealer">D</span>' : ''}
          <span class="thinking" aria-hidden="true"><i></i><i></i><i></i></span>`;
        plate.setAttribute('aria-label', `${name}${g.dealer === seat ? ', dealer' : ''}, ${g.tricksWon?.[seat] ?? 0} tricks${p?.connected === false ? ', disconnected' : ''}`);
      }
      plate.classList.toggle('offline', !!p && p.connected === false);
      const thinking = isTurn && !!p && (p.isBot || p.botControlled) && p.ai === 'claude' && ['bidding1', 'bidding2', 'chooseTrump', 'playing'].includes(g.phase);
      plate.classList.toggle('is-thinking', thinking);
      if (thinking) plate.setAttribute('aria-description', 'thinking'); else plate.removeAttribute('aria-description');
      // restart the timer ring whenever the turn moves to this seat
      if (isTurn && (prev?.turn !== seat || prev?.phase !== g.phase)) {
        const ring = $('.ring', plate);
        if (ring) { ring.classList.remove('run'); void ring.offsetWidth; ring.classList.add('run'); }
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
      let cnt = $('.fan-count', fan);
      if (!cnt) { cnt = h('span', { class: 'fan-count' }); fan.append(cnt); }
      cnt.textContent = n;
      cnt.hidden = !n;
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
    handEl.classList.toggle('my-turn', canPlay);
  }

  function renderConcealed(r, g) {
    const t = g.trump || {};
    const mine = r.you.seat != null && g.contract?.bidder === r.you.seat && t.concealed && t.card;
    concealedEl.hidden = !mine;
    if (!mine) { concealedEl.replaceChildren(); return; }
    const can = g.turn === r.you.seat && (g.legal?.actions || []).includes('playTrumpCard');
    let el = concealedEl.querySelector('.card');
    if (!el || el.dataset.card !== t.card) {
      el = createCard(t.card, { button: true });
      concealedEl.replaceChildren(el, h('span', { class: 'concealed-label' }, 'Trump'));
    }
    el.classList.toggle('playable', can);
    el.disabled = !can;
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
    q('[data-act="callTrump"]').hidden = !acts.includes('callTrump');
    q('[data-act="playTrumpCard"]').hidden = !acts.includes('playTrumpCard');
    let s = '';
    const nm = (seat) => `<span class="t${teamOf(seat)}-text">${esc(seatName(r, seat))}</span>`;
    if (g.phase === 'playing') {
      const lead = g.trick?.cards?.length && g.trick.index !== g.lastTrick?.index ? g.trick.cards[0] : null;
      const leadSuit = lead?.card ? suitOf(lead.card) : null;
      if (myTurn) {
        if (acts.includes('playTrumpCard') && !(g.legal.playable || []).length) s = '<b>Your turn</b> — you must play your concealed trump';
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
    const st = q('.status-text');
    if (st.dataset.html !== s) { st.dataset.html = s; st.innerHTML = s; }
    q('.my-area').classList.toggle('my-turn', myTurn && g.phase === 'playing');
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
        wrap.classList.toggle('winner', seat === lt.winner);
        els.push(wrap);
      }
      live.clear();
      for (const a of anchors) for (const w of [...a.children]) if (!els.includes(w)) w.remove();
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
  function announce(html, kind = '') {
    const a = q('.announce');
    a.innerHTML = `<div class="ann ${kind}">${html}</div>`;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => (a.innerHTML = ''), 2200);
  }

  function announcements(r, p, g) {
    const nm = (seat) => `<span class="t${teamOf(seat)}-text">${esc(seatName(r, seat))}</span>`;
    if (p.handNumber !== g.handNumber) return announce(`Hand ${g.handNumber} · ${nm(g.dealer)} deals`);
    if (!p.trump?.revealed && g.trump?.revealed && g.trump.suit) {
      pulse(q('.trump-badge'), 'glow');
      return announce(`${suitIcon(g.trump.suit, 'xl')}<span>Trump revealed: <b>${SUIT_NAMES[g.trump.suit]}</b>${g.trump.revealedBy != null ? `<small>called by ${nm(g.trump.revealedBy)}</small>` : ''}</span>`, 'trump');
    }
    if (p.phase !== 'bidding2' && g.phase === 'bidding2') return announce('<b>Round 2</b><small>4 more cards · minimum bid 24</small>', 'round');
    if (p.phase !== 'playing' && g.phase === 'playing') return announce(`<b>Contract ${g.contract?.bid}</b><small>${nm(g.contract?.bidder)} bid \u00b7 ${nm(g.firstSeat)} leads</small>`);
    const lt = g.lastTrick;
    if (lt && (p.lastTrick?.index !== lt.index || !p.lastTrick)) {
      setTimeout(() => announce(`${nm(lt.winner)} takes the trick${lt.points ? ` <span class="gold">+${lt.points}</span>` : ''}`, 'trick'), reducedMotion() ? 0 : 350);
      return;
    }
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

  return { render, whenIdle, setUnread, reset, say, chatVisible: () => !chatDrawer.hidden };
}
