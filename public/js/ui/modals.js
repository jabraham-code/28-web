// Modal dialogs: generic infrastructure, rules/help, hand end, match end.
import { h, esc, teamLabel, seatName, teamOf, SUIT_NAMES } from './util.js';
import { suitIcon } from './cards.js';
import { confetti } from './anim.js';

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
  setTimeout(() => (card.querySelector('[data-autofocus]') || card.querySelector('button:not(.modal-x), [href], input') || card).focus?.(), 30);
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
  if (m.prevFocus?.isConnected) m.prevFocus.focus?.();
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
      <p>Everyone gets 4 cards. Bids run from <b>14 to 28</b>, each higher than the last. The first bidder must bid (unless they hold no point cards, in which case they may ask for a <b>redeal</b>). You may pass and bid again later. Bidding ends after three passes in a row.</p>
      <p>If your partner holds the high bid and the player before you just passed, you need at least <b>20</b> to overbid them.</p>
      <p>The winner secretly picks a <b>trump card</b> from their hand and lays it face-down. Its suit is trump &mdash; only the bidder knows it.</p>
    </section>
    <section>
      <h3>Bidding &mdash; round 2</h3>
      <p>Four more cards each. One more auction with a minimum of <b>24</b> (or current bid + 1). If someone else wins, the old trump card goes back and the new bidder picks a new one.</p>
      <p class="muted">Anyone dealt all four Jacks causes an automatic redeal.</p>
    </section>
    <section>
      <h3>Playing</h3>
      <p>8 tricks. Follow suit if you can. While trump is hidden, a player who can&rsquo;t follow may discard any card (face up), or <b>call trump</b>: the hidden card is revealed and must then be followed with a trump if possible.</p>
      <p>The bidder can&rsquo;t ruff from hand while trump is hidden &mdash; instead they may <b>play the concealed trump card</b> itself, revealing trump. Once trump is revealed, normal trick-taking with trumps applies.</p>
    </section>
    <section>
      <h3>Scoring</h3>
      <table class="rules-table">
        <thead><tr><th>Bid</th><th>Made</th><th>Failed</th></tr></thead>
        <tbody><tr><td>14&ndash;19</td><td>+1</td><td>&minus;2</td></tr><tr><td>20&ndash;24</td><td>+2</td><td>&minus;3</td></tr><tr><td>25&ndash;28</td><td>+3</td><td>&minus;4</td></tr></tbody>
      </table>
      <p>The bidding team needs card points &ge; their bid. First team to reach the target score wins; a team falling to minus the target loses.</p>
    </section>
  </div>`;
  openModal('rules', { title: 'How to play <span class="gold">28</span>', body, cls: 'modal-wide' });
}

// ---------------------------------------------------------------- hand end
let handEndTimer = null;
export function showHandEnd(room, ctx) {
  const g = room.game;
  const r = g.handResult;
  if (!r) return;
  const bt = r.biddingTeam ?? teamOf(r.bidder);
  const seated = room.you.seat != null;
  const won = seated && teamOf(room.you.seat) === bt ? r.made : seated ? !r.made : null;
  const headline = r.made ? 'Contract made' : 'Contract failed';
  const sub = `${esc(seatName(room, r.bidder))} bid <b>${r.bid}</b>${g.trump?.suit ? ` with ${suitIcon(g.trump.suit)} ${SUIT_NAMES[g.trump.suit]} as trump` : ''}`;
  const row = (t) => `
    <div class="he-team t${t}${t === bt ? ' bidding' : ''}">
      <div class="he-name"><span class="team-dot t${t}"></span>${esc(teamLabel(room, t))}${t === bt ? '<span class="tag">Bidders</span>' : ''}</div>
      <div class="he-pts"><span class="big">${r.teamPoints[t]}</span><span class="muted">card pts</span></div>
      <div class="he-delta ${r.delta[t] > 0 ? 'pos' : r.delta[t] < 0 ? 'neg' : ''}">${r.delta[t] > 0 ? '+' : ''}${r.delta[t] || 0}</div>
      <div class="he-score"><span class="big">${g.scores[t]}</span><span class="muted">/ ${g.targetScore}</span></div>
    </div>`;
  const bar = Math.round((r.teamPoints[bt] / 28) * 100);
  const need = Math.round((r.bid / 28) * 100);
  const body = `
    <p class="he-sub">${sub}</p>
    <div class="he-meter" aria-label="Bidding team took ${r.teamPoints[bt]} of 28 points, needed ${r.bid}">
      <div class="he-fill t${bt}" style="width:${bar}%"></div><div class="he-need" style="left:${need}%"><span>${r.bid}</span></div>
    </div>
    <div class="he-head"><span></span><span>Points</span><span>Game</span><span>Score</span></div>
    ${row(0)}${row(1)}`;
  const nextBtn = h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => ctx.act({ type: 'nextHand' }) }, 'Next hand ', h('span', { class: 'countdown' }));
  const actions = seated ? [nextBtn] : [h('span', { class: 'muted' }, 'Next hand starts shortly ', h('span', { class: 'countdown' }))];
  const { card } = openModal('handEnd', {
    title: `<span class="${r.made ? 'ok' : 'bad'}">${headline}</span>`,
    body, actions, dismissable: false, cls: `hand-end ${won === true ? 'won' : won === false ? 'lost' : ''}`,
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
let stopConfetti = null;
export function showMatchEnd(room, ctx) {
  const g = room.game;
  const w = g.matchWinner;
  const mine = room.you.seat != null ? teamOf(room.you.seat) : null;
  const title = mine == null ? `${esc(teamLabel(room, w))} win!` : mine === w ? 'Victory!' : 'Defeat';
  const body = `
    <div class="me-trophy t${w}" aria-hidden="true">
      <svg viewBox="0 0 64 64"><path d="M18 8h28v10c0 10-6 17-14 18-8-1-14-8-14-18V8z" fill="url(#goldG)"/><path d="M18 12H9c0 9 4 14 10 15M46 12h9c0 9-4 14-10 15" fill="none" stroke="#e8c170" stroke-width="3"/><rect x="28" y="36" width="8" height="10" fill="#c8963e"/><rect x="20" y="46" width="24" height="7" rx="2" fill="url(#goldG)"/></svg>
    </div>
    <p class="me-sub"><span class="t${w}-text">${esc(teamLabel(room, w))}</span> win the match</p>
    <div class="me-scores">
      <div class="t0"><span class="team-dot t0"></span>${esc(teamLabel(room, 0))}<b>${g.scores[0]}</b></div>
      <div class="t1"><span class="team-dot t1"></span>${esc(teamLabel(room, 1))}<b>${g.scores[1]}</b></div>
    </div>
    ${room.history?.matches?.length ? `<p class="me-series">Series: <span class="t0-text">${room.history.series[0]}</span> – <span class="t1-text">${room.history.series[1]}</span> <span class="muted">(${room.history.matches.length} match${room.history.matches.length > 1 ? 'es' : ''})</span></p>` : ''}`;
  const actions = [];
  if (room.you.isHost) actions.push(h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => ctx.start() }, 'Rematch'));
  else actions.push(h('span', { class: 'muted' }, 'Waiting for the host to start a new match…'));
  actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => showScoreboard(room) }, 'Scoreboard'));
  actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.leave() }, 'Leave room'));
  openModal('matchEnd', { title, body, actions, dismissable: false, cls: 'match-end' });
  stopConfetti?.();
  if (mine == null || mine === w) stopConfetti = confetti(document.body);
}
export function hideMatchEnd() { stopConfetti?.(); stopConfetti = null; closeModal('matchEnd', true); }

// ---------------------------------------------------------------- scoreboard
export function showScoreboard(room) {
  const hist = room?.history || { hands: [], matches: [], series: [0, 0] };
  const g = room?.game;
  const team = (t) => `<span class="team-dot t${t}"></span>${esc(teamLabel(room, t))}`;
  const series = hist.series || [0, 0];
  const rows = hist.hands.slice().reverse().map((x) => {
    const bt = x.bidder % 2;
    const d = x.delta[bt];
    return `<tr class="${x.made ? 'made' : 'failed'}">
      <td>${x.hand}</td>
      <td><span class="t${bt}-text">${esc(x.bidderName)}</span></td>
      <td><b>${x.bid}</b></td>
      <td>${x.trump ? suitIcon(x.trump) : '–'}</td>
      <td><span class="t0-text">${x.teamPoints[0]}</span>–<span class="t1-text">${x.teamPoints[1]}</span></td>
      <td><span class="sb-res">${x.made ? 'Made' : 'Failed'}</span> <span class="sb-delta ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${d}</span></td>
      <td class="sb-score"><span class="t0-text">${x.scores[0]}</span> · <span class="t1-text">${x.scores[1]}</span></td>
    </tr>`;
  }).join('');
  const matches = hist.matches.map((m, i) => `<li><span>Match ${i + 1}</span><span class="t${m.winner}-text">${esc(teamLabel(room, m.winner))} won</span><span class="muted">${m.scores[0]} – ${m.scores[1]} · ${m.hands} hands</span></li>`).join('');
  const body = `
    <div class="sb">
      <div class="sb-series">
        <div class="t0">${team(0)}<b>${series[0]}</b></div>
        <div class="sb-vs"><span>Matches won</span>vs</div>
        <div class="t1"><b>${series[1]}</b>${team(1)}</div>
      </div>
      ${g ? `<p class="sb-now muted">This match: <span class="t0-text">${g.scores[0]}</span> – <span class="t1-text">${g.scores[1]}</span> · first to ±${g.targetScore}</p>` : ''}
      ${rows ? `<div class="sb-table-wrap"><table class="sb-table">
        <thead><tr><th>#</th><th>Bidder</th><th>Bid</th><th>Trump</th><th>Points</th><th>Result</th><th>Score</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="muted sb-empty">No hands finished yet in this match.</p>'}
      ${matches ? `<h3 class="eyebrow">Previous matches</h3><ul class="sb-matches">${matches}</ul>` : ''}
    </div>`;
  openModal('scoreboard', { title: 'Scoreboard', body, cls: 'scoreboard', actions: [h('button', { class: 'btn btn-gold', type: 'button', 'data-autofocus': '', onclick: () => closeModal('scoreboard') }, 'Close')] });
}
