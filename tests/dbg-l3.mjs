/**
 * Focused tracer: replicates the baseline playthrough's SMART aim exactly
 * (clearance-checked arcs against live pieces) and logs per-shot detail.
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const main = async () => {
  const h = await createHeadlessGame();
  await h.gotoLevel(3);
  await h.waitForState('AIMING', 10000);

  for (let q = 0; q < 4; q++) {
    await h.waitForState('AIMING', 10000);
    const ANGLES = [-14, -22, -30, -38, -46, -8, -54];
    let blockedBy = null;
    const arcClear = (sol, tx, ty) => {
      const s = h.scene();
      const pts = h.predictPath(sol.vx, sol.vy);
      for (const p of pts) {
        if (p.x > tx - 10) break;
        for (const b of s.factory.blocks) {
          if (b.wb.removed) continue;
          const bw = b.displayWidth, bh = b.displayHeight;
          const top = b.y - bh / 2;
          if (top > ty - 12) continue;
          if (p.x > b.x - bw / 2 - 14 && p.x < b.x + bw / 2 + 14 && p.y > top - 14) { blockedBy = b.wb.asset + "@" + b.x.toFixed(0) + " top " + top.toFixed(0) + " arcY " + p.y.toFixed(0) + " at x " + p.x.toFixed(0); return false; }
        }
      }
      return true;
    };
    console.log(`\n=== Q${q + 1}`, JSON.stringify(h.info().targets.map(t => `${t.x.toFixed(0)},${t.y.toFixed(0)}${t.correct ? '*' : ''}`)));
    for (let shot = 0; shot < 4; shot++) {
      const target = h.correctTarget();
      const ranked = [];
      for (let i = 0; i < ANGLES.length; i++) {
        const ang = ANGLES[(i + shot) % ANGLES.length];
        const sol = h.solveLaunch(target.x, target.y, { angleDeg: ang });
        if (sol && sol.missDistance < 30) ranked.push({ ang, sol, clear: arcClear(sol, target.x, target.y), why: blockedBy });
      }
      ranked.sort((a, b) => (b.clear ? 1 : 0) - (a.clear ? 1 : 0));
      if (!ranked.length) { console.log('NO SOLUTIONS'); break; }
      const pick = ranked[0];
      console.log(`shot ${shot + 1}: ang=${pick.ang} why=${pick.why || '-'} clear=${pick.clear} miss=${pick.sol.missDistance.toFixed(0)} target=(${target.x.toFixed(0)},${target.y.toFixed(0)}) candidates=${ranked.map(r => r.ang + (r.clear ? '✓' : '')).join(',')}`);
      h.fire(pick.sol.vx, pick.sol.vy, null);
      let minD = 1e9, t0 = Date.now();
      while (Date.now() - t0 < 9000) {
        await new Promise(r => setTimeout(r, 40));
        const ball = h.liveBalls()[0];
        if (ball) minD = Math.min(minD, Math.hypot(ball.x - target.x, ball.y - target.y));
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
