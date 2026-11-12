// Voice radio between the real players of a challenge.
// The voice goes phone to phone (WebRTC, encrypted). The challenge room channel carries only the
// "handshake" messages. When two phones cannot reach each other directly (some mobile networks), the call
// goes through Cloudflare's TURN relay; short-lived relay credentials come from our server function.
import { SUPABASE_URL, SUPABASE_KEY } from "./api.js";

const FALLBACK_ICE = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

export class Radio {
  // send(type, data) / on(type, fn): the room channel; me: my name; token(): session token
  constructor({ send, on, me, token, onChange }) {
    this.send = send; this.me = me; this.token = token; this.onChange = onChange || (() => {});
    this.on = false; this.muted = false; this.stream = null; this.ice = null; this.iceAt = 0;
    this.peers = new Map();          // name -> { pc, audio, state }
    this.wanted = new Set();         // names that have their radio on
    on("radio", (m) => this.onHello(m));
    on("rtc", (m) => { if (m.to === this.me) this.onSignal(m); });
  }
  async iceServers() {
    if (this.ice && Date.now() - this.iceAt < 60 * 60 * 1000) return this.ice;
    try {
      const r = await fetch(SUPABASE_URL + "/functions/v1/faro-turn", {
        method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ token: this.token() })
      });
      const j = await r.json();
      if (j && Array.isArray(j.iceServers)) { this.ice = j.iceServers; this.iceAt = Date.now(); return this.ice; }
    } catch (_) { /* no relay: direct connections only */ }
    return FALLBACK_ICE;
  }
  // turn the radio on: needs the microphone (the browser asks the first time)
  async start() {
    if (this.on) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return "unsupported";
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { return "denied"; }
    this.on = true; this.muted = false;
    await this.iceServers();
    this.hello();
    for (const n of this.wanted) this.maybeConnect(n);
    this.onChange();
    return true;
  }
  stop(silent) {
    if (!silent && this.on) this.send("radio", { n: this.me, on: false });
    this.on = false;
    for (const n of [...this.peers.keys()]) this.drop(n);
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
    this.onChange();
  }
  setMuted(m) {
    this.muted = m;
    if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = !m;
    this.onChange();
  }
  hello() { this.send("radio", { n: this.me, on: this.on }); }
  onHello(m) {
    if (m.n === this.me) return;
    if (m.ask && this.on) this.hello();           // a newcomer asks who is on air
    if (m.on) {
      const isNew = !this.wanted.has(m.n);
      this.wanted.add(m.n);
      if (this.on && isNew) this.hello();       // let the newcomer know I'm on air too
      this.maybeConnect(m.n);
    } else { this.wanted.delete(m.n); this.drop(m.n); }
    this.onChange();
  }
  // only one side starts the call (the alphabetically smaller name), so the two never collide
  maybeConnect(n) {
    if (!this.on || !this.wanted.has(n) || this.peers.has(n)) return;
    if (this.me < n) this.call(n);
  }
  async makePeer(n) {
    const pc = new RTCPeerConnection({ iceServers: await this.iceServers() });
    const peer = { pc, audio: null, state: "connecting" };
    this.peers.set(n, peer);
    for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = (e) => { if (e.candidate) this.send("rtc", { from: this.me, to: n, kind: "ice", data: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (!peer.audio) {
        peer.audio = document.createElement("audio");
        peer.audio.autoplay = true; peer.audio.setAttribute("playsinline", "");
        document.body.appendChild(peer.audio);
      }
      peer.audio.srcObject = e.streams[0];
      peer.audio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === "failed") { this.drop(n); setTimeout(() => this.maybeConnect(n), 2000); }
      this.onChange();
    };
    return peer;
  }
  async call(n) {
    const peer = await this.makePeer(n);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.send("rtc", { from: this.me, to: n, kind: "offer", data: { type: offer.type, sdp: offer.sdp } });
  }
  async onSignal(m) {
    if (!this.on) return;
    const n = m.from;
    let peer = this.peers.get(n);
    try {
      if (m.kind === "offer") {
        if (peer) this.drop(n);
        peer = await this.makePeer(n);
        await peer.pc.setRemoteDescription(m.data);
        const ans = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(ans);
        this.send("rtc", { from: this.me, to: n, kind: "answer", data: { type: ans.type, sdp: ans.sdp } });
        for (const c of peer.early || []) await peer.pc.addIceCandidate(c);
      } else if (m.kind === "answer" && peer) {
        await peer.pc.setRemoteDescription(m.data);
        for (const c of peer.early || []) await peer.pc.addIceCandidate(c);
      } else if (m.kind === "ice") {
        if (!peer) return;
        if (!peer.pc.remoteDescription) (peer.early = peer.early || []).push(m.data);
        else await peer.pc.addIceCandidate(m.data);
      }
    } catch (_) { /* a broken handshake: the next hello will retry */ }
  }
  drop(n) {
    const p = this.peers.get(n);
    if (!p) return;
    try { p.pc.close(); } catch (_) {}
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    this.peers.delete(n);
  }
  // for the UI: who I can hear right now
  linked() { return [...this.peers].filter(([, p]) => p.state === "connected").map(([n]) => n); }
}
