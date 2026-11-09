import * as THREE from "three";
import { World } from "./world.js";
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
    this.cpReached = 0; this.near = 0; this.crashes = 0;
    this.turbo = 0; this.shield = 0; this.slip = 0; this.slipDir = 1; this.shake = 0;
    this.yaw = 0; this.latV = 0;
    this.state = "ready";
    this.camHeading = 0;
    this.camPos = null;
    for (const t of this.traffic) this.scene.remove(t.obj);
    this.traffic = [];
    for (let i = 0; i < 4; i++) this.spawnTraffic(START_S + rnd(160, this.track.fogFar * 0.8));
    this.world.update(this.s);
  }

  spawnTraffic(s) {
    const x = pick(LANES_X);
    for (const t of this.traffic) if (Math.abs(t.s - s) < 30 && Math.abs(t.x - x) < 2) return;
    const tpl = pick(this.templates);
    const obj = tpl.clone();
    const d = this.world.difficulty(s);
    const big = tpl.userData.length > 6;
    const t = { s, x, target: x, v: rnd(13, 24 + d * 8) * (big ? 0.8 : 1), obj, laneT: rnd(3, 8), hit: false, passed: false,
      len: tpl.userData.length, wid: tpl.userData.width };
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
    const off = Math.abs(this.x) > ROAD_HALF + 0.6;
    const top = p.topMs * (this.turbo > 0 ? 1.2 : 1);

    // longitudinal
    let a;
    if (live && input.brake) a = -12;
    else if (live && input.gas) a = this.v < top ? p.a0 * Math.max(0.08, 1 - Math.pow(this.v / top, 1.8)) * (this.turbo > 0 ? 1.6 : 1) : -2;
    else a = -(1.2 + 0.00045 * this.v * this.v) * (this.state === "over" ? 4 : 1);
    if (off && this.v > p.topMs * tr.offroad) a -= 14;
    this.v = clamp(this.v + a * dt, 0, p.topMs * 1.25);

    // lateral
    const G = p.grip * tr.grip;
    const aReq = this.v * this.v * road.k;                  // + = curve to the right
    const over = Math.abs(aReq) / G;
    const drift = -Math.sign(aReq) * (over * 2.6 + Math.max(0, Math.abs(aReq) - G) * 0.9);
    let steer = 0;
    const steerMax = 7 * clamp(this.v / 12, 0.25, 1) * (0.85 + 0.15 * Math.min(1.4, G / 12));
    if (live) {
      if (this.slip > 0) { this.slip -= dt; steer = this.slipDir * 6 * clamp(this.v / 20, 0.3, 1); }
      else steer = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * steerMax;
    }
    const latTarget = steer + (this.state === "ready" ? 0 : drift);
    this.latV += (latTarget - this.latV) * Math.min(1, dt * 10);
    this.x = clamp(this.x + this.latV * dt, -(ROAD_HALF + 20), ROAD_HALF + 20);
    this.yaw += (clamp(Math.atan2(this.latV, Math.max(this.v, 4)), -0.4, 0.4) - this.yaw) * Math.min(1, dt * 8);

    this.s += this.v * dt;
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
        const reach = it.type === "cones" ? 2.0 : it.type === "oil" ? 1.9 : 1.6;
        if (Math.abs(it.x - this.x) < reach) { it.taken = true; this.applyItem(it.type); }
      }
      // traffic
      const myLen = this.car.shape.L;
      for (const t of this.traffic) {
        const ds = t.s - this.s;
        const dx = Math.abs(t.x - this.x);
        const reachS = (t.len + myLen) / 2 - 0.2;
        const reachX = (t.wid + this.car.shape.W) / 2 - 0.12;
        if (!t.hit && ds > -reachS && ds < reachS && dx < reachX && this.v > t.v) {
          t.hit = true;
          if (this.shield > 0) { this.shield = 0; this.hooks.onToast("Scudo!", "good"); continue; }
          this.crashes++;
          this.v = t.v * (0.5 + 0.3 * this.car.mass);
          this.s = t.s - reachS - 0.4;
          this.shake = 0.45;
          this.hooks.onToast("Botto!", "bad");
        } else if (!t.passed && ds < -reachS) {
          t.passed = true;
          if (!t.hit && dx < reachX + 1.4 && this.v > t.v * 1.1) { this.near++; this.timeLeft += 0.5; this.hooks.onToast("Scarto +0,5 s", "good"); }
        }
      }
      this.elapsed += dt;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.state = "over";
        this.hooks.onFinish({ distance: Math.floor(this.maxS - START_S), time: this.elapsed, cps: this.cpReached, near: this.near, crashes: this.crashes });
      }
    }
  }

  applyItem(type) {
    const h = this.hooks;
    if (type === "clock") { this.timeLeft += 3; h.onToast("+3 s", "good"); }
    else if (type === "turbo") { this.turbo = 4; h.onToast("Turbo!", "good"); }
    else if (type === "shield") { this.shield = 1; h.onToast("Scudo attivo", "good"); }
    else if (type === "oil") { this.slip = 1.2; this.slipDir = Math.random() < 0.5 ? -1 : 1; h.onToast("Olio!", "bad"); }
    else if (type === "cones") { this.v *= 0.45; this.shake = 0.35; h.onToast("Cantiere!", "bad"); }
  }

  updateTraffic(dt) {
    const d = this.world.difficulty(this.s);
    const want = Math.round((4 + d * 9) * this.track.traffic);
    if (this.traffic.length < want && Math.random() < 0.05) this.spawnTraffic(this.s + rnd(this.track.fogFar * 0.65, this.track.fogFar * 0.95));
    for (const t of this.traffic) {
      t.s += t.v * dt;
      if ((t.laneT -= dt) <= 0) {
        t.laneT = rnd(3, 8);
        if (Math.random() < 0.3 + d * 0.3) t.target = clamp(t.target + pick([-LANE_W, LANE_W]), -LANE_W, LANE_W);
      }
      const diff = t.target - t.x;
      t.x += Math.sign(diff) * Math.min(Math.abs(diff), 1.3 * dt);
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
      t.obj.rotation.set(-tmp.slope, tmp.heading + (t.target - t.x) * 0.04, 0, "YXZ");
    }
    // pickups bob
    for (const it of w.items) if (it.obj && it.obj.isSprite) it.obj.position.y = it.obj.userData.baseY + Math.sin(time * 0.004 + it.s) * 0.15;

    // camera
    const heading = tmp.heading;
    w.sample(this.s, this.x, tmp);
    this.camHeading += angDiff(tmp.heading + this.yaw * 0.3, this.camHeading) * Math.min(1, dtReal * 4);
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

  hud() {
    const toCp = Math.max(0, Math.ceil(START_S + CP_FIRST + CP_GAP * this.cpReached - this.s));
    return {
      kmh: Math.round(this.v * 3.6), dist: Math.floor(this.maxS - START_S), time: this.timeLeft, toCp,
      turbo: this.turbo, shield: this.shield > 0, slip: this.slip > 0 && this.state === "run",
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
