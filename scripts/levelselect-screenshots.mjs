/**
 * Fix #23 acceptance screenshots + behavioural checks — boots the REAL
 * built game (vite build output served over HTTP) in Chrome/Edge and
 * captures / verifies the redesigned level-select screen:
 *
 *   - desktop (1536×864): fresh save (L1 highlighted, 2–15 locked),
 *     entrance mid-frame, locked-tap feedback + toast
 *   - desktop: several levels unlocked with saved stars, 3-star level,
 *     next playable highlighted with empty stars
 *   - desktop: newly-unlocked level celebration (returning player)
 *   - desktop: all 15 complete (45/45 ribbon, highlight on L15)
 *   - navigation: locked card never enters gameplay, unlocked card starts
 *     the right level, MENU returns to the main menu, rapid taps guarded
 *   - tablet landscape (1180×820) + phone landscape (844×390)
 *
 * Run:  npm run build && npx vite preview --port 4273
 *       node scripts/levelselect-screenshots.mjs [http://host:port]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'fix23');
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') page.__errors.push(msg.text());
  });
  return page;
}

const lsInfo = (page) => page.evaluate(() => window.__WB__.levelSelect());

/** Boot to the settled main menu. */
async function gotoMenu(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, {
    timeout: 90000
  });
  await sleep(1500); // menu entrance
}

/** Menu → level select through the REAL PLAY path; settle the entrance. */
async function gotoLevelSelect(page, { settleMs = 1600 } = {}) {
  await page.evaluate(() => window.__WB__.game.scene.getScene('MenuScene').scene.start('LevelSelectScene'));
  await page.waitForFunction(() => window.__WB__.levelSelect().active, { timeout: 20000, polling: 150 });
  await sleep(settleMs);
}

/** Click a world-space point through the real canvas (full input path). */
async function clickWorld(page, wx, wy, delay = 40) {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.click(pt.x, pt.y, { delay });
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
    /* 1 — fresh save: level 1 highlighted, everything else locked */
    await gotoMenu(page);
    await page.evaluate(() => window.__WB__.game.scene.getScene('MenuScene').scene.start('LevelSelectScene'));
    await page.waitForFunction(() => window.__WB__.levelSelect().active, { timeout: 20000, polling: 150 });
    await sleep(450); // mid-entrance
    await snap('desktop-entrance-mid.png');
    await sleep(1200);

    let info = await lsInfo(page);
    check('exactly 15 cards rendered', info.cards.length === 15, `${info.cards.length}`);
    check('desktop grid is 5 columns × 3 rows', info.grid.cols === 5 && info.grid.rows === 3,
      `${info.grid.cols}×${info.grid.rows} card ${info.grid.cardW}×${info.grid.cardH}`);
    check('official background art loaded (no fallback)', info.usingBackgroundArt === true);
    const c1 = info.cards.find((c) => c.id === 1);
    const locked = info.cards.filter((c) => !c.unlocked);
    check('level 1 unlocked, highlighted, 0 stars (fresh)', c1.unlocked && c1.highlighted && c1.stars === 0);
    check('levels 2–15 locked (14 padlocks)', locked.length === 14 && locked.every((c) => c.id > 1));
    await snap('desktop-fresh.png');

    /* card names come from the live LevelManager */
    const names = await page.evaluate(() => {
      const s = window.__WB__.game.scene.getScene('LevelSelectScene');
      return [1, 7, 15].map((id) => s.cards.get(id).name.text);
    });
    check('level names come from level data',
      names[0] === 'First Shot' && names[1] === 'Word Order' && names[2] === 'Final Challenge',
      names.join(' | '));

    /* 2 — locked feedback: tap L2 → stays on level select, toast shows */
    const c2pos = info.cards.find((c) => c.id === 2);
    await clickWorld(page, c2pos.x, c2pos.y);
    await sleep(350);
    const afterLockedTap = await page.evaluate(() =>
      window.__WB__.game.scene.getScenes(true).map((s) => s.scene.key));
    info = await lsInfo(page);
    check('locked card never enters gameplay',
      afterLockedTap.length === 1 && afterLockedTap[0] === 'LevelSelectScene');
    check('locked tap shows the unlock hint toast', info.toastVisible === true);
    await snap('desktop-locked-feedback.png');

    /* 3 — unlocked card starts the right level (L1) */
    await clickWorld(page, c1.x, c1.y);
    await page.waitForFunction(() => window.__WB__.state() !== 'scene-pending', { timeout: 20000, polling: 150 });
    const gameInfo = await page.evaluate(() => ({ state: window.__WB__.state(), info: window.__WB__.info() }));
    check('unlocked card launches GameScene level 1',
      gameInfo.state === 'LEVEL_READY' || gameInfo.state === 'QUESTION_READY' || gameInfo.state === 'AIMING',
      gameInfo.state);
    await snap('desktop-level1-started.png');

    /* 4 — MENU returns to the main menu; rapid taps can't double-fire */
    await page.evaluate(() => window.__WB__.game.scene.getScene('GameScene').scene.start('LevelSelectScene'));
    await page.waitForFunction(() => window.__WB__.levelSelect().active, { timeout: 20000, polling: 150 });
    await sleep(1600);
    await clickWorld(page, 110, 54, 20);
    await clickWorld(page, 110, 54, 20); // second tap races the fade
    await page.waitForFunction(() => window.__WB__.menu() && window.__WB__.menu().active, { timeout: 20000, polling: 150 });
    const scenesAfterBack = await page.evaluate(() =>
      window.__WB__.game.scene.getScenes(true).map((s) => s.scene.key));
    check('MENU returns to the main menu exactly once (rapid taps guarded)',
      scenesAfterBack.length === 1 && scenesAfterBack[0] === 'MenuScene', scenesAfterBack.join(','));

    /* 5 — returning player: 6 done (mixed stars incl. 3), L7 next */
    await page.evaluate(() => {
      const s = window.__WB__.save();
      s.recordLevelResult(1, 6000, 3); // three stars on level 1
      s.recordLevelResult(2, 4000, 2);
      s.recordLevelResult(3, 3000, 1);
      s.recordLevelResult(4, 5200, 3);
      s.recordLevelResult(5, 4100, 2);
      s.recordLevelResult(6, 5000, 3);
    });
    await gotoLevelSelect(page);
    info = await lsInfo(page);
    const stars = await page.evaluate(() =>
      [1, 2, 3, 6, 7].map((id) => window.__WB__.levelSelect().cards.find((c) => c.id === id).stars));
    check('stars match the saved best results',
      stars[0] === 3 && stars[1] === 2 && stars[2] === 1 && stars[3] === 3 && stars[4] === 0,
      stars.join(','));
    check('next playable (L7) highlighted, unlocked levels 1–6 not',
      info.highlightId === 7 && info.cards.find((c) => c.id === 7).highlighted
      && info.cards.find((c) => c.id === 1).highlighted === false);
    check('uncompleted L7 shows empty stars', info.cards.find((c) => c.id === 7).stars === 0);
    await snap('desktop-with-progress.png');

    /* 6 — genuinely-new unlock celebration on the returning path */
    await clickWorld(page, 110, 54); // MENU
    await page.waitForFunction(() => window.__WB__.menu().active, { timeout: 20000, polling: 150 });
    await page.evaluate(() => window.__WB__.save().recordLevelResult(7, 5500, 2));
    await page.evaluate(() => window.__WB__.game.scene.getScene('MenuScene').scene.start('LevelSelectScene'));
    await page.waitForFunction(() => window.__WB__.levelSelect().active, { timeout: 20000, polling: 150 });
    info = await lsInfo(page);
    check('returning visit flags the newly unlocked level', info.celebrationId === 8, `celeb=${info.celebrationId}`);
    await sleep(2100); // celebration scheduled ~1.4s in, plays ~0.6s
    info = await lsInfo(page);
    const c8 = info.cards.find((c) => c.id === 8);
    check('celebration reveals card 8 unlocked + highlighted',
      c8.unlocked && c8.highlighted, `unlocked=${c8.unlocked} hi=${c8.highlighted}`);
    await snap('desktop-new-unlock.png');

    /* 7 — same unlock never re-animates */
    await clickWorld(page, 110, 54);
    await page.waitForFunction(() => window.__WB__.menu().active, { timeout: 20000, polling: 150 });
    await gotoLevelSelect(page, { settleMs: 400 });
    info = await lsInfo(page);
    check('the same unlock is never re-animated', info.celebrationId === 0, `celeb=${info.celebrationId}`);

    /* 8 — everything completed */
    await page.evaluate(() => {
      const s = window.__WB__.save();
      for (let id = 9; id <= 15; id++) s.recordLevelResult(id, 5000 + id, 3);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoMenu(page);
    await gotoLevelSelect(page);
    info = await lsInfo(page);
    check('all-complete: every card unlocked with 3 stars',
      info.cards.every((c) => c.unlocked && c.stars === 3));
    check('all-complete: highlight falls on level 15 (save untouched)',
      info.highlightId === 15 && info.cards.find((c) => c.id === 15).highlighted);
    await snap('desktop-all-complete.png');

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
    await page.evaluate(() => window.__WB__.save().recordLevelResult(1, 6000, 3));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoMenu(page);
    await gotoLevelSelect(page);
    const info = await lsInfo(page);
    check(`${name}: 15 cards, 5×3 grid, L2 highlighted`,
      info.cards.length === 15 && info.grid.cols === 5 && info.highlightId === 2);
    // all cards inside the visible view (fit-world guarantee)
    const vis = await page.evaluate(() => {
      const s = window.__WB__.game.scene.getScene('LevelSelectScene');
      const v = s.__wbView;
      return { vw: v.width, vh: v.height };
    });
    const insideView = info.cards.every((c) =>
      c.x - info.grid.cardW / 2 >= 0 && c.x + info.grid.cardW / 2 <= 1280 && c.y + info.grid.cardH / 2 <= 720);
    check(`${name}: whole grid visible without scrolling (view ${Math.round(vis.vw)}×${Math.round(vis.vh)})`, insideView);
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
  console.log(`\n== fix23 level-select acceptance: ${results.length - failed.length}/${results.length} passed ==`);
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
