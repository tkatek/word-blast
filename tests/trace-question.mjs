/**
 * QUESTION TRACER — plays one level with the baseline's smart aim and logs
 * per-shot detail (angle, clearance, block reason, outcome). Diagnoses
 * solvability complaints without guessing.
 *
 * Run: node tests/trace-question.mjs <level> [questionIndex]
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const levelId = parseInt(process.argv[2] || '1', 10);

const main = async () => {
  const h = await createHeadlessGame();
  await h.gotoLevel(levelId);
  const ANGLES = [-14, -22, -30, -38, -46, -8, -54];

  for (let q = 0; q < 4; q++) {
    await h.waitForState('AIMING', 12000);
    const s = h.scene();
    const arcClear = (sol, tx, ty) => {
      const pts = h.predictPath(sol.vx, sol.vy, { steps: 130 });
      for (const p of pts) {
        if (p.x > tx - 10) break;
        for (const b of s.factory.blocks) {
          if (b.wb.removed) continue;
          const top = b.y - b.displayHeight / 2;
          if (top > ty - 12) continue;
          if (p.x > b.x - b.displayWidth / 2 - 14 && p.x < b.x + b.displayWidth / 2 + 14 && p.y > top - 14) {
            return `blocked by ${b.wb.asset}@${b.x.toFixed(0)}(top ${top.toFixed(0)}) at x${p.x.toFixed(0)} y${p.y.toFixed(0)}`;
          }
        }
      }
      return null;
    };
    console.log(`\n=== Q${q + 1}`, JSON.stringify(h.info().targets.map((t) => `${t.x.toFixed(0)},${t.y.toFixed(0)}${t.correct ? '*' : ''}`)),
      'movers:', s.factory.movers.length);
    for (let shot = 0; shot < 5; shot++) {
      const target = h.correctTarget();
      const ranked = [];
      for (let i = 0; i < ANGLES.length; i++) {
        const ang = ANGLES[(i + shot) % ANGLES.length];
        for (const ay of [target.y, target.y - 28]) {
          const sol = h.solveLaunch(target.x, ay, { angleDeg: ang, steps: 130 });
          if (sol && sol.missDistance < 30) {
            ranked.push({ ang, sol, why: arcClear(sol, target.x, target.y) });
            break;
          }
        }
      }
      ranked.sort((a, b) => (a.why ? 1 : 0) - (b.why ? 1 : 0));
      if (!ranked.length) { console.log('NO SOLUTIONS for', target.x.toFixed(0), target.y.toFixed(0)); break; }
      const pick = ranked[0];
      console.log(`shot ${shot + 1}: ang=${pick.ang} ${pick.why || 'CLEAR'} -> (${target.x.toFixed(0)},${target.y.toFixed(0)})`);
      // mover window
      if (s.factory.movers.length) {
        const t0 = Date.now();
        while (!s.factory.movers.every((m) => m.go.y - m.baseY > 20) && Date.now() - t0 < 3000) {
          await new Promise((r) => setTimeout(r, 40));
        }
      }
      h.fire(pick.sol.vx, pick.sol.vy, null);
      const t0 = Date.now();
      while (Date.now() - t0 < 9000) {
        await new Promise((r) => setTimeout(r, 40));
        const st = h.state();
        if (st === 'AIMING' || h.info().questionIndex > q || st === 'LEVEL_FAILED') break;
      }
      console.log(`  -> state=${h.state()} q=${h.info().questionIndex} score=${h.info().score} shotsLeft=${h.info().shotsLeft}`);
      if (h.info().questionIndex > q || h.state() === 'LEVEL_FAILED') break;
    }
    if (h.state() === 'LEVEL_FAILED') { console.log('FAILED at Q' + (q + 1)); break; }
    if (h.info().questionIndex <= q) break;
  }
  await h.destroy();
};

main().catch((e) => { console.error(e); process.exit(1); });
