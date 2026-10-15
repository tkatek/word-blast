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

        // legitimate launches: solved ballistic arcs through the correct
        // target. Angle choice mirrors a reasonable player: steep lobs for
        // far/shielded targets, flatter arcs for near ones; retries rotate.
        const ANGLES = [-14, -22, -30, -38, -46, -8, -54];
        const orderedAngles = (targetX, attempt) => {
          const steepFirst = targetX > 1000 || attempt > 0;
          const list = steepFirst ? [-30, -38, -22, -46, -14, -54, -8] : ANGLES;
          return list.map((_, i) => list[(i + attempt) % list.length]);
        };
        let fired = 0;
        const maxShots = info.shotsLeft;
        while (fired < maxShots && h.info().questionIndex === q && h.state() !== 'LEVEL_FAILED') {
          let launched = false;
          const target = h.correctTarget();
          if (!target) break;
          for (const angleDeg of orderedAngles(target.x, fired)) {
            // solve from the live slingshot anchor (device art aware)
            const sol = h.solveLaunch(target.x, target.y, { angleDeg });
            if (sol && sol.missDistance < 30) {
              if (h.fire(sol.vx, sol.vy, null)) { launched = true; break; }
            }
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
