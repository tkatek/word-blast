/**
 * Fix #9 — question-card verification captures (REAL production timings).
 *
 * Runs against the vite dev server (localhost:8081) in real Chrome and
 * captures the seven required presentations:
 *   A centered entrance, B fully visible reading window, C halfway move,
 *   D resting at top, E long sentence, F phone landscape, G question 2.
 *
 * The dev server may hot-reload mid-run (concurrent edits to the repo),
 * destroying the page context — every step is therefore reload-tolerant:
 * polls survive navigation errors and sequences retry from scratch.
 */
import puppeteer from 'puppeteer-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT = join(ROOT, 'docs', 'screenshots', 'fix9');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** evaluate() that survives context destruction (vite full reloads). */
async function safeEval(page, fn, ...args) {
  try {
    return await page.evaluate(fn, ...args);
  } catch {
    return null;
  }
}

async function poll(page, fnExpr, timeout = 15000, everyMs = 25) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = await safeEval(page, fnExpr);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

async function bootReady(page) {
  await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
  await poll(page, () => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && window.__WB__.cardInfo ? true : null;
  }, 30000, 100);
  await safeEval(page, () => window.__WB__.setAutoPause(false));
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling'],
  defaultViewport: { width: 1280, height: 720 }
});
try {
  const page = await browser.newPage();
  await bootReady(page);

  /* A→D — one continuous first-question presentation (retry on reload) */
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      await safeEval(page, () => window.__WB__.gotoLevel(1));
      const entering = await poll(page, () => (window.__WB__.cardInfo()?.phase === 'ENTERING' ? true : null), 8000, 5);
      if (!entering) throw new Error('no ENTERING (reload?)');
      await sleep(170); // mid fade-in of the 350ms entrance
      await page.screenshot({ path: join(OUT, 'A-center-entrance.png') });

      const b = await poll(page, () => {
        const c = window.__WB__.cardInfo();
        return c && c.phase === 'READING' && c.readElapsedMs > 1600 ? { x: c.x, y: c.y, scale: c.scale, text: c.question.text } : null;
      }, 8000, 40);
      if (!b) throw new Error('no READING');
      console.log('B reading:', JSON.stringify(b));
      await page.screenshot({ path: join(OUT, 'B-center-reading-4s.png') });

      const moving = await poll(page, () => (window.__WB__.cardInfo()?.phase === 'MOVING_TO_TOP' ? true : null), 8000, 5);
      if (!moving) throw new Error('no MOVING');
      await sleep(290); // halfway through the 600ms glide
      await page.screenshot({ path: join(OUT, 'C-move-halfway.png') });

      const armed = await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 8000, 40);
      if (!armed) throw new Error('never armed');
      const d = await safeEval(page, () => window.__WB__.cardInfo());
      console.log('D top rest:', JSON.stringify({ phase: d.phase, x: d.x, y: d.y, scale: d.scale }));
      await page.screenshot({ path: join(OUT, 'D-top-resting.png') });
      done = true;
    } catch (e) {
      console.log(`A-D attempt ${attempt} interrupted (${e.message}) — rebooting`);
      await bootReady(page);
    }
  }
  if (!done) throw new Error('A-D captures failed after retries');

  /* E — the longest question in the bank (L13 Q1, 174 chars) */
  for (let attempt = 1; attempt <= 3; attempt++) {
    await safeEval(page, () => window.__WB__.gotoLevel(13));
    const e = await poll(page, () => {
      const c = window.__WB__.cardInfo();
      return c && c.phase === 'READING' && c.readElapsedMs > 1200
        ? { len: c.question.text.length, fitted: c.fittedFontSize, hint: c.enlargeHint } : null;
    }, 10000, 40);
    if (e) {
      console.log('E long:', JSON.stringify(e));
      await page.screenshot({ path: join(OUT, 'E-long-sentence.png') });
      await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 12000, 40);
      break;
    }
    await bootReady(page);
  }

  /* G — question 2 presented after question 1 completes correctly */
  let gOk = false;
  for (let attempt = 1; attempt <= 4 && !gOk; attempt++) {
    if (await safeEval(page, () => window.__WB__.info().questionIndex) !== 0) {
      await safeEval(page, () => window.__WB__.gotoLevel(13));
      await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 12000, 40);
    }
    await safeEval(page, () => window.__WB__.autoAim());
    const g = await poll(page, () => {
      const c = window.__WB__.cardInfo();
      return c && c.question && c.question.index === 1 && c.phase === 'READING'
        ? { index: c.question.index, text: c.question.text.slice(0, 60) } : null;
    }, 25000, 40);
    if (g) {
      console.log('G next question:', JSON.stringify(g));
      await page.screenshot({ path: join(OUT, 'G-question-2-after-1.png') });
      gOk = true;
    } else {
      console.log(`G attempt ${attempt} missed — rebooting`);
      await bootReady(page);
      await safeEval(page, () => window.__WB__.gotoLevel(13));
      await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 12000, 40);
    }
  }
  if (!gOk) throw new Error('G capture failed');

  /* F — phone landscape (iPhone-class 844×390, DPR 2, touch) */
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(500); // viewport re-frames
  const armedF = await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 40);
  const f = await safeEval(page, () => window.__WB__.cardInfo());
  console.log('F phone top rest:', JSON.stringify({ armed: armedF, phase: f.phase, x: f.x, y: f.y, scale: f.scale }));
  await page.screenshot({ path: join(OUT, 'F-phone-landscape.png') });

  console.log('DONE — captures in', OUT);
} finally {
  await browser.close();
}
