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
  // one row only: the latest few calls, older ones collapsed into a "+N" chip
  const all = b.history || [];
  const SHOW = 3;
  const shown = all.length > SHOW + 1 ? all.slice(-SHOW) : all;
  if (shown.length < all.length) {
    const older = all.slice(0, all.length - shown.length);
    hist.append(h('li', { class: 'chip more', title: older.map((e) => `${seatName(room, e.seat)}: ${e.bid == null ? 'Pass' : e.bid}`).join(', ') }, `+${older.length}`));
  }
  for (const e of shown) {
    hist.append(h('li', { class: `chip t${teamOf(e.seat)} ${e.bid == null ? 'pass' : 'bid'} r${e.round}`, title: `Round ${e.round}`, html: `<span class="chip-name">${esc(seatName(room, e.seat).replace(/^Bot\s+/i, ''))}</span><b>${e.bid == null ? 'Pass' : e.bid}</b>` }));
  }
  const children = [head, cur];
  if ((b.history || []).length) children.push(hist);

  if (myTurn) {
    const min = g.legal.minBid, max = g.legal.maxBid || 28;
    const canBid = acts.includes('bid') && min != null;
    const stepper = h('div', { class: 'bid-stepper', role: 'group', 'aria-label': 'Choose a bid' });
    const row = h('div', { class: 'bp-actions' });
    panel._setBid = null;
    if (canBid) {
      let value = min;
      const minus = h('button', { class: 'step-btn', type: 'button', 'aria-label': 'Lower bid' }, '−');
      const plus = h('button', { class: 'step-btn', type: 'button', 'aria-label': 'Raise bid' }, '+');
      const num = h('output', { class: 'step-value', 'aria-live': 'polite' });
      const stakes = h('span', { class: 'step-stakes muted' });
      let trump = null;
      const bidBtn = h('button', { class: 'btn btn-gold', type: 'button', 'data-hint': 'bid', onclick: () => ctx.act(trump ? { type: 'bid', value, trump } : { type: 'bid', value }) });
      const label = () => { bidBtn.innerHTML = `Bid ${value}${trump ? ` · ${suitIcon(suitOf(trump))}` : ''}`; };
      const set = (v) => {
        value = Math.min(max, Math.max(min, v));
        num.textContent = String(value);
        num.classList.toggle('hi', value >= 20);
        num.classList.toggle('top', value >= 25);
        stakes.textContent = value >= 25 ? 'win +3 · lose −4' : value >= 20 ? 'win +2 · lose −3' : 'win +1 · lose −2';
        minus.disabled = value <= min;
        plus.disabled = value >= max;
        label();
      };
      // press-and-hold repeats
      const hold = (btn, d) => {
        let t = 0;
        const stop = () => { clearTimeout(t); clearInterval(t); t = 0; };
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          set(value + d);
          t = setTimeout(() => { t = setInterval(() => set(value + d), 90); }, 380);
        });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(value + d); } });
      };
      hold(minus, -1);
      hold(plus, 1);
      stepper.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(value + 1); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(value - 1); }
      });
      stepper.append(minus, h('div', { class: 'step-num' }, num, stakes), plus);
      set(min);
      panel._setBid = set;
      row.append(bidBtn);
      // Optional: pick the trump card now, together with the bid.
      const holdsContract = round === 2 && g.contract?.bidder === me;
      if (!holdsContract && (g.hand || []).length) {
        const picks = h('div', { class: 'trump-pick', role: 'group', 'aria-label': 'Trump card (optional)' });
        const note = h('span', { class: 'tp-note muted' }, 'Trump card (optional) — or choose it if you win');
        for (const c of g.hand) {
          const el = createCard(c, { button: true });
          el.title = `${SUIT_NAMES[suitOf(c)]} as trump`;
          el.setAttribute('aria-pressed', 'false');
          el.addEventListener('click', () => {
            trump = trump === c ? null : c;
            for (const x of picks.querySelectorAll('.card')) {
              const on = x.dataset.card === trump;
              x.classList.toggle('picked', on);
              x.setAttribute('aria-pressed', String(on));
            }
            note.innerHTML = trump ? `Trump: <b>${SUIT_NAMES[suitOf(trump)]}</b> — placed face-down if you win` : 'Trump card (optional) — or choose it if you win';
            label();
          });
          picks.append(el);
        }
        stepper._trump = h('div', { class: 'trump-pick-wrap' }, note, picks);
      }
    }
    if (acts.includes('pass')) row.append(h('button', { class: 'btn btn-ghost', type: 'button', 'data-hint': 'pass', onclick: () => ctx.act({ type: 'pass' }) }, 'Pass'));
    if (acts.includes('redeal')) row.append(h('button', { class: 'btn btn-ghost', type: 'button', 'data-hint': 'redeal', title: 'You hold no point cards', onclick: () => ctx.act({ type: 'redeal' }) }, 'Redeal'));
    let hint = '';
    if (round === 1 && !acts.includes('pass') && acts.includes('bid')) hint = 'You open the bidding and must bid.';
    if (acts.includes('redeal')) hint = 'No point cards — you may ask for a redeal.';
    if (round === 1 && b.bidder != null && b.bidder === partnerOf(me) && min >= 18 && b.currentBid < 17) hint = 'Partner holds the bid — you need 18+ to overbid.';
    if (round === 2) hint = b.bidder === me ? 'Raise your own contract, or pass.' : 'Raise to 24+ to take over the contract.';
    if (hint) children.push(h('p', { class: 'bp-sub muted' }, hint));
    // stepper + Bid/Pass on one side, the optional trump picker on the other (stacked on narrow screens)
    const controls = h('div', { class: 'bp-controls' }, canBid ? stepper : null, row);
    children.push(h('div', { class: `bp-main${stepper._trump ? ' has-pick' : ''}` }, stepper._trump || null, controls));
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
