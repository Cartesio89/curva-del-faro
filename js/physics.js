import { ROAD_HALF } from "./data.js";

// One vehicle model for the player and the AI.
// The car has its own direction phi relative to the road (radians, + = pointing right of the road).
// It can only turn as fast as grip allows (lateral accel = v * yawRate <= G), so:
//  - within the limit it follows the road and steering moves it across lanes;
//  - over the limit it visibly runs wide (nose points less into the corner than the road) and scrubs speed.
export const GRIP_ARCADE = 1.4; // arcade grip multiplier, same for everyone

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * c: {v, x, phi}; k: road curvature (+ = right-hand corner); steer in [-1, 1] (+ = right)
 * opt: {gas, brake, G (m/s²), top (m/s), a0, offroad (fraction of top allowed off road), coast (multiplier)}
 * Returns distance travelled along the road and whether the car is over the grip limit.
 */
export function stepCar(c, k, steer, opt, dt) {
  const v0 = c.v;
  // longitudinal
  let a;
  if (opt.brake) a = -12;
  else if (opt.gas) a = v0 < opt.top ? opt.a0 * Math.max(0.08, 1 - Math.pow(v0 / opt.top, 1.8)) : -2;
  else a = -(1.2 + 0.00045 * v0 * v0) * (opt.coast || 1);
  const off = Math.abs(c.x) > ROAD_HALF + 0.6;
  if (off && v0 > opt.top * opt.offroad) a -= 14;

  // lateral / yaw
  const v = Math.max(v0, 0.1);
  const roadTurn = v * k;                                   // yaw rate needed to follow the road
  const steerRate = clamp(14 / Math.max(v, 6), 0.25, 1.4); // rad/s of extra heading change
  const phiDot = steer !== 0 ? steer * steerRate : -c.phi * 3; // let go: the car straightens up
  const want = roadTurn + phiDot;
  const maxTurn = opt.G / Math.max(v, 4);
  const turn = clamp(want, -maxTurn, maxTurn);
  const over = Math.abs(want) > maxTurn + 1e-6;
  if (over) a -= Math.min(6, (Math.abs(want) - maxTurn) * v * 0.5); // tyres scrub speed
  c.phi = clamp(c.phi + (turn - roadTurn) * dt, -0.7, 0.7);

  c.v = Math.max(0, v0 + a * dt);
  c.latV = c.v * Math.sin(c.phi);
  c.x += c.latV * dt;
  return { ds: c.v * Math.cos(c.phi) * dt, over };
}
