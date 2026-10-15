/**
 * DETERMINISTIC FREEZE REPRODUCTION — the reported bug:
 *
 *   "Level 3, Question 1/4. I shoot the correct answer target. Instead of
 *    advancing to Question 2/4, gameplay gets stuck."
 *
 * Root mechanism under test: a valid projectile of the current shot can
 * touch the correct answer target AFTER the shot has already been resolved
 * and the slingshot re-armed (state = AIMING). In the real game this happens
 * whenever the ball's speed dips below the resolve threshold and it then
 * rolls/creeps into the target, or debris / a moving obstacle shoves the
 * resting ball into it.
 *
 * The scenario reproduces it with full-fidelity physics: a real shot lands
 * far short of every target and comes to rest, the shot resolves, the game
 * re-arms (AIMING) — then the resting ball receives a debris-equivalent
 * impulse (drop-in + gentle velocity, as if knocked there by falling rubble
 * or an oscillating gate) and reaches the correct target through Matter's
 * genuine collisionstart handling.
 *
 * Run: node tests/repro-freeze.mjs
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const main = async () => {
  const warns = [];
  const ow = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); ow.apply(console, a); };

  const h = await createHeadlessGame();
  const exit = async (code, msg) => { await h.destroy(); console.log(msg); process.exit(code); };

  await h.gotoLevel(1);
  await h.waitForState('AIMING', 8000);

  // 1) soft lob landing far short of every target (x≈350) — cannot touch one
  const sol = h.solveLanding(350);
  if (!sol) return exit(2, 'REPRO SETUP FAILED: no landing solution');
  h.fire(sol.vx, sol.vy);

  // 2) wait for the shot to resolve and the slingshot to re-arm
  if (!(await h.waitForState('AIMING', 12000))) {
    return exit(2, 'REPRO SETUP FAILED: never re-armed (state ' + h.state() + ')');
  }
  let s = h.scene();
  if (h.info().questionIndex !== 0 || s.prepared.answered) {
    return exit(2, 'REPRO SETUP FAILED: ball touched a target in flight');
  }
  const ball = h.liveBalls()[0];
  if (!ball) return exit(2, 'REPRO SETUP FAILED: no live projectile after re-arm');
  console.log('repro: shot resolved; game re-armed (AIMING). Ball resting at x=' + ball.x.toFixed(0));

  // 3) debris-equivalent impulse: drop the resting ball just RIGHT of the
  //    correct target with a gentle leftward push — the contact that follows
  //    is a genuine Matter collisionstart, exactly like rubble knocking it in
  //    (approach from the right: fences only guard the left sides)
  const target = h.correctTarget();
  const M = h.Phaser.Physics.Matter.Matter;
  M.Body.setPosition(ball.body, { x: target.x + 95, y: 500 });
  M.Body.setVelocity(ball.body, { x: -3.5, y: 1.5 });
  console.log('repro: impulse applied — ball dropping toward correct target ' + target.x + ' while state=' + h.state());

  // 4) observe: does the correct answer register AND advance the question?
  const touched = await h.waitFor(() => s.prepared.answered === true, 8000);
  if (!touched) {
    return exit(2, 'REPRO SETUP FAILED: ball never reached the correct target (state ' + h.state() + ')');
  }
  console.log('repro: correct-answer collision registered. Waiting for question advancement…');

  const advanced = await h.waitFor(() => h.info().questionIndex === 1, 12000);
  const after = h.info();
  const st = h.state();

  console.log('\n================ OBSERVATION ================');
  console.log('state            :', st);
  console.log('question         :', after.questionIndex + 1, '/ 4  (expected 2/4)');
  console.log('prepared.answered:', s.prepared.answered);
  console.log('score            :', after.score);
  console.log('state machine warns:', warns.length ? warns : '(none)');
  console.log('advanced         :', advanced);
  console.log('=============================================\n');

  if (advanced) {
    return exit(0, 'RESULT: game advanced normally — freeze NOT reproduced.');
  }
  const frozen = st === 'AIMING' && s.prepared.answered === true && after.score > 0;
  return exit(frozen ? 0 : 1, frozen
    ? 'RESULT: FREEZE REPRODUCED — correct answer scored (' + after.score + ' pts), question marked answered, '
      + 'but the state machine stayed in AIMING and Question 1 never advanced. The settle watcher only runs '
      + 'in ANSWER_FEEDBACK, so nothing can ever progress. Warns: ' + warns.join(' | ')
    : 'RESULT: unexpected terminal state ' + st);
};

main().catch((e) => { console.error('REPRO ERROR', e && e.stack || e); process.exit(1); });
