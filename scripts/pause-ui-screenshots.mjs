/**
 * Pause-screen redesign acceptance — boots the REAL built game (vite build
 * output served over HTTP) in Chrome/Edge and verifies + captures:
 *
 *   desktop (1280×720):
 *     - pause open: frozen gameplay, dark scrim + blur (exactly ONE post-fx
 *       — the old grayscale is gone), central wooden PLAY button, and the
 *       RESUME / RESTART LEVEL / EXIT TO LEVELS stack beneath it
 *     - REAL mouse click on PLAY resumes (exact prior state, blur removed)
 *     - REAL click on RESUME resumes as well
 *     - repeated clicks on PLAY during the close-out never re-pause
 *     - countdown timer frozen while paused
 *     - REAL click on RESTART LEVEL restarts the level cleanly
 *     - REAL click on EXIT TO LEVELS → confirm card → YES → level select,
 *       saved progress untouched; CANCEL returns to the pause screen
 *     - rapid pause/resume spam leaves no duplicate overlay or blur
 *     - screenshots: open state + exit confirmation
 *   mobile (844×390 landscape, touch):
 *     - pause open screenshot (scaled phone stack, everything in view)
 *     - touch tap on PLAY resumes
 *
 * Run:  node scripts/pause-ui-screenshots.mjs [http://host:port]
 * (defaults to the vite preview server on :4273)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'pause-ui');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:4273';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const check = (ok, name, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? passed++ : failed++;
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

async function newPage(browser, { w, h, mobile = false, touch = false }) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: touch });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  return page;
}

async function bootToAiming(page, levelId = 3) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene()
    && window.__WB__.save() !== null, { timeout: 90000 });
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
  }, { timeout: 90000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  await sleep(700);
}

/**
 * World center of a HUD object (path from hud), via its live bounds — the
 * phone stack is scaled/offset, so hardcoded offsets would be wrong there.
 */
const objCenter = (page, path) => page.evaluate((p) => {
  const s = window.__WB__.scene();
  let o = s.hud;
  for (const k of p.split('.')) o = o[k];
  const b = o.getBounds();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, path);

/** Click/tap a HUD object at its real rendered position. */
async function clickObj(page, path) {
  const c = await objCenter(page, path);
  const p = await page.evaluate(([x, y]) => {
    const cam = window.__WB__.scene().hud.uiCam;
    return { x: (x - cam.scrollX) * cam.zoom + cam.x, y: (y - cam.scrollY) * cam.zoom + cam.y };
  }, [c.x, c.y]);
  await page.mouse.click(p.x, p.y);
}

async function tapObj(page, path) {
  const c = await objCenter(page, path);
  const p = await page.evaluate(([x, y]) => {
    const cam = window.__WB__.scene().hud.uiCam;
    return { x: (x - cam.scrollX) * cam.zoom + cam.x, y: (y - cam.scrollY) * cam.zoom + cam.y };
  }, [c.x, c.y]);
  await page.touchscreen.tap(p.x, p.y);
}

const pause = (page) => page.evaluate(() => window.__WB__.scene().doPause());
const state = (page) => page.evaluate(() => window.__WB__.state());
const hudInfo = (page) => page.evaluate(() => {
  const s = window.__WB__.scene();
  const hud = s.hud;
  const menuText = (o, acc) => {
    if (!o) return acc;
    if (o.text) acc.push(o.text);
    if (o.list) for (const c of o.list) menuText(c, acc);
    return acc;
  };
  return {
    pauseOpen: hud.pauseOpen,
    menuVisible: hud.menu.visible,
    stackVisible: hud.pauseStack.map((b) => !!b.visible),
    stackBounds: hud.pauseStack.map((b) => {
      const bb = b.getBounds();
      return { x0: bb.x, y0: bb.y, x1: bb.x + bb.width, y1: bb.y + bb.height };
    }),
    blurFx: s.cameras.main.postFX ? s.cameras.main.postFX.list.length : -1,
    texts: menuText(hud.menu, []),
    hearts: s.hearts.remaining,
    shots: s.shotsLeft,
    timerMs: s.levelTimer.remainingMs
  };
});

async function desktopPass() {
  console.log('\n== desktop 1280×720 =======================================');
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: 'new',
    args: ['--use-gl=angle', '--enable-webgl', '--window-size=1280,720']
  });
  try {
    const page = await newPage(browser, { w: 1280, h: 720 });
    await bootToAiming(page, 3);

    /* --- open: freeze + scrim + blur + full control stack --------- */
    await pause(page);
    await sleep(750); // entrance choreography finishes
    let info = await hudInfo(page);
    check(await state(page) === 'PAUSED', 'pause freezes the game (state PAUSED)');
    check(info.pauseOpen && info.menuVisible, 'pause menu visible');
    check(info.blurFx === 1, 'gameplay camera carries exactly ONE post-fx (blur only, grayscale gone)',
      `fx=${info.blurFx}`);
    check(info.stackVisible.length === 4 && info.stackVisible.every(Boolean),
      'PLAY + RESUME + RESTART + EXIT all present');
    const joined = info.texts.join('|').toUpperCase();
    check(!joined.includes('PAUSED'), 'no PAUSED heading remains');
    check(!/music|sound|fx toggle|reduced|vibration|volume/i.test(joined), 'no settings labels remain');
    check(joined.includes('RESUME') && joined.includes('RESTART LEVEL')
      && joined.includes('EXIT TO LEVELS'), 'the three reference controls are labeled');
    const inWorld = info.stackBounds.every((b) => b.x0 >= 0 && b.x1 <= 1280 && b.y0 >= 0 && b.y1 <= 720);
    check(inWorld, 'every control sits inside the visible world',
      JSON.stringify(info.stackBounds));
    await page.screenshot({ path: join(OUT, 'pause-desktop-open.png') });

    /* --- PLAY resumes --------------------------------------------- */
    await clickObj(page, 'resumeBtn');
    await sleep(120);
    const early = await hudInfo(page);
    check(early.pauseOpen === false, 'PLAY click closes the pause immediately');
    await sleep(350);
    check(await state(page) === 'AIMING', 'PLAY click resumes into the exact prior state (AIMING)');
    info = await hudInfo(page);
    check(info.blurFx === 0 && !info.menuVisible, 'blur + menu fully removed after resume', `fx=${info.blurFx}`);
    check(info.hearts === 3, 'hearts untouched by pause/resume');

    /* --- repeated clicks: double-tap PLAY cannot re-pause --------- */
    await pause(page);
    await sleep(450);
    const p = await objCenter(page, 'resumeBtn');
    const scr = await page.evaluate(([x, y]) => {
      const cam = window.__WB__.scene().hud.uiCam;
      return { x: (x - cam.scrollX) * cam.zoom + cam.x, y: (y - cam.scrollY) * cam.zoom + cam.y };
    }, [p.x, p.y]);
    await page.mouse.click(scr.x, scr.y);
    await sleep(60);   // still inside the close animation
    await page.mouse.click(scr.x, scr.y);
    await sleep(60);
    await page.mouse.click(scr.x, scr.y);
    await sleep(450);
    check(await state(page) === 'AIMING' && !(await hudInfo(page)).pauseOpen,
      'repeated clicks during close-out never re-pause');

    /* --- RESUME button resumes ------------------------------------ */
    await pause(page);
    await sleep(450);
    await clickObj(page, 'resumeMenuBtn');
    await sleep(400);
    check(await state(page) === 'AIMING', 'RESUME button resumes the game');

    /* --- timer freeze check --------------------------------------- */
    await pause(page);
    await sleep(300);
    const t0 = (await hudInfo(page)).timerMs;
    await sleep(900);
    const t1 = (await hudInfo(page)).timerMs;
    check(t1 <= t0 + 30, 'countdown timer frozen while paused', `${t0} → ${t1}`);
    await clickObj(page, 'resumeBtn'); // back in via PLAY
    await sleep(400);

    /* --- RESTART LEVEL -------------------------------------------- */
    await pause(page);
    await sleep(450);
    await clickObj(page, 'restartBtn');
    let ok = true;
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 })
      .catch(() => { ok = false; });
    check(ok, 'RESTART LEVEL boots the level back to AIMING');
    await sleep(400);
    const lvl = await page.evaluate(() => window.__WB__.scene().levelId);
    check(lvl === 3, 'restart keeps the same level id', `level=${lvl}`);
    info = await hudInfo(page);
    check(info.hearts === 3 && !info.pauseOpen && info.blurFx === 0,
      'restart leaves a clean unfrozen HUD (no duplicate overlay)');

    /* --- EXIT TO LEVELS (confirm + saved progress) ----------------- */
    const saveBefore = await page.evaluate(() => JSON.stringify(window.__WB__.save().data.levels));
    await pause(page);
    await sleep(450);
    await clickObj(page, 'exitBtn');
    await sleep(350);
    const confirmShown = await page.evaluate(() => window.__WB__.scene().hud.confirmVisible);
    check(confirmShown, 'EXIT asks for confirmation first');
    await page.screenshot({ path: join(OUT, 'pause-desktop-exit-confirm.png') });
    await clickObj(page, 'confirmYes');
    await sleep(700);
    const sceneKey = await page.evaluate(() => window.__WB__.scene().scene.key);
    check(sceneKey === 'LevelSelectScene', 'YES exits to the level-select screen', sceneKey);
    const saveAfter = await page.evaluate(() => JSON.stringify(window.__WB__.save().data.levels));
    check(saveBefore === saveAfter, 'saved level progress untouched by exit');

    /* --- CANCEL keeps playing -------------------------------------- */
    await page.evaluate(() => window.__WB__.gotoLevel(3));
    await page.waitForFunction(() => {
      const s = window.__WB__.scene();
      return s && s.scene.key === 'GameScene' && s.stateMachine.current === 'AIMING';
    }, { timeout: 30000 });
    await sleep(500);
    await pause(page);
    await sleep(450);
    await clickObj(page, 'exitBtn');
    await sleep(300);
    await clickObj(page, 'confirmNo');
    await sleep(300);
    check(await state(page) === 'PAUSED', 'CANCEL returns to the pause screen (still paused)');
    await clickObj(page, 'resumeBtn'); // PLAY still resumes after cancel
    await sleep(400);
    check(await state(page) === 'AIMING', 'PLAY resumes after a cancelled exit');

    /* --- rapid pause/resume spam: no duplicate overlays ------------- */
    for (let i = 0; i < 3; i++) {
      await pause(page);
      await sleep(60);
      await page.keyboard.press('P'); // resume
      await sleep(60);
    }
    await sleep(500);
    const finalInfo = await hudInfo(page);
    check(finalInfo.blurFx <= 1 && !finalInfo.pauseOpen,
      'pause/resume spam leaves no overlay and at most the fading blur', `fx=${finalInfo.blurFx}`);
    check(await state(page) === 'AIMING', 'game playable after pause/resume spam');
  } finally {
    await browser.close();
  }
}

async function mobilePass() {
  console.log('\n== mobile 844×390 landscape (touch) ========================');
  const browser = await puppeteer.launch({
    executablePath: findBrowser(), headless: 'new',
    args: ['--use-gl=angle', '--enable-webgl', '--window-size=844,390']
  });
  try {
    const page = await newPage(browser, { w: 844, h: 390, mobile: true, touch: true });
    await bootToAiming(page, 3);
    await pause(page);
    await sleep(750);
    const info = await hudInfo(page);
    check(info.pauseOpen && info.stackVisible.every(Boolean), 'phone pause stack fully visible');
    check(info.blurFx === 1, 'phone uses the mobile blur tier', `fx=${info.blurFx}`);
    const inWorld = info.stackBounds.every((b) => b.x0 >= 0 && b.x1 <= 1280 && b.y0 >= 0 && b.y1 <= 720);
    check(inWorld, 'scaled phone stack stays inside the visible world',
      JSON.stringify(info.stackBounds));
    await page.screenshot({ path: join(OUT, 'pause-mobile-open.png') });

    // touch-tap PLAY resumes
    await tapObj(page, 'resumeBtn');
    await sleep(500);
    check(await state(page) === 'AIMING', 'touch tap on PLAY resumes on the phone layout');
  } finally {
    await browser.close();
  }
}

const main = async () => {
  const pass = process.argv[3] || 'all';
  if (pass === 'all' || pass === 'desktop') await desktopPass();
  if (pass === 'all' || pass === 'mobile') await mobilePass();
  console.log(`\n${passed} passed, ${failed} failed -> ${OUT}`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
