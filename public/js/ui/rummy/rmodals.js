// Rummy dialogs: declare / drop confirmations, deal end, match end, pool scoreboard, rules.
import { h, esc, seatName, initials } from '../util.js';
import { openModal, closeModal, isOpen } from '../modals.js';
import { confetti } from '../anim.js';
import { createRCard, rShort, rankPlural, wildRankOf, isJoker } from './rcards.js';
import { classifyGroup, bestArrangement } from './melds.js';

export const GROUP_LABEL = { pure: 'Pure sequence', impure: 'Sequence', set: 'Set' };
export const GROUP_SHORT = { pure: 'Pure', impure: 'Seq', set: 'Set' };
const TROPHY = '<svg viewBox="0 0 64 64"><path d="M18 8h28v10c0 10-6 17-14 18-8-1-14-8-14-18V8z" fill="url(#goldG)"/><path d="M18 12H9c0 9 4 14 10 15M46 12h9c0 9-4 14-10 15" fill="none" stroke="#e8c170" stroke-width="3"/><rect x="28" y="36" width="8" height="10" fill="#c8963e"/><rect x="20" y="46" width="24" height="7" rx="2" fill="url(#goldG)"/></svg>';

const shortName = (room, seat) => (seat === room.you.seat ? 'You' : seatName(room, seat));
const pctOf = (v, lim) => Math.max(0, Math.min(100, (v / lim) * 100));

/** Mini cards of one meld group with its label. */
function miniGroup(cards, type, wildRank, { dead = false } = {}) {
  const t = dead ? 'dead' : type || classifyGroup(cards, wildRank) || 'invalid';
  const label = dead ? 'Deadwood' : GROUP_LABEL[t] || 'Invalid';
  const el = h('div', { class: `rm-group rg-${t}` },
    h('span', { class: 'rm-glabel' }, label + (t !== 'dead' && t !== 'invalid' ? ' ✓' : '')),
    h('div', { class: 'rm-gcards' }, cards.map((c) => createRCard(c, { wildRank, mini: true }))));
  return el;
}
export function arrangementEl(arr, wildRank) {
  const wrap = h('div', { class: 'rm-arr' });
  for (const g of arr.groups || []) wrap.append(miniGroup(g.cards, g.type, wildRank));
  if (arr.deadwood?.length) wrap.append(miniGroup(arr.deadwood, null, wildRank, { dead: true }));
  return wrap;
}

// ---------------------------------------------------------------- declare
/** Confirmation sheet before declaring: auto-arrangement preview of the other 13 cards. */
export function confirmDeclare({ hand, card, wildRank, choices, onPick, onConfirm }) {
  const rest = hand.filter((c) => c !== card);
  const arr = bestArrangement(rest, wildRank);
  const valid = !!arr.valid;
  const body = h('div', { class: `rm-declare ${valid ? 'is-valid' : 'is-invalid'}` });
  const fin = h('div', { class: 'rm-finish' },
    h('div', { class: 'rm-finish-card' }, createRCard(card, { wildRank })),
    h('div', { class: 'rm-finish-text', html: `<span class="eyebrow">Finishing card</span><b>${esc(rShort(card))}</b><span class="muted">goes face down; the other 13 are shown</span>` }));
  body.append(fin);
  if (choices?.length > 1) {
    const pick = h('div', { class: 'rm-pick', role: 'group', 'aria-label': 'Choose a different finishing card' },
      h('span', { class: 'muted rm-pick-label' }, 'Change:'),
      choices.map((c) => { const b = createRCard(c, { wildRank, button: true, mini: true }); b.classList.toggle('on', c === card); b.addEventListener('click', () => onPick(c)); return b; }));
    body.append(pick);
  }
  body.append(h('div', { class: `rm-verdict ${valid ? 'ok' : 'bad'}`, role: 'status', html: valid
    ? '<b>Valid show ✓</b><span>Two or more sequences including a pure one, every card melded.</span>'
    : `<b>Not a valid show</b><span>${esc(whyInvalid(arr))} Declaring now is a <b>wrong show: 80 points</b>.</span>` }));
  body.append(h('h3', { class: 'eyebrow rm-sub' }, 'How your cards will be shown'));
  body.append(arrangementEl(arr, wildRank));
  const { card: modal } = openModal('rummyDeclare', {
    title: valid ? 'Declare?' : '<span class="bad">Wrong show?</span>',
    body,
    cls: `rm-declare-modal${valid ? '' : ' danger'}`,
    actions: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => closeModal('rummyDeclare'), ...(valid ? {} : { 'data-autofocus': '' }) }, 'Cancel'),
      h('button', { class: `btn ${valid ? 'btn-gold' : 'btn-danger'}`, type: 'button', ...(valid ? { 'data-autofocus': '' } : {}), onclick: () => { closeModal('rummyDeclare'); onConfirm(card); } }, valid ? 'Declare' : 'Declare anyway (80 pts)'),
    ],
  });
  return modal;
}
function whyInvalid(arr) {
  const pure = (arr.groups || []).filter((g) => g.type === 'pure').length;
  const seqs = (arr.groups || []).filter((g) => g.type !== 'set').length;
  if (!pure) return 'You need a pure sequence (no jokers).';
  if (seqs < 2) return 'You need a second sequence.';
  if (arr.deadwood?.length) return `${arr.deadwood.length} card${arr.deadwood.length > 1 ? 's are' : ' is'} not in a meld.`;
  return 'Your melds do not meet the rules.';
}

// ---------------------------------------------------------------- drop
export function confirmDrop({ points, poolLimit, score, onConfirm }) {
  const after = score + points;
  const out = after >= poolLimit;
  const body = h('div', { class: 'rm-drop', html: `
    <p class="rm-drop-big"><b>${points}</b><span>points</span></p>
    <p>${points === 20 ? 'First drop — you have not drawn a card this deal.' : 'Middle drop — you have already drawn this deal.'} You sit out the rest of this deal.</p>
    <div class="rm-bar ${out ? 'over' : after >= poolLimit * 0.8 ? 'danger' : ''}" role="img" aria-label="Score ${score} → ${after} of ${poolLimit}">
      <i class="rm-bar-was" style="width:${pctOf(score, poolLimit)}%"></i><i class="rm-bar-add" style="left:${pctOf(score, poolLimit)}%;width:${pctOf(after, poolLimit) - pctOf(score, poolLimit)}%"></i>
    </div>
    <p class="muted rm-drop-score">Your score: ${score} → <b class="${out ? 'bad' : ''}">${after}</b> / ${poolLimit}${out ? ' — you would be eliminated' : ''}</p>` });
  openModal('rummyDrop', {
    title: 'Drop this deal?', body, cls: 'rm-drop-modal',
    actions: [
      h('button', { class: 'btn btn-ghost', type: 'button', 'data-autofocus': '', onclick: () => closeModal('rummyDrop') }, 'Keep playing'),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { closeModal('rummyDrop'); onConfirm(); } }, `Drop (${points} pts)`),
    ],
  });
}

// ---------------------------------------------------------------- deal results (shared by deal end + match end)
function resultsEl(room, g, { compact = false } = {}) {
  const r = g.dealResult;
  const wr = g.wildRank || wildRankOf(g.wildCard);
  const lim = g.poolLimit || 101;
  const order = [...g.seats].filter((s) => r.points?.[s] != null || r.hands?.[s] || g.dropped?.[s] != null)
    .sort((a, b) => {
      const lead = (x) => (x === r.winner ? 0 : x === r.declarer ? 1 : x === room.you.seat ? 2 : 3);
      return lead(a) - lead(b) || (r.points[a] ?? 0) - (r.points[b] ?? 0);
    });
  const list = h('div', { class: `rm-results${compact ? ' compact' : ''}` });
  for (const s of order) {
    const pts = r.points?.[s] ?? 0;
    const total = g.scores?.[s] ?? 0;
    const out = (g.eliminated || []).includes(s);
    const tags = [];
    if (s === r.winner) tags.push('<span class="tag tag-win">Winner</span>');
    if (s === r.declarer) tags.push(r.valid ? '<span class="tag tag-you">Declared</span>' : '<span class="tag tag-off">Wrong show</span>');
    if (g.dropped?.[s] != null) tags.push(`<span class="tag">Dropped</span>`);
    if (out) tags.push('<span class="tag tag-off">Eliminated</span>');
    const row = h('div', { class: `rm-row pc${s % 6}${s === room.you.seat ? ' mine' : ''}${s === r.winner ? ' winner' : ''}${out ? ' out' : ''}` });
    row.innerHTML = `
      <div class="rm-who">
        <span class="avatar avatar-sm pc${s % 6}">${esc(initials(seatName(room, s)))}</span>
        <span class="rm-name">${esc(shortName(room, s))}</span>${tags.join('')}
      </div>
      <div class="rm-pts"><b class="${pts ? '' : 'zero'}">${pts ? `+${pts}` : '0'}</b></div>
      <div class="rm-total">
        <div class="rm-bar ${out ? 'over' : total >= lim * 0.8 ? 'danger' : ''}" role="img" aria-label="${total} of ${lim}">
          <i class="rm-bar-was" style="width:${pctOf(total - pts, lim)}%"></i><i class="rm-bar-add" style="left:${pctOf(total - pts, lim)}%;width:${pctOf(total, lim) - pctOf(total - pts, lim)}%"></i>
        </div>
        <span class="rm-tot"><b>${total}</b><span class="muted">/${lim}</span></span>
      </div>`;
    const hand = r.hands?.[s];
    if (hand && ((hand.groups || []).length || (hand.deadwood || []).length)) {
      row.append(arrangementEl(hand, wr));
    } else if (g.dropped?.[s] != null) row.append(h('p', { class: 'rm-note muted' }, `Dropped — ${g.dropped[s]} points`));
    list.append(row);
  }
  return list;
}

function dealHeadline(room, g) {
  const r = g.dealResult;
  const me = room.you.seat;
  if (r.wrongShow) {
    return r.declarer === me ? { cls: 'bad', text: 'Wrong show!', sub: 'Your declaration was not valid — 80 points.' }
      : { cls: 'neutral', text: `${esc(seatName(room, r.declarer))}: wrong show`, sub: `Invalid declaration — 80 points to ${esc(seatName(room, r.declarer))}. Everyone else scores 0.` };
  }
  if (r.declarer == null) return r.winner === me ? { cls: 'ok', text: 'You win the deal!', sub: 'Everyone else dropped.' } : { cls: 'neutral', text: `${esc(seatName(room, r.winner))} wins the deal`, sub: 'Everyone else dropped.' };
  if (r.winner === me) return { cls: 'ok', text: 'You declared!', sub: 'Valid show — you score 0 this deal.' };
  return { cls: 'neutral', text: `${esc(seatName(room, r.winner))} declared`, sub: me != null && r.points?.[me] != null ? `You score <b>${r.points[me]}</b> this deal.` : 'Valid show.' };
}

let dealTimer = null;
export function showDealEnd(room, ctx) {
  const g = room.game;
  if (!g?.dealResult) return;
  const hd = dealHeadline(room, g);
  const body = h('div', { class: 'rm-dealend' });
  body.append(h('p', { class: 'he-sub', html: `${hd.sub} <span class="muted">· Deal ${g.dealNumber} · Pool ${g.poolLimit}</span>` }));
  body.append(resultsEl(room, g));
  const canNext = (g.legal?.actions || []).includes('nextDeal');
  const actions = canNext
    ? [h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => ctx.act({ type: 'nextDeal' }) }, 'Next deal ', h('span', { class: 'countdown' }))]
    : [h('span', { class: 'muted' }, 'Next deal starts shortly ', h('span', { class: 'countdown' }))];
  const { card } = openModal('rummyDealEnd', { title: `<span class="${hd.cls}">${hd.text}</span>`, body, actions, dismissable: false, cls: `hand-end rm-dealend-modal ${hd.cls === 'ok' ? 'won' : hd.cls === 'bad' ? 'lost' : ''}` });
  let left = 8;
  const cds = card.querySelectorAll('.countdown');
  const tick = () => cds.forEach((c) => (c.textContent = left > 0 ? `(${left})` : ''));
  tick();
  clearInterval(dealTimer);
  dealTimer = setInterval(() => { left--; tick(); if (left <= 0) clearInterval(dealTimer); }, 1000);
}
export function hideDealEnd() { clearInterval(dealTimer); closeModal('rummyDealEnd', true); }

let stopConfetti = null;
export function showRummyMatchEnd(room, ctx, history) {
  const g = room.game;
  const w = g.matchWinner;
  const me = room.you.seat;
  const victory = me == null ? true : w === me;
  const title = me == null ? `${esc(seatName(room, w))} wins!` : victory ? 'Victory!' : `${esc(seatName(room, w))} wins`;
  const lim = g.poolLimit || 101;
  const standings = [...g.seats].sort((a, b) => (a === w ? -1 : b === w ? 1 : (g.scores[a] ?? 0) - (g.scores[b] ?? 0)));
  const body = h('div', { class: 'me-body rm-matchend' });
  body.innerHTML = `
    <div class="me-col me-col-a">
      <div class="me-icon ${victory ? 'me-trophy' : 'me-defeat'}" aria-hidden="true">${victory ? TROPHY : '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="3" opacity=".55"/><path d="M22 41c6-5 14-5 20 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="27" r="2.6" fill="currentColor"/><circle cx="40" cy="27" r="2.6" fill="currentColor"/></svg>'}</div>
      <p class="me-sub">Last player under <b>${lim}</b> after ${g.dealNumber} deal${g.dealNumber > 1 ? 's' : ''}</p>
      <ol class="rm-standings">
        ${standings.map((s, i) => {
          const out = (g.eliminated || []).includes(s) && s !== w;
          return `<li class="pc${s % 6}${s === w ? ' winner' : ''}${s === me ? ' mine' : ''}${out ? ' out' : ''}">
            <span class="rm-rank">${s === w ? '🏆' : i + 1}</span>
            <span class="avatar avatar-sm pc${s % 6}">${esc(initials(seatName(room, s)))}</span>
            <span class="rm-name">${esc(shortName(room, s))}</span>
            ${out ? '<span class="tag tag-off">Out</span>' : ''}
            <span class="rm-bar ${out ? 'over' : (g.scores[s] ?? 0) >= lim * 0.8 ? 'danger' : ''}"><i class="rm-bar-was" style="width:${pctOf(g.scores[s] ?? 0, lim)}%"></i></span>
            <b>${g.scores[s] ?? 0}</b>
          </li>`;
        }).join('')}
      </ol>
    </div>
    <div class="me-col me-col-b"></div>`;
  if (g.dealResult) {
    const sec = h('details', { class: 'me-hand rm-final' }, h('summary', { class: 'eyebrow' }, `Final deal · Deal ${g.dealNumber}`), resultsEl(room, g, { compact: true }));
    body.querySelector('.me-col-b').append(sec);
  }
  const actions = [];
  if (room.you.isHost) actions.push(h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => (ctx.start ? ctx.start() : ctx.call('start')) }, 'Rematch'));
  else actions.push(h('span', { class: 'muted' }, 'Waiting for the host to start a new match…'));
  actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => showRummyScoreboard(room, history) }, 'Scoreboard'));
  actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.leave() }, 'Leave room'));
  openModal('rummyMatchEnd', { title, body, actions, dismissable: false, cls: `match-end rm-matchend-modal ${victory ? 'victory' : 'defeat'}` });
  stopConfetti?.();
  if (victory) stopConfetti = confetti(document.body);
}
export function hideRummyMatchEnd() { stopConfetti?.(); stopConfetti = null; closeModal('rummyMatchEnd', true); }
export const rummyModalOpen = (id) => isOpen(id);

// ---------------------------------------------------------------- scoreboard
/** history: [{ deal, points: {seat: n}, totals: {seat: n}, winner, declarer, wrongShow }] (client-collected or room.history) */
export function showRummyScoreboard(room, history = []) {
  const g = room?.game;
  if (!g) return;
  const seats = g.seats;
  const lim = g.poolLimit || 101;
  const deals = (room.history?.hands?.length && room.history.hands[0]?.points ? room.history.hands : history) || [];
  const head = seats.map((s) => `<th class="pc${s % 6}${s === room.you.seat ? ' mine' : ''}" title="${esc(seatName(room, s))}">${esc(shortName(room, s))}</th>`).join('');
  const rows = deals.map((d) => `<tr><td>${d.deal ?? d.dealNumber ?? ''}</td>${seats.map((s) => {
    const p = d.points?.[s];
    const cls = s === d.winner ? 'sb-good' : d.wrongShow && s === d.declarer ? 'sb-bad' : '';
    return `<td class="${cls}">${p == null ? '<span class="muted">–</span>' : s === d.winner ? `<b>0</b>${d.declarer === s ? ' <span class="rm-star" title="Declared">★</span>' : ''}` : p}</td>`;
  }).join('')}</tr>`).join('');
  const totals = seats.map((s) => {
    const t = g.scores?.[s] ?? 0;
    const out = (g.eliminated || []).includes(s);
    return `<td class="${out ? 'sb-bad' : t >= lim * 0.8 ? 'rm-danger' : ''}"><b>${t}</b>${out ? ' <span class="tag tag-off">Out</span>' : ''}</td>`;
  }).join('');
  const body = `
    <div class="sb rm-sb">
      <p class="sb-now muted">Pool ${lim} · reach ${lim} and you are out · last player standing wins</p>
      <div class="sb-table-wrap"><table class="sb-table rm-sb-table">
        <thead><tr><th>Deal</th>${head}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${seats.length + 1}" class="muted sb-empty">No deals finished yet.</td></tr>`}</tbody>
        <tfoot><tr><th>Total</th>${totals}</tr></tfoot>
      </table></div>
    </div>`;
  openModal('scoreboard', { title: 'Scoreboard', body, cls: 'scoreboard', actions: [h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => closeModal('scoreboard') }, 'Close')] });
}

// ---------------------------------------------------------------- rules
export function showRummyRules() {
  const body = `
  <div class="rules">
    <section><h3>The game</h3><p>13-card Indian Rummy, Pool format. 2–6 players, two decks plus 2 printed jokers. Arrange your 13 cards into <b>sequences</b> and <b>sets</b>, then declare.</p></section>
    <section><h3>Your turn</h3><p><b>Draw</b> one card from the closed deck or the open pile, then <b>discard</b> one card to the open pile. You can't discard the card you just took from the open pile.</p></section>
    <section><h3>Melds</h3><p><b>Sequence</b>: 3+ consecutive cards of one suit (A-2-3 or Q-K-A, no K-A-2). <b>Pure sequence</b>: no jokers. <b>Set</b>: 3 or 4 cards of one rank, all different suits.</p></section>
    <section><h3>Jokers</h3><p>The card turned up under the deck is the <b>wild joker</b>: every card of that rank is wild (Aces when it is a printed joker). Printed jokers are always wild. Jokers fill gaps in impure sequences and sets.</p></section>
    <section><h3>Declaring</h3><p>Pick a finishing card and declare. You need <b>at least two sequences, one of them pure</b>, and every other card in a meld. A wrong show costs <b>80 points</b>.</p></section>
    <section><h3>Scoring</h3><div class="rules-points"><span><b>A K Q J 10</b> 10 pts</span><span><b>2–9</b> face value</span><span><b>Jokers</b> 0</span></div><p>Losers score their unmelded cards (max 80). Drop before drawing: <b>20</b>; after drawing: <b>40</b>. Reach the pool limit (101 or 201) and you are out — last player standing wins.</p></section>
    <section><h3>Controls</h3><p>Tap cards to select them, then <b>Group</b> them or tap a group's label to move them there. Drag cards between groups. Tap a selected card again to discard it. Group labels check your melds live.</p></section>
  </div>`;
  openModal('rules', { title: 'How to play <span class="gold">Rummy</span>', body, cls: 'modal-wide' });
}

export { rankPlural, isJoker };
