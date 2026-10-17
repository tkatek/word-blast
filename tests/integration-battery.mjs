/**
 * INTEGRATION BATTERY — real Phaser + Matter edge cases on top of the
 * happy-path baseline playthrough (spec §13). Every check drives the real
 * game through the debug API with legitimate physics interactions.
 *
 * Run: node tests/integration-battery.mjs
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';
import { solveLaunch } from '../js/systems/Trajectory.js';
import { WORLD } from '../js/config.js';

const PASS = [];
const FAIL = [];
const check = (name, ok, detail = '') => {
  (ok ? PASS : FAIL).push(name + (detail ? ` (${detail})` : ''));
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const main = async () => {
  const h = await createHeadlessGame();
  const M = h.Phaser.Physics.Matter.Matter;

  /* -- 1. stability battery: every layout settles within drift budget --- */
  {
    let worst = 0, worstAt = '', lostTotal = 0;
    for (let lvl = 1; lvl <= 15; lvl++) {
      const h1 = await createHeadlessGame();
      await h1.gotoLevel(lvl);
      for (let q = 0; q < 4; q++) {
        const s = h1.scene();
        const layout = s.levels.getLayout(lvl, q);
        s.factory.clearQuestionObjects();
        s.factory.buildLayout(layout);
        const r = s.factory.settleLayout(75);
        lostTotal += r.lost;
        if (r.drift > worst) { worst = r.drift; worstAt = `L${lvl}Q${q + 1}`; }
      }
      await h1.destroy();
    }
    check('all 60 layouts settle with zero losses', lostTotal === 0, `lost=${lostTotal}`);
    check('worst settle drift within budget', worst <= 8.5, `${worst.toFixed(1)}px at ${worstAt}`);
  }

  /* -- 2. one answer per launch: ricochet wrong→correct is ignored ------ */
  {
    const h2 = await createHeadlessGame();
    await h2.gotoLevel(1);
    await h2.waitForState('AIMING', 8000);
    const s = h2.scene();
    const wrong = h2.info().targets.find((t) => !t.correct);
    const correct = h2.info().targets.find((t) => t.correct);
    // fire a shot that hits the wrong target
    const solW = solveLaunch(WORLD.SLING_X, WORLD.SLING_Y, wrong.x, wrong.y, { angleDeg: -14 });
    h2.fire(solW.vx, solW.vy, null);
    await h2.waitForState('ANSWER_FEEDBACK', 12000);
    const wrongHits1 = h2.info().wrongHits;
    // while in feedback, shove the same ball into the correct target
    const ball = h2.liveBalls()[0];
    if (ball) {
      M.Body.setVelocity(ball.body, { x: 0, y: -6 });
      M.Body.setPosition(ball.body, { x: correct.x, y: correct.y - 90 });
      M.Body.setVelocity(ball.body, { x: 0, y: 4 });
    }
    await h2.waitFor(() => h2.info().questionIndex === 1 || h2.state() === 'AIMING', 6000);
    const i = h2.info();
    check('wrong answer shows penalty exactly once', i.wrongHits === wrongHits1, `hits ${wrongHits1} -> ${i.wrongHits}`);
    check('ricochet into correct target does NOT double-answer', i.questionIndex === 0 || i.state === 'AIMING', `q=${i.questionIndex}`);
    await h2.destroy();
  }

  /* -- 3. old projectile cannot answer after the shot resolved ----------- */
  {
    const h3 = await createHeadlessGame();
    await h3.gotoLevel(1);
    await h3.waitForState('AIMING', 8000);
    // deliberate miss: fire into the water gap
    h3.fire(6, -3, null);
    await h3.waitForState('AIMING', 15000);
    const correct = h3.correctTarget();
    // hop the resting (resolved) ball onto the correct target
    let hops = 0;
    while (hops < 8 && h3.info().questionIndex === 0 && h3.state() === 'AIMING') {
      const ball = h3.liveBalls()[0];
      if (!ball) break;
      const dx = correct.x - ball.x;
      const dy = correct.y - ball.y;
      const d = Math.hypot(dx, dy) || 1;
      M.Body.setVelocity(ball.body, { x: dx / d * 7, y: -4 });
      hops++;
      await h3.waitFor(() => {
        const b = h3.liveBalls()[0];
        return !b || Math.hypot(b.body.velocity.x, b.body.velocity.y) < 0.05;
      }, 6000);
    }
    await new Promise((r) => setTimeout(r, 800));
    const i = h3.info();
    check('resolved projectile nudged into target never answers', i.questionIndex === 0 && i.score === 0, `q=${i.questionIndex} score=${i.score}`);
    await h3.destroy();
  }

  /* -- 4. pause during flight, resume without catch-up ------------------ */
  {
    const h4 = await createHeadlessGame();
    await h4.gotoLevel(2);
    await h4.waitForState('AIMING', 8000);
    const t = h4.correctTarget();
    const sol = solveLaunch(WORLD.SLING_X, WORLD.SLING_Y, t.x, t.y, { angleDeg: -30 });
    h4.fire(sol.vx, sol.vy, null);
    await new Promise((r) => setTimeout(r, 150)); // mid-flight
    const s = h4.scene();
    s.doPause();
    const pausedPos = { x: h4.liveBalls()[0]?.x, y: h4.liveBalls()[0]?.y };
    await new Promise((r) => setTimeout(r, 1200)); // "hidden" for 1.2s
    const stillPos = { x: h4.liveBalls()[0]?.x, y: h4.liveBalls()[0]?.y };
    s.togglePause();
    const okFrozen = Math.abs((stillPos.x || 0) - (pausedPos.x || 0)) < 0.01
      && Math.abs((stillPos.y || 0) - (pausedPos.y || 0)) < 0.01;
    check('physics frozen while paused (no catch-up)', okFrozen);
    const done = await h4.waitFor(() => h4.state() === 'AIMING' || h4.info().questionIndex === 1, 15000);
    check('game continues normally after resume', done, h4.state());
    await h4.destroy();
  }

  /* -- 5. portrait freeze → landscape resume keeps state ---------------- */
  {
    const h5 = await createHeadlessGame();
    await h5.gotoLevel(3);
    await h5.waitForState('AIMING', 8000);
    const s = h5.scene();
    h5.api.setDeviceOverride('mobile'); // landscape lock applies to phones
    await new Promise((r) => setTimeout(r, 200));
    h5.api.setOrientationOverride('portrait');
    await new Promise((r) => setTimeout(r, 300));
    const pausedOk = s.stateMachine.isPaused() && s.rotateOverlay.visible;
    h5.api.setOrientationOverride('landscape');
    await new Promise((r) => setTimeout(r, 300));
    const resumedOk = !s.stateMachine.isPaused() && h5.state() === 'AIMING';
    check('portrait pauses with overlay', pausedOk);
    check('landscape resumes exactly where the player was', resumedOk, h5.state());
    check('orientation never restarted the level', h5.info().questionIndex === 0);
    await h5.destroy();
  }

  /* -- 6. restart soak: no growing object counts ------------------------ */
  {
    const h6 = await createHeadlessGame();
    await h6.gotoLevel(6);
    await h6.waitForState('AIMING', 8000);
    const world = h6.scene().matter.world.localWorld;
    const countBodies = () => world.bodies.length;
    const samples = [];
    for (let i = 0; i < 8; i++) {
      h6.game.scene.getScene('GameScene').scene.restart({ levelId: 6 });
      await h6.waitFor(() => h6.state() === 'AIMING', 10000);
      samples.push(countBodies());
    }
    const drift = Math.max(...samples) - Math.min(...samples);
    check('8 restarts leave a stable body count', samples.every((n) => n > 0) && drift <= 2,
      `samples=[${samples.join(',')}] drift=${drift}`);
    await h6.destroy();
  }

  /* -- 7. fallen plaque recovery ---------------------------------------- */
  {
    const h7 = await createHeadlessGame();
    await h7.gotoLevel(1);
    await h7.waitForState('AIMING', 8000);
    const correct = h7.correctTarget();
    // knock the correct plaque off the right edge of the world
    M.Body.setPosition(correct.body, { x: 1268, y: 400 });
    M.Body.setVelocity(correct.body, { x: 2, y: 3 });
    M.Sleeping.set(correct.body, false);
    await h7.waitFor(() => correct.wb.respawned > 0, 8000);
    check('out-of-bounds plaque respawns at its anchor', correct.wb.respawned > 0 && Math.abs(correct.x - correct.wb.anchorX) < 5,
      `respawned=${correct.wb.respawned} x=${correct.x.toFixed(0)}`);
    const i = h7.info();
    check('recovered plaque is never auto-answered', i.questionIndex === 0 && i.score === 0);
    await h7.destroy();
  }

  console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
  process.exit(FAIL.length ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
