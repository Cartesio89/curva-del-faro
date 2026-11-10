import * as THREE from "three";
import { ROAD_HALF, LANE_W, CP_FIRST, CP_GAP, START_S } from "./data.js";

export const SEG_L = 5;            // metres per centreline step
const CHUNK = 40;                   // segments per mesh chunk (200 m)
const KERB = 0.7, VERGE = 26, OUTER = 320;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (p) => p * p * (3 - 2 * p);

// ------------------------------------------------------------------ textures
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
function roadTexture(color, night) {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = Math.random() * 40 - 20;
      g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 260})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    const line = night ? "#e8e4d6" : "#f3efe4";
    g.fillStyle = line;
    g.fillRect(6, 0, 6, h); g.fillRect(w - 12, 0, 6, h);
    for (const fx of [1 / 3, 2 / 3]) for (let y = 0; y < h; y += 128) g.fillRect(w * fx - 3, y, 6, 64);
  });
}
function kerbTexture(a, b) {
  return canvasTex(32, 64, (g, w, h) => { g.fillStyle = a; g.fillRect(0, 0, w, h / 2); g.fillStyle = b; g.fillRect(0, h / 2, w, h / 2); });
}
function checkerTexture() {
  return canvasTex(256, 64, (g, w, h) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? "#1d1d1f" : "#f4f1e8"; g.fillRect(x * 16, y * 16, 16, 16); }
  });
}
function bannerTexture() {
  return canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = "#24212c"; g.fillRect(0, 0, w, h);
    for (const x0 of [0, w - 128]) for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { g.fillStyle = (r + c) % 2 ? "#f4f1e8" : "#1d1d1f"; g.fillRect(x0 + c * 32, r * 32, 32, 32); }
    g.fillStyle = "#ffb23e"; g.font = "bold 84px Arial Black, Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("TRAGUARDO", w / 2, h / 2 + 4);
  }, false);
}
function signTexture(kind, dir) {
  return canvasTex(128, 128, (g, w, h) => {
    if (kind === "chevron") {
      g.fillStyle = "#c8352e"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#f4f1e8";
      for (let i = 0; i < 2; i++) {
        const x0 = 30 + i * 40; g.beginPath();
        if (dir > 0) { g.moveTo(x0, 20); g.lineTo(x0 + 30, 64); g.lineTo(x0, 108); g.lineTo(x0 - 14, 108); g.lineTo(x0 + 16, 64); g.lineTo(x0 - 14, 20); }
        else { g.moveTo(x0 + 16, 20); g.lineTo(x0 - 14, 64); g.lineTo(x0 + 16, 108); g.lineTo(x0 + 30, 108); g.lineTo(x0, 64); g.lineTo(x0 + 30, 20); }
        g.closePath(); g.fill();
      }
    } else {
      g.fillStyle = "#c8352e"; g.beginPath(); g.moveTo(64, 4); g.lineTo(124, 112); g.lineTo(4, 112); g.closePath(); g.fill();
      g.fillStyle = "#f7f3ea"; g.beginPath(); g.moveTo(64, 26); g.lineTo(106, 102); g.lineTo(22, 102); g.closePath(); g.fill();
      g.strokeStyle = "#1d1d1f"; g.lineWidth = 8; g.lineCap = "round"; g.beginPath();
      g.moveTo(64 - 4 * dir, 96); g.bezierCurveTo(64 - 4 * dir, 70, 64 + 18 * dir, 74, 64 + 16 * dir, 54); g.stroke();
      g.fillStyle = "#1d1d1f"; g.beginPath(); g.moveTo(64 + 16 * dir - 10, 58); g.lineTo(64 + 16 * dir, 42); g.lineTo(64 + 16 * dir + 10, 58); g.closePath(); g.fill();
    }
  }, false);
}
function windowsTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = "#1c1d26"; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 18) for (let x = 8; x < w; x += 20) {
      const on = Math.random() < 0.45;
      g.fillStyle = on ? (Math.random() < 0.5 ? "#ffd98a" : "#cfe2ff") : "#2a2c38";
      g.fillRect(x, y, 12, 10);
    }
  });
}
export function iconTexture(type) {
  const c = document.createElement("canvas"); c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  const base = { clock: "#f0a224", turbo: "#2a7fc0", shield: "#2f9b6a" }[type];
  const x = 64, y = 64;
  g.fillStyle = "rgba(255,255,255,0.4)"; g.beginPath(); g.arc(x, y, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = base; g.beginPath(); g.arc(x, y, 54, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#fff"; g.lineWidth = 5; g.stroke();
  g.fillStyle = "#fff8ea";
  if (type === "clock") {
    g.beginPath(); g.arc(x, y, 34, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#24212c"; g.lineWidth = 6; g.lineCap = "round";
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 24); g.moveTo(x, y); g.lineTo(x + 17, y + 6); g.stroke();
  } else if (type === "turbo") {
    g.beginPath(); g.moveTo(x + 7, y - 38); g.lineTo(x - 22, y + 5); g.lineTo(x - 1, y + 5); g.lineTo(x - 9, y + 38); g.lineTo(x + 22, y - 7); g.lineTo(x + 1, y - 7); g.closePath(); g.fill();
  } else {
    g.beginPath(); g.moveTo(x, y - 35); g.lineTo(x + 29, y - 25); g.quadraticCurveTo(x + 27, y + 20, x, y + 37); g.quadraticCurveTo(x - 27, y + 20, x - 29, y - 25); g.closePath(); g.fill();
  }
  return c;
}

// ------------------------------------------------------------------ geometry helpers
// Merge simple geometries into one non-indexed BufferGeometry with per-vertex colour.
function merged(parts) {
  const pos = [], nor = [], col = [];
  const tmp = new THREE.Color();
  for (const { geo, color, m } of parts) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    g.computeVertexNormals();
    tmp.set(color);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) col.push(tmp.r, tmp.g, tmp.b);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return out;
}
const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));

function sceneryKit(track) {
  const kit = {};
  const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  kit.vc = vc;
  kit.cypress = merged([
    { geo: new THREE.CylinderGeometry(0.18, 0.22, 1.2, 6), color: "#5a3d26", m: M(0, 0.6) },
    { geo: new THREE.CylinderGeometry(0.05, 1.0, 8.5, 8), color: "#2b4a25", m: M(0, 5.2) }
  ]);
  kit.pine = merged([
    { geo: new THREE.CylinderGeometry(0.22, 0.3, 4, 6), color: "#5a3d26", m: M(0, 2) },
    { geo: new THREE.SphereGeometry(2.6, 8, 6), color: "#3b5a2c", m: M(0, 4.6, 0, 1.3, 0.55, 1.3) }
  ]);
  kit.snowpine = merged([
    { geo: new THREE.CylinderGeometry(0.2, 0.25, 1.4, 6), color: "#4a3626", m: M(0, 0.7) },
    { geo: new THREE.ConeGeometry(2.2, 3.6, 8), color: "#2c4a37", m: M(0, 2.8) },
    { geo: new THREE.ConeGeometry(1.7, 3.0, 8), color: "#e9eef2", m: M(0, 4.4) },
    { geo: new THREE.ConeGeometry(1.1, 2.4, 8), color: "#2c4a37", m: M(0, 5.6) },
    { geo: new THREE.ConeGeometry(0.6, 1.4, 8), color: "#f4f7f9", m: M(0, 6.7) }
  ]);
  kit.post = merged([
    { geo: new THREE.BoxGeometry(0.12, 1.1, 0.12), color: "#f4f1e8", m: M(0, 0.55) },
    { geo: new THREE.BoxGeometry(0.13, 0.22, 0.13), color: "#1d1d1f", m: M(0, 0.86) }
  ]);
  kit.vine = merged([
    { geo: new THREE.BoxGeometry(0.7, 1.2, 9), color: "#4d7a2a", m: M(0, 0.8) },
    { geo: new THREE.BoxGeometry(0.1, 1.5, 0.1), color: "#6a4a2a", m: M(0, 0.75, 4.5) },
    { geo: new THREE.BoxGeometry(0.1, 1.5, 0.1), color: "#6a4a2a", m: M(0, 0.75, -4.5) }
  ]);
  kit.rock = merged([{ geo: new THREE.DodecahedronGeometry(2.2, 0), color: "#b5653a", m: M(0, 1.2, 0, 1.3, 0.9, 1) },
    { geo: new THREE.DodecahedronGeometry(1.3, 0), color: "#a3582f", m: M(1.8, 0.7, 0.6) }]);
  kit.cactus = merged([
    { geo: new THREE.CylinderGeometry(0.28, 0.32, 4, 7), color: "#4f7d3a", m: M(0, 2) },
    { geo: new THREE.CylinderGeometry(0.18, 0.18, 1.6, 6), color: "#4f7d3a", m: M(0.6, 2.4) },
    { geo: new THREE.CylinderGeometry(0.18, 0.18, 0.7, 6), color: "#4f7d3a", m: new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.35, 1.7, 0) }
  ]);
  kit.lamp = merged([
    { geo: new THREE.CylinderGeometry(0.09, 0.12, 8, 6), color: "#3a3b42", m: M(0, 4) },
    { geo: new THREE.BoxGeometry(2.2, 0.12, 0.12), color: "#3a3b42", m: M(1.0, 7.9, 0) }
  ]);
  kit.lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.5), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
  kit.lampHeadGeo = kit.lampHead.geometry;
  kit.lampHeadMat = kit.lampHead.material;
  kit.buildingMat = new THREE.MeshStandardMaterial({ color: 0x2a2c36, roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.9, emissiveMap: windowsTexture() });
  kit.buildingMat.emissiveMap.repeat.set(1, 1);
  kit.building = new THREE.BoxGeometry(1, 1, 1);
  kit.building.translate(0, 0.5, 0);
  kit.signGeo = new THREE.BoxGeometry(1.3, 1.3, 0.08);
  kit.poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6);
  kit.poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.6 });
  const signMat = (t) => [kit.poleMat, kit.poleMat, kit.poleMat, kit.poleMat, new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }), kit.poleMat];
  kit.chevMat = { 1: signMat(signTexture("chevron", 1)), "-1": signMat(signTexture("chevron", -1)) };
  kit.warnMat = { 1: signMat(signTexture("warn", 1)), "-1": signMat(signTexture("warn", -1)) };
  kit.signMat = signMat;
  kit.boardGeo = new THREE.BoxGeometry(2.4, 1.85, 0.1);
  kit.boardCache = {};
  kit.pillarGeo = new THREE.BoxGeometry(0.6, 7, 0.6);
  kit.pillarMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.7 });
  kit.bannerGeo = new THREE.BoxGeometry(ROAD_HALF * 2 + 3.4, 1.6, 0.4);
  const bt = bannerTexture();
  const bm = new THREE.MeshStandardMaterial({ map: bt, roughness: 0.6, emissive: track.night ? 0xffffff : 0x000000, emissiveMap: track.night ? bt : null, emissiveIntensity: 0.6 });
  kit.bannerMat = [kit.pillarMat, kit.pillarMat, kit.pillarMat, kit.pillarMat, bm, bm];
  kit.checkerMat = new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  // items
  kit.coneGeo = merged([
    { geo: new THREE.ConeGeometry(0.28, 0.75, 10), color: "#ff6a1f", m: M(0, 0.42) },
    { geo: new THREE.CylinderGeometry(0.17, 0.2, 0.12, 10), color: "#f4f1e8", m: M(0, 0.45) },
    { geo: new THREE.BoxGeometry(0.62, 0.05, 0.62), color: "#1d1d1f", m: M(0, 0.025) }
  ]);
  const oilTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "rgba(10,10,14,0.92)";
    g.beginPath(); g.ellipse(128, 128, 118, 90, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(70, 110, 60, 40, 0.4, 0, Math.PI * 2); g.fill();
    const s = g.createLinearGradient(40, 0, 220, 0);
    s.addColorStop(0, "rgba(120,90,200,0.55)"); s.addColorStop(0.5, "rgba(60,180,170,0.5)"); s.addColorStop(1, "rgba(220,170,60,0.5)");
    g.fillStyle = s; g.beginPath(); g.ellipse(140, 120, 70, 16, 0.2, 0, Math.PI * 2); g.fill();
  }, false);
  kit.oilGeo = new THREE.PlaneGeometry(3.2, 3.2); kit.oilGeo.rotateX(-Math.PI / 2);
  kit.oilMat = new THREE.MeshStandardMaterial({ map: oilTex, transparent: true, roughness: 0.05, metalness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const coinFace = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = "#f2b632"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#c98a12"; g.lineWidth = 10; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#8a5a06"; g.font = "bold 72px Arial Black, Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("M", 64, 70);
  }, false);
  kit.coinGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20);
  kit.coinGeo.rotateX(Math.PI / 2);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd99a1e, metalness: 0.8, roughness: 0.25, emissive: 0x3a2400 });
  const faceMat = new THREE.MeshStandardMaterial({ map: coinFace, metalness: 0.6, roughness: 0.3, emissive: 0x2a1a00 });
  kit.coinMat = [edgeMat, faceMat, faceMat];
  kit.icon = {};
  for (const t of ["clock", "turbo", "shield"]) {
    const tex = new THREE.CanvasTexture(iconTexture(t)); tex.colorSpace = THREE.SRGBColorSpace;
    kit.icon[t] = new THREE.SpriteMaterial({ map: tex, depthWrite: false });
  }
  return kit;
}

// ------------------------------------------------------------------ sky + skyline
function skyDome(track) {
  const geo = new THREE.SphereGeometry(4000, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(track.sky[0]) }, mid: { value: new THREE.Color(track.sky[1]) }, low: { value: new THREE.Color(track.sky[2]) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, clamp((h-0.12)/0.5,0.0,1.0)) : mix(low, mid, clamp((h+0.02)/0.14,0.0,1.0)); gl_FragColor = vec4(c,1.0); }"
  });
  mat.toneMapped = false;
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
function skylineMesh(track) {
  const kind = track.skyline;
  const tex = canvasTex(2048, 256, (g, w, h) => {
    const layer = (color, base, amp, f1, f2, ph) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) {
        let y;
        if (kind === "city") { const b = Math.floor(x / 26); y = base - ((Math.sin(b * 12.9898 + ph) * 43758.5453) % 1 + 1) % 1 * amp; }
        else if (kind === "mesa") { const v = Math.sin(x * f1 + ph) + Math.sin(x * f2 + ph * 2) * 0.5; y = base - (v > 0.35 ? amp : v > -0.2 ? amp * 0.25 : 0); }
        else if (kind === "alps") { y = base - amp * Math.abs(Math.sin(x * f1 + ph)) - amp * 0.5 * Math.abs(Math.sin(x * f2 + ph)); }
        else y = base - amp * (0.5 + 0.5 * Math.sin(x * f1 + ph)) - amp * 0.4 * Math.sin(x * f2 + ph * 3);
        g.lineTo(x, y);
      }
      g.lineTo(w, h); g.closePath(); g.fill();
    };
    // the canvas wraps around 360°, so frequencies are multiples of 2π/w
    const k = (n) => (Math.PI * 2 * n) / w;
    if (kind === "sea") { layer("#9c86a8", 170, 70, k(5), k(13), 1); g.fillStyle = "#5f88a6"; g.fillRect(0, 200, w, 56); }
    else if (kind === "hills") { layer("#9fb7c2", 160, 70, k(4), k(11), 2); layer("#6f8f55", 205, 50, k(7), k(17), 4); }
    else if (kind === "alps") { layer("#b9c6d3", 200, 120, k(9), k(23), 1); layer("#eef3f7", 215, 50, k(13), k(31), 3); }
    else if (kind === "mesa") { layer("#c98a5a", 200, 90, k(6), k(15), 2); layer("#a8643e", 230, 50, k(10), k(21), 5); }
    else { layer("#151830", 225, 150, 0, 0, 1); g.fillStyle = "rgba(255,220,150,0.5)"; for (let i = 0; i < 900; i++) g.fillRect(Math.random() * w, 100 + Math.random() * 150, 2, 2); }
  });
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const geo = new THREE.CylinderGeometry(2600, 2600, 520, 48, 1, true);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -9;
  m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------------ World
export class World {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.kit = sceneryKit(track);
    this.roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(track.road, track.night), roughness: 0.85, metalness: 0 });
    this.kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(track.kerb[0], track.kerb[1]), roughness: 0.7 });
    this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.sky = skyDome(track); this.root.add(this.sky);
    this.skyline = skylineMesh(track); this.root.add(this.skyline);
    // centreline
    this.k = []; this.px = [0]; this.pz = [0]; this.py = [0]; this.th = [0];
    this.lastY = 0;
    this.signs = [];          // {s, x, kind, dir}
    this.items = [];          // {s, x, type, taken, obj}
    this.chunks = new Map();
    this.cpIndex = 0;
    this.itemGap = 220;
    this.lastWarnS = -999;
    this.init();
  }

  init() { this.ensure(1500); }
  blocked() { return false; }
  difficulty(s) { return clamp(s / 9000, 0, 1); }
  get length() { return (this.k.length) * SEG_L; }

  pushSeg(k, y) {
    const i = this.k.length;
    this.k.push(k);
    const th = this.th[i] - k * SEG_L;
    this.th.push(th);
    this.px.push(this.px[i] + Math.sin(this.th[i]) * SEG_L);
    this.pz.push(this.pz[i] + Math.cos(this.th[i]) * SEG_L);
    this.py.push(y);
    this.lastY = y;
  }
  addRoad(enter, hold, leave, k, rise) {
    const y0 = this.lastY, n = enter + hold + leave;
    let j = 0;
    const yAt = () => y0 + rise * smooth(++j / n);
    for (let i = 0; i < enter; i++) this.pushSeg(k * smooth(i / enter), yAt());
    for (let i = 0; i < hold; i++) this.pushSeg(k, yAt());
    for (let i = 0; i < leave; i++) this.pushSeg(k * (1 - smooth(i / leave)), yAt());
  }
  randomRise(lenM) {
    const amp = this.track.hills;
    if (Math.random() < 0.35) return 0;
    let r = rnd(0.3, 1) * amp * Math.sign(Math.random() - 0.5) * Math.min(1, lenM / 400);
    if (Math.abs(this.lastY + r) > amp * 2.2) r = -r;
    return r;
  }
  addPiece() {
    const s0 = this.length;
    const d = this.difficulty(s0);
    const [kmin, kmax] = this.track.curve;
    if (s0 < 200) { this.addRoad(0, 40, 0, 0, 0); return; }
    const r = Math.random();
    const segs = (m) => Math.max(1, Math.round(m / SEG_L));
    if (r < 0.3) {
      const len = rnd(150, 450 - d * 150);
      this.addRoad(4, segs(len), 4, 0, this.randomRise(len));
    } else if (r < 0.8) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const k = rnd(kmin, kmin + (kmax - kmin) * (0.45 + 0.55 * d)) * dir;
      const en = segs(rnd(60, 140)), ho = segs(rnd(60, 320)), le = segs(rnd(60, 140));
      const tight = Math.abs(k) > (kmin + kmax) / 2;
      const lenM = (en + ho + le) * SEG_L;
      this.addRoad(en, ho, le, k, this.randomRise(lenM));
      if (tight) for (let s = s0 + en * SEG_L * 0.5; s < s0 + (en + ho) * SEG_L; s += 30) this.signs.push({ s, x: -dir * (ROAD_HALF + 2.0), kind: "chevron", dir });
    } else {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const k = rnd(kmin, kmin + (kmax - kmin) * (0.4 + 0.5 * d));
      const en = segs(70), ho = segs(rnd(60, 150)), le = segs(70);
      this.addRoad(en, ho, le, k * dir, 0);
      this.addRoad(en, ho, le, -k * dir, this.randomRise(400));
    }
  }
  placeItems(fromS, toS) {
    while (this.nextItemS === undefined || this.nextItemS < toS) {
      if (this.nextItemS === undefined) this.nextItemS = START_S + 110;
      const s = this.nextItemS;
      const d = this.difficulty(s);
      const nearCp = this.cpS(this.cpAround(s)) - s;
      if (Math.abs(nearCp) > 40) {
        const weights = [["clock", 18], ["turbo", 18], ["shield", 12], ["oil", 16 + 16 * d], ["cones", 14 + 18 * d]];
        const tot = weights.reduce((a, w) => a + w[1], 0);
        let roll = Math.random() * tot, type = "clock";
        for (const [t, w] of weights) if ((roll -= w) < 0) { type = t; break; }
        this.items.push({ s, x: pick([-LANE_W, 0, LANE_W]) + rnd(-0.4, 0.4), type, taken: false, obj: null });
      }
      this.nextItemS += rnd(70, 160) / (1 + d * 0.6);
    }
    // rows of coins, a lane at a time
    while (this.nextCoinS === undefined || this.nextCoinS < toS) {
      if (this.nextCoinS === undefined) this.nextCoinS = START_S + 160;
      const lane = pick([-LANE_W, 0, LANE_W]);
      const n = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this.items.push({ s: this.nextCoinS + i * 7, x: lane, type: "coin", taken: false, obj: null });
      this.nextCoinS += n * 7 + rnd(260, 460);
    }
  }
  cpS(k) { return START_S + CP_FIRST + CP_GAP * k; }
  cpAround(s) { return Math.max(0, Math.round((s - START_S - CP_FIRST) / CP_GAP)); }

  ensure(s) {
    while (this.length < s + 2600) this.addPiece();
    this.scanCorners();
    this.placeItems(0, s + 2400);
  }

  // Finds corners in the centreline and places 150 / 100 / 50 m approach boards before each one.
  // sev: 0 fast, 1 medium, 2 tight — by the speed the corner allows
  scanCorners() {
    const SL = this.segL || SEG_L;
    if (!this.corners) { this.corners = []; this.scanI = 0; this.cur = null; }
    const IN = 1 / 250, OUT = 1 / 320;
    for (; this.scanI < this.k.length; this.scanI++) {
      const i = this.scanI, k = this.k[i];
      const cur = this.cur;
      if (cur && (Math.abs(k) < OUT || Math.sign(k) !== cur.dir)) {
        cur.end = i * SL;
        if (cur.end - cur.s >= 15) this.addCorner(cur);
        this.cur = null;
      }
      if (!this.cur && Math.abs(k) > IN) this.cur = { s: i * SL, dir: Math.sign(k), kmax: 0 };
      if (this.cur) this.cur.kmax = Math.max(this.cur.kmax, Math.abs(k));
    }
  }
  addCorner(c) {
    const R = 1 / c.kmax;
    c.sev = R < 37 ? 2 : R < 103 ? 1 : 0;   // ≈ under 90 km/h, under 150 km/h, faster (average grip)
    const prev = this.corners[this.corners.length - 1];
    this.corners.push(c);
    const put = (d) => {
      let bs = c.s - d;
      if (this.loopL) bs = ((bs % this.loopL) + this.loopL) % this.loopL;
      else if (bs < 20) return;
      this.signs.push({ s: bs, x: -c.dir * (ROAD_HALF + 2.6), kind: "board", dir: c.dir, num: d, sev: c.sev });
    };
    let placed = 0;
    for (const d of [150, 100, 50]) {
      if (prev && c.s - d < prev.end + 10) continue;      // would sit inside the previous corner
      put(d); placed++;
    }
    if (!placed && prev) {                                 // corners close together: one board with the real distance
      const d = Math.floor((c.s - prev.end - 8) / 10) * 10;
      if (d >= 20) put(d);
    }
  }
  // next corner ahead of s: {dist, dir, sev} or null
  nextCorner(s) {
    const cs = this.corners || [];
    if (!cs.length) return null;
    let sm = s, off = 0;
    if (this.loopL) sm = ((s % this.loopL) + this.loopL) % this.loopL;
    let c = cs.find((x) => x.s > sm);
    if (!c && this.loopL) { c = cs[0]; off = this.loopL; }
    if (!c) return null;
    return { dist: c.s + off - sm, dir: c.dir, sev: c.sev };
  }

  // Sample the road at distance s, lateral offset x (positive = right).
  sample(s, x = 0, out = {}) {
    const n = this.k.length;
    const SL = this.segL || SEG_L;
    if (this.loopL) s = ((s % this.loopL) + this.loopL) % this.loopL;
    let i = Math.floor(s / SL);
    i = clamp(i, 0, n - 1);
    const f = clamp(s / SL - i, 0, 1);
    const th = this.th[i] + (this.th[i + 1] - this.th[i]) * f;
    const cx = this.px[i] + (this.px[i + 1] - this.px[i]) * f;
    const cz = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * f;
    const y0 = i > 0 ? this.py[i] : 0;
    const y = y0 + (this.py[i + 1] - y0) * f;
    out.x = cx - Math.cos(th) * x;
    out.z = cz + Math.sin(th) * x;
    out.y = y;
    out.heading = th;
    out.slope = Math.atan2(this.py[i + 1] - y0, SL);
    out.k = this.k[i];
    return out;
  }
  terrainY(s, x) {
    const p = this.sample(s, 0);
    const a = Math.abs(x);
    if (a <= ROAD_HALF + VERGE) return p.y;
    const t = smooth(clamp((a - ROAD_HALF - VERGE) / (OUTER - VERGE), 0, 1));
    const far = p.y * 0.5 + Math.sin(s * 0.004 + x * 0.01) * this.track.hills * 0.6 + (x > 0 ? 6 : 4);
    return p.y + (far - p.y) * t;
  }

  // -------------------------------------------------------------- chunks
  update(s) {
    this.ensure(s);
    const first = Math.max(0, Math.floor((s - 60) / (CHUNK * SEG_L)));
    const last = Math.floor((s + this.track.fogFar + 150) / (CHUNK * SEG_L));
    for (const [c, obj] of this.chunks) if (c < first || c > last) { this.disposeChunk(obj); this.chunks.delete(c); }
    for (let c = first; c <= last; c++) if (!this.chunks.has(c)) this.chunks.set(c, this.buildChunk(c));
    for (const it of this.items) {
      if (it.obj && (it.s < s - 30 || it.taken)) { this.root.remove(it.obj); it.obj = null; }
      if (!it.obj && !it.taken && it.s > s - 30 && it.s < s + this.track.fogFar) this.spawnItem(it);
    }
    if (this.items.length > 400) this.items = this.items.filter((it) => it.s > s - 60);
    if (this.signs.length > 400) this.signs = this.signs.filter((g) => g.s > s - 300);
    if (this.corners && this.corners.length > 200) this.corners = this.corners.filter((c) => c.end > s - 300);
  }
  followCamera(cam) {
    this.sky.position.copy(cam.position);
    this.skyline.position.set(cam.position.x, cam.position.y + 40, cam.position.z);
  }
  spawnItem(it) {
    const p = this.sample(it.s, it.x);
    let obj;
    if (it.type === "oil") {
      obj = new THREE.Mesh(this.kit.oilGeo, this.kit.oilMat);
      obj.position.set(p.x, p.y + 0.03, p.z);
      obj.rotation.y = p.heading + rnd(-0.4, 0.4);
    } else if (it.type === "cones") {
      obj = new THREE.Group();
      for (let i = -1; i <= 1; i++) {
        const c = new THREE.Mesh(this.kit.coneGeo, this.kit.vc);
        c.position.set(i * 0.9, 0, i === 0 ? 0.6 : 0);
        c.castShadow = true;
        obj.add(c);
      }
      obj.position.set(p.x, p.y, p.z);
      obj.rotation.y = p.heading;
    } else if (it.type === "coin") {
      obj = new THREE.Mesh(this.kit.coinGeo, this.kit.coinMat);
      obj.position.set(p.x, p.y + 0.85, p.z);
      obj.rotation.y = p.heading;
      obj.userData.baseY = p.y + 0.85;
      obj.userData.coin = true;
    } else {
      obj = new THREE.Sprite(this.kit.icon[it.type]);
      obj.scale.set(1.5, 1.5, 1.5);
      obj.position.set(p.x, p.y + 1.25, p.z);
      obj.userData.baseY = p.y + 1.25;
    }
    it.obj = obj;
    this.root.add(obj);
  }

  ribbon(s0, s1, offsets, uFn, vScale, yFn, colorFn) {
    // rows along s, columns across offsets
    const rows = Math.round((s1 - s0) / SEG_L) + 1;
    const cols = offsets.length;
    const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2);
    const col = colorFn ? new Float32Array(rows * cols * 3) : null;
    const tmp = {};
    for (let r = 0; r < rows; r++) {
      const s = s0 + r * ((s1 - s0) / (rows - 1));
      for (let c = 0; c < cols; c++) {
        const x = offsets[c];
        this.sample(s, x, tmp);
        const idx = r * cols + c;
        pos[idx * 3] = tmp.x; pos[idx * 3 + 1] = yFn ? yFn(s, x, tmp.y) : tmp.y; pos[idx * 3 + 2] = tmp.z;
        uv[idx * 2] = uFn(c); uv[idx * 2 + 1] = s / vScale;
        if (col) { const cc = colorFn(s, x); col[idx * 3] = cc.r; col[idx * 3 + 1] = cc.g; col[idx * 3 + 2] = cc.b; }
      }
    }
    const index = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }

  buildChunk(c) {
    const s0 = c * CHUNK * SEG_L, s1 = Math.min(s0 + CHUNK * SEG_L, this.loopL || Infinity);
    const grp = new THREE.Group();
    const owned = [];
    const tr = this.track;
    // road: flip winding so normals point up (index order a,d,b produces up-facing for our right vector)
    const road = new THREE.Mesh(this.ribbon(s0, s1, [ROAD_HALF, -ROAD_HALF], (ci) => ci, 20), this.roadMat);
    road.receiveShadow = true; grp.add(road); owned.push(road.geometry);
    for (const side of [-1, 1]) {
      const offs = side > 0 ? [ROAD_HALF + KERB, ROAD_HALF] : [-ROAD_HALF, -ROAD_HALF - KERB];
      const kerb = new THREE.Mesh(this.ribbon(s0, s1, offs, (ci) => ci, 4, (s, x, y) => y + 0.015), this.kerbMat);
      kerb.receiveShadow = true; grp.add(kerb); owned.push(kerb.geometry);
    }
    const base = new THREE.Color(tr.ground), verge = new THREE.Color(tr.verge), tmpC = new THREE.Color();
    const colorFn = (s, x) => {
      const a = Math.abs(x);
      const n = (Math.sin(s * 0.05 + x * 0.3) + Math.sin(s * 0.013 - x * 0.07)) * 0.03;
      tmpC.copy(a < ROAD_HALF + VERGE * 0.6 ? verge : base).offsetHSL(0, 0, n);
      return tmpC;
    };
    const yFn = (s, x, y) => (Math.abs(x) <= ROAD_HALF + KERB + 0.01 ? y - 0.02 : this.terrainY(s, x) - 0.03);
    for (const side of [-1, 1]) {
      const raw = this.groundRaw || [ROAD_HALF + KERB, ROAD_HALF + 4, ROAD_HALF + 12, ROAD_HALF + VERGE, ROAD_HALF + 70, ROAD_HALF + 160, OUTER];
      const offs = side > 0 ? raw.slice().reverse() : raw.map((v) => -v);
      const gm = new THREE.Mesh(this.ribbon(s0, s1, offs, () => 0, 10, yFn, colorFn), this.groundMat);
      gm.receiveShadow = true; grp.add(gm); owned.push(gm.geometry);
    }

    // scenery (instanced)
    const add = (geo, mat, list, shadow) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = !!shadow;
      im.frustumCulled = false;
      grp.add(im);
    };
    const tmp = {};
    const at = (s, x, sc = 1, ry = 0, ySc = sc) => {
      this.sample(s, x, tmp);
      return M(tmp.x, this.terrainY(s, x) - 0.05, tmp.z, sc, ySc, sc, tmp.heading + ry);
    };
    const lists = {};
    const push = (k, m) => { if (this.blocked(m.elements[12], m.elements[14], k)) return; (lists[k] || (lists[k] = [])).push(m); };
    const scen = tr.scenery;
    const rand = mulberry(c * 9973 + 17);
    if (scen.includes("post")) for (let s = s0; s < s1; s += 20) { push("post", at(s, ROAD_HALF + 1.2)); push("post", at(s, -ROAD_HALF - 1.2)); }
    if (scen.includes("cypress")) for (let s = s0; s < s1; s += 14) {
      if (rand() < 0.75) push("cypress", at(s + rand() * 10, (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 4 + rand() * 30), 0.8 + rand() * 0.5));
    }
    if (scen.includes("pine")) for (let s = s0; s < s1; s += 30) if (rand() < 0.6) push("pine", at(s, (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 10 + rand() * 50), 0.8 + rand() * 0.5));
    if (scen.includes("snowpine")) for (let s = s0; s < s1; s += 7) push("snowpine", at(s + rand() * 5, (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 4 + rand() * 60), 0.8 + rand() * 0.7));
    if (scen.includes("vine")) for (let s = s0; s < s1; s += 10) for (const side of [-1, 1]) for (let r = 0; r < 6; r++) push("vine", at(s, side * (ROAD_HALF + 6 + r * 3)));
    if (scen.includes("rock")) for (let s = s0; s < s1; s += 18) if (rand() < 0.7) push("rock", at(s, (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 6 + rand() * 80), 0.6 + rand() * 2.4, rand() * 6));
    if (scen.includes("cactus")) for (let s = s0; s < s1; s += 16) if (rand() < 0.5) push("cactus", at(s, (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 4 + rand() * 20), 0.8 + rand() * 0.5, rand() * 6));
    if (scen.includes("lamp")) for (let s = s0; s < s1; s += 25) {
      for (const side of [-1, 1]) {
        push("lamp", at(s, side * (ROAD_HALF + 1.4), 1, side > 0 ? 0 : Math.PI));
        this.sample(s, side * (ROAD_HALF + 0.4), tmp);
        push("lampHead", M(tmp.x, tmp.y + 7.85, tmp.z, 1, 1, 1, tmp.heading));
      }
    }
    if (scen.includes("building")) for (let s = s0; s < s1; s += 16) for (const side of [-1, 1]) {
      const h = 12 + rand() * 50, w = 10 + rand() * 8;
      this.sample(s, side * (ROAD_HALF + 14 + rand() * 6), tmp);
      push("building", M(tmp.x, tmp.y - 0.2, tmp.z, w, h, 14, tmp.heading));
    }
    const k = this.kit;
    add(k.post, k.vc, lists.post || []);
    add(k.cypress, k.vc, lists.cypress || [], true);
    add(k.pine, k.vc, lists.pine || [], true);
    add(k.snowpine, k.vc, lists.snowpine || [], true);
    add(k.vine, k.vc, lists.vine || []);
    add(k.rock, k.vc, lists.rock || [], true);
    add(k.cactus, k.vc, lists.cactus || [], true);
    add(k.lamp, k.vc, lists.lamp || []);
    add(k.lampHeadGeo, k.lampHeadMat, lists.lampHead || []);
    add(k.building, k.buildingMat, lists.building || []);

    // signs
    for (const sg of this.signs) {
      if (sg.s < s0 || sg.s >= s1) continue;
      const p = this.sample(sg.s, sg.x);
      const board = sg.kind === "board";
      const mats = board ? boardMat(k, sg.num, sg.dir, sg.sev) : sg.kind === "chevron" ? k.chevMat[sg.dir] : k.warnMat[sg.dir];
      const sign = new THREE.Mesh(board ? k.boardGeo : k.signGeo, mats);
      sign.position.set(p.x, p.y + (board ? 2.3 : 1.9), p.z);
      sign.rotation.y = p.heading + Math.PI;
      const pole = new THREE.Mesh(k.poleGeo, k.poleMat);
      pole.position.set(p.x, p.y + 0.8, p.z);
      if (board) { pole.scale.y = 1.4; pole.position.y = p.y + 1.1; }
      grp.add(sign, pole);
    }
    // checkpoints
    for (let kk = this.cpAround(s0) - 1; kk <= this.cpAround(s1) + 1; kk++) {
      if (kk < 0) continue;
      const cs = this.cpS(kk);
      if (cs < s0 || cs >= s1) continue;
      const p = this.sample(cs, 0);
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const pl = new THREE.Mesh(k.pillarGeo, k.pillarMat);
        pl.position.set(side * (ROAD_HALF + 1.4), 3.5, 0); pl.castShadow = true; g.add(pl);
      }
      const ban = new THREE.Mesh(k.bannerGeo, k.bannerMat);
      ban.position.set(0, 6.4, 0); g.add(ban);
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.heading + Math.PI;
      grp.add(g);
      const stripe = new THREE.Mesh(this.ribbon(cs - 1.5, cs + 1.5, [ROAD_HALF, -ROAD_HALF], (ci) => ci * 4, 3, (s, x, y) => y + 0.02), k.checkerMat);
      stripe.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 1) a[i] = (v * 3 - (cs - 1.5)) / 3; });
      stripe.geometry.attributes.uv.needsUpdate = true;
      stripe.receiveShadow = true;
      grp.add(stripe); owned.push(stripe.geometry);
    }

    this.root.add(grp);
    return { grp, owned };
  }
  disposeChunk(obj) {
    this.root.remove(obj.grp);
    for (const g of obj.owned) g.dispose();
    obj.grp.traverse((m) => { if (m.isInstancedMesh) m.dispose(); });
  }
  dispose() {
    for (const [, obj] of this.chunks) this.disposeChunk(obj);
    this.chunks.clear();
    this.scene.remove(this.root);
  }
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ closed circuits
// Same road engine, but the centreline is a closed spline built once, the ground is a flat plane
// and the whole lap is meshed up front.
export class CircuitWorld extends World {
  init() {
    const c = this.track.circuit;
    const curve = new THREE.CatmullRomCurve3(c.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "centripetal");
    const L = curve.getLength();
    const n = Math.round(L / SEG_L);
    const P = curve.getSpacedPoints(n);          // n+1 points, last == first
    this.loopL = L;
    this.segL = L / n;
    this.px = []; this.pz = []; this.py = []; this.th = []; this.k = [];
    for (let i = 0; i <= n; i++) { this.px.push(P[i].x); this.pz.push(P[i].z); this.py.push(0); }
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const a = P[i % n], b = P[(i + 1) % n];
      let h = Math.atan2(b.x - a.x, b.z - a.z);
      if (prev !== null) h = prev + Math.atan2(Math.sin(h - prev), Math.cos(h - prev));
      this.th.push(h); prev = h;
    }
    for (let i = 0; i < n; i++) this.k.push(-(this.th[i + 1] - this.th[i]) / this.segL);
    this.groundRaw = [ROAD_HALF + KERB, ROAD_HALF + 4, ROAD_HALF + 14];
    // chevrons on the outside of tight corners
    for (let i = 0; i < n; i += 6) {
      const k = this.k[i];
      if (Math.abs(k) > 1 / 70) this.signs.push({ s: i * this.segL, x: -Math.sign(k) * (ROAD_HALF + 2.2), kind: "chevron", dir: Math.sign(k) });
    }
    this.scanCorners();
    this.centre = P.filter((_, i) => i % 3 === 0);
    // flat ground under everything
    let cx = 0, cz = 0;
    for (const p of P) { cx += p.x; cz += p.z; }
    cx /= P.length; cz /= P.length;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 48), new THREE.MeshStandardMaterial({ color: this.track.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.07, cz);
    ground.receiveShadow = true;
    this.root.add(ground);
    this.built = false;
  }
  get length() { return this.loopL; }
  ensure() {}
  placeItems() {}
  terrainY() { return 0; }
  cpS(k) { return k === 0 ? 1 : 1e12; }
  cpAround() { return 0; }
  blocked(x, z, kind) {
    const margin = kind === "building" ? ROAD_HALF + 12 : kind === "post" || kind === "lamp" || kind === "lampHead" ? 0 : ROAD_HALF + 3.5;
    if (!margin) return false;
    for (const p of this.centre) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < margin * margin) return true; }
    return false;
  }
  update() {
    if (this.built) return;
    const chunks = Math.ceil(this.loopL / (CHUNK * SEG_L));
    for (let c = 0; c < chunks; c++) this.chunks.set(c, this.buildChunk(c));
    this.built = true;
  }
}

// approach board: distance, arrow toward the corner, colour = severity (green fast, amber medium, red tight)
const SEV_COL = ["#2f9b6a", "#f2a01e", "#d8352a"];
function boardMat(kit, num, dir, sev) {
  const key = `${num}|${dir}|${sev}`;
  if (kit.boardCache[key]) return kit.boardCache[key];
  const c = document.createElement("canvas"); c.width = 192; c.height = 148;
  const g = c.getContext("2d");
  g.fillStyle = SEV_COL[sev]; g.fillRect(0, 0, 192, 148);
  g.fillStyle = "#f7f3ea"; g.fillRect(10, 10, 172, 128);
  g.fillStyle = "#1d1d1f"; g.font = "bold 64px Arial Black, Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(num), 96, 58);
  g.fillStyle = SEV_COL[sev];
  const y = 112, x0 = 96;
  g.beginPath();
  if (dir > 0) { g.moveTo(x0 - 50, y - 9); g.lineTo(x0 + 22, y - 9); g.lineTo(x0 + 22, y - 20); g.lineTo(x0 + 52, y); g.lineTo(x0 + 22, y + 20); g.lineTo(x0 + 22, y + 9); g.lineTo(x0 - 50, y + 9); }
  else { g.moveTo(x0 + 50, y - 9); g.lineTo(x0 - 22, y - 9); g.lineTo(x0 - 22, y - 20); g.lineTo(x0 - 52, y); g.lineTo(x0 - 22, y + 20); g.lineTo(x0 - 22, y + 9); g.lineTo(x0 + 50, y + 9); }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (kit.boardCache[key] = kit.signMat(t));
}
