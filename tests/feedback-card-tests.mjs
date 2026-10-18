/**
 * FEEDBACK CARD regression suite — the wooden parchment answer-feedback
 * card (correct / wrong) that replaced the old dark-blue rectangle.
 *
 * Verifies against the REAL game (headless, real physics, real data):
 *   - correct answer → green theme, real answer line + explanation, CONTINUE
 *   - wrong answer   → red theme, TRY AGAIN, existing disclosure rules
 *   - the action button is DISABLED until the physics settle watcher arms it
 *   - double-clicking CONTINUE cannot skip questions (one transition max)
 *   - Q1→Q2→Q3→Q4 progression and Q4 → LEVEL_COMPLETE (never Q5)
 *   - duplicate collision events never duplicate the card
 *   - restarting during feedback cancels cleanly (no stuck state)
 *   - all 60 questions' explanations fit the card (measured, no truncation)
 *
 * Run: npm run test:feedback
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ok  ${name}`); })
    .catch((e) => { failed++; failures.push({ name, error: e }); console.log(`FAIL  ${name}\n      ${e.message}`); });
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Answer via the real slingshot path and wait for the card to appear. */
async function answer(h, choiceId = null) {
  const s = h.scene();
  const ok = s.debugAutoAim(choiceId);
  assert(ok, 'autoAim found no solution');
  const shown = await h.waitFor(() => {
    const i = h.api.feedbackInfo();
    return !!(i && i.visible);
  }, 15000);
  assert(shown, `feedback card never appeared (state=${h.state()})`);
  return h.api.feedbackInfo();
}

/** Wait until the settle watcher arms the button (MIN_VISIBLE + settle). */
async function waitArmed(h, timeout = 8000) {
  return h.waitFor(() => {
    const i = h.api.feedbackInfo();
    return !!(i && i.actionEnabled);
  }, timeout);
}

const h = await createHeadlessGame();
h.autoFeedback = false; // manual control: these tests ARE the player

await test('wrong answer: red card, real answer data, TRY AGAIN, disabled until armed', async () => {
  await h.gotoLevel(3);
  await h.waitForState('AIMING');
  const s = h.scene();
  const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId);
  const info = await answer(h, wrong.wb.choiceId);
  eq(info.kind, 'wrong', 'wrong answer must use the red theme');
  eq(h.state(), 'ANSWER_FEEDBACK', 'state must be ANSWER_FEEDBACK while the card shows');
  assert(!info.actionEnabled, 'button must start disabled (physics still resolving)');
  assert(s.feedbackCard.title.text.includes('WRONG'), 'wrong title missing');
  assert(s.feedbackCard.button.labelText.text === 'TRY AGAIN', 'wrong button must be TRY AGAIN');
  // disclosure rule preserved: the card shows the REAL correct answer data
  const correct = s.prepared.targets.find((t) => t.choiceId === s.prepared.question.correctAnswerId);
  assert(s.feedbackCard.answerText.text.includes(correct.label), 'answer line must carry the real choice letter');
  assert(s.feedbackCard.answerText.text.includes(correct.text), 'answer line must carry the real choice text');
  assert(s.feedbackCard.explainText.text.length > 0, 'explanation must come from question data');
  assert(await waitArmed(h), 'settle watcher must arm the button');
});

await test('TRY AGAIN follows the existing retry rules (re-arms, no free ammo, no advance)', async () => {
  const s = h.scene();
  const shotsBefore = s.shotsLeft;
  const qBefore = s.questionIndex;
  const ammoBefore = JSON.stringify(s.birdInventory.snapshot());
  h.feedbackContinue();
  const rearm = await h.waitForState('AIMING', 10000);
  assert(rearm, 'TRY AGAIN must return to AIMING');
  eq(s.questionIndex, qBefore, 'wrong answer must NOT advance the question');
  eq(s.shotsLeft, shotsBefore, 'TRY AGAIN must not grant or remove shots');
  eq(JSON.stringify(s.birdInventory.snapshot()), ammoBefore, 'TRY AGAIN must not grant ammunition');
});

await test('correct answer: green card, CONTINUE advances exactly once', async () => {
  const s = h.scene();
  const qBefore = s.questionIndex;
  const info = await answer(h); // correct target
  eq(info.kind, 'correct', 'correct answer must use the green theme');
  assert(s.feedbackCard.title.text.includes('CORRECT'), 'correct title missing');
  assert(s.feedbackCard.button.labelText.text === 'CONTINUE', 'correct button must be CONTINUE');
  assert(await waitArmed(h), 'button must arm after settle');
  // double-click: the second act() must be a no-op
  h.feedbackContinue();
  h.feedbackContinue();
  h.feedbackContinue();
  const advanced = await h.waitFor(() => s.questionIndex === qBefore + 1, 15000);
  assert(advanced, 'CONTINUE must advance to the next question');
  await sleep(1200); // any stale transition would land here
  eq(s.questionIndex, qBefore + 1, 'repeated CONTINUE clicks must not skip a question');
});

await test('duplicate collision events never duplicate the card', async () => {
  await h.gotoLevel(2);
  await h.waitForState('AIMING');
  const s = h.scene();
  await answer(h);
  const token = s.feedbackCard.token;
  // a repeated show() for the same question token must be ignored
  const accepted = s.feedbackCard.show({
    token, kind: 'correct', answerLine: 'dup', explanation: 'dup',
    onAction: () => {}
  });
  eq(accepted, false, 'duplicate show() must be refused');
  assert(s.feedbackCard.answerText.text !== 'dup', 'duplicate content must not replace the real card');
});

await test('Q4 CONTINUE opens LEVEL_COMPLETE (never Question 5)', async () => {
  h.autoFeedback = true; // play through quickly
  await h.gotoLevel(4);
  await h.waitForState('AIMING');
  for (let q = 0; q < 3; q++) {
    await answer(h);
    await h.waitFor(() => h.state() === 'AIMING', 20000);
    await h.waitForState('AIMING', 8000);
  }
  // 4th correct answer → card → CONTINUE → LEVEL_COMPLETE
  await answer(h);
  const done = await h.waitForState('LEVEL_COMPLETE', 20000);
  assert(done, `Q4 CONTINUE must complete the level (state=${h.state()})`);
  eq(h.scene().questionIndex, 3, 'level must end on question 4 (index 3)');
  h.autoFeedback = false;
});

await test('restart during feedback cancels the card without side effects', async () => {
  await h.gotoLevel(5);
  await h.waitForState('AIMING');
  const s = h.scene();
  await answer(h); // card on screen (maybe not yet armed)
  s.restartQuestionFromMenu(); // the pause-menu "Restart Question" path
  const ok = await h.waitFor(() => {
    const i = h.api.feedbackInfo();
    return !i || !i.visible;
  }, 6000);
  assert(ok, 'restart must cancel the visible feedback card');
  await h.waitForState('QUESTION_READY', 10000);
  const armed = await h.waitFor(() => {
    const i = h.api.feedbackInfo();
    return !i || !i.actionEnabled;
  }, 3000);
  assert(armed, 'a cancelled card must never arm or fire its action');
  eq(s.questionIndex, 0, 'restart reloads the same question');
});

await test('all 60 questions: explanation fits the card at a readable size', async () => {
  const s = h.scene();
  await h.waitForState('AIMING', 15000);
  const questions = h.game.registry.get('questions');
  const levels = h.game.registry.get('levels');
  let worst = null;
  let count = 0;
  for (let levelId = 1; levelId <= 15; levelId++) {
    const level = levels.getLevel(levelId);
    for (let qi = 0; qi < level.questions.length; qi++) {
      const entry = levels.getQuestionEntry(levelId, qi);
      const question = questions.getQuestion(entry.questionId);
      const prepared = questions.prepare(question);
      const correct = prepared.targets.find((t) => t.choiceId === prepared.question.correctAnswerId);
      const answerLine = `Correct answer: ${correct.label} — “${correct.text}”`;
      for (const kind of ['correct', 'wrong']) {
        s.feedbackCard.show({
          token: 1000 + count, kind,
          answerLine, explanation: question.explanation,
          hint: kind === 'correct' ? '+100 points!' : 'Nice try! Aim carefully and take another shot.',
          buttonText: 'CONTINUE', onAction: () => {}
        });
        const fit = s.feedbackCard.fit;
        count++;
        assert(fit && fit.displayFont >= 13.9,
          `L${levelId}Q${qi + 1} (${kind}): font floor broken (${fit && fit.displayFont}px)`);
        // the rendered block must stop above the button zone (top 124)
        const bottomLocal = (s.feedbackCard.explainText.y - 0)
          + s.feedbackCard.explainText.height;
        assert(bottomLocal <= 123,
          `L${levelId}Q${qi + 1} (${kind}): explanation overlaps the button (bottom ${Math.round(bottomLocal)})`);
        if (!worst || fit.displayFont < worst.font) worst = { font: fit.displayFont, levelId, qi };
      }
    }
  }
  eq(count, 120, 'expected 60 questions × 2 kinds');
  s.feedbackCard.cancel();
  console.log(`      smallest fitted display font across all 60 questions: ${worst.font}px (L${worst.levelId} Q${worst.qi + 1})`);
});

await h.destroy();

console.log('\n== feedback-card summary ==');
console.log(`${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}: ${f.error.message}`);
  process.exit(1);
}
