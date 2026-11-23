// Bidding panel + choose-trump panel (rendered in the centre of the felt).
import { h, esc, seatName, teamOf, partnerOf, SUIT_NAMES, suitOf } from './util.js';
import { createCard, suitIcon } from './cards.js';

export function renderBidding(panel, room, ctx) {
  const g = room.game;
  const me = room.you.seat;
  const myTurn = me != null && g.turn === me;
  const acts = myTurn ? g.legal?.actions || [] : [];
  const b = g.bidding || { round: 1, history: [] };
  let key = '';
  if (g.phase === 'bidding1' || g.phase === 'bidding2') key = `bid|${g.seq}|${myTurn}|${acts.join(',')}|${g.legal?.minBid}`;
  else if (g.phase === 'chooseTrump') key = `ct|${g.seq}|${myTurn}|${(g.legal?.trumpChoices || []).join(',')}`;
  if (panel.dataset.key === key) return;
  panel.dataset.key = key;
  if (!key) { panel.hidden = true; panel.replaceChildren(); return; }
  panel.hidden = false;
  panel.className = `bid-panel glass ${myTurn ? 'my-turn' : 'waiting'} round-${b.round}`;

  if (g.phase === 'chooseTrump') {
    const bidder = g.turn;
    if (myTurn && acts.includes('chooseTrump')) {
      const cards = h('div', { class: 'trump-choices', role: 'group', 'aria-label': 'Choose your trump card' });
      for (const c of g.legal.trumpChoices) {
        const el = createCard(c, { button: true });
        el.classList.add('choice');
        el.title = `${SUIT_NAMES[suitOf(c)]} as trump`;
        el.addEventListener('click', () => ctx.act({ type: 'chooseTrump', card: c }));
        cards.append(el);
      }
      panel.replaceChildren(
        h('div', { class: 'bp-head' }, h('span', { class: 'bp-round' }, `You won the bid at ${g.bidding?.currentBid ?? g.contract?.bid ?? ''}`)),
        h('h3', { class: 'bp-title' }, 'Choose your trump card'),
        h('p', { class: 'bp-sub muted' }, 'It is placed face-down. Its suit becomes trump — only you know it.'),
        cards,
      );
    } else {
      panel.replaceChildren(
        h('div', { class: 'bp-head' }, h('span', { class: 'bp-round' }, 'Trump selection')),
        h('p', { class: 'bp-wait', html: `<span class="t${teamOf(bidder)}-text">${esc(seatName(room, bidder))}</span> is choosing a trump card<span class="dots"></span>` }),
      );
    }
    return;
  }

  // ---- bidding
  const round = b.round || (g.phase === 'bidding2' ? 2 : 1);
  const head = h('div', { class: 'bp-head' },
    h('span', { class: `bp-round r${round}` }, round === 1 ? 'Bidding · Round 1' : 'Bidding · Round 2'),
    h('span', { class: 'bp-min muted' }, round === 1 ? 'min 14' : 'min 24'),
  );
  const cur = h('div', { class: 'bp-current' });
  if (b.currentBid != null) {
    cur.innerHTML = `<span class="bp-bid">${b.currentBid}</span><span class="bp-by">by <span class="t${teamOf(b.bidder)}-text">${esc(seatName(room, b.bidder))}</span>${b.bidder === me ? ' (you)' : ''}</span>`;
  } else cur.innerHTML = '<span class="bp-none muted">No bids yet</span>';

  const hist = h('ol', { class: 'bp-history', 'aria-label': 'Bid history' });
  for (const e of b.history || []) {
    hist.append(h('li', { class: `chip t${teamOf(e.seat)} ${e.bid == null ? 'pass' : 'bid'} r${e.round}`, title: `Round ${e.round}`, html: `<span class="chip-name">${esc(seatName(room, e.seat))}</span><b>${e.bid == null ? 'Pass' : e.bid}</b>` }));
  }
  const children = [head, cur];
  if ((b.history || []).length) children.push(hist);

  if (myTurn) {
    const min = g.legal.minBid, max = g.legal.maxBid || 28;
    const grid = h('div', { class: 'bid-grid', role: 'group', 'aria-label': 'Choose a bid' });
    if (acts.includes('bid') && min != null) {
      for (let v = min; v <= max; v++) {
        grid.append(h('button', { class: `bid-btn${v >= 20 ? ' hi' : ''}${v >= 25 ? ' top' : ''}`, type: 'button', onclick: () => ctx.act({ type: 'bid', value: v }) }, String(v)));
      }
    }
    const row = h('div', { class: 'bp-actions' });
    if (acts.includes('pass')) row.append(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.act({ type: 'pass' }) }, 'Pass'));
    if (acts.includes('redeal')) row.append(h('button', { class: 'btn btn-ghost', type: 'button', title: 'You hold no point cards', onclick: () => ctx.act({ type: 'redeal' }) }, 'Redeal'));
    let hint = '';
    if (round === 1 && !acts.includes('pass') && acts.includes('bid')) hint = 'You open the bidding and must bid.';
    if (acts.includes('redeal')) hint = 'No point cards — you may ask for a redeal.';
    if (round === 1 && b.bidder != null && b.bidder === partnerOf(me) && min >= 20 && b.currentBid < 19) hint = 'Partner holds the bid — you need 20+ to overbid.';
    if (round === 2) hint = b.bidder === me ? 'Raise your own contract, or pass.' : 'Raise to 24+ to take over the contract.';
    children.push(h('h3', { class: 'bp-title' }, 'Your bid'));
    if (hint) children.push(h('p', { class: 'bp-sub muted' }, hint));
    children.push(grid, row);
  } else if (g.turn != null) {
    children.push(h('p', { class: 'bp-wait', html: `Waiting for <span class="t${teamOf(g.turn)}-text">${esc(seatName(room, g.turn))}</span><span class="dots"></span>` }));
  }
  panel.replaceChildren(...children);
}

/** Short HTML for the trump badge in HUD. */
export function trumpBadgeHTML(room) {
  const g = room.game;
  const t = g.trump || {};
  if (t.revealed && t.suit) return `${suitIcon(t.suit, 'lg')}<span><b>${SUIT_NAMES[t.suit]}</b><small>trump${t.revealedBy != null ? ` · by ${esc(seatName(room, t.revealedBy))}` : ''}</small></span>`;
  if (t.concealed && t.suit) return `${suitIcon(t.suit, 'lg dim')}<span><b>${SUIT_NAMES[t.suit]}</b><small>your secret trump</small></span>`;
  if (t.concealed) return '<span class="q-suit" aria-hidden="true">?</span><span><b>Hidden</b><small>trump</small></span>';
  return '<span class="q-suit" aria-hidden="true">–</span><span><b>No trump</b><small>yet</small></span>';
}
