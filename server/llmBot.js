// Claude-powered bot for 28. Used only when ANTHROPIC_API_KEY (or another
// Anthropic credential) is configured on the server. Every decision is
// validated against view.legal; on any error, timeout, refusal or invalid
// choice the caller falls back to the heuristic bot.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const EFFORT = process.env.LLM_BOT_EFFORT || 'low'; // low keeps turns snappy
const TIMEOUT_MS = Number(process.env.LLM_BOT_TIMEOUT_MS) || 25000;

const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const RANK_NAMES = { J: 'Jack', 9: 'Nine', A: 'Ace', T: 'Ten', K: 'King', Q: 'Queen', 8: 'Eight', 7: 'Seven' };
const POINTS = { J: 3, 9: 2, A: 1, T: 1 };

export function llmAvailable() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.LLM_BOTS !== 'off';
}

const SYSTEM = `You are an expert player of "28", the South Indian trick-taking card game, seated at an online table. You play to win for your team.

Rules summary:
- 32 cards (7 to Ace in 4 suits). Rank high to low in every suit: J, 9, A, 10, K, Q, 8, 7.
- Card points: J=3, 9=2, A=1, 10=1, others 0. 28 points in total.
- 4 players, partners sit opposite. Seats 0 & 2 are team A, seats 1 & 3 team B. Play passes seat → seat+1.
- 4 cards are dealt, then an auction (14 to 28). The first bidder must bid at least 14. To overcall your own partner right after your left-hand opponent passed, you must bid at least 20. Bidding ends after 3 passes in a row.
- The winning bidder secretly places one card face down: its suit is trump. Four more cards are dealt and a second auction may raise the bid to 24+.
- Play: must follow suit if able. Until trump is revealed, a player who cannot follow may discard, or "call trump" (bidder must reveal it; caller must then play a trump if they have one). The bidder may not lead trump while it is concealed unless holding only trumps, and when void in a non-trump led suit may only discard a non-trump or reveal and play the concealed trump card.
- Highest trump wins the trick (once revealed), otherwise the highest card of the suit led.
- The bidding team must capture at least the bid in card points. Game points: bid 14-19 → +1 / -2, 20-24 → +2 / -3, 25-28 → +3 / -4.

Strategy hints: count points still out; Jacks and Nines are the power cards; feed points (A, 10, 9) to your partner when they are sure to win the trick; throw zero-point cards when losing; don't overbid without Jacks and length in a suit; conceal a low card of your longest strong suit as trump.

You receive the current game state and a numbered list of LEGAL options. Choose exactly one by its number. "say" is optional, friendly table talk of at most 12 words; leave it empty most of the time and never reveal your cards or the hidden trump.`;

const SCHEMA = {
  type: 'object',
  properties: {
    choice: { type: 'integer', description: 'Number of the chosen legal option' },
    say: { type: 'string', description: 'Optional short table talk, usually empty' },
  },
  required: ['choice', 'say'],
  additionalProperties: false,
};

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  return client;
}

function cardName(c) {
  if (!c) return 'face-down card';
  const pts = POINTS[c[0]] || 0;
  return `${RANK_NAMES[c[0]]} of ${SUIT_NAMES[c[1]]}${pts ? ` (${pts}pt)` : ''}`;
}

/** Build the numbered list of legal options from the view. */
export function legalOptions(view) {
  const l = view.legal || {};
  const acts = l.actions || [];
  const opts = [];
  if (acts.includes('play')) for (const c of l.playable || []) opts.push({ label: `Play ${cardName(c)}`, action: { type: 'play', card: c } });
  if (acts.includes('playTrumpCard')) opts.push({ label: `Reveal and play your concealed trump card (${cardName(view.trump?.card)})`, action: { type: 'playTrumpCard' } });
  if (acts.includes('callTrump')) opts.push({ label: 'Call for the trump to be revealed (then you must play a trump if you have one)', action: { type: 'callTrump' } });
  if (acts.includes('chooseTrump')) for (const c of l.trumpChoices || []) opts.push({ label: `Conceal ${cardName(c)} → ${SUIT_NAMES[c[1]]} become trump`, action: { type: 'chooseTrump', card: c } });
  if (acts.includes('pass')) opts.push({ label: 'Pass', action: { type: 'pass' } });
  if (acts.includes('bid') && l.minBid != null) for (let v = l.minBid; v <= (l.maxBid || 28); v++) opts.push({ label: `Bid ${v}`, action: { type: 'bid', value: v } });
  if (acts.includes('redeal')) opts.push({ label: 'Ask for a redeal (you hold no point cards)', action: { type: 'redeal' } });
  return opts;
}

function describe(view, names) {
  const me = view.mySeat;
  const who = (s) => (s === me ? 'You' : `${names[s] || `Seat ${s}`} (seat ${s}, ${s % 2 === me % 2 ? 'partner' : 'opponent'})`);
  const lines = [];
  lines.push(`You are seat ${me} (team ${me % 2 === 0 ? 'A' : 'B'}). Your partner is seat ${(me + 2) % 4}.`);
  lines.push(`Phase: ${view.phase}${view.bidding ? `, bidding round ${view.bidding.round}` : ''}. Hand #${view.handNumber}. Dealer: seat ${view.dealer}.`);
  lines.push(`Match score — team A: ${view.scores[0]}, team B: ${view.scores[1]} (target ±${view.targetScore}).`);
  lines.push(`Your hand: ${view.hand.map(cardName).join(', ') || '(empty)'}`);
  if (view.bidding?.history?.length) {
    lines.push(`Bidding so far: ${view.bidding.history.map((h) => `seat ${h.seat}: ${h.bid ?? 'pass'}`).join('; ')}`);
  }
  if (view.contract) lines.push(`Contract: ${view.contract.bid} by ${who(view.contract.bidder)}.`);
  const t = view.trump || {};
  if (t.revealed) lines.push(`Trump is REVEALED: ${SUIT_NAMES[t.suit]}.`);
  else if (t.suit) lines.push(`You are the bidder; your concealed trump card is ${cardName(t.card)} (trump ${SUIT_NAMES[t.suit]}, not yet revealed).`);
  else if (t.concealed) lines.push('Trump is still concealed (unknown to you).');
  if (view.phase === 'playing') {
    lines.push(`Card points captured this hand — team A: ${view.teamPoints[0]}, team B: ${view.teamPoints[1]}. Tricks won per seat: ${view.tricksWon.join(', ')}.`);
    if (view.lastTrick) lines.push(`Previous trick: ${view.lastTrick.cards.map((c) => `seat ${c.seat} ${cardName(c.card)}`).join(', ')} → won by seat ${view.lastTrick.winner} (${view.lastTrick.points} pts).`);
    const tr = view.trick;
    lines.push(`Current trick #${tr.index + 1}, led by seat ${tr.leader}: ${tr.cards.length ? tr.cards.map((c) => `seat ${c.seat} ${cardName(c.card)}`).join(', ') : '(you lead)'}`);
  }
  const recent = (view.log || []).slice(-24);
  if (recent.length) lines.push(`Recent events:\n${recent.map((l) => `- ${l}`).join('\n')}`);
  lines.push(`Cards in each hand: ${view.handCounts.join(', ')}`);
  return lines.join('\n');
}

const HINT_SCHEMA = {
  type: 'object',
  properties: {
    choice: { type: 'integer', description: 'Number of the recommended legal option' },
    reason: { type: 'string', description: 'One short sentence (max 20 words) explaining why' },
  },
  required: ['choice', 'reason'],
  additionalProperties: false,
};

async function ask(view, names, { schema, instruction }) {
  const opts = legalOptions(view);
  const prompt = `${describe(view, names)}\n\nLEGAL OPTIONS:\n${opts.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}\n\n${instruction}`;
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null;
  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  const idx = Number(parsed.choice) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= opts.length) return null;
  return { option: opts[idx], parsed };
}

/**
 * Ask Claude for a move. Resolves to { action, say } or null (caller falls back).
 * @param {object} view GameView for the bot's seat
 * @param {string[]} names display names by seat
 */
export async function chooseActionLLM(view, names = []) {
  const opts = legalOptions(view);
  if (opts.length === 0) return null;
  if (opts.length === 1) return { action: opts[0].action, say: '' };
  const r = await ask(view, names, { schema: SCHEMA, instruction: 'Choose one option number.' });
  if (!r) return null;
  const say = typeof r.parsed.say === 'string' ? r.parsed.say.trim().slice(0, 80) : '';
  return { action: r.option.action, say };
}

/**
 * Coach a human player: recommend one legal option with a short reason.
 * Resolves to { action, reason } or null.
 */
export async function hintLLM(view, names = []) {
  const opts = legalOptions(view);
  if (opts.length === 0) return null;
  if (opts.length === 1) return { action: opts[0].action, reason: 'This is your only legal move.' };
  const r = await ask(view, names, {
    schema: HINT_SCHEMA,
    instruction: 'You are coaching this player (they are "You"). Recommend the best option number and explain why in one short, friendly sentence (max 20 words). Never mention hidden information you could not know.',
  });
  if (!r) return null;
  const reason = typeof r.parsed.reason === 'string' ? r.parsed.reason.trim().slice(0, 160) : '';
  return { action: r.option.action, reason };
}
