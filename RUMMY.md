# Rummy — rules & contracts (second game type)

This document is the contract between the Rummy engine, the room/platform layer and the Rummy UI.
28 stays exactly as it is (SPEC.md). Everything here is additive.

## 1. Rules implemented: 13-card Indian Rummy, Pool format

### Players, cards, deal
- 2–6 players (room setting `players`, default 4). Two standard 52-card decks + 2 printed jokers = 106 cards.
- Card ids are unique strings: rank + suit + deck number, e.g. `"7H1"`, `"7H2"`, `"TD1"`, `"QS2"`; printed jokers `"X1"`, `"X2"`.
  Ranks `A 2 3 4 5 6 7 8 9 T J Q K`, suits `S H D C`.
- Dealer rotates each deal (`dealer = next active player after the previous dealer`). Each active player gets 13 cards.
- **Wild joker:** after dealing, the next closed-deck card is turned face up (`wildCard`). Every card of that rank (any suit) is a wild joker. If `wildCard` is a printed joker, **Aces** are wild. Printed jokers are always wild. The wild card stays visible under the closed deck and is not drawable.
- The next card starts the open (discard) pile. First player = next active player after the dealer.

### A turn
1. **Draw** one card: the top of the closed deck (`from: "closed"`) or the top of the open pile (`from: "open"`).
2. Then either **discard** one card to the open pile, or **declare** (discard one card face down as the finishing card and show the rest).
- You may not discard the card you just took from the open pile in the same turn (unless it is your only legal option — it never is with 14 cards, so simply forbid it).
- If the closed deck is empty when a player must draw from it, the open pile except its top card is shuffled to form a new closed deck.
- **Drop:** on your turn, before drawing, you may drop out of the deal: 20 points if you have not drawn any card yet this deal ("first drop"), otherwise 40 ("middle drop"). A dropped player takes no further part in the deal. If only one active player is left, that player wins the deal (0 points) and everyone else keeps their drop points.

### Melds and declaring
- **Sequence:** 3+ consecutive cards of the same suit. Ace can be low (A-2-3) or high (Q-K-A), never wrap-around (K-A-2).
- **Pure sequence:** a sequence with no wild/printed jokers (a wild-rank card used as its natural self, e.g. 5♥ in 4♥5♥6♥ when 5s are wild, still counts as pure).
- **Impure sequence:** a sequence using one or more jokers as substitutes.
- **Set:** 3 or 4 cards of the same rank, all different suits (two cards of the same suit from the two decks cannot both be in one set). Jokers may substitute.
- **Valid declaration:** all 13 remaining cards (after the finishing discard) are arranged into melds with **at least two sequences, at least one of them pure**. Every card must be in a meld.
- The engine finds the arrangement itself (players don't submit groups): `declare` is valid iff the best arrangement of the 13 cards meets the requirement.
- **Wrong declaration:** the declarer scores 80 and the deal ends; everyone else scores 0.

### Deal scoring (valid declaration)
- Declarer: 0. Every other active player is scored automatically using the arrangement that minimises their points:
  - If they have the required 2 sequences incl. a pure one: points = sum of cards not in any valid meld (sets included).
  - If they have a pure sequence but not a second sequence: only the pure sequence(s) are excluded; all other cards count.
  - Without a pure sequence: all cards count.
  - Card values: A K Q J = 10, number cards = face value (T = 10), wild and printed jokers = 0. Maximum 80 per player per deal.
- Dropped players: their drop points (20 / 40).

### Pool match
- Room setting `poolLimit` ∈ {101, 201} (default 101). Scores accumulate. A player whose total reaches **≥ poolLimit** is eliminated.
- The match ends when only one player is left → `matchWinner` = that seat. (If several cross on the same deal leaving nobody, the lowest total wins.)
- `nextDeal` starts the next deal among the remaining players.

## 2. Engine API (`server/rummy/engine.js`, pure, no I/O)

```js
export function createGame({ seats, poolLimit = 101, dealer, rng = Math.random, decks })
//   seats: array of seat numbers taking part, e.g. [0,1,2,3] (2..6 entries, any of 0..5)
//   decks: optional test aid: array of pre-arranged 106-card id arrays used for successive deals
export function applyAction(game, seat, action)   // -> { ok: true } | { ok: false, error }
export function getView(game, seat | null)        // personalised, JSON-safe; never leaks others' hands or the closed deck
export function currentTurn(game)                 // seat whose action is awaited, or null (dealEnd / matchEnd)
export function bestArrangement(cards, wildRank)  // -> { groups:[{type:'pure'|'impure'|'set', cards}], deadwood:[ids], points, valid }
export function cardPoints(card, wildRank)
```

Actions:
```js
{ type: "draw", from: "closed" | "open" }
{ type: "discard", card }
{ type: "declare", card }        // finishing card; engine validates the remaining 13
{ type: "drop" }                 // before drawing, on your turn
{ type: "nextDeal" }             // any active seat, phase "dealEnd"
```

### GameView
```js
{
  gameType: "rummy",
  phase: "playing" | "dealEnd" | "matchEnd",
  seq, dealNumber, dealer, seats: [..],         // seats taking part in the match
  active: [..],                                 // seats still in this deal (not dropped, not eliminated)
  eliminated: [..],
  turn: seat | null, step: "draw" | "discard" | null,
  mySeat, hand: [ids],                          // my cards (13, or 14 after drawing), server order (UI may regroup)
  handCounts: { [seat]: n },
  closedCount, openTop: id | null, openCount,
  wildCard: id, wildRank: "5" | "A" ...,
  justDrew: { card, from } | null,              // mine only, this turn
  scores: { [seat]: total }, poolLimit,
  dropped: { [seat]: 20 | 40 },                 // this deal
  dealResult: null | {
     declarer: seat | null, valid: bool, wrongShow: bool, winner: seat,   // winner of the deal
     points: { [seat]: n },                      // this deal
     hands: { [seat]: { groups:[{type, cards}], deadwood:[ids] } }        // revealed at deal end
  },
  matchWinner: seat | null,
  legal: { actions: [..], canDrawOpen: bool, discardable: [ids] },        // only for the seat to act ([] otherwise; "nextDeal" for all active seats in dealEnd)
  log: [strings],
}
```

## 3. Platform (rooms, lobby, routing)
- Room setting `gameType: "28" | "rummy"` (host, lobby only; default "28"). Rummy settings: `players` (2–6, default 4), `poolLimit` (101|201).
- For rummy the room uses seats `0..players-1`; Start requires all of them filled (bots fill as for 28). `RoomView.seats` length = 4 for 28, `players` for rummy.
- Rooms talk to a **game module** interface so 28 and Rummy plug in the same way:
  `{ id, createGame(settings, seats), applyAction, getView, currentTurn, botAction(view), hintAction(view), describe(action, view) -> label, nextAction: 'nextHand'|'nextDeal', isOver(view), recordHistory(view, room) }`.
- Turn timer, bot takeover after disconnect, hints (classic bot suggestion), chat, reactions, voice: all generic and must work for rummy. Claude bots/hints for rummy are out of scope for now (fall back to the classic rummy bot).
- `RoomView.game` is the active module's GameView; the client switches screens on `game.gameType`.

## 4. UI (`public/js/ui/rummy/`)
- A separate game screen `#screen-rummy` mounted by `mountRummyTable(root, ctx)` returning the same interface as the 28 table: `{ render(room), whenIdle(fn), setUnread(n), reset(), say(seat, text), react(seat, emoji, name), chatVisible() }`.
- Shows: opponents around the table (2–6) with card counts and scores, closed deck + open pile + wild joker card, my 13/14-card hand with **sort** (by suit / by rank) and **manual grouping** (select cards → "Group"; drag or tap to move; groups labelled live as Pure seq / Seq / Set / invalid using a client copy of the meld checker), Draw / Discard / Declare / Drop controls, deal-end results with every player's revealed groups and points, pool scoreboard with elimination at 101/201.
- Must work on phones (portrait and landscape) as well as desktop, same visual language as the 28 table.

## 5. Conventions settled during implementation
- Extra view fields: `legal.canDrawClosed`, `legal.dropPoints` (20 | 40 | null), `dealResult.finishCard` (shown at deal end).
- `declare` may use any card as the finishing card, including the card just taken from the open pile (`legal.discardable` applies to `discard` only).
- Wrong show: the declarer scores 80, players who had already dropped keep 20/40, everyone else 0; `winner` is null.
- Jokers: an all-joker group (3+) counts as an impure sequence; one natural card + two jokers is an impure sequence; a wild-rank card in its natural place keeps a sequence pure.
- `nextDeal` may be sent by any non-eliminated seat (the room auto-sends it after 8 s).
- Only the open pile's top card is visible; closed-deck draws are logged without the card.
- Hand order is the deal order with each drawn card appended (the UI regroups).
- Room history for rummy: `hands` = one row per deal `{deal, dealer, declarer, valid, wrongShow, winner, points, scores, eliminated}`; `series` counts match wins per seat.
- Claude bots/hints are 28-only for now; rummy uses the classic rummy bot for both.
