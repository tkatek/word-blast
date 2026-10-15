/**
 * Focused tracer for flaky playthrough questions: per-shot logging of the
 * chosen arc, its clearance, closest approach to the plaque, and what the
 * ball actually touched first.
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const main = async () => {
  const h = await createHeadlessGame();
  const M = h.Phaser.Physics.Matter.Matter;
  await h.gotoLevel(3);
  await h.waitForState('AIMING', 10000);

  for (let q = 0; q < 4; q++) {
    await h.waitForState('AIMING', 10000);
    console.log(`\n=== Q${q + 1} targets:`, JSON.stringify(h.info().targets.map(t => `${t.x.toFixed(0)},${t.y.toFixed(0)}${t.correct ? '*' : ''}`)));
    for (let shot = 0; shot < 4; shot++) {
      const target = h.correctTarget();
      const ranked = [];
      for (const ang of [-14, -22, -30, -38, -46, -8, -54]) {
        const sol = h.solveLaunch(target.x, target.y, { angleDeg: ang });
        if (sol && sol.missDistance < 30) ranked.push({ ang, sol });
      }
      if (!ranked.length) { console.log('no solutions at all!'); break; }
      const pick = ranked[shot % ranked.length];
      console.log(`shot ${shot + 1}: ang=${pick.ang} miss=${pick.sol.missDistance.toFixed(0)} target=(${target.x.toFixed(0)},${target.y.toFixed(0)})`);
      // trace ball
      let firstHit = 'nothing';
      const s = h.scene();
      const origHandler = s.onCollisionStart.bind(s);
      h.fire(pick.sol.vx, pick.sol.vy, null);
      let minD = 1e9, t0 = Date.now();
      while (Date.now() - t0 < 9000) {
        await new Promise(r => setTimeout(r, 40));
        const ball = h.liveBalls()[0];
        if (ball) {
          const d = Math.hypot(ball.x - target.x, ball.y - target.y);
          if (d < minD) minD = d;
        }
        const st = h.state();
        if (st === 'AIMING' || h.info().questionIndex > q || st === 'LEVEL_FAILED') break;
      }
      console.log(`  -> state=${h.state()} q=${h.info().questionIndex} minDist=${minD.toFixed(0)} score=${h.info().score}`);
      if (h.info().questionIndex > q || h.state() === 'LEVEL_FAILED') break;
    }
    if (h.state() === 'LEVEL_FAILED') { console.log('FAILED at Q' + (q + 1)); break; }
    if (h.info().questionIndex <= q) break;
  }
  await h.destroy();
};

main().catch(e => { console.error(e); process.exit(1); });
