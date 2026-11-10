import * as THREE from "three";
import { CircuitWorld } from "./world.js";
import { buildCar, disposeCar } from "./carmodel.js";
import { stepCar, smoothSteer, maxYaw, resolveContact, GRIP_ARCADE } from "./physics.js";
import { CARS, COLORS, CIRCUITS, AI_NAMES, PARTS, PART_ORDER, defaultConfig, performance, ROAD_HALF } from "./data.js";

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const CAR_LEN = 4.4, CAR_WID = 1.9;

// A lap race on a closed circuit against 5 AI drivers.
export class CircuitRace {
  constructor(renderer, track, circuit, car, cfg, hooks, opts = {}) {
    this.renderer = renderer;
    this.track = track;
    this.circuit = circuit;
    this.car = car;
    this.hooks = hooks;
    this.mobile = !!opts.mobile;
    const scene = (this.scene = new THREE.Scene());
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
    this.laps = circuit.laps;

    // cars: 5 AI on the first slots, the player starts last
    // AI cars start from the player's car *as it leaves the factory* (so the player's own parts are a real edge),
    // then get a random setup whose effects are visible both on the car and on the stopwatch.
    const pStock = performance(car, defaultConfig(car));
    const level = [0.97, 0.99, 1.01, 1.03, 1.05][Math.max(0, CIRCUITS.indexOf(circuit))];
    const names = AI_NAMES.slice().sort(() => Math.random() - 0.5);
    this.cars = [];
    for (let j = 0; j < 5; j++) {
      const rel = level * rnd(0.98, 1.04) * (j === 0 ? 1.03 : 1); // slot 0 is the pace-setter
      const want = pStock.topKmh * rel;
      const model = CARS.slice().sort((a, b) => Math.abs(a.top - want) - Math.abs(b.top - want))[0];
      const mcfg = { ...defaultConfig(model), color: COLORS[(j * 3 + 1) % COLORS.length] };
      for (const key of PART_ORDER) { const o = PARTS[key].options; mcfg[key] = o[Math.floor(Math.random() * o.length)].id; }
      const mStock = performance(model, defaultConfig(model)), mSet = performance(model, mcfg);
      const obj = buildCar(model, mcfg);
      scene.add(obj);
      this.cars.push(this.makeCar({
        name: names[j], isPlayer: false, obj, len: model.shape.L, wid: model.shape.W,
        perf: { topMs: pStock.topMs * rel * (mSet.topMs / mStock.topMs), a0: pStock.a0 * rel * (mSet.a0 / mStock.a0),
                grip: pStock.grip * rnd(0.98, 1.02) * (mSet.grip / mStock.grip) },
        mass: model.mass, setup: mcfg,
        skill: clamp(rnd(0.93, 0.99) + (j === 0 ? 0.03 : 0), 0.9, 1.02), aggr: rnd(0.3, 0.9), carId: model.id
      }, j));
    }
    const pObj = buildCar(car, cfg);
    scene.add(pObj);
    if (track.night) {
      const head = new THREE.SpotLight(0xfff2d8, 60, 90, 0.5, 0.6, 1.4);
      head.position.set(0, 0.8, car.shape.L / 2);
      const tgt = new THREE.Object3D(); tgt.position.set(0, 0, 30);
      pObj.add(head, tgt); head.target = tgt;
    }
    this.player = this.makeCar({ name: opts.playerName || "Tu", isPlayer: true, obj: pObj, len: car.shape.L, wid: car.shape.W, perf: performance(car, cfg), mass: car.mass, setup: cfg, skill: 0.95, carId: car.id }, 5);
    this.cars.push(this.player);

    this.t = 0;
    this.state = "countdown";
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
      lap: -1, lapStart: 0, lastLap: null, best: null, finished: false, finishTime: null
    });
  }

  setAspect(w, h) { this.camera.aspect = w / h; this.portrait = h > w; this.camera.updateProjectionMatrix(); }

  wrapDs(d) { const L = this.L; d = ((d % L) + L) % L; return d > L / 2 ? d - L : d; }

  // ------------------------------------------------------------------ driving
  drivePlayer(c, dt, input) {
    const p = c.perf, tr = this.track;
    const k = this.world.sample(c.s + 0.5).k;
    c.steerSm = smoothSteer(c.steerSm || 0, (input.right ? 1 : 0) - (input.left ? 1 : 0), dt);
    const st = stepCar(c, k, c.steerSm, { gas: input.gas, brake: input.brake, G: p.grip * tr.grip * GRIP_ARCADE,
      top: p.topMs * this.draft(c), a0: p.a0, offroad: tr.offroad }, dt);
    this.barrier(c);
    return st.ds;
  }

  // gravel and tyre wall beyond the kerbs: heavy slowdown, the car cannot leave the circuit
  barrier(c) {
    const lim = ROAD_HALF + 5;
    if (Math.abs(c.x) > ROAD_HALF + 2) c.v *= 0.985;
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

  // AI: decides only gas, brake and steering; the car obeys the same physics as the player.
  driveAI(c, dt) {
    const w = this.world, tr = this.track, p = c.perf;
    const ahead = this.wrapDs(c.s - this.player.s);
    let band = 1;
    if (!c.finished && this.state === "run") band = ahead < -80 ? 1.04 : ahead > 160 ? 0.98 : 1;
    if (c.mistakeT > 0) c.mistakeT -= dt;
    else if (this.state === "run" && Math.random() < dt * (1.06 - c.skill) * 0.08) { c.mistakeT = rnd(0.6, 1.2); c.mistakeKind = Math.random() < 0.5 ? "wide" : "early"; }
    const mist = c.mistakeT > 0 ? c.mistakeKind : null;
    const G = p.grip * tr.grip * GRIP_ARCADE;
    const Gplan = G * c.skill * 0.97 * (mist === "wide" ? 1.15 : 1);
    const brakeA = 11.5 * c.skill;
    const top = p.topMs * band * this.draft(c);
    let vt = top;
    for (let d = 0; d <= 220; d += 10) {
      const k = Math.abs(w.sample(c.s + d).k);
      if (k > 1e-4) vt = Math.min(vt, Math.sqrt(Math.max(0, (Gplan / k) + 2 * brakeA * Math.max(0, d - 6))));
    }
    if (mist === "early") vt *= 0.92;
    // never drive into the back of the car ahead
    for (const o of this.cars) {
      if (o === c) continue;
      const ds = this.wrapDs(o.s - c.s);
      if (ds > 0 && ds < 14 && Math.abs(o.x - c.x) < 2.1) vt = Math.min(vt, o.v + Math.max(0, ds - 6) * 0.8);
    }
    const gas = c.v < vt - 0.3;
    const brake = c.v > vt + 1.2;

    // racing line: outside before a corner, inside at the apex
    const kNow = w.sample(c.s + 8).k, kNext = w.sample(c.s + 60).k;
    let line = 0;
    if (Math.abs(kNow) > 0.004) line = Math.sign(kNow) * Math.min(3.0, Math.abs(kNow) * 800);
    else if (Math.abs(kNext) > 0.004) line = -Math.sign(kNext) * 2.8;

    // overtake slower cars; close the door only on the player (no fighting between AI cars)
    let blocker = null, chaser = null;
    for (const o of this.cars) {
      if (o === c) continue;
      const ds = this.wrapDs(o.s - c.s);
      if (ds > 0 && ds < 30 && Math.abs(o.x - c.x) < 2.4 && o.v < c.v + 1 && (!blocker || ds < blocker.ds)) blocker = { o, ds };
      if (o.isPlayer && ds < 0 && ds > -16 && o.v > c.v - 2) chaser = { o, ds };
    }
    let mode = "line";
    if (blocker) {
      const o = blocker.o;
      if (!c.passSide || c.passT <= 0) {
        const roomL = o.x - -(ROAD_HALF - 0.8), roomR = (ROAD_HALF - 0.8) - o.x;
        c.passSide = roomR > roomL ? 1 : -1; c.passT = 2.5;
      }
      line = o.x + c.passSide * 3.4;
      mode = "pass";
    } else if (chaser && this.state === "run" && c.aggr > 0.4) {
      if (!(c.blockT > 0)) { c.blockX = clamp(chaser.o.x, -3, 3); c.blockT = rnd(1.4, 2.4); }
      line = c.blockX;
      mode = "block";
    }
    c.passT = (c.passT || 0) - dt;
    c.blockT = (c.blockT || 0) - dt;
    c.mode = mode;
    line = clamp(line, -(ROAD_HALF - 0.8), ROAD_HALF - 0.8);
    // the AI steers by hand too: yaw to follow the bend plus a correction toward its line
    const kHere = w.sample(c.s + 0.5).k;
    const phiWant = clamp((line - c.x) * 0.1, -0.18, 0.18);
    const yawWant = c.v * kHere + (phiWant - c.phi) * 3;
    const steer = clamp(yawWant / Math.max(1e-3, maxYaw(c.v, G)), -1, 1);
    let stopping = this.state === "finished" && c.finished && c.v > 15;
    const st = stepCar(c, kHere, steer,
      { gas: gas && !stopping, brake: brake || stopping, G, top, a0: p.a0 * band, offroad: tr.offroad }, dt);
    this.barrier(c);
    return st.ds;
  }

  update(dt, input) {
    this.lastBrake = !!(input && (input.brake || !input.gas));
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
      const ds = c.isPlayer && this.state === "run" ? this.drivePlayer(c, dt, input) : this.driveAI(c, dt);
      c.yaw = -c.phi;
      c.s += ds;
      const lap = Math.floor(c.s / this.L);
      if (lap > c.lap) {
        if (lap >= 1 && !c.finished) {
          c.lastLap = this.t - c.lapStart;
          c.best = c.best == null ? c.lastLap : Math.min(c.best, c.lastLap);
          if (c.isPlayer && lap < this.laps) this.hooks.onToast(`Giro ${lap + 1}/${this.laps} · ${fmtLap(c.lastLap)}`, "good");
        }
        c.lap = lap;
        c.lapStart = this.t;
        if (lap >= this.laps && !c.finished) {
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
        // same momentum-based solver for everyone (s is unwrapped progress, so use the wrapped gap)
        const rel = resolveContact(a, b, ds, reachS, reachX);
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
    const pos = this.finishedOrder.indexOf(this.player) + 1;
    const p = this.player;
    const times = this.projectFinishTimes();
    const order = this.cars.map((c) => ({ name: c.name, isPlayer: c.isPlayer, carId: c.carId, time: times.get(c), best: c.isPlayer ? p.best : null, setup: c.setup }))
      .sort((a, b) => a.time - b.time);
    this.hooks.onFinish({ position: pos, total: this.cars.length, time: p.finishTime, best: p.best, contacts: this.contacts, order });
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

  // ------------------------------------------------------------------ render
  render(dtReal) {
    const w = this.world, tmp = {};
    for (const c of this.cars) {
      w.sample(c.s, c.x, tmp);
      c.obj.position.set(tmp.x, 0, tmp.z);
      let roll = -c.latV * 0.006;
      if (c.isPlayer && this.shake > 0) { c.obj.position.x += rnd(-0.06, 0.06); roll += rnd(-0.03, 0.03); }
      c.obj.rotation.set(0, tmp.heading + c.yaw, roll, "YXZ");
      const r = c.obj.userData.radius || 0.32;
      for (const wh of c.obj.userData.wheels || []) wh.userData.spin.rotation.x += (c.v / r) * dtReal;
    }
    const P = this.player.obj;
    P.userData.tail.emissiveIntensity = this.state !== "run" || this.lastBrake ? 2.2 : 0.6;
    w.sample(this.player.s, this.player.x, tmp);
    if (this.camHeading === null) this.camHeading = tmp.heading;
    this.camHeading += angDiff(tmp.heading + this.player.yaw * 0.65, this.camHeading) * Math.min(1, dtReal * 4);
    const dist = this.portrait ? 7.6 : 6.4, hgt = this.portrait ? 2.9 : 2.4;
    const dir = new THREE.Vector3(Math.sin(this.camHeading), 0, Math.cos(this.camHeading));
    const desired = new THREE.Vector3().copy(P.position).addScaledVector(dir, -dist);
    desired.y = P.position.y + hgt;
    if (!this.camPos) this.camPos = desired.clone();
    this.camPos.lerp(desired, 1 - Math.exp(-dtReal * 9));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) this.camera.position.add(new THREE.Vector3(rnd(-0.1, 0.1), rnd(-0.08, 0.08), 0));
    const look = new THREE.Vector3().copy(P.position).addScaledVector(dir, 5); look.y += 1.1;
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
    const cars = this.cars.map((c) => { w.sample(c.s, c.x, tmp); return { x: tmp.x, z: tmp.z, isPlayer: c.isPlayer, color: c.obj.userData.color || "#ffffff" }; });
    return { path: this.mapPath, cars };
  }

  hud() {
    const p = this.player;
    return {
      circuit: true, corner: this.world.nextCorner(p.s), kmh: Math.round(p.v * 3.6), pos: this.position(), total: this.cars.length,
      lap: clamp(p.lap + 1, 1, this.laps), laps: this.laps,
      lapTime: this.state === "countdown" || p.lap < 0 ? 0 : this.t - p.lapStart, best: p.best,
      off: this.state === "run" && Math.abs(p.x) > ROAD_HALF + 0.6, state: this.state
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
