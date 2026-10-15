/**
 * Ballistic trajectory prediction, mirroring Matter's per-step integration:
 *   v.x *= (1 - frictionAir)
 *   v.y = v.y * (1 - frictionAir) + G_STEP
 *   p += v
 * Because the same constants are used by the real physics world, the dots
 * closely track the actual projectile path. Pure module — unit-testable.
 */
import { PHYSICS, SLINGSHOT } from '../config.js';

/**
 * @param {number} x0  start position (world px)
 * @param {number} y0
 * @param {number} vx0 initial velocity (px/step, Matter convention)
 * @param {number} vy0
 * @param {object} [opts] { steps, stepMs, frictionAir, gStep }
 * @returns {{x:number, y:number}[]} predicted points, one per step
 */
export function predictPath(x0, y0, vx0, vy0, opts = {}) {
  const steps = opts.steps ?? SLINGSHOT.TRAJECTORY_STEPS;
  const frictionAir = opts.frictionAir ?? 0.005;
  const gStep = opts.gStep ?? PHYSICS.G_STEP;

  const pts = [];
  let x = x0;
  let y = y0;
  let vx = vx0;
  let vy = vy0;
  const damp = 1 - frictionAir;

  for (let i = 0; i < steps; i++) {
    vx *= damp;
    vy = vy * damp + gStep;
    x += vx;
    y += vy;
    pts.push({ x, y });
    if (y > 720) break; // ground-ish; caller can filter further
  }
  return pts;
}

/**
 * Inverse helper for automated tests and aim assistance: find the launch
 * velocity that passes closest to a target point for a given angle.
 * Searches power by binary interpolation over the same discrete integrator,
 * so "predicted == achievable" by construction.
 * @returns {{vx:number, vy:number, power:number}|null}
 */
export function solveLaunch(x0, y0, tx, ty, opts = {}) {
  const angleDeg = opts.angleDeg ?? -18; // negative = up-right in screen coords
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const maxSpeed = opts.maxSpeed ?? SLINGSHOT.MAX_SPEED;

  let best = null;
  for (let p = 0.1; p <= 1.0001; p += 0.005) {
    const v = p * maxSpeed;
    const pts = predictPath(x0, y0, dx * v, dy * v, opts);
    // distance from segment samples to the target
    let bestD = Infinity;
    for (const pt of pts) {
      const d = Math.hypot(pt.x - tx, pt.y - ty);
      if (d < bestD) bestD = d;
    }
    if (!best || bestD < best.d) best = { d: bestD, v };
    if (bestD < 4) break;
  }
  if (!best) return null;
  return { vx: dx * best.v, vy: dy * best.v, power: best.v / maxSpeed, missDistance: best.d };
}
