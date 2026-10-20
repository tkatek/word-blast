/**
 * PLAQUE SCALE TESTS — the answer-card size invariant (giant-card fix).
 *
 * An answer plaque must keep EXACTLY its configured display size for its
 * whole life: build, bird impact (correct OR wrong), the hit flash, tower
 * collapse around it, the retry after a wrong answer and the next question.
 *
 * Root cause these tests pin: the XL parchment renders at half its texture
 * size (600×194 canvas displayed at 300×97 → native scale 0.5, while S/M/L
 * sit at 1). The old hit flash tweened setScale(1 → 1.18 → 1) — ABSOLUTE
 * values — so one hit permanently doubled the XL card and its Matter body.
 *
 * Verified per scenario, for every plaque on screen:
 *   - sprite scale equals the base scale recorded at build (exact)
 *   - displayWidth/Height equal the panel format's size (± 0.5px)
 *   - Matter collider area unchanged from before the hit (± 0.01%)
 *   - the tint hit-flash still fires (feedback stays, scale stays out)
 *
 * Run: node tests/plaque-scale-tests.mjs
 */
import { installPhaserEnv } from './helpers/phaser-env.mjs';

installPhaserEnv();

const { register } = await import('node:module');
register(new URL('./helpers/json-loader.mjs', import.meta.url), import.meta.url);

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const dist = await import('phaser/dist/phaser.esm.js');
const Phaser = dist.default && dist.default.VERSION ? dist.default : dist;
const srcPath = require.resolve('phaser');
require.cache[srcPath] = { id: srcPath, filename: srcPath, loaded: true, exports: Phaser };

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const questionsData = JSON.parse(readFileSync(join(here, '../js/data/questions.json'), 'utf8'));
const levelsData = JSON.parse(readFileSync(join(here, '../js/data/levels.json'), 'utf8'));

let passed = 0, failed = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; failures.push(label); console.log(`FAIL  ${label}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Boot + locate one XL question and one compact (S) question           */
/* ------------------------------------------------------------------ */
const { createHeadlessGame } = await import('./helpers/headless-game.mjs');
const h = await createHeadlessGame();
h.autoFeedback = false; // the test IS the player: sample sizes, then click

const booted = await h.waitFor(() => h.game.scene.getScenes(true).length > 0, 8000, 'any scene');
if (!booted) throw new Error('no scene ever started');
const measureScene = h.game.scene.getScenes(true)[0];
const { planQuestion, formatByName } = await import('../js/systems/AnswerPanel.js');

const plans = new Map();
for (const q of questionsData) plans.set(q.id, planQuestion(measureScene, q.choices));

// (levelId, questionIndex, format) for every question of every level
const slots = [];
for (const lvl of levelsData.levels) {
  lvl.questions.forEach((qq, qi) => {
    slots.push({ levelId: lvl.id, qi, format: plans.get(qq.questionId).format });
  });
}
const xlSlots = slots.filter((s) => s.format === 'XL');
const compactSlot = slots.find((s) => s.format === 'S');
console.log(`XL questions available: ${xlSlots.map((s) => `L${s.levelId}Q${s.qi + 1}`).join(', ') || 'NONE'}`);
check(xlSlots.length > 0, 'game data contains XL (sentence) questions');
check(!!compactSlot, 'game data contains a compact (S) question');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Full size fingerprint of every live plaque (sprite + collider). */
function snapshot() {
  const s = h.scene();
  return s.factory.targets.map((t) => ({
    choiceId: t.wb.choiceId,
    baseX: t.wb.baseScaleX, baseY: t.wb.baseScaleY,
    scaleX: t.scaleX, scaleY: t.scaleY,
    w: t.displayWidth, hh: t.displayHeight,
    area: t.body ? t.body.area : null
  }));
}

/**
 * Assert every live plaque still sits at its configured size, and that the
 * collider never drifted either. `before` is a previous snapshot() of the
 * same question (matched by choiceId).
 */
function assertSizes(label, before = null, expectFormat = null) {
  const s = h.scene();
  const targets = s.factory.targets;
  check(targets.length === 3, `${label}: 3 plaques live`);
  for (const t of targets) {
    const f = formatByName(expectFormat || t.wb.format);
    const tag = `${label}: plaque ${t.wb.choiceId} (${t.wb.format})`;
    check(t.scaleX === t.wb.baseScaleX && t.scaleY === t.wb.baseScaleY,
      `${tag} scale ${t.scaleX.toFixed(3)}x${t.scaleY.toFixed(3)} == base ${t.wb.baseScaleX.toFixed(3)}x${t.wb.baseScaleY.toFixed(3)}`);
    check(Math.abs(t.displayWidth - f.size[0]) <= 0.5 && Math.abs(t.displayHeight - f.size[1]) <= 0.5,
      `${tag} display ${t.displayWidth.toFixed(1)}x${t.displayHeight.toFixed(1)} == format ${f.size[0]}x${f.size[1]}`);
    if (t.body && t.body.area) {
      check(Math.abs(t.body.area - f.size[0] * f.size[1]) / (f.size[0] * f.size[1]) < 0.01,
        `${tag} collider area ${t.body.area.toFixed(0)} == panel area ${f.size[0] * f.size[1]}`);
    }
    if (before) {
      const b = before.find((p) => p.choiceId === t.wb.choiceId);
      if (b && b.area && t.body) {
        check(Math.abs(t.body.area - b.area) / b.area < 1e-4,
          `${tag} collider area unchanged from before the hit (${b.area.toFixed(0)} → ${t.body.area.toFixed(0)})`);
      }
    }
  }
}

/** Wait until the world is still enough to deliver a projectile cleanly. */
async function waitQuiet() {
  await h.waitForState('AIMING', 15000);
  await h.waitFor(() => {
    const s = h.scene();
    return s.factory.blocksQuiet() && s.factory.targets.every((t) =>
      !t.body || Math.hypot(t.body.velocity.x, t.body.velocity.y) < 0.15);
  }, 8000, 'quiet world');
}

/** Fire a harmless real shot (lands on open grass left of everything). */
async function fireHarmlessShot() {
  const s = h.scene();
  const structLeft = Math.min(
    ...s.factory.targets.map((t) => t.x - 200),
    ...(s.factory.blocks.length ? s.factory.blocks.map((b) => b.x - b.displayWidth / 2) : [Infinity])
  );
  const wantX = Math.max(320, Math.min(500, structLeft - 120));
  const sol = h.solveLanding(wantX);
  const ok = h.fire(sol ? sol.vx : 6, sol ? sol.vy : -6);
  check(ok === true, 'real shot fired (real slingshot pipeline)');
  return h.liveBalls()[0];
}

/**
 * Deliver the shot's projectile onto a chosen plaque (the integration
 * suite's debris-equivalent Matter impulse: the REAL collision + validation
 * pipeline still runs — only the ball's coordinates are borrowed).
 */
async function deliverOnto(ball, getTarget) {
  const M = h.Phaser.Physics.Matter.Matter;
  await waitQuiet();
  const offsets = [8, -8, 0, 20, -20, 12, 4, -16];
  for (let tries = 0; tries < offsets.length; tries++) {
    const t = getTarget();
    if (!t || !t.body || !ball.body) return false;
    M.Sleeping.set(ball.body, false);
    M.Body.setPosition(ball.body, { x: t.x + offsets[tries], y: t.y - 30 });
    M.Body.setVelocity(ball.body, { x: 0, y: 1 });
    const landed = await h.waitFor(() => h.state() === 'ANSWER_FEEDBACK', 3500);
    if (landed) return true;
  }
  return false;
}

/** Boot a specific question and snapshot its plaques at rest. */
async function bootQuestion(levelId, qi) {
  const ok = await h.api.gotoQuestion(levelId, qi);
  check(ok, `L${levelId}Q${qi + 1}: gotoQuestion`);
  await waitQuiet();
  return snapshot();
}

/* ------------------------------------------------------------------ */
/* Scenario 1 — WRONG hit on an XL question (the reported bug)          */
/* ------------------------------------------------------------------ */
async function scenarioWrongHit(slot, label) {
  console.log(`--- ${label}: wrong hit keeps every card at its size ---`);
  const before = await bootQuestion(slot.levelId, slot.qi);
  assertSizes(`${label} build`, null, slot.format);

  const s = h.scene();
  const correctId = s.prepared.question.correctAnswerId;
  const wrong = s.factory.targets.find((t) => t.wb.choiceId !== correctId);
  const ball = await fireHarmlessShot();
  const delivered = await deliverOnto(ball, () => h.scene().factory.targets.find((t) => t === wrong) || wrong);
  check(delivered, `${label}: projectile delivered onto a WRONG plaque`);
  check(h.state() === 'ANSWER_FEEDBACK', `${label}: feedback card showing`);

  // The old bug ran its scale tween in the first 130 ms and left the card
  // doubled forever — sample inside that window AND long after it.
  await sleep(120);
  assertSizes(`${label} mid-flash (+120ms)`, before);
  const hit1 = h.scene().factory.targets.find((t) => t.wb.hit);
  check(hit1 && hit1.isTinted, `${label}: hit flash visible (tint, no scale)`);
  await sleep(600);
  assertSizes(`${label} post-flash (+720ms)`, before);
  // game-time runs slower than wall clock under headless load — poll for
  // the 420ms tint window to elapse rather than assuming it already did
  const cleared = await h.waitFor(() => {
    const hit2 = h.scene().factory.targets.find((t) => t.wb.hit);
    return !hit2 || !hit2.isTinted;
  }, 4000, 'hit flash clear');
  check(cleared, `${label}: hit flash cleared`);

  const hitWrong = hit1 && hit1.wb.choiceId !== correctId;
  if (hitWrong) {
    const armed = await h.waitFor(() => h.feedbackArmed(), 20000, 'feedback armed');
    check(armed, `${label}: feedback card armed`);
    h.feedbackContinue(); // TRY AGAIN — same question, plaque stays in world
    await waitQuiet();
    assertSizes(`${label} after TRY AGAIN retry`, before);
    return true;
  }
  // the delivery accidentally validated the correct plaque — follow the
  // CONTINUE path instead so the suite still progresses deterministically
  await h.waitFor(() => h.feedbackArmed(), 20000, 'feedback armed');
  h.feedbackContinue();
  await h.waitFor(() => h.info().questionIndex !== slot.qi || h.state() === 'LEVEL_COMPLETE', 12000);
  return false;
}

/* ------------------------------------------------------------------ */
/* Scenario 2 — CORRECT hit → CONTINUE → next question sized right      */
/* ------------------------------------------------------------------ */
async function scenarioCorrectHit(slot, label) {
  console.log(`--- ${label}: correct hit + question transition keep card sizes ---`);
  const before = await bootQuestion(slot.levelId, slot.qi);
  assertSizes(`${label} build`, null, slot.format);

  const ball = await fireHarmlessShot();
  const delivered = await deliverOnto(ball, () => h.correctTarget());
  check(delivered, `${label}: projectile delivered onto the CORRECT plaque`);
  await sleep(120); // inside the old tween's window
  assertSizes(`${label} mid-flash (+120ms)`, before);
  await sleep(600);
  assertSizes(`${label} post-flash (+720ms)`, before);

  // the button arms only after the settle watcher finishes — click like a
  // player would: wait for the armed card, then act
  const armed = await h.waitFor(() => h.feedbackArmed(), 20000, 'feedback armed');
  check(armed, `${label}: feedback card armed`);
  h.feedbackContinue(); // CONTINUE → NEXT_QUESTION → new plaques
  const advanced = await h.waitFor(() =>
    h.state() === 'LEVEL_COMPLETE' || (h.info().questionIndex === slot.qi + 1 && h.state() === 'AIMING'), 15000);
  check(advanced, `${label}: advanced past the feedback card`);
  if (h.state() !== 'LEVEL_COMPLETE') {
    await waitQuiet();
    const s = h.scene();
    const nextFormat = plans.get(s.prepared.question.id).format;
    assertSizes(`${label} next question (${nextFormat})`, null, nextFormat);
  }
}

/* ------------------------------------------------------------------ */
/* Scenario 3 — tower collapse onto/around the plaques                  */
/* ------------------------------------------------------------------ */
async function scenarioCollapse(slot, label) {
  console.log(`--- ${label}: tower collapse keeps card sizes ---`);
  const before = await bootQuestion(slot.levelId, slot.qi);
  assertSizes(`${label} build`, null, slot.format);

  // aim a real shot at the tower itself (the block cluster under/behind
  // the plaques) so the structure tumbles across them
  const s = h.scene();
  const towerBlocks = s.factory.blocks.filter((b) => !b.wb.removed);
  const aimX = towerBlocks.length
    ? towerBlocks.reduce((sum, b) => sum + b.x, 0) / towerBlocks.length
    : s.factory.targets[0].x;
  const sol = h.solveLanding(Math.round(aimX));
  const fired = h.fire(sol ? sol.vx : 12, sol ? sol.vy : -7);
  check(fired === true, `${label}: collapse shot fired`);

  // let the shot resolve: AIMING again, or an accidental plaque validation
  await h.waitFor(() =>
    h.state() === 'AIMING' || h.state() === 'ANSWER_FEEDBACK'
    || h.state() === 'LEVEL_FAILED' || h.state() === 'LEVEL_COMPLETE', 20000);
  await h.waitFor(() => h.scene().factory.blocksQuiet() || h.state() === 'ANSWER_FEEDBACK', 12000);
  assertSizes(`${label} after collapse`, before);
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */
const xl = xlSlots[Math.floor(xlSlots.length / 2)];       // a mid-game XL level
const xlEarly = xlSlots[0];
try {
  // 1. the reported bug: wrong hit on an XL plaque (+ retry path)
  let retriedSameQuestion = await scenarioWrongHit(xl, `L${xl.levelId}Q${xl.qi + 1} (XL)`);
  // 1b. if that delivery hit the correct plaque, redo the wrong-hit scenario
  //     on a different XL question so the TRY-AGAIN path is truly covered
  if (!retriedSameQuestion && xlEarly !== xl) {
    retriedSameQuestion = await scenarioWrongHit(xlEarly, `L${xlEarly.levelId}Q${xlEarly.qi + 1} (XL)`);
  }
  check(retriedSameQuestion, 'wrong-answer TRY AGAIN path exercised (plaque persisted in world)');

  // 2. correct hit → CONTINUE → next question transition
  await scenarioCorrectHit(xlEarly !== xl ? xlEarly : xl, 'XL correct');

  // 3. tower collapse around XL plaques
  await scenarioCollapse(xl, 'XL collapse');

  // 4. compact panels (native scale 1) must keep their size too
  if (compactSlot) {
    await scenarioWrongHit(compactSlot, `L${compactSlot.levelId}Q${compactSlot.qi + 1} (S)`);
    await scenarioCollapse(compactSlot, 'S collapse');
  }
} catch (e) {
  failed++;
  failures.push(`suite crashed: ${e.message}`);
  console.log('SUITE ERROR:', e);
} finally {
  await h.destroy();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('FAILURES:');
  failures.slice(0, 40).forEach((f2) => console.log('  -', f2));
  process.exit(1);
}
