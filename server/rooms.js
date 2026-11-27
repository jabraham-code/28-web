// Room manager for 28 Online (SPEC §3) — game-type agnostic.
//
// Everything game-specific (engine, bots, hints, history, pauses) lives in a
// game module (server/games/*.js, interface in RUMMY.md §3). The room picks the
// module from `settings.gameType` ("28" | "rummy").
//
// Transport-agnostic: a "conn" is any object with a unique `id` and an
// `emit(event, data)` method (a socket.io Socket satisfies this). The socket
// layer (server/index.js) forwards each client event to `handle(conn, event,
// payload)` and returns the result through the ack callback, and calls
// `disconnect(conn)` when a socket goes away. Tests can drive the manager
// with plain fake conns.

import crypto from 'node:crypto';
import { GAMES, DEFAULT_GAME, getGame } from './games/index.js';
import twentyEight from './games/twentyEight.js';
import { MIN_PLAYERS, MAX_PLAYERS, DEFAULT_PLAYERS, POOL_LIMITS, DEFAULT_POOL_LIMIT } from './games/rummyLimits.js';

export const DEFAULT_OPTIONS = Object.freeze({
  botDelay: 800,          // ms before a bot acts once it's their turn
  trickPause: 1400,       // ms pause after a trick completes before bots act
  nextHandDelay: 8000,    // ms in handEnd (28) / dealEnd (rummy) before auto nextHand / nextDeal
  takeoverDelay: 60000,   // ms a disconnected human waits before a bot plays for them
  emptyRoomTtl: 600000,   // ms a room with no connected humans survives
  chatLimit: 5,           // max messages ...
  chatWindow: 5000,       // ... per this many ms
  maxNameLength: 20,
  maxChatLength: 200,
  minTargetScore: 1,
  maxTargetScore: 20,
  iceServers: undefined,  // WebRTC ICE servers for voice chat; default: Google STUN + optional TURN_* env
  hint: undefined,        // async (view, names) => {action, reason}|null ; default: Claude when available
  turnTimers: [0, 20, 30, 45, 60], // allowed turn timer settings (seconds, 0 = off)
  turnTimerUnit: 1000,    // ms per turn-timer second (tests shrink this)
  llm: undefined,         // async (view, names) => {action, say}|null ; default: Claude when ANTHROPIC_API_KEY set
});

export const REACTIONS = Object.freeze(['👍', '😂', '😮', '😡', '🔥', '👏', '🙏', '😢']);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O
const BOT_NAMES = ['Bot Arjun', 'Bot Meera', 'Bot Ravi', 'Bot Lakshmi', 'Bot Vijay', 'Bot Anita', 'Bot Suresh', 'Bot Divya'];

const EVENTS = {
  'room:create': 'onCreate',
  'room:join': 'onJoin',
  'room:leave': 'onLeave',
  'room:sit': 'onSit',
  'room:stand': 'onStand',
  'room:addBot': 'onAddBot',
  'room:kick': 'onKick',
  'room:settings': 'onSettings',
  'game:hint': 'onHint',
  'room:react': 'onReact',
  'voice:join': 'onVoiceJoin',
  'voice:leave': 'onVoiceLeave',
  'voice:mute': 'onVoiceMute',
  'voice:signal': 'onVoiceSignal',
  'room:start': 'onStart',
  'game:action': 'onAction',
  'chat:send': 'onChat',
};

export const CLIENT_EVENTS = Object.freeze(Object.keys(EVENTS));

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (error) => ({ ok: false, error });

function randomId(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function cleanName(name, max) {
  if (typeof name !== 'string') return '';
  // strip control chars, collapse whitespace, trim, cap length
  return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function cleanCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function parseSeat(seat, count) {
  const s = typeof seat === 'string' && seat.trim() !== '' ? Number(seat) : seat;
  return Number.isInteger(s) && s >= 0 && s < count ? s : null;
}

export class RoomManager {
  constructor(options = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    // Claude bots: injected brain (tests) or the real one when a key is configured.
    // (Only game modules with a `claude` entry — currently 28 — use them.)
    const claude = twentyEight.claude;
    this.llm = options.llm !== undefined ? options.llm : (claude.available() ? claude.choose : null);
    this.hinter = options.hint !== undefined ? options.hint : (claude.available() ? claude.hint : null);
    this.logger = options.logger ?? console;
    this.rooms = new Map(); // code -> room
    this.conns = new Map(); // conn.id -> { conn, code, playerId }
  }

  // ---------------------------------------------------------------- public API

  /** Dispatch a client event. Always returns an ack object. */
  handle(conn, event, payload) {
    const method = EVENTS[event];
    if (!method) return fail('Unknown event');
    if (payload === undefined || payload === null) payload = {};
    if (typeof payload !== 'object') return fail('Invalid payload');
    try {
      return this[method](conn, payload);
    } catch (err) {
      this.logger.error?.(`[rooms] ${event} failed:`, err);
      return fail('Internal server error');
    }
  }

  /** Call when a transport connection closes. */
  disconnect(conn) {
    const binding = this.conns.get(conn.id);
    this.conns.delete(conn.id);
    if (!binding) return;
    const room = this.rooms.get(binding.code);
    if (!room) return;
    const player = room.players.get(binding.playerId);
    if (!player || player.connId !== conn.id) return;
    player.connId = null;
    player.conn = null;
    player.connected = false;
    this._voiceDrop(room, player);
    this._startTakeoverTimer(room, player);
    this._afterChange(room);
  }

  /** Destroy all rooms and timers (used on shutdown / in tests). */
  close() {
    for (const room of [...this.rooms.values()]) this._destroyRoom(room);
    this.conns.clear();
  }

  getRoom(code) {
    return this.rooms.get(cleanCode(code)) ?? null;
  }

  // ------------------------------------------------------------ event handlers

  onCreate(conn, { name }) {
    const clean = cleanName(name, this.opts.maxNameLength);
    if (!clean) return fail('Please enter a name');
    this._detach(conn); // leave any room this connection is currently in
    const room = this._newRoom();
    const player = this._addHuman(room, clean);
    room.hostId = player.playerId;
    this._bind(conn, room, player);
    this._afterChange(room);
    return ok({ code: room.code, playerId: player.playerId, token: player.token });
  }

  onJoin(conn, { code, name, token }) {
    const roomCode = cleanCode(code);
    const room = this.rooms.get(roomCode);
    if (!room) return fail('Room not found');

    // Rejoin as an existing player?
    if (typeof token === 'string' && token) {
      const player = [...room.players.values()].find((p) => !p.isBot && p.token === token);
      if (player) {
        const cur = this.conns.get(conn.id);
        if (!(cur && cur.code === room.code && cur.playerId === player.playerId)) this._detach(conn);
        const newName = cleanName(name, this.opts.maxNameLength);
        if (newName) player.name = newName;
        this._bind(conn, room, player);
        return this._joined(room, player);
      }
    }

    const clean = cleanName(name, this.opts.maxNameLength);
    if (!clean) return fail('Please enter a name');
    this._detach(conn);
    const player = this._addHuman(room, clean);
    if (!room.hostId || !room.players.has(room.hostId)) room.hostId = player.playerId;
    this._bind(conn, room, player);
    return this._joined(room, player);
  }

  onLeave(conn) {
    const ctx = this._ctx(conn);
    if (!ctx) return ok(); // leaving when not in a room is a no-op
    this._removePlayer(ctx.room, ctx.player);
    this.conns.delete(conn.id);
    return ok();
  }

  onSit(conn, { seat }) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    const { room, player } = ctx;
    const s = parseSeat(seat, room.seats.length);
    if (s === null) return fail('Invalid seat');
    if (!this._isLobby(room)) return fail('Game in progress');
    if (room.seats[s] !== null) return room.seats[s] === player.playerId ? ok() : fail('Seat is taken');
    if (player.seat !== null) room.seats[player.seat] = null;
    room.seats[s] = player.playerId;
    player.seat = s;
    this._afterChange(room);
    return ok();
  }

  onStand(conn) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    const { room, player } = ctx;
    if (!this._isLobby(room)) return fail('Game in progress');
    if (player.seat !== null) {
      room.seats[player.seat] = null;
      player.seat = null;
      this._afterChange(room);
    }
    return ok();
  }

  onAddBot(conn, { seat }) {
    const ctx = this._hostCtx(conn);
    if (ctx.error) return fail(ctx.error);
    const { room } = ctx;
    const s = parseSeat(seat, room.seats.length);
    if (s === null) return fail('Invalid seat');
    if (!this._isLobby(room)) return fail('Game in progress');
    if (room.seats[s] !== null) return fail('Seat is taken');
    this._addBot(room, s);
    this._afterChange(room);
    return ok();
  }

  onKick(conn, { seat }) {
    const ctx = this._hostCtx(conn);
    if (ctx.error) return fail(ctx.error);
    const { room } = ctx;
    const s = parseSeat(seat, room.seats.length);
    if (s === null) return fail('Invalid seat');
    if (!this._isLobby(room)) return fail('Game in progress');
    const pid = room.seats[s];
    if (pid === null) return fail('Seat is empty');
    const target = room.players.get(pid);
    room.seats[s] = null;
    if (target) {
      target.seat = null;
      if (target.isBot) room.players.delete(pid); // humans become spectators
    }
    this._afterChange(room);
    return ok();
  }

  onSettings(conn, { targetScore, botBrain, turnTimer, hints, gameType, players, poolLimit } = {}) {
    const ctx = this._hostCtx(conn);
    if (ctx.error) return fail(ctx.error);
    const { room } = ctx;
    // Validate everything first, then apply atomically.
    if (botBrain !== undefined) {
      if (botBrain !== 'claude' && botBrain !== 'classic') return fail('Invalid bot type');
      if (botBrain === 'claude' && !this.llm) return fail('Claude bots need ANTHROPIC_API_KEY on the server');
    }
    if (turnTimer !== undefined && !this.opts.turnTimers.includes(Number(turnTimer))) return fail('Invalid turn timer');
    if (hints !== undefined && typeof hints !== 'boolean') return fail('Invalid hints setting');
    // Settings that change the match itself are lobby only. The rest may change any time.
    const lobbyOnly = targetScore !== undefined || gameType !== undefined || players !== undefined || poolLimit !== undefined;
    if (lobbyOnly && !this._isLobby(room)) return fail('Game in progress');
    let t;
    if (targetScore !== undefined) {
      t = Number(targetScore);
      if (!Number.isInteger(t) || t < this.opts.minTargetScore || t > this.opts.maxTargetScore) {
        return fail(`Starting points must be ${this.opts.minTargetScore}–${this.opts.maxTargetScore}`);
      }
    }
    if (gameType !== undefined && !GAMES[gameType]) return fail(gameType === 'rummy' ? 'Rummy is not available on this server' : 'Unknown game');
    let n;
    if (players !== undefined) {
      n = Number(players);
      if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) return fail(`Players must be ${MIN_PLAYERS}–${MAX_PLAYERS}`);
    }
    let pool;
    if (poolLimit !== undefined) {
      pool = Number(poolLimit);
      if (!POOL_LIMITS.includes(pool)) return fail(`Pool must be ${POOL_LIMITS.join(' or ')}`);
    }
    if (botBrain !== undefined) room.settings.botBrain = botBrain;
    if (turnTimer !== undefined) {
      room.settings.turnTimer = Number(turnTimer);
      room.lastClock = null;
      this._clearGameTimers(room); // re-arm the current turn with the new limit
    }
    if (hints !== undefined) room.settings.hints = hints;
    if (t !== undefined) room.settings.targetScore = t;
    if (pool !== undefined) room.settings.poolLimit = pool;
    const before = this._tableShape(room);
    if (gameType !== undefined) room.settings.gameType = gameType;
    if (n !== undefined) room.settings.players = n;
    if (this._tableShape(room) !== before) this._changeTable(room);
    this._afterChange(room);
    return ok();
  }

  onStart(conn) {
    const ctx = this._hostCtx(conn);
    if (ctx.error) return fail(ctx.error);
    const { room } = ctx;
    if (!this._isLobby(room)) return fail('Game already in progress');
    if (room.seats.some((s) => s === null)) return fail(`All ${room.seats.length} seats must be filled`);
    const mod = getGame(room.settings.gameType);
    this._clearGameTimers(room);
    room.lastClock = null;
    room.game = mod.createGame(room.settings, room.seats.map((_, i) => i));
    room.gameMod = mod;
    room.status = 'playing';
    room.history.hands = [];
    room.recorded = null;
    room.pauseKey = mod.pauseKey(mod.getView(room.game, null));
    room.pauseUntil = 0;
    this._afterChange(room);
    return ok();
  }

  onAction(conn, action) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    const { room, player } = ctx;
    if (room.status !== 'playing' || !room.game) return fail('No game in progress');
    if (player.seat === null) return fail('Spectators cannot act');
    if (typeof action.type !== 'string') return fail('Invalid action');
    const mod = room.gameMod;
    const clean = { type: action.type };
    for (const k of mod.actionFields) if (k in action) clean[k] = action[k];
    const res = this._apply(room, player.seat, clean);
    if (res.ok) {
      const note = mod.actionNotice(clean, mod.getView(room.game, null), player.name);
      if (note) this._systemChat(room, note);
    }
    return res.ok ? ok() : fail(res.error || 'Illegal action');
  }

  onChat(conn, { text }) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    const { room, player } = ctx;
    if (typeof text !== 'string') return fail('Invalid message');
    const msg = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, this.opts.maxChatLength);
    if (!msg) return fail('Empty message');
    const now = Date.now();
    player.chatTimes = player.chatTimes.filter((t) => now - t < this.opts.chatWindow);
    if (player.chatTimes.length >= this.opts.chatLimit) return fail('You are sending messages too fast');
    player.chatTimes.push(now);
    const out = { name: player.name, seat: player.seat, text: msg, ts: now };
    for (const p of room.players.values()) if (p.conn) p.conn.emit('chat:message', out);
    return ok();
  }

  // ----------------------------------------------------------- hints & reactions

  /** Suggest a move for the asking player (one hint per move). May resolve asynchronously. */
  onHint(conn) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    const { room, player } = ctx;
    if (!room.settings.hints) return fail('Hints are turned off for this room');
    if (room.status !== 'playing' || !room.game || player.seat === null) return fail('No game to give hints for');
    const game = room.game;
    const mod = room.gameMod;
    if (mod.currentTurn(game) !== player.seat) return fail("It's not your turn");
    const view = mod.getView(game, player.seat);
    if (!mod.options(view).length) return fail('Nothing to decide right now');
    if (player.hintSeq === view.seq) return fail('You already got a hint for this move');
    player.hintSeq = view.seq;
    const answer = (action, reason, source) => ok({ action, label: mod.describe(action, view), reason, source });
    const classic = () => {
      const a = mod.hintAction(view);
      return a ? answer(a, 'Suggested by the classic bot.', 'classic') : fail('Nothing to decide right now');
    };
    if (!this.hinter || !mod.claude) return classic();
    const names = room.seats.map((pid) => room.players.get(pid)?.name);
    return Promise.resolve()
      .then(() => this.hinter(view, names))
      .then((res) => {
        if (!res?.action || !mod.isLegal(view, res.action)) return classic();
        return answer(res.action, res.reason || '', 'claude');
      })
      .catch((err) => {
        this.logger.warn?.(`[rooms] Claude hint failed: ${err?.message || err}`);
        return classic();
      });
  }

  onReact(conn, { emoji } = {}) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    const { room, player } = ctx;
    if (!REACTIONS.includes(emoji)) return fail('Unknown reaction');
    const now = Date.now();
    player.reactTimes = player.reactTimes.filter((t) => now - t < 4000);
    if (player.reactTimes.length >= 4) return fail('Slow down a little');
    player.reactTimes.push(now);
    const out = { playerId: player.playerId, seat: player.seat, name: player.name, emoji, ts: now };
    for (const p of room.players.values()) if (p.conn) p.conn.emit('room:reaction', out);
    return ok();
  }

  _systemChat(room, text) {
    const out = { name: 'Table', seat: null, text, ts: Date.now(), system: true };
    for (const p of room.players.values()) if (p.conn) p.conn.emit('chat:message', out);
  }

  // --------------------------------------------------------------- voice chat
  // WebRTC mesh: the server only relays signaling between players in the same
  // room. The joiner sends offers to every peer already in voice.

  onVoiceJoin(conn) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    const { room, player } = ctx;
    const peers = [...room.players.values()]
      .filter((p) => p !== player && p.voice && p.conn)
      .map((p) => p.playerId);
    if (!player.voice && peers.length >= 7) return fail('Voice chat is full');
    player.voice = true;
    player.muted = false;
    this._afterChange(room);
    return ok({ peers, iceServers: this._iceServers() });
  }

  onVoiceLeave(conn) {
    const ctx = this._ctx(conn);
    if (!ctx) return ok();
    this._voiceDrop(ctx.room, ctx.player);
    this._afterChange(ctx.room);
    return ok();
  }

  onVoiceMute(conn, { muted } = {}) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    if (!ctx.player.voice) return fail('Not in voice chat');
    ctx.player.muted = !!muted;
    this._afterChange(ctx.room);
    return ok();
  }

  onVoiceSignal(conn, { to, data } = {}) {
    const ctx = this._ctx(conn);
    if (!ctx) return fail('Not in a room');
    const { room, player } = ctx;
    if (!player.voice) return fail('Not in voice chat');
    const target = typeof to === 'string' ? room.players.get(to) : null;
    if (!target || !target.voice || !target.conn) return fail('Peer not in voice chat');
    if (!data || typeof data !== 'object' || JSON.stringify(data).length > 12000) return fail('Invalid signal');
    target.conn.emit('voice:signal', { from: player.playerId, data });
    return ok();
  }

  _voiceDrop(room, player) {
    if (!player.voice) return;
    player.voice = false;
    player.muted = false;
    for (const p of room.players.values()) {
      if (p !== player && p.voice && p.conn) p.conn.emit('voice:peer-left', { playerId: player.playerId });
    }
  }

  _iceServers() {
    if (this.opts.iceServers) return this.opts.iceServers;
    const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (process.env.TURN_URL) {
      list.push({
        urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
        username: process.env.TURN_USERNAME || undefined,
        credential: process.env.TURN_CREDENTIAL || undefined,
      });
    }
    return list;
  }

  // ------------------------------------------------------------------ helpers

  _newRoom() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = {
      code,
      hostId: null,
      players: new Map(), // playerId -> player (humans + bots)
      seats: [null, null, null, null], // playerId | null; length = module.seatCount(settings)
      status: 'lobby',
      settings: {
        gameType: DEFAULT_GAME, targetScore: 5, botBrain: 'classic', turnTimer: 45, hints: true,
        players: DEFAULT_PLAYERS, poolLimit: DEFAULT_POOL_LIMIT, // rummy
      },
      history: { hands: [], matches: [], series: [0, 0] },
      game: null,
      gameMod: null,     // module that created `game`
      recorded: null,    // history dedupe marker (owned by the module)
      pauseKey: null,
      lastClock: null,   // { seat, game, endsAt } for modules with clockPerTurn
      botTimer: null,
      nextHandTimer: null,
      cleanupTimer: null,
      timerKey: null,
      pauseUntil: 0,
      destroyed: false,
    };
    this.rooms.set(code, room);
    return room;
  }

  _addHuman(room, name) {
    const player = {
      playerId: randomId('p_'),
      token: crypto.randomUUID(),
      name,
      isBot: false,
      seat: null,
      connected: false,
      conn: null,
      connId: null,
      botControlled: false,
      takeoverTimer: null,
      chatTimes: [],
      reactTimes: [],
      hintSeq: -1,
    };
    room.players.set(player.playerId, player);
    return player;
  }

  _addBot(room, seat) {
    const used = new Set([...room.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${seat + 1}`;
    const bot = { playerId: randomId('b_'), name, isBot: true, seat, connected: true };
    room.players.set(bot.playerId, bot);
    room.seats[seat] = bot.playerId;
    return bot;
  }

  _bind(conn, room, player) {
    // Detach any older connection this player had (e.g. a second tab / stale socket).
    if (player.connId && player.connId !== conn.id) this.conns.delete(player.connId);
    this._voiceDrop(room, player); // a new connection must re-join voice
    player.conn = conn;
    player.connId = conn.id;
    player.connected = true;
    this.conns.set(conn.id, { conn, code: room.code, playerId: player.playerId });
    if (player.takeoverTimer) {
      clearTimeout(player.takeoverTimer);
      player.takeoverTimer = null;
    }
    if (player.botControlled) player.botControlled = false; // hand the seat back
  }

  _joined(room, player) {
    this._afterChange(room);
    return ok({ code: room.code, playerId: player.playerId, token: player.token });
  }

  /** Leave whatever room this conn is bound to (used before create/join). */
  _detach(conn) {
    const ctx = this._ctx(conn);
    if (ctx) this._removePlayer(ctx.room, ctx.player);
    this.conns.delete(conn.id);
  }

  _ctx(conn) {
    const b = this.conns.get(conn.id);
    if (!b) return null;
    const room = this.rooms.get(b.code);
    const player = room?.players.get(b.playerId);
    if (!room || !player || player.connId !== conn.id) return null;
    return { room, player };
  }

  _hostCtx(conn) {
    const ctx = this._ctx(conn);
    if (!ctx) return { error: 'Not in a room' };
    if (ctx.room.hostId !== ctx.player.playerId) return { error: 'Only the host can do that' };
    return ctx;
  }

  _isLobby(room) {
    // After matchEnd the room behaves like a lobby again (seat changes, settings, restart).
    return room.status === 'lobby' || (!!room.game && room.gameMod.isOver(room.gameMod.getView(room.game, null)));
  }

  /** The module for the current game, or for the selected game type in the lobby. */
  _mod(room) {
    return room.game ? room.gameMod : getGame(room.settings.gameType);
  }

  /** What identifies the table layout + series: game type and seat count. */
  _tableShape(room) {
    const mod = getGame(room.settings.gameType);
    return `${mod.id}:${mod.seatCount(room.settings)}`;
  }

  /**
   * Game type or player count changed (lobby only): drop any finished game,
   * resize the seats and reset the room's history/series (they are per table shape).
   * Bots in removed seats leave; humans move to a free seat if there is one,
   * otherwise they become spectators.
   */
  _changeTable(room) {
    const mod = getGame(room.settings.gameType);
    const n = mod.seatCount(room.settings);
    if (room.game) {
      this._clearGameTimers(room);
      room.game = null;
      room.gameMod = null;
      room.status = 'lobby';
    }
    const displaced = [];
    while (room.seats.length > n) {
      const pid = room.seats.pop();
      const p = pid && room.players.get(pid);
      if (!p) continue;
      p.seat = null;
      if (p.isBot) room.players.delete(pid);
      else displaced.push(p);
    }
    while (room.seats.length < n) room.seats.push(null);
    for (const p of displaced) {
      const free = room.seats.indexOf(null);
      if (free < 0) continue; // stays a spectator
      room.seats[free] = p.playerId;
      p.seat = free;
    }
    room.history = { hands: [], matches: [], series: mod.newSeries(room.settings) };
    room.recorded = null;
  }

  _removePlayer(room, player) {
    this._voiceDrop(room, player);
    if (player.takeoverTimer) clearTimeout(player.takeoverTimer);
    player.takeoverTimer = null;
    if (player.conn) this.conns.delete(player.connId);
    player.conn = null;
    player.connId = null;
    player.connected = false;
    room.players.delete(player.playerId);
    if (player.seat !== null) {
      const seat = player.seat;
      room.seats[seat] = null;
      // Mid-game the seat cannot be empty: a bot takes it over permanently.
      if (room.status === 'playing' && !this._isLobby(room)) this._addBot(room, seat);
    }
    if (room.hostId === player.playerId) this._transferHost(room);
    this._afterChange(room);
  }

  _transferHost(room) {
    const humans = [...room.players.values()].filter((p) => !p.isBot && p.playerId !== room.hostId);
    const pick =
      humans.find((p) => p.connected && p.seat !== null) ??
      humans.find((p) => p.connected) ??
      humans[0] ?? null;
    room.hostId = pick ? pick.playerId : null;
  }

  _startTakeoverTimer(room, player) {
    if (player.takeoverTimer) clearTimeout(player.takeoverTimer);
    player.takeoverTimer = setTimeout(() => {
      player.takeoverTimer = null;
      if (room.destroyed || player.connected || room.players.get(player.playerId) !== player) return;
      player.botControlled = true;
      // A long-gone host can't run the lobby; hand it to someone present.
      if (room.hostId === player.playerId && [...room.players.values()].some((p) => !p.isBot && p.connected)) {
        this._transferHost(room);
      }
      this._afterChange(room);
    }, this.opts.takeoverDelay);
    player.takeoverTimer.unref?.();
  }

  _connectedHumans(room) {
    let n = 0;
    for (const p of room.players.values()) if (!p.isBot && p.connected) n++;
    return n;
  }

  /** Broadcast + reschedule timers + empty-room bookkeeping. Call after any change. */
  _afterChange(room) {
    if (room.destroyed) return;
    if (room.players.size === 0 || ![...room.players.values()].some((p) => !p.isBot)) {
      // No humans at all: nothing to keep alive for.
      this._destroyRoom(room);
      return;
    }
    this._updateCleanup(room);
    this._schedule(room); // before broadcasting so the view carries the new turn clock
    this._broadcast(room);
  }

  _updateCleanup(room) {
    const empty = this._connectedHumans(room) === 0;
    if (empty && !room.cleanupTimer) {
      room.cleanupTimer = setTimeout(() => this._destroyRoom(room), this.opts.emptyRoomTtl);
      room.cleanupTimer.unref?.();
    } else if (!empty && room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
  }

  _clearGameTimers(room) {
    if (room.botTimer) clearTimeout(room.botTimer);
    if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
    room.botTimer = null;
    room.nextHandTimer = null;
    room.timerKey = null;
    room.turnClock = null;
  }

  _destroyRoom(room) {
    if (room.destroyed) return;
    room.destroyed = true;
    this._clearGameTimers(room);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
    for (const p of room.players.values()) {
      if (p.takeoverTimer) clearTimeout(p.takeoverTimer);
      p.takeoverTimer = null;
      if (p.connId) this.conns.delete(p.connId);
    }
    this.rooms.delete(room.code);
  }

  _seatView(room, pid) {
    if (pid === null) return null;
    const p = room.players.get(pid);
    if (!p) return null;
    return { playerId: p.playerId, name: p.name, isBot: !!p.isBot, connected: !!p.connected, botControlled: !!p.botControlled, voice: !!p.voice, muted: !!p.muted, ai: (p.isBot || p.botControlled) ? this._brain(room) : null };
  }

  roomView(room, player) {
    const seat = player ? player.seat : null;
    return {
      code: room.code,
      hostId: room.hostId,
      you: {
        playerId: player ? player.playerId : null,
        seat,
        isHost: !!player && room.hostId === player.playerId,
      },
      seats: room.seats.map((pid) => this._seatView(room, pid)),
      spectators: [...room.players.values()]
        .filter((p) => !p.isBot && p.seat === null)
        .map((p) => ({ playerId: p.playerId, name: p.name, connected: !!p.connected, voice: !!p.voice, muted: !!p.muted })),
      status: room.status,
      gameType: room.settings.gameType,
      settings: {
        ...room.settings,
        claudeAvailable: !!this.llm && !!this._mod(room).claude,
        hintSource: this.hinter && this._mod(room).claude ? 'claude' : 'classic',
      },
      turnClock: room.turnClock && room.turnClock.endsAt > Date.now()
        ? { seat: room.turnClock.seat, endsIn: room.turnClock.endsAt - Date.now(), total: room.turnClock.total }
        : null,
      history: room.history,
      game: room.game ? room.gameMod.getView(room.game, seat) : null,
    };
  }

  _broadcast(room) {
    for (const p of room.players.values()) {
      if (p.isBot || !p.conn) continue;
      try {
        p.conn.emit('room:state', this.roomView(room, p));
      } catch (err) {
        this.logger.error?.('[rooms] broadcast failed:', err);
      }
    }
  }

  // ------------------------------------------------------------ game driving

  _apply(room, seat, action) {
    const mod = room.gameMod;
    let res;
    try {
      res = mod.applyAction(room.game, seat, action);
    } catch (err) {
      this.logger.error?.('[rooms] engine threw:', err);
      return { ok: false, error: 'Engine error' };
    }
    if (!res || !res.ok) return res || { ok: false, error: 'Illegal action' };
    const view = mod.getView(room.game, null);
    // A completed trick (28) → give everyone time to see it before bots act.
    const key = mod.pauseKey(view);
    if (key !== room.pauseKey) {
      if (key !== null) room.pauseUntil = Date.now() + this.opts.trickPause;
      room.pauseKey = key;
    }
    try {
      mod.recordHistory(view, room, (s) => room.players.get(room.seats[s])?.name ?? `Seat ${s + 1}`);
    } catch (err) {
      this.logger.error?.('[rooms] history failed:', err);
    }
    this._afterChange(room);
    return res;
  }

  _isBotSeat(room, seat) {
    const pid = room.seats[seat];
    const p = pid && room.players.get(pid);
    return !!p && (p.isBot || p.botControlled);
  }

  _schedule(room) {
    if (room.destroyed || room.status !== 'playing' || !room.game || this._connectedHumans(room) === 0) {
      // (No connected humans: don't burn CPU on a bot-only game nobody watches.)
      this._clearGameTimers(room);
      return;
    }
    const game = room.game;
    const mod = room.gameMod;
    const view = mod.getView(game, null);
    const seq = view.seq;
    const turn = mod.currentTurn(game);
    const hasTurn = turn !== null && turn !== undefined;
    let key = null;
    if (mod.isBetween(view)) key = `next:${seq}`;
    else if (!mod.isOver(view) && hasTurn) {
      if (this._isBotSeat(room, turn)) key = `bot:${seq}:${turn}`;
      else if (room.settings.turnTimer > 0) key = `clock:${seq}:${turn}`;
    }
    if (!key || !key.startsWith('clock:') || room.lastClock?.seat !== turn || room.lastClock?.game !== game) room.lastClock = null;
    // Keep an already-pending timer for the same state (e.g. a spectator joining
    // shouldn't postpone the bot).
    if (key && key === room.timerKey && (room.botTimer || room.nextHandTimer)) return;
    if (key && key === room.botThinking) return; // a Claude bot is already deciding this move
    this._clearGameTimers(room);
    room.timerKey = key;
    if (!key) return;

    if (key.startsWith('next:')) {
      room.nextHandTimer = setTimeout(() => {
        room.nextHandTimer = null;
        if (room.destroyed || room.game !== game || mod.getView(game, null).seq !== seq) return; // stale
        // Any seat may advance (28: nextHand; rummy: nextDeal, active seats only).
        const action = { type: mod.nextAction };
        for (let s = 0; s < room.seats.length; s++) {
          if (room.seats[s] !== null && this._apply(room, s, action).ok) return;
        }
        this.logger.error?.(`[rooms] could not auto-advance room ${room.code}`);
      }, this.opts.nextHandDelay);
      return;
    }

    if (key.startsWith('clock:')) {
      // Human turn clock: when it runs out the classic bot plays for them.
      // Modules with clockPerTurn (rummy: draw + discard) keep one deadline for the whole turn.
      const total = room.settings.turnTimer * this.opts.turnTimerUnit;
      let endsAt = Date.now() + Math.max(0, room.pauseUntil - Date.now()) + total;
      if (mod.clockPerTurn) {
        if (room.lastClock) endsAt = room.lastClock.endsAt;
        else room.lastClock = { seat: turn, game, endsAt };
      }
      const delay = Math.max(0, endsAt - Date.now());
      room.turnClock = { seat: turn, endsAt, total };
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        room.turnClock = null;
        if (room.destroyed || room.game !== game) return;
        if (mod.getView(game, null).seq !== seq || mod.currentTurn(game) !== turn || this._isBotSeat(room, turn)) return;
        const p = room.players.get(room.seats[turn]);
        this._systemChat(room, `${p?.name ?? 'A player'} ran out of time — auto-played`);
        this._botActClassic(room, turn);
        // Finish the whole turn (e.g. rummy discard after the draw).
        for (let i = 0; mod.clockPerTurn && i < 4 && room.game === game && !room.destroyed; i++) {
          if (mod.currentTurn(game) !== turn || this._isBotSeat(room, turn) || mod.isBetween(mod.getView(game, null))) break;
          this._botActClassic(room, turn);
        }
      }, delay);
      return;
    }
    const delay = Math.max(this.opts.botDelay, room.pauseUntil - Date.now());
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (room.destroyed || room.game !== game) return; // stale
      if (mod.getView(game, null).seq !== seq || mod.currentTurn(game) !== turn || !this._isBotSeat(room, turn)) return;
      this._botAct(room, turn);
    }, delay);
  }

  _brain(room) {
    return this.llm && this._mod(room).claude && room.settings.botBrain === 'claude' ? 'claude' : 'classic';
  }

  _botAct(room, seat) {
    if (this._brain(room) !== 'claude') return this._botActClassic(room, seat);
    const game = room.game;
    const mod = room.gameMod;
    const view = mod.getView(game, seat);
    const key = room.timerKey;
    room.botThinking = key;
    const names = room.seats.map((pid) => room.players.get(pid)?.name);
    Promise.resolve()
      .then(() => this.llm(view, names))
      .catch((err) => {
        this.logger.warn?.(`[rooms] Claude bot failed, using classic bot: ${err?.message || err}`);
        return null;
      })
      .then((res) => {
        if (room.botThinking === key) room.botThinking = null;
        // Stale? (state moved on, room gone, or seat handed back to a human)
        if (room.destroyed || room.game !== game || mod.getView(game, null).seq !== view.seq || mod.currentTurn(game) !== seat || !this._isBotSeat(room, seat)) {
          if (!room.destroyed) this._schedule(room);
          return;
        }
        if (res?.action) {
          if (res.say) this._botSay(room, seat, res.say);
          const r = this._apply(room, seat, res.action);
          if (r.ok) return;
          this.logger.warn?.(`[rooms] Claude bot action rejected (${r.error}):`, res.action);
        }
        this._botActClassic(room, seat);
      });
  }

  _botSay(room, seat, text) {
    const p = room.players.get(room.seats[seat]);
    if (!p) return;
    const out = { name: p.name, seat, text, ts: Date.now(), bot: true };
    for (const q of room.players.values()) if (q.conn) q.conn.emit('chat:message', out);
  }

  _botActClassic(room, seat) {
    const mod = room.gameMod;
    const view = mod.getView(room.game, seat);
    let action = null;
    try {
      action = mod.botAction(view);
    } catch (err) {
      this.logger.error?.('[rooms] bot threw:', err);
    }
    if (action) {
      const res = this._apply(room, seat, action);
      if (res.ok) return;
      this.logger.warn?.(`[rooms] bot action rejected (${res.error}):`, action);
    }
    // Fallback: any legal action so the game never stalls.
    for (const a of mod.fallbackActions(view)) {
      if (this._apply(room, seat, a).ok) return;
    }
    this.logger.error?.(`[rooms] bot at seat ${seat} in room ${room.code} could not act`);
  }
}
