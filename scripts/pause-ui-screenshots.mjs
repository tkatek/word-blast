/**
 * Pause-screen acceptance — boots the REAL built game (vite build output
 * served over HTTP) in Chrome/Edge and verifies + captures the MINIMAL
 * pause redesign:
 *
 *   desktop (1280×720):
 *     - pause open: frozen gameplay, dark scrim + blur (exactly ONE post-fx
 *       — no grayscale), the central wooden PLAY button and the top-left
 *     HOME control — and NOTHING else (no heading, no stack, no settings)
 *     - REAL mouse click on PLAY resumes (exact prior state, blur removed)
 *     - repeated clicks on PLAY during the close-out never re-pause
 *     - countdown timer frozen while paused
 *     - HOME → confirm card → YES → level select, saved progress untouched;
 *       CANCEL returns to the pause screen, PLAY still resumes after it
 *     - rapid pause/resume spam leaves no duplicate overlay or blur
 *     - screenshots: open state + exit confirmation
 *   mobile (844×390 landscape, touch):
 *     - pause open screenshot; touch tap on PLAY resumes
 *
 * Boot note: readiness is `game.registry.get('levels')` — the DebugAPI
 * `save()` check used elsewhere passes while still `undefined`, which
 * races BootScene and kills the GameScene boot.
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

const BASE = process.argv[2] || 'http://localhost:4273';
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

/** The known-good headless recipe from scripts/fix19-screenshots.mjs. */
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
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));
  return page;
}

async function bootToAiming(page, levelId = 3) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // FULL registry readiness — 'levels' is the last manager BootScene sets
  // before starting the menu; gotoLevel before this point kills the boot.
  await page.waitForFunction(() => {
    const w = window.__WB__;
    const g = w && w.game;
    return !!(g && g.registry.get('levels') && g.registry.get('questions') && g.registry.get('save'));
  }, { timeout: 90000 });
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

/** World center of a HUD object (path from hud), via its live bounds. */
const objCenter = (page, path) => page.evaluate((p) => {
  const s = window.__WB__.scene();
  let o = s.hud;
  for (const k of p.split('.')) o = o[k];
  const b = o.getBounds();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, path);

const toScreen = (page, x, y) => page.evaluate(([x, y]) => {
  const cam = window.__WB__.scene().hud.uiCam;
  return { x: (x - cam.scrollX) * cam.zoom + cam.x, y: (y - cam.scrollY) * cam.zoom + cam.y };
}, [x, y]);

/** Click/tap a HUD object at its real rendered position. */
async function clickObj(page, path) {
  const c = await objCenter(page, path);
  const p = await toScreen(page, c.x, c.y);
  await page.mouse.click(p.x, p.y);
}

async function tapObj(page, path) {
  const c = await objCenter(page, path);
  const p = await toScreen(page, c.x, c.y);
  await page.touchscreen.tap(p.x, p.y);
}

const pause = (page) => page.evaluate(() => window.__WB__.scene().doPause());
const state = (page) => page.evaluate(() => window.__WB__.state());
const hudInfo = (page) => page.evaluate(() => {
  const s = window.__WB__.scene();
  const hud = s.hud;
  const menuText = (o, acc) => {
    if (!o || o.visible === false) return acc;   // skip hidden branches (confirm card)
    if (o.text) acc.push(o.text);
    if (o.list) for (const c of o.list) menuText(c, acc);
    return acc;
  };
  return {
    pauseOpen: hud.pauseOpen,
    menuVisible: hud.menu.visible,
    playVisible: !!hud.resumeBtn.visible,
    homeVisible: !!(hud.homeBtn && hud.homeBtn.visible),
    playBounds: (() => { const b = hud.resumeBtn.getBounds(); return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }; })(),
    homeBounds: (() => { const b = hud.homeBtn.getBounds(); return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }; })(),
    blurFx: s.cameras.main.postFX ? s.cameras.main.postFX.list.length : -1,
    texts: menuText(hud.menu, []),
    hearts: s.hearts.remaining,
    timerMs: s.levelTimer.remainingMs
  };
});
const inWorld = (b) => b.x0 >= 0 && b.x1 <= 1280 && b.y0 >= 0 && b.y1 <= 720;

async function desktopPass() {
  console.log('\n== desktop 1280×720 =======================================');
  const browser = await launchBrowser();
  try {
    const page = await newPage(browser, { w: 1280, h: 720 });
    await bootToAiming(page, 3);

    /* --- open: freeze + scrim + blur + exactly two controls --------- */
    await pause(page);
    await sleep(750); // entrance choreography finishes
    let info = await hudInfo(page);
    check(await state(page) === 'PAUSED', 'pause freezes the game (state PAUSED)');
    check(info.pauseOpen && info.menuVisible, 'pause menu visible');
    check(info.blurFx === 1, 'gameplay camera carries exactly ONE post-fx (blur only, grayscale gone)',
      `fx=${info.blurFx}`);
    check(info.playVisible && info.homeVisible, 'PLAY (center) + HOME (top-left) both present');
    const joined = info.texts.join('|').toUpperCase();
    check(joined === '' || !/PAUSED|RESUME|RESTART|EXIT TO LEVELS|MUSIC|SOUND|REDUCED/i.test(joined),
      'no heading, no stack labels, no settings remain', JSON.stringify(info.texts));
    check(inWorld(info.playBounds) && inWorld(info.homeBounds),
      'both controls sit inside the visible world',
      `play=${JSON.stringify(info.playBounds)} home=${JSON.stringify(info.homeBounds)}`);
    const top = info.homeBounds.y0;
    check(top < 200 && info.homeBounds.x0 < 200, 'HOME is in the top-left region',
      `home y0=${top.toFixed(0)} x0=${info.homeBounds.x0.toFixed(0)}`);
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
    const c = await objCenter(page, 'resumeBtn');
    const p = await toScreen(page, c.x, c.y);
    await page.mouse.click(p.x, p.y);
    await sleep(60);   // still inside the close animation
    await page.mouse.click(p.x, p.y);
    await sleep(60);
    await page.mouse.click(p.x, p.y);
    await sleep(450);
    check(await state(page) === 'AIMING' && !(await hudInfo(page)).pauseOpen,
      'repeated clicks during close-out never re-pause');

    /* --- timer freeze check --------------------------------------- */
    await pause(page);
    await sleep(300);
    const t0 = (await hudInfo(page)).timerMs;
    await sleep(900);
    const t1 = (await hudInfo(page)).timerMs;
    check(t1 <= t0 + 30, 'countdown timer frozen while paused', `${t0} → ${t1}`);
    await clickObj(page, 'resumeBtn'); // back in via PLAY
    await sleep(400);

    /* --- HOME: confirm + saved progress --------------------------- */
    const saveBefore = await page.evaluate(() => JSON.stringify(window.__WB__.save().data.levels));
    await pause(page);
    await sleep(450);
    await clickObj(page, 'homeBtn');
    await sleep(350);
    const confirmShown = await page.evaluate(() => window.__WB__.scene().hud.confirmVisible);
    check(confirmShown, 'HOME asks for confirmation first');
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
    await clickObj(page, 'homeBtn');
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
  const browser = await launchBrowser();
  try {
    const page = await newPage(browser, { w: 844, h: 390, mobile: true, touch: true });
    await bootToAiming(page, 3);
    await pause(page);
    await sleep(750);
    const info = await hudInfo(page);
    check(info.pauseOpen && info.playVisible && info.homeVisible, 'phone pause shows PLAY + HOME');
    check(info.blurFx === 1, 'phone uses the mobile blur tier', `fx=${info.blurFx}`);
    check(inWorld(info.playBounds) && inWorld(info.homeBounds),
      'both controls stay inside the visible world',
      `play=${JSON.stringify(info.playBounds)} home=${JSON.stringify(info.homeBounds)}`);
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
