/** Fix #9 — capture F (phone landscape) only; self-healing against reloads. */
import puppeteer from 'puppeteer-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'docs', 'screenshots', 'fix9');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeEval(page, fn) {
  try { return await page.evaluate(fn); } catch { return null; }
}
async function poll(page, fnExpr, timeout = 20000, everyMs = 40) {
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
  defaultViewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
});
try {
  const page = await browser.newPage();
  // phone viewport from the very start — the game boots already framed for it
  await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
  await poll(page, () => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && window.__WB__.cardInfo ? true : null;
  }, 30000, 100);
  await safeEval(page, () => window.__WB__.setAutoPause(false));

  for (let attempt = 1; attempt <= 4; attempt++) {
    await safeEval(page, () => window.__WB__.gotoLevel(1));
    const armed = await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 15000, 40);
    const c = await safeEval(page, () => window.__WB__.cardInfo());
    if (armed && c && c.phase === 'READY_TOP') {
      console.log('F phone top rest:', JSON.stringify({ phase: c.phase, x: c.x, y: c.y, scale: c.scale }));
      await page.screenshot({ path: join(OUT, 'F-phone-landscape.png') });
      console.log('DONE');
      break;
    }
    console.log(`F attempt ${attempt} missed — reloading`);
    await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
    await poll(page, () => window.__WB__ && window.__WB__.cardInfo ? true : null, 30000, 100);
    await safeEval(page, () => window.__WB__.setAutoPause(false));
  }
} finally {
  await browser.close();
}
