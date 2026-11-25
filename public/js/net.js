// Client networking module for 28 Online (SPEC §4). Browser ES module; uses
// the global `io` loaded from /socket.io/socket.io.js.

const SESSION_KEY = '28.session';
const REQUEST_TIMEOUT = 10000;

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* storage unavailable */ }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
}

export class Net {
  constructor() {
    this._listeners = new Map();
    this._state = null;
    this._connectedOnce = false;
    this._resuming = null;
    this.socket = io();

    this.socket.on('connect', () => {
      this._emit('status', 'connected');
      // After a reconnect the server has a fresh socket: rebind our seat.
      if (this._connectedOnce) this.tryResume();
      this._connectedOnce = true;
    });
    this.socket.on('disconnect', () => this._emit('status', 'disconnected'));
    this.socket.io.on('reconnect_attempt', () => this._emit('status', 'reconnecting'));

    this.socket.on('room:state', (view) => {
      this._state = view;
      this._emit('state', view);
    });
    this.socket.on('chat:message', (msg) => this._emit('chat', msg));
    this.socket.on('room:reaction', (r) => this._emit('reaction', r));
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  _emit(event, data) {
    for (const fn of this._listeners.get(event) ?? []) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[net] "${event}" listener failed`, err);
      }
    }
  }

  _request(event, payload = {}, timeout = REQUEST_TIMEOUT) {
    return new Promise((resolve) => {
      this.socket.timeout(timeout).emit(event, payload, (err, res) => {
        if (err) resolve({ ok: false, error: 'Request timed out', timeout: true });
        else resolve(res ?? { ok: false, error: 'No response' });
      });
    });
  }

  get state() {
    return this._state;
  }

  get session() {
    return loadSession();
  }

  shareLink(code = this._state?.code) {
    return code ? `${location.origin}/?room=${code}` : null;
  }

  async createRoom(name) {
    const res = await this._request('room:create', { name });
    if (res.ok) saveSession({ code: res.code, name, token: res.token });
    return res;
  }

  async joinRoom(code, name) {
    code = String(code ?? '').trim().toUpperCase();
    const stored = loadSession();
    const token = stored && stored.code === code ? stored.token : undefined;
    const res = await this._request('room:join', { code, name, token });
    if (res.ok) saveSession({ code: res.code, name, token: res.token });
    return res;
  }

  tryResume() {
    if (this._resuming) return this._resuming;
    this._resuming = (async () => {
      const s = loadSession();
      if (!s) return false;
      const res = await this.joinRoom(s.code, s.name);
      // Room gone (or similar definitive error): forget it. Keep it on timeouts.
      if (!res.ok && !res.timeout) clearSession();
      return !!res.ok;
    })().finally(() => {
      this._resuming = null;
    });
    return this._resuming;
  }

  async leave() {
    clearSession();
    const res = await this._request('room:leave', {});
    this._state = null;
    return res;
  }

  sit(seat) { return this._request('room:sit', { seat }); }
  stand() { return this._request('room:stand', {}); }
  addBot(seat) { return this._request('room:addBot', { seat }); }
  kick(seat) { return this._request('room:kick', { seat }); }
  setSettings(obj) { return this._request('room:settings', obj ?? {}); }
  start() { return this._request('room:start', {}); }
  action(actionObj) { return this._request('game:action', actionObj ?? {}); }
  chat(text) { return this._request('chat:send', { text }); }
  hint() { return this._request('game:hint', {}, 40000); } // Claude may take a while
  react(emoji) { return this._request('room:react', { emoji }); }
}
