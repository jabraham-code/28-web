// Match score as a single tug-of-war bar: "Us 5 [■■■■■|■■■■■] 5 Them".
// Both teams start with `start` points; each hand moves points from one team to the other
// (totals stay 2×start). A team below 0 is out. Your team is always on the left
// (spectators: team 0 on the left).
import { h, teamOf, teamLabel, reducedMotion } from './util.js';
import { pulse } from './anim.js';

const MAX_SEGMENTS = 20; // above this the bar is a continuous fill

/** Which team sits on the left for this viewer. */
export const leftTeamOf = (room) => (room?.you?.seat != null ? teamOf(room.you.seat) : 0);

/** Short perspective label: Us / Them for players, team names for spectators. */
export function sideLabel(room, team) {
  if (room?.you?.seat == null) return teamLabel(room, team);
  return team === teamOf(room.you.seat) ? 'Us' : 'Them';
}

const fmt = (n) => (n < 0 ? `−${-n}` : String(n));
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

export function scoreSummary(room, scores, start) {
  const L = leftTeamOf(room), R = 1 - L;
  return `${sideLabel(room, L)} ${fmt(scores[L])}, ${sideLabel(room, R)} ${fmt(scores[R])} — started at ${start} each; points move between teams each hand; below 0 loses`;
}

/** Build an empty tug element. `variant`: 'hud' | 'modal'. */
export function createTug(variant = 'hud') {
  const end = (side) => `
    <div class="tug-end tug-${side}">
      <span class="tug-id"><span class="tug-lbl"></span><span class="tug-tag" hidden></span></span>
      <span class="tug-num">0</span>
      <span class="tug-float" aria-hidden="true"></span>
    </div>`;
  const el = h('div', { class: `tug tug-${variant}`, html: `
    ${end('l')}
    <div class="tug-mid">
      <div class="tug-bar" aria-hidden="true">
        <div class="tug-track"><i class="tug-fill tug-fill-l"></i><i class="tug-fill tug-fill-r"></i></div>
        <i class="tug-even"></i>
      </div>
      <div class="tug-pts" hidden><span class="tug-pts-l"></span><span class="tug-pts-r"></span></div>
    </div>
    ${end('r')}` });
  return el;
}

/**
 * Render scores into a tug element.
 * opts: { scores:[a,b], start, phase, teamPoints, contract:{bid,bidder}|null, showPts, out: team|null, animate }
 */
export function renderTug(el, room, opts) {
  const { scores, start, phase, teamPoints, contract, showPts = false, out = null, animate = true } = opts;
  const L = leftTeamOf(room), R = 1 - L;
  const total = Math.max(1, start * 2);
  const st = el._tug || {};
  const persp = `${L}`;
  const perspChanged = st.persp !== persp;
  const segs = total <= MAX_SEGMENTS ? total : 0;
  el.style.setProperty('--n', segs || 1);
  el.classList.toggle('tug-segs', !!segs);
  el.classList.toggle('tug-cont', !segs);

  const sides = [['l', L], ['r', R]];
  for (const [side, t] of sides) {
    const endEl = el.querySelector(`.tug-${side}`);
    endEl.classList.remove('t0', 't1');
    endEl.classList.add(`t${t}`);
    const lbl = endEl.querySelector('.tug-lbl');
    const label = sideLabel(room, t);
    if (lbl.textContent !== label) lbl.textContent = label;
    endEl.title = teamLabel(room, t);
    const v = scores[t];
    const isOut = out === t || (out == null && phase === 'matchEnd' && v < 0);
    const danger = !isOut && phase !== 'matchEnd' && v <= 1;
    endEl.classList.toggle('danger', danger);
    endEl.classList.toggle('out', isOut);
    el.classList.toggle(`danger-${side}`, danger);
    el.classList.toggle(`out-${side}`, isOut);
    const tag = endEl.querySelector('.tug-tag');
    tag.hidden = !(danger || isOut);
    tag.textContent = isOut ? 'OUT' : danger ? 'MATCH PT' : '';
    tag.title = isOut ? 'Dropped below 0' : v === 0 ? 'At 0 — any loss ends the match' : 'One more loss could end the match';
    const num = endEl.querySelector('.tug-num');
    const txt = fmt(v);
    if (num.textContent !== txt) {
      num.textContent = txt;
      const prevV = perspChanged ? undefined : st.scores?.[t];
      if (animate && prevV != null && prevV !== v) {
        pulse(num, 'bump');
        floatDelta(endEl.querySelector('.tug-float'), v - prevV);
      }
    }
  }

  // bar: left team's share of the total, clamped (a losing team can sit at -1)
  const lShare = Math.max(0, Math.min(total, scores[L])) / total;
  const fl = el.querySelector('.tug-fill-l'), fr = el.querySelector('.tug-fill-r');
  fl.classList.remove('t0', 't1'); fl.classList.add(`t${L}`);
  fr.classList.remove('t0', 't1'); fr.classList.add(`t${R}`);
  const instant = !animate || perspChanged || st.scores == null;
  if (instant) { fl.style.transition = fr.style.transition = 'none'; }
  fl.style.width = `${lShare * 100}%`;
  fr.style.width = `${(1 - lShare) * 100}%`;
  if (instant) { void fl.offsetWidth; fl.style.transition = fr.style.transition = ''; }

  // card points this hand
  const ptsEl = el.querySelector('.tug-pts');
  ptsEl.hidden = !showPts;
  el.classList.toggle('with-pts', !!showPts);
  if (showPts) {
    const tp = teamPoints || [0, 0];
    const bidTeam = contract ? teamOf(contract.bidder) : null;
    for (const [side, t] of sides) {
      const p = ptsEl.querySelector(`.tug-pts-${side}`);
      const html = `<b>${tp[t]}</b>${t === bidTeam ? `/${contract.bid}` : ''} pts`;
      if (p.dataset.html !== html) {
        const had = p.dataset.html != null;
        p.dataset.html = html; p.innerHTML = html;
        if (animate && had && tp[t]) pulse(p.querySelector('b'), 'bump');
      }
      p.classList.toggle('bidder', t === bidTeam);
      p.title = t === bidTeam ? `Card points this hand (needs ${contract.bid})` : 'Card points this hand';
    }
  }

  el.dataset.summary = scoreSummary(room, scores, start);
  el._tug = { scores: [...scores], persp };
}

function floatDelta(fl, d) {
  if (!fl || reducedMotion()) return;
  fl.textContent = signed(d);
  fl.classList.remove('pos', 'neg', 'go');
  fl.classList.add(d > 0 ? 'pos' : 'neg');
  void fl.offsetWidth;
  fl.classList.add('go');
  clearTimeout(fl._t);
  fl._t = setTimeout(() => fl.classList.remove('go'), 1300);
}

// ---------------------------------------------------------------- HUD
/** Fill the HUD `.hud-scores` container (mounts the tug on first call). */
export function renderHudScore(container, room, g, { animate = true } = {}) {
  let el = container.querySelector('.tug');
  if (!el) { container.textContent = ''; el = createTug('hud'); container.append(el); }
  const showPts = g.phase === 'playing' || g.phase === 'handEnd';
  const newMatch = el._hand != null && g.handNumber < el._hand; // rematch resets scores: no "+N" floats
  el._hand = g.handNumber;
  renderTug(el, room, {
    scores: g.scores, start: g.targetScore, phase: g.phase, teamPoints: g.teamPoints,
    contract: g.contract, showPts, animate: animate && !newMatch,
  });
  const summary = el.dataset.summary;
  container.title = `${summary}. Click for the scoreboard`;
  container.setAttribute('aria-label', `${summary}. Open scoreboard`);
}

// ---------------------------------------------------------------- modals
/** A tug for a modal that animates from `from` scores to `to` scores shortly after it is shown. */
export function modalTug(room, { from, to, start, out = null, phase = 'handEnd', delay = 450 }) {
  const el = createTug('modal');
  renderTug(el, room, { scores: from, start, phase: 'handEnd', animate: false });
  el.setAttribute('role', 'img');
  const finalSummary = scoreSummary(room, to, start);
  el.setAttribute('aria-label', finalSummary);
  const final = (animate) => renderTug(el, room, { scores: to, start, phase, out, animate });
  if (reducedMotion() || (from[0] === to[0] && from[1] === to[1])) final(false);
  else setTimeout(() => el.isConnected && final(true), delay);
  return el;
}

export { fmt as fmtScore, signed as fmtSigned };
