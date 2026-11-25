# 28 Online — Shared Spec & Contracts

Stack: Node 18+ ESM, Express + Socket.IO (server-authoritative). Client is vanilla JS ES modules, no build step, served from `public/`. Socket.IO client is loaded from `/socket.io/socket.io.js`.

## File ownership
| Role | Files |
|---|---|
| SW engineer (game engine + bot) | `server/engine.js`, `server/cards.js`, `server/bot.js`, `test/engine.test.js` |
| Web developer (server, rooms, networking) | `server/index.js`, `server/rooms.js`, `public/js/net.js`, `test/rooms.test.js` |
| UI designer (all front-end UX) | `public/index.html`, `public/css/*`, `public/js/app.js`, `public/js/ui/*` |

Do not edit files you don't own. If a contract seems wrong, follow it anyway and note it in your final report.

---

## 1. Game rules (as implemented — pagat.com/jass/28 main rules)

- 32 cards. Suits `S H D C`. Ranks high→low: `J 9 A T K Q 8 7` (T = Ten).
- Points: J=3, 9=2, A=1, T=1, others 0. Total 28.
- Card id string: rank + suit, e.g. `"JS"`, `"9H"`, `"TD"`, `"7C"`.
- Seats `0..3`. Teams: seats 0 & 2 = team 0, seats 1 & 3 = team 1.
- Play/deal is counter-clockwise. Model: **next player = (seat + 1) % 4**. On screen, with me at the bottom, seat+1 is on my RIGHT, seat+2 opposite (top), seat+3 on my LEFT.
- Dealer rotates `dealer = (dealer + 1) % 4` each new hand (not on a redeal). First hand dealer = random seat chosen at match start.
- `firstSeat = (dealer + 1) % 4` — first to bid and leads trick 1.

### Deal & bidding round 1 (`phase: "bidding1"`)
- Deal 4 cards each. Turn starts at `firstSeat`.
- First bidder MUST bid (min 14). Exception: if their 4 cards contain no point cards (no J/9/A/T) they may instead `redeal` (same dealer reshuffles & redeals).
- Bids are integers 14..28, each must exceed current bid. Others may bid or pass. A passed player MAY bid again when their turn comes back.
- **Partner rule:** if the current high bid belongs to your partner AND the player immediately before you (seat+3) passed on their last turn, your bid must be ≥ 20.
- Bidding ends when 3 players pass in succession after the last bid.
- → `phase: "chooseTrump"`: bidder picks one card from their 4 cards; it is removed from their hand and placed face-down (concealed trump card). Trump suit = that card's suit. Only bidder knows.

### Deal 2 & bidding round 2 (`phase: "bidding2"`)
- Deal 4 more cards each (bidder ends with 7 in hand + 1 concealed).
- One more auction starting at `firstSeat`; any player may raise, minimum `max(24, currentBid + 1)`, or pass. Same "3 passes in succession after the last bid" end rule; if all 4 pass immediately, the round-1 contract stands. Partner rule does not apply in round 2.
- If a *different* player wins round 2: old concealed card returns to old bidder's hand; new bidder enters `phase: "chooseTrump"` again and picks a concealed card from their 8 cards. If the same bidder raises, they keep their trump card.
- After all 8 cards dealt, if any player holds all four Jacks → automatic redeal (same dealer). Check after deal 2 (before bidding2).

### Play (`phase: "playing"`) — 8 tricks
- `firstSeat` leads trick 1; trick winner leads next. Must follow suit if able.
- **Phase one (trump concealed):**
  - A player (not bidder) unable to follow may either play any card (a discard — it is shown face-down to others while the trick is in progress) or first take action `callTrump`: concealed card is revealed and moved into bidder's hand; trump is now revealed; the caller must then play a trump if they have one, otherwise any card.
  - Bidder unable to follow a non-trump lead: may discard any **non-trump** card from hand, or `playTrumpCard` (reveal and play the concealed card, trump becomes revealed). Bidder may NOT play a trump-suit card from hand in this case. (If bidder's hand has only trump-suit cards, they may play one from hand as a plain discard.)
  - Bidder leading: may not lead a trump-suit card unless hand holds only trump-suit cards (then it is led with no trump power, trump stays concealed). If bidder's hand is empty (trick 8, concealed card unplayed), bidder must `playTrumpCard`.
  - When trump suit is led by someone else, bidder follows from hand if possible; if bidder has no trump-suit cards in hand they may play anything; they may also `playTrumpCard`.
  - Trick winner in phase one: highest card of suit led.
- **Phase two (trump revealed):** follow suit if able; otherwise any card. Bidder has no restrictions.
- **Trick winner when trump revealed during or before this trick:** a card has trump power iff its suit == trump AND (it was played after the reveal, OR it was a non-following discard). Trump-suit cards that followed a trump lead before the reveal have no trump power. Highest trump-power card wins; else highest card of suit led.
- Phase-one face-down discards become visible to all when the trick completes (or immediately on trump reveal).

### Scoring
- Bidding team needs card points ≥ bid.
- Bid 14–19: made +1, failed −2. Bid 20–24: +2 / −3. Bid 25–28: +3 / −4. Applied to bidding team's game score only.
- Match: room setting `targetScore` (default 6). Match ends when a team's score ≥ target (they win) or ≤ −target (they lose).
- After the hand: `phase: "handEnd"`; `nextHand` action (any seated player; server also auto-advances after 8 s) deals the next hand. On match end: `phase: "matchEnd"`.

---

## 2. Engine API (`server/engine.js`) — pure, no I/O

```js
export function createGame({ targetScore = 6, dealer = randomSeat, rng = Math.random } = {}) // -> game, already started: first hand dealt, phase "bidding1"
export function applyAction(game, seat, action)  // -> { ok: true } | { ok: false, error: "human readable" }  (mutates game)
export function getView(game, seat)              // seat 0..3 or null (spectator) -> GameView (JSON-safe, hides secrets)
export function currentTurn(game)                // -> seat whose action is awaited, or null (handEnd / matchEnd)
```
`server/cards.js` exports helpers: `SUITS, RANKS, POINTS, rankIndex(card), suitOf(card), pointsOf(card), newDeck(), shuffle(deck, rng), sortHand(cards)`.
`server/bot.js` exports `chooseAction(view)` → an action object that is legal for `view.mySeat` (uses `view.legal`). Reasonable heuristics (bid on hand strength, pick strongest suit as trump, win tricks with points, don't waste high cards).

### Actions (`action` objects)
```
{ type: "bid", value: 14..28 }
{ type: "pass" }
{ type: "redeal" }                // first bidder, bidding1, no bids yet, no point cards
{ type: "chooseTrump", card }     // bidder in chooseTrump
{ type: "play", card }            // card from own hand
{ type: "callTrump" }             // non-bidder, cannot follow, trump concealed
{ type: "playTrumpCard" }         // bidder plays concealed card
{ type: "nextHand" }              // phase handEnd
```

### GameView
```js
{
  phase: "bidding1"|"chooseTrump"|"bidding2"|"playing"|"handEnd"|"matchEnd",
  seq: number,                 // increments on every successful action
  handNumber: number,
  dealer: seat, firstSeat: seat,
  turn: seat|null,
  mySeat: seat|null,
  hand: [card],                // my cards, sorted by suit (S,H,C,D alternating colors) then rank high→low; [] for spectator
  handCounts: [n,n,n,n],       // cards in each hand (concealed trump not counted)
  bidding: {
    round: 1|2,
    currentBid: number|null, bidder: seat|null,
    history: [{ seat, round, bid: number|null }],   // null = pass
  },
  contract: { bid, bidder } | null,                 // set once bidding1 finished (updated after round 2)
  trump: {
    concealed: bool,           // a face-down card lies in front of bidder
    revealed: bool,
    suit: "S"|"H"|"D"|"C"|null,    // visible only if revealed or I am bidder
    card: card|null,               // same visibility
    revealedBy: seat|null, revealedInTrick: number|null,
  },
  trick: { index: 0..7, leader: seat, cards: [{ seat, card: card|null, faceDown: bool }] },  // card null when faceDown and not mine
  lastTrick: { index, cards: [{ seat, card }], winner: seat, points: number } | null,
  tricksWon: [n,n,n,n],
  teamPoints: [n,n],           // card points captured this hand
  scores: [n,n], targetScore: number,
  legal: {                     // only meaningful when turn === mySeat; otherwise all empty/false
    actions: ["bid","pass","redeal","chooseTrump","play","callTrump","playTrumpCard","nextHand"],  // subset
    minBid: number|null, maxBid: 28,
    playable: [card],          // cards legal to "play" right now
    trumpChoices: [card],      // for chooseTrump
  },
  handResult: { bid, bidder, biddingTeam, teamPoints: [n,n], made: bool, delta: [n,n] } | null,
  matchWinner: 0|1|null,
  log: [string],               // last ~30 human-readable events ("Seat 2 bid 16", ...) — use seat numbers; UI maps to names
}
```
`nextHand` is legal for every seated player during `handEnd` (turn is null then).

---

## 3. Socket protocol (`server/index.js`, `server/rooms.js`)

All client→server emits use ack callbacks: `socket.emit(event, payload, (res) => ...)`, `res = { ok: true, ...data } | { ok: false, error }`.

Client → server:
| event | payload | ack data |
|---|---|---|
| `room:create` | `{ name }` | `{ code, playerId, token }` |
| `room:join` | `{ code, name, token? }` (token = rejoin as same player) | `{ code, playerId, token }` |
| `room:leave` | `{}` | |
| `room:sit` | `{ seat }` (empty seat, lobby only; moves you) | |
| `room:stand` | `{}` (lobby only) | |
| `room:addBot` | `{ seat }` host only | |
| `room:kick` | `{ seat }` host only, removes bot or player from seat (lobby only) | |
| `room:settings` | `{ targetScore }` host only, lobby | |
| `room:start` | `{}` host only, needs 4 seats filled | |
| `game:action` | action object (see engine) | |
| `chat:send` | `{ text }` (max 200 chars) | |

Server → client:
- `room:state` → RoomView (personalised per socket), sent after every change.
- `chat:message` → `{ name, seat, text, ts }`.

RoomView:
```js
{
  code: "ABCD",               // 4 uppercase letters (no I/O)
  hostId, you: { playerId, seat: seat|null, isHost: bool },
  seats: [ { playerId, name, isBot, connected } | null ] ×4,
  spectators: [ { playerId, name, connected } ],
  status: "lobby" | "playing",
  settings: { targetScore },
  game: GameView | null      // getView(game, you.seat)
}
```
Server behaviour: bots act ~800 ms after it becomes their turn (also callTrump then play). After a trick completes, server waits ~1.4 s before letting the next action be processed for bots (humans may act immediately; UI shows lastTrick). Auto `nextHand` after 8 s in handEnd. If a human disconnects mid-game their seat stays theirs (connected:false); after 60 s disconnected a bot takes over for them until they reconnect. Empty rooms are deleted after 10 min. Max 4 seats + any spectators. After matchEnd the host can `room:start` again (resets scores) — status returns to "lobby" on matchEnd is NOT required; `room:start` from "playing" with phase matchEnd restarts.

## 4. Client networking module (`public/js/net.js`)

```js
export class Net {
  constructor()                         // connects using global io()
  on(event, fn)                          // events: "state" (RoomView), "chat" (msg), "status" ("connected"|"disconnected"|"reconnecting")
  createRoom(name)      -> Promise<res>
  joinRoom(code, name)  -> Promise<res>  // uses stored token for that code automatically
  tryResume()           -> Promise<bool> // rejoin stored session (localStorage "28.session" = {code, name, token}) ; also call automatically on reconnect
  leave()               -> Promise<res>  // clears stored session
  sit(seat), stand(), addBot(seat), kick(seat), setSettings(obj), start() -> Promise<res>
  action(actionObj)     -> Promise<res>
  chat(text)            -> Promise<res>
  get state()           // last RoomView or null
}
```
Share link format: `${location.origin}/?room=ABCD`. The UI reads the `room` query param to prefill/join.

---

## 5. Additions (post-kickoff)

- **Fill with bots:** host adds bots per empty seat (`room:addBot`); UI offers "Fill empty seats with bots" and "Start with N bots".
- **Claude AI bots** (`server/llmBot.js`): enabled when the server has `ANTHROPIC_API_KEY` (opt out with `LLM_BOTS=off`). Env: `ANTHROPIC_MODEL` (default `claude-haiku-5-5`), `LLM_BOT_EFFORT` (default `low`), `LLM_BOT_TIMEOUT_MS` (default 25000). Every Claude choice is picked from a numbered list built from `view.legal`; on error/timeout/refusal/invalid choice the classic heuristic bot moves instead.
  - `RoomView.settings` gains `claudeAvailable: bool`, `botBrain: "claude"|"classic"` (host: `room:settings { botBrain }`, allowed any time).
  - Seat entries gain `ai: "claude"|"classic"|null`.
  - `chat:message` may carry `bot: true` (Claude table talk).
- **Turn timer:** `settings.turnTimer` ∈ {0,20,30,45,60} seconds (default 45). `RoomView.turnClock = { seat, endsIn, total } | null` (ms). On expiry, the classic bot plays for the human, and a `chat:message` with `system: true` is posted.
- **Hints:** `settings.hints` (default true) and `settings.hintSource: "claude"|"classic"`. `game:hint` → `{ action, label, reason, source }`, at most once per player per move. Its ack may arrive asynchronously.
- **Reactions:** `room:react { emoji }` with emoji from 👍 😂 😮 😡 🔥 👏 🙏 😢, rate-limited to 4 per 4 s. It broadcasts `room:reaction { playerId, seat, name, emoji, ts }`.
- **History:** `RoomView.history = { hands: [{hand, dealer, bidder, bidderName, bid, trump, made, teamPoints, delta, scores}], matches: [{winner, scores, hands, endedAt}], series: [n,n] }`. `hands` resets on each new match; `matches` and `series` persist for the room.
