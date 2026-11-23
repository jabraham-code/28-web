# Twenty-Eight (28) Online

A real-time multiplayer web version of **28**, the trick-taking card game popular in South India. Create a room, share the link, and play with up to four people. Bots can fill empty seats, and the bots can be driven by Claude if you supply an API key. Players can also talk over voice chat.

Rules follow the main game on [pagat.com/jass/28](https://www.pagat.com/jass/28.html). The full rules as implemented are in [`SPEC.md`](SPEC.md) §1, and players can read them in the app under **How to play**.

## Features

- **Rooms:** 4-letter room codes and share links. Players pick their seats, others can watch as spectators, and the host controls the room.
- **Full 28 rules:**
  - compulsory first bid, with a redeal allowed if that bidder holds no point cards;
  - a bid of at least 20 to overcall your partner;
  - a second bidding round with a minimum of 24;
  - a concealed trump card, calling for trump, and the bidder's restrictions while trump is hidden;
  - automatic redeal when one hand holds all four Jacks;
  - match scoring of +1/−2, +2/−3 and +3/−4 depending on the bid.
- **Bots:** the host can add a bot to any empty seat or fill all of them at once. A bot also plays for anyone disconnected for 60 s and hands the seat back when they return.
- **Claude AI bots** (optional): Claude makes the bots' decisions when `ANTHROPIC_API_KEY` is set, using Haiku by default. If a call fails, the classic bot moves instead. The host can switch between Claude and Classic bots at any time.
- **Voice chat:** players talk to each other directly over WebRTC. There is mute, per-person silence, and a talking indicator on each seat.
- **Modern UI:**
  - dealing, playing and trick animations;
  - works on desktop and phone;
  - text chat and an event log;
  - reconnects automatically after a page refresh or network drop.

## Run it locally

Requires **Node.js 18+**.

```bash
git clone git@github.com:jabraham-code/28-web.git
cd 28-web
npm install
npm start
```

Open **http://localhost:2828**, enter a name, create a room, and use **Fill empty seats with bots** → **Start** to play right away.

To turn on Claude bots:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Start and restart the server automatically when files change |
| `npm test` | Run the test suite (engine fuzz test ≈ 30 s) |
| `PORT=4000 npm start` | Use a different port |

**Testing multiplayer on one computer:** give each player a different browser or a private window. Tabs in the same browser share one saved session, so a second tab rejoins as the same player.

**Testing from other devices on your Wi-Fi:** open `http://<your-computer's-local-IP>:2828`. On macOS, `ipconfig getifaddr en0` shows that IP. Voice chat won't work this way, because browsers only allow microphone access over HTTPS or on `localhost`.

## Configuration

All configuration is through environment variables, and every one is optional.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `2828` | HTTP port |
| `ANTHROPIC_API_KEY` | – | Enables Claude AI bots |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Model used by Claude bots |
| `LLM_BOT_EFFORT` | `low` | How much thinking Claude does per move (`low` keeps turns snappy) |
| `LLM_BOT_TIMEOUT_MS` | `25000` | How long to wait for Claude before the classic bot moves instead |
| `LLM_BOTS` | `on` | Set to `off` to disable Claude bots even when a key is set |
| `TURN_URL` | – | TURN server(s) for voice chat on strict networks, comma-separated (e.g. `turn:turn.example.com:3478`) |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | – | TURN credentials |

**Cost note:** each Claude bot move is one API call, so a full match with three Claude bots makes a few hundred small calls. Haiku keeps this cheap.

## Deploy to Render

The repo includes a [`render.yaml`](render.yaml) blueprint, and the free plan is enough.

1. Push the repo to GitHub (it lives at `jabraham-code/28-web`).
2. In the [Render dashboard](https://dashboard.render.com) choose **New → Blueprint** and select the repo.
3. When prompted, enter `ANTHROPIC_API_KEY`, or leave it empty to use classic bots only. Click **Apply**.
4. Once the deploy is live, open `https://<service-name>.onrender.com` and share room links from there.

Every push to `main` redeploys automatically.

**Free plan caveats**
- The service sleeps after 15 minutes with no traffic. The next visitor waits about 30–60 s for it to wake up.
- Rooms live in server memory, so a sleep, restart or redeploy ends any games in progress.
- For an always-on server, change `plan: free` to `plan: starter` in `render.yaml` (paid).

**Voice chat on strict networks:** voice works for most players out of the box. Some corporate or mobile networks block direct peer-to-peer connections. For those, add a TURN server; [Metered](https://www.metered.ca/stun-turn) and [Cloudflare](https://developers.cloudflare.com/realtime/turn/) have free tiers. Set `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL` under **Environment** in Render.

### Other hosts

Any host that runs a long-lived Node process with WebSockets works: Railway, Fly.io, a VPS, or Docker. Build with `npm ci --omit=dev`, start with `npm start`, and use `/healthz` as the health check.

**Serverless platforms such as Vercel are not supported.** The game needs persistent WebSocket connections and in-memory room state.

## Project structure

```
server/
  index.js      Express + Socket.IO entry point (/healthz, static files)
  rooms.js      Room manager: seats, bots, timers, reconnection, chat, voice signaling
  engine.js     Pure rules engine for 28 (state machine, legal moves, scoring)
  cards.js      Deck, ranks, points helpers
  bot.js        Heuristic (classic) bot
  llmBot.js     Claude-powered bot (falls back to bot.js)
public/
  index.html    App shell
  css/          Styles (base, cards, lobby, table, voice)
  js/app.js     Screen routing and wiring
  js/net.js     Socket.IO client wrapper (sessions, reconnect)
  js/voice.js   WebRTC voice mesh
  js/ui/        Lobby, table, bidding, cards, modals, chat, voice controls
test/           node:test suites (engine fuzz, rooms, Claude bots, voice)
SPEC.md         Rules as implemented + engine/socket contracts
render.yaml     Render deployment blueprint
```

The server is authoritative. Clients send actions like `{ type: "play", card: "JS" }`. The engine validates each action, and every player receives a personalised view that never includes other players' cards or the hidden trump. See [`SPEC.md`](SPEC.md) for the full protocol.
