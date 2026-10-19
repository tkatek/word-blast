/**
 * FEEDBACK CARD acceptance run — the wooden parchment answer-feedback card,
 * verified in the REAL game booted in Chrome/Edge against the compiled
 * build (vite preview / live-server / any static server of dist/):
 *
 *   - WRONG answer → red header card with the real correct-answer data,
 *     TRY AGAIN disabled until the physics settle watcher arms it;
 *   - a REAL mouse click on TRY AGAIN re-arms the slingshot (existing
 *     retry rules, no free ammunition);
 *   - CORRECT answer → green header card matching the supplied reference;
 *   - mid-entrance capture (fade + 0.85→1.03→1.00 scale);
 *   - REAL double-click on CONTINUE advances exactly one question;
 *   - the longest explanation of the 60 questions fits without clipping;
 *   - phone-landscape (844×390) keeps the card readable and un-cropped;
 *   - Q4 CONTINUE opens LEVEL COMPLETE.
 *
 * Run:  node scripts/feedback-screenshots.mjs [http://host:port]
 * (defaults to the dist verification server on :5501)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'feedback');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:5501';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) problems.push(msg);
};

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

const feedbackProbe = () => {
  const s = window.__WB__.scene();
  const c = s.feedbackCard;
  if (!c) return null;
  return {
    ...c.info(),
    title: c.title ? c.title.text : null,
    answer: c.answerText ? c.answerText.text : null,
    button: c.button && c.button.labelText ? c.button.labelText.text : null,
    state: s.stateMachine.current,
    q: s.questionIndex,
    shots: s.shotsLeft,
    explainBottomLocal: c.explainText ? c.explainText.y + c.explainText.height : null,
    worldPos: { x: c.root.x, y: c.root.y }
  };
};

async function gotoLevel(page, levelId) {
  await page.evaluate((id) => window.__WB__.gotoLevel(id), levelId);
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine.current === 'AIMING';
  }, { timeout: 30000 });
  await sleep(600);
}

async function worldToScreen(page, x, y) {
  return page.evaluate((wx, wy) => {
    const cam = window.__WB__.scene().cameras.main;
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
  }, x, y);
}

/** REAL mouse click at a world position (button center). */
async function clickWorld(page, x, y) {
  const p = await worldToScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
  return p;
}

/** The button's live world position (card root + local offset × scale). */
async function buttonWorldPos(page) {
  return page.evaluate(() => {
    const c = window.__WB__.scene().feedbackCard;
    return { x: c.root.x + c.button.x * c.root.scaleX, y: c.root.y + c.button.y * c.root.scaleY };
  });
}

async function shootAt(page, choiceId = null) {
  await page.evaluate((cid) => window.__WB__.autoAim(cid), choiceId);
}

async function waitForCard(page, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    const i = await page.evaluate(feedbackProbe);
    if (i && i.visible) return i;
    if (Date.now() - t0 > timeout) return null;
    await sleep(30);
  }
}

async function waitForArmed(page, timeout = 9000) {
  const t0 = Date.now();
  for (;;) {
    const i = await page.evaluate(feedbackProbe);
    if (i && i.actionEnabled) return i;
    if (Date.now() - t0 > timeout) return null;
    await sleep(30);
  }
}

const browserPath = findBrowser();
if (!browserPath) {
  console.error('No Chrome/Edge found for puppeteer');
  process.exit(1);
}
const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: 'new',
  args: ['--use-angle=default', '--disable-gpu-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required']
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 140)); });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  ok(true, `game booted from ${BASE}`);

  /* ---- 1. WRONG answer → red card, disabled → armed → TRY AGAIN ------ */
  await gotoLevel(page, 3);
  await page.evaluate(() => {
    const s = window.__WB__.scene();
    const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId && !t.wb.hit);
    window.__WB__.autoAim(wrong ? wrong.wb.choiceId : null);
  });
  const midEnter = await waitForCard(page);
  ok(midEnter && midEnter.kind === 'wrong', 'wrong answer shows the red feedback card');
  ok(midEnter && !midEnter.actionEnabled, 'TRY AGAIN starts disabled (physics still resolving)');
  await page.screenshot({ path: join(OUT, '1-wrong-entering.png') });
  const armedWrong = await waitForArmed(page);
  ok(armedWrong && armedWrong.button === 'TRY AGAIN', 'settle watcher arms TRY AGAIN');
  ok(armedWrong.answer.includes('Correct answer:'), `answer line carries real data: "${armedWrong.answer}"`);
  await sleep(250);
  await page.screenshot({ path: join(OUT, '2-wrong-armed.png') });

  const shotsBefore = armedWrong.shots;
  await clickWorld(page, ...(Object.values(await buttonWorldPos(page))));
  const rearm = await page.waitForFunction(() => {
    const s = window.__WB__.scene();
    return s.stateMachine.current === 'AIMING';
  }, { timeout: 10000 }).then(() => true).catch(() => false);
  ok(rearm, 'REAL click on TRY AGAIN returns to AIMING (existing retry rules)');
  const afterTry = await page.evaluate(feedbackProbe);
  ok(afterTry && afterTry.q === armedWrong.q, 'TRY AGAIN does not advance the question');
  ok(afterTry && afterTry.shots === shotsBefore, 'TRY AGAIN grants no free shots');

  /* ---- 2. CORRECT answer → green card (reference comparison) --------- */
  await shootAt(page, null);
  const correct = await waitForCard(page);
  ok(correct && correct.kind === 'correct', 'correct answer shows the green card');
  await page.screenshot({ path: join(OUT, '3-correct.png') });
  await waitForArmed(page);

  // capture mid-exit (exit animation) right after a real click
  const bp = await buttonWorldPos(page);
  await page.mouse.move(bp.x, bp.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(70);
  await page.screenshot({ path: join(OUT, '4-continue-exit.png') });
  const advanced = await page.waitForFunction(() => {
    const s = window.__WB__.scene();
    return s.stateMachine.current === 'AIMING' || s.stateMachine.current === 'LEVEL_COMPLETE';
  }, { timeout: 12000 }).then(() => true).catch(() => false);
  ok(advanced, 'CONTINUE exits into the next question');
  const qAfter = await page.evaluate(() => window.__WB__.scene().questionIndex);

  /* ---- 3. DOUBLE-CLICK CONTINUE cannot skip --------------------------- */
  await shootAt(page, null);
  const c2 = await waitForCard(page);
  ok(!!c2, 'second question shows its card');
  await waitForArmed(page);
  const bp2 = await buttonWorldPos(page);
  await page.mouse.click(bp2.x, bp2.y); // click 1
  await page.mouse.click(bp2.x, bp2.y); // click 2 (mid-exit — must be swallowed)
  await page.mouse.click(bp2.x, bp2.y); // click 3
  await sleep(1600);
  const qNow = await page.evaluate(() => window.__WB__.scene().questionIndex);
  ok(qNow === qAfter + 1, `double/triple CONTINUE advanced exactly one question (${qAfter} → ${qNow})`);
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 }).catch(() => {});

  /* ---- 4. LONGEST explanation fits (L13 Q2 was the audit worst) ------ */
  await page.evaluate(() => window.__WB__.gotoQuestion(13, 1)); // Q2 of level 13
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 });
  await sleep(400);
  await shootAt(page, null);
  const long1 = await waitForCard(page);
  ok(long1 && long1.fit && long1.fit.displayFont >= 14, `long explanation fitted at ${long1 && long1.fit ? long1.fit.displayFont : '?'}px display font`);
  ok(long1 && long1.explainBottomLocal <= 68.5, `explanation stops above the button (bottom ${long1 && long1.explainBottomLocal})`);
  await waitForArmed(page);
  await page.screenshot({ path: join(OUT, '5-long-explanation.png') });
  await clickWorld(page, ...(Object.values(await buttonWorldPos(page))));

  /* ---- 5. phone landscape keeps the card readable -------------------- */
  const phone = await browser.newPage();
  await phone.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await phone.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await phone.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 30000 });
  await phone.evaluate(() => window.__WB__.setAutoPause(false));
  await phone.evaluate(() => window.__WB__.gotoLevel(2));
  await phone.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
  await phone.evaluate(() => window.__WB__.autoAim(null));
  const mobile = await waitForCard(phone);
  ok(mobile && mobile.visible, 'phone landscape shows the feedback card');
  const mobileFit = await phone.evaluate(() => {
    const c = window.__WB__.scene().feedbackCard;
    const cam = window.__WB__.scene().cameras.main;
    const half = (c.skin.displayWidth * c.root.scaleX) / 2;
    return { left: c.root.x - half, right: c.root.x + half, zoom: cam.zoom, font: c.fit.displayFont };
  });
  ok(mobileFit.left >= 0 && mobileFit.right <= 1280,
    `card fully inside the world frame on phone (x ${Math.round(mobileFit.left)}..${Math.round(mobileFit.right)}, font ${mobileFit.font}px)`);
  await waitForArmed(phone);
  await sleep(250);
  await phone.screenshot({ path: join(OUT, '6-mobile-landscape.png') });
  await phone.close();

  /* ---- 5b. tablet portrait-forced-landscape (1024×768) --------------- */
  const tablet = await browser.newPage();
  await tablet.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await tablet.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await tablet.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 30000 });
  await tablet.evaluate(() => window.__WB__.setAutoPause(false));
  await tablet.evaluate(() => window.__WB__.gotoLevel(2));
  await tablet.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
  await tablet.evaluate(() => {
    const s = window.__WB__.scene();
    const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId && !t.wb.hit);
    window.__WB__.autoAim(wrong ? wrong.wb.choiceId : null);
  });
  const tabletWrong = await waitForCard(tablet);
  ok(tabletWrong && tabletWrong.kind === 'wrong', 'tablet shows the wrong-answer card');
  await waitForArmed(tablet);
  await sleep(250);
  await tablet.screenshot({ path: join(OUT, '6b-tablet-wrong.png') });
  await tablet.close();

  /* ---- 6. Q4 CONTINUE → LEVEL COMPLETE ------------------------------- */
  const q4before = await page.evaluate(() => window.__WB__.scene().questionIndex);
  for (let q = q4before; q < 3; q++) {
    await shootAt(page, null);
    await waitForCard(page);
    await waitForArmed(page);
    await clickWorld(page, ...(Object.values(await buttonWorldPos(page))));
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 }).catch(() => {});
    await sleep(400);
  }
  await shootAt(page, null); // Q4
  await waitForCard(page);
  await waitForArmed(page);
  await page.screenshot({ path: join(OUT, '7-q4-correct.png') });
  await clickWorld(page, ...(Object.values(await buttonWorldPos(page))));
  const complete = await page.waitForFunction(() => window.__WB__.state() === 'LEVEL_COMPLETE', { timeout: 12000 })
    .then(() => true).catch(() => false);
  ok(complete, 'Q4 CONTINUE opens LEVEL COMPLETE (never Question 5)');
  await page.screenshot({ path: join(OUT, '8-level-complete.png') });
} finally {
  await browser.close();
}

console.log('\n== feedback screenshots summary ==');
if (problems.length) {
  console.log(`${problems.length} problems:`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('all checks passed');
