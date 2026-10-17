/**
 * BIRD LIFECYCLE REGRESSION SUITE (Fix #6B) — headless, real Phaser
 * (CANVAS) + real Matter.js + the real scenes/state machine. Bird textures
 * intentionally fall back to the legacy circles here (no binary assets in
 * Node); the LIFECYCLE under test is texture-independent. Skin-visual
 * assertions live in scripts/verify-lifecycle.mjs (real browser).
 *
 * Covers:
 *   - one loaded bird before launch; exactly one projectile per shot
 *   - no duplicate projectile from a single release (double pointerup)
 *   - miss  → visual despawn flagged, sprite hidden; body swept at next
 *     launch; the frozen late-answer window (pre-next-launch) still works
 *   - wrong answer → same despawn guarantee, swept by the next launch
 *   - correct answer → question advances with zero leftover projectiles
 *   - level completion sweeps the final shot (no lingering bird under the
 *     victory overlay)
 *   - no ghosts after question advance or scene restart
 *   - pause/resume during flight → no duplicates, shot still resolves
 *   - split → exactly 3 projectiles of one shot, second tap adds nothing
 *   - stale projectiles of an older shot can never answer
 *   - sprite/body alignment at spawn (center + display size + collider)
 *   - grab-offset drag: pointer down off-center does not jump the bird
 *   - cleanup idempotency (double despawn / double sweep)
 *
 * Run: node tests/bird-lifecycle-tests.mjs   (part of npm test)
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';
import { SLINGSHOT } from '../js/config.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ok  ${name}`); })
    .catch((e) => {
      failed++;
      failures.push({ name, error: e });
      console.log(`FAIL  ${name}\n      ${e.message}`);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/**
 * Launch a guaranteed MISS: a gentle backward lob that lands on the empty
 * grass BEHIND the slingshot — it cannot touch any plaque or tower, so the
 * shot resolves unanswered (forward lobs can clip a plaque on a bounce and
 * turn into a wrong answer).
 */
async function fireMiss(h) {
  const s = h.scene();
  const before = s.currentShot?.id || 0;
  assert(h.fire(-6, -5), 'miss shot failed to launch');
  const done = await h.waitFor(() => s.currentShot && s.currentShot.id === before + 1
    && (s.currentShot.resolvedHandled || s.currentShot.answered), 15000);
  assert(done, 'backward lob never resolved');
  assert(!s.currentShot.answered, 'backward lob unexpectedly answered — miss is not guaranteed');
}

/** Wait until the slingshot is armed again with a loaded preview. */
async function waitForRearm(h) {
  const ok = await h.waitFor(() => {
    try {
      const s = h.scene();
      return h.state() === 'AIMING' && !!s.slingshot && !!s.slingshot.preview;
    } catch { return false; }
  }, 25000);
  assert(ok, `never re-armed (state=${h.state()})`);
}

/** Wait for the delayed landing animation to hide the shot's visuals. */
async function waitForDespawn(h, shotId) {
  const ok = await h.waitFor(() => {
    const s = h.scene();
    const ps = s.factory.projectiles.filter((p) => p.wb.shotId === shotId);
    return ps.length > 0 && ps.every((p) => p.wb.visualGone);
  }, 4000);
  assert(ok, 'landing animation never hid the projectile visuals');
}

const h = await createHeadlessGame();

await test('setup: level 1 armed with exactly one preview and no projectiles', async () => {
  await h.gotoLevel(1);
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(s.slingshot.preview, 'no preview bird in the pouch');
  assert(s.factory.projectiles.length === 0, `expected 0 projectiles, got ${s.factory.projectiles.length}`);
});

await test('flight: exactly one normal projectile; single release never duplicates', async () => {
  const s = h.scene();
  assert(h.fire(12, -6), 'launch refused');
  // simulate a duplicated release event — must not spawn anything
  s.slingshot.onPointerUp();
  s.slingshot.onPointerUp();
  assert(h.state() === 'PROJECTILE_FLYING', `state=${h.state()}`);
  const live = s.factory.projectiles.filter((p) => !p.wb.consumed);
  assert(live.length === 1, `expected 1 live projectile, got ${live.length}`);
  assert(live.every((p) => p.wb.shotId === s.currentShot.id), 'projectile shot id mismatch');
  // settle this shot so later tests start from a known state
  await h.waitFor(() => s.currentShot.resolvedHandled || s.currentShot.answered, 20000);
  await waitForRearm(h);
});

await test('miss: visual despawn flagged + sprite hidden, body kept for the late-answer window', async () => {
  const s = h.scene();
  await fireMiss(h); // guaranteed true miss
  await waitForRearm(h);
  await waitForDespawn(h, s.currentShot.id);
  const rest = s.factory.projectiles;
  assert(rest.length === 1, `resolved shot should keep its body until the next launch, got ${rest.length}`);
  assert(rest[0].wb.visualDespawned, 'miss did not flag visualDespawned');
  assert(rest[0].visible === false, 'fallback sprite still visible after despawn');
  assert(rest[0].wb.consumed === false, 'body must stay live (late-answer window)');
});

await test('late-answer window still works after re-arm (freeze-regression guarantee)', async () => {
  const s = h.scene();
  const M = h.Phaser.Physics.Matter.Matter;
  const ball = s.factory.projectiles[0];
  assert(ball && !ball.wb.consumed, 'no resting body from the missed shot');
  const target = h.correctTarget();
  M.Sleeping.set(ball.body, false);
  M.Body.setPosition(ball.body, { x: target.x, y: target.y - 30 });
  M.Body.setVelocity(ball.body, { x: 0, y: 1 });
  const answered = await h.waitFor(() => h.state() === 'ANSWER_FEEDBACK', 8000);
  assert(answered, `resolved shot should still answer while AIMING (state=${h.state()})`);
  // the late answer was CORRECT → the question advances; wait it out
  await h.waitFor(() => h.state() === 'AIMING' || h.state() === 'LEVEL_COMPLETE', 25000);
  assert(s.factory.projectiles.length === 0,
    `question change must clear everything, got ${s.factory.projectiles.length}`);
});

await test('next launch sweeps the old shot completely (no accumulation)', async () => {
  const s = h.scene();
  await fireMiss(h); // leaves one resting body
  await waitForRearm(h);
  const shotId = s.currentShot.id;
  assert(s.factory.projectiles.length === 1, 'precondition: one leftover body');
  assert(h.fire(-6, -5), 'launch refused');
  const after = s.factory.projectiles.filter((p) => !p.wb.consumed);
  assert(after.length === 1, `expected exactly the 1 new projectile, got ${after.length}`);
  assert(after[0].wb.shotId === shotId + 1, 'leftover projectile from the previous shot survived');
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
  await waitForRearm(h);
});

await test('repeated misses never accumulate bodies or flags', async () => {
  await h.gotoLevel(2); // fresh question + shot budget, isolated from above
  await h.waitForState('AIMING');
  const s = h.scene();
  for (let i = 0; i < 2; i++) {
    await fireMiss(h);
    await waitForRearm(h);
  }
  assert(s.factory.projectiles.length === 1, `after 2 misses expected 1 resting body, got ${s.factory.projectiles.length}`);
  assert(s.factory.birdSkins.length === 0, `headless runs have no skins, got ${s.factory.birdSkins.length}`);
});

await test('wrong answer: visual despawn flagged (swept by the next launch)', async () => {
  await h.gotoLevel(3);
  await h.waitForState('AIMING');
  const s = h.scene();
  const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId && !t.wb.hit);
  assert(wrong, 'no wrong target available');
  const sol = s.debugAutoAim(wrong.wb.choiceId);
  assert(sol, 'autoAim found no solution for the wrong target');
  await h.waitFor(() => h.state() === 'ANSWER_FEEDBACK', 15000);
  await waitForRearm(h);
  const rest = s.factory.projectiles;
  assert(rest.length >= 1 && rest.every((p) => p.wb.visualDespawned || p.wb.consumed),
    'wrong-answer shot was not visually despawned');
});

await test('correct answer: launch sweeps the wrong-answer leftovers; question advances clean', async () => {
  const s = h.scene();
  const qBefore = s.questionIndex;
  s.debugAutoAim(); // correct answer — its launch sweeps the previous body
  await h.waitFor(() => h.state() === 'ANSWER_FEEDBACK', 15000);
  await h.waitFor(() => s.questionIndex === qBefore + 1 || h.state() === 'LEVEL_COMPLETE', 25000);
  if (h.state() !== 'LEVEL_COMPLETE') {
    assert(s.factory.projectiles.length === 0, `projectiles leaked across the question change: ${s.factory.projectiles.length}`);
  }
  assert(s.factory.birdSkins.length === 0, 'skins leaked across the question change');
});

await test('split: exactly 3 projectiles of one shot; second tap adds nothing', async () => {
  await h.gotoLevel(10);
  await h.waitForState('AIMING');
  const s = h.scene();
  s.selectProjectile('split');
  assert(s.slingshot.loadedType === 'split', 'split not selected');
  assert(h.fire(15, -6), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  s.tryActivateAbilities();
  s.tryActivateAbilities(); // duplicate tap — must not split again
  const live = s.factory.projectiles.filter((p) => !p.wb.consumed);
  assert(live.length === 3, `expected parent + 2 children, got ${live.length}`);
  assert(live.every((p) => p.wb.shotId === s.currentShot.id), 'split children carry a different shot id');
  assert(live.filter((p) => p.wb.typeKey === 'split-child').length === 2, 'child type keys wrong');
});

await test('restart mid-flight: no ghost projectiles after reboot', async () => {
  const s = h.scene();
  await waitForRearm(h);
  assert(h.fire(12, -6), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  s.restartLevel();
  await h.waitForState('AIMING', 20000);
  const fresh = h.scene();
  assert(fresh.factory.projectiles.length === 0, `restart leaked ${fresh.factory.projectiles.length} projectiles`);
  assert(fresh.factory.birdSkins.length === 0, 'restart leaked skins');
  assert(fresh.factory.blocks.length > 0, 'restart should rebuild the question');
});

await test('pause/resume mid-flight: no duplicates, shot still resolves', async () => {
  const s = h.scene();
  assert(h.fire(12, -6), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  const count = s.factory.projectiles.filter((p) => !p.wb.consumed).length;
  s.doPause();
  await new Promise((r) => setTimeout(r, 120));
  s.togglePause(); // resume
  await h.waitFor(() => s.currentShot.resolvedHandled, 25000);
  await waitForRearm(h);
  const after = s.factory.projectiles.filter((p) => !p.wb.consumed).length;
  assert(count <= 1 && after <= 1, `projectile count changed across pause/resume: ${count} -> ${after}`);
});

await test('stale projectiles of an older shot can never answer', async () => {
  await h.gotoLevel(11); // fresh 4-shot budget, independent of level-10 runs
  await h.waitForState('AIMING');
  const s = h.scene();
  await fireMiss(h);
  await waitForRearm(h);
  const oldBall = s.factory.projectiles[0];
  assert(h.fire(-6, -5), 'launch refused');
  assert(s.factory.projectiles.filter((p) => !p.wb.consumed).length === 1, 'sweep at launch failed');
  assert(oldBall.wb.consumed, 'old projectile not consumed by the sweep');
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
  await waitForRearm(h);
});

await test('alignment: body centered on spawn point, legacy display size preserved', async () => {
  const s = h.scene();
  const go = s.factory.createProjectile('basic', 400, 300, 999);
  assert(Math.abs(go.x - 400) < 0.01 && Math.abs(go.y - 300) < 0.01, `sprite center ${go.x},${go.y} != spawn point`);
  assert(Math.abs(go.body.position.x - 400) < 0.01 && Math.abs(go.body.position.y - 300) < 0.01, 'body center off spawn');
  assert(Math.abs(go.displayWidth - 32) < 0.01 && Math.abs(go.displayHeight - 32) < 0.01,
    `fallback display size ${go.displayWidth}x${go.displayHeight} != 32 (radius 16 x 2)`);
  const v0 = go.body.vertices[0];
  const r = Math.hypot(v0.x - go.body.position.x, v0.y - go.body.position.y);
  assert(Math.abs(r - 16) < 0.05, `collider radius ${r} != 16`);
  s.factory.remove(go);
});

await test('slingshot: off-center grab does not jump the bird (grab-offset fix)', async () => {
  const s = h.scene();
  const a = s.slingshot.anchor;
  const p = s.slingshot.preview;
  assert(p, 'no preview to grab');
  assert(Math.hypot(p.x - a.x, p.y - a.y) < 0.01, 'preview not at anchor before grab');
  // press 48px away (inside GRAB_RADIUS 72) and move only 6px — the bird
  // must stay within a few px of the anchor, not teleport to the pointer
  s.slingshot.onPointerDown({ worldX: a.x + 34, worldY: a.y + 34 });
  assert(s.slingshot.isDragging(), 'drag did not start');
  s.slingshot.onPointerMove({ worldX: a.x + 38, worldY: a.y + 38 });
  const jump = Math.hypot(p.x - a.x, p.y - a.y);
  assert(jump < 12, `off-center grab jumped the bird ${jump.toFixed(1)}px`);
  // a real pull still reaches the full drag clamp from the anchor
  s.slingshot.onPointerMove({ worldX: a.x - 130, worldY: a.y + 40 });
  const dLen = Math.hypot(p.x - a.x, p.y - a.y);
  assert(Math.abs(dLen - SLINGSHOT.MAX_DRAG) < 3, `pull length ${dLen.toFixed(1)} not at MAX_DRAG`);
  s.slingshot.onPointerUp();
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  await h.waitFor(() => s.currentShot.resolvedHandled || s.currentShot.answered, 20000);
  await waitForRearm(h);
});

await test('cleanup idempotency: double despawn / double sweep never throws', async () => {
  await h.gotoLevel(2); // fresh shot budget
  await h.waitForState('AIMING');
  const s = h.scene();
  await fireMiss(h);
  await waitForRearm(h);
  const f = s.factory;
  f.despawnShotVisuals(s.currentShot.id);
  f.despawnShotVisuals(s.currentShot.id); // second call must be a no-op
  f.despawnVisual(f.projectiles[0]);
  f.despawnVisual(f.projectiles[0]);
  f.sweepProjectiles();
  f.sweepProjectiles();
  // removals are queued and drain on the next factory update — every entry
  // must be consumed immediately, the array empty shortly after
  assert(f.projectiles.every((p) => p.wb.consumed), 'sweep did not consume every projectile');
  const drained = await h.waitFor(() => f.projectiles.length === 0, 3000);
  assert(drained, 'sweep left projectiles behind');
});

await test('full level: four questions complete with no projectile accumulation', async () => {
  await h.gotoLevel(1);
  await h.waitForState('AIMING');
  const s = h.scene();
  const guard = { shots: 0 };
  const t0 = Date.now();
  while (h.state() !== 'LEVEL_COMPLETE' && guard.shots < 30) {
    await h.waitFor(() => h.state() === 'AIMING' || h.state() === 'LEVEL_COMPLETE' || h.state() === 'LEVEL_FAILED', 25000);
    if (h.state() === 'LEVEL_FAILED') throw new Error('out of shots');
    if (h.state() === 'LEVEL_COMPLETE') break;
    // mid-question invariant: at most the resting body of the CURRENT shot
    const live = s.factory.projectiles.filter((x) => !x.wb.consumed);
    assert(live.every((x) => x.wb.shotId === s.currentShot.id), 'bodies from older shots accumulated');
    const sol = s.debugAutoAim();
    if (!sol) throw new Error('autoAim found no solution');
    guard.shots++;
    await h.waitFor(() => h.state() !== 'PROJECTILE_FLYING', 25000);
  }
  await h.waitFor(() => h.state() === 'LEVEL_COMPLETE', 25000);
  // the final sweep is queued in levelComplete and drains on the next
  // factory update — poll briefly instead of asserting synchronously
  const drained = await h.waitFor(() => s.factory.projectiles.length === 0, 3000);
  assert(drained, `level ended with ${s.factory.projectiles.length} projectiles`);
  console.log(`      (completed in ${Date.now() - t0}ms, ${guard.shots} shots)`);
});

await h.destroy();

console.log(`\n== bird lifecycle suite: ${passed} passed, ${failed} failed ==`);
if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f.name}: ${f.error.message}`);
  process.exit(1);
}
process.exit(0);
