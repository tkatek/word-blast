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
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 20000 });
  await page.evaluate((id) => window.__WB__.gotoLevel(id), levelId);
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
  }, { timeout: 30000 });
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

  const shot = async (name, vp, prepare, levelId = 12) => {
    const page = await newPage(browser, vp);
    try {
      await gotoGameScene(page, levelId);
      if (prepare) await prepare(page);
      await page.screenshot({ path: join(OUT, name) });
      console.log('ok', name);
    } catch (e) {
      console.log('FAIL', name, '-', e.message);
    } finally {
      await page.close();
    }
  };

  /* 1 — the five-card selector, desktop */
  await shot('selector-desktop.png', { w: 1920, h: 1080 }, async (page) => {
    await page.evaluate(() => window.__WB__.scene().selectProjectile('basic'));
    await sleep(300);
  });

  /* 2 — phone landscape (responsive check) */
  await shot('selector-phone-landscape.png', { w: 844, h: 390, mobile: true, touch: true }, async (page) => {
    await sleep(200);
  });

  /* 3 — tablet landscape */
  await shot('selector-tablet.png', { w: 1180, h: 820, mobile: true, touch: true }, async (page) => {
    await sleep(200);
  });

  /* 4 — red bird selected (glowing card + red bird in the pouch) */
  await shot('red-selected.png', { w: 1920, h: 1080 }, async (page) => {
    await page.evaluate(() => window.__WB__.scene().selectProjectile('bomb')); // select another first…
    await sleep(250);
    await page.evaluate(() => window.__WB__.scene().selectProjectile('basic')); // …so the pop reads
    await sleep(350);
  });

  /* 5 — blue bird accelerating (mid-boost trail) */
  await shot('blue-boost.png', { w: 1920, h: 1080 }, async (page) => {
    await page.evaluate(() => window.__WB__.scene().selectProjectile('speed'));
    await sleep(250);
    await fire(page, 17, -7);
    await sleep(320);                 // let it climb over the foreground
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(130);                 // trail + stretch visible
  });

  /* 6 — yellow bird splitting into five */
  await shot('yellow-split-five.png', { w: 1920, h: 1080 }, async (page) => {
    await page.evaluate(() => window.__WB__.scene().selectProjectile('split'));
    await sleep(250);
    await fire(page, 17, -7);
    await sleep(380);                 // fan separates visibly
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(240);
  });

  /* 7 — black bird exploding over a tower */
  await shot('black-explosion.png', { w: 1920, h: 1080 }, async (page) => {
    await page.evaluate(() => window.__WB__.scene().selectProjectile('bomb'));
    await sleep(250);
    await fire(page, 17, -5.5);
    await page.waitForFunction(() => {
      const ps = window.__WB__ && window.__WB__.scene().factory.projectiles;
      return ps.length > 0 && !ps[0].wb.consumed && ps[0].x > 720;
    }, { timeout: 6000 });
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(150);                 // flash + ring + debris frame
  });

  /* 8 — purple bird freezing blocks */
  await shot('purple-freeze.png', { w: 1920, h: 1080 }, async (page) => {
    await page.evaluate(() => window.__WB__.scene().selectProjectile('ice'));
    await sleep(250);
    await fire(page, 17, -5.5);
    await page.waitForFunction(() => {
      const ps = window.__WB__ && window.__WB__.scene().factory.projectiles;
      return ps.length > 0 && !ps[0].wb.consumed && ps[0].x > 690;
    }, { timeout: 6000 });
    await page.evaluate(() => window.__WB__.scene().tryActivateAbilities());
    await sleep(420);                 // icy tint visible on blocks
  });

  /* 9 — a bird type at zero ammunition (drain blue: 2 shots on L12) */
  await shot('zero-ammo-card.png', { w: 1920, h: 1080 }, async (page) => {
    await page.evaluate(() => window.__WB__.scene().selectProjectile('speed'));
    await sleep(200);
    for (let i = 0; i < 2; i++) {
      await fire(page, 15, -7);
      await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
      await sleep(300);
    }
    const n = await page.evaluate(() => window.__WB__.scene().birdInventory.count('speed'));
    if (n !== 0) throw new Error(`speed ammo should be 0, got ${n}`);
    await sleep(400);                 // badge pulse settled on ×0 + dimmed
  });

  /* 10 — mobile: mid-flight ability TAP button visible */
  await shot('ability-button-mobile.png', { w: 844, h: 390, mobile: true, touch: true }, async (page) => {
    await page.evaluate(() => window.__WB__.scene().selectProjectile('split'));
    await sleep(250);
    await fire(page, 15, -7);
    await sleep(260);
  });

  await browser.close();
  console.log('done ->', OUT);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
