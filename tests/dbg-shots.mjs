import { createHeadlessGame } from './helpers/headless-game.mjs';
import { solveLaunch } from '../js/systems/Trajectory.js';
import { WORLD } from '../js/config.js';

const h = await createHeadlessGame();
const lvl = parseInt(process.argv[2] || '1', 10);
const q = parseInt(process.argv[3] || '0', 10);
await h.gotoLevel(lvl);
await h.waitForState('AIMING', 15000);
while (h.info().questionIndex < q) {
  // answer current question with auto-aim to advance
  const t = h.correctTarget();
  const sol = solveLaunch(175, 390, t.x, t.y, { angleDeg: -14 });
  if (sol) h.fire(sol.vx, sol.vy, null);
  await h.waitFor(() => h.info().questionIndex > 0 || h.state() === 'LEVEL_COMPLETE' || h.state() === 'LEVEL_FAILED', 25000);
  if (h.state() === 'LEVEL_FAILED' || h.state() === 'LEVEL_COMPLETE') break;
  await h.waitForState('AIMING', 15000);
}
console.log('state', h.state(), 'q', h.info().questionIndex);
if (h.state() === 'AIMING') {
  const info = h.info();
  console.log('targets:', JSON.stringify(info.targets));
  console.log('blocks:', h.scene().factory.blocks.map(b => `${b.wb.asset}@${b.x.toFixed(0)},${b.y.toFixed(0)}${b.body.isSleeping?'(s)':''}`).join(' '));
  for (let shot = 0; shot < 4; shot++) {
    const target = h.correctTarget();
    const order = [-14, -22, -30, -38, -46, -8];
    let fired = false;
    for (const ang of order) {
      const sol = solveLaunch(175, 390, target.x, target.y, { angleDeg: ang });
      if (sol && sol.missDistance < 30) {
        if (h.fire(sol.vx, sol.vy, null)) { console.log(`shot ${shot + 1}: angle=${ang} at (${target.x.toFixed(0)},${target.y.toFixed(0)})`); fired = true; break; }
      }
    }
    if (!fired) { console.log('no solution!'); break; }
    await h.waitFor(() => h.state() === 'AIMING' || h.info().questionIndex > q || h.state() === 'LEVEL_FAILED', 25000);
    console.log(`  after: state=${h.state()} q=${h.info().questionIndex} shotsLeft=${h.info().shotsLeft}`);
    if (h.state() === 'LEVEL_FAILED' || h.info().questionIndex > q) break;
  }
}
await h.destroy();
