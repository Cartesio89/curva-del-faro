import { ROAD_HALF } from "./data.js";

// One vehicle model for the player and the AI. Fully manual: nothing turns the car for you.
// phi = direction of the car relative to the road (radians, + = pointing to the right of the road).
// Steering sets the car's own yaw rate; the road bending under the car changes phi by -v*k.
// So with the wheel straight the car keeps going straight and, in a corner, heads for the outside.
// The yaw rate can never exceed the grip limit (lateral accel v*yaw <= G): too fast = you cannot turn enough.
export const GRIP_ARCADE = 1.4; // arcade grip multiplier, same for everyone

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Largest yaw rate the car can reach at speed v: steering lock at low speed, grip at high speed.
export const maxYaw = (v, G) => Math.min(G / Math.max(v, 4), 0.14 * v);

/**
 * c: {v, x, phi}; k: road curvature (+ = right-hand corner); steer in [-1, 1] (+ = right, fraction of maxYaw)
 * opt: {gas, brake, G, top, a0, offroad, coast}
 */
export function stepCar(c, k, steer, opt, dt) {
  const v0 = c.v;
  let a;
  if (opt.brake) a = -12;
  else if (opt.gas) a = v0 < opt.top ? opt.a0 * Math.max(0.08, 1 - Math.pow(v0 / opt.top, 1.8)) : -2;
  else a = -(1.2 + 0.00045 * v0 * v0) * (opt.coast || 1);
  if (Math.abs(c.x) > ROAD_HALF + 0.6 && v0 > opt.top * opt.offroad) a -= 14;

  steer = clamp(steer, -1, 1);
  const yaw = steer * maxYaw(v0, opt.G);
  // tyres at the limit scrub a little speed
  if (Math.abs(steer) > 0.85 && v0 > 15) a -= ((Math.abs(steer) - 0.85) / 0.15) * 1.5;
  c.phi = clamp(c.phi + (yaw - v0 * k) * dt, -1.2, 1.2);

  c.v = Math.max(0, v0 + a * dt);
  c.latV = c.v * Math.sin(c.phi);
  c.x += c.latV * dt;
  return { ds: c.v * Math.cos(c.phi) * dt, yaw };
}

// Turns digital buttons into a progressive steering value (about 0.35 s to full lock, faster back to centre).
export function smoothSteer(current, target, dt) {
  const rate = target === 0 || Math.sign(target) !== Math.sign(current) ? 6 : 3;
  const d = target - current;
  return current + clamp(d, -rate * dt, rate * dt);
}

// Contact between two cars on the same road (s = distance along the road, x = lateral offset).
// Momentum-conserving impulse with a little bounce, positions separated in proportion to mass.
// Symmetric: nobody is favoured, only mass and speed matter. Returns the closing speed (m/s).
export const massKg = (m) => 1100 + (m || 0.5) * 900; // data mass 0..1 → kg
export function resolveContact(a, b, ds, reachS, reachX) {
  const ma = massKg(a.mass), mb = massKg(b.mass);
  const dx = b.x - a.x;
  const penS = reachS - Math.abs(ds), penX = reachX - Math.abs(dx);
  if (penS <= 0 || penX <= 0) return 0;
  const wa = mb / (ma + mb), wb = ma / (ma + mb); // the lighter car moves more
  if (penS < penX * 1.6) {
    // nose-to-tail
    const [r, f, wr, wf, mr, mf] = ds > 0 ? [a, b, wa, wb, ma, mb] : [b, a, wb, wa, mb, ma];
    const rel = r.v - f.v;
    if (rel > 0) {
      const J = (1 + 0.3) * rel / (1 / mr + 1 / mf);
      r.v = Math.max(0, r.v - J / mr);
      f.v = f.v + J / mf;
    }
    r.s -= penS * wr; f.s += penS * wf;
    // an off-centre hit turns both cars a little
    const off = Math.max(-1, Math.min(1, dx / reachX));
    r.phi = (r.phi || 0) - off * 0.06 * wr; f.phi = (f.phi || 0) + off * 0.06 * wf;
    return Math.max(0, rel);
  }
  // side by side
  const dir = dx >= 0 ? 1 : -1;
  a.x -= dir * penX * wa; b.x += dir * penX * wb;
  const relLat = ((a.latV || 0) - (b.latV || 0)) * dir;
  if (relLat > 0) {
    a.phi = (a.phi || 0) - dir * 0.05 * wa * Math.min(1, relLat / 4);
    b.phi = (b.phi || 0) + dir * 0.05 * wb * Math.min(1, relLat / 4);
  }
  // rubbing costs a little speed to both
  a.v *= 0.995; b.v *= 0.995;
  return Math.max(0, relLat);
}
