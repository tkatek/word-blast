/**
 * Fix #7 regression suite — the previous-shot trajectory reference.
 *
 * Verifies, against the REAL headless game (real scenes, real physics):
 *   1. aiming shows the bright dotted arc (unchanged behavior);
 *   2. releasing KEEPS that shot's dots on screen (faded reference layer);
 *   3. the kept dots are exactly the release-time prediction (same sampler
 *      the live arc uses), frozen in world coordinates;
 *   4. loading the next bird / re-aiming never moves or duplicates them;
 *   5. a newer completed shot REPLACES the older reference (never stacks);
 *   6. question transitions within a level keep the reference;
 *   7. level transition (NEXT LEVEL) destroys it and starts fresh;
 *   8. restart level clears it;
 *   9. pause/resume keeps it;
 *  10. exiting to the menu clears it (scene shutdown).
 *
 * Run: node tests/trajectory-reference-tests.mjs
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';
import { RENDER_DEPTH } from '../js/systems/SlingshotRenderer.js';

let passed = 0;
let failed = 0;
const failures = [];

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

const sameCoords = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length
  && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6);

/** Live slingshot of the running scene. */
const sl = (h) => h.scene().slingshot;

/** Deep snapshot of the stored reference dots. */
const refSnapshot = (h) => (sl(h).lastShotDots || []).map((p) => ({ x: p.x, y: p.y }));

/** Dots currently drawn on the faded reference layer. */
const refDrawn = (h) => sl(h).renderer.lastDotCount;

/** True while the bright aiming layer is drawing dots. */
const aimDrawn = (h) => sl(h).renderer.trajectory.commandBuffer.length > 0;

/** Display-list objects on the reference / aiming dot layers (leak check). */
const layerCounts = (h) => {
  const list = h.scene().sys.displayList.list;
  return {
    last: list.filter((o) => o.depth === RENDER_DEPTH.TRAJECTORY_LAST).length,
    aim: list.filter((o) => o.depth === RENDER_DEPTH.TRAJECTORY).length
  };
};

/**
 * Simulate a REAL pointer drag + release through the slingshot controller
 * (the same handlers Phaser's input system calls), aiming at an exact
 * launch velocity. Inverse of the launch math: the pouch sits opposite the
 * launch direction at dragLen = speed * MAX_DRAG / MAX_SPEED pixels. The
 * press lands exactly on the CURRENT pouch point, so the grab offset is
 * zero and the release velocity is exactly (vx, vy).
 */
function dragAndRelease(h, vx, vy, { hold = false } = {}) {
  const s = h.scene();
  const sling = s.slingshot;
  const MAX_DRAG = 140, MAX_SPEED = 24; // SLINGSHOT constants (config.js)
  const speed = Math.hypot(vx, vy);
  const dragLen = Math.min(1, speed / MAX_SPEED) * MAX_DRAG;
  const p = {
    x: sling.anchor.x - (vx / speed) * dragLen,
    y: sling.anchor.y - (vy / speed) * dragLen
  };
  const cur = sling.pouchPoint(); // may be mid snap-back — press ON it
  const pt = (x, y) => ({ worldX: x, worldY: y });
  sling.onPointerDown(pt(cur.x, cur.y));
  sling.onPointerMove(pt(p.x, p.y));
  if (hold) return { pouch: sling.pouchPoint() }; // leave the drag open
  sling.onPointerUp();
  return { pouch: p };
}

/** Answer questions correctly (real aimed shots) until the level completes. */
async function completeLevel(h, { timeoutMs = 180000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const st = h.state();
    if (st === 'LEVEL_COMPLETE' || st === 'GAME_COMPLETE') return;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`level never completed (state ${st}, q${h.info().questionIndex})`);
    }
    if (st === 'LEVEL_FAILED') {
      h.scene().retryQuestion();
      await h.waitForState('AIMING', 12000);
    } else if (st === 'AIMING') {
      await h.waitFor(() => h.scene().factory.blocksQuiet(), 5000);
      h.api.autoAim();
      await h.waitFor(() => ['ANSWER_FEEDBACK', 'NEXT_QUESTION', 'LEVEL_COMPLETE', 'LEVEL_FAILED'].includes(h.state()), 25000);
      // feedback settle / card exit land back on AIMING or a terminal state
      await h.waitFor(() => h.state() !== 'ANSWER_FEEDBACK', 25000);
    } else {
      // QUESTION_READY (card), NEXT_QUESTION (card exit), PROJECTILE_FLYING…
      await h.waitFor(() => h.state() !== st, 15000);
    }
  }
}

const h = await createHeadlessGame();

await test('setup: level 1 boots to AIMING', async () => {
  assert(await h.gotoLevel(1), 'GameScene failed to boot');
  assert(await h.waitForState('AIMING', 15000), `stuck in ${h.state()}`);
});

await test('aiming shows bright dots and no reference exists yet', async () => {
  dragAndRelease(h, 6, -10, { hold: true });
  const dots = sl(h).trajectoryDots();
  assert(dots && dots.length > 0, 'no aiming dots while dragging');
  assert(aimDrawn(h), 'bright layer drew no dots while dragging');
  assert(sl(h).lastShotDots === null, 'reference exists before any shot');
  assert(refDrawn(h) === 0, 'reference layer drew dots before any shot');
  sl(h).cancelDrag();
  assert(!aimDrawn(h), 'bright dots not cleared after cancel');
});

await test('release keeps the shot dots as the faded reference', async () => {
  const { pouch } = dragAndRelease(h, 0.5, -14); // soft vertical lob — open grass miss
  assert(await h.waitForState('PROJECTILE_FLYING', 5000), `shot never launched (${h.state()})`);
  assert(await h.waitForState('AIMING', 25000), `shot never resolved (${h.state()})`);
  const ref = sl(h).lastShotDots;
  assert(ref && ref.length > 0, 'no reference kept after release');
  assert(!aimDrawn(h), 'bright aiming dots survived the release');
  assert(refDrawn(h) === ref.length, `reference layer drew ${refDrawn(h)} of ${ref.length} dots`);
  // frozen release-time prediction: identical to the shared sampler for the
  // exact pouch position + velocity the physics body received
  const expect = sl(h).computeDots(pouch, 0.5, -14, 'basic');
  assert(sameCoords(ref, expect), 'kept dots are not the release-time prediction');
});

await test('reference survives the next bird load untouched', async () => {
  const before = refSnapshot(h);
  assert(before.length > 0, 'reference vanished');
  // re-arm already happened (AIMING): the new preview loaded; drag a little
  dragAndRelease(h, 6, -10, { hold: true });
  assert(aimDrawn(h) > 0, 'new drag shows no bright dots');
  assert(refDrawn(h) === before.length, 'dragging the new bird disturbed the reference');
  assert(sameCoords(refSnapshot(h), before), 'reference moved during the new aim');
  sl(h).cancelDrag();
  assert(sameCoords(refSnapshot(h), before), 'reference moved after cancel');
});

let firstRef = [];

await test('a newer completed shot REPLACES the older reference', async () => {
  firstRef = refSnapshot(h);
  const { pouch } = dragAndRelease(h, 3, -12); // different angle/power — still open grass
  assert(await h.waitForState('AIMING', 25000), `shot never resolved (${h.state()})`);
  const ref = sl(h).lastShotDots;
  assert(ref && ref.length > 0, 'no reference after second shot');
  assert(!sameCoords(refSnapshot(h), firstRef), 'second shot did not replace the reference');
  const expect = sl(h).computeDots(pouch, 3, -12, 'basic');
  assert(sameCoords(ref, expect), 'kept dots are not the release-time prediction');
  // exactly ONE reference line: the layer draws one dot per point, no stacking
  assert(refDrawn(h) === ref.length, `reference layer accumulated ${refDrawn(h)} commands for ${ref.length} dots`);
  const lc = layerCounts(h);
  assert(lc.last === 1 && lc.aim === 1, `duplicate graphics objects: ${JSON.stringify(lc)}`);
});

await test('question transition within the level keeps the reference', async () => {
  const before = refSnapshot(h);
  // the real advanceAfterFeedback sequence: NEXT_QUESTION, then the exact
  // loadQuestion call queueNextQuestion makes after the card exit
  const s = h.scene();
  s.stateMachine.set('NEXT_QUESTION');
  s.loadQuestion(s.questionIndex + 1);
  assert(await h.waitForState('AIMING', 15000), `stuck in ${h.state()}`);
  assert(sameCoords(refSnapshot(h), before), 'reference lost/duplicated across questions');
  assert(refDrawn(h) === before.length, 'reference layer changed across questions');
  const lc = layerCounts(h);
  assert(lc.last === 1 && lc.aim === 1, `duplicate graphics objects: ${JSON.stringify(lc)}`);
});

await test('pause/resume keeps the reference', async () => {
  const before = refSnapshot(h);
  h.scene().doPause();
  assert(h.state() === 'PAUSED', 'not paused');
  assert(sameCoords(refSnapshot(h), before) && refDrawn(h) === before.length, 'pause disturbed the reference');
  h.scene().togglePause();
  assert(await h.waitForState('AIMING', 8000), `stuck in ${h.state()}`);
  assert(sameCoords(refSnapshot(h), before) && refDrawn(h) === before.length, 'resume disturbed the reference');
});

await test('level transition destroys the reference and starts fresh', async () => {
  await completeLevel(h);
  assert(h.state() === 'LEVEL_COMPLETE' || h.state() === 'GAME_COMPLETE', `not complete: ${h.state()}`);
  h.scene().goNextLevel(); // the real NEXT LEVEL button path
  assert(await h.waitFor(() => h.scene().levelId === 2 && h.state() === 'AIMING', 20000),
    `level 2 never armed (${h.scene().levelId}, ${h.state()})`);
  assert(sl(h).lastShotDots === null, 'level 2 inherited stored reference data');
  assert(refDrawn(h) === 0, 'level 2 shows leftover reference dots');
  const lc = layerCounts(h);
  assert(lc.last === 1 && lc.aim === 1, `stale graphics survived the restart: ${JSON.stringify(lc)}`);
  // fresh level: aiming shows only the new bright arc, no faded reference
  dragAndRelease(h, 6, -10, { hold: true });
  assert(aimDrawn(h) > 0 && refDrawn(h) === 0, 'aiming in level 2 shows an old reference');
  sl(h).cancelDrag();
});

await test('restarting the level clears the reference', async () => {
  const { pouch } = dragAndRelease(h, 2, -11);
  assert(await h.waitForState('AIMING', 25000), `shot never resolved (${h.state()})`);
  assert(sl(h).lastShotDots && sl(h).lastShotDots.length > 0, 'no reference after the shot');
  assert(refDrawn(h) > 0, 'reference layer empty after the shot');
  h.scene().restartLevel();
  assert(await h.waitFor(() => h.scene().stateMachine && h.state() === 'AIMING', 20000),
    `restart never re-armed (${h.state()})`);
  assert(sl(h).lastShotDots === null, 'restart kept stored reference data');
  assert(refDrawn(h) === 0, 'restart kept reference dots on screen');
});

await test('exiting to the menu clears the reference (scene shutdown)', async () => {
  const { pouch } = dragAndRelease(h, 2, -11);
  assert(await h.waitForState('AIMING', 25000), `shot never resolved (${h.state()})`);
  assert(refDrawn(h) > 0, 'no reference before exit');
  h.scene().exitToMenu();
  assert(await h.waitFor(() => !h.game.scene.getScene('GameScene').sys.isActive(), 8000),
    'GameScene still active after exit');
  const s = h.game.scene.getScene('GameScene');
  assert(!s.slingshot || s.slingshot.lastShotDots === null, 'shutdown kept stored reference data');
});

await h.destroy();

console.log(`\n== summary ==\n${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.log(`FAILED: ${f.name}: ${f.error.message}`);
  process.exit(1);
}
