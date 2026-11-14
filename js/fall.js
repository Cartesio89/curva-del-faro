// Leaving the road where there is nothing underneath (bridges, drops): one shared, precise fall.
// The car starts from exactly where it is drawn, keeps its momentum, falls under gravity, stops on the
// water (splash, sinks a little) or on the ground far below, and only then goes back to the road.
import * as THREE from "three";

export function startFall(world, s, x, y, v, latV) {
  const sea = world.track.sea ? world.track.seaY : null;
  return { t: 0, vy: 0, y, v: Math.max(0, v), side: Math.sign(x) || 1, lat: Math.max(2, Math.abs(latV || 0)), sea, landed: false, landT: 0, dx: 0, splashed: false };
}
// advance the fall by dt; returns the forward distance travelled (along the road)
export function stepFall(world, f, s, x, dt) {
  f.t += dt;
  if (f.landed) {
    f.dx = 0;
    if (f.sea != null) f.y = Math.max(f.sea - 1.1, f.y - 1.4 * dt);   // floats down into the water
    f.v *= Math.pow(0.02, dt);
    return f.v * dt;
  }
  f.vy += 9.8 * dt; f.y -= f.vy * dt;
  const ds = f.v * dt;
  f.dx = f.side * f.lat * dt;
  f.v *= Math.pow(0.85, dt);
  const floor = f.sea != null ? f.sea : world.groundAt(s + ds, x + f.dx);
  if (f.y <= floor) { f.y = floor; f.landed = true; f.landT = f.t; f.lat = 0; }
  return ds;
}
export const fallDone = (f) => (f.landed && f.t - f.landT > 0.75) || f.t > 3.5;

// white ring on the water where the car went in
export class Splashes {
  constructor(scene) { this.scene = scene; this.list = []; }
  add(x, y, z) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.4, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.05, z);
    const spray = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.2, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    spray.position.set(x, y + 1.6, z);
    this.scene.add(m, spray);
    this.list.push({ m, spray, t: 0 });
  }
  update(dt) {
    for (const p of this.list) {
      p.t += dt;
      const k = p.t / 1.1;
      p.m.scale.setScalar(1 + k * 5); p.m.material.opacity = Math.max(0, 0.85 * (1 - k));
      p.spray.scale.set(1 + k, Math.max(0.01, 1 - k), 1 + k); p.spray.material.opacity = Math.max(0, 0.6 * (1 - k * 1.4));
    }
    this.list = this.list.filter((p) => {
      if (p.t < 1.1) return true;
      this.scene.remove(p.m, p.spray);
      p.m.geometry.dispose(); p.m.material.dispose(); p.spray.geometry.dispose(); p.spray.material.dispose();
      return false;
    });
  }
}
