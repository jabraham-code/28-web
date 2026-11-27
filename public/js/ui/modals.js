// Modal dialogs: generic infrastructure, rules/help, hand end, match end.
import { h, esc, teamLabel, seatName, teamOf, SUIT_NAMES } from './util.js';
import { suitIcon } from './cards.js';
import { confetti } from './anim.js';
import { modalTug, leftTeamOf, sideLabel, fmtScore, fmtSigned } from './score.js';

let root;
const open = new Map(); // id -> { el, onClose, prevFocus }

export function openModal(id, { title, body, actions = [], dismissable = true, cls = '', onClose } = {}) {
  root ||= document.getElementById('modal-root');
  closeModal(id, true);
  const titleId = `mt-${id}`;
  const card = h('div', { class: `modal glass ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
  if (dismissable) card.append(h('button', { class: 'modal-x icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => closeModal(id) }, '×'));
  if (title) card.append(h('h2', { class: 'modal-title', id: titleId, html: title }));
  const bodyEl = h('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  card.append(bodyEl);
  if (actions.length) card.append(h('div', { class: 'modal-actions' }, actions));
  const wrap = h('div', { class: 'modal-wrap', dataset: { id } }, h('div', { class: 'modal-scrim', onclick: () => dismissable && closeModal(id) }), card);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); closeModal(id); }
    if (e.key === 'Tab') trapFocus(e, card);
  });
  root.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  open.set(id, { el: wrap, onClose, prevFocus: document.activeElement });
  setTimeout(() => (card.querySelector('[data-autofocus]') || card.querySelector('button:not(.modal-x), [href], input') || card).focus?.({ preventScroll: true }), 30);
  return { wrap, card, body: bodyEl };
}

function trapFocus(e, card) {
  const f = [...card.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function closeModal(id, silent = false) {
  const m = open.get(id);
  if (!m) return;
  open.delete(id);
  m.el.classList.remove('in');
  m.el.classList.add('out');
  setTimeout(() => m.el.remove(), 250);
  if (!silent) m.onClose?.();
  if (m.prevFocus?.isConnected) m.prevFocus.focus?.({ preventScroll: true });
}
export const isOpen = (id) => open.has(id);

// ---------------------------------------------------------------- rules
export function showRules() {
  const body = `
  <div class="rules">
    <section>
      <h3>The deck</h3>
      <p>32 cards &mdash; J 9 A 10 K Q 8 7 in each suit, ranked in that order (Jack highest, then Nine).</p>
      <div class="rules-points">
        <span><b>J</b> 3 pts</span><span><b>9</b> 2 pts</span><span><b>A</b> 1 pt</span><span><b>10</b> 1 pt</span><span><b>K Q 8 7</b> 0</span>
      </div>
      <p class="muted">28 card points in total. Point cards carry a small gold badge.</p>
    </section>
    <section>
      <h3>Teams &amp; turn order</h3>
      <p>Four players, partners sit opposite. Play and dealing go <b>counter-clockwise</b>: the player on your right acts after you. The dealer rotates every hand; the player after the dealer bids first and leads the first trick.</p>
    </section>
    <section>
      <h3>Bidding &mdash; round 1</h3>
      <p>Everyone gets 4 cards. Bids run from <b>14 to 28</b>, each higher than the last. The first bidder must bid (unless they hold no point cards, in which case they may ask for a <b>redeal</b>). There is <b>one round</b> of bidding: each player bids or passes once, ending with the dealer, and the highest bid wins. You can pick your trump card together with your bid, or choose it after you win.</p>
      <p>If your partner holds the high bid and the player before you just passed, you need at least <b>18</b> to overbid them.</p>
      <p>The winner secretly picks a <b>trump card</b> from their hand and lays it face-down. Its suit is trump &mdash; only the bidder knows it.</p>
    </section>
    <section>
      <h3>Bidding &mdash; round 2</h3>
      <p>Four more cards each. One more round of bidding (one turn each) where the only bids allowed are <b>20 (Honors)</b>, <b>24 (Senior)</b> or <b>28 (Full)</b>, higher than the current bid. If someone else wins, the old trump card goes back and the new bidder picks a new one.</p>
      <p class="muted">Anyone dealt all four Jacks causes an automatic redeal.</p>
    </section>
    <section>
      <h3>Playing</h3>
      <p>8 tricks. Follow suit if you can. While trump is hidden, a player who can&rsquo;t follow may discard any card (face up), or <b>call trump</b>: the hidden card is revealed and must then be followed with a trump if possible.</p>
      <p>The bidder can&rsquo;t ruff from hand while trump is hidden &mdash; instead they may <b>reveal trump</b> &mdash; the hidden card goes back into their hand and they choose which trump to play &mdash; or play the concealed card itself. Once trump is revealed, normal trick-taking with trumps applies.</p>
    </section>
    <section>
      <h3>Scoring</h3>
      <table class="rules-table">
        <thead><tr><th>Bid</th><th>Made</th><th>Failed</th></tr></thead>
        <tbody><tr><td>14&ndash;19</td><td>+1</td><td>&minus;2</td></tr><tr><td>20&ndash;24</td><td>+2</td><td>&minus;3</td></tr><tr><td>25&ndash;28</td><td>+3</td><td>&minus;4</td></tr></tbody>
      </table>
      <p>The bidding team needs card points &ge; their bid. Both teams start with <b>5 points</b> (host can change this). Points are <b>exchanged</b>: when the bidders make it they take the points from the other team; when they fail they pay them to the other team. A team that drops <b>below zero</b> loses the match.</p>
    </section>
  </div>`;
  openModal('rules', { title: 'How to play <span class="gold">28</span>', body, cls: 'modal-wide' });
}

// ---------------------------------------------------------------- hand end
/** Perspective of a hand result: { good: true|false|null, headline } */
function handVerdict(room, r) {
  const bt = r.biddingTeam ?? teamOf(r.bidder);
  const seat = room.you.seat;
  if (seat == null) return { good: null, headline: r.made ? 'Contract made' : 'Contract failed' };
  const ours = teamOf(seat) === bt;
  if (ours) return r.made ? { good: true, headline: 'You made it!' } : { good: false, headline: 'Contract failed' };
  return r.made ? { good: false, headline: 'They made it' } : { good: true, headline: 'Opponents set!' };
}
const goodCls = (good) => (good === true ? 'ok' : good === false ? 'bad' : 'neutral');

/** Shared summary of a finished hand: factual line, card-point meter and per-team table. */
function handSummary(room, r, scoresAfter, { trump } = {}) {
  const bt = r.biddingTeam ?? teamOf(r.bidder);
  const L = leftTeamOf(room);
  const before = [scoresAfter[0] - (r.delta[0] || 0), scoresAfter[1] - (r.delta[1] || 0)];
  const fact = `${esc(seatName(room, r.bidder))} bid <b>${r.bid}</b> · took <b>${r.teamPoints[bt]}</b>${trump ? `<span class="he-dot"> · </span><span class="he-trump">${suitIcon(trump)} ${SUIT_NAMES[trump]} trump</span>` : ''}`;
  const row = (t) => {
    const d = r.delta[t] || 0;
    return `
    <div class="he-team t${t}${t === bt ? ' bidding' : ''}">
      <div class="he-name"><span class="team-dot t${t}"></span><span class="he-tname" title="${esc(teamLabel(room, t))}">${esc(sideLabel(room, t))}</span>${t === bt ? '<span class="tag">Bid</span>' : ''}</div>
      <div class="he-pts"><span class="big">${r.teamPoints[t]}</span>${t === bt ? `<span class="muted">/ ${r.bid}</span>` : ''}</div>
      <div class="he-delta ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${fmtSigned(d)}</div>
      <div class="he-score"><span class="he-from">${fmtScore(before[t])}</span><span class="he-arrow" aria-label="to">→</span><b class="${scoresAfter[t] < 0 ? 'bad' : ''}">${fmtScore(scoresAfter[t])}</b></div>
    </div>`;
  };
  const bar = Math.round((Math.min(28, r.teamPoints[bt]) / 28) * 100);
  const need = Math.round((r.bid / 28) * 100);
  return {
    before,
    fact,
    meter: `<div class="he-meter" role="img" aria-label="Bidding team took ${r.teamPoints[bt]} of 28 card points, needed ${r.bid}">
      <div class="he-fill t${bt}" style="width:${bar}%"></div><div class="he-need" style="left:${need}%"><span>${r.bid}</span></div>
    </div>`,
    table: `<div class="he-table" role="table" aria-label="Hand result">
      <div class="he-head" role="row"><span>Team</span><span>Card pts</span><span>Change</span><span>Points</span></div>
      ${row(L)}${row(1 - L)}</div>`,
  };
}

let handEndTimer = null;
export function showHandEnd(room, ctx) {
  const g = room.game;
  const r = g.handResult;
  if (!r) return;
  const seated = room.you.seat != null;
  const v = handVerdict(room, r);
  const sum = handSummary(room, r, g.scores, { trump: g.trump?.suit });
  const body = h('div', { class: 'he-body' });
  body.innerHTML = `
    <div class="he-col he-col-a">
      <p class="he-sub">${sum.fact}</p>
      ${sum.meter}
      <div class="he-tug-slot"></div>
    </div>
    <div class="he-col he-col-b">${sum.table}</div>`;
  body.querySelector('.he-tug-slot').replaceWith(modalTug(room, { from: sum.before, to: g.scores, start: g.targetScore }));
  const nextBtn = h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => ctx.act({ type: 'nextHand' }) }, 'Next hand ', h('span', { class: 'countdown' }));
  const actions = seated ? [nextBtn] : [h('span', { class: 'muted' }, 'Next hand starts shortly ', h('span', { class: 'countdown' }))];
  const { card } = openModal('handEnd', {
    title: `<span class="${goodCls(v.good)}">${v.headline}</span>`,
    body, actions, dismissable: false, cls: `hand-end ${v.good === true ? 'won' : v.good === false ? 'lost' : ''}`,
  });
  let left = 8;
  const cds = card.querySelectorAll('.countdown');
  const tick = () => cds.forEach((c) => (c.textContent = left > 0 ? `(${left})` : ''));
  tick();
  clearInterval(handEndTimer);
  handEndTimer = setInterval(() => { left--; tick(); if (left <= 0) clearInterval(handEndTimer); }, 1000);
}
export function hideHandEnd() { clearInterval(handEndTimer); closeModal('handEnd', true); }

// ---------------------------------------------------------------- match end
const TROPHY = '<svg viewBox="0 0 64 64"><path d="M18 8h28v10c0 10-6 17-14 18-8-1-14-8-14-18V8z" fill="url(#goldG)"/><path d="M18 12H9c0 9 4 14 10 15M46 12h9c0 9-4 14-10 15" fill="none" stroke="#e8c170" stroke-width="3"/><rect x="28" y="36" width="8" height="10" fill="#c8963e"/><rect x="20" y="46" width="24" height="7" rx="2" fill="url(#goldG)"/></svg>';
const DEFEAT_ICON = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="3" opacity=".55"/><path d="M22 41c6-5 14-5 20 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="27" r="2.6" fill="currentColor"/><circle cx="40" cy="27" r="2.6" fill="currentColor"/></svg>';

let stopConfetti = null;
export function showMatchEnd(room, ctx) {
  const g = room.game;
  const w = g.matchWinner;
  const loser = w == null ? null : 1 - w;
  const mine = room.you.seat != null ? teamOf(room.you.seat) : null;
  const victory = mine == null || mine === w;
  const title = mine == null ? `${esc(teamLabel(room, w))} win!` : mine === w ? 'Victory!' : 'Defeat';
  // the deciding hand: prefer the live result, fall back to the history entry
  const last = room.history?.hands?.[room.history.hands.length - 1];
  const r = g.handResult || (last && { bid: last.bid, bidder: last.bidder, biddingTeam: last.bidder % 2, teamPoints: last.teamPoints, made: last.made, delta: last.delta });
  const trump = g.trump?.suit || last?.trump;
  let deciding = '';
  let before = g.scores;
  if (r) {
    const sum = handSummary(room, r, g.scores, { trump });
    before = sum.before;
    const v = handVerdict(room, r);
    deciding = `
      <section class="me-hand" aria-label="Deciding hand">
        <h3 class="eyebrow">Deciding hand${g.handNumber ? ` · Hand ${g.handNumber}` : ''}</h3>
        <p class="he-sub"><b class="${goodCls(v.good)}">${r.made ? 'Made' : 'Failed'}</b> · ${sum.fact}</p>
        ${sum.table}
      </section>`;
  }
  const sub = loser != null
    ? `<span class="t${loser}-text">${esc(teamLabel(room, loser))}</span> dropped below zero (${fmtScore(g.scores[loser])})`
    : '';
  const series = room.history?.matches?.length ? `<p class="me-series">Series: <span class="t0-text">${room.history.series[0]}</span> – <span class="t1-text">${room.history.series[1]}</span> <span class="muted">(${room.history.matches.length} match${room.history.matches.length > 1 ? 'es' : ''})</span></p>` : '';
  const body = h('div', { class: 'me-body' });
  body.innerHTML = `
    <div class="me-col me-col-a">
      <div class="me-icon ${victory ? 'me-trophy' : 'me-defeat'} t${w}" aria-hidden="true">${victory ? TROPHY : DEFEAT_ICON}</div>
      <p class="me-sub">${sub}</p>
      <div class="me-tug-slot"></div>
      ${series}
    </div>
    <div class="me-col me-col-b">${deciding}</div>`;
  body.querySelector('.me-tug-slot').replaceWith(modalTug(room, { from: before, to: g.scores, start: g.targetScore, out: loser, phase: 'matchEnd', delay: 600 }));
  const actions = [];
  if (room.you.isHost) actions.push(h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => ctx.start() }, 'Rematch'));
  else actions.push(h('span', { class: 'muted' }, 'Waiting for the host to start a new match…'));
  actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => showScoreboard(room) }, 'Scoreboard'));
  actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.leave() }, 'Leave room'));
  openModal('matchEnd', { title, body, actions, dismissable: false, cls: `match-end ${victory ? 'victory' : 'defeat'}` });
  stopConfetti?.();
  if (victory) stopConfetti = confetti(document.body);
}
export function hideMatchEnd() { stopConfetti?.(); stopConfetti = null; closeModal('matchEnd', true); }

// ---------------------------------------------------------------- scoreboard
export function showScoreboard(room) {
  const hist = room?.history || { hands: [], matches: [], series: [0, 0] };
  const g = room?.game;
  const seated = room?.you?.seat != null;
  const L = leftTeamOf(room), R = 1 - L;
  const mine = seated ? L : null;
  const team = (t) => `<span class="team-dot t${t}"></span><span class="sb-tname" title="${esc(teamLabel(room, t))}">${esc(sideLabel(room, t))}${seated ? `<small>${esc(teamLabel(room, t))}</small>` : ''}</span>`;
  const series = hist.series || [0, 0];
  const rows = hist.hands.slice().reverse().map((x) => {
    const bt = x.bidder % 2;
    // exchange from the viewer's side (spectators: from the bidders' side)
    const pov = mine ?? bt;
    const d = x.delta[pov] || 0;
    const good = mine == null ? null : d > 0;
    const res = x.made ? 'Made' : 'Failed';
    return `<tr class="${x.made ? 'made' : 'failed'} ${good === true ? 'sb-good' : good === false ? 'sb-bad' : 'sb-neutral'}">
      <td>${x.hand}</td>
      <td><span class="t${bt}-text">${esc(x.bidderName)}</span></td>
      <td><b>${x.bid}</b></td>
      <td>${x.trump ? suitIcon(x.trump) : '–'}</td>
      <td><span class="t${L}-text">${x.teamPoints[L]}</span>–<span class="t${R}-text">${x.teamPoints[R]}</span></td>
      <td><span class="sb-res">${res}</span> <span class="sb-delta" title="${esc(sideLabel(room, pov))} ${fmtSigned(d)}">${fmtSigned(d)}</span></td>
      <td class="sb-score"><span class="t${L}-text">${fmtScore(x.scores[L])}</span> · <span class="t${R}-text">${fmtScore(x.scores[R])}</span></td>
    </tr>`;
  }).join('');
  const matches = hist.matches.map((m, i) => `<li><span>Match ${i + 1}</span><span class="t${m.winner}-text">${esc(sideLabel(room, m.winner))} won</span><span class="muted">${fmtScore(m.scores[L])} – ${fmtScore(m.scores[R])} · ${m.hands} hands</span></li>`).join('');
  const now = g ? `<p class="sb-now muted">This match: <span class="t${L}-text">${esc(sideLabel(room, L))} ${fmtScore(g.scores[L])}</span> · <span class="t${R}-text">${esc(sideLabel(room, R))} ${fmtScore(g.scores[R])}</span> — started at ${g.targetScore} each · below 0 loses</p>` : '';
  const body = `
    <div class="sb">
      <div class="sb-series">
        <div class="sb-side l t${L}">${team(L)}<b>${series[L]}</b></div>
        <div class="sb-vs"><span>Matches won</span>vs</div>
        <div class="sb-side r t${R}"><b>${series[R]}</b>${team(R)}</div>
      </div>
      ${now}
      ${rows ? `<div class="sb-table-wrap"><table class="sb-table">
        <thead><tr><th>#</th><th>Bidder</th><th>Bid</th><th>Trump</th><th>Card pts</th><th>Result</th><th>Points after</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="muted sb-empty">No hands finished yet in this match.</p>'}
      ${matches ? `<h3 class="eyebrow sb-prev">Previous matches</h3><ul class="sb-matches">${matches}</ul>` : ''}
    </div>`;
  openModal('scoreboard', { title: 'Scoreboard', body, cls: 'scoreboard', actions: [h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => closeModal('scoreboard') }, 'Close')] });
}
