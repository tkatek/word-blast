/** Fix #9 — recapture C (halfway through the center→top move), position-triggered. */
import puppeteer from 'puppeteer-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT = join(ROOT, 'docs', 'screenshots', 'fix9');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeEval(page, fn) {
  try { return await page.evaluate(fn); } catch { return null; }
}
async function poll(page, fnExpr, timeout = 15000, everyMs = 16) {
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
    await poll(page, () => {
      const g = window.__WB__ && window.__WB__.game;
      return g && g.scene.isActive('MenuScene') && window.__WB__.cardInfo ? true : null;
    }, 30000, 100);
    await safeEval(page, () => window.__WB__.setAutoPause(false));
    await safeEval(page, () => window.__WB__.gotoLevel(1));
    // fire the shutter when the card is verifiably BETWEEN center and top
    const mid = await poll(page, () => {
      const c = window.__WB__.cardInfo();
      return c && c.phase === 'MOVING_TO_TOP' && c.y < 305 && c.y > 215 ? { y: c.y, x: c.x, s: c.scale } : null;
    }, 12000, 8);
    if (mid) {
      console.log('C mid-flight:', JSON.stringify(mid));
      await page.screenshot({ path: join(OUT, 'C-move-halfway.png') });
      console.log('DONE');
      break;
    }
    console.log(`C attempt ${attempt} missed the window — retrying`);
  }
} finally {
  await browser.close();
}
