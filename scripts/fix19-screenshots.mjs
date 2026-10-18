/**
 * Fix #19 acceptance screenshots — boots the REAL built game (vite build
 * output served over HTTP) in Chrome/Edge and captures:
 *
 *   - the bird-selection card row on desktop + phone landscape
 *   - red bird selected (basic)
 *   - blue bird mid speed-boost (trail)
 *   - yellow bird splitting into five
 *   - black bird exploding (flash + debris + shake frame)
 *   - purple bird freezing nearby blocks
 *   - a bird type at zero ammunition (dimmed card, ×0 badge)
 *
 * Run:  node scripts/fix19-screenshots.mjs [http://host:port]
 * (defaults to the vite preview server on :4273)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'fix19');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:4273';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function newPage(browser, { w, h, mobile = false, touch = false }) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: touch });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  return page;
}

async function gotoGameScene(page, levelId = 12) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // __WB__ exists once main.js ran, but the shared managers land in the
  // registry only when BootScene.create() finished — wait for those first.
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene()
    && window.__WB__.save() !== null, { timeout: 45000 });
  // scene.start() boots GameScene synchronously — if a concurrent rebuild
  // left the registry briefly incomplete the evaluate throws; retry a few
  // times before giving up (the wait below re-checks the real state).
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.evaluate((id) => window.__WB__.gotoLevel(id), levelId);
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1500);
    }
  }
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
  }, { timeout: 45000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  await sleep(700); // arming + entrance tweens settle
}

const state = (page) => page.evaluate(() => window.__WB__.state());
const scene = (page) => page.evaluate(() => window.__WB__.scene());

/** Fire the currently selected bird and wait until it is flying. */
async function fire(page, vx, vy) {
  await page.evaluate(({ vx, vy }) => window.__WB__.simulateShot({ vx, vy }), { vx, vy });
  await page.waitForFunction(() => window.__WB__.state() === 'PROJECTILE_FLYING', { timeout: 8000 });
}

/** Wait for the shot to resolve and the slingshot to re-arm. */
async function rearm(page) {
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
  await sleep(400);
}

const main = async () => {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome/Edge executable found');
  console.log('browser:', exe);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--mute-audio']
  });

  /**
   * ONE page carries the whole desktop campaign (one boot, sequential
   * scenarios with re-arms between shots) — repeated navigations proved
   * fragile in this environment.
   */
  const page = await newPage(browser, { w: 1536, h: 864 });
  const snap = async (name) => {
    await page.screenshot({ path: join(OUT, name) });
    console.log('ok', name);
  };

  try {
    await gotoGameScene(page, 12);

    /* 1 — the five-card selector, red selected */
    await page.evaluate(() => window.__WB__.scene().selectProjectile('bomb'));
    await sleep(250);
    await page.evaluate(() => window.__WB__.scene().selectProjectile('basic'));
    await sleep(400);
    await snap('selector-desktop.png');
    await snap('red-selected.png');

    /* 2 — blue bird accelerating (mid-boost trail) */
    await page.evaluate(() => window.__WB__.scene().selectProjectile('speed'));
    await sleep(300);
    await fire(page, 17, -9);
    await sleep(260);
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(140);
    await snap('blue-boost.png');
    await rearm(page);

    /* 3 — yellow bird splitting into five (early activation, lofted arc) */
    await page.evaluate(() => window.__WB__.scene().selectProjectile('split'));
    await sleep(300);
    await fire(page, 16, -9);
    await sleep(220);
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(330);
    await snap('yellow-split-five.png');
    await rearm(page);

    /* 4 — black bird exploding over a tower */
    await page.evaluate(() => window.__WB__.scene().selectProjectile('bomb'));
    await sleep(300);
    await fire(page, 17, -6);
    await page.waitForFunction(() => {
      const ps = window.__WB__ && window.__WB__.scene().factory.projectiles;
      return ps.length > 0 && !ps[0].wb.consumed && ps[0].x > 700;
    }, { timeout: 8000 });
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(160);
    await snap('black-explosion.png');
    await rearm(page);

    /* 5 — purple bird freezing blocks */
    await page.evaluate(() => window.__WB__.scene().selectProjectile('ice'));
    await sleep(300);
    await fire(page, 17, -6);
    await page.waitForFunction(() => {
      const ps = window.__WB__ && window.__WB__.scene().factory.projectiles;
      return ps.length > 0 && !ps[0].wb.consumed && ps[0].x > 680;
    }, { timeout: 8000 });
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(450);
    await snap('purple-freeze.png');
    await rearm(page);

    /* 6 — a bird type at zero ammunition (fresh level: drain blue ×2) */
    await page.evaluate((id) => window.__WB__.gotoLevel(id), 12);
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
    await page.evaluate(() => window.__WB__.setAutoPause(false));
    await page.evaluate(() => window.__WB__.scene().selectProjectile('speed'));
    await sleep(250);
    for (let i = 0; i < 2; i++) {
      await fire(page, -6.5, -5);   // backward lobs: quick guaranteed misses
      await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
      await sleep(350);
    }
    await snap('zero-ammo-card.png');
  } catch (e) {
    console.log('FAIL desktop campaign -', e.message);
  } finally {
    await page.close();
  }

  /* mobile pass: selector row + mid-flight TAP button */
  const mpage = await newPage(browser, { w: 844, h: 390, mobile: true, touch: true });
  try {
    await gotoGameScene(mpage, 12);
    await mpage.screenshot({ path: join(OUT, 'selector-phone-landscape.png') });
    console.log('ok selector-phone-landscape.png');
    await mpage.evaluate(() => window.__WB__.scene().selectProjectile('split'));
    await sleep(250);
    await fire(mpage, 15, -9);
    await sleep(300);
    await mpage.screenshot({ path: join(OUT, 'ability-button-mobile.png') });
    console.log('ok ability-button-mobile.png');
  } catch (e) {
    console.log('FAIL mobile pass -', e.message);
  } finally {
    await mpage.close();
  }

  await browser.close();
  console.log('done ->', OUT);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
