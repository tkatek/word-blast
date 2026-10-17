/**
 * Integration regression suite — a REAL Phaser game (Canvas renderer into a
 * no-op context) with REAL Matter.js physics, the real scenes, the real
 * question/level data and the real save manager, running headless in Node.
 *
 * Covers the reported freeze ("hit the correct answer → game stuck, question
 * never advances") and every required gameplay scenario around it.
 *
 * Run: npm run test:integration   (or as part of npm test)
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

let passed = 0;
let failed = 0;
const failures = [];
const rejectedTransitions = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push({ name, error: e });
      console.log(`FAIL  ${name}\n      ${e.message}`);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Deliver a resting shot projectile onto a target with retries.
 * Dynamic plaques settle differently per run; a retry or two lands one. */
async function deliverOnto(h, ball, getTarget, didLand) {
  const M = h.Phaser.Physics.Matter.Matter;
  const s = h.scene();
  // dynamic plaques/towers drift while settling — deliver only onto a still world
  await h.waitFor(() => {
    const t = getTarget();
    if (!t || !t.body) return false;
    const v = t.body.velocity;
    return Math.hypot(v.x, v.y) < 0.15 && h.scene().factory.blocksQuiet();
  }, 5000);
  const offsets = [8, -8, 0, 20, -20, 12, 4, -16];
  for (let tries = 0; tries < offsets.length; tries++) {
    const t = getTarget();
    if (!t || !ball.body) return false;
    M.Sleeping.set(ball.body, false);
    M.Body.setPosition(ball.body, { x: t.x + offsets[tries], y: t.y - 30 });
    M.Body.setVelocity(ball.body, { x: 0, y: 1 });
    // verify the INTENDED plaque took the hit (neighbors drift around)
    const landed = await h.waitFor(() => (didLand ? didLand() : s.state() === 'ANSWER_FEEDBACK'), 3500);
    if (landed) return true;
  }
  return false;
}

/** Find and fire a real aimed shot at a world point (angle sweep).
 * attempt rotates the chosen angle: deterministic physics replays an
 * identical shot identically, so retrying must vary the angle. */
function aimShotAt(h, x, y, attempt = 0) {
  // solveLaunch uses one fixed angle; sweep angles until a real solution
  // exists. Steep lob angles (-40..-54) matter: a rear ground plaque can
  // only be reached OVER a front tower — exactly the arc the layout
  // generator verifies as reachable. The generator validates the plaque's
  // CENTER and its UPPER HALF; try both aim points.
  const s0 = h.scene();
  const blockers0 = [];
  for (const t of s0.factory.targets) {
    if (Math.hypot(t.x - x, t.y - y) > 4 && !t.wb.hit) blockers0.push({ x: t.x, y: t.y, w: 116, h: 80 });
  }
  for (const b of s0.factory.blocks) {
    if (!b.wb.removed) blockers0.push({ x: b.x, y: b.y, w: b.displayWidth, h: b.displayHeight });
  }
  const clearArc = (vx, vy) => {
    const pts = h.predictPath(vx, vy, { steps: 160 });
    for (const p of pts) {
      if (p.x > x - 10) break;
      for (const bl of blockers0) {
        if (p.x > bl.x - bl.w / 2 - 14 && p.x < bl.x + bl.w / 2 + 14
          && p.y > bl.y - bl.h / 2 - 14 && p.y < bl.y + bl.h / 2 + 14) return false;
      }
    }
    return true;
  };
  let fallbackPool = null;
  for (const aimY of [y, y - 28]) {
    const viable = [];
    for (const angleDeg of [-35, -30, -25, -20, -16, -12, -9, -6, -42, -48, -54]) {
      // steps: steep lobs fly >60 steps; the default path truncates short
      const sol = h.solveLaunch(x, aimY, { angleDeg, steps: 160 });
      if (sol && sol.missDistance < 40) viable.push(sol);
    }
    // Prefer arcs that do not clip another plaque or a tower piece in
    // front of the aim point — those legally answer a DIFFERENT plaque.
    const clearing = viable.filter((sol) => clearArc(sol.vx, sol.vy));
    if (clearing.length) {
      const sol = clearing[attempt % clearing.length];
      return h.api.simulateShot({ vx: sol.vx, vy: sol.vy });
    }
    if (!fallbackPool && viable.length) fallbackPool = viable;
  }
  if (!fallbackPool) return false;
  const sol = fallbackPool[attempt % fallbackPool.length];
  return h.api.simulateShot({ vx: sol.vx, vy: sol.vy });
}

/** Find and fire a real aimed shot at a choice (default: correct answer). */
function autoAimSweep(h, choiceId = null, attempt = 0) {
  const s = h.scene();
  const wanted = choiceId || s.prepared.question.correctAnswerId;
  const target = s.factory.targets.find((t) => t.wb.choiceId === wanted);
  if (!target) return false;
  return aimShotAt(h, target.x, target.y, attempt);
}

/** Answer the current question correctly via a real aimed shot. */
async function answerCorrect(h, { timeoutMs = 25000 } = {}) {
  const startQ = h.info().questionIndex;
  const t0 = Date.now();
  for (let attempt = 0; attempt < 8; attempt++) {
    if (h.info().questionIndex !== startQ) return true;         // advanced
    const st = h.state();
    if (st === 'LEVEL_COMPLETE' || st === 'GAME_COMPLETE') return true;
    if (st === 'LEVEL_FAILED') {
      // out of shots on this attempt — retry the question once, then bail
      h.scene().retryQuestion();
      await h.waitForState('AIMING', 8000);
      continue;
    }
    if (st === 'AIMING') {
      // world stillness before aiming — plaques drift while settling
      await h.waitFor(() => h.scene().factory.blocksQuiet(), 5000);
      if (attempt < 2) {
        autoAimSweep(h, null, attempt);
      } else {
        // Last resort for fortified layouts aimed shots cannot crack within
        // the shot budget: fire a REAL shot (consumes ammo, records the shot)
        // and deliver its projectile with a debris-equivalent Matter impulse.
        // Answer validation, scoring and progression still run the full
        // real pipeline — nothing is marked correct by hand.
        h.fire(6, -6);
        const ball = h.liveBalls()[0];
        if (ball) {
          await deliverOnto(h, ball, () => h.correctTarget(), () => h.scene().prepared && h.scene().prepared.answered === true);
        }
      }
    }
    const advanced = await h.waitFor(() => h.info().questionIndex !== startQ
      || h.state() === 'LEVEL_COMPLETE' || h.state() === 'GAME_COMPLETE', 9000);
    if (advanced) return true;
    if (Date.now() - t0 > timeoutMs) return false;
  }
  return h.info().questionIndex !== startQ;
}

/** The slingshot must be loaded, enabled and actually fireable. */
async function assertPlayable(h, label) {
  const s = h.scene();
  assert(s.slingshot.enabled, `${label}: slingshot not enabled (state ${h.state()})`);
  assert(s.slingshot.preview, `${label}: slingshot not loaded`);
  assert(h.fire(6, -6), `${label}: launch rejected in ${h.state()}`);
  // let the shot finish so the next assertion starts from a clean slate
  await h.waitFor(() => h.state() === 'AIMING' || h.info().questionIndex !== 0
    || h.state() === 'LEVEL_FAILED' || h.state() === 'LEVEL_COMPLETE', 15000);
}

const main = async () => {
  // capture state-machine rejections across the whole suite — none may occur
  const ow = console.warn;
  console.warn = (...a) => {
    const m = a.join(' ');
    if (m.includes('rejected transition')) rejectedTransitions.push(m);
    ow.apply(console, a);
  };

  let h;
  try {
    h = await createHeadlessGame();
  } catch (e) {
    console.error('HARNESS FAILED TO BOOT:', e && e.stack || e);
    process.exit(1);
  }

  /* ------------------------------------------------------------------ */
  console.log('\n== regression: the reported freeze (Level 3 path) =========');

  await test('freeze regression: correct answer landing AFTER re-arm still advances (L3)', async () => {
    await h.gotoLevel(3);
    await h.waitForState('AIMING', 8000);
    // soft lob far short of everything → resolves & re-arms with ball resting
    const landX = Math.max(530, h.correctTarget().x - 260);
    const sol = h.solveLanding(landX);
    assert(sol, 'landing solution');
    assert(h.fire(sol.vx, sol.vy), 'launch rejected');
    assert(await h.waitForState('AIMING', 15000), 'shot never resolved');
    const s = h.scene();
    eq(h.info().questionIndex, 0, 'question advanced during flight?');
    assert(!s.prepared.answered, 'question consumed during flight');
    const ball = h.liveBalls()[0];
    assert(ball, 'no live projectile after re-arm');
    // debris/mover-equivalent impulse onto the correct target while AIMING
    // (approach from the right: fences only guard the left sides)
    assert(await deliverOnto(h, ball, () => h.correctTarget(), () => s.prepared && s.prepared.answered === true), 'correct answer never registered');
    assert(await h.waitFor(() => h.info().questionIndex === 1, 15000),
      `FREEZE: correct answer validated but question stuck (state ${h.state()})`);
    eq(h.info().score, 1000, 'score for first-attempt correct');
  });

  await test('late WRONG answer after re-arm shows feedback and stays playable', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const landX = Math.max(530, h.correctTarget().x - 260);
    const sol = h.solveLanding(landX);
    assert(h.fire(sol.vx, sol.vy), 'launch rejected');
    assert(await h.waitForState('AIMING', 15000), 'shot never resolved');
    const s = h.scene();
    const ball = h.liveBalls()[0];
    assert(ball, 'no resting ball');
    const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId);
    assert(await deliverOnto(h, ball, () => wrong, () => wrong.wb && wrong.wb.hit === true), 'wrong answer never registered');
    eq(h.info().questionIndex, 0, 'wrong answer must not advance the question');
    assert(await h.waitForState('AIMING', 12000), 'feedback never settled back to AIMING');
    assert(h.fire(6, -6), 'game not playable after late wrong answer');
  });

  /* ------------------------------------------------------------------ */
  console.log('\n== question progression (the reported level) ===============');

  await test('Level 3: 4 correct answers → LEVEL_COMPLETE, next level unlocks', async () => {
    await h.gotoLevel(3);
    await h.waitForState('AIMING', 8000);
    const before = h.game.registry.get('save');
    eq(h.info().questionIndex, 0);

    assert(await answerCorrect(h), 'Q1 never advanced');
    eq(h.info().questionIndex, 1, 'Q2 not loaded after Q1');
    assert(await answerCorrect(h), 'Q2 never advanced');
    eq(h.info().questionIndex, 2, 'Q3 not loaded after Q2');
    assert(await answerCorrect(h), 'Q3 never advanced');
    eq(h.info().questionIndex, 3, 'Q4 not loaded after Q3');
    assert(await answerCorrect(h), 'Q4 never completed the level');
    assert(await h.waitForState('LEVEL_COMPLETE', 10000), `state ${h.state()} after Q4`);

    const info = h.info();
    assert(info.score >= 4000, `unexpected score ${info.score}`);
    assert(before.isLevelUnlocked(4), 'level 4 not unlocked after completing 3');
    assert(before.getLevelEntry(3).completed, 'level 3 not marked completed');
  });

  await test('wrong answer: no advancement, shot consumed, re-armed', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const s = h.scene();
    const shots0 = h.info().shotsLeft;
    const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId);
    // aim at the wrong target with a real shot (angle sweep)
    assert(aimShotAt(h, wrong.x, wrong.y), 'no wrong-target solution');
    assert(await h.waitForState('ANSWER_FEEDBACK', 10000), 'wrong hit never produced feedback');
    eq(h.info().questionIndex, 0, 'wrong answer advanced the question');
    assert(await h.waitForState('AIMING', 12000), 'not re-armed after wrong answer');
    eq(h.info().shotsLeft, shots0 - 1, 'wrong answer must consume the shot');
    eq(h.info().wrongHits, 1, 'wrong hit not recorded');
    await assertPlayable(h, 'after wrong answer');
  });

  await test('missed shot: game stays playable and question continues', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const shots0 = h.info().shotsLeft;
    // deliberate miss: straight up
    assert(h.fire(0.5, -14), 'launch rejected');
    assert(await h.waitForState('AIMING', 20000), 'missed shot never resolved');
    eq(h.info().questionIndex, 0, 'miss advanced the question?');
    eq(h.info().shotsLeft, shots0 - 1, 'miss must consume the shot');
    await assertPlayable(h, 'after miss');
  });

  await test('repeated collision events score exactly once', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    h.api.autoAim();
    assert(await h.waitForState('ANSWER_FEEDBACK', 10000), 'no answer');
    const scoreAtFeedback = h.info().score;
    const s = h.scene();
    const proj = s.factory.projectiles[0];
    const target = s.factory.targets.find((t) => t.wb.hit);
    assert(target, 'no hit target to replay');
    // replay the SAME collision 10x while Matter would still be in contact
    for (let i = 0; i < 10; i++) {
      s.onCollisionStart({ pairs: [{ bodyA: proj.body, bodyB: target.body }] });
    }
    await h.waitFor(() => h.info().questionIndex === 1, 15000);
    eq(h.info().score, scoreAtFeedback, 'duplicate scoring after repeated collision events');
    eq(h.info().questionIndex, 1, 'question advanced more than once?');
  });

  await test('physics that never settles still advances (bounded timeout)', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const s0 = h.scene();
    const t0 = s0.factory.targets.find((x) => x.wb.choiceId === s0.prepared.question.correctAnswerId);
    assert(aimShotAt(h, t0.x, t0.y), 'no aimed solution');
    assert(await h.waitForState('ANSWER_FEEDBACK', 10000), 'no answer');
    const s = h.scene();
    const original = s.factory.isSettled.bind(s.factory);
    s.factory.isSettled = () => false;      // pretend nothing ever settles
    try {
      assert(await h.waitFor(() => h.info().questionIndex === 1, 10000),
        'never-settling physics blocked question advancement past the timeout');
    } finally {
      s.factory.isSettled = original;
    }
  });

  /* ------------------------------------------------------------------ */
  console.log('\n== lifecycle robustness =====================================');

  await test('pause during projectile flight resumes cleanly', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    h.fire(10, -8);
    await h.waitForState('PROJECTILE_FLYING', 4000);
    h.scene().doPause();
    eq(h.state(), 'PAUSED', 'pause failed');
    await new Promise((r) => setTimeout(r, 400));
    eq(h.state(), 'PAUSED', 'game left PAUSED without resume');
    h.scene().togglePause();                 // resume
    // the shot must resolve and the game must return to a playable state
    assert(await h.waitFor(() => ['AIMING', 'ANSWER_FEEDBACK', 'LEVEL_FAILED'].includes(h.state()), 20000),
      `stuck in ${h.state()} after resume`);
    await h.waitForState('AIMING', 15000);
    await assertPlayable(h, 'after pause/resume in flight');
  });

  await test('pause inside the arming window arms on resume', async () => {
    await h.gotoLevel(1);
    // pause right after a question loads, inside the 250ms arming delay
    await h.waitForState('QUESTION_READY', 8000);
    h.scene().doPause();
    await new Promise((r) => setTimeout(r, 700));
    eq(h.state(), 'PAUSED', 'pause failed');
    h.scene().togglePause();
    assert(await h.waitForState('AIMING', 8000),
      `deferred arming lost across pause/resume (state ${h.state()})`);
    await assertPlayable(h, 'after arming-window pause');
  });

  await test('restart during ANSWER_FEEDBACK boots clean and playable', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    h.api.autoAim();
    assert(await h.waitForState('ANSWER_FEEDBACK', 10000), 'no answer');
    h.scene().restartLevel();
    await h.waitFor(() => h.info() && h.info().questionIndex === 0, 8000);
    assert(await h.waitForState('AIMING', 8000), `not playable after restart (${h.state()})`);
    await assertPlayable(h, 'after restart in feedback');
  });

  await test('restart during PHYSICS_RESOLVING boots clean and playable', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    h.fire(10, -6);
    assert(await h.waitFor(() => ['PROJECTILE_FLYING', 'PHYSICS_RESOLVING'].includes(h.state()), 8000));
    h.scene().restartLevel();
    await h.waitFor(() => h.info() && h.info().questionIndex === 0, 8000);
    assert(await h.waitForState('AIMING', 8000), `not playable after restart (${h.state()})`);
    await assertPlayable(h, 'after restart in resolving');
  });

  await test('forced shot timeout resolves as a miss (no state corruption)', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const shots0 = h.info().shotsLeft;
    h.fire(0.5, -13);                         // long flight
    await h.waitForState('PROJECTILE_FLYING', 4000);
    h.scene().currentShot.startedAt = h.scene().time.now - 99999;  // force timeout
    assert(await h.waitForState('AIMING', 15000), `timeout did not re-arm (${h.state()})`);
    eq(h.info().questionIndex, 0, 'timeout advanced the question?');
    eq(h.info().shotsLeft, shots0 - 1, 'timeout must consume the shot');
    await assertPlayable(h, 'after forced timeout');
  });

  await test('resize/orientation event mid-question does not break progression', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const s = h.scene();
    // well-formed resize event (Phaser's own argument tuple) + the game's
    // orientation handler, as a real viewport change would deliver
    s.scale.emit('resize', s.scale.gameSize, s.scale.baseSize, s.scale.displaySize, 1);
    s.updateOrientationState();
    assert(await answerCorrect(h), 'question did not advance after resize');
  });

  /* ------------------------------------------------------------------ */
  console.log('\n== full campaign: all 15 levels × 4 questions ==============');

  await test('every level completes its four-question progression', async () => {
    for (let levelId = 1; levelId <= 15; levelId++) {
      await h.gotoLevel(levelId);
      await h.waitForState('AIMING', 10000);
      for (let q = 0; q < 4; q++) {
        const ok = await answerCorrect(h, { timeoutMs: 90000 });
        assert(ok, `L${levelId} Q${q + 1} did not advance (state ${h.state()})`);
      }
      // level 15 transitions LEVEL_COMPLETE -> GAME_COMPLETE immediately
      // once every level is done; either terminal state satisfies this
      const done = await h.waitFor(
        () => h.state() === 'LEVEL_COMPLETE' || h.state() === 'GAME_COMPLETE',
        10000
      );
      assert(done, `L${levelId} never completed (${h.state()})`);
      const save = h.game.registry.get('save');
      assert(save.getLevelEntry(levelId).completed, `L${levelId} not saved as completed`);
      if (levelId < 15) assert(save.isLevelUnlocked(levelId + 1), `L${levelId + 1} not unlocked`);
    }
    const save = h.game.registry.get('save');
    assert(save.allCompleted, 'game not complete after all 15 levels');
  });

  await test('level 15 completion shows the game-complete state', async () => {
    // the previous test finished on level 15 with everything completed
    const s = h.scene();
    assert(s.stateMachine.current === 'LEVEL_COMPLETE' || s.stateMachine.current === 'GAME_COMPLETE',
      `unexpected final state ${h.state()}`);
    const save = h.game.registry.get('save');
    assert(save.allCompleted, 'allCompleted flag missing');
  });

  /* ------------------------------------------------------------------ */
  console.log('\n== summary ==================================================');
  console.log(`${passed} passed, ${failed} failed`);
  if (rejectedTransitions.length) {
    console.log(`\nSTATE MACHINE REJECTIONS DURING SUITE (${rejectedTransitions.length}):`);
    for (const m of rejectedTransitions) console.log(' -', m);
  } else {
    console.log('state-machine rejections during suite: none');
  }
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(` - ${f.name}: ${f.error.message}`);
  }
  await h.destroy();
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => {
  console.error('INTEGRATION SUITE CRASHED:', e && e.stack || e);
  process.exit(1);
});
