import * as THREE from "three";
import { CircuitWorld } from "./world.js";
import { buildCar, disposeCar } from "./carmodel.js";
import { stepCar, smoothSteer, maxYaw, resolveContact, GRIP_ARCADE, oilSkid, OIL_TIME } from "./physics.js";
import { startFall, stepFall, fallDone, Splashes } from "./fall.js";
import { CARS, COLORS, CIRCUITS, AI_NAMES, PARTS, PART_ORDER, defaultConfig, performance, ROAD_HALF } from "./data.js";

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const CAR_LEN = 4.4, CAR_WID = 1.9;
export const AI_LINE = 1.3;

// The AI field for a circuit: cars and setups in line with the player's car, skill set by the circuit.
// Used for single races and championships, and by the host of an online challenge (then sent to everybody).
export function aiSpecs(circuit, car, cfg, aiNames, count = 5) {
  // AI cars start from the player's car *as it leaves the factory* (so the player's own parts are a real edge),
  // then get a random setup whose effects are visible both on the car and on the stopwatch.
  const pStock0 = performance(car, defaultConfig(car)), pAct = performance(car, cfg);
  // the field also gets 60 % of the player's upgrades: parts stay worth buying (40 % edge) but cannot buy a walkover
  const share = (k) => pStock0[k] * (1 + 0.6 * (pAct[k] / pStock0[k] - 1));
  const pStock = { ...pStock0, topMs: share("topMs"), a0: share("a0"), grip: share("grip"), topKmh: share("topKmh") };
  const ci = Math.max(0, CIRCUITS.indexOf(circuit));
  const LEVEL = [0.97, 0.99, 1.01, 1.03, 1.05, 1.06];
  const level = LEVEL[Math.min(ci, LEVEL.length - 1)];
  // skill = share of the grip limit the AI dares to use (1 = perfect driver). Calibrated on real laps:
  // a good human with a tuned car is around 0.65-0.70. Each circuit asks a bit more.
  const SKILL = [0.58, 0.58, 0.7, 0.64, 0.72, 0.7];   // Curva del Faro: very tight corners, no barriers
  const skill0 = SKILL[Math.min(ci, SKILL.length - 1)];
  const pool = Array.isArray(aiNames) && aiNames.length >= count ? aiNames.slice() : AI_NAMES.slice();
  const names = pool.sort(() => Math.random() - 0.5);
  const out = [];
  for (let j = 0; j < count; j++) {
    const rel = level * rnd(0.98, 1.04) * (j === 0 ? 1.01 : 1); // slot 0 is the pace-setter
    const want = pStock.topKmh * rel;
    const model = CARS.slice().sort((a, b) => Math.abs(a.top - want) - Math.abs(b.top - want))[0];
    const mcfg = { ...defaultConfig(model), color: COLORS[(j * 3 + 1) % COLORS.length] };
    for (const key of PART_ORDER) { const o = PARTS[key].options; mcfg[key] = o[Math.floor(Math.random() * o.length)].id; }
    const mStock = performance(model, defaultConfig(model)), mSet = performance(model, mcfg);
    out.push({
      name: names[j], kind: "ai", carId: model.id, setup: mcfg,
      perf: { topMs: pStock.topMs * rel * (mSet.topMs / mStock.topMs), a0: pStock.a0 * rel * (mSet.a0 / mStock.a0),
              grip: pStock.grip * rnd(0.98, 1.02) * (mSet.grip / mStock.grip),
              // brakes: half of the player's upgrade plus half of its own (never above a car with the best brakes)
              brakeA: pStock0.brakeA * (1 + 0.5 * (pAct.brakeA / pStock0.brakeA - 1) + 0.5 * (mSet.brakeA / mStock.brakeA - 1)) },
      skill: clamp(skill0 + rnd(0, 0.07) + (j === 0 ? 0.02 : 0), 0.5, 0.8), aggr: rnd(0.3, 0.9)
    });
  }
  return out;
}

// Bonus/malus for an online challenge, drawn by the host and sent to everybody.
// Positions are fractions of the lap (the host does not know the exact length before the track is built).
export function circuitItems(count = 18) {
  const bag = [["turbo", 30], ["shield", 22], ["oil", 26], ["cones", 22]];
  const total = bag.reduce((a, b) => a + b[1], 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    let r = Math.random() * total, type = bag[0][0];
    for (const [t, w] of bag) { if ((r -= w) < 0) { type = t; break; } }
    if (type === "oil" && Math.random() < 0.2) continue;   // 20% fewer oil patches, nothing else changes
    // spread evenly with some jitter, away from the start/finish line
    const f = 0.06 + (i + Math.random() * 0.6) / count * 0.9;
    out.push({ id: i, f: Math.round(f * 10000) / 10000, x: Math.round((Math.random() * 7.2 - 3.6) * 10) / 10, type });
  }
  return out;
}

// A lap race on a closed circuit against 5 AI drivers.
// badge with a player's initial: always on top (seen through other cars), same size on screen near or far
function nameBadge(text, color) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  g.fillStyle = color; g.strokeStyle = "#1d1d1f"; g.lineWidth = 10;
  g.beginPath(); g.arc(64, 58, 48, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(46, 100); g.lineTo(64, 124); g.lineTo(82, 100); g.closePath(); g.fillStyle = "#1d1d1f"; g.fill();
  const light = parseInt(color.slice(1, 3), 16) * 0.3 + parseInt(color.slice(3, 5), 16) * 0.59 + parseInt(color.slice(5, 7), 16) * 0.11 > 150;
  g.fillStyle = light ? "#1d1d1f" : "#ffffff";
  g.font = `900 ${text.length > 1 ? 46 : 62}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 64, 61);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false }));
  sp.scale.set(0.055, 0.055, 1); sp.renderOrder = 10; sp.center.set(0.5, 0);
  return sp;
}

export class CircuitRace {
  constructor(renderer, track, circuit, car, cfg, hooks, opts = {}) {
    this.renderer = renderer;
    this.track = track;
    this.circuit = circuit;
    this.car = car;
    this.hooks = hooks;
    this.mobile = !!opts.mobile;
    const scene = (this.scene = new THREE.Scene());
    this.splashes = new Splashes(scene); this.camSnap = false;
    scene.fog = new THREE.Fog(track.fog, track.fogNear, track.fogFar);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000);
    scene.add(new THREE.HemisphereLight(track.hemi[0], track.hemi[1], track.hemiI));
    const sun = (this.sun = new THREE.DirectionalLight(track.sun, track.sunI));
    sun.castShadow = true;
    const sm = this.mobile ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 170 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sunDir = new THREE.Vector3(-0.45, 0.75, -0.5).normalize();

    this.world = new CircuitWorld(scene, { ...track, circuit });
    this.world.update(0);
    this.L = this.world.loopL;
    this.line = this.world.racingLine();
    this.laps = circuit.laps;

    // cars: 5 AI on the first slots, the player starts last.
    // In an online challenge the grid comes from the host instead: real players and AI, everybody's car fixed.
    this.mp = opts.grid ? { hostAI: !!opts.hostAI, me: opts.playerName } : null;
    const grid = opts.grid || aiSpecs(circuit, car, cfg, opts.aiNames, 5).concat([{ name: opts.playerName || "Tu", kind: "me" }]);
    this.cars = [];
    grid.forEach((g, j) => {
      const isMe = g.kind === "me" || (this.mp && g.name === this.mp.me);
      // real players all drive the challenge car (only the colour differs, to tell them apart)
      const human = isMe || g.kind === "human";
      const model = human ? car : CARS.find((c) => c.id === g.carId) || car;
      const mcfg = human ? (g.color ? { ...cfg, color: g.color } : cfg) : g.setup;
      const obj = buildCar(model, mcfg);
      scene.add(obj);
      if (isMe && track.night) {
        const head = new THREE.SpotLight(0xfff2d8, 60, 90, 0.5, 0.6, 1.4);
        head.position.set(0, 0.8, model.shape.L / 2);
        const tgt = new THREE.Object3D(); tgt.position.set(0, 0, 30);
        obj.add(head, tgt); head.target = tgt;
      }
      const c = this.makeCar({
        name: g.name, isPlayer: isMe, obj, len: model.shape.L, wid: model.shape.W,
        perf: isMe || g.kind === "human" ? performance(model, mcfg) : g.perf,
        mass: model.mass, setup: mcfg, skill: isMe ? 0.95 : g.skill || 0.6, aggr: g.aggr || 0.5, carId: model.id,
        human: isMe || g.kind === "human", slot: j,
        // a car moved by the network: another player, or the AI when the host simulates it
        remote: !isMe && !!this.mp && (g.kind === "human" || !this.mp.hostAI)
      }, j);
      this.cars.push(c);
      if (isMe) this.player = c;
    });
    // online: the other real players get a badge with their initial above the car (and on the map)
    if (this.mp) {
      const humans = this.cars.filter((c) => c.human);
      for (const c of humans) {
        const first = (c.name || "?").trim().charAt(0).toUpperCase();
        const clash = humans.some((o) => o !== c && (o.name || "").trim().charAt(0).toUpperCase() === first);
        c.tag = clash ? (c.name || "?").trim().slice(0, 2).replace(/^./, (x) => x.toUpperCase()) : first;
        if (c.isPlayer) continue;
        const sp = nameBadge(c.tag, c.obj.userData.color || "#ffb23e");
        sp.position.set(0, 2.3, 0);
        c.obj.add(sp);
        c.badge = sp;
      }
    }

    // bonus/malus on the track (online challenges, if the host wants them): same items for everybody.
    // Turbo pickups are stored as NOS charges and fired with the NOS button; shields stack, one per car or roadworks.
    this.nos = 0; this.nosT = 0; this.shield = 0; this.slip = 0; this.slipDir = 1;
    this.items = (opts.items || []).map((it) => ({ ...it, s: it.f * this.L, taken: false, obj: null, back: 0 }));
    for (const it of this.items) this.world.spawnItem(it);
    this.t = 0;
    // online: stand on the grid until every player is looking at the track, then the countdown (go())
    this.state = this.mp ? "waiting" : "countdown";
    this.countdown = 3.6;
    this.lastCount = null;
    this.contacts = 0;
    this.shake = 0;
    this.camHeading = null;
    this.camPos = null;
    this.finishedOrder = [];
  }

  makeCar(c, slot) {
    const row = Math.floor(slot / 2);
    return Object.assign(c, {
      s: -7 - row * 9, x: slot % 2 ? 2.4 : -2.4, v: 0, latV: 0, yaw: 0, phi: 0,
      lap: -1, lapStart: 0, lastLap: null, best: null, finished: false, finishTime: null,
      marks: [], nextMark: 1     // split times: mark m is at m * L/3 (every 3rd mark = finish line)
    });
  }

  setAspect(w, h) { this.camera.aspect = w / h; this.portrait = h > w; this.camera.updateProjectionMatrix(); }

  wrapDs(d) { const L = this.L; d = ((d % L) + L) % L; return d > L / 2 ? d - L : d; }

  // ------------------------------------------------------------------ driving
  // NOS: one charge = 4 s of boost (+20 % top speed, +60 % acceleration), like the turbo of the endless track
  fireNos() {
    if (this.state !== "run" || this.nos <= 0 || this.nosT > 0) return false;
    this.nos--; this.nosT = 4;
    this.hooks.onToast(this.nos ? `NOS! (ne restano ${this.nos})` : "NOS!", "good");
    return true;
  }
  drivePlayer(c, dt, input) {
    const p = c.perf, tr = this.track;
    const k = this.world.sample(c.s + 0.5).k;
    if (input.nos) this.fireNos();
    const boost = this.nosT > 0;
    if (this.nosT > 0) this.nosT = Math.max(0, this.nosT - dt);
    let target = null;
    const oiled = this.slip > 0;
    if (oiled) { this.slip -= dt; target = this.slipDir * 0.4; }     // oil: the car slides on its own
    if (target == null && input.tilt != null) c.steerSm = (c.steerSm || 0) + (input.tilt - (c.steerSm || 0)) * Math.min(1, dt * 12);
    else c.steerSm = smoothSteer(c.steerSm || 0, target ?? (input.right ? 1 : 0) - (input.left ? 1 : 0), dt);
    const st = stepCar(c, k, c.steerSm, { gas: input.gas, brake: input.brake, brakeA: p.brakeA, G: p.grip * tr.grip * GRIP_ARCADE * (this.slip > 0 ? 0.6 : 1),
      top: p.topMs * this.draft(c) * (boost ? 1.2 : 1), a0: p.a0 * (boost ? 1.6 : 1), offroad: tr.offroad }, dt);
    if (oiled) oilSkid(c, this.slipDir, dt);
    this.pickups(c);
    if (this.state === "run" && c.v > (c.maxV || 0)) c.maxV = c.v;
    this.barrier(c, dt);
    return st.ds;
  }

  pickups(c) {
    if (!this.items.length) return;
    const sm = ((c.s % this.L) + this.L) % this.L;
    for (const it of this.items) {
      if (it.taken) { if (this.t > it.back) { it.taken = false; this.world.spawnItem(it); } continue; }   // back on track after a while
      let ds = it.s - sm; if (ds > this.L / 2) ds -= this.L; if (ds < -this.L / 2) ds += this.L;
      if (Math.abs(ds) < 2.6 && Math.abs(it.x - c.x) < (it.type === "cones" ? 2.2 : 1.9)) {
        it.taken = true; it.back = this.t + 25;
        if (it.obj) { this.world.root.remove(it.obj); it.obj = null; }
        this.applyItem(it.type);
        this.hooks.onTake && this.hooks.onTake(it.id);
      }
    }
  }
  // another player took it: it disappears here too
  takeItem(id) {
    const it = this.items.find((x) => x.id === id);
    if (!it || it.taken) return;
    it.taken = true; it.back = this.t + 25;
    if (it.obj) { this.world.root.remove(it.obj); it.obj = null; }
  }
  applyItem(type) {
    const h = this.hooks, c = this.player;
    if (type === "turbo") { this.nos++; h.onToast(this.nos > 1 ? `NOS: ${this.nos}` : "NOS preso: premi NOS", "good"); }
    else if (type === "shield") { this.shield++; h.onToast(this.shield > 1 ? `Scudi: ${this.shield}` : "Scudo attivo", "good"); }
    else if (type === "oil") { this.slip = OIL_TIME; this.slipDir = Math.random() < 0.5 ? -1 : 1; h.onToast("Olio!", "bad"); }
    else if (type === "cones") {
      if (this.shield > 0) { this.shield--; this.shake = 0.15; h.onToast(this.shield ? `Cantiere evitato (scudi: ${this.shield})` : "Scudo: cantiere evitato", "good"); }
      else { c.v *= 0.45; this.shake = 0.35; h.onToast("Cantiere!", "bad"); }
    }
  }

  // gravel and tyre wall beyond the kerbs: heavy slowdown, the car cannot leave the circuit
  barrier(c, dt = 1 / 60) {
    if (this.track.sea) {
      if (Math.abs(c.x) > ROAD_HALF + 2) c.v *= Math.pow(0.985, dt * 60);
      if (!c.fall && !c.remote && Math.abs(c.x) > this.world.edgeAt(c.s) && this.world.dropAt(c.s, c.x) > 2.5) {
        c.fall = startFall(this.world, c.s, c.x, c.obj.position.y, c.v, c.latV);   // from exactly where it is drawn
        if (c.isPlayer) { this.shake = 0.3; this.hooks.onToast("In mare!", "bad"); }
      }
      c.x = clamp(c.x, -120, 120);
      return;
    }
    const lim = ROAD_HALF + 5;
    if (Math.abs(c.x) > ROAD_HALF + 2) c.v *= Math.pow(0.985, dt * 60);
    if (Math.abs(c.x) > lim) { c.x = Math.sign(c.x) * lim; c.phi *= -0.3; c.v *= 0.8; if (c.isPlayer && !this.wallCool) { this.shake = 0.4; this.wallCool = 1; this.hooks.onToast("Barriera!", "bad"); } }
  }

  // slipstream: +4 % top speed when tucked behind another car
  draft(c) {
    for (const o of this.cars) {
      if (o === c) continue;
      const ds = this.wrapDs(o.s - c.s);
      if (ds > 5 && ds < 32 && Math.abs(o.x - c.x) < 1.6) return 1.04;
    }
    return 1;
  }

  // Speed the car can hold at every point of the racing line (grip), then braking and acceleration passes.
  speedProfile(c) {
    const L = this.line, n = L.n, ds = L.segL, tr = this.track, p = c.perf;
    const G = p.grip * tr.grip * GRIP_ARCADE * c.skill * 0.985;
    const brake = (p.brakeA || 12) * 0.96 * c.skill, top = p.topMs;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) { const k = L.ka[i]; v[i] = Math.min(top, k > 1e-5 ? Math.sqrt(G / k) : top); }
    for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n; v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake * ds));
    }
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = p.a0 * Math.max(0.08, 1 - Math.pow(v[i] / top, 1.8));
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * a * ds));
    }
    return v;
  }

  // AI: follows the racing line and its speed profile, overtakes, closes the door on the player, makes small mistakes.
  // It only decides gas, brake and steering: the car obeys the same physics as the player's.
  driveAI(c, dt) {
    const w = this.world, tr = this.track, p = c.perf, Ln = this.line;
    if (!c.vprof) c.vprof = this.speedProfile(c);
    const ahead = this.wrapDs(c.s - this.player.s);
    let band = 1;
    if (!c.finished && this.state === "run") band = ahead < -80 ? 1.03 : ahead > 160 ? 0.98 : 1;
    if (c.mistakeT > 0) c.mistakeT -= dt;
    else if (this.state === "run" && Math.random() < dt * Math.max(0.002, (0.8 - c.skill) * 0.06)) { c.mistakeT = rnd(0.6, 1.2); c.mistakeKind = Math.random() < 0.5 ? "wide" : "early"; }
    const mist = c.mistakeT > 0 ? c.mistakeKind : null;
    const G = p.grip * tr.grip * GRIP_ARCADE;
    const top = p.topMs * band * this.draft(c);
    const sm = ((c.s % this.L) + this.L) % this.L;
    const idx = (k) => ((Math.floor((sm + k) / Ln.segL) % Ln.n) + Ln.n) % Ln.n;
    let vt = Math.min(top, c.vprof[idx(c.v * 0.15 + 1)] * (mist === "early" ? 0.9 : mist === "wide" ? 1.03 : 1));
    // never drive into the back of the car ahead
    let capped = false;
    for (const o of this.cars) {
      if (o === c) continue;
      const ds = this.wrapDs(o.s - c.s);
      if (ds > 0 && ds < 14 && Math.abs(o.x - c.x) < 1.9) { const cap = o.v + Math.max(0, ds - 6) * 0.8; if (cap < vt) { vt = cap; capped = true; } }
    }
    c.stuckT = capped ? (c.stuckT || 0) + dt : Math.max(0, (c.stuckT || 0) - dt * 2);

    // line to follow: racing line, shifted to pass a slower car, to let a faster rival by, or to defend from the player
    const i0 = idx(0.5);
    let line = Ln.x[i0];
    let blocker = null, chaser = null, passer = null;
    for (const o of this.cars) {
      if (o === c) continue;
      const ds = this.wrapDs(o.s - c.s);
      // pass only a car that is really holding us up (slower, or we've been stuck behind it)
      if (ds > 0 && ds < 30 && Math.abs(o.x - c.x) < 2.4 && (o.v < c.v - 0.5 || c.stuckT > 1) && (!blocker || ds < blocker.ds)) blocker = { o, ds };
      if (o.isPlayer && ds < -4 && ds > -16 && o.v > c.v - 2) chaser = { o, ds };
      // an AI rival right behind and trying to pass: give it room
      if (!o.isPlayer && ds < 0 && ds > -14 && o.mode === "pass") passer = o;
    }
    let mode = "line", lift = 1;
    const straight = Math.abs(w.sample(c.s + 20).k) < 0.006;
    if (blocker) {
      const o = blocker.o;
      // go by on the side with room, and keep that side unless it closes up
      const lim = ROAD_HALF - 0.8, roomL = o.x + lim, roomR = lim - o.x;
      if (!c.passSide || c.passT <= 0 || (c.passSide > 0 ? roomR : roomL) < 2.6) { c.passSide = roomR > roomL ? 1 : -1; c.passT = 3; }
      line = o.x + c.passSide * 3.0; mode = "pass";
      if (Ln.ka[idx(c.v * 0.5)] > 0.012) lift = 0.95;   // off the ideal line in a bend: a little slower
    } else if (passer) {
      line = Ln.x[i0] - Math.sign(passer.x - c.x || 1) * 1.6; lift = 0.97; mode = "yield";
    } else if (chaser && this.state === "run" && c.aggr > 0.4 && (c.blockT > 0 || (straight && !(c.blockCd > 0)))) {
      // defend once, briefly, on a straight; then leave the player alone for a while
      if (!(c.blockT > 0)) { c.blockX = clamp(chaser.o.x, -3, 3); c.blockT = rnd(0.8, 1.4); c.blockCd = rnd(7, 10); }
      line = c.blockX; mode = "block";
    }
    c.blockCd = (c.blockCd || 0) - dt;
    if (lift < 1) vt *= lift;
    // off the grid: keep your own lane for the first stretch, blend into the ideal line (no first-corner pile-up)
    if (c.s0 === undefined) { c.s0 = c.s; c.x0 = c.x; }
    const fromGrid = c.s - c.s0;
    if (fromGrid < 300 && mode !== "pass") { const a = Math.max(0, fromGrid) / 300; line = c.x0 + (line - c.x0) * a * a; }
    if (mist === "wide") line += -Math.sign(w.sample(c.s + 5).k || 1) * 2.5;
    c.passT = (c.passT || 0) - dt;
    c.blockT = (c.blockT || 0) - dt;
    const gas = c.v < vt - 0.1;
    const brake = c.v > vt + 0.8;
    c.mode = mode;
    line = clamp(line, -(ROAD_HALF - 0.8), ROAD_HALF - 0.8);
    // steering like a driver: turn as much as the line bends (feed-forward) and correct heading and position errors
    const kHere = w.sample(c.s + 0.5).k;
    // follow the shape of the ideal line also while passing or making room: only the lateral target moves
    const onLine = mode !== "block" && !mist;
    const kff = onLine ? Ln.k[i0] : kHere;
    const phiT = onLine ? Ln.phi[i0] : 0;
    const phiCmd = phiT + clamp((line - c.x) * 0.15, -0.2, 0.2);
    const yawWant = c.v * kff + (phiCmd - c.phi) * 5;
    const steer = clamp(yawWant / Math.max(1e-3, maxYaw(c.v, G)), -1, 1);
    const stopping = this.state === "finished" && c.finished && c.v > 15;
    const st = stepCar(c, kHere, steer,
      { gas: gas && !stopping, brake: brake || stopping, brakeA: p.brakeA, G, top, a0: p.a0 * band, offroad: tr.offroad }, dt);
    this.barrier(c, dt);
    return st.ds;
  }

  go() { if (this.state === "waiting") { this.state = "countdown"; this.countdown = 3.6; this.lastCount = null; } }
  update(dt, input) {
    this.lastBrake = !!(input && (input.brake || !input.gas));
    if (this.state === "waiting") return;
    if (this.state === "countdown") {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.6);
      const label = n > 0 ? String(n) : "VIA!";
      if (label !== this.lastCount) { this.lastCount = label; this.hooks.onCountdown && this.hooks.onCountdown(label); }
      if (this.countdown <= 0.6) { this.state = "run"; this.hooks.onStart && this.hooks.onStart(); }
      return;
    }
    this.t += dt;
    for (const c of this.cars) {
      const ds = c.remote ? this.followNet(c, dt) : c.fall ? this.updateFall(c, dt) : c.isPlayer && this.state === "run" ? this.drivePlayer(c, dt, input) : this.driveAI(c, dt);
      c.yaw = -c.phi;
      c.s += ds;
      this.crossMarks(c);
      const lap = Math.floor(c.s / this.L);
      if (lap > c.lap) {
        if (lap >= 1 && !c.finished) {
          c.lastLap = this.t - c.lapStart;
          c.best = c.best == null ? c.lastLap : Math.min(c.best, c.lastLap);
          if (c.isPlayer && lap < this.laps) this.hooks.onToast(`Giro ${lap + 1}/${this.laps} · ${fmtLap(c.lastLap)}`, "good");
        }
        c.lap = lap;
        c.lapStart = this.t;
        if (lap >= this.laps && !c.finished && !c.remote) {
          c.finished = true; c.finishTime = this.t; this.finishedOrder.push(c);
          if (c.isPlayer) this.finishPlayer();
        }
      }
    }
    // position changes for the player
    if (this.state === "run") {
      const pos = this.position();
      if (this.lastPos && pos !== this.lastPos && !this.posCool) {
        if (pos < this.lastPos) this.hooks.onToast(`Sorpasso! ${pos}°`, "good");
        else this.hooks.onToast(`Superato: sei ${pos}°`, "bad");
        this.posCool = 1.2;
      }
      this.lastPos = pos;
      if (this.posCool) this.posCool = Math.max(0, this.posCool - dt);
    }
    // contacts
    for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
      const a = this.cars[i], b = this.cars[j];
      const ds = this.wrapDs(b.s - a.s);
      const reachS = (a.len + b.len) / 2 - 0.2, reachX = (a.wid + b.wid) / 2 - 0.1;
      if (Math.abs(ds) < reachS && Math.abs(b.x - a.x) < reachX) {
        // same momentum-based solver for everyone (s is unwrapped progress, so use the wrapped gap).
        // A car moved by the network is moved only by its owner: here it pushes but is not pushed.
        if (a.remote && b.remote) continue;
        if (a.fall || b.fall || a.ghostT > this.t || b.ghostT > this.t) continue;   // in the water / just respawned
        // a shield lets the player pass through one car (then it is used up)
        const other = a.isPlayer ? b : b.isPlayer ? a : null;
        if (other) {
          if (other.shieldOff > this.t) continue;
          if (this.shield > 0 && Math.abs(this.wrapDs(other.s - this.player.s)) < reachS && Math.abs(other.x - this.player.x) < reachX) {
            this.shield--; other.shieldOff = this.t + 1.2;
            this.hooks.onToast(this.shield ? `Scudo! (ne restano ${this.shield})` : "Scudo!", "good");
            continue;
          }
        }
        const keep = a.remote ? a : b.remote ? b : null;
        const saved = keep && { s: keep.s, x: keep.x, v: keep.v, phi: keep.phi, latV: keep.latV };
        const rel = resolveContact(a, b, ds, reachS, reachX, dt);
        if (keep) Object.assign(keep, saved);
        if ((a.isPlayer || b.isPlayer) && this.state === "run" && !this.contactCool && rel > 1) {
          this.contacts++; this.shake = 0.35; this.contactCool = 0.8;
          this.hooks.onToast("Contatto!", "bad");
        }
      }
    }
    if (this.wallCool) this.wallCool = Math.max(0, this.wallCool - dt);
    if (this.contactCool) this.contactCool = Math.max(0, this.contactCool - dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
  }

  // fell into the sea: about a second in the air, then back on the road centre, standing still
  updateFall(c, dt) {
    const f = c.fall;
    const ds = stepFall(this.world, f, c.s, c.x, dt);
    c.x += f.dx; c.v = f.v;
    if (fallDone(f)) {
      c.fall = null;
      if (c.isPlayer) { this.camSnap = true; this.camHeading = this.world.sample(c.s, 0).heading; }
      c.x = 0; c.v = 0; c.phi = 0; c.latV = 0; c.steerSm = 0; c.ghostT = this.t + 2;
      if (c.isPlayer) { this.slip = 0; this.hooks.onToast("Riparti da centro pista", "bad"); }
    }
    return ds;
  }

  // ---- intermediates: 2 per lap + the finish line
  crossMarks(c) {
    const SL = this.L / 3;
    while (c.s >= c.nextMark * SL) {
      const m = c.nextMark++;
      const t = this.t - (c.s - m * SL) / Math.max(1, c.v);   // the moment it was exactly on the line
      c.marks[m] = t;
      if (m > this.laps * 3) continue;                       // laps after the finish (online, still rolling)
      if (c.isPlayer) this.playerSplit(m, t);
      else if (this.split && this.split.m === m && this.split.watch === c) {
        this.split.behind = { name: c.name, gap: t - this.split.myT, est: false };
        this.split.at = Math.max(this.split.at, this.t - 2);   // keep it on screen a little longer
      }
    }
  }
  playerSplit(m, t) {
    const order = this.order();
    const i = order.indexOf(this.player);
    const ahead = order[i - 1], behind = order[i + 1];
    const lapN = m / 3;
    const label = m % 3 === 1 ? "Intermedio 1" : m % 3 === 2 ? "Intermedio 2" : lapN >= this.laps ? "Arrivo" : `Traguardo · giro ${lapN}`;
    const sp = { m, label, at: this.t, myT: t, pos: i + 1, ahead: null, behind: null, watch: null };
    if (ahead && ahead.marks[m] != null) sp.ahead = { name: ahead.name, gap: t - ahead.marks[m] };
    if (behind) {
      if (behind.marks[m] != null) sp.behind = { name: behind.name, gap: behind.marks[m] - t, est: false };   // lapped etc.
      else {   // not there yet: estimate from distance and speed, replaced by the real time when it crosses
        const d = m * (this.L / 3) - behind.s;
        // it will cover that gap at about the speed I just had there (a bit less if it is slower now)
        sp.behind = { name: behind.name, gap: d / Math.max(5, 0.7 * this.player.v + 0.3 * behind.v), est: true };
        sp.watch = behind;
      }
    }
    this.split = sp;
  }
  order() {
    return this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.s - a.s;
    });
  }
  position(c = this.player) {
    const order = this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.s - a.s;
    });
    return order.indexOf(c) + 1;
  }

  finishPlayer() {
    this.state = "finished";
    if (this.mp) {   // online: the final order comes from the host once everybody is home
      this.hooks.onFinish({ mp: true, time: this.player.finishTime, best: this.player.best, contacts: this.contacts, maxKmh: (this.player.maxV || 0) * 3.6 });
      return;
    }
    const pos = this.finishedOrder.indexOf(this.player) + 1;
    const p = this.player;
    const times = this.projectFinishTimes();
    const order = this.cars.map((c) => ({ name: c.name, isPlayer: c.isPlayer, carId: c.carId, time: times.get(c), best: c.isPlayer ? p.best : null, setup: c.setup }))
      .sort((a, b) => a.time - b.time);
    this.hooks.onFinish({ position: pos, total: this.cars.length, time: p.finishTime, best: p.best, contacts: this.contacts, order, maxKmh: (p.maxV || 0) * 3.6 });
  }

  // Runs the rest of the race off-screen on a copy of the state to get everybody's finishing time,
  // then puts every car back where it was.
  projectFinishTimes() {
    const keys = ["s", "x", "v", "phi", "latV", "yaw", "lap", "lapStart", "lastLap", "best", "finished", "finishTime", "steerSm", "mistakeT", "mistakeKind", "passSide", "passT", "blockX", "blockT", "mode"];
    const snap = this.cars.map((c) => Object.fromEntries(keys.map((k) => [k, c[k]])));
    const saved = { t: this.t, order: this.finishedOrder.slice(), hooks: this.hooks, contacts: this.contacts, shake: this.shake };
    this.hooks = { onToast() {}, onFinish() {}, onCountdown() {}, onStart() {} };
    const times = new Map();
    let guard = 0;
    while (this.cars.some((c) => !c.finished) && guard++ < 60 * 900) this.update(1 / 60, {});
    for (const c of this.cars) {
      if (c.finished) times.set(c, c.finishTime);
      else { const left = this.laps * this.L - c.s; times.set(c, this.t + left / Math.max(10, c.v)); }
    }
    this.cars.forEach((c, i) => Object.assign(c, snap[i]));
    Object.assign(this, { t: saved.t, finishedOrder: saved.order, hooks: saved.hooks, contacts: saved.contacts, shake: saved.shake });
    return times;
  }

  // ------------------------------------------------------------------ online
  // compact state of the cars this client is responsible for: [slot, s, x, v, phi, finishTime|-1, best|-1]
  netState(all) {
    const r2 = (n) => Math.round(n * 100) / 100;
    return this.cars.filter((c) => !c.remote && (all || c.isPlayer))
      .map((c) => [c.slot, r2(c.s), r2(c.x), r2(c.v), Math.round(c.phi * 1000) / 1000, c.finished ? r2(c.finishTime) : -1, c.best == null ? -1 : r2(c.best), c.fall ? 1 : 0]);
  }
  applyNet(rows, now) {
    for (const r of rows) {
      const c = this.cars[r[0]];
      if (!c || !c.remote) continue;
      c.net = { s: r[1], x: r[2], v: r[3], phi: r[4], at: now };
      c.netFall = r[7] === 1;
      c.seen = now;
      if (r[6] >= 0) c.best = r[6];
      if (r[5] >= 0 && !c.finished) { c.finished = true; c.finishTime = r[5]; this.finishedOrder.push(c); }
    }
  }
  // dead reckoning from the last update, then glide towards it (no jumps on the screen)
  followNet(c, dt) {
    const n = c.net;
    if (!n) return 0;
    const age = Math.min(0.5, (globalThis.performance.now() - n.at) / 1000);   // (performance = car stats here)
    const ts = n.s + n.v * age;
    const before = c.s;
    const k = Math.min(1, dt * 8);
    if (Math.abs(ts - c.s) > 40) c.s = ts; else c.s += (ts - c.s) * k + n.v * dt * (1 - k);
    c.x += (n.x - c.x) * k;
    c.v = n.v; c.phi += (n.phi - c.phi) * k;
    const ds = c.s - before; c.s = before;   // update() adds ds itself
    return ds;
  }

  // ------------------------------------------------------------------ render
  render(dtReal) {
    if (this.items.length) {
      const time = globalThis.performance.now();
      for (const it of this.items) if (it.obj && it.obj.isSprite) it.obj.position.y = it.obj.userData.baseY + Math.sin(time * 0.004 + it.s) * 0.15;
    }
    const w = this.world, tmp = {};
    for (const c of this.cars) {
      w.sample(c.s, c.x, tmp);
      let y = c.fall ? c.fall.y : w.supportY(c.s, c.x, tmp.y);
      if (c.remote) {   // another player's car in the water: we only know that it fell, show it going down
        c.rfy = c.netFall ? Math.max(this.track.sea ? this.track.seaY - 1.1 : y - 8, (c.rfy ?? y) - 9 * dtReal) : null;
        if (c.rfy != null) y = c.rfy;
      }
      c.obj.position.set(tmp.x, y, tmp.z);
      if (c.fall && c.fall.landed && c.fall.sea != null && !c.fall.splashed) { c.fall.splashed = true; this.splashes.add(tmp.x, c.fall.sea, tmp.z); }
      c.obj.visible = !(c.ghostT > this.t && Math.floor((c.ghostT - this.t) * 8) % 2 === 1);
      let roll = -c.latV * 0.006;
      if (c.isPlayer && this.shake > 0) { c.obj.position.x += rnd(-0.06, 0.06); roll += rnd(-0.03, 0.03); }
      c.obj.rotation.set(0, tmp.heading + c.yaw, roll, "YXZ");
      const r = c.obj.userData.radius || 0.32;
      for (const wh of c.obj.userData.wheels || []) wh.userData.spin.rotation.x += (c.v / r) * dtReal;
    }
    this.splashes.update(dtReal);
    const P = this.player.obj;
    P.userData.tail.emissiveIntensity = this.state !== "run" || this.lastBrake ? 2.2 : 0.6;
    w.sample(this.player.s, this.player.x, tmp);
    if (this.camHeading === null) this.camHeading = tmp.heading;
    this.camHeading += angDiff(tmp.heading + this.player.yaw * 0.65, this.camHeading) * Math.min(1, dtReal * 4);
    const dist = this.portrait ? 7.6 : 6.4, hgt = this.portrait ? 2.9 : 2.4;
    const dir = new THREE.Vector3(Math.sin(this.camHeading), 0, Math.cos(this.camHeading));
    const desired = new THREE.Vector3().copy(P.position).addScaledVector(dir, -dist);
    desired.y = P.position.y + hgt;
    if (!this.camPos || this.camSnap) { this.camPos = desired.clone(); this.camSnap = false; }
    // while my car falls the camera stays where it left the road and watches it go
    if (!this.player.fall) this.camPos.lerp(desired, 1 - Math.exp(-dtReal * 9));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) this.camera.position.add(new THREE.Vector3(rnd(-0.1, 0.1), rnd(-0.08, 0.08), 0));
    const look = this.player.fall ? new THREE.Vector3().copy(P.position).setY(P.position.y + 0.5) : new THREE.Vector3().copy(P.position).addScaledVector(dir, 5).setY(P.position.y + 1.1);
    this.camera.lookAt(look);
    if (this.rearView) {
      // look back from the roof
      const eye = new THREE.Vector3().copy(P.position).addScaledVector(dir, 0.3); eye.y += 1.75;
      const tgt = new THREE.Vector3().copy(P.position).addScaledVector(dir, -30); tgt.y += 0.9;
      this.camera.position.copy(eye); this.camera.lookAt(tgt);
    }
    const fov = (this.portrait ? 74 : 62) + Math.min(1, this.player.v / 70) * 10;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dtReal * 3); this.camera.updateProjectionMatrix(); }
    this.sun.position.copy(P.position).addScaledVector(this.sunDir, 70);
    this.sun.target.position.copy(P.position);
    w.followCamera(this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  // data for the overlay map: track outline (once) and every car
  minimap() {
    const w = this.world;
    if (!this.mapPath) {
      this.mapPath = [];
      for (let i = 0; i < w.px.length; i += 4) this.mapPath.push([w.px[i], w.pz[i]]);
    }
    const tmp = {};
    const cars = this.cars.map((c) => { w.sample(c.s, c.x, tmp); return { x: tmp.x, z: tmp.z, isPlayer: c.isPlayer, color: c.obj.userData.color || "#ffffff", tag: c.isPlayer ? null : c.tag || null }; });
    return { path: this.mapPath, cars };
  }

  audioState(input) {
    const p = this.player;
    const run = this.state === "run" || this.state === "finished";
    const turnHard = Math.max(0, Math.abs(p.steerSm || 0) - 0.75) * 4 * Math.min(1, p.v / 30);
    const off = Math.abs(p.x) > ROAD_HALF + 0.6 && p.v > 5;
    return {
      v: p.v, top: p.perf.topMs, gas: !!(input && input.gas), brake: !!(input && input.brake),
      skid: run ? Math.min(1, turnHard + (off ? 0.5 : 0) + (input && input.brake && p.v > 15 ? 0.25 : 0)) : 0,
      offroad: off,
      others: this.cars.filter((c) => !c.isPlayer).map((c) => ({ id: c, ds: this.wrapDs(c.s - p.s), dx: c.x - p.x, v: c.v, top: c.perf.topMs, carId: c.carId, setup: c.setup }))
    };
  }
  hud() {
    const p = this.player;
    return {
      circuit: true, corner: this.world.nextCorner(p.s), kmh: Math.round(p.v * 3.6), pos: this.position(), total: this.cars.length,
      lap: clamp(p.lap + 1, 1, this.laps), laps: this.laps,
      lapTime: this.state === "countdown" || p.lap < 0 ? 0 : this.t - p.lapStart, best: p.best,
      off: this.state === "run" && Math.abs(p.x) > ROAD_HALF + 0.6, state: this.state,
      items: this.items.length > 0, nos: this.nos, nosOn: this.nosT > 0, shield: this.shield, slip: this.slip > 0,
      split: this.split && this.t - this.split.at < 5 ? this.split : null
    };
  }

  dispose() {
    this.world.dispose();
    for (const c of this.cars) { this.scene.remove(c.obj); disposeCar(c.obj); }
    this.scene.clear();
  }
}

export function fmtLap(t) {
  if (t == null || !Number.isFinite(Number(t))) return "—";
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`.replace(".", ",");
}
