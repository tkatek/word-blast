/**
 * Trajectory ground truth: fire a known velocity, sample the real Matter
 * ball every ~50ms, and compare against predictPath's points.
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';
import { predictPath } from '../js/systems/Trajectory.js';
import { SLINGSHOT } from '../js/config.js';

const main = async () => {
  const h = await createHeadlessGame();
  await h.gotoLevel(1);
  await h.waitForState('AIMING', 10000);
  const a = h.slingAnchor();
  const s0 = h.scene();
  const log = [];
  s0.matter.world.on('collisionstart', (ev) => {
    for (const p of ev.pairs) {
      const ga = p.bodyA.gameObject, gb = p.bodyB.gameObject;
      const ka = ga && ga.wb ? ga.wb.kind : p.bodyA.label;
      const kb = gb && gb.wb ? gb.wb.kind : p.bodyB.label;
      log.push(ka + '~' + kb + '@' + (p.bodyA.position.x).toFixed(0) + ',' + (p.bodyA.position.y).toFixed(0) + '/' + (p.bodyB.position.x).toFixed(0) + ',' + (p.bodyB.position.y).toFixed(0));
    }
  });
  console.log('anchor', JSON.stringify(a));

  // watch a clean flat shot over empty ground (Q1 front area)
  const vx = 20, vy = -5;
  const pred = predictPath(a.x, a.y, vx, vy, { steps: 200 });
  h.fire(vx, vy, null);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    await new Promise(r => setTimeout(r, 60));
    const ball = h.liveBalls()[0];
    if (!ball) break;
    samples.push({ t: Date.now() - t0, x: +ball.x.toFixed(0), y: +ball.y.toFixed(0) });
    if (ball.y > 500) break;
  }
  console.log('predicted:', pred.filter((_, i) => i % 8 === 0).map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' -> '));
  console.log('actual   :', samples.map(s => `${s.x},${s.y}`).join(' -> '));
  console.log('collisions:', log.join(' | '));
  console.log('targets:', JSON.stringify(h.info().targets));
  await h.destroy();
};

main().catch(e => { console.error(e); process.exit(1); });
