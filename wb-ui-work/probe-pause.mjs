import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4273';
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];
const exe = candidates.find((p) => existsSync(p));
if (!exe) throw new Error('no browser');
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
const logs = [];
page.on('console', (m) => logs.push(m.text()));
process.on('exit', () => { const tail = logs.slice(-40); console.log('--- console tail ---'); for (const l of tail) console.log(l); });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 60000 });
await sleep(1200);
await page.evaluate(() => window.__WB__.setDebug(true));
await page.evaluate(() => {
  window.__WB__.setAutoPause(false);
  window.__WB__.setCardTimings({ enterMs: 150, readingMs: 900, moveMs: 250, exitMs: 120, peekMs: 150 });
  window.__WB__.gotoLevel(1);
});
let okAiming = false;
for (let i = 0; i < 80; i++) {
  const st = await page.evaluate(() => window.__WB__.state());
  if (st === 'AIMING') { okAiming = true; break; }
  if (i % 10 === 0) console.log('poll state:', st);
  await new Promise((r) => setTimeout(r, 500));
}
if (!okAiming) { console.log('NEVER AIMING'); process.exit(1); }
// --- reproduce the acceptance flow: wrong answer, then correct, then pause ---
const clickWorldP = async (wx, wy) => {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.click(pt.x, pt.y, { delay: 40 });
};
const waitState = async (target, t = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => window.__WB__.state());
    if (st === target) return;
    if (Date.now() - t0 > t) {
      const cardDump = await page.evaluate(() => JSON.stringify(window.__WB__.cardInfo()));
      const pausedDump = await page.evaluate(() => window.__WB__.scene().stateMachine.isPaused());
      console.log('CARD AT STALL:', cardDump, 'isPaused:', pausedDump);
      const vitals = await page.evaluate(() => ({
        vis: document.visibilityState,
        loopStopped: window.__WB__.game.loop.isStopped,
        fps: Math.round(window.__WB__.game.loop.actualFps),
        running: window.__WB__.isLoopRunning(),
        frame: window.__WB__.game.loop.frame,
        time: window.__WB__.game.loop.now
      }));
      // sample twice to see if frames advance
      const f1 = vitals.frame; await new Promise((r) => setTimeout(r, 800));
      const f2 = await page.evaluate(() => window.__WB__.game.loop.frame);
      throw new Error('waitState ' + target + ' failed; now=' + st + ' vitals=' + JSON.stringify(vitals) + ' frameAdvance=' + (f2 - f1));
    }
    await new Promise((r) => setTimeout(r, 150));
  }
};
const clickFeedback = async () => {
  const t0 = Date.now();
  for (;;) {
    const f = await page.evaluate(() => window.__WB__.feedbackInfo());
    if (f && f.visible && f.actionEnabled) break;
    if (Date.now() - t0 > 12000) throw new Error('feedback never armed');
    await new Promise((r) => setTimeout(r, 150));
  }
  const pos = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const r = s.feedbackCard.root, b = s.feedbackCard.button;
    return { x: r.x + b.x * r.scaleX, y: r.y + b.y * r.scaleY };
  });
  await new Promise((r) => setTimeout(r, 250));
  await clickWorldP(pos.x, pos.y);
};
// wrong answer
await page.evaluate(() => {
  const s = window.__WB__.scene();
  const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId);
  return s.debugAutoAim(wrong.wb.choiceId);
});
await waitState('ANSWER_FEEDBACK');
await clickFeedback();
await waitState('AIMING');
console.log('flow: wrong answered, back to AIMING');
// correct answer (with retries — slow software rendering can strand shots)
let correct = false;
for (let attempt = 0; attempt < 4 && !correct; attempt++) {
  const fired = await page.evaluate(() => !!window.__WB__.autoAim());
  if (!fired) { await new Promise((r) => setTimeout(r, 500)); continue; }
  try { await waitState('ANSWER_FEEDBACK', 25000); correct = true; }
  catch (e) { console.log('attempt', attempt, 'missed; retrying'); await waitState('AIMING', 25000); }
}
if (!correct) { console.log('CORRECT ANSWER NEVER LANDED'); process.exit(1); }
console.log('flow: correct answered');
await clickFeedback();
await waitState('AIMING', 30000);
console.log('flow: continued to question 2, AIMING');
const pause = await page.evaluate(() => {
  const s = window.__WB__.scene();
  const e = s.hud.layout.elements.pause;
  const toC = window.__WB__.worldToClient(e.x, e.y);
  return { wx: e.x, wy: e.y, cx: toC.x, cy: toC.y, camScrollX: s.cameras.main.scrollX, camZoom: s.cameras.main.zoom };
});
console.log('pause target:', JSON.stringify(pause));
await page.mouse.click(pause.cx, pause.cy, { delay: 40 });
await sleep(700);
const st = await page.evaluate(() => ({
  state: window.__WB__.state(),
  pauseOpen: window.__WB__.scene().hud.pauseOpen
}));
console.log('after click:', JSON.stringify(st));
await browser.close();
