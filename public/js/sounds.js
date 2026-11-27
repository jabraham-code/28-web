// Sound effects (synthesised with WebAudio, no assets) and haptics.
// Watches RoomView updates and plays cues for deals, plays, tricks, turns, etc. (28 only;
// the Rummy table calls sounds.play(name) itself). Turn-clock warnings apply to every game.

const KEY = '28.sound';

export class Sounds {
  constructor() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    this.enabled = saved !== 'off';
    this.ctx = null;
    this.prev = null;
    this.warnTimers = [];
    this.listeners = new Set();
    // Browsers only allow audio after a user gesture.
    const unlock = () => { this._ensure(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  onChange(fn) { this.listeners.add(fn); }

  toggle(on = !this.enabled) {
    this.enabled = on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
    if (on) { this._ensure(); this.play('pop'); }
    this.listeners.forEach((fn) => fn(this.enabled));
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  vibrate(pattern) {
    if (!this.enabled) return;
    try { navigator.vibrate?.(pattern); } catch {}
  }

  // ------------------------------------------------------------ synth primitives
  _tone(freq, { at = 0, dur = 0.18, type = 'sine', gain = 0.25, slide = 0 } = {}) {
    const c = this.ctx; const t = c.currentTime + at;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise({ at = 0, dur = 0.07, gain = 0.3, freq = 2400, q = 0.8 } = {}) {
    const c = this.ctx; const t = c.currentTime + at;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  play(name, opt = {}) {
    if (!this.enabled || !this._ensure()) return;
    switch (name) {
      case 'card': this._noise({ dur: 0.08, gain: 0.45, freq: 2800 }); this._noise({ at: 0.03, dur: 0.05, gain: 0.25, freq: 900 }); break;
      case 'deal': for (let i = 0; i < (opt.count || 8); i++) this._noise({ at: i * 0.055, dur: 0.04, gain: 0.18, freq: 3200 }); break;
      case 'bid': this._tone(660, { dur: 0.09, type: 'triangle', gain: 0.12 }); break;
      case 'turn': this._tone(880, { dur: 0.16, gain: 0.16 }); this._tone(1320, { at: 0.11, dur: 0.22, gain: 0.13 }); break;
      case 'warn': this._tone(1000, { dur: 0.06, type: 'square', gain: 0.05 }); break;
      case 'trick': opt.mine
        ? (this._tone(784, { dur: 0.18, gain: 0.14 }), this._tone(1175, { at: 0.09, dur: 0.28, gain: 0.12 }))
        : this._tone(523, { dur: 0.2, type: 'triangle', gain: 0.1 }); break;
      case 'trump': this._tone(300, { dur: 0.45, type: 'sawtooth', gain: 0.06, slide: 3 }); this._tone(1046, { at: 0.35, dur: 0.35, gain: 0.12 }); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this._tone(f, { at: i * 0.11, dur: 0.3, gain: 0.14 })); break;
      case 'lose': [523, 466, 392].forEach((f, i) => this._tone(f, { at: i * 0.16, dur: 0.32, type: 'triangle', gain: 0.12 })); break;
      case 'fanfare': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this._tone(f, { at: i * 0.13, dur: 0.35, type: 'triangle', gain: 0.15 })); break;
      case 'pop': this._tone(500, { dur: 0.12, gain: 0.14, slide: 2.2 }); break;
      case 'hint': this._tone(1568, { dur: 0.25, gain: 0.08 }); this._tone(2093, { at: 0.08, dur: 0.3, gain: 0.06 }); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ state-driven cues
  update(room) {
    const g = room?.game;
    const p = this.prev;
    this.prev = g ? { g, seat: room.you.seat } : null;
    this._clock(room); // turn-clock warnings are game-agnostic
    // The cues below read 28 views; other games (rummy) call play() themselves.
    if (!g || g.gameType === 'rummy' || !p || p.g.gameType === 'rummy' || p.seat !== room.you.seat) return;
    const pg = p.g;
    if (pg.seq === g.seq && pg.handNumber === g.handNumber) return;
    const me = room.you.seat;
    const myTeam = me == null ? null : me % 2;
    const sum = (a) => (a || []).reduce((x, y) => x + y, 0);

    // deal
    const dealt = sum(g.handCounts) - sum(pg.handCounts);
    if (g.handNumber !== pg.handNumber || dealt >= 4) { this.play('deal', { count: Math.min(16, Math.max(8, dealt)) }); return; }

    // card plays and tricks
    const plays = (v) => sum(v.tricksWon) * 4 + (v.phase === 'playing' && !(v.lastTrick && v.trick?.index === v.lastTrick.index) ? v.trick?.cards?.length || 0 : 0);
    if (plays(g) > plays(pg)) this.play('card');
    if (sum(g.tricksWon) > sum(pg.tricksWon) && g.lastTrick) {
      const mine = myTeam != null && g.lastTrick.winner % 2 === myTeam;
      setTimeout(() => this.play('trick', { mine }), 380);
      if (mine && g.lastTrick.winner === me) this.vibrate(25);
    }
    // bidding
    if ((g.bidding?.history?.length || 0) > (pg.bidding?.history?.length || 0)) this.play('bid');
    // trump revealed
    if (!pg.trump?.revealed && g.trump?.revealed) setTimeout(() => this.play('trump'), 150);
    // hand / match end
    if (pg.phase !== g.phase && (g.phase === 'handEnd' || g.phase === 'matchEnd')) {
      setTimeout(() => {
        if (g.phase === 'matchEnd') { if (myTeam == null || g.matchWinner === myTeam) this.play('fanfare'); else this.play('lose'); return; }
        const r = g.handResult; if (!r) return;
        const good = myTeam == null ? r.made : (r.biddingTeam === myTeam) === r.made;
        this.play(good ? 'win' : 'lose');
      }, 1500);
    }
    // my turn
    const myTurn = me != null && g.turn === me && (g.legal?.actions || []).length;
    const wasMine = me != null && pg.turn === me && pg.phase === g.phase;
    if (myTurn && !wasMine) { setTimeout(() => this.play('turn'), 250); this.vibrate(40); }
  }

  _clock(room) {
    this.warnTimers.forEach(clearTimeout);
    this.warnTimers = [];
    const tc = room?.turnClock;
    if (!tc || room.you.seat == null || tc.seat !== room.you.seat) return;
    for (const left of [10000, 5000, 3000, 2000, 1000]) {
      const at = tc.endsIn - left;
      if (at > 0) this.warnTimers.push(setTimeout(() => { this.play('warn'); if (left === 5000) this.vibrate([30, 60, 30]); }, at));
    }
  }
}
