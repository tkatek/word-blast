import { createHeadlessGame } from './helpers/headless-game.mjs';
import { solveLaunch } from '../js/systems/Trajectory.js';
import { WORLD } from '../js/config.js';

const h = await createHeadlessGame();
await h.gotoLevel(2);
await h.waitForState('AIMING', 15000);
console.log('targets:', JSON.stringify(h.info().targets));
for (let shot = 1; shot <= 4; shot++) {
  const target = h.correctTarget();
  console.log(`shot ${shot}: state=${h.state()} shotsLeft=${h.info().shotsLeft} correctTarget=(${target.x.toFixed(0)},${target.y.toFixed(0)})`);
  let fired = false;
  for (const angleDeg of [-14, -22, -30, -38, -46, -8]) {
    const sol = solveLaunch(WORLD.SLING_X, WORLD.SLING_Y, target.x, target.y, { angleDeg });
    if (sol && sol.missDistance < 30) {
      if (h.fire(sol.vx, sol.vy, null)) { console.log(`  fired angle=${angleDeg} v=(${sol.vx.toFixed(1)},${sol.vy.toFixed(1)}) miss=${sol.missDistance.toFixed(1)}`); fired = true; break; }
    }
  }
  if (!fired) { console.log('  NO SOLUTION'); break; }
  // watch ball for 6s, report closest approach to target & ball state
  const t0 = Date.now();
  let minD = 1e9;
  while (Date.now() - t0 < 9000) {
    await new Promise(r => setTimeout(r, 30));
    const b = h.liveBalls()[0];
    if (b) { const d = Math.hypot(b.x - target.x, b.y - target.y); if (d < minD) minD = d; }
    const st = h.state();
    if (st === 'AIMING' || h.info().questionIndex === 1) break;
  }
  console.log(`  after: state=${h.state()} q=${h.info().questionIndex} minDist=${minD.toFixed(0)} ball=${h.liveBalls().map(b=>`(${b.x.toFixed(0)},${b.y.toFixed(0)})`).join(',')}`);
  if (h.info().questionIndex === 1) break;
  await h.waitForState('AIMING', 15000);
}
console.log('final:', h.state(), JSON.stringify(h.info()));
await h.destroy();
