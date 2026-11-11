import * as THREE from "three";
import { World } from "./world.js";
import { stepCar, smoothSteer, resolveContact, GRIP_ARCADE } from "./physics.js";
import { buildCar, trafficTemplatesFor, disposeCar } from "./carmodel.js";
import { CARS, defaultConfig, performance, ROAD_HALF, LANE_W, START_TIME, CP_FIRST, CP_GAP, START_S, cpBonus } from "./data.js";

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const LANES_X = [-LANE_W, 0, LANE_W];

export class Race {
  constructor(renderer, track, car, cfg, hooks, opts = {}) {
    this.renderer = renderer;
    this.track = track;
    this.car = car;
    this.cfg = cfg;
    this.hooks = hooks;
    this.perf = performance(car, cfg);
    this.mobile = !!opts.mobile;

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(track.fog, track.fogNear, track.fogFar);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000);

    const hemi = new THREE.HemisphereLight(track.hemi[0], track.hemi[1], track.hemiI);
    scene.add(hemi);
    const sun = (this.sun = new THREE.DirectionalLight(track.sun, track.sunI));
    sun.castShadow = true;
    const sm = this.mobile ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 160;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sunDir = new THREE.Vector3(-0.45, 0.75, -0.5).normalize();

    this.world = new World(scene, track);

    this.player = buildCar(car, cfg);
    scene.add(this.player);
    if (track.night) {
      const head = new THREE.SpotLight(0xfff2d8, 60, 90, 0.5, 0.6, 1.4);
      head.position.set(0, 0.8, car.shape.L / 2);
      const tgt = new THREE.Object3D(); tgt.position.set(0, 0, 30);
      this.player.add(head, tgt);
      head.target = tgt;
    }

    this.templates = trafficTemplatesFor(CARS, defaultConfig);
    this.traffic = [];
    this.reset();
  }

  reset() {
    this.s = START_S; this.x = 0; this.v = 0; this.maxS = START_S;
    this.timeLeft = START_TIME; this.elapsed = 0;
    this.cpReached = 0; this.near = 0; this.crashes = 0; this.coins = 0;
    this.turbo = 0; this.shield = 0; this.ghost = 0; this.slip = 0; this.slipDir = 1; this.shake = 0;
    this.yaw = 0; this.latV = 0; this.body = null; this.steerSm = 0;
    this.state = "ready";
    this.camHeading = 0;
    this.camPos = null;
    for (const t of this.traffic) this.scene.remove(t.obj);
    this.traffic = [];
    for (let i = 0; i < 9; i++) this.spawnTraffic(START_S + rnd(120, this.track.fogFar * 0.85));
    this.world.update(this.s);
  }

  spawnTraffic(s) {
    const x = pick(LANES_X);
    for (const t of this.traffic) if (Math.abs(t.s - s) < 30 && Math.abs(t.x - x) < 2) return;
    const tpl = pick(this.templates);
    const obj = tpl.clone();
    const d = this.world.difficulty(s);
    const big = tpl.userData.length > 6;
    const v = rnd(13, 24 + d * 8) * (big ? 0.8 : 1);
    const t = { s, x, target: x, v, cruise: v, obj, laneT: rnd(3, 8), hit: false, passed: false, contact: false, phi: 0, latV: 0,
      mass: tpl.userData.length > 7 ? 2.2 : big ? 1.1 : 0.5, len: tpl.userData.length, wid: tpl.userData.width };
    this.scene.add(obj);
    this.traffic.push(t);
  }

  setAspect(w, h) {
    this.camera.aspect = w / h;
    this.portrait = h > w;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ step
  update(dt, input) {
    this.lastInput = input;
    const live = this.state === "run";
    if (this.state === "ready" && input.gas) { this.state = "run"; this.hooks.onStart && this.hooks.onStart(); }
    const tr = this.track, p = this.perf;
    const road = this.world.sample(this.s + 0.5);
    const top = p.topMs * (this.turbo > 0 ? 1.2 : 1);
    let steerTarget = 0;
    if (live) {
      if (this.slip > 0) { this.slip -= dt; steerTarget = this.slipDir * 0.6; }
      else steerTarget = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    }
    if (live && !(this.slip > 0) && input.tilt != null) this.steerSm = (this.steerSm || 0) + (input.tilt - (this.steerSm || 0)) * Math.min(1, dt * 12);
    else this.steerSm = smoothSteer(this.steerSm || 0, steerTarget, dt);
    const steer = this.steerSm;
    const car = this.body || (this.body = { v: 0, x: 0, phi: 0, latV: 0 });
    car.v = this.v; car.x = this.x;
    const st = stepCar(car, road.k, steer, {
      gas: live && input.gas, brake: live && input.brake,
      G: p.grip * tr.grip * GRIP_ARCADE, top, a0: p.a0 * (this.turbo > 0 ? 1.6 : 1), offroad: tr.offroad,
      coast: this.state === "over" ? 4 : 1
    }, this.state === "ready" ? 0 : dt);
    if (this.state === "ready") { car.v = 0; st.ds = 0; }
    this.v = Math.min(car.v, p.topMs * 1.25);
    this.x = clamp(car.x, -(ROAD_HALF + 20), ROAD_HALF + 20);
    if (Math.abs(car.x) > ROAD_HALF + 20) car.phi *= 0.5;
    this.latV = car.latV;
    this.yaw = -car.phi; // positive rotation turns the nose left; phi > 0 points right
    this.understeer = st.over;
    this.s += st.ds;
    if (this.state !== "over") this.maxS = Math.max(this.maxS, this.s);
    if (this.turbo > 0) this.turbo = Math.max(0, this.turbo - dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);

    this.updateTraffic(dt);
    this.world.update(this.s);

    if (live) {
      // checkpoints
      const nextCp = START_S + CP_FIRST + CP_GAP * this.cpReached;
      if (this.s >= nextCp) {
        const bonus = cpBonus(this.cpReached, tr);
        this.timeLeft += bonus; this.cpReached++;
        this.hooks.onToast(`Traguardo ${this.cpReached} · +${bonus} s`, "good");
      }
      // items
      for (const it of this.world.items) {
        if (it.taken || Math.abs(it.s - this.s) > 2.6) continue;
        const reach = it.type === "cones" ? 2.0 : it.type === "oil" ? 1.9 : it.type === "coin" ? 1.5 : 1.6;
        if (Math.abs(it.x - this.x) < reach) { it.taken = true; this.applyItem(it.type); }
      }
      // traffic
      // traffic: real contacts (momentum + separation every step), no driving through cars
      const myLen = this.car.shape.L, myW = this.car.shape.W;
      const me = { s: this.s, x: this.x, v: this.v, phi: this.body ? this.body.phi : 0, latV: this.latV, mass: this.car.mass };
      for (const t of this.traffic) {
        const ds = t.s - me.s, dx = Math.abs(t.x - me.x);
        const reachS = (t.len + myLen) / 2 - 0.15, reachX = (t.wid + myW) / 2 - 0.08;
        const overlap = Math.abs(ds) < reachS && dx < reachX;
        if (overlap && this.ghost > 0) this.ghost = Math.max(this.ghost, 0.15); // stay ghosted until clear of the car
        if (overlap && !(this.ghost > 0)) {
          if (this.shield > 0 && !t.contact) {
            this.shield = 0; this.ghost = 1.2; t.hit = true;
            this.hooks.onToast("Scudo!", "good");
          } else {
            const rel = resolveContact(me, t, ds, reachS, reachX, dt);
            if (!t.contact && rel > 2.5) {
              this.crashes++; t.hit = true; this.shake = Math.min(0.6, 0.2 + rel * 0.02);
              this.hooks.onToast("Botto!", "bad");
            }
            t.contact = true;
          }
        } else if (t.contact && (Math.abs(ds) > reachS + 0.6 || dx > reachX + 0.3)) t.contact = false;
        if (!t.passed && ds < -reachS) {
          t.passed = true;
          if (!t.hit && dx < reachX + 1.4 && me.v > t.v * 1.1) { this.near++; this.timeLeft += 0.5; this.hooks.onToast("Scarto +0,5 s", "good"); }
        }
      }
      this.s = me.s; this.x = me.x; this.v = me.v;
      if (this.body) { this.body.phi = me.phi; this.body.v = me.v; this.body.x = me.x; }
      if (this.ghost > 0) this.ghost -= dt;
      this.elapsed += dt;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.state = "over";
        this.hooks.onFinish({ distance: Math.floor(this.maxS - START_S), time: this.elapsed, cps: this.cpReached, near: this.near, crashes: this.crashes, coins: this.coins });
      }
    }
  }

  applyItem(type) {
    const h = this.hooks;
    if (type === "coin") { this.coins++; h.onCoin && h.onCoin(this.coins); }
    else if (type === "clock") { this.timeLeft += 3; h.onToast("+3 s", "good"); }
    else if (type === "turbo") { this.turbo = 4; h.onToast("Turbo!", "good"); }
    else if (type === "shield") { this.shield = 1; h.onToast("Scudo attivo", "good"); }
    else if (type === "oil") { this.slip = 1.2; this.slipDir = Math.random() < 0.5 ? -1 : 1; h.onToast("Olio!", "bad"); }
    else if (type === "cones") {
      if (this.shield > 0) { this.shield = 0; this.ghost = Math.max(this.ghost, 0.6); this.shake = 0.15; h.onToast("Scudo: cantiere evitato", "good"); }
      else { this.v *= 0.45; this.shake = 0.35; h.onToast("Cantiere!", "bad"); }
    }
  }

  updateTraffic(dt) {
    const d = this.world.difficulty(this.s);
    const want = Math.round((8 + d * 12) * this.track.traffic);
    if (this.traffic.length < want && Math.random() < 0.1) this.spawnTraffic(this.s + rnd(this.track.fogFar * 0.55, this.track.fogFar * 0.95));
    const laneFree = (t, lane) => {
      for (const o of this.traffic) if (o !== t && Math.abs(o.x - lane) < 2.4 && o.s - t.s > -14 && o.s - t.s < 28) return false;
      if (Math.abs(this.x - lane) < 2.4 && this.s - t.s > -16 && this.s - t.s < 12) return false;
      return true;
    };
    for (const t of this.traffic) {
      // car ahead in the same lane: follow it or change lane if the other lane is free
      let lead = null;
      for (const o of this.traffic) {
        if (o === t || Math.abs(o.x - t.x) > 2.2) continue;
        const ds = o.s - t.s;
        if (ds > 0 && ds < 30 && (!lead || ds < lead.s - t.s)) lead = o;
      }
      if ((t.laneT -= dt) <= 0) {
        t.laneT = rnd(3, 8);
        if (Math.random() < 0.3 + d * 0.3) {
          const lane = clamp(t.target + pick([-LANE_W, LANE_W]), -LANE_W, LANE_W);
          if (lane !== t.target && laneFree(t, lane)) t.target = lane;
        }
      }
      if (lead && lead.v < t.v) {
        const options = [t.target - LANE_W, t.target + LANE_W].filter((l) => l >= -LANE_W - 0.1 && l <= LANE_W + 0.1 && laneFree(t, l));
        if (options.length && Math.abs(t.x - t.target) < 0.3) t.target = pick(options);
        else if (lead.s - t.s < 16) t.v = Math.min(t.v, lead.v);
      }
      t.v += (t.cruise - t.v) * Math.min(1, dt * 0.4);
      t.s += t.v * dt;
      const diff = t.target - t.x;
      t.latV = Math.sign(diff) * Math.min(Math.abs(diff) / dt, 1.3);
      t.x += Math.sign(diff) * Math.min(Math.abs(diff), 1.3 * dt);
      t.phi *= Math.pow(0.9, dt * 60);
    }
    // traffic never overlaps other traffic
    for (let i = 0; i < this.traffic.length; i++) for (let j = i + 1; j < this.traffic.length; j++) {
      const a = this.traffic[i], b = this.traffic[j];
      resolveContact(a, b, b.s - a.s, (a.len + b.len) / 2 - 0.1, (a.wid + b.wid) / 2 - 0.05, dt);
    }
    const keep = [];
    for (const t of this.traffic) { if (t.s > this.s - 40) keep.push(t); else this.scene.remove(t.obj); }
    this.traffic = keep;
  }

  // ------------------------------------------------------------------ render
  render(dtReal, time) {
    const w = this.world;
    const tmp = {};
    // player
    w.sample(this.s, this.x, tmp);
    const roadY = w.terrainY(this.s, this.x);
    const P = this.player;
    P.position.set(tmp.x, Math.abs(this.x) > ROAD_HALF + 0.7 ? roadY : tmp.y, tmp.z);
    let roll = -this.latV * 0.006;
    if (this.shake > 0) { P.position.x += rnd(-0.06, 0.06); P.position.y += rnd(0, 0.06); roll += rnd(-0.03, 0.03); }
    P.rotation.set(-tmp.slope, tmp.heading + this.yaw, roll, "YXZ");
    const r = P.userData.radius || 0.32;
    for (const wh of P.userData.wheels || []) wh.userData.spin.rotation.x += (this.v / r) * dtReal;
    const braking = !(this.state === "run") || this.lastInput?.brake || !this.lastInput?.gas;
    P.userData.tail.emissiveIntensity = braking ? 2.2 : 0.6;

    // traffic
    for (const t of this.traffic) {
      w.sample(t.s, t.x, tmp);
      t.obj.position.set(tmp.x, tmp.y, tmp.z);
      t.obj.rotation.set(-tmp.slope, tmp.heading - (t.target - t.x) * 0.04, 0, "YXZ");
    }
    // pickups bob
    for (const it of w.items) {
      if (!it.obj) continue;
      if (it.obj.isSprite) it.obj.position.y = it.obj.userData.baseY + Math.sin(time * 0.004 + it.s) * 0.15;
      else if (it.obj.userData.coin) it.obj.rotation.y += dtReal * 3;
    }

    // camera
    const heading = tmp.heading;
    w.sample(this.s, this.x, tmp);
    this.camHeading += angDiff(tmp.heading + this.yaw * 0.65, this.camHeading) * Math.min(1, dtReal * 4);
    const dist = this.portrait ? 7.6 : 6.4, hgt = this.portrait ? 2.9 : 2.4;
    const dir = new THREE.Vector3(Math.sin(this.camHeading), 0, Math.cos(this.camHeading));
    const desired = new THREE.Vector3().copy(P.position).addScaledVector(dir, -dist);
    desired.y = P.position.y + hgt;
    if (!this.camPos) this.camPos = desired.clone();
    this.camPos.lerp(desired, 1 - Math.exp(-dtReal * 9));
    // keep camera above the ground on crests
    const camGround = w.terrainY(Math.max(0, this.s - dist), this.x) + 1.2;
    if (this.camPos.y < camGround) this.camPos.y = camGround;
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) this.camera.position.add(new THREE.Vector3(rnd(-0.1, 0.1), rnd(-0.08, 0.08), 0));
    const look = new THREE.Vector3().copy(P.position).addScaledVector(dir, 5);
    look.y += 1.1;
    this.camera.lookAt(look);
    if (this.rearView) {
      // look back from the roof
      const eye = new THREE.Vector3().copy(P.position).addScaledVector(dir, 0.3); eye.y += 1.75;
      const tgt = new THREE.Vector3().copy(P.position).addScaledVector(dir, -30); tgt.y += 0.9;
      this.camera.position.copy(eye); this.camera.lookAt(tgt);
    }
    const speedFov = Math.min(1, this.v / 70) * 10 + (this.turbo > 0 ? 6 : 0);
    const baseFov = this.portrait ? 74 : 62;
    const fov = baseFov + speedFov;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dtReal * 3); this.camera.updateProjectionMatrix(); }

    // sun follows the car so shadows stay sharp
    this.sun.position.copy(P.position).addScaledVector(this.sunDir, 70);
    this.sun.target.position.copy(P.position);
    w.followCamera(this.camera);

    this.renderer.render(this.scene, this.camera);
  }

  // what the sound engine needs this frame
  audioState(input) {
    const v = this.state === "run" || this.state === "ready" ? this.v : 0;
    const turnHard = Math.max(0, Math.abs(this.steerSm || 0) - 0.75) * 4 * Math.min(1, this.v / 30);
    const off = this.state === "run" && Math.abs(this.x) > ROAD_HALF + 0.6 && this.v > 5;
    return {
      v, top: this.perf.topMs, gas: !!(input && input.gas), brake: !!(input && input.brake),
      skid: this.state !== "run" ? 0 : Math.min(1, (this.slip > 0 ? 0.8 : 0) + turnHard + (off ? 0.5 : 0) + (input && input.brake && this.v > 15 ? 0.25 : 0)),
      offroad: off,
      others: this.traffic.map((t) => ({ id: t, ds: t.s - this.s, dx: t.x - this.x, v: t.v, top: Math.max(30, t.v * 1.5), carId: null }))
    };
  }
  hud() {
    const toCp = Math.max(0, Math.ceil(START_S + CP_FIRST + CP_GAP * this.cpReached - this.s));
    return {
      kmh: Math.round(this.v * 3.6), dist: Math.floor(this.maxS - START_S), time: this.timeLeft, toCp,
      corner: this.world.nextCorner(this.s), coins: this.coins, turbo: this.turbo, shield: this.shield > 0, slip: this.slip > 0 && this.state === "run",
      off: this.state === "run" && Math.abs(this.x) > ROAD_HALF + 0.6, state: this.state
    };
  }

  dispose() {
    this.world.dispose();
    for (const t of this.traffic) this.scene.remove(t.obj);
    disposeCar(this.player);
    this.scene.clear();
  }
}
