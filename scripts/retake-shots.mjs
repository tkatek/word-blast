/**
 * Supplemental Fix #6 captures — freeze + explosion shots aimed into tower
 * STRUCTURES (not answer plaques) so the feedback modal doesn't cover the
 * effect. Runs against the dev server like verify-birds.mjs.
 */
import puppeteer from 'puppeteer-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(page, fn, timeout = 5000, everyMs = 40) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await page.evaluate(fn);
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
  await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && g.textures.exists('bird-red');
  }, { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));

  /* purple freeze — manual lob into the mid-field tower cluster */
  await page.evaluate(() => window.__WB__.gotoLevel(7));
  await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 15000, 100);
  await page.evaluate(() => window.__WB__.scene().selectProjectile('ice'));
  await sleep(250);
  await page.evaluate(() => window.__WB__.simulateShot({ vx: 18.5, vy: -9.5, type: 'ice' }));
  const froze = await poll(page, () => {
    const ps = window.__WB__.scene().factory.projectiles;
    return ps.some((p) => p.wb.typeKey === 'ice' && p.wb.firstImpactDone) ? true : null;
  }, 6000);
  await sleep(80);
  await page.screenshot({ path: join(OUT, '06-purple-freeze.png') });
  console.log('freeze captured:', !!froze);

  await sleep(2500);

  /* black bomb — manual lob into the tower cluster */
  await page.evaluate(() => window.__WB__.gotoLevel(12));
  await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 15000, 100);
  await page.evaluate(() => {
    const fx = window.__WB__.scene().fx;
    window.__boom = { fired: false, t: 0 };
    const orig = fx.explosion.bind(fx);
    fx.explosion = (x, y) => { window.__boom = { fired: true, x, y, t: performance.now() }; return orig(x, y); };
  });
  await page.evaluate(() => window.__WB__.scene().selectProjectile('bomb'));
  await sleep(250);
  await page.evaluate(() => window.__WB__.simulateShot({ vx: 18.5, vy: -9.5, type: 'bomb' }));
  const boom = await poll(page, () => (window.__boom && window.__boom.fired ? window.__boom : null), 6000, 30);
  await sleep(50);
  await page.screenshot({ path: join(OUT, '08-black-explosion.png') });
  console.log('explosion captured:', JSON.stringify(boom));
} finally {
  await browser.close();
}
