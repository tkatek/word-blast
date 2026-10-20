/**
 * Fix #21 acceptance screenshots + behavioural checks — boots the REAL
 * built game (vite build output served over HTTP) in Chrome/Edge and
 * captures / verifies the new main menu:
 *
 *   - desktop (1536×864): fresh menu, entrance mid-frame, settled menu
 *   - desktop: menu with saved progress (returning player)
 *   - desktop: reset confirmation popup, cancel-preserved progress,
 *     confirmed reset (0/15 · 0/45) and the menu right after
 *   - PLAY navigation + rapid-tap single-transition guard
 *   - return path LevelSelect → MENU shows updated values
 *   - tablet landscape (1180×820) and phone landscape (844×390) menus
 *
 * Run:  npm run build && npx vite preview --port 4273
 *       node scripts/menu-screenshots.mjs [http://host:port]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'fix21');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:4273';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

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

async function launchBrowser() {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome/Edge executable found');
  console.log('browser:', exe);
  return puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage',
      '--disable-features=TranslateUI', '--no-first-run']
  });
}

async function newPage(browser, { w, h, mobile = false, touch = false }) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: touch });
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  return page;
}

/** Boot to the (settled) main menu and wait for the entrance to finish. */
async function gotoMenu(page, { waitMs = 1500 } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, {
    timeout: 90000
  });
  await sleep(waitMs);
}

const menuInfo = (page) => page.evaluate(() => window.__WB__.menu());
const progressTexts = (page) => page.evaluate(() => {
  const s = window.__WB__.game.scene.getScene('MenuScene');
  return { levels: s.progressLevelsText.text, stars: s.progressStarsText.text };
});

/** Click a world-space point through the real canvas (full input path). */
async function clickWorld(page, wx, wy, delay = 40) {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.click(pt.x, pt.y, { delay });
}

/** Poll the menu's displayed progress strings until they match (screenshots
 *  stall the page thread, so fixed sleeps are unreliable mid-animation). */
async function waitForProgressText(page, needle, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = await progressTexts(page);
    if (t.levels.includes(needle.levels) && t.stars.includes(needle.stars)) return t;
    await sleep(120);
  }
  return progressTexts(page);
}

/** Menu active → entrance fully settled (PLAY armed), THEN match texts. */
async function gotoMenuSettled(page) {
  await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 90000 });
  await sleep(1500); // entrance choreography (~0.95 s) + camera fade-in
}

/* ------------------------------------------------------------------ */

async function runDesktopPass() {
  const browser = await launchBrowser();
  const page = await newPage(browser, { w: 1536, h: 864 });
  const snap = async (name) => {
    await page.screenshot({ path: join(OUT, name) });
    console.log('shot', name);
  };

  try {
    /* 1 — fresh menu (no save) + entrance frames */
    await gotoMenu(page, { waitMs: 260 });   // mid-entrance (~0.26 s in)
    const midInfo = await page.evaluate(() => {
      const s = window.__WB__.game.scene.getScene('MenuScene');
      return { scale: s.logo.scaleX, target: s.logoScale, alpha: s.logo.alpha };
    });
    await snap('desktop-entrance-mid.png');
    check('entrance: logo below final scale mid-animation',
      midInfo.scale < midInfo.target || midInfo.alpha < 1,
      `scale=${midInfo.scale.toFixed(3)} target=${midInfo.target.toFixed(3)} alpha=${midInfo.alpha.toFixed(2)}`);

    await sleep(1300); // entrance fully settled
    const info = await menuInfo(page);
    check('official background + logo loaded (no fallbacks)',
      info.usingBackgroundArt && info.usingLogoArt);
    check('fresh progress displayed 0/15 · 0/45',
      info.completed === 0 && info.stars === 0);
    await snap('desktop-fresh.png');

    /* 2 — returning player: 6 levels, 15 stars */
    await page.evaluate(() => {
      const s = window.__WB__.save();
      for (let i = 1; i <= 6; i++) s.recordLevelResult(i, 1000 + i, 2 + (i % 2));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoMenuSettled(page);
    const saved = await waitForProgressText(page, { levels: '6/15', stars: '15/45' });
    check('saved progress displayed after return',
      saved.levels.includes('6/15') && saved.stars.includes('15/45'),
      `${saved.levels} | ${saved.stars}`);
    await snap('desktop-with-progress.png');

    /* 3 — reset confirmation popup */
    await clickWorld(page, 640, 680);            // RESET SAVE (LAYOUT.reset.y — hero-PLAY moved it off 566)
    await sleep(500);
    let open = (await menuInfo(page)).dialogOpen;
    check('reset requires confirmation (popup opens, no erase)', open);
    await snap('desktop-reset-popup.png');

    /* 4 — CANCEL preserves progress */
    await clickWorld(page, 488, 458);            // CANCEL
    await sleep(450);
    const afterCancel = await progressTexts(page);
    const savedAfterCancel = await page.evaluate(() => JSON.parse(localStorage.getItem('wordblast.save')));
    check('cancel preserves progress (UI + storage)',
      afterCancel.levels.includes('6/15') && savedAfterCancel.unlockedLevel === 7,
      `${afterCancel.levels} | unlocked=${savedAfterCancel.unlockedLevel}`);

    /* 5 — confirmed reset */
    await clickWorld(page, 640, 680);            // RESET SAVE (LAYOUT.reset.y — hero-PLAY moved it off 566) again
    await sleep(600);
    await clickWorld(page, 800, 458);            // RESET PROGRESS
    const afterReset = await waitForProgressText(page, { levels: '0/15', stars: '0/45' });
    const savedAfterReset = await page.evaluate(() => JSON.parse(localStorage.getItem('wordblast.save')));
    check('confirmed reset clears progress (UI + storage)',
      afterReset.levels.includes('0/15') && afterReset.stars.includes('0/45')
      && savedAfterReset.unlockedLevel === 1 && savedAfterReset.levels['1'] === undefined,
      `${afterReset.levels} | ${afterReset.stars} | unlocked=${savedAfterReset.unlockedLevel}`);
    await snap('desktop-after-reset.png');

    /* 6 — PLAY navigation + rapid-tap guard (on the reset menu) */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 90000 });
    await sleep(1400);
    await clickWorld(page, 640, 472, 20);
    await clickWorld(page, 640, 472, 20);        // second tap races the fade
    await clickWorld(page, 640, 472, 20);
    let levelSelect = false;
    try {
      await page.waitForFunction(() =>
        window.__WB__.game.scene.isActive('LevelSelectScene'), { timeout: 15000, polling: 150 });
      levelSelect = true;
    } catch { /* diagnostics below */ }
    if (!levelSelect) {
      const d = await page.evaluate(() => ({
        menu: window.__WB__.menu(),
        active: window.__WB__.game.scene.getScenes(true).map((s) => s.scene.key)
      }));
      console.log('  [diag] PLAY did not navigate:', JSON.stringify(d));
    }
    await sleep(600);
    const activeScenes = await page.evaluate(() =>
      window.__WB__.game.scene.getScenes(true).map((s) => s.scene.key));
    check('PLAY navigates to level select exactly once (rapid taps guarded)',
      levelSelect && activeScenes.length === 1 && activeScenes[0] === 'LevelSelectScene',
      activeScenes.join(','));

    /* 7 — real return path: LevelSelect → MENU refreshes values */
    await page.evaluate(() => {
      const s = window.__WB__.save();
      s.recordLevelResult(1, 900, 3);
    });
    await clickWorld(page, 80, 60);              // ← MENU
    await page.waitForFunction(() => window.__WB__.menu() && window.__WB__.menu().active, { timeout: 15000, polling: 150 });
    const returned = await waitForProgressText(page, { levels: '1/15', stars: '3/45' });
    check('returning from level select shows latest saved results',
      returned.levels.includes('1/15') && returned.stars.includes('3/45'),
      `${returned.levels} | ${returned.stars}`);
    await snap('desktop-return-with-progress.png');

    check('desktop pass: no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  } catch (e) {
    check('desktop campaign', false, e.message);
  } finally {
    await page.close();
    await browser.close();
  }
}

async function runViewportPass(cfg, name) {
  const browser = await launchBrowser();
  const page = await newPage(browser, cfg);
  try {
    await gotoMenu(page);
    const info = await menuInfo(page);
    check(`${name}: menu active with official art`,
      info.active && info.usingBackgroundArt && info.usingLogoArt);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log('shot', `${name}.png`);
    check(`${name}: no page errors`, page.__errors.length === 0, page.__errors.join(' | '));
  } catch (e) {
    check(`${name} pass`, false, e.message);
  } finally {
    await page.close();
    await browser.close();
  }
}

const main = async () => {
  await runDesktopPass();
  await runViewportPass({ w: 1180, h: 820, mobile: true, touch: true }, 'tablet-landscape-1180x820');
  await runViewportPass({ w: 844, h: 390, mobile: true, touch: true }, 'phone-landscape-844x390');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n== fix21 menu acceptance: ${results.length - failed.length}/${results.length} passed ==`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exitCode = 1;
  }
  console.log('screenshots ->', OUT);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
