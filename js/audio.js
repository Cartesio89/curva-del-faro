// Engine sounds synthesised live with Web Audio: no sound files to download.
// Each engine = two detuned oscillators at the firing frequency + a sub-octave, through a filter that
// opens with the throttle. RPM comes from speed through a 5-speed gearbox, so you hear the gear changes.
// Character by engine part: V8 = low, uneven burble; supercharger = extra whine; rear engine = rasp.
// Other cars: the 3 nearest get their own (quieter) engine, panned left/right, with Doppler pitch.

const GEARS = [0.28, 0.46, 0.63, 0.8, 1.0];   // share of top speed at the rev limit in each gear
const IDLE = 950, REDLINE = 7200;

function noiseBuffer(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// engine rpm from speed (m/s) and top speed, with a short drop at each upshift
export function rpmFor(v, top) {
  const r = Math.max(0, v) / Math.max(1, top);
  let g = 0;
  while (g < GEARS.length - 1 && r > GEARS[g] * 0.97) g++;
  const lo = g ? GEARS[g - 1] * 0.62 : 0;          // where this gear's rpm band starts
  const t = Math.min(1, Math.max(0, (r - lo) / (GEARS[g] - lo)));
  return { rpm: IDLE + (REDLINE - IDLE) * (g ? 0.45 + 0.55 * t : t), gear: g + 1 };
}

class Voice {
  constructor(ctx, out, kind, level) {
    this.ctx = ctx; this.kind = kind;
    this.cyl = kind.cyl;
    const g = (this.gain = ctx.createGain()); g.gain.value = 0;
    const pan = (this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null);
    const lp = (this.lp = ctx.createBiquadFilter()); lp.type = "lowpass"; lp.Q.value = kind.q; lp.frequency.value = 600;
    this.a = ctx.createOscillator(); this.a.type = "sawtooth";
    this.b = ctx.createOscillator(); this.b.type = "sawtooth"; this.b.detune.value = 9;
    this.sub = ctx.createOscillator(); this.sub.type = "square";
    const ga = ctx.createGain(); ga.gain.value = 0.42;
    const gb = ctx.createGain(); gb.gain.value = 0.32;
    const gs = (this.subGain = ctx.createGain()); gs.gain.value = kind.sub;
    this.a.connect(ga).connect(lp); this.b.connect(gb).connect(lp); this.sub.connect(gs).connect(lp);
    // uneven firing (V8 burble): the volume wobbles at a fraction of the firing rate
    this.wob = ctx.createGain(); this.wob.gain.value = 1;
    lp.connect(this.wob);
    if (kind.burble) {
      this.lfo = ctx.createOscillator(); this.lfo.type = "triangle";
      this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = kind.burble;
      this.lfo.connect(this.lfoGain).connect(this.wob.gain); this.lfo.start();
    }
    // supercharger whine
    if (kind.whine) {
      this.wh = ctx.createOscillator(); this.wh.type = "sine";
      this.whGain = ctx.createGain(); this.whGain.gain.value = 0;
      this.wh.connect(this.whGain).connect(g); this.wh.start();
    }
    this.wob.connect(g);
    if (pan) g.connect(pan).connect(out); else g.connect(out);
    this.level = level;
    for (const o of [this.a, this.b, this.sub]) o.start();
  }
  set(rpm, load, vol, panX, pitch) {
    const t = this.ctx.currentTime, k = 0.05;
    const f = (rpm / 60) * (this.cyl / 2) * pitch * this.kind.pitch;   // firing frequency
    this.a.frequency.setTargetAtTime(f, t, k);
    this.b.frequency.setTargetAtTime(f * 1.005, t, k);
    this.sub.frequency.setTargetAtTime(f / 2, t, k);
    this.lp.frequency.setTargetAtTime(Math.min(9000, f * (2.2 + load * 4.5 * this.kind.bright)), t, 0.06);
    this.gain.gain.setTargetAtTime(vol * this.level * (0.55 + 0.45 * load), t, 0.07);
    if (this.lfo) this.lfo.frequency.setTargetAtTime(f / 4, t, k);
    if (this.wh) { this.wh.frequency.setTargetAtTime(rpm * 0.55 * pitch, t, k); this.whGain.gain.setTargetAtTime(vol * this.level * 0.05 * (0.3 + load) * Math.min(1, rpm / 4000), t, 0.08); }
    if (this.pan) this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, panX)), t, 0.05);
  }
  stop() {
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0, t, 0.05);
    const end = t + 0.4;
    for (const o of [this.a, this.b, this.sub, this.lfo, this.wh]) if (o) { try { o.stop(end); } catch (_) {} }
    setTimeout(() => { try { this.gain.disconnect(); } catch (_) {} }, 600);
  }
}

export function engineKind(car, cfg) {
  const e = (cfg && cfg.engine) || "serie";
  const sporty = car && car.top >= 230;          // the bigger cars get six cylinders
  if (e === "v8") return { cyl: 8, pitch: 0.92, sub: 0.55, q: 3, bright: 0.7, burble: 0.35 };
  if (e === "compressore") return { cyl: sporty ? 6 : 4, pitch: 1, sub: 0.35, q: 4, bright: 1, whine: true };
  if (e === "posteriore") return { cyl: sporty ? 6 : 4, pitch: 1.08, sub: 0.25, q: 6, bright: 1.25 };
  return { cyl: sporty ? 6 : 4, pitch: 1, sub: 0.3, q: 4, bright: 0.9 };
}

export class Sound {
  constructor() {
    this.on = true;
    try { this.on = localStorage.getItem("faro-sound") !== "off"; } catch (_) {}
    this.ctx = null; this.me = null; this.others = [];
  }
  // must be called from a tap/click (browsers only allow audio after a gesture)
  unlock() {
    if (!this.on) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.master = this.ctx.createGain(); this.master.gain.value = 0.55;
      this.master.connect(comp).connect(this.ctx.destination);
      // tyre squeal / gravel: filtered noise
      const n = this.ctx.createBufferSource(); n.buffer = noiseBuffer(this.ctx); n.loop = true;
      this.skidF = this.ctx.createBiquadFilter(); this.skidF.type = "bandpass"; this.skidF.Q.value = 2.5; this.skidF.frequency.value = 1800;
      this.skidG = this.ctx.createGain(); this.skidG.gain.value = 0;
      n.connect(this.skidF).connect(this.skidG).connect(this.master); n.start();
      this.noise = n;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }
  // voices on the radio: engines go quieter so people can hear each other
  duck(on) {
    this.ducked = on;
    if (this.ctx && this.master && this.on) this.master.gain.setTargetAtTime(on ? 0.25 : 0.55, this.ctx.currentTime, 0.2);
  }
  setOn(on) {
    this.on = on;
    try { localStorage.setItem("faro-sound", on ? "on" : "off"); } catch (_) {}
    if (!on) this.stopAll();
    if (this.ctx) this.master.gain.setTargetAtTime(on ? (this.ducked ? 0.25 : 0.55) : 0, this.ctx.currentTime, 0.05);
    if (on) this.unlock();
  }
  startRace(kind) {
    this.stopAll();
    if (!this.on || !this.ctx) return;
    this.me = new Voice(this.ctx, this.master, kind, 0.9);
  }
  stopAll() {
    if (this.me) { this.me.stop(); this.me = null; }
    for (const o of this.others) o.voice.stop();
    this.others = [];
    if (this.skidG && this.ctx) this.skidG.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
  pause(p) {
    if (!this.ctx) return;
    if (p) this.ctx.suspend(); else if (this.on) this.ctx.resume();
  }
  // a: { v, top, gas, brake, skid (0..1), offroad, others: [{ id, ds, dx, v, top, kind }] }
  update(a) {
    if (!this.on || !this.ctx || !this.me) return;
    const { rpm } = rpmFor(a.v, a.top);
    const load = a.gas ? 1 : a.brake ? 0.15 : 0.3;
    this.me.set(rpm, load, 1, 0, 1);
    const t = this.ctx.currentTime;
    this.skidG.gain.setTargetAtTime(Math.min(0.22, a.skid * 0.22), t, 0.05);
    this.skidF.frequency.setTargetAtTime(a.offroad ? 500 : 1800, t, 0.1);
    // the 3 nearest cars get a voice
    const near = (a.others || []).map((o) => ({ ...o, d: Math.hypot(o.ds, o.dx) })).filter((o) => o.d < 70)
      .sort((x, y) => x.d - y.d).slice(0, 3);
    for (const slot of this.others) slot.keep = false;
    for (const o of near) {
      let slot = this.others.find((s) => s.id === o.id);
      if (!slot) { slot = { id: o.id, voice: new Voice(this.ctx, this.master, o.kind, 0.5) }; this.others.push(slot); }
      slot.keep = true;
      const vol = 1 / (1 + o.d / 7);
      // Doppler: closing in = higher pitch
      const closing = Math.sign(o.ds) * (a.v - o.v);
      const pitch = Math.max(0.8, Math.min(1.25, 343 / (343 - closing)));
      slot.voice.set(rpmFor(o.v, o.top).rpm, 0.8, vol, o.dx / 8, pitch);
    }
    this.others = this.others.filter((s) => { if (!s.keep) s.voice.stop(); return s.keep; });
  }
  bump(strength) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise.buffer;
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 380;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(Math.min(0.9, 0.25 + strength * 0.05), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 0.3);
  }
}
