/**
 * Fix #17 end-to-end verification — hearts + timer rules inside the REAL
 * headless game (same harness as the integration suite).
 *
 * Checks:
 *   1. Exhausting a question's shots consumes EXACTLY ONE heart (never per
 *      missed shot) and the failed question can be retried while hearts remain.
 *   2. Retrying does not charge again; hearts only reach zero via three
 *      separate failed attempts, and at zero the retry option is withdrawn.
 *   3. Restarting the level restores full hearts and a full timer.
 *   4. The countdown ticking to zero enters LEVEL_FAILED with retry withdrawn
 *      and without awarding/advancing anything.
 *   5. The timer freezes while paused (menu) and during answer feedback.
 *
 * Run: node scripts/verify-fix17.mjs
 */
import { createHeadlessGame } from '../tests/helpers/headless-game.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

/** Fire straight-up misses until shots run out → LEVEL_FAILED (or bail). */
async function exhaustShots(h) {
  const shots = h.info().shotsLeft;
  for (let i = 0; i < shots; i++) {
    if (h.state() === 'LEVEL_FAILED') return true;
    h.fire(0.4, -13);
    const settled = await h.waitFor(
      () => h.state() === 'AIMING' || h.state() === 'LEVEL_FAILED', 20000);
    if (!settled) return false;
  }
  await h.waitForState('LEVEL_FAILED', 20000);
  return h.state() === 'LEVEL_FAILED';
}

const main = async () => {
  const h = await createHeadlessGame();
  h.api.setAutoPause(false); // headless tab reports hidden

  console.log('\n== hearts: one per failed attempt, retry while hearts remain ==');
  await h.gotoLevel(1);
  await h.waitForState('AIMING', 10000);
  let s = h.scene();
  ok('level starts with 3 hearts', s.hearts.remaining === 3);
  ok('level timer starts at the configured limit', s.levelTimer.remainingMs <= 300000 && s.levelTimer.remainingMs > 295000);

  ok('exhausting shots fails the attempt', await exhaustShots(h));
  s = h.scene();
  ok('exactly one heart consumed for the whole failed attempt',
    s.hearts.remaining === 2, `hearts=${s.hearts.remaining}`);
  ok('failed attempt is retryable while hearts remain',
    s.stateMachine.current === 'LEVEL_FAILED' && s.failRetryBtn.visible);

  s.retryQuestion();
  await h.waitForState('AIMING', 10000);
  s = h.scene();
  ok('retry reloads full shots without charging a heart',
    s.hearts.remaining === 2 && s.shotsLeft === s.level.shotsPerQuestion
    && h.info().questionIndex === 0,
    `hearts=${s.hearts.remaining} shots=${s.shotsLeft}`);

  console.log('\n== hearts: zero after three failures, retry withdrawn ==');
  ok('second failed attempt', await exhaustShots(h));
  h.scene().retryQuestion();
  await h.waitForState('AIMING', 10000);
  ok('third failed attempt', await exhaustShots(h));
  s = h.scene();
  ok('hearts reach zero exactly on the third failure',
    s.hearts.remaining === 0, `hearts=${s.hearts.remaining}`);
  ok('retry withdrawn at zero hearts', s.failRetryBtn.visible === false);

  console.log('\n== restart level: hearts and timer restored ==');
  s.restartLevel();
  await h.waitFor(() => h.info() && h.info().questionIndex === 0, 10000);
  await h.waitForState('AIMING', 10000);
  s = h.scene();
  ok('restart restores 3 hearts', s.hearts.remaining === 3);
  ok('restart restores the full countdown (never runs fast)',
    s.levelTimer.remainingMs > 299000, `remaining=${Math.round(s.levelTimer.remainingMs)}`);

  console.log('\n== timer: expiry fails the level, nothing awarded ==');
  const scoreBefore = h.info().score;
  const qBefore = h.info().questionIndex;
  h.api.setTimeRemaining(50);
  await h.waitForState('LEVEL_FAILED', 5000);
  s = h.scene();
  ok('countdown expiry enters LEVEL_FAILED', s.stateMachine.current === 'LEVEL_FAILED');
  ok('expiry awarded no points and advanced no question',
    h.info().score === scoreBefore && h.info().questionIndex === qBefore);
  ok('time-up withdraws the retry button', s.failRetryBtn.visible === false);

  console.log('\n== timer: frozen during pause and answer feedback ==');
  h.scene().restartLevel();
  await h.waitForState('AIMING', 10000);
  s = h.scene();
  h.api.setTimeRemaining(120000);
  s.doPause();
  const t0 = s.levelTimer.remainingMs;
  await sleep(600);
  ok('countdown frozen while the pause menu is open',
    s.levelTimer.remainingMs === t0, `${s.levelTimer.remainingMs} vs ${t0}`);
  s.togglePause(); // resume
  await h.waitForState('AIMING', 10000);
  await sleep(400);
  ok('countdown resumes after unpause', s.levelTimer.remainingMs < 120000,
    `remaining=${Math.round(s.levelTimer.remainingMs)}`);

  // feedback freeze: land a correct answer, sample the timer across feedback
  h.api.autoAim();
  await h.waitForState('ANSWER_FEEDBACK', 10000);
  const t1 = h.scene().levelTimer.remainingMs;
  await sleep(500);
  const t2 = h.scene().levelTimer.remainingMs;
  ok('countdown frozen during mandatory answer feedback', t1 === t2, `${t1} vs ${t2}`);

  await h.destroy();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => { console.error('CRASHED:', e && e.stack || e); process.exit(1); });
