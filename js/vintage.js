import * as THREE from "three";
import { SHARED_MATERIALS as MAT } from "./carmodel.js";

// Vintage-inspired cars (original designs: the feel of an era, not copies of real models).
// Same local frame as carmodel.js: +Z front, Y up, origin at the centre of the footprint on the ground.
// Same userData as buildCar (wheels with a "spin" group, radius, length, width, tail, color), so the game can use them as they are.

const paintCache = new Map();
const paint = (c, rough = 0.3, metal = 0.4) => {
  const k = c + rough + metal;
  if (!paintCache.has(k)) paintCache.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal }));
  return paintCache.get(k);
};
const BLACK = paint("#18171b", 0.35, 0.3), CREAM = paint("#efe8d6", 0.5, 0.05), WHITE = paint("#f4f2ec", 0.45, 0.05);
const RUBBER = paint("#1d1d20", 0.85, 0), CANVAS = paint("#3b3832", 0.95, 0);

// extrude a side profile ([u, v]: u = 0 at the rear .. L at the front) across `width`, centred on x
function prof(points, width, mat, L, bevel = 0.03, x = 0) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2 + x, 0, -L / 2);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = true;
  return m;
}
const arc = (cu, cv, r, a0, a1, n = 10) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cu + Math.cos(a) * r, cv + Math.sin(a) * r]; });
// bottom edge of a side profile from u0 to u1 at height v, with a semicircular arch cut around each wheel
function floorArches(u0, u1, v, arches) {
  const pts = [[u0, v]];
  for (const [uw, R, rc] of arches.slice().sort((a, b) => a[0] - b[0])) {
    const lift = Math.sqrt(Math.max(0, R * R - (v - rc) ** 2));
    pts.push([uw - lift, v]);
    for (const p of arc(uw, rc, R, Math.PI - Math.asin(clampN((v - rc) / R)), Math.asin(clampN((v - rc) / R)), 10)) pts.push(p);
    pts.push([uw + lift, v]);
  }
  pts.push([u1, v]);
  return pts;
}
const clampN = (x) => Math.max(-1, Math.min(1, x));
// thin window pillars on both sides (instead of full-width slabs)
function pillars(g, mat, halfW, L, list) {
  for (const [u0, v0, u1, v1] of list) for (const s of [-1, 1]) {
    const len = Math.hypot(u1 - u0, v1 - v0);
    const m = box(0.04, len, 0.07, mat, s * halfW, (v0 + v1) / 2, (u0 + u1) / 2 - L / 2);
    m.rotation.x = Math.atan2(u1 - u0, v1 - v0);
    g.add(m);
  }
}
function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; return m; }
function cyl(r0, r1, h, mat, seg = 16) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.castShadow = true; return m; }

// wheel styles: spokes (thin wire spokes + whitewall), steel (painted disc with hub cap), alloy (flat 4-hole disc), race (wide slick, plain)
function wheel(r, width, style, tint) {
  const g = new THREE.Group();
  const tyre = cyl(r, r, width, MAT.tyre, 20); tyre.rotation.z = Math.PI / 2; g.add(tyre);
  const spin = new THREE.Group();
  const face = width / 2 + 0.006;
  if (style === "spokes") {
    for (const side of [-1, 1]) {
      const ww = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, r * 0.09, 6, 22), WHITE);     // whitewall
      ww.rotation.y = Math.PI / 2; ww.position.x = side * (face - 0.01); g.add(ww);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.64, 0.02, 6, 22), MAT.chrome); rim.rotation.y = Math.PI / 2; rim.position.x = side * face; spin.add(rim);
      for (let i = 0; i < 16; i++) { const s = box(0.012, r * 1.26, 0.012, MAT.chrome, side * face, 0, 0); s.rotation.x = (i / 16) * Math.PI; spin.add(s); }
    }
    const hub = cyl(r * 0.18, r * 0.18, width + 0.06, MAT.chrome, 12); hub.rotation.z = Math.PI / 2; spin.add(hub);
  } else if (style === "steel") {
    const disc = cyl(r * 0.66, r * 0.66, width + 0.01, tint || CREAM, 18); disc.rotation.z = Math.PI / 2; spin.add(disc);
    const cap = cyl(r * 0.3, r * 0.34, width + 0.05, MAT.chrome, 14); cap.rotation.z = Math.PI / 2; spin.add(cap);
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) { const b = box(0.02, 0.05, 0.05, BLACK, side * (face + 0.005), Math.cos(i * 1.57) * r * 0.48, Math.sin(i * 1.57) * r * 0.48); spin.add(b); }
  } else if (style === "alloy") {
    const disc = cyl(r * 0.68, r * 0.68, width + 0.012, MAT.rim, 18); disc.rotation.z = Math.PI / 2; spin.add(disc);
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) { const h = cyl(r * 0.13, r * 0.13, 0.02, BLACK, 10); h.rotation.z = Math.PI / 2; h.position.set(side * (face + 0.004), Math.cos(i * 1.57 + 0.78) * r * 0.42, Math.sin(i * 1.57 + 0.78) * r * 0.42); spin.add(h); }
  } else {
    const disc = cyl(r * 0.6, r * 0.6, width + 0.012, tint || paint("#2a2a2e", 0.4, 0.6), 18); disc.rotation.z = Math.PI / 2; spin.add(disc);
    const nut = cyl(r * 0.14, r * 0.14, width + 0.06, MAT.chrome, 6); nut.rotation.z = Math.PI / 2; spin.add(nut);
  }
  g.add(spin); g.userData.spin = spin;
  return g;
}
function finish(group, wheels, r, L, W, color) {
  group.userData.wheels = wheels; group.userData.radius = r; group.userData.length = L; group.userData.width = W;
  group.userData.tail = MAT.tail; group.userData.color = color;
  return group;
}
function putWheels(group, r, width, style, axles, track, tint, rRear) {
  const out = [];
  axles.forEach((z, i) => {
    const rr = i === 1 && rRear ? rRear : r;
    for (const x of [-track, track]) { const w = wheel(rr, i === 1 && rRear ? width * 1.5 : width, style, tint); w.position.set(x, rr, z); group.add(w); out.push(w); }
  });
  return out;
}
// round headlamp: chrome bowl + glowing glass, facing forward
function lamp(r, x, y, z, bowl = true) {
  const g = new THREE.Group();
  if (bowl) { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.chrome); b.rotation.x = -Math.PI / 2; b.position.z = -0.01; g.add(b); }
  const glass = cyl(r * 0.88, r * 0.88, 0.03, MAT.head, 16); glass.rotation.x = Math.PI / 2; glass.position.z = 0.01; g.add(glass);
  g.position.set(x, y, z);
  return g;
}
// mudguard over a wheel (u = wheel centre along the car), optionally running back/down into the running board
function fender(uW, r, thick, width, mat, L, x, tailTo = null, tailV = null, front = 0.35) {
  const R = r + 0.09;
  const out = arc(uW, r, R, Math.PI * front, Math.PI * 1.0, 12).map(([u, v]) => [u, v]).reverse();   // from rear end to front end
  const pts = [];
  if (tailTo != null) pts.push([tailTo, tailV], [tailTo, tailV + thick]);
  for (const p of out) pts.push(p);
  const inner = arc(uW, r, R - thick, Math.PI * front, Math.PI * 1.0, 12);
  pts.push(...inner);
  if (tailTo != null) pts.push([tailTo + 0.3, tailV + thick * 0.4]);
  return prof(pts, width, mat, L, 0.015, x);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. "Contessa": 1930s luxury limousine. Long bonnet, upright screen, flowing wings with running boards, two-tone.
function contessa(color, deluxe = false) {
  // deluxe: 60 cm more bonnet (a much bigger engine), roof 8 cm lower, bigger wheels, exhausts out of the bonnet sides
  const X = deluxe ? 0.6 : 0, R = deluxe ? -0.08 : 0;
  const L = 5.3 + X, W = deluxe ? 1.92 : 1.86, r = deluxe ? 0.45 : 0.42, g = new THREE.Group(), P = paint(color, 0.22, 0.55);
  const fa = 4.15 + X, ra = 1.05;                                 // axle positions (u)
  const bodyW = 1.36;
  const TRIM = deluxe ? MAT.chrome : BLACK;
  // main body: boot, cabin sides, bonnet
  g.add(prof([[0.18, 0.52], [4.98 + X, 0.52], [5.0 + X, 1.08], [4.86 + X, 1.13], [2.95, 1.15], [2.9, 1.2], [1.38, 1.2], ...arc(0.62, 0.62, 0.48, Math.PI * 0.42, Math.PI * 0.95, 6), [0.14, 0.62]], bodyW, P, L, 0.05));
  // glasshouse and black roof
  g.add(prof([[2.88, 1.18], [2.82, 1.7 + R], [1.5, 1.72 + R], [1.36, 1.18]], bodyW - 0.08, MAT.glass, L, 0.02));
  g.add(prof([[2.86, 1.69 + R], [2.8, 1.79 + R], [1.48, 1.81 + R], [1.4, 1.71 + R]], bodyW - 0.02, BLACK, L, 0.03));
  for (const u of [2.86, 2.2, 1.4]) g.add(box(bodyW - 0.03, 0.52 + R, 0.07, deluxe ? MAT.chrome : P, 0, 1.45 + R / 2, u - L / 2));
  // bonnet louvres and centre hinge
  g.add(box(0.03, 0.03, 1.9 + X, MAT.chrome, 0, 1.165, 3.95 + X / 2 - L / 2));
  for (let i = 0; i < (deluxe ? 10 : 7); i++) for (const s of [-1, 1]) g.add(box(0.02, 0.18, 0.06, TRIM, s * (bodyW / 2 + 0.03), 0.92, 3.25 + i * 0.16 - L / 2));
  if (deluxe) for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {               // three flexible exhaust pipes each side
    const pipe = cyl(0.045, 0.045, 1.0, MAT.chrome, 10); pipe.rotation.x = Math.PI / 2 - 0.55; pipe.position.set(s * (bodyW / 2 + 0.06), 0.82, 3.0 + X - 0.22 * k - L / 2);
    pipe.rotation.z = s * 0.15; g.add(pipe);
  }
  // radiator: oval shell with horizontal bars (not a temple-front grille)
  const grill = prof(arc(0, 0.86, 0.3, Math.PI * -0.5, Math.PI * 1.5, 18).map(([u, v]) => [u * 0.85 + 0.25, v]), 0.12, MAT.chrome, 0.5, 0.02, 0);
  grill.rotation.y = Math.PI / 2; grill.position.set(0, 0, L / 2 - 0.24); g.add(grill);
  for (let i = 0; i < 6; i++) g.add(box(0.42, 0.025, 0.02, BLACK, 0, 0.66 + i * 0.075, L / 2 - 0.16));
  // wings + running boards (black)
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.13);
    g.add(fender(fa, r, 0.07, deluxe ? 0.34 : 0.3, BLACK, L, x, 2.6, 0.48, 0.18));
    g.add(fender(ra, r, 0.07, 0.3, BLACK, L, x, null, null, 0.05));
    g.add(box(0.3, 0.05, 1.6, BLACK, x, 0.5, 1.85 - L / 2));          // running board
    g.add(box(0.04, 0.02, 1.5, MAT.chrome, x + s * 0.13, 0.53, 1.85 - L / 2));
  }
  // headlamps on a bar between the wings, small side lamps
  g.add(box(1.2, 0.04, 0.04, MAT.chrome, 0, 0.98, 4.62 + X - L / 2));
  for (const s of [-1, 1]) { g.add(lamp(deluxe ? 0.17 : 0.15, s * 0.5, 1.04, 4.66 + X - L / 2)); g.add(lamp(0.06, s * 0.72, 1.12, 4.0 + X - L / 2)); }
  if (deluxe) for (const s of [-1, 1]) g.add(lamp(0.1, s * 0.22, 0.86, 4.72 + X - L / 2));   // pair of driving lamps
  // bumpers, spare wheel on the tail, rear lamps
  g.add(box(1.6, 0.07, 0.07, MAT.chrome, 0, 0.42, L / 2 + 0.12)); g.add(box(1.6, 0.07, 0.07, MAT.chrome, 0, 0.42, -L / 2 - 0.1));
  const spare = wheel(r * 0.9, 0.2, "spokes"); spare.rotation.y = Math.PI / 2; spare.position.set(0, 0.9, -L / 2 - 0.08); g.add(spare);
  for (const s of [-1, 1]) g.add(box(0.1, 0.1, 0.05, MAT.tail, s * 0.62, 0.7, -L / 2 + 0.05));
  const wheels = putWheels(g, r, deluxe ? 0.26 : 0.2, "spokes", [fa - L / 2, ra - L / 2], W / 2 - 0.13);
  return finish(g, wheels, r, L, W, color);
}

// 2. "Formichina": small late-1930s two-seater. Narrow sloping bonnet, wings with lamps, rounded tail.
function formichina(color) {
  const L = 3.25, W = 1.3, r = 0.3, g = new THREE.Group(), P = paint(color, 0.35, 0.3);
  const fa = 2.62, ra = 0.66, bodyW = 0.98;
  g.add(prof([[0.08, 0.36], [3.12, 0.36], [3.2, 0.62], [3.12, 0.76], [2.05, 0.92], [1.98, 0.95], ...arc(0.86, 0.48, 0.86, Math.PI * 0.32, Math.PI * 0.95, 10), [0.06, 0.45]], bodyW, P, L, 0.05));
  g.add(prof([[1.96, 0.94], [1.72, 1.3], ...arc(1.18, 0.62, 0.68, Math.PI * 0.42, Math.PI * 0.6, 6), [0.85, 1.14], [0.78, 0.98]], bodyW - 0.08, MAT.glass, L, 0.02));
  g.add(prof([[1.73, 1.28], [1.68, 1.34], ...arc(1.18, 0.62, 0.74, Math.PI * 0.42, Math.PI * 0.62, 6), [0.86, 1.14], [0.84, 1.1], ...arc(1.18, 0.62, 0.66, Math.PI * 0.6, Math.PI * 0.42, 6)], bodyW - 0.02, P, L, 0.02));
  g.add(box(bodyW - 0.03, 0.34, 0.06, P, 0, 1.1, 1.3 - L / 2));
  // narrow upright grille between the wings
  g.add(box(0.26, 0.34, 0.05, MAT.chrome, 0, 0.58, L / 2 - 0.05));
  for (let i = 0; i < 5; i++) g.add(box(0.02, 0.28, 0.02, BLACK, -0.1 + i * 0.05, 0.58, L / 2 - 0.02));
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.12);
    g.add(fender(fa, r, 0.05, 0.24, P, L, x, 1.75, 0.32, 0.12));
    g.add(fender(ra, r, 0.05, 0.24, P, L, x, null, null, 0.02));
    g.add(box(0.22, 0.04, 0.8, BLACK, x, 0.33, 1.3 - L / 2));
    g.add(lamp(0.08, x, 0.74, 2.92 - L / 2));               // lamps sit on top of the wings
  }
  g.add(box(1.1, 0.05, 0.05, MAT.chrome, 0, 0.3, L / 2 + 0.06));
  for (const s of [-1, 1]) g.add(box(0.07, 0.07, 0.04, MAT.tail, s * 0.3, 0.6, -L / 2 + 0.05));
  const wheels = putWheels(g, r, 0.14, "steel", [fa - L / 2, ra - L / 2], W / 2 - 0.12, paint("#24212c", 0.4, 0.3));
  return finish(g, wheels, r, L, W, color);
}

// 3. "Grillo": 1950s rear-engined runabout. Rounded two-box shape, canvas sunroof, louvred engine lid.
function grillo(color) {
  const L = 3.0, W = 1.34, r = 0.27, g = new THREE.Group(), P = paint(color, 0.35, 0.25);
  const fa = 2.42, ra = 0.6;
  g.add(prof([...floorArches(0.05, 2.95, 0.22, [[fa, r + 0.07, r], [ra, r + 0.07, r]]), [3.0, 0.48], ...arc(2.62, 0.48, 0.38, 0, Math.PI * 0.42, 6), [2.25, 0.86], [2.2, 0.87], [0.62, 0.87], ...arc(0.42, 0.5, 0.42, Math.PI * 0.32, Math.PI * 0.95, 8), [0.0, 0.34]], W - 0.04, P, L, 0.08));
  g.add(prof([[2.18, 0.86], [1.88, 1.3], [0.86, 1.32], [0.6, 0.86]], W - 0.14, MAT.glass, L, 0.03));
  g.add(prof([[1.9, 1.29], [1.86, 1.36], [0.9, 1.38], [0.84, 1.3]], W - 0.1, P, L, 0.03));
  g.add(box(0.62, 0.02, 0.82, CANVAS, 0, 1.39, 1.38 - L / 2));                   // folded canvas roof
  pillars(g, P, (W - 0.14) / 2, L, [[1.42, 0.87, 1.42, 1.31]]);
  // face: a horizontal grille slot, two round lamps low on the nose, thin chrome bar
  g.add(box(0.5, 0.06, 0.04, BLACK, 0, 0.5, L / 2 + 0.05));
  for (const s of [-1, 1]) g.add(lamp(0.075, s * 0.42, 0.6, L / 2 + 0.02, false));
  g.add(box(1.1, 0.04, 0.05, MAT.chrome, 0, 0.32, L / 2 + 0.07)); g.add(box(1.1, 0.04, 0.05, MAT.chrome, 0, 0.32, -L / 2 - 0.07));
  // engine lid louvres at the back
  for (let i = 0; i < 6; i++) g.add(box(0.5, 0.025, 0.04, BLACK, 0, 0.6 + i * 0.045, -L / 2 + 0.03));
  for (const s of [-1, 1]) g.add(box(0.06, 0.12, 0.04, MAT.tail, s * 0.5, 0.62, -L / 2 + 0.04));
  const wheels = putWheels(g, r, 0.14, "steel", [fa - L / 2, ra - L / 2], W / 2 - 0.1, paint("#e6e2d8", 0.5, 0.1));
  return finish(g, wheels, r, L, W, color);
}

// 4. "Saetta": 1970s single-seater. Wedge nose, open wheels, tall airbox, high rear wing.
function saetta(color) {
  const L = 4.4, W = 2.0, r = 0.31, rr = 0.36, g = new THREE.Group(), P = paint(color, 0.3, 0.35);
  const fa = 3.65, ra = 0.72;
  // monocoque: wedge nose to cockpit to engine cover
  g.add(prof([[0.25, 0.12], [4.35, 0.12], [4.4, 0.2], [3.0, 0.52], [2.25, 0.62], [1.3, 0.66], [0.9, 0.58], [0.25, 0.45]], 0.62, P, L, 0.04));
  g.add(prof([[1.0, 0.2], [2.4, 0.2], [2.5, 0.48], [1.1, 0.5]], 1.4, P, L, 0.05));                         // side pods
  // airbox over the driver's head, roll hoop
  g.add(prof([[1.45, 0.62], [1.95, 0.62], [1.92, 1.12], [1.62, 1.1]], 0.32, P, L, 0.03));
  g.add(box(0.2, 0.1, 0.04, BLACK, 0, 1.0, 1.95 - L / 2 + 0.01));
  // cockpit and helmet
  g.add(box(0.46, 0.06, 0.6, BLACK, 0, 0.62, 2.25 - L / 2));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), WHITE); helmet.position.set(0, 0.8, 2.05 - L / 2); helmet.castShadow = true; g.add(helmet);
  g.add(box(0.2, 0.05, 0.03, MAT.glass, 0, 0.8, 2.2 - L / 2));
  g.add(prof([[2.55, 0.6], [2.62, 0.74], [2.5, 0.76]], 0.44, MAT.glass, L, 0.01));                       // small screen
  // front wing with end plates, rear wing on struts
  g.add(box(1.7, 0.04, 0.42, P, 0, 0.16, 4.15 - L / 2));
  for (const s of [-1, 1]) g.add(box(0.03, 0.2, 0.46, BLACK, s * 0.86, 0.2, 4.15 - L / 2));
  g.add(box(1.25, 0.05, 0.42, P, 0, 1.12, 0.15 - L / 2));
  for (const s of [-1, 1]) g.add(box(0.03, 0.34, 0.5, BLACK, s * 0.64, 1.1, 0.15 - L / 2));
  for (const s of [-1, 1]) g.add(box(0.05, 0.5, 0.08, BLACK, s * 0.2, 0.84, 0.2 - L / 2));
  // exhausts, a race number roundel on the nose and the sides
  for (const s of [-1, 1]) { const e = cyl(0.05, 0.06, 0.4, MAT.chrome, 10); e.rotation.x = Math.PI / 2; e.position.set(s * 0.18, 0.36, -L / 2 + 0.15); g.add(e); }
  for (const s of [-1, 1]) { const n = cyl(0.17, 0.17, 0.02, WHITE, 18); n.rotation.z = Math.PI / 2; n.position.set(s * 0.71, 0.36, 1.7 - L / 2); g.add(n); }
  const tl = box(0.12, 0.06, 0.04, MAT.tail, 0, 0.3, -L / 2 + 0.02); g.add(tl);
  const wheels = putWheels(g, r, 0.26, "race", [fa - L / 2, ra - L / 2], W / 2 - 0.16, null, rr);
  return finish(g, wheels, r, L, W, color);
}

// 5. "Tempesta": 1980s rally hatchback. Boxy, blistered arches, roof spoiler, light pod, one bold side band.
function tempesta(color, evo = false) {
  const L = 3.95, W = evo ? 1.86 : 1.78, r = evo ? 0.33 : 0.32, g = new THREE.Group(), P = paint(color, 0.3, 0.35);
  const fa = 3.2, ra = 0.72;
  g.add(prof([...floorArches(0.05, 3.9, 0.24, [[fa, r + 0.08, r], [ra, r + 0.08, r]]), [3.95, 0.5], [3.9, 0.78], [2.7, 0.92], [2.62, 0.94], [0.15, 0.96], [0.0, 0.9], [0.0, 0.32]], W - 0.14, P, L, 0.05));
  g.add(prof([[2.6, 0.93], [2.08, 1.38], [0.62, 1.4], [0.1, 0.97]], W - 0.3, MAT.glass, L, 0.02));
  g.add(prof([[2.1, 1.36], [2.06, 1.42], [0.6, 1.44], [0.58, 1.38]], W - 0.26, P, L, 0.03));
  pillars(g, P, (W - 0.3) / 2, L, [[2.58, 0.94, 2.08, 1.39], [1.35, 0.95, 1.35, 1.4], [0.16, 0.97, 0.62, 1.4]]);
  g.add(box(W - 0.32, 0.05, 0.3, BLACK, 0, 1.46, 0.5 - L / 2));                           // roof spoiler over the hatch
  // blistered arches (boxy) front and rear
  for (const s of [-1, 1]) for (const u of [fa, ra]) {
    g.add(box(evo ? 0.2 : 0.14, evo ? 0.3 : 0.24, r * (evo ? 2.9 : 2.6), P, s * (W / 2 - 0.05), 0.62, u - L / 2));
    g.add(box(evo ? 0.21 : 0.15, 0.05, r * (evo ? 2.9 : 2.6), BLACK, s * (W / 2 - 0.05), 0.46, u - L / 2));
  }
  if (evo) {
    // big rear wing on two stands, front splitter, side skirts, bonnet bulge with twin vents
    g.add(box(W - 0.2, 0.05, 0.36, BLACK, 0, 1.62, 0.22 - L / 2));
    for (const s of [-1, 1]) { g.add(box(0.03, 0.22, 0.4, BLACK, s * (W / 2 - 0.1), 1.6, 0.22 - L / 2)); g.add(box(0.06, 0.22, 0.08, BLACK, s * 0.35, 1.5, 0.22 - L / 2)); }
    g.add(box(W - 0.06, 0.04, 0.24, BLACK, 0, 0.2, L / 2 + 0.1));
    for (const s of [-1, 1]) g.add(box(0.08, 0.08, L - 1.6, BLACK, s * (W / 2 - 0.1), 0.24, (fa + ra) / 2 - L / 2));
    g.add(box(0.7, 0.06, 0.8, P, 0, 0.86, 3.2 - L / 2));
    for (const s of [-1, 1]) g.add(box(0.2, 0.02, 0.4, BLACK, s * 0.18, 0.895, 3.2 - L / 2));
  }
  // bonnet vents, square headlamps, a pod of four round driving lamps, black bumpers
  for (let i = 0; i < 4; i++) g.add(box(0.5, 0.02, 0.05, BLACK, 0, 0.83 - i * 0.01, 3.35 + i * 0.08 - L / 2));
  for (const s of [-1, 1]) g.add(box(0.36, 0.14, 0.04, MAT.head, s * 0.55, 0.62, L / 2 - 0.03));
  g.add(box(0.5, 0.12, 0.03, BLACK, 0, 0.62, L / 2 - 0.02));
  g.add(box(1.4, 0.04, 0.05, BLACK, 0, 0.9, L / 2 - 0.16));
  for (let i = 0; i < 4; i++) g.add(lamp(0.09, -0.54 + i * 0.36, 0.95, L / 2 - 0.12));
  g.add(box(W - 0.1, 0.14, 0.12, BLACK, 0, 0.32, L / 2 + 0.02)); g.add(box(W - 0.1, 0.14, 0.12, BLACK, 0, 0.32, -L / 2 - 0.02));
  for (const s of [-1, 1]) g.add(box(0.32, 0.12, 0.04, MAT.tail, s * 0.6, 0.72, -L / 2 + 0.02));
  // livery: one wide band (EVO: green with a white line) and a door number panel, mud flaps
  for (const s of [-1, 1]) {
    g.add(box(0.012, 0.14, L - 0.5, evo ? paint("#2f9b6a", 0.4, 0.2) : WHITE, s * (W / 2 - 0.065), 0.56, 0));
    if (evo) g.add(box(0.013, 0.03, L - 0.5, WHITE, s * (W / 2 - 0.065), 0.65, 0));
    g.add(box(0.012, 0.22, 0.34, WHITE, s * (W / 2 - 0.066), 0.76, 1.7 - L / 2));
    for (const u of [fa - 0.45, ra - 0.45]) g.add(box(0.2, 0.22, 0.02, RUBBER, s * (W / 2 - 0.2), 0.18, u - L / 2));
  }
  const wheels = putWheels(g, r, evo ? 0.3 : 0.24, "alloy", [fa - L / 2, ra - L / 2], W / 2 - (evo ? 0.12 : 0.14));
  return finish(g, wheels, r, L, W, color);
}

// 6. "Libeccio": 1970s compact saloon. Low wedge nose, big glasshouse, short sloping boot, slim bumpers.
function libeccio(color) {
  const L = 3.9, W = 1.6, r = 0.29, g = new THREE.Group(), P = paint(color, 0.3, 0.35);
  const fa = 3.12, ra = 0.66;
  g.add(prof([...floorArches(0.05, 3.82, 0.24, [[fa, r + 0.07, r], [ra, r + 0.07, r]]), [3.9, 0.42], [3.86, 0.6], [2.78, 0.78], [2.72, 0.8], [0.5, 0.86], [0.08, 0.78], [0.0, 0.62], [0.0, 0.3]], W - 0.06, P, L, 0.04));
  g.add(prof([[2.7, 0.79], [2.2, 1.3], [1.35, 1.32], [0.32, 0.88]], W - 0.18, MAT.glass, L, 0.02));
  g.add(prof([[2.22, 1.28], [2.18, 1.35], [1.37, 1.37], [1.3, 1.3]], W - 0.14, P, L, 0.03));
  pillars(g, P, (W - 0.18) / 2, L, [[2.66, 0.8, 2.2, 1.31], [1.75, 0.82, 1.75, 1.33], [0.6, 0.86, 1.32, 1.32]]);
  // face: black band with rectangular lamps, slim chrome bumpers with black ends
  g.add(box(W - 0.2, 0.13, 0.04, BLACK, 0, 0.55, L / 2 + 0.0));
  for (const s of [-1, 1]) g.add(box(0.34, 0.1, 0.04, MAT.head, s * 0.48, 0.55, L / 2 + 0.02));
  g.add(box(W - 0.06, 0.06, 0.07, MAT.chrome, 0, 0.32, L / 2 + 0.05)); g.add(box(W - 0.06, 0.06, 0.07, MAT.chrome, 0, 0.34, -L / 2 - 0.05));
  for (const s of [-1, 1]) g.add(box(0.36, 0.14, 0.04, MAT.tail, s * 0.5, 0.58, -L / 2 + 0.02));
  g.add(box(0.012, 0.03, L - 0.8, MAT.chrome, W / 2 - 0.03, 0.62, 0)); g.add(box(0.012, 0.03, L - 0.8, MAT.chrome, -W / 2 + 0.03, 0.62, 0));
  const wheels = putWheels(g, r, 0.18, "steel", [fa - L / 2, ra - L / 2], W / 2 - 0.12, paint("#b9bcc2", 0.35, 0.6));
  return finish(g, wheels, r, L, W, color);
}

// 7. "Brezza": 1980s sports saloon. Three boxes, wedge line rising to a high squared tail, black bumpers and cladding.
function brezza(color) {
  const L = 4.2, W = 1.66, r = 0.31, g = new THREE.Group(), P = paint(color, 0.28, 0.4);
  const fa = 3.32, ra = 0.74;
  g.add(prof([...floorArches(0.05, 4.12, 0.26, [[fa, r + 0.07, r], [ra, r + 0.07, r]]), [4.2, 0.46], [4.16, 0.66], [2.95, 0.8], [2.88, 0.82], [1.05, 0.9], [0.9, 0.94], [0.05, 1.02], [0.0, 0.94], [0.0, 0.32]], W - 0.06, P, L, 0.04));
  g.add(prof([[2.86, 0.81], [2.3, 1.3], [1.18, 1.32], [0.95, 0.89]], W - 0.2, MAT.glass, L, 0.02));
  g.add(prof([[2.32, 1.28], [2.28, 1.36], [1.2, 1.37], [1.12, 1.3]], W - 0.16, P, L, 0.03));
  pillars(g, P, (W - 0.2) / 2, L, [[2.82, 0.82, 2.3, 1.31], [1.75, 0.86, 1.75, 1.34], [0.98, 0.9, 1.16, 1.32]]);
  g.add(box(W - 0.1, 0.04, 0.18, BLACK, 0, 1.04, 0.1 - L / 2));                                 // lip on the high tail
  // face: dark grille band, wide rectangular lamps; black bumpers wrap round; side cladding
  g.add(box(W - 0.24, 0.16, 0.04, BLACK, 0, 0.56, L / 2 + 0.0));
  for (const s of [-1, 1]) g.add(box(0.4, 0.12, 0.04, MAT.head, s * 0.5, 0.56, L / 2 + 0.02));
  g.add(box(0.06, 0.16, 0.05, MAT.chrome, 0, 0.56, L / 2 + 0.02));
  g.add(box(W, 0.16, 0.14, BLACK, 0, 0.32, L / 2 + 0.02)); g.add(box(W, 0.16, 0.14, BLACK, 0, 0.34, -L / 2 - 0.02));
  for (const s of [-1, 1]) {
    g.add(box(0.03, 0.14, L - 1.0, BLACK, s * (W / 2 - 0.02), 0.36, 0));
    g.add(box(0.44, 0.18, 0.04, MAT.tail, s * 0.5, 0.72, -L / 2 + 0.02));
  }
  const wheels = putWheels(g, r, 0.2, "alloy", [fa - L / 2, ra - L / 2], W / 2 - 0.13);
  return finish(g, wheels, r, L, W, color);
}

// proposed game stats (same scale as CARS in data.js): top km/h, 0-100 s, grip m/s², crash mass 0..1
export const VINTAGE = [
  { id: "contessa", name: "Contessa", kind: "Limousine anni '30", top: 150, acc: 16.0, grip: 9.0, mass: 0.95, build: contessa, color: "#d9cfb6" },
  { id: "formichina", name: "Formichina", kind: "Piccola anni '30", top: 110, acc: 24.0, grip: 9.0, mass: 0.25, build: formichina, color: "#7a2e3a" },
  { id: "grillo", name: "Grillo", kind: "Utilitaria anni '50", top: 115, acc: 22.0, grip: 9.5, mass: 0.25, build: grillo, color: "#9fc6c0" },
  { id: "libeccio", name: "Libeccio", kind: "Compatta anni '70", top: 175, acc: 11.5, grip: 11.0, mass: 0.4, build: libeccio, color: "#d08a2c" },
  { id: "brezza", name: "Brezza", kind: "Berlina sportiva anni '80", top: 195, acc: 9.5, grip: 11.5, mass: 0.5, build: brezza, color: "#3f78c0" },
  { id: "tempesta", name: "Tempesta", kind: "Rally anni '80", top: 220, acc: 5.7, grip: 14.5, mass: 0.55, build: tempesta, color: "#f4f1e8" },
  { id: "saetta", name: "Saetta", kind: "Monoposto anni '70", top: 310, acc: 3.0, grip: 17.5, mass: 0.35, build: saetta, color: "#c8352e" },
  { id: "deluxe", name: "Contessa Deluxe", kind: "Limousine sovralimentata", top: 345, acc: 2.8, grip: 16.5, mass: 1.0, build: (c) => contessa(c, true), color: "#5e1a28" },
  { id: "evo", name: "Tempesta EVO", kind: "Rally estremo", top: 340, acc: 2.6, grip: 17.5, mass: 0.6, build: (c) => tempesta(c, true), color: "#a51d2a" }
];
export function buildVintage(id, color) { const v = VINTAGE.find((x) => x.id === id); return v.build(color || v.color); }
