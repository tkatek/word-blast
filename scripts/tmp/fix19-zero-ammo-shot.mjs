/** Focused capture: a bird type at zero ammunition (dimmed card, ×0 badge). */
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
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // robust boot: the shared LEVEL manager must be in the game registry —
    // save() alone proved racy when the page reboots mid-flow
    await page.waitForFunction(() => window.__WB__ && window.__WB__.scene()
      && !!window.__WB__.game.registry.get('levels'), { timeout: 60000 });
    await sleep(1200); // menu/question-card entrance window
    if (!await page.evaluate(() => !!window.__WB__.game.registry.get('levels'))) {
      throw new Error('registry lost after boot (page rebooted)');
    }
    await page.evaluate(() => window.__WB__.gotoLevel(12));
    await page.waitForFunction(() => {
      const s = window.__WB__ && window.__WB__.scene();
      return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
    }, { timeout: 60000 });
    await page.evaluate(() => window.__WB__.setAutoPause(false));

    // drain the blue bird (speed ×2 on L12) with quick backward misses
    await page.evaluate(() => window.__WB__.scene().selectProjectile('speed'));
    await sleep(300);
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.__WB__.simulateShot({ vx: -6.5, vy: -5 }));
      await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
      await sleep(400);
    }
    const n = await page.evaluate(() => window.__WB__.scene().birdInventory.count('speed'));
    if (n !== 0) throw new Error(`speed ammo should be 0, got ${n}`);
    await sleep(400);
    await page.screenshot({ path: join(OUT, 'zero-ammo-card.png') });
    console.log('ok zero-ammo-card.png');
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
