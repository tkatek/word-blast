/** Fix #9 — real-browser functional probe: speaker availability, peek, HUD gap. */
import puppeteer from 'puppeteer-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function safeEval(page, fn) {
  try { return await page.evaluate(fn); } catch { return null; }
}
async function poll(page, fnExpr, timeout = 15000, everyMs = 40) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = await safeEval(page, fnExpr);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling'],
  defaultViewport: { width: 1280, height: 720 }
});
try {
  const page = await browser.newPage();
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
    await poll(page, () => window.__WB__ && window.__WB__.cardInfo ? true : null, 30000, 100);
    await safeEval(page, () => window.__WB__.setAutoPause(false));
    await safeEval(page, () => window.__WB__.gotoLevel(1));
    const armed = await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 15000, 40);

    const probe = await safeEval(page, () => {
      const s = window.__WB__.scene();
      const c = window.__WB__.cardInfo();
      const r = s.card.root;
      const cardH = r.scaleX * s.card.baseH;
      const topEdge = r.y - cardH / 2;
      return {
        phase: c.phase,
        tts: c.ttsAvailable,
        voices: ((window.speechSynthesis && window.speechSynthesis.getVoices()) || []).length,
        speakerInteractive: !!(s.card.speakerHit.input),
        topEdgeGapBelowHUD: +(topEdge - 76).toFixed(1),
        rightEdge: +(r.x + r.scaleX * s.card.baseW / 2).toFixed(1)
      };
    });
    if (!armed || !probe) { console.log(`probe attempt ${attempt} interrupted — retrying`); continue; }
    console.log('resting:', JSON.stringify(probe));

    const peek = await safeEval(page, () => {
      const s = window.__WB__.scene();
      s.card.openPeek();
      const out = {
        phase: s.card.phase,
        slingBlocked: !s.slingshot.enabled,
        x: s.card.root.x, y: s.card.root.y, scale: s.card.root.scaleX
      };
      s.card.closePeek();
      return out;
    });
    await sleep(500);
    const closed = await safeEval(page, () => {
      const s = window.__WB__.scene();
      return { phase: s.card.phase, slingRestored: s.slingshot.enabled, state: s.stateMachine.current };
    });
    console.log('peek open:', JSON.stringify(peek), 'closed:', JSON.stringify(closed));

    await safeEval(page, () => window.__WB__.gotoLevel(13));
    const reading = await poll(page, () => {
      const c = window.__WB__.cardInfo();
      return c && c.phase === 'READING' ? true : null;
    }, 15000, 40);
    if (reading) {
      const long = await safeEval(page, () => window.__WB__.cardInfo());
      console.log('long question fit:', JSON.stringify({
        len: long.question.text.length, fittedPx: long.fittedFontSize, hint: long.enlargeHint
      }));
      break;
    }
    console.log(`long-question attempt ${attempt} interrupted — retrying`);
  }
} finally {
  await browser.close();
}
