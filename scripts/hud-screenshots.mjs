/**
 * Fix #17 HUD verification — boots the REAL built game (vite build output
 * served over HTTP) in Chrome/Edge and captures the acceptance screenshots:
 *
 *   desktop / tablet / phone-landscape HUD, pause menu, low timer, 1 heart.
 *
 * Run:  node scripts/hud-screenshots.mjs [http://host:port]
 * (defaults to the vite preview server on :4173)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'docs', 'screenshots', 'fix17');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:4173';

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

async function gotoGameScene(page, levelId = 3) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 20000 });
  await page.evaluate((id) => window.__WB__.gotoLevel(id), levelId);
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
  }, { timeout: 30000 });
  // headless tabs report "hidden" — stop the auto-pause so gameplay is live
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  await sleep(700); // arming + entrance tweens settle
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

  /** One page per shot — closed afterwards so N running games never pile up. */
  const shot = async (name, vp, prepare) => {
    const page = await newPage(browser, vp);
    try {
      await gotoGameScene(page, 3);
      if (prepare) await prepare(page);
      await page.screenshot({ path: join(OUT, name) });
      console.log('ok', name);
    } finally {
      await page.close();
    }
  };

  try {
    await shot('desktop-1920x1080.png', { w: 1920, h: 1080 });
    await shot('ipad-landscape-1180x820.png', { w: 1180, h: 820, mobile: true, touch: true });
    await shot('phone-landscape-844x390.png', { w: 844, h: 390, mobile: true, touch: true });

    await shot('pause-menu.png', { w: 1920, h: 1080 }, async (page) => {
      await page.evaluate(() => window.__WB__.scene().doPause());
      await sleep(500); // menu entrance tween
    });

    await shot('timer-low.png', { w: 1920, h: 1080 }, async (page) => {
      // capture latency eats ~2-5s; pin 20s so the shot lands ~00:15
      await page.evaluate(() => window.__WB__.setTimeRemaining(20000));
      await sleep(1200); // let the pulse cycle show
    });

    await shot('one-heart.png', { w: 1920, h: 1080 }, async (page) => {
      await page.evaluate(() => {
        const s = window.__WB__.scene();
        s.hearts.remaining = 1;
        s.refreshHUD();
      });
      await sleep(600);
    });
  } finally {
    await browser.close();
  }
  console.log('done ->', OUT);
};

main().catch((e) => { console.error(e); process.exit(1); });
