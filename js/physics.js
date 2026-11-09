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
