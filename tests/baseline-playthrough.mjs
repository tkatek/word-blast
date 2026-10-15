/**
 * BASELINE PLAYTHROUGH — plays every level's four questions with legitimate
 * launches (solveLaunch + the real slingshot launch path), verifying the
 * Question 1 → 2 → 3 → 4 → LEVEL_COMPLETE progression that previously froze.
 *
 * Run: node tests/baseline-playthrough.mjs [--level N]
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const onlyLevel = process.argv.includes('--level')
  ? parseInt(process.argv[process.argv.indexOf('--level') + 1], 10) : null;

const main = async () => {
  const h = await createHeadlessGame();
  const results = [];
  const from = onlyLevel || 1;
  const to = onlyLevel || 15;

  for (let levelId = from; levelId <= to; levelId++) {
    const row = { levelId, questions: [], outcome: null, error: null };
    try {
      await h.gotoLevel(levelId);
      for (let q = 0; q < 4; q++) {
        const t0 = Date.now();
        const armed = await h.waitForState('AIMING', 15000);
        if (!armed) { row.error = `Q${q + 1} never armed (state=${h.state()})`; break; }
        const info = h.info();
        if (info.questionIndex !== q) { row.error = `expected Q${q + 1}, at Q${info.questionIndex + 1}`; break; }

        // Legitimate launches: solved ballistic arcs through the correct
        // target. Angle choice mirrors a SKILLED player: simulate each
        // candidate arc against the live piece positions and fire the first
        // one that reaches the plaque without clipping anything taller than
        // the plaque's level; retries rotate through the remaining angles.
        const ANGLES = [-14, -22, -30, -38, -46, -8, -54];
        const arcClear = (sol, tx, ty) => {
          const s = h.scene();
          const pts = h.predictPath(sol.vx, sol.vy);
          for (const p of pts) {
            if (p.x > tx - 10) break;
            for (const b of s.factory.blocks) {
              if (b.wb.removed) continue;
              const bw = b.displayWidth, bh = b.displayHeight;
              const top = b.y - bh / 2;
              if (top > ty - 12) continue; // below plaque level: not a shield
              if (p.x > b.x - bw / 2 - 14 && p.x < b.x + bw / 2 + 14 && p.y > top - 14) return false;
            }
          }
          return true;
        };
        let fired = 0;
        const maxShots = info.shotsLeft;
        while (fired < maxShots && h.info().questionIndex === q && h.state() !== 'LEVEL_FAILED') {
          let launched = false;
          const target = h.correctTarget();
          if (!target) break;
          // ranked candidates: clearing arcs first, then everything by rotation
          const ranked = [];
          for (let i = 0; i < ANGLES.length; i++) {
            const angleDeg = ANGLES[(i + fired) % ANGLES.length];
            const sol = h.solveLaunch(target.x, target.y, { angleDeg });
            if (sol && sol.missDistance < 30) {
              ranked.push({ sol, clear: arcClear(sol, target.x, target.y), angleDeg });
            }
          }
          ranked.sort((a, b) => (b.clear ? 1 : 0) - (a.clear ? 1 : 0));
          for (const c of ranked) {
            if (h.fire(c.sol.vx, c.sol.vy, null)) { launched = true; break; }
          }
          if (!launched) { row.error = `Q${q + 1} no launch solution`; break; }
          fired++;
          const moved = await h.waitFor(() => {
            const st = h.state();
            const i = h.info();
            return i.questionIndex === q + 1 || st === 'LEVEL_COMPLETE' || st === 'LEVEL_FAILED' || st === 'AIMING';
          }, 25000);
          if (!moved) { row.error = `Q${q + 1} stalled (state=${h.state()})`; break; }
          if (h.state() === 'LEVEL_FAILED') break;
          if (h.info().questionIndex === q + 1 || h.state() === 'LEVEL_COMPLETE') break;
          // miss → wait for re-arm before next shot
          await h.waitForState('AIMING', 15000);
        }
        if (row.error) break;
        if (h.state() === 'LEVEL_FAILED') { row.error = `Q${q + 1} level failed after ${fired} shots`; break; }
        row.questions.push({ q: q + 1, ms: Date.now() - t0, shots: fired });
      }
      row.outcome = row.error ? 'FAIL' : (h.state() === 'LEVEL_COMPLETE' ? 'COMPLETE' : h.state());
    } catch (err) {
      row.error = String(err && err.message || err);
    }
    results.push(row);
    if (row.error || row.outcome !== 'COMPLETE') break; // stop at first broken level
  }

  await h.destroy();

  let pass = 0, fail = 0;
  for (const r of results) {
    const good = r.outcome === 'COMPLETE' && !r.error;
    if (good) pass++; else fail++;
    console.log(`L${String(r.levelId).padStart(2)} ${good ? 'PASS' : 'FAIL'} ${r.outcome || ''} ${r.error || ''} q=[${r.questions.map((x) => x.ms + 'ms').join(',')}]`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
