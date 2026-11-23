// Live voice chat: WebRTC audio mesh between the humans in a room.
// Signaling goes through the game server (voice:* socket events); audio flows
// peer-to-peer. The player who joins sends offers to everyone already in voice.

const SPEAK_THRESHOLD = 0.04; // RMS level that counts as talking

export class Voice {
  constructor(net) {
    this.net = net;
    this.active = false;
    this.joining = false;
    this.muted = false;
    this.stream = null;
    this.iceServers = [];
    this.peers = new Map();      // playerId -> { pc, audio, pending: [] }
    this.peerMuted = new Set();  // playerIds I have muted locally
    this.speaking = new Set();   // playerIds (and 'me') currently talking
    this.meters = new Map();     // id -> { analyser, buf, src }
    this.listeners = new Set();
    this.ctx = null;
    this.raf = 0;

    net.socket.on('voice:signal', ({ from, data }) => this._onSignal(from, data).catch((e) => console.warn('[voice] signal', e)));
    net.socket.on('voice:peer-left', ({ playerId }) => this._closePeer(playerId));
    net.on('state', (r) => this._onState(r));
  }

  get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _changed() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } }

  async join() {
    if (this.active || this.joining) return;
    if (!this.supported) throw new Error('Voice chat needs a secure (https) page and a browser with microphone support');
    this.joining = true;
    this._changed();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.muted = false;
      await this._register();
      this._meter('me', this.stream);
    } catch (err) {
      this._stopStream();
      if (err?.name === 'NotAllowedError') throw new Error('Microphone permission was denied');
      if (err?.name === 'NotFoundError') throw new Error('No microphone found');
      throw err;
    } finally {
      this.joining = false;
      this._changed();
    }
  }

  async _register() {
    const res = await this.net._request('voice:join', {});
    if (!res.ok) throw new Error(res.error || 'Could not join voice chat');
    this.iceServers = res.iceServers || [];
    this.active = true;
    if (this.muted) this.net._request('voice:mute', { muted: true });
    for (const pid of res.peers || []) this._call(pid).catch((e) => console.warn('[voice] call', e));
  }

  leave() {
    if (!this.active && !this.joining) return;
    this.net._request('voice:leave', {}).catch(() => {});
    this._teardown();
  }

  /** Local teardown only (used when leaving the room too). */
  _teardown() {
    for (const pid of [...this.peers.keys()]) this._closePeer(pid);
    this._stopStream();
    this.active = false;
    this.muted = false;
    this.speaking.clear();
    this._changed();
  }

  setMuted(muted) {
    this.muted = !!muted;
    for (const t of this.stream?.getAudioTracks() || []) t.enabled = !this.muted;
    if (this.active) this.net._request('voice:mute', { muted: this.muted }).catch(() => {});
    this._changed();
  }

  setPeerMuted(pid, muted) {
    if (muted) this.peerMuted.add(pid); else this.peerMuted.delete(pid);
    const p = this.peers.get(pid);
    if (p?.audio) p.audio.muted = muted;
    this._changed();
  }

  // ------------------------------------------------------------ WebRTC plumbing

  _peer(pid) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pc, audio: null, pending: [] };
    this.peers.set(pid, peer);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = (e) => { if (e.candidate) this._signal(pid, { candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      const [remote] = e.streams;
      if (!remote || peer.audio) return;
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = remote;
      audio.muted = this.peerMuted.has(pid);
      audio.play().catch(() => {});
      peer.audio = audio;
      this._meter(pid, remote);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.warn(`[voice] connection to ${pid} failed (a TURN server may be needed on this network)`);
        this._closePeer(pid);
      }
    };
    return peer;
  }

  async _call(pid) {
    if (this.peers.has(pid)) this._closePeer(pid);
    const { pc } = this._peer(pid);
    await pc.setLocalDescription(await pc.createOffer());
    this._signal(pid, { sdp: pc.localDescription.toJSON() });
  }

  async _onSignal(from, data) {
    if (!this.active || !data) return;
    if (data.sdp?.type === 'offer') {
      if (this.peers.has(from)) this._closePeer(from);
      const peer = this._peer(from);
      await peer.pc.setRemoteDescription(data.sdp);
      await this._flush(peer);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      this._signal(from, { sdp: peer.pc.localDescription.toJSON() });
    } else if (data.sdp?.type === 'answer') {
      const peer = this.peers.get(from);
      if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription(data.sdp);
      await this._flush(peer);
    } else if (data.candidate) {
      const peer = this.peers.get(from);
      if (!peer) return;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  }

  async _flush(peer) {
    const list = peer.pending.splice(0);
    for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  _signal(to, data) {
    this.net._request('voice:signal', { to, data }).catch(() => {});
  }

  _closePeer(pid) {
    const p = this.peers.get(pid);
    if (!p) return;
    this.peers.delete(pid);
    try { p.pc.close(); } catch {}
    if (p.audio) { p.audio.srcObject = null; }
    this._unmeter(pid);
    this._changed();
  }

  _stopStream() {
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.stream = null;
    this._unmeter('me');
  }

  /** If the server forgot us (socket reconnected), quietly re-join. */
  _onState(r) {
    if (!this.active || this.joining || this.rejoining || !r?.you?.playerId) return;
    const me = [...r.seats, ...r.spectators].find((p) => p && p.playerId === r.you.playerId);
    if (!me || me.voice) return;
    this.rejoining = true;
    for (const pid of [...this.peers.keys()]) this._closePeer(pid);
    this._register()
      .catch((e) => { console.warn('[voice] rejoin failed', e); this._teardown(); })
      .finally(() => { this.rejoining = false; this._changed(); });
  }

  // ------------------------------------------------------------ speaking meters

  _meter(id, stream) {
    if (!this.ctx) return;
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.meters.set(id, { analyser, src, buf: new Float32Array(analyser.fftSize) });
      if (!this.raf) this._tick();
    } catch (e) { console.warn('[voice] meter', e); }
  }

  _unmeter(id) {
    const m = this.meters.get(id);
    if (!m) return;
    try { m.src.disconnect(); } catch {}
    this.meters.delete(id);
    if (this.speaking.delete(id)) this._changed();
  }

  _tick() {
    if (this.meters.size === 0) { this.raf = 0; return; }
    let changed = false;
    for (const [id, m] of this.meters) {
      m.analyser.getFloatTimeDomainData(m.buf);
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) sum += m.buf[i] * m.buf[i];
      const rms = Math.sqrt(sum / m.buf.length);
      const silenced = id === 'me' ? this.muted : this.peerMuted.has(id);
      const talking = !silenced && rms > SPEAK_THRESHOLD;
      // small hold so the glow doesn't flicker between syllables
      if (talking) m.hold = 8; else if (m.hold > 0) m.hold--;
      const on = talking || m.hold > 0;
      if (on !== this.speaking.has(id)) { if (on) this.speaking.add(id); else this.speaking.delete(id); changed = true; }
    }
    if (changed) this._changed();
    this.raf = requestAnimationFrame(() => this._tick());
  }
}
