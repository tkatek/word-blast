/**
 * Fix #19 redesign verification shots (dev server).
 * Captures: desktop normal, red/yellow selected, zero-ammo, phone landscape.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', '..', 'screenshots', 'fix19-redesign');
const BASE = process.argv[2] || 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(existsSync);
  return candidates[0];
}

async function launch() {
  return puppeteer.launch({
    executablePath: findBrowser(), headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run']
  });
}

async function gotoGame(page, levelId = 12) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const booted = async () => {
    for (let i = 0; i < 60; i++) {
      const ok = await page.evaluate(() => {
        const wb = window.__WB__;
        return !!(wb && wb.game && wb.game.registry.get('levels') && wb.game.registry.get('save'));
      }).catch(() => false);
      if (ok) return true;
      await sleep(1000);
    }
    return false;
  };
  if (!await booted()) {
    console.log('  (boot timed out — reloading once)');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!await booted()) throw new Error('game never finished booting');
  }
  await page.evaluate((id) => window.__WB__.gotoLevel(id), levelId);
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => window.__WB__ ? window.__WB__.state() : null).catch(() => null);
    if (st === 'AIMING') break;
    await sleep(500);
  }
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  await sleep(600);
}

const state = (page) => page.evaluate(() => window.__WB__.state());

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await gotoGame(page, 12);
  await sleep(400);
  await page.screenshot({ path: join(OUT, 'desktop-normal.png') });
  console.log('ok desktop-normal.png');

  // crop of the selector for close inspection
  await page.evaluate(() => window.__WB__.scene().selectProjectile('basic'));
  await sleep(500);
  await page.screenshot({ path: join(OUT, 'red-selected.png') });
  console.log('ok red-selected.png');

  await page.evaluate(() => window.__WB__.scene().selectProjectile('split'));
  await sleep(500);
  await page.screenshot({ path: join(OUT, 'yellow-selected.png') });
  console.log('ok yellow-selected.png');

  await page.evaluate(() => window.__WB__.scene().selectProjectile('bomb'));
  await sleep(400);
  await page.evaluate(() => window.__WB__.scene().selectProjectile('ice'));
  await sleep(400);
  await page.evaluate(() => window.__WB__.scene().selectProjectile('speed'));
  await sleep(400);
  await page.screenshot({ path: join(OUT, 'blue-selected.png') });
  console.log('ok blue-selected.png');

  // zero-ammo: drain blue (2 shots) with backward lobs
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => window.__WB__.simulateShot({ vx: -6.5, vy: -5 }));
    for (let t = 0; t < 60; t++) {
      const st = await state(page);
      if (st === 'AIMING') break;
      await sleep(500);
    }
    await sleep(400);
  }
  await page.screenshot({ path: join(OUT, 'zero-ammo.png') });
  console.log('ok zero-ammo.png');
} catch (e) {
  console.log('FAIL -', e.message);
} finally {
  console.log('pageerrors:', errors.slice(0, 5));
  await page.close();
}

// mobile landscape pass
const mpage = await browser.newPage();
await mpage.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
try {
  await gotoGame(mpage, 12);
  await sleep(400);
  await mpage.screenshot({ path: join(OUT, 'mobile-landscape.png') });
  console.log('ok mobile-landscape.png');
} catch (e) {
  console.log('FAIL mobile -', e.message);
} finally {
  await mpage.close();
  await browser.close();
}
