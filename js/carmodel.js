import * as THREE from "three";

// Procedural low-poly cars. Local frame: +Z = front, +X = right side... (X mirrored doesn't matter, car is symmetric), Y = up.
// Origin at the centre of the footprint, on the ground.

const MAT = {
  glass: new THREE.MeshStandardMaterial({ color: 0x1b2533, roughness: 0.08, metalness: 0.7 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.75, metalness: 0.1 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.3, metalness: 0.85 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 1.2, roughness: 0.2 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8e1a12, emissive: 0xff2a1a, emissiveIntensity: 0.6, roughness: 0.3 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.2, metalness: 1 })
};
export const SHARED_MATERIALS = MAT;

const bodyMatCache = new Map();
function bodyMat(color) {
  if (!bodyMatCache.has(color)) bodyMatCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.45 }));
  return bodyMatCache.get(color);
}

// Extrude a side profile (points as [u, v]: u = 0 rear .. L front, v = height) across the given width.
function extrudeProfile(points, width, L, bevel = 0.03) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, -L / 2);
  geo.computeVertexNormals();
  return geo;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function wheel(r, width, rims) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 18, 1), MAT.tyre);
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  const spin = new THREE.Group(); // rotates with speed
  const face = width / 2 + 0.005;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, width + 0.02, 10), MAT.rim);
  hub.rotation.z = Math.PI / 2;
  spin.add(hub);
  const rr = r * 0.66;
  if (rims === "pieni") {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, width + 0.012, 18), MAT.rim);
    disc.rotation.z = Math.PI / 2;
    spin.add(disc);
  } else {
    const n = rims === "multi" ? 10 : 5;
    const thick = rims === "multi" ? 0.03 : 0.07;
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, rr * 2 * 0.95, thick), MAT.rim);
        s.position.x = side * face;
        s.rotation.x = (i / n) * Math.PI;
        spin.add(s);
      }
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.025, 6, 20), MAT.rim);
    for (const side of [-1, 1]) { const rg = ring.clone(); rg.rotation.y = Math.PI / 2; rg.position.x = side * face; spin.add(rg); }
  }
  g.add(spin);
  g.userData.spin = spin;
  return g;
}

export function buildCar(car, cfg) {
  const s = car.shape;
  const { L, W, H, clr: c, wheel: r } = s;
  const lowered = cfg.kit === "corsa" ? 0.04 : cfg.kit === "sport" ? 0.02 : 0;
  const b = s.belt - lowered, Ht = H - lowered, cc = c - lowered;
  const nose = s.nose - lowered;
  const uWs = L * (1 - s.cabin[0]);        // windshield base (from rear)
  const uCe = L * (1 - s.cabin[1]);        // cabin end
  const uWsTop = uWs - s.ws * L;           // windshield top
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const paint = bodyMat(cfg.color);

  // lower body
  const lower = [
    [0.04 * L, cc], [0.96 * L, cc], [L, cc + 0.16], [L - 0.03, nose],
    [uWs + 0.1, b - 0.02], [uWs, b], [uCe, b + 0.01],
    [s.type === "hatch" ? 0.03 * L : 0.06 * L, b - 0.02], [0, b - 0.1], [0, cc + 0.2]
  ];
  if (s.type === "wedge" || s.type === "proto") {
    lower.splice(3, 2, [L - 0.02, nose], [uWs + 0.25, b - 0.05]);
  }
  const lowerMesh = new THREE.Mesh(extrudeProfile(lower, W, L, 0.05), paint);
  lowerMesh.castShadow = true;
  body.add(lowerMesh);

  // cabin (glass) + roof
  let cabin = null, roof = null;
  const cw = W * 0.86;
  if (s.type === "roadster") {
    cabin = [[uWs, b], [uWs - 0.05 * L, b + 0.34], [uWs - 0.075 * L, b + 0.34], [uWs - 0.03 * L, b]];
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 12, Math.PI), MAT.trim);
    for (const x of [-W * 0.22, W * 0.22]) { const h = hoop.clone(); h.rotation.y = Math.PI / 2; h.position.set(x, b, uCe - L / 2 + 0.25); body.add(h); }
    const seats = box(W * 0.7, 0.18, 0.5, MAT.trim, 0, b - 0.02, (uWs + uCe) / 2 - L / 2);
    body.add(seats);
  } else {
    let uRe;
    if (s.type === "hatch") uRe = uCe + 0.06 * L;
    else if (s.type === "notch") uRe = uCe + 0.13 * L;
    else if (s.type === "fastback") uRe = uCe + 0.3 * L;
    else uRe = uCe + 0.12 * L;
    uRe = Math.min(uRe, uWsTop - 0.2);
    const rearV = s.type === "hatch" ? b + 0.02 : b + 0.01;
    cabin = [[uWs, b], [uWsTop, Ht], [uRe, Ht], [uCe, rearV]];
    roof = [[uWsTop - 0.04, Ht + 0.015], [uRe + 0.04, Ht + 0.015], [uRe + 0.1, Ht - 0.05], [uWsTop - 0.12, Ht - 0.05]];
  }
  const cabMesh = new THREE.Mesh(extrudeProfile(cabin, cw, L, 0.03), MAT.glass);
  cabMesh.castShadow = true;
  body.add(cabMesh);
  if (roof) {
    const rm = new THREE.Mesh(extrudeProfile(roof, cw + 0.03, L, 0.02), paint);
    rm.castShadow = true;
    body.add(rm);
    // B/C pillars in body colour so the greenhouse reads as a car
    const pil = (u0, u1, v0, v1) => {
      const pts = [[u0, v0], [u1, v1], [u1 - 0.07, v1], [u0 - 0.07, v0]];
      const m = new THREE.Mesh(extrudeProfile(pts, cw + 0.025, L, 0.0), paint);
      body.add(m);
    };
    pil(uWs + 0.04, uWsTop + 0.02, b, Ht);
    pil(cabin[3][0] + 0.07, cabin[2][0] + 0.07, cabin[3][1], Ht);
  }

  // lights, plate, grille
  const zF = L / 2 + 0.045, zR = -L / 2 - 0.045; // bevel pushes the skin ~5 cm outward
  const yHead = (cc + 0.16 + nose) / 2;
  for (const x of [-W * 0.33, W * 0.33]) {
    body.add(box(0.32, 0.07, 0.04, MAT.head, x, yHead, zF));
    body.add(box(0.34, 0.08, 0.04, MAT.tail, x, b - 0.14, zR));
  }
  body.add(box(0.5, 0.11, 0.02, MAT.plate, 0, cc + 0.22, zR - 0.01));
  body.add(box(W * 0.42, 0.08, 0.03, MAT.trim, 0, cc + 0.14, zF));
  body.add(box(W * 0.94, 0.1, 0.06, MAT.trim, 0, cc + 0.06, zR + 0.02));

  // body kit
  if (cfg.kit !== "stradale") {
    const wb0 = -L / 2 + L * 0.24, wb1 = L / 2 - L * 0.24;
    for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) body.add(box(0.1, 0.09, wb1 - wb0, cfg.kit === "corsa" ? paint : MAT.trim, x, cc + 0.04, (wb0 + wb1) / 2));
    body.add(box(W * 0.9, 0.035, 0.22, MAT.trim, 0, cc + 0.02, zF - 0.02));
    if (cfg.kit === "corsa") {
      for (const z of [L / 2 - L * 0.18, -L / 2 + L * 0.17]) for (const x of [-W / 2, W / 2]) {
        body.add(box(0.13, 0.28, r * 2.5, paint, x, cc + 0.3, z));                 // flared arch, flush with the body
        body.add(box(0.14, 0.04, r * 2.5, MAT.trim, x, cc + 0.16, z));             // dark lip under it
      }
      for (let i = -2; i <= 2; i++) body.add(box(0.02, 0.12, 0.3, MAT.trim, i * W * 0.15, cc + 0.03, zR + 0.12));
    }
  }

  // wing
  if (cfg.wing === "basso") {
    body.add(box(W * 0.86, 0.045, 0.2, cfg.kit === "stradale" ? paint : MAT.trim, 0, b + 0.03, zR + 0.16));
  } else if (cfg.wing === "alto") {
    const yW = Math.max(b + 0.34, Ht * 0.92);
    body.add(box(W * 0.96, 0.04, 0.36, MAT.trim, 0, yW, zR + 0.22));
    for (const x of [-W * 0.46, W * 0.46]) body.add(box(0.03, 0.16, 0.38, MAT.trim, x, yW + 0.02, zR + 0.22));
    for (const x of [-W * 0.3, W * 0.3]) body.add(box(0.05, yW - b, 0.08, MAT.trim, x, (yW + b) / 2, zR + 0.24));
  }

  // engine
  const zOf = (u) => u - L / 2;
  if (cfg.engine === "compressore") {
    const z = zOf((uWs + L) / 2 + 0.05), y = (nose + b) / 2 + 0.04;
    body.add(box(0.46, 0.2, 0.55, MAT.trim, 0, y + 0.08, z));
    body.add(box(0.38, 0.1, 0.45, paint, 0, y + 0.23, z));
    for (const x of [-0.1, 0.1]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 10), MAT.chrome);
      stack.position.set(x, y + 0.37, z + 0.06); body.add(stack);
    }
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), MAT.chrome);
    belt.rotation.x = Math.PI / 2; belt.position.set(0, y + 0.1, z + 0.3); body.add(belt);
  } else if (cfg.engine === "posteriore") {
    const z0 = zR + 0.18, z1 = zOf(uCe) - 0.08, len = Math.max(0.3, z1 - z0);
    for (let i = 0; i < 6; i++) body.add(box(W * 0.7, 0.03, 0.05, MAT.trim, 0, b + 0.03, z0 + (len * (i + 0.5)) / 6));
    for (const x of [-W / 2 - 0.005, W / 2 + 0.005]) body.add(box(0.04, 0.2, 0.55, MAT.trim, x, b - 0.22, zOf(uCe) + 0.35));
  } else if (cfg.engine === "v8") {
    const zc = (zR + 0.2 + zOf(uCe)) / 2;
    body.add(box(W * 0.5, 0.16, 0.6, MAT.trim, 0, b + 0.06, zc));
    for (let i = 0; i < 4; i++) for (const x of [-0.13, 0.13]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 8), MAT.chrome);
      st.position.set(x, b + 0.24, zc - 0.22 + i * 0.15); body.add(st);
    }
    for (const x of [-W * 0.18, W * 0.18]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.25, 10), MAT.chrome);
      ex.rotation.x = Math.PI / 2; ex.position.set(x, cc + 0.14, zR - 0.08); body.add(ex);
    }
  }

  // wheels
  const ww = 0.24 + (cfg.tyres === "morbide" ? 0.04 : 0);
  const wheels = [];
  const track = W / 2 - ww / 2 + (cfg.kit === "corsa" ? 0.04 : 0) - 0.02;
  for (const z of [L / 2 - L * 0.18, -L / 2 + L * 0.17]) {
    for (const x of [-track, track]) {
      const w = wheel(r, ww, cfg.rims);
      w.position.set(x, r, z);
      w.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      group.add(w);
      wheels.push(w);
    }
  }
  group.userData.wheels = wheels;
  group.userData.radius = r;
  group.userData.length = L;
  group.userData.width = W;
  group.userData.tail = MAT.tail;
  group.userData.color = cfg.color;
  return group;
}

// Traffic: a few templates built once and cloned (clones share geometry and materials).
const TRAFFIC_COLORS = ["#c8352e", "#f2c14e", "#e9e6de", "#3a5fa8", "#2d2b33", "#5a7d4e", "#9aa3ad", "#7a2e3a"];
function buildVan(color) {
  const g = new THREE.Group();
  const paint = bodyMat(color);
  const L = 5.0, W = 1.95, H = 2.3;
  const side = [[0, 0.3], [L, 0.3], [L, 1.0], [L - 0.35, 1.25], [L - 1.0, H], [0.05, H], [0, H - 0.1]];
  const m = new THREE.Mesh(extrudeProfile(side, W, L, 0.05), paint); m.castShadow = true; g.add(m);
  const glass = [[L - 0.36, 1.27], [L - 0.95, H - 0.08], [L - 1.25, H - 0.08], [L - 0.7, 1.27]];
  g.add(new THREE.Mesh(extrudeProfile(glass, W + 0.02, L, 0), MAT.glass));
  for (const x of [-W * 0.38, W * 0.38]) g.add(box(0.22, 0.4, 0.04, MAT.tail, x, 0.95, -L / 2 + 0.01));
  g.add(box(W * 0.98, 0.14, 0.08, MAT.trim, 0, 0.35, -L / 2));
  g.add(box(0.03, H - 0.6, 0.02, MAT.trim, 0, H / 2 + 0.2, -L / 2 - 0.005));
  for (const z of [L / 2 - 0.9, -L / 2 + 0.9]) for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) { const w = wheel(0.36, 0.24, "pieni"); w.position.set(x, 0.36, z); g.add(w); }
  g.userData.length = L; g.userData.width = W;
  return g;
}
function buildTruck(color) {
  const g = new THREE.Group();
  const L = 9.5, W = 2.45, H = 3.6;
  const boxMat = bodyMat(color);
  const cargo = box(W, H - 0.9, L - 2.3, boxMat, 0, 0.9 + (H - 0.9) / 2, -1.05); cargo.castShadow = true; g.add(cargo);
  const cab = box(W * 0.98, 2.2, 2.0, bodyMat("#e9e6de"), 0, 1.0 + 1.1, L / 2 - 1.05); cab.castShadow = true; g.add(cab);
  g.add(box(W * 0.9, 0.9, 0.04, MAT.glass, 0, 2.5, L / 2 - 0.04));
  g.add(box(W, 0.14, 0.12, MAT.trim, 0, 0.55, -L / 2 + 0.1));
  for (let i = 0; i < 6; i++) g.add(box(0.2, 0.12, 0.04, i % 2 ? MAT.plate : MAT.tail, -W / 2 + 0.25 + i * 0.4, 0.66, -L / 2 + 0.03));
  for (const z of [L / 2 - 1.3, -L / 2 + 1.6, -L / 2 + 2.7]) for (const x of [-W / 2 + 0.16, W / 2 - 0.16]) { const w = wheel(0.5, 0.32, "pieni"); w.position.set(x, 0.5, z); g.add(w); }
  g.userData.length = L; g.userData.width = W;
  return g;
}

let trafficTemplates = null;
export function trafficTemplatesFor(CARS, defaultConfig) {
  if (trafficTemplates) return trafficTemplates;
  trafficTemplates = [];
  const civil = CARS.filter((c) => ["lucciola", "gabbiano", "delfino", "cormorano"].includes(c.id));
  let i = 0;
  for (const car of civil) {
    for (let k = 0; k < 2; k++) {
      const cfg = { ...defaultConfig(car), color: TRAFFIC_COLORS[i++ % TRAFFIC_COLORS.length], rims: "pieni" };
      trafficTemplates.push(buildCar(car, cfg));
    }
  }
  trafficTemplates.push(buildVan("#f4f1e8"), buildVan("#2b4fa3"));
  trafficTemplates.push(buildTruck("#c86a1e"), buildTruck("#2f6fb0"));
  for (const t of trafficTemplates) {
    t.userData = { length: t.userData.length, width: t.userData.width };
    t.traverse((m) => { if (m.isMesh) m.castShadow = false; if (m !== t) m.userData = {}; });
  }
  return trafficTemplates;
}

export function disposeCar(group) {
  group.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
}
