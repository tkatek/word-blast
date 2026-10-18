/**
 * Focused capture: black-bomb explosion + purple-ice freeze screenshots.
 * Minimal single-page flow with whole-browser retries (this environment's
 * Chrome boots are flaky while the machine is busy).
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', '..', 'screenshots', 'fix19');
const BASE = process.argv[2] || 'http://127.0.0.1:4276';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(existsSync);
  return candidates[0] || null;
}

async function attempt() {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1536, height: 864 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__WB__ && window.__WB__.scene()
      && window.__WB__.save() !== null, { timeout: 60000 });
    await page.evaluate(() => window.__WB__.setAutoPause(false));
    await page.evaluate(() => window.__WB__.gotoLevel(12));
    await page.waitForFunction(() => {
      const s = window.__WB__ && window.__WB__.scene();
      return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
    }, { timeout: 60000 });

    /* black bomb: fly into the tower band, detonate, capture the flash */
    await page.evaluate(() => window.__WB__.scene().selectProjectile('bomb'));
    await sleep(300);
    await page.evaluate(() => window.__WB__.simulateShot({ vx: 17, vy: -6 }));
    await page.waitForFunction(() => window.__WB__.state() === 'PROJECTILE_FLYING', { timeout: 8000 });
    await page.waitForFunction(() => {
      const ps = window.__WB__ && window.__WB__.scene().factory.projectiles;
      if (!ps.length) return true;
      const p = ps[0];
      return p.wb.consumed || p.wb.firstImpactDone || p.x > 580;
    }, { timeout: 12000, polling: 100 });
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(180);
    await page.screenshot({ path: join(OUT, 'black-explosion.png') });
    console.log('ok black-explosion.png');
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });

    /* purple ice: same band, freeze, capture the icy tint */
    await page.evaluate(() => window.__WB__.scene().selectProjectile('ice'));
    await sleep(300);
    await page.evaluate(() => window.__WB__.simulateShot({ vx: 17, vy: -6 }));
    await page.waitForFunction(() => window.__WB__.state() === 'PROJECTILE_FLYING', { timeout: 8000 });
    await page.waitForFunction(() => {
      const ps = window.__WB__ && window.__WB__.scene().factory.projectiles;
      if (!ps.length) return true;
      const p = ps[0];
      return p.wb.consumed || p.wb.firstImpactDone || p.x > 560;
    }, { timeout: 12000, polling: 100 });
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(500);
    await page.screenshot({ path: join(OUT, 'purple-freeze.png') });
    console.log('ok purple-freeze.png');
    return true;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

for (let i = 0; i < 4; i++) {
  try {
    if (await attempt()) process.exit(0);
  } catch (e) {
    console.log(`attempt ${i + 1} failed: ${e.message}`);
  }
}
console.log('ALL ATTEMPTS FAILED');
process.exit(1);
