// Rummy game table (13-card Indian Rummy, Pool 101/201): HUD, opponents around the felt, closed deck +
// open pile + wild joker, my grouped hand with live meld labels, turn controls, drawers and animations.
// Mounted by app.js on #screen-rummy: mountRummyTable(root, ctx) -> same interface as the 28 table.
import { h, $, esc, seatName, initials, reducedMotion, botBadge, SPARKLE } from '../util.js';
import { createBack } from '../cards.js';
import { flyFrom, flyTo, dealFlights, pulse } from '../anim.js';
import { mountChat, markRead } from '../chat.js';
import { botIcon } from '../lobby.js';
import { createRCard, syncWild, rShort, rCardName, wildRankOf, rankPlural, isJoker, SUIT_GLYPH, rankLabel, isRedSuit } from './rcards.js';
import { classifyGroup, bestArrangement, bestDiscard, meldsReady } from './melds.js';
import { syncGroups, sortBySuit, sortByRank, arrangeBest, moveCards, groupSelected, ungroup, layoutRows } from './hand.js';
import { GROUP_LABEL, GROUP_SHORT, confirmDeclare, confirmDrop, showDealEnd, hideDealEnd, showRummyMatchEnd, hideRummyMatchEnd, showRummyScoreboard, showRummyRules } from './rmodals.js';
import { closeModal, isOpen } from '../modals.js';

const DEAL_STAGGER = 34;
const DEAL_DUR = 360;
const REACTIONS = ['👍', '😂', '😮', '😡', '🔥', '👏', '🙏', '😢'];
// opponent slots (x%, y%) for k players, counter-clockwise from my right: right -> top -> left
const SLOTS = {
  1: [[50, 3]],
  2: [[80, 6], [20, 6]],
  3: [[93, 30], [50, 3], [7, 30]],
  4: [[93, 34], [70, 3], [30, 3], [7, 34]],
  5: [[94, 40], [77, 6], [50, 2], [23, 6], [6, 40]],
};
// short landscape screens: keep the top centre free for the piles
const LAND_SLOTS = {
  1: [[78, 4]], 2: [[80, 4], [20, 4]], 3: [[95, 50], [72, 4], [28, 4]], 4: [[95, 50], [74, 4], [26, 4], [5, 50]],
};
const SPEC_SLOTS = { // spectators see everyone; first slot is the bottom
  2: [[50, 84], [50, 3]], 3: [[50, 84], [90, 18], [10, 18]], 4: [[50, 84], [93, 34], [50, 3], [7, 34]],
  5: [[50, 84], [93, 40], [72, 3], [28, 3], [7, 40]], 6: [[50, 84], [94, 44], [77, 6], [50, 2], [23, 6], [6, 44]],
};
const ICO = {
  log: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  chat: '<svg viewBox="0 0 24 24" class="ico"><path d="M4 5h16v11H9l-5 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg>',
  more: '<svg viewBox="0 0 24 24" class="ico"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  leave: '<svg viewBox="0 0 24 24" class="ico"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  board: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
  sound: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path class="snd-on" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path class="snd-off" d="M17 9l5 6M22 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  rules: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  sort: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  group: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><rect x="3" y="6" width="7" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="5" width="7" height="12" rx="1.5" fill="currentColor" opacity=".35" stroke="currentColor" stroke-width="2"/><path d="M18 9v6M15 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  ungroup: '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><rect x="2.5" y="6" width="7" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14.5" y="6" width="7" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/></svg>',
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};

// player's grouping per deal survives re-mounts / resumes in this tab
const groupStore = new Map();
function loadGroups(key) {
  if (groupStore.has(key)) return groupStore.get(key);
  try { const v = JSON.parse(sessionStorage.getItem(`rummy.groups.${key}`) || 'null'); if (Array.isArray(v)) return v; } catch {}
  return null;
}
function saveGroups(key, groups) {
  groupStore.set(key, groups);
  try { sessionStorage.setItem(`rummy.groups.${key}`, JSON.stringify(groups)); } catch {}
}

export function mountRummyTable(root, ctx) {
  root.classList.add('rummy-screen');
  root.innerHTML = `
    <header class="hud glass-bar r-hud">
      <div class="hud-left">
        <span class="brand-mark sm r-mark" aria-hidden="true">R</span>
        <div class="hud-meta"><span class="room-tag" title="Room code"></span><span class="hand-no r-deal-no"></span></div>
        <span class="r-game-chip"></span>
      </div>
      <div class="r-standings" role="button" tabindex="0" title="Open scoreboard" aria-label="Pool standings — open scoreboard"></div>
      <div class="r-pts-chip" title="Points you would score if someone declared now (best arrangement of your cards)" aria-live="polite"></div>
      <div class="hud-right">
        <button class="icon-btn hud-opt" type="button" data-act="log" aria-label="Event log" aria-expanded="false">${ICO.log}</button>
        <button class="icon-btn" type="button" data-act="chat" aria-label="Chat" aria-expanded="false">${ICO.chat}<span class="badge" hidden></span></button>
        <div class="more-wrap">
          <button class="icon-btn" type="button" data-act="more" aria-label="More options" aria-haspopup="menu" aria-expanded="false">${ICO.more}</button>
          <div class="more-menu glass" role="menu" hidden>
            <button type="button" role="menuitem" data-act="scoreboard">${ICO.board}Scoreboard</button>
            <button type="button" role="menuitemcheckbox" data-act="sound" aria-checked="true">${ICO.sound}<span class="snd-label">Sound &amp; vibration: on</span></button>
            <button type="button" role="menuitem" data-act="rules">${ICO.rules}How to play</button>
            <button type="button" role="menuitem" class="menu-compact" data-act="log">${ICO.log.replace('class="ico"', 'class="ico" aria-hidden="true"')}Event log</button>
            <button type="button" role="menuitem" class="menu-compact" data-act="leave">${ICO.leave.replace('class="ico"', 'class="ico" aria-hidden="true"')}Leave room</button>
          </div>
        </div>
        <button class="icon-btn hud-opt" type="button" data-act="leave" aria-label="Leave room">${ICO.leave}</button>
      </div>
    </header>
    <div class="r-wrap">
      <div class="r-felt" role="region" aria-label="Card table">
        <div class="r-seats"></div>
        <div class="r-center">
          <div class="r-pile-col">
            <button class="r-deck" type="button" data-act="drawClosed" aria-label="Closed deck">
              <span class="r-wild" aria-hidden="true"></span>
              <span class="r-stack" aria-hidden="true"></span>
              <span class="r-count r-deck-count"></span>
            </button>
            <span class="r-pile-label r-deck-label">Deck</span>
          </div>
          <div class="r-pile-col">
            <button class="r-open" type="button" data-act="drawOpen" aria-label="Open pile">
              <span class="r-open-under" aria-hidden="true"></span>
              <span class="r-open-top"></span>
              <span class="r-count r-open-count"></span>
            </button>
            <span class="r-pile-label r-open-label">Open pile</span>
          </div>
          <div class="r-wild-tag" aria-live="polite"></div>
        </div>
        <div class="announce" aria-live="assertive"></div>
      </div>
      <div class="r-me">
        <div class="r-bar">
          <div class="status-text" aria-live="polite"></div>
          <span class="turn-clock" aria-live="off" hidden></span>
          <div class="r-actions">
            <button class="btn btn-ghost btn-sm hint-btn" type="button" data-act="hint" hidden><span aria-hidden="true">💡</span><span class="hint-label">Hint</span></button>
            <button class="btn btn-ghost btn-sm r-drop-btn" type="button" data-act="drop" hidden>Drop</button>
            <button class="btn btn-outline-gold btn-sm r-declare-btn" type="button" data-act="declare" hidden>Declare</button>
            <button class="btn btn-gold btn-sm r-discard-btn" type="button" data-act="discard" hidden>Discard</button>
          </div>
        </div>
        <div class="hint-box" role="status" hidden></div>
        <div class="r-tools" role="toolbar" aria-label="Arrange your cards">
          <div class="r-sort-wrap">
            <button class="btn btn-ghost btn-xs r-tool" type="button" data-act="sortMenu" aria-haspopup="menu" aria-expanded="false">${ICO.sort}<span>Sort</span></button>
            <div class="more-menu glass r-sort-menu" role="menu" hidden>
              <button type="button" role="menuitem" data-act="sortSuit"><span class="r-mi-ico" aria-hidden="true">♠♥</span>By suit</button>
              <button type="button" role="menuitem" data-act="sortRank"><span class="r-mi-ico" aria-hidden="true">77</span>By rank</button>
              <button type="button" role="menuitem" data-act="sortBest"><span class="r-mi-ico" aria-hidden="true">✓</span>Best melds</button>
            </div>
          </div>
          <button class="btn btn-ghost btn-xs r-tool" type="button" data-act="group" disabled>${ICO.group}<span>Group</span></button>
          <button class="btn btn-ghost btn-xs r-tool" type="button" data-act="ungroup" disabled>${ICO.ungroup}<span>Ungroup</span></button>
          <span class="r-sel-note muted" aria-live="polite"></span>
        </div>
        <div class="react-wrap">
          <button class="icon-btn react-btn" type="button" data-act="react" aria-label="Send a reaction" aria-haspopup="true" aria-expanded="false"><span aria-hidden="true">😊</span></button>
          <div class="react-pop glass" role="menu" hidden>${REACTIONS.map((e) => `<button type="button" role="menuitem" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>
        </div>
        <div class="r-hand" role="group" aria-label="Your hand"></div>
        <span class="card face rcard r-probe" aria-hidden="true"></span>
        <div class="r-say say" role="status"></div>
        <div class="spectator-note" hidden><span class="tag tag-spec">Spectating</span> <span class="r-spec-text">You are watching this match.</span></div>
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
  const felt = q('.r-felt');
  const seatsEl = q('.r-seats');
  const handEl = q('.r-hand');
  const deckBtn = q('.r-deck'), openBtn = q('.r-open');
  const animLayer = document.getElementById('anim-layer') || document.body;
  const logDrawer = q('.log-drawer'), chatDrawer = q('.chat-drawer');
  const chatBox = mountChat(q('.chat-box'), { isVisible: () => !chatDrawer.hidden && !root.hidden });
  const coarse = matchMedia('(pointer: coarse)');
  const phoneRow = matchMedia('(max-width: 560px) and (orientation: portrait)');
  const landShort = matchMedia('(max-height: 560px) and (orientation: landscape)');
  for (const mq of [phoneRow, landShort]) mq.addEventListener?.('change', () => { if (room?.game) renderSeats(false); });

  let room = null, prev = null, prevSeat;
  let busy = false;
  const idleWaiters = [];
  let flights = 0;
  // hand model
  let handKey = '';
  let groups = [];
  const selected = new Set();
  const cardEls = new Map(); // id -> element
  const groupEls = new Map(); // gid -> element
  let freshCard = null; // card I just drew (highlight)
  const drewThisDeal = new Map(); // dealKey -> bool (first vs middle drop)
  const history = []; // client-side per-deal results for the scoreboard
  let shownDealEnd = null, shownMatchEnd = null;

  // -------------------------------------------------------------- helpers
  const me = () => room?.you?.seat ?? null;
  const g = () => room?.game;
  const wr = () => g()?.wildRank || wildRankOf(g()?.wildCard);
  const seated = () => me() != null && (g()?.seats || []).includes(me());
  const myTurn = () => seated() && g()?.turn === me() && g()?.phase === 'playing';
  const acts = () => (myTurn() ? g().legal?.actions || [] : []);
  const step = () => (myTurn() ? g().step : null);
  const nm = (seat) => `<span class="pc${seat % 6}-text">${esc(seat === me() ? 'You' : seatName(room, seat))}</span>`;
  const discardable = (c) => {
    const l = g()?.legal;
    if (l?.discardable?.length) return l.discardable.includes(c);
    return !(g()?.justDrew?.from === 'open' && g().justDrew.card === c);
  };
  const hand = () => (seated() ? g().hand || [] : []);

  async function doAct(action) {
    if (busy) return { ok: false };
    busy = true;
    root.classList.add('busy');
    try { return await ctx.act(action); } finally { busy = false; root.classList.remove('busy'); }
  }

  // -------------------------------------------------------------- events
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'log') { closeMenus(); toggleDrawer(logDrawer); }
    else if (act === 'chat') toggleDrawer(chatDrawer);
    else if (act === 'drawer-return') { setDrawer(logDrawer, false); setDrawer(chatDrawer, false); }
    else if (act === 'rules') { closeMenus(); showRummyRules(); }
    else if (act === 'more') toggleMenu(q('.hud .more-menu'), b);
    else if (act === 'sortMenu') toggleMenu(q('.r-sort-menu'), b);
    else if (act === 'scoreboard') { closeMenus(); openScoreboard(); }
    else if (act === 'sound') ctx.sounds?.toggle();
    else if (act === 'hint') askHint(b);
    else if (act === 'react') toggleMenu(q('.react-pop'), b);
    else if (b.dataset.emoji) { closeMenus(); ctx.react(b.dataset.emoji); }
    else if (act === 'leave') { closeMenus(); ctx.leave(true); }
    else if (act === 'drawClosed') draw('closed');
    else if (act === 'drawOpen') draw('open');
    else if (act === 'discard') { const c = single(); if (c) discard(c); }
    else if (act === 'declare') startDeclare();
    else if (act === 'drop') startDrop();
    else if (act === 'sortSuit') { closeMenus(); rearrange(sortBySuit(hand(), wr())); }
    else if (act === 'sortRank') { closeMenus(); rearrange(sortByRank(hand(), wr())); }
    else if (act === 'sortBest') { closeMenus(); rearrange(arrangeBest(hand(), wr())); }
    else if (act === 'group') { if (selected.size) { rearrange(groupSelected(groups, [...selected])); } }
    else if (act === 'ungroup') { if (selected.size) rearrange(ungroup(groups, [...selected])); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!q('.hud .more-menu').hidden || !q('.react-pop').hidden || !q('.r-sort-menu').hidden) closeMenus();
    else if (!chatDrawer.hidden) toggleDrawer(chatDrawer);
    else if (!logDrawer.hidden) toggleDrawer(logDrawer);
    else if (selected.size) { selected.clear(); paintSelection(); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.more-wrap, .react-wrap, .r-sort-wrap')) closeMenus();
    if (selected.size && !root.hidden && !e.target.closest?.('.r-hand, .r-tools, .r-actions, .r-open, .modal-wrap, .drawer')) { selected.clear(); paintSelection(); }
  });
  q('.r-standings').addEventListener('click', openScoreboard);
  q('.r-standings').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openScoreboard(); } });
  function openScoreboard() { if (room) showRummyScoreboard(room, history); }
  function toggleMenu(menu, btn) {
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }
  function closeMenus() {
    for (const m of root.querySelectorAll('.more-menu, .react-pop')) m.hidden = true;
    for (const b of root.querySelectorAll('[data-act="more"], [data-act="react"], [data-act="sortMenu"]')) b.setAttribute('aria-expanded', 'false');
  }
  function syncSound(on) {
    const b = q('[data-act="sound"]');
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('off', !on);
    q('.snd-label').textContent = `Sound & vibration: ${on ? 'on' : 'off'}`;
  }
  if (ctx.sounds) { syncSound(ctx.sounds.enabled); ctx.sounds.onChange?.(syncSound); }

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
    if (show && d === chatDrawer) { markRead(); setTimeout(() => chatBox.input.focus(), 50); }
    if (show && d === logDrawer) { const l = q('.log-list'); l.scrollTop = l.scrollHeight; }
  }
  function setUnread(n) {
    const badge = q('.hud [data-act="chat"] .badge');
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
    if (n) pulse(badge, 'bump');
  }

  // -------------------------------------------------------------- turn actions
  const single = () => (selected.size === 1 ? [...selected][0] : null);
  async function draw(from) {
    if (step() !== 'draw' || !acts().includes('draw')) return;
    if (from === 'open' && g().legal?.canDrawOpen === false) return;
    clearHint();
    await doAct({ type: 'draw', from });
  }
  async function discard(card) {
    if (step() !== 'discard' || !acts().includes('discard')) return;
    if (!discardable(card)) { nudge(card, 'You can’t discard the card you just picked from the open pile'); return; }
    selected.delete(card);
    clearHint();
    await doAct({ type: 'discard', card });
  }
  function startDeclare() {
    if (step() !== 'discard' || !acts().includes('declare')) return;
    const cards = hand();
    const choices = [...cards]; // any card may be the finishing card (incl. one just taken from the open pile)
    let card = single();
    if (!card) card = bestDiscard(cards, wr())?.card || choices[0];
    const open = (c) => confirmDeclare({ hand: cards, card: c, wildRank: wr(), choices, onPick: (x) => open(x), onConfirm: (x) => { selected.clear(); doAct({ type: 'declare', card: x }); } });
    open(card);
  }
  function startDrop() {
    if (step() !== 'draw' || !acts().includes('drop')) return;
    const pts = g().legal?.dropPoints ?? g().dropPoints ?? (drewThisDeal.get(dealKey()) ? 40 : 20);
    confirmDrop({ points: pts, poolLimit: g().poolLimit || 101, score: g().scores?.[me()] ?? 0, onConfirm: () => doAct({ type: 'drop' }) });
  }
  function nudge(card, msg) {
    const el = cardEls.get(card);
    if (el) pulse(el, 'r-shake');
    flashStatus(msg);
  }
  let flashTimer = 0;
  function flashStatus(html) {
    const st = q('.status-text');
    st.innerHTML = `<b>${esc(html)}</b>`;
    st.dataset.html = '';
    st.classList.add('r-warn');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { st.classList.remove('r-warn'); renderBar(); }, 2200);
  }

  // -------------------------------------------------------------- hints
  let hintSeq = null, lastHint = null;
  async function askHint(btn) {
    if (!room?.game || btn.disabled) return;
    const seq = room.game.seq;
    btn.disabled = true;
    btn.classList.add('busy');
    q('.hint-label').textContent = 'Thinking…';
    try {
      const res = await ctx.hint();
      if (!res?.ok || room?.game?.seq !== seq) return;
      hintSeq = seq; lastHint = res;
      showHint(res);
      ctx.sounds?.play('hint');
    } finally {
      btn.classList.remove('busy');
      q('.hint-label').textContent = 'Hint';
      renderBar();
    }
  }
  function hintTarget(a) {
    if (!a) return null;
    if (a.type === 'draw') return a.from === 'open' ? openBtn : deckBtn;
    if (a.type === 'discard' || a.type === 'declare') return cardEls.get(a.card) || null;
    if (a.type === 'drop') return q('.r-drop-btn');
    return null;
  }
  function showHint(res) {
    clearHint();
    const box = q('.hint-box');
    box.innerHTML = `<span class="hb-ico" aria-hidden="true">💡</span><span><b>${esc(prettyCards(res.label || ''))}</b>${res.reason ? ` — ${esc(prettyCards(res.reason))}` : ''}</span><span class="hb-src">${res.source === 'claude' ? `${SPARKLE} Claude` : 'Bot'}</span>`;
    box.hidden = false;
    applyHint();
  }
  function applyHint() {
    if (hintSeq !== g()?.seq || !lastHint) return;
    const a = lastHint.action;
    hintTarget(a)?.classList.add('hinted');
    if (a?.type === 'declare') q('.r-declare-btn').classList.add('hinted');
    if ((a?.type === 'discard' || a?.type === 'declare') && a.card && !selected.has(a.card) && hand().includes(a.card)) { selected.clear(); selected.add(a.card); paintSelection(); }
  }
  function clearHint() {
    q('.hint-box').hidden = true;
    root.querySelectorAll('.hinted').forEach((el) => el.classList.remove('hinted'));
  }

  // -------------------------------------------------------------- reactions / speech
  function anchorOf(seat) {
    if (seat == null) return felt;
    if (seat === me() && seated()) return handEl;
    return $(`.r-seat[data-seat="${seat}"] .r-plate`, seatsEl) || felt;
  }
  function react(seat, emoji, name) {
    if (!room?.game) return;
    const anchor = anchorOf(seat);
    const r = anchor.getBoundingClientRect();
    const el = h('div', { class: 'reaction-float', 'aria-hidden': 'true' }, h('span', { class: 'rf-emoji' }, emoji), seat == null && name ? h('span', { class: 'rf-name' }, name) : null);
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${anchor === felt ? r.top + r.height * 0.3 : r.top}px`;
    el.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 40)}px`);
    document.body.append(el);
    setTimeout(() => el.remove(), 2200);
  }
  const sayTimers = new Map();
  function say(seat, text) {
    if (!room?.game || seat == null || !text) return;
    const el = seat === me() && seated() ? q('.r-say') : $(`.r-seat[data-seat="${seat}"] .say`, seatsEl);
    if (!el) return;
    el.textContent = text.length > 90 ? `${text.slice(0, 88)}…` : text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(sayTimers.get(seat));
    sayTimers.set(seat, setTimeout(() => el.classList.remove('show'), 3200));
  }
  function pill(seat, html) {
    const s = $(`.r-seat[data-seat="${seat}"]`, seatsEl);
    if (!s) return;
    $('.trick-pill', s)?.remove();
    const p = h('div', { class: 'trick-pill r-pill', role: 'status', html });
    s.append(p);
    setTimeout(() => p.remove(), 1900);
  }

  // -------------------------------------------------------------- main render
  function render(r) {
    room = r;
    const gv = r.game;
    if (!gv) return;
    if (prevSeat !== undefined && prevSeat !== r.you.seat) { prev = null; handKey = ''; }
    prevSeat = r.you.seat;
    const first = !prev;
    const snap = first ? null : snapshot();
    const newDeal = !first && prev.dealNumber !== gv.dealNumber;
    if (hintSeq !== null && hintSeq !== gv.seq) { hintSeq = null; lastHint = null; clearHint(); }
    if (seated() && gv.step === 'discard' && gv.turn === me()) drewThisDeal.set(dealKey(), true);

    root.classList.toggle('spectator', !seated());
    root.dataset.phase = gv.phase;
    renderHud();
    renderSeats(newDeal);
    renderCenter(snap);
    syncHand();
    layoutHand(!first && !newDeal);
    renderBar();
    renderLog();
    applyHint();
    collectHistory();
    if (!first) animate(prev, gv, snap, newDeal);
    if (!first) cues(prev, gv, newDeal);
    modals(first);
    prev = gv;
  }
  const dealKey = () => `${room?.code}|${me()}|${g()?.dealNumber}`;

  function snapshot() {
    const handRects = new Map();
    for (const [id, el] of cardEls) if (el.isConnected) handRects.set(id, el.getBoundingClientRect());
    const fanRects = new Map();
    for (const s of seatsEl.querySelectorAll('.r-seat')) fanRects.set(Number(s.dataset.seat), ($('.r-fan', s) || s).getBoundingClientRect());
    return { handRects, handRect: handEl.getBoundingClientRect(), deckRect: $('.r-stack', deckBtn).getBoundingClientRect(), openRect: openBtn.getBoundingClientRect(), fanRects };
  }

  // -------------------------------------------------------------- HUD
  function renderHud() {
    const gv = g();
    q('.room-tag').textContent = room.code;
    q('.r-deal-no').textContent = `Deal ${gv.dealNumber || 1}`;
    q('.r-game-chip').innerHTML = `<span class="cc-label">Rummy</span><b>Pool ${gv.poolLimit || 101}</b>`;
    const lim = gv.poolLimit || 101;
    const order = [...gv.seats];
    const mi = order.indexOf(me());
    if (mi > 0) order.unshift(...order.splice(mi, 1));
    const html = order.map((s) => {
      const t = gv.scores?.[s] ?? 0;
      const out = (gv.eliminated || []).includes(s);
      const dropped = gv.dropped?.[s] != null;
      const cls = `r-sc pc${s % 6}${s === me() ? ' mine' : ''}${out ? ' out' : t >= lim * 0.8 ? ' danger' : t >= lim * 0.6 ? ' warm' : ''}${gv.turn === s ? ' turn' : ''}${dropped ? ' dropped' : ''}`;
      const name = s === me() ? 'You' : seatName(room, s).replace(/^Bot\s+/i, '');
      return `<span class="${cls}" title="${esc(seatName(room, s))}: ${t} / ${lim}${out ? ' (eliminated)' : ''}"><span class="r-sc-name">${esc(name)}</span><b>${t}</b><i style="width:${Math.min(100, (t / lim) * 100)}%"></i></span>`;
    }).join('') + `<span class="r-sc-lim" aria-hidden="true">/${lim}</span>`;
    const st = q('.r-standings');
    st.classList.toggle('many', order.length >= 5);
    if (st.dataset.html !== html) { st.dataset.html = html; st.innerHTML = html; }
    renderPointsChip();
  }
  function renderPointsChip() {
    const el = q('.r-pts-chip');
    const cards = hand();
    const gv = g();
    if (!seated() || cards.length < 13 || gv.phase !== 'playing' || gv.dropped?.[me()] != null) { el.hidden = true; root.classList.remove('r-ready'); return; }
    el.hidden = false;
    let pts, ready = false;
    if (cards.length >= 14) {
      const bd = bestDiscard(cards, wr());
      pts = bd?.points ?? 0;
      ready = !!bd?.arrangement?.valid;
    } else {
      const a = bestArrangement(cards, wr());
      pts = a.points; ready = !!a.valid;
    }
    const html = ready && cards.length >= 14 ? '<span class="cc-label">Ready</span><b>Declare!</b>' : `<span class="cc-label">Your points</span><b>${pts}</b>`;
    if (el.dataset.html !== html) { const changed = !!el.dataset.html; el.dataset.html = html; el.innerHTML = html; if (changed) pulse(el, 'bump'); }
    el.classList.toggle('ready', ready && cards.length >= 14);
    el.classList.toggle('low', !ready && pts <= 15);
    root.classList.toggle('r-ready', ready && cards.length >= 14 && step() === 'discard');
  }

  // -------------------------------------------------------------- seats
  function renderSeats(newDeal) {
    const gv = g();
    const all = gv.seats || [];
    const viewIdx = Math.max(0, all.indexOf(me()));
    const rot = [...all.slice(viewIdx), ...all.slice(0, viewIdx)];
    const others = seated() ? rot.slice(1) : rot;
    let slots = seated() ? (landShort.matches && LAND_SLOTS[others.length]) || SLOTS[others.length] || SLOTS[5] : SPEC_SLOTS[others.length] || SPEC_SLOTS[6];
    // phones in portrait: everyone in one row along the top (side seats would collide with the piles)
    const rowMode = phoneRow.matches && others.length >= 3;
    if (rowMode) {
      const k = others.length - (seated() ? 0 : 1);
      const row = Array.from({ length: k }, (_, i) => [100 - ((i + 0.5) / k) * 100, 2]);
      slots = seated() ? row : [[50, 84], ...row];
    }
    felt.dataset.n = String(others.length);
    const keep = new Set();
    others.forEach((seat, i) => {
      keep.add(String(seat));
      let el = $(`.r-seat[data-seat="${seat}"]`, seatsEl);
      if (!el) {
        el = h('div', { class: 'r-seat', dataset: { seat } }, h('div', { class: 'r-plate', role: 'group' }), h('div', { class: 'r-fan', 'aria-hidden': 'true' }), h('div', { class: 'say', role: 'status' }));
        seatsEl.append(el);
      }
      const [x, y] = slots[i] || [50, 3];
      el.style.setProperty('--x', x);
      el.style.setProperty('--y', y);
      el.style.setProperty('--tx', rowMode ? 50 : x);
      el.dataset.side = x < 20 ? 'left' : x > 80 ? 'right' : y > 60 ? 'bottom' : 'top';
      renderPlate(el, seat);
      renderFan(el, seat, newDeal);
    });
    for (const el of [...seatsEl.children]) if (!keep.has(el.dataset.seat)) el.remove();
  }
  function renderPlate(el, seat) {
    const gv = g();
    const p = room.seats?.[seat];
    const name = p?.name || `Seat ${seat + 1}`;
    const out = (gv.eliminated || []).includes(seat);
    const dropped = gv.dropped?.[seat];
    const isTurn = gv.turn === seat && gv.phase === 'playing';
    const lim = gv.poolLimit || 101;
    const score = gv.scores?.[seat] ?? 0;
    el.className = `r-seat pc${seat % 6}${isTurn ? ' turn' : ''}${out ? ' out' : ''}${dropped != null ? ' dropped' : ''}`;
    const plate = $('.r-plate', el);
    const key = [name, p?.isBot, p?.botControlled, p?.ai, p?.connected, gv.dealer === seat, score, out, dropped, lim].join('|');
    if (plate.dataset.key !== key) {
      plate.dataset.key = key;
      plate.innerHTML = `
        <div class="avatar pc${seat % 6}${p?.ai === 'claude' ? ' claude' : ''}">${p?.isBot ? botIcon() : esc(initials(name))}<span class="ring" aria-hidden="true"></span></div>
        <div class="p-info">
          <div class="p-name">${esc(name)}</div>
          <div class="p-sub"><span class="r-score${score >= lim * 0.8 ? ' danger' : ''}" title="Pool score">${score}<span class="muted">/${lim}</span></span>${out ? '<span class="tag tag-off">Out</span>' : dropped != null ? `<span class="tag r-tag-drop">Drop ${dropped}</span>` : ''}${botBadge(p)}${p && p.connected === false && !p.botControlled ? '<span class="tag tag-off">Offline</span>' : ''}</div>
        </div>
        ${gv.dealer === seat ? '<span class="dealer-chip" title="Dealer">D</span>' : ''}
        <span class="thinking" aria-hidden="true"><i></i><i></i><i></i></span>`;
      plate.setAttribute('aria-label', `${name}, ${score} of ${lim} points${gv.dealer === seat ? ', dealer' : ''}${out ? ', eliminated' : ''}${dropped != null ? `, dropped (${dropped})` : ''}`);
    }
    plate.classList.toggle('offline', !!p && p.connected === false);
    plate.classList.toggle('is-thinking', isTurn && !!p && (p.isBot || p.botControlled) && p.ai === 'claude');
    const ring = $('.ring', plate);
    const tc = room.turnClock && room.turnClock.seat === seat ? room.turnClock : null;
    const ringKey = isTurn ? `${gv.seq}|${tc ? tc.total : 'free'}` : '';
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
  function renderFan(el, seat, newDeal) {
    const gv = g();
    const fan = $('.r-fan', el);
    const out = (gv.eliminated || []).includes(seat);
    const n = out ? 0 : gv.handCounts?.[seat] ?? 0;
    let backs = [...fan.querySelectorAll('.card')];
    if (newDeal) { backs.forEach((b) => b.remove()); backs = []; }
    while (backs.length > n) backs.pop().remove();
    const had = backs.length;
    while (backs.length < n) { const b = createBack(); fan.prepend(b); backs.unshift(b); }
    backs.forEach((b, i) => {
      b.style.setProperty('--i', i); b.style.setProperty('--n', n);
      if (newDeal && i < n - had && !reducedMotion()) {
        b.classList.add('deal-in');
        b.style.setProperty('--dd', `${i * DEAL_STAGGER * 2 + DEAL_DUR * 0.6}ms`);
        b.addEventListener('animationend', () => b.classList.remove('deal-in'), { once: true });
      }
    });
    let cnt = $('.r-fan-count', fan);
    if (!cnt) { cnt = h('span', { class: 'r-fan-count' }); fan.append(cnt); }
    cnt.textContent = n;
    cnt.hidden = !n;
    fan.style.setProperty('--n', n);
  }

  // -------------------------------------------------------------- centre: deck, wild joker, open pile
  function renderCenter() {
    const gv = g();
    const stack = $('.r-stack', deckBtn);
    const layers = Math.max(1, Math.min(4, Math.ceil((gv.closedCount || 0) / 18)));
    if (stack.childElementCount !== layers) stack.replaceChildren(...Array.from({ length: layers }, (_, i) => { const b = createBack(); b.style.setProperty('--k', i); return b; }));
    stack.classList.toggle('empty', !gv.closedCount);
    q('.r-deck-count').textContent = gv.closedCount ?? 0;
    // wild joker tucked under the deck
    const wild = $('.r-wild', deckBtn);
    if (wild.dataset.card !== (gv.wildCard || '')) {
      wild.dataset.card = gv.wildCard || '';
      wild.replaceChildren(...(gv.wildCard ? [createRCard(gv.wildCard, { wildRank: wr() })] : []));
      if (prev) pulse(wild, 'pop');
    }
    const w = wr();
    const tag = q('.r-wild-tag');
    const tagHtml = gv.wildCard ? `<span class="r-wild-badge">Wild</span><b>${isJoker(gv.wildCard) ? 'Aces' : rankPlural(w)}</b>${isJoker(gv.wildCard) ? '<small>printed joker turned up</small>' : ''}` : '';
    if (tag.dataset.html !== tagHtml) { tag.dataset.html = tagHtml; tag.innerHTML = tagHtml; }
    deckBtn.setAttribute('aria-label', `Closed deck, ${gv.closedCount ?? 0} cards${gv.wildCard ? `. Wild joker: ${rCardName(gv.wildCard)} — ${rankPlural(w)} are wild` : ''}`);
    // open pile
    const top = $('.r-open-top', openBtn);
    if (top.dataset.card !== (gv.openTop || '')) {
      top.dataset.card = gv.openTop || '';
      top.replaceChildren(...(gv.openTop ? [createRCard(gv.openTop, { wildRank: w })] : []));
    } else if (top.firstElementChild) syncWild(top.firstElementChild, w);
    $('.r-open-under', openBtn).dataset.n = String(Math.min(3, Math.max(0, (gv.openCount || 0) - 1)));
    q('.r-open-count').textContent = gv.openCount ?? 0;
    openBtn.setAttribute('aria-label', gv.openTop ? `Open pile: ${rCardName(gv.openTop)} on top, ${gv.openCount} cards` : 'Open pile (empty)');
    // my draw step
    const drawStep = step() === 'draw' && acts().includes('draw');
    const canOpen = drawStep && gv.legal?.canDrawOpen !== false && !!gv.openTop;
    deckBtn.classList.toggle('can-draw', drawStep);
    openBtn.classList.toggle('can-draw', canOpen);
    deckBtn.disabled = !drawStep;
    openBtn.disabled = !canOpen;
    openBtn.classList.toggle('drop-zone', step() === 'discard');
    q('.r-deck-label').textContent = drawStep ? 'Tap to draw' : 'Deck';
    q('.r-open-label').textContent = canOpen ? 'Tap to take' : step() === 'discard' ? 'Discard here' : 'Open pile';
    if (drawStep && !canOpen && gv.openTop) openBtn.title = 'You can’t take from the open pile now';
    else openBtn.removeAttribute('title');
  }

  // -------------------------------------------------------------- my hand: model
  function syncHand() {
    const gv = g();
    const cards = hand();
    const key = dealKey();
    if (handKey !== key) {
      handKey = key;
      selected.clear();
      const stored = seated() ? loadGroups(key) : null;
      groups = stored || sortBySuit(cards, wr());
    }
    const res = syncGroups(groups, cards);
    groups = res.groups;
    for (const c of [...selected]) if (!cards.includes(c)) selected.delete(c);
    freshCard = gv.justDrew?.card && cards.includes(gv.justDrew.card) && gv.turn === me() ? gv.justDrew.card : null;
    if (seated()) saveGroups(key, groups);
  }
  function rearrange(next) {
    groups = next;
    saveGroups(dealKey(), groups);
    selected.clear();
    layoutHand(true);
    renderBar();
  }

  // -------------------------------------------------------------- my hand: layout + DOM
  function metrics() {
    const probe = q('.r-probe');
    const cw = probe.getBoundingClientRect().width || 56;
    const W = handEl.clientWidth || window.innerWidth - 16;
    const maxRows = Number(getComputedStyle(handEl).getPropertyValue('--max-rows')) || 2;
    const minStep = coarse.matches ? Math.min(40, cw * 0.82) : Math.max(22, cw * 0.38);
    return { cw, W, gap: Math.max(8, Math.round(cw * 0.2)), minStep, maxStep: Math.max(minStep, cw * 0.62), maxRows };
  }
  function cardEl(id) {
    let el = cardEls.get(id);
    if (!el) {
      el = createRCard(id, { button: true, wildRank: wr() });
      el.addEventListener('pointerdown', onCardPointerDown);
      cardEls.set(id, el);
    } else syncWild(el, wr());
    return el;
  }
  function layoutHand(flip = false) {
    const cards = hand();
    const inHand = new Set(cards);
    for (const [id, el] of cardEls) if (!inHand.has(id)) { el.remove(); cardEls.delete(id); }
    const before = flip && !reducedMotion() ? new Map([...cardEls].filter(([, el]) => el.isConnected).map(([id, el]) => [id, el.getBoundingClientRect()])) : null;
    const m = metrics();
    const L = layoutRows(groups.map((gr) => gr.cards.length), m);
    handEl.style.setProperty('--step', `${L.step.toFixed(1)}px`);
    handEl.style.setProperty('--gap', `${m.gap}px`);
    handEl.dataset.rows = String(L.rows.length);
    const rowEls = [...handEl.querySelectorAll(':scope > .r-row')];
    while (rowEls.length < L.rows.length) { const r = h('div', { class: 'r-row' }); handEl.append(r); rowEls.push(r); }
    while (rowEls.length > L.rows.length) rowEls.pop().remove();
    const liveG = new Set(groups.map((gr) => gr.id));
    for (const [id, el] of groupEls) if (!liveG.has(id)) { el.remove(); groupEls.delete(id); }
    L.rows.forEach((idxs, ri) => {
      const rowEl = rowEls[ri];
      const wanted = idxs.map((i) => groupEl(groups[i], m, L.step));
      wanted.forEach((el, k) => { if (rowEl.children[k] !== el) rowEl.insertBefore(el, rowEl.children[k] || null); });
      while (rowEl.children.length > wanted.length) rowEl.lastElementChild.remove();
    });
    paintSelection();
    if (before) for (const [id, el] of cardEls) {
      const r0 = before.get(id);
      if (!r0) continue;
      const r1 = el.getBoundingClientRect();
      const dx = r0.left - r1.left, dy = r0.top - r1.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.25,1)' });
    }
  }
  function groupEl(gr, m, stepPx) {
    let el = groupEls.get(gr.id);
    if (!el) {
      el = h('div', { class: 'r-group', dataset: { gid: gr.id } },
        h('button', { class: 'r-glabel', type: 'button', dataset: { gid: gr.id }, tabindex: '-1' }),
        h('div', { class: 'r-gcards' }));
      groupEls.set(gr.id, el);
    }
    const cardsBox = $('.r-gcards', el);
    const els = gr.cards.map(cardEl);
    els.forEach((c, i) => { if (cardsBox.children[i] !== c) cardsBox.insertBefore(c, cardsBox.children[i] || null); });
    while (cardsBox.children.length > els.length) cardsBox.lastElementChild.remove();
    const type = gr.cards.length >= 3 ? classifyGroup(gr.cards, wr()) : null;
    const width = m.cw + (gr.cards.length - 1) * stepPx;
    el.style.setProperty('--gw', `${width}px`);
    el.dataset.type = gr.cards.length < 3 ? 'none' : type || 'invalid';
    el.dataset.wide = width >= 118 ? '1' : '';
    return el;
  }
  function labelFor(el) {
    const t = el.dataset.type;
    const wide = !!el.dataset.wide;
    if (t === 'none') return '';
    if (t === 'invalid') return 'Invalid';
    return `${wide ? GROUP_LABEL[t] : GROUP_SHORT[t]} ✓`;
  }
  /** Selection state, move targets and per-card flags (cheap; no relayout). */
  function paintSelection() {
    const sel = selected.size > 0;
    const discardStep = step() === 'discard';
    for (const [id, el] of cardEls) {
      el.classList.toggle('selected', selected.has(id));
      el.classList.toggle('fresh', id === freshCard);
      const locked = discardStep && !discardable(id);
      el.classList.toggle('locked', locked);
      el.title = locked ? 'Picked from the open pile — you can’t discard it this turn' : '';
    }
    for (const el of groupEls.values()) {
      const gr = groups.find((x) => x.id === el.dataset.gid);
      const allSel = gr && gr.cards.every((c) => selected.has(c));
      const target = sel && !allSel;
      el.classList.toggle('target', target);
      const lb = $('.r-glabel', el);
      const txt = target ? (el.dataset.wide ? 'Move here' : parseFloat(el.style.getPropertyValue('--gw')) < 60 ? '+' : 'Move') : labelFor(el);
      if (lb.textContent !== txt) lb.textContent = txt;
      lb.tabIndex = target ? 0 : -1;
      lb.setAttribute('aria-label', target ? `Move ${selected.size} selected card${selected.size > 1 ? 's' : ''} to this group` : txt ? `Group: ${txt}` : 'Group');
    }
    handEl.classList.toggle('has-sel', sel);
    q('[data-act="group"]').disabled = !sel || !canGroup();
    q('[data-act="ungroup"]').disabled = !sel;
    q('.r-sel-note').textContent = sel ? `${selected.size} selected` : '';
    renderBar();
  }
  function canGroup() {
    // grouping is a no-op when the selection already is exactly one whole group
    const gr = groups.find((x) => x.cards.some((c) => selected.has(c)));
    return !(gr && gr.cards.length === selected.size && gr.cards.every((c) => selected.has(c)));
  }

  // tap / click on cards and group labels
  let suppressClick = false;
  handEl.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const lb = e.target.closest('.r-glabel');
    if (lb) {
      if (selected.size && lb.closest('.r-group').classList.contains('target')) rearrange(moveCards(groups, [...selected], lb.dataset.gid));
      return;
    }
    const c = e.target.closest('.card');
    if (!c || !seated()) return;
    const id = c.dataset.card;
    if (step() === 'discard' && selected.size === 1 && selected.has(id) && acts().includes('discard')) { discard(id); return; }
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    clearHint();
    paintSelection();
  });

  // drag (mouse, pen and touch): move cards between groups, reorder, or drop on the open pile to discard
  let drag = null;
  function onCardPointerDown(e) {
    if (e.button !== 0 || !seated() || g()?.phase !== 'playing') return;
    const el = e.currentTarget;
    drag = { id: el.dataset.card, x: e.clientX, y: e.clientY, started: false, pointerId: e.pointerId, src: el };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
    window.addEventListener('pointercancel', onDragCancel, { once: true });
  }
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.started) {
      if (Math.hypot(dx, dy) < (e.pointerType === 'touch' ? 12 : 6)) return;
      drag.started = true;
      drag.cards = selected.has(drag.id) ? groups.flatMap((gr) => gr.cards).filter((c) => selected.has(c)) : [drag.id];
      const r = drag.src.getBoundingClientRect();
      drag.off = { x: drag.x - r.left, y: drag.y - r.top };
      drag.ghost = h('div', { class: 'r-ghost', 'aria-hidden': 'true' }, drag.cards.slice(0, 5).map((c) => createRCard(c, { wildRank: wr() })));
      drag.ghost.style.setProperty('--w', `${r.width}px`);
      document.body.append(drag.ghost);
      for (const c of drag.cards) cardEls.get(c)?.classList.add('dragging');
      handEl.classList.add('dragging');
      root.classList.add('r-dragging');
      try { drag.src.releasePointerCapture?.(e.pointerId); } catch {}
    }
    e.preventDefault();
    drag.ghost.style.transform = `translate(${e.clientX - drag.off.x}px, ${e.clientY - drag.off.y}px) rotate(-4deg)`;
    drag.target = dropTargetAt(e.clientX, e.clientY);
    showDropMarker(drag.target);
  }
  function dropTargetAt(x, y, d = drag) {
    if (d.ghost) drag.ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(x, y);
    if (d.ghost) d.ghost.style.visibility = '';
    if (!under) return null;
    if (under.closest('.r-open') && step() === 'discard' && d.cards.length === 1 && discardable(d.cards[0])) return { kind: 'discard' };
    const gEl = under.closest('.r-group');
    if (gEl && handEl.contains(gEl)) {
      const cs = [...$('.r-gcards', gEl).children];
      let idx = cs.length;
      for (let i = 0; i < cs.length; i++) {
        const r = cs[i].getBoundingClientRect();
        const right = i + 1 < cs.length ? cs[i + 1].getBoundingClientRect().left : r.right;
        if (x < (r.left + right) / 2) { idx = i; break; }
      }
      return { kind: 'group', gid: gEl.dataset.gid, index: idx, el: gEl };
    }
    const row = under.closest('.r-row, .r-hand');
    if (row && handEl.contains(row) || row === handEl) {
      // empty space in the hand: new group at the end of that row
      return { kind: 'new' };
    }
    return null;
  }
  function showDropMarker(t) {
    root.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
    let mk = q('.r-insert');
    if (!mk) { mk = h('span', { class: 'r-insert', 'aria-hidden': 'true' }); handEl.append(mk); }
    mk.hidden = true;
    if (!t) return;
    if (t.kind === 'discard') { openBtn.classList.add('drop-hover'); return; }
    if (t.kind === 'new') { handEl.classList.add('drop-hover'); return; }
    t.el.classList.add('drop-hover');
    const cs = [...$('.r-gcards', t.el).children];
    const hr = handEl.getBoundingClientRect();
    const ref = cs[t.index] || cs[cs.length - 1];
    if (!ref) return;
    const r = ref.getBoundingClientRect();
    const x = cs[t.index] ? r.left - 3 : r.right + 3;
    mk.hidden = false;
    mk.style.left = `${x - hr.left}px`;
    mk.style.top = `${r.top - hr.top}px`;
    mk.style.height = `${r.height}px`;
  }
  function endDragVisuals() {
    drag?.ghost?.remove();
    for (const el of cardEls.values()) el.classList.remove('dragging');
    handEl.classList.remove('dragging');
    root.classList.remove('r-dragging');
    root.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
    const mk = q('.r-insert'); if (mk) mk.hidden = true;
    window.removeEventListener('pointermove', onDragMove);
  }
  function onDragEnd(e) {
    window.removeEventListener('pointercancel', onDragCancel);
    const d = drag;
    endDragVisuals();
    drag = null;
    if (!d?.started) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    const t = dropTargetAt(e.clientX, e.clientY, d);
    if (!t) return;
    if (t.kind === 'discard') { selected.clear(); discard(d.cards[0]); return; }
    if (t.kind === 'new') { rearrange(moveCards(groups, d.cards, null, null, groups.length)); return; }
    rearrange(moveCards(groups, d.cards, t.gid, t.index));
  }
  function onDragCancel() { window.removeEventListener('pointerup', onDragEnd); endDragVisuals(); drag = null; }

  new ResizeObserver(() => { if (room?.game) layoutHand(false); }).observe(handEl);

  // -------------------------------------------------------------- action bar
  function renderBar() {
    if (!room?.game) return;
    const gv = g();
    const a = acts();
    const st = step();
    const sel = selected.size;
    const one = single();
    const hb = q('[data-act="hint"]');
    hb.hidden = !(room.settings?.hints && a.length && gv.phase === 'playing');
    if (!hb.classList.contains('busy')) hb.disabled = hintSeq === gv.seq;
    q('.r-drop-btn').hidden = !(st === 'draw' && a.includes('drop'));
    const disc = q('.r-discard-btn');
    disc.hidden = st !== 'discard' || !a.includes('discard');
    disc.disabled = !one || !discardable(one);
    disc.title = one && !discardable(one) ? 'You can’t discard the card you just picked from the open pile' : one ? `Discard ${rShort(one)}` : 'Select one card to discard';
    disc.innerHTML = one && discardable(one) ? `Discard <span class="r-btn-card ${cardTone(one)}">${esc(rShort(one))}</span>` : 'Discard';
    const dec = q('.r-declare-btn');
    dec.hidden = st !== 'discard' || !a.includes('declare');
    q('.react-wrap').hidden = !['playing', 'dealEnd', 'matchEnd'].includes(gv.phase);
    q('.r-tools').hidden = !seated() || gv.phase !== 'playing' || !hand().length;
    // status line
    let s = '';
    const out = (gv.eliminated || []).includes(me());
    const dropped = gv.dropped?.[me()];
    if (gv.phase === 'dealEnd') s = 'Deal complete';
    else if (gv.phase === 'matchEnd') s = 'Match over';
    else if (seated() && out) s = 'You are out of this match — watching';
    else if (seated() && dropped != null) s = `You dropped (${dropped} pts) — waiting for the next deal`;
    else if (myTurn() && st === 'draw') s = '<b>Your turn</b> — draw from the deck or the open pile';
    else if (myTurn() && st === 'discard') {
      if (one && discardable(one)) s = `<b>Tap again to discard</b> — ${esc(rShort(one))}`;
      else if (one) s = '<b>Picked from the open pile</b> — discard a different card';
      else s = root.classList.contains('r-ready') ? '<b>You can declare!</b> — tap Declare' : '<b>Discard</b> a card, or declare';
    } else if (gv.turn != null) s = `${nm(gv.turn)} ${gv.step === 'discard' ? 'is discarding' : 'is drawing'}<span class="dots"></span>`;
    if (!myTurn() && sel && gv.phase === 'playing') s = `${sel} selected — <b>Group</b> them or tap a group’s label to move`;
    const stEl = q('.status-text');
    if (!stEl.classList.contains('r-warn') && stEl.dataset.html !== s) { stEl.dataset.html = s; stEl.innerHTML = s; }
    const turnPill = myTurn() && a.length > 0;
    stEl.classList.toggle('turn-pill', turnPill && !stEl.classList.contains('r-warn'));
    q('.r-me').classList.toggle('my-turn', turnPill);
    root.classList.toggle('my-draw', st === 'draw');
    root.classList.toggle('my-discard', st === 'discard');
    for (const b of root.querySelectorAll('.drawer-turn')) b.hidden = !turnPill;
    q('.spectator-note').hidden = seated();
    if (!seated()) q('.r-spec-text').textContent = me() != null ? 'You are not dealt in this match.' : 'You are watching this match.';
  }
  const cardTone = (c) => (isJoker(c) ? 'joker' : isRedSuit(c[1]) ? 'red' : 'black');

  // -------------------------------------------------------------- log
  function prettyCards(text) {
    return String(text).replace(/\b([A2-9TJQK])([SHDC])[12]?\b/g, (m, r, s) => `${rankLabel(r)}${SUIT_GLYPH[s]}`).replace(/\bX[12]\b/g, 'Joker');
  }
  function renderLog() {
    const list = q('.log-list');
    const lines = g().log || [];
    const key = lines.join('\n') + JSON.stringify(room.seats.map((s) => s?.name));
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    list.innerHTML = lines.map((l) => `<li>${esc(l)
      .replace(/\b[Ss]eat (\d)\b/g, (m, n) => (room.seats?.[Number(n)] ? `<span class="pc${Number(n) % 6}-text">${esc(seatName(room, Number(n)))}</span>` : m))
      .replace(/\b([A2-9TJQK])([SHDC])[12]\b/g, (m, r, s) => `<span class="log-card ${isRedSuit(s) ? 'red' : ''}">${rankLabel(r)}${SUIT_GLYPH[s]}</span>`)
      .replace(/\bX[12]\b/g, '<span class="log-card red">★</span>')}</li>`).join('') || '<li class="muted">No events yet</li>';
    list.scrollTop = list.scrollHeight;
  }

  // -------------------------------------------------------------- scoreboard history (client side)
  function collectHistory() {
    const gv = g();
    if (!gv.dealResult || !['dealEnd', 'matchEnd'].includes(gv.phase)) return;
    if (history.some((x) => x.deal === gv.dealNumber && x.code === room.code)) return;
    const r = gv.dealResult;
    history.push({ code: room.code, deal: gv.dealNumber, points: { ...r.points }, totals: { ...gv.scores }, winner: r.winner, declarer: r.declarer, wrongShow: r.wrongShow });
  }

  // -------------------------------------------------------------- animations
  function track(p) { flights++; p.finally(() => { flights--; if (!flights) while (idleWaiters.length) idleWaiters.shift()(); }); return p; }
  function flyBack(fromRect, toRect, faceCard) {
    if (!fromRect || !toRect || reducedMotion()) return;
    const el = faceCard ? createRCard(faceCard, { wildRank: wr() }) : createBack();
    el.classList.add('r-flyer');
    el.style.setProperty('--w', `${fromRect.width}px`);
    el.style.left = `${fromRect.left}px`;
    el.style.top = `${fromRect.top}px`;
    animLayer.append(el);
    track(flyTo(el, toRect, { duration: 480, scale: Math.max(0.3, toRect.width / fromRect.width / 2), fadeOut: true })).then(() => el.remove());
  }
  function animate(p, gv, snap, newDeal) {
    if (newDeal) return runDeal(gv);
    if (p.seq === gv.seq) return;
    const actor = p.turn;
    const mine = actor === me() && seated();
    const openTopEl = $('.r-open-top .card', openBtn);
    const drewOpen = (gv.openCount ?? 0) < (p.openCount ?? 0) && p.openTop && p.openTop !== gv.openTop;
    const drewClosed = (gv.closedCount ?? 0) === (p.closedCount ?? 0) - 1;
    const discarded = (gv.openCount ?? 0) > (p.openCount ?? 0) && gv.openTop && gv.openTop !== p.openTop;
    if (mine) {
      const newCards = hand().filter((c) => !snap.handRects.has(c));
      for (const c of newCards) {
        const el = cardEls.get(c);
        if (el) track(flyFrom(el, gv.justDrew?.from === 'open' || drewOpen ? snap.openRect : snap.deckRect, { duration: 460 }));
      }
      if (discarded && openTopEl && snap.handRects.get(gv.openTop)) track(flyFrom(openTopEl, snap.handRects.get(gv.openTop), { duration: 380 }));
    } else if (actor != null) {
      const fan = snap.fanRects.get(actor);
      if (drewOpen) { flyBack(snap.openRect, fan, p.openTop); pill(actor, `took <b>${esc(rShort(p.openTop))}</b>`); }
      else if (drewClosed) flyBack(snap.deckRect, fan);
      if (discarded && openTopEl && fan) track(flyFrom(openTopEl, fan, { duration: 420, rotateFrom: -20 }));
    }
    const droppedNow = Object.keys(gv.dropped || {}).filter((s) => p.dropped?.[s] == null);
    for (const s of droppedNow) if (Number(s) !== me()) pill(Number(s), `dropped <b>${gv.dropped[s]}</b>`);
  }
  function runDeal(gv) {
    if (reducedMotion()) return;
    const from = $('.r-stack', deckBtn).getBoundingClientRect();
    const targets = [];
    for (const s of gv.active || gv.seats) {
      if (s === me() && seated()) targets.push({ rect: handEl.getBoundingClientRect(), count: 13 });
      else { const f = $(`.r-seat[data-seat="${s}"] .r-fan`, seatsEl); if (f) targets.push({ rect: f.getBoundingClientRect(), count: 13 }); }
    }
    const total = dealFlights(animLayer, from, targets.map((t) => ({ ...t, count: Math.min(6, t.count) })), { stagger: DEAL_STAGGER, duration: DEAL_DUR });
    let k = 0;
    for (const gr of groups) for (const c of gr.cards) {
      const el = cardEls.get(c);
      if (!el) continue;
      el.classList.add('deal-in');
      el.style.setProperty('--dd', `${Math.min(total, 200 + k++ * 40)}ms`);
      el.addEventListener('animationend', () => el.classList.remove('deal-in'), { once: true });
    }
    track(new Promise((r) => setTimeout(r, total)));
    announce(`<b>Deal ${gv.dealNumber}</b><small>${nm(gv.dealer)} deals · ${gv.wildCard ? `${isJoker(gv.wildCard) ? 'Aces' : rankPlural(wr())} are wild` : ''}</small>`);
  }
  let announceTimer = 0;
  function announce(html) {
    const a = q('.announce');
    a.innerHTML = `<div class="ann" style="animation-duration:2400ms">${html}</div>`;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => (a.innerHTML = ''), 2400);
  }

  // -------------------------------------------------------------- sounds (rummy cues; app's 28 cue engine is not used here)
  function cues(p, gv, newDeal) {
    const S = ctx.sounds;
    if (!S || p.seq === gv.seq) return;
    if (newDeal) { S.play('deal', { count: 14 }); return; }
    if ((gv.openCount ?? 0) !== (p.openCount ?? 0) || (gv.closedCount ?? 0) < (p.closedCount ?? 0)) S.play('card');
    const mineNow = myTurn() && acts().length && gv.step === 'draw';
    const wasMine = p.turn === me() && p.phase === 'playing';
    if (mineNow && !wasMine) { setTimeout(() => S.play('turn'), 250); S.vibrate?.(40); }
    if (p.phase !== gv.phase && (gv.phase === 'dealEnd' || gv.phase === 'matchEnd')) {
      setTimeout(() => {
        if (gv.phase === 'matchEnd') return S.play(me() == null || gv.matchWinner === me() ? 'fanfare' : 'lose');
        const r = gv.dealResult;
        if (!r || !seated()) return S.play('trick');
        S.play(r.winner === me() ? 'win' : r.wrongShow && r.declarer !== me() ? 'trick' : 'lose');
      }, 700);
    }
  }

  // -------------------------------------------------------------- deal / match end dialogs
  function modals(first) {
    const gv = g();
    if (gv.phase === 'dealEnd' && gv.dealResult) {
      const key = `${room.code}|${gv.dealNumber}`;
      if (shownDealEnd !== key) {
        shownDealEnd = key;
        closeModal('rummyDeclare', true); closeModal('rummyDrop', true);
        setTimeout(() => whenIdle(() => { if (g()?.phase === 'dealEnd' && g().dealNumber === gv.dealNumber) showDealEnd(room, ctx); }), first ? 0 : 900);
      } else if (isOpen('rummyDealEnd')) refreshDealEndAction();
    } else if (isOpen('rummyDealEnd')) hideDealEnd();
    if (gv.phase === 'matchEnd') {
      const key = `${room.code}|${gv.seq}`;
      if (!shownMatchEnd) {
        shownMatchEnd = key;
        closeModal('rummyDeclare', true); closeModal('rummyDrop', true);
        setTimeout(() => whenIdle(() => { if (g()?.phase === 'matchEnd') { hideDealEnd(); showRummyMatchEnd(room, ctx, history); } }), first ? 0 : 1100);
      }
    } else if (shownMatchEnd) { shownMatchEnd = null; hideRummyMatchEnd(); }
    if (gv.phase !== 'playing') { closeModal('rummyDeclare', true); closeModal('rummyDrop', true); }
  }
  function refreshDealEndAction() { /* the countdown + button are static for the deal; server auto-advances */ }

  function whenIdle(fn) { if (!flights) fn(); else idleWaiters.push(fn); }

  function reset() {
    prev = null;
    handKey = '';
    groups = [];
    selected.clear();
    cardEls.clear(); groupEls.clear();
    handEl.replaceChildren();
    seatsEl.replaceChildren();
    shownDealEnd = null; shownMatchEnd = null;
    hideDealEnd(); hideRummyMatchEnd();
    closeModal('rummyDeclare', true); closeModal('rummyDrop', true);
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

  // re-render once the shared meld module is in (labels/points may differ from the fallback)
  meldsReady.then(() => { if (room?.game) { layoutHand(false); renderHud(); } });

  return {
    render: (r) => { if (r?.game?.gameType && r.game.gameType !== 'rummy') return; render(r); renderClock(r); },
    whenIdle, setUnread, reset, say, react,
    chatVisible: () => !chatDrawer.hidden,
  };
}
