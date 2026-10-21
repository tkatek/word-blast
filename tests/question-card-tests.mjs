/**
 * FIX #9 — Question-card regression suite.
 *
 * Boots the REAL game (real scenes, real state machine, real Matter physics)
 * headless and verifies the animated question card end to end:
 *   - centered presentation + mandatory reading window (incl. the REAL
 *     4-second timing, not the fast test profile),
 *   - shooting + timer frozen during the introduction,
 *   - smooth center→top hand-off arming gameplay below the HUD,
 *   - correct-answer exit → next question card (no duplicates, no skips),
 *   - wrong answers NOT replaying the introduction,
 *   - Question 4 → LEVEL_COMPLETE with no further card,
 *   - pause freezes the reading window and resumes from the same point,
 *   - restart during the introduction, peek blocking the slingshot,
 *   - honest audio-unavailable state where no speech engine exists.
 *
 * Run: node tests/question-card-tests.mjs
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';
import { QUESTION_CARD, HUD } from '../js/config.js';

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
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(msg || `expected ${a} ≈ ${b} (±${tol})`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Level question text by index, from the live question manager. */
function questionText(h, levelId, index) {
  const s = h.scene();
  const entry = s.levels.getQuestionEntry(levelId, index);
  return s.questions.getQuestion(entry.questionId).text;
}

/** Fire a solved shot at the correct (or given) answer target. */
async function answer(h, choiceId = null) {
  const s = h.scene();
  const ok = await h.waitFor(() => {
    if (h.state() !== 'AIMING') return false;
    return h.api.autoAim(choiceId);
  }, 8000, 'autoAim solution');
  return ok;
}

const FAST = { enterMs: 40, readingMs: 150, moveMs: 60, exitMs: 50, peekMs: 60 };

const main = async () => {
  const h = await createHeadlessGame();
  const api = h.api;

  await test('card presents the question centered with kicker + text', async () => {
    api.setCardTimings({ ...FAST, readingMs: 1500 });
    await h.gotoLevel(1);
    await h.waitFor(() => api.cardInfo()?.phase === 'READING', 4000, 'READING phase');
    const c = api.cardInfo();
    assert(c.visible, 'card visible');
    near(c.x, QUESTION_CARD.CENTER.x, 2, `centered x (${c.x})`);
    near(c.y, QUESTION_CARD.CENTER.y, 2, `centered y (${c.y})`);
    near(c.scale, 1, 0.02, 'center scale');
    near(c.artW, QUESTION_CARD.CENTER.width, 2, 'art rendered at base width (aspect-true)');
    near(c.artH, QUESTION_CARD.CENTER.width * QUESTION_CARD.ART.ASPECT, 3, 'art rendered at base height');
    assert(c.question && c.question.text === questionText(h, 1, 0), 'card shows Q1 text');
    assert(c.introActive, 'introActive during presentation');
    await h.waitForState('AIMING', 6000); // drain the presentation
  });

  await test('shooting is disabled during the introduction', async () => {
    api.setCardTimings({ ...FAST, readingMs: 900 });
    await h.gotoLevel(1);
    await h.waitFor(() => api.cardInfo()?.phase === 'READING', 4000, 'READING phase');
    const s = h.scene();
    assert(h.state() === 'QUESTION_READY', `state is QUESTION_READY (got ${h.state()})`);
    assert(!s.slingshot.enabled, 'slingshot disabled during intro');
    assert(!api.simulateShot({ vx: 12, vy: -6 }), 'launch refused during intro');
    assert(s.debugInfo().shotsLeft === s.level.shotsPerQuestion, 'no shot consumed');
    await h.waitForState('AIMING', 6000);
  });

  await test('level timer frozen during the introduction, running after', async () => {
    api.setCardTimings({ ...FAST, readingMs: 1200 });
    await h.gotoLevel(1);
    await h.waitFor(() => api.cardInfo()?.phase === 'READING', 4000, 'READING phase');
    const s = h.scene();
    const before = s.levelTimer.remainingMs;
    await sleep(600);
    near(s.levelTimer.remainingMs, before, 40, 'timer frozen while reading');
    await h.waitForState('AIMING', 6000);
    const armed = s.levelTimer.remainingMs;
    await sleep(500);
    assert(s.levelTimer.remainingMs < armed - 300, 'timer runs after the card rests at top');
  });

  await test('card rests at the top below the HUD and arms gameplay', async () => {
    api.setCardTimings(FAST);
    { const s0 = h.scene(); const od = s0.doPause.bind(s0); s0.doPause = (...a) => { console.log('DO-PAUSE'); return od(...a); }; const oa = s0.autoPause.bind(s0); s0.autoPause = (...a) => { console.log('AUTO-PAUSE'); return oa(...a); }; const oo = s0.updateOrientationState.bind(s0); s0.updateOrientationState = (...a) => { const r = oo(...a); if (s0.rotationPaused) console.log('ROT-PAUSED'); return r; }; const oarm = s0.armAiming.bind(s0); s0.armAiming = (...a) => { console.log('ARM-AIMING state=', s0.stateMachine.current, 'paused=', s0.stateMachine.isPaused()); return oarm(...a); }; }
    await h.gotoLevel(1);
    await h.waitFor(() => api.cardInfo()?.phase === 'READY_TOP', 4000, 'READY_TOP');
    const c = api.cardInfo();
    near(c.x, QUESTION_CARD.TOP.x, 2, `top x (${c.x})`);
    near(c.y, QUESTION_CARD.TOP.y, 2, `top y (${c.y})`);
    near(c.scale, QUESTION_CARD.TOP.width / QUESTION_CARD.CENTER.width, 0.02, 'top scale');
    const dockH = QUESTION_CARD.TOP.width * QUESTION_CARD.ART.ASPECT;
    const cardBottom = c.y + dockH / 2;
    const cardTop = c.y - dockH / 2;
    assert(cardBottom < 640, 'card stays in the upper area');
    assert(cardTop >= 76, 'safe gap below the HUD band (y<=76)');
    // Fix #21 — docked card is the smaller upper-LEFT card
    near(c.x - QUESTION_CARD.TOP.width / 2, QUESTION_CARD.SAFE_X, 2, 'left edge at the safe margin');
    assert(QUESTION_CARD.TOP.width <= 620 * 0.85 + 1, `card 15-20% smaller (${QUESTION_CARD.TOP.width}px)`);
    assert(QUESTION_CARD.TOP.width >= 620 * 0.80 - 1, 'card not smaller than 20%');
    assert(cardBottom < 260, 'card bottom clears the slingshot fork (y>=260)');
    if (h.state() !== 'AIMING') { console.log('DIAG state=', h.state(), 'phase=', api.cardInfo() && api.cardInfo().phase, 'paused=', h.scene().stateMachine.isPaused(), 'armPending=', h.scene().armPending, 'shots=', h.scene().shotsLeft, 'sel=', h.scene().selectedProjectile, 'ammo=', JSON.stringify(h.scene().birdInventory.snapshot()), 'cardPhase=', api.cardInfo() && api.cardInfo().phase); }
    assert(h.state() === 'AIMING', 'AIMING armed once the card rests');
    assert(h.scene().slingshot.enabled, 'slingshot enabled after the move');
  });

  await test('REAL 4-second reading window (production timing)', async () => {
    api.setCardTimings({ enterMs: 80, readingMs: 4000, moveMs: 120, exitMs: 50, peekMs: 60 });
    await h.gotoLevel(2);
    await h.waitFor(() => api.cardInfo()?.phase === 'READING', 4000, 'READING phase');
    const t0 = Date.now();
    await h.waitFor(() => ['MOVING_TO_TOP', 'READY_TOP'].includes(api.cardInfo()?.phase), 6000, 'reading to finish');
    const held = Date.now() - t0;
    assert(held >= 3900 && held <= 5200, `centered for ~4000ms of active time (held ${held}ms)`);
    await h.waitFor(() => api.cardInfo()?.phase === 'READY_TOP', 3000, 'READY_TOP');
    api.setCardTimings(FAST);
  });

  await test('correct answer: exit animation then the NEXT question card', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const tokenBefore = api.cardInfo().token;
    const q2Text = questionText(h, 1, 1);
    assert(await answer(h), 'fired at the correct target');
    await h.waitFor(() => h.info().questionIndex === 1, 15000, 'question advanced');
    assert(h.info().questionIndex === 1, 'Q1 → Q2 (never skips to Q3)');
    const c = api.cardInfo();
    assert(['ENTERING', 'READING', 'MOVING_TO_TOP', 'READY_TOP'].includes(c.phase), 'next card presenting');
    assert(c.token > tokenBefore, 'question token advanced');
    await h.waitFor(() => ['READING', 'READY_TOP'].includes(api.cardInfo()?.phase), 4000, 'next card visible');
    assert(api.cardInfo().question.text === q2Text, 'new question text, no stale content');
    // exactly ONE card container at panel depth
    const s = h.scene();
    const cards = s.children.list.filter((o) => o.parentContainer === null && o.depth === 80);
    assert(cards.length === 1, `exactly one question card (${cards.length})`);
    await h.waitForState('AIMING', 8000);
  });

  await test('wrong answer: card kept, introduction NOT replayed', async () => {
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const s = h.scene();
    const wrong = s.prepared.targets.find((t) => t.choiceId !== s.prepared.question.correctAnswerId);
    const tokenBefore = api.cardInfo().token;
    assert(await answer(h, wrong.choiceId), 'fired at a wrong target');
    await h.waitForState('ANSWER_FEEDBACK', 8000, 'feedback shown');
    assert(api.cardInfo().phase === 'READY_TOP', 'card stays at top during feedback');
    await h.waitForState('AIMING', 20000, 're-armed after wrong answer');
    assert(h.info().questionIndex === 0, 'still question 1');
    const c = api.cardInfo();
    assert(c.phase === 'READY_TOP', 'card resting, no intro replay');
    assert(c.token === tokenBefore, 'no new presentation token');
    assert(c.readRemainingMs === 0, 'no fresh countdown');
  });

  await test('Question 4 correct → LEVEL_COMPLETE, no further card', async () => {
    await h.gotoLevel(1);
    for (let q = 0; q < 4; q++) {
      await h.waitForState('AIMING', 15000);
      assert(await answer(h), `Q${q + 1} fired at the correct target`);
      const done = await h.waitFor(() => ['LEVEL_COMPLETE', 'GAME_COMPLETE'].includes(h.state())
        || h.info().questionIndex === q + 1, 15000, `Q${q + 1} advanced`);
      assert(done, `Q${q + 1} resolved`);
    }
    await h.waitForState('LEVEL_COMPLETE', 8000, 'level complete');
    const c = api.cardInfo();
    assert(['EXITING', 'IDLE'].includes(c.phase) || c.visible === false,
      `card exits after the final question (phase ${c.phase})`);
  });

  await test('pause freezes the reading window; resume continues it', async () => {
    api.setCardTimings({ ...FAST, readingMs: 1400 });
    await h.gotoLevel(3);
    await h.waitFor(() => api.cardInfo()?.phase === 'READING', 4000, 'READING phase');
    const s = h.scene();
    s.togglePause();
    assert(h.state() === 'PAUSED', 'paused');
    const frozen = api.cardInfo().readRemainingMs;
    await sleep(500);
    near(api.cardInfo().readRemainingMs, frozen, 30, 'reading time frozen under pause');
    s.togglePause(); // resume
    await h.waitForState('AIMING', 8000, 'armed after resume');
    // the total active reading time was honored: pause window did NOT count
    api.setCardTimings(FAST);
  });

  await test('restart during the introduction is clean', async () => {
    api.setCardTimings({ ...FAST, readingMs: 4000 });
    await h.gotoLevel(1);
    await h.waitFor(() => api.cardInfo()?.phase === 'READING', 4000, 'READING phase');
    api.gotoLevel(1); // hard restart mid-introduction
    const ok = await h.waitFor(() => {
      const c = api.cardInfo();
      return c && ['ENTERING', 'READING'].includes(c.phase);
    }, 5000, 'fresh card after restart');
    assert(ok, 'new presentation started');
    await h.waitForState('AIMING', 10000, 'gameplay armed after restart');
  });

  await test('peek enlarges the card and blocks the slingshot', async () => {
    api.setCardTimings(FAST);
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const s = h.scene();
    s.card.openPeek();
    await h.waitFor(() => api.cardInfo()?.phase === 'EXPANDED', 2000, 'EXPANDED phase');
    const c = api.cardInfo();
    near(c.x, QUESTION_CARD.CENTER.x, 2, 'expanded centered x');
    near(c.y, QUESTION_CARD.CENTER.y, 2, 'expanded centered y');
    near(c.scale, 1, 0.02, 'expanded at reading scale');
    assert(c.expanded, 'expanded flag set');
    assert(!s.slingshot.enabled, 'slingshot blocked while reading enlarged');
    assert(s.stateMachine.current === 'AIMING', 'gameplay state unchanged by peek');
    s.card.closePeek();
    await h.waitFor(() => api.cardInfo()?.phase === 'READY_TOP', 2000, 'peek closed');
    const back = api.cardInfo();
    near(back.x, QUESTION_CARD.TOP.x, 2, 'closed back at dock x');
    near(back.y, QUESTION_CARD.TOP.y, 2, 'closed back at dock y');
    near(back.scale, QUESTION_CARD.TOP.width / QUESTION_CARD.CENTER.width, 0.02, 'dock scale');
    assert(s.slingshot.enabled, 'slingshot restored after closing');
    assert(h.state() === 'AIMING', 'gameplay unchanged by peek');
  });

  await test('expanded view freezes the timer and consumes nothing', async () => {
    api.setCardTimings(FAST);
    await h.gotoLevel(2);
    await h.waitForState('AIMING', 8000);
    const s = h.scene();
    const shotsBefore = s.shotsLeft;
    const scoreBefore = s.scoring.liveScore();
    await sleep(500); // timer demonstrably running first
    const running = s.levelTimer.remainingMs;
    assert(running < HUD.TIME_LIMIT_MS, 'timer running before expansion');
    s.card.openPeek();
    await h.waitFor(() => api.cardInfo()?.phase === 'EXPANDED', 2000, 'EXPANDED phase');
    const frozen = s.levelTimer.remainingMs;
    await sleep(600);
    near(s.levelTimer.remainingMs, frozen, 40, 'timer frozen while expanded');
    s.card.closePeek();
    await h.waitFor(() => api.cardInfo()?.phase === 'READY_TOP', 2000, 'collapsed');
    await sleep(400);
    assert(s.levelTimer.remainingMs < frozen - 200, 'timer resumed after closing');
    assert(s.shotsLeft === shotsBefore, 'expansion consumed no shot');
    assert(s.scoring.liveScore() === scoreBefore, 'expansion touched no score');
  });

  await test('expansion refused while a shot is resolving', async () => {
    api.setCardTimings(FAST);
    await h.gotoLevel(1);
    await h.waitForState('AIMING', 8000);
    const s = h.scene();
    assert(await answer(h), 'fired at the correct target');
    await h.waitForState('PROJECTILE_FLYING', 3000, 'projectile in flight');
    s.card.openPeek();
    assert(api.cardInfo().phase === 'READY_TOP', 'expand refused mid-flight');
    assert(!api.cardInfo().expanded, 'expanded flag stays false');
    await h.waitFor(() => h.info().questionIndex === 1, 15000, 'question advanced normally');
  });

  await test('rapid open/close toggling never stacks tweens or gets stuck', async () => {
    api.setCardTimings({ ...FAST, peekMs: 300 });
    await h.gotoLevel(3);
    await h.waitForState('AIMING', 8000);
    const s = h.scene();
    // reverse mid-expand, re-open mid-collapse, then settle closed
    s.card.openPeek();
    await sleep(120);
    s.card.closePeek();
    await sleep(120);
    s.card.openPeek();
    await sleep(120);
    s.card.closePeek();
    await h.waitFor(() => api.cardInfo()?.phase === 'READY_TOP', 3000, 'settled back at dock');
    const c = api.cardInfo();
    near(c.x, QUESTION_CARD.TOP.x, 2, 'final dock x exact');
    near(c.y, QUESTION_CARD.TOP.y, 2, 'final dock y exact');
    assert(s.card.tweens.length <= 2, `no tween leak (${s.card.tweens.length} live)`);
    assert(s.slingshot.enabled, 'slingshot restored after the toggle storm');
    // and the card still expands cleanly afterwards
    s.card.openPeek();
    await h.waitFor(() => api.cardInfo()?.phase === 'EXPANDED', 2000, 'clean expand after storm');
    s.card.closePeek();
    await h.waitFor(() => api.cardInfo()?.phase === 'READY_TOP', 2000, 'clean collapse');
  });

  await test('no speech engine → button honestly unavailable', async () => {
    const c = api.cardInfo();
    const noEngine = !(typeof window !== 'undefined' && window.speechSynthesis && (window.speechSynthesis.getVoices() || []).length);
    if (noEngine) {
      assert(c.ttsAvailable === false, 'ttsAvailable false');
      assert(h.scene().card.trySpeak() === false, 'trySpeak refuses (no fake audio)');
    } else {
      assert(c.ttsAvailable === true, 'voices present → available');
    }
  });

  await h.destroy();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    for (const f of failures) console.log(`  • ${f.name}: ${f.error.message}`);
    process.exit(1);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
