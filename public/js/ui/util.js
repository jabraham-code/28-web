// Shared helpers for the 28 UI.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Tiny element factory: h('div', {class:'x', onclick}, child, 'text') */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const SUITS = ['S', 'H', 'C', 'D'];
export const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const SUIT_SINGULAR = { S: 'Spade', H: 'Heart', D: 'Diamond', C: 'Club' };
export const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_NAMES = { J: 'Jack', 9: 'Nine', A: 'Ace', T: 'Ten', K: 'King', Q: 'Queen', 8: 'Eight', 7: 'Seven' };
export const RANK_LABEL = { T: '10' };
export const POINTS = { J: 3, 9: 2, A: 1, T: 1 };

export const rankOf = (c) => c[0];
export const suitOf = (c) => c[1];
export const pointsOf = (c) => POINTS[rankOf(c)] || 0;
export const isRed = (s) => s === 'H' || s === 'D';
export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;
export const cardName = (c) => `${RANK_NAMES[rankOf(c)]} of ${SUIT_NAMES[suitOf(c)]}`;

/** Screen position of a seat relative to the viewer: 0 bottom, 1 right, 2 top, 3 left. */
export const posOf = (seat, viewSeat) => (seat - viewSeat + 4) % 4;
export const POS = ['bottom', 'right', 'top', 'left'];

export function seatName(room, seat) {
  if (seat == null) return '';
  const s = room?.seats?.[seat];
  return s?.name || `Seat ${seat + 1}`;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

/** Make engine log lines friendly: "Seat N" -> player name, "Team N" -> team names, "JS" -> "J♠". */
export function mapSeatNames(text, room, asHtml = true) {
  return String(text)
    .replace(/\b[Ss]eat (\d)\b/g, (m, n) => {
      const seat = Number(n);
      if (seat > 3) return m;
      const name = seatName(room, seat);
      return asHtml ? `<span class="t${teamOf(seat)}-text">${esc(name)}</span>` : name;
    })
    .replace(/\bTeam ([01])\b/g, (m, n) => (asHtml ? `<span class="t${n}-text">${esc(teamLabel(room, Number(n)))}</span>` : teamLabel(room, Number(n))))
    .replace(/\b([J9ATKQ87])([SHDC])\b/g, (m, r, su) => {
      const lbl = `${RANK_LABEL[r] || r}${SUIT_GLYPH[su]}`;
      return asHtml ? `<span class="log-card ${isRed(su) ? 'red' : ''}">${lbl}</span>` : lbl;
    });
}

export function teamLabel(room, team) {
  const names = [team, team + 2].map((s) => room?.seats?.[s]?.name).filter(Boolean);
  return names.length ? names.join(' & ') : team === 0 ? 'Seats 1 & 3' : 'Seats 2 & 4';
}

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Small deterministic hash -> used for natural-looking card tilt in the trick pile. */
export function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return (x >>> 0) / 4294967295;
}

export function rectCenter(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export const SPARKLE = '<svg viewBox="0 0 24 24" class="ico sparkle" aria-hidden="true"><path d="M12 2l2.2 6.3L20.5 10.5 14.2 12.7 12 19l-2.2-6.3L3.5 10.5l6.3-2.2zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" fill="currentColor"/></svg>';

/** Badge for an automated seat: Claude AI bot, classic bot, or a bot covering for a disconnected human. */
export function botBadge(p) {
  if (!p || !(p.isBot || p.botControlled)) return '';
  const claude = p.ai === 'claude';
  if (p.botControlled && !p.isBot) return `<span class="tag ${claude ? 'tag-claude' : 'tag-bot'}" title="A bot is playing until they reconnect">${claude ? SPARKLE : ''}Auto</span>`;
  return claude ? `<span class="tag tag-claude" title="Claude AI bot">${SPARKLE}Claude</span>` : '<span class="tag tag-bot">Bot</span>';
}
