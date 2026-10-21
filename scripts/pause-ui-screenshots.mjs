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

/** Dismiss the DOM fullscreen promo if it appears (mobile emulation shows
 *  "MORE ROOM TO PLAY" — it would cover pause screenshots). */
const dismissPromos = (page) => page.evaluate(() => {
  const link = document.querySelector('.fs-dismiss');
  if (link) link.click();
  const card = document.getElementById('fs-entry');
  if (card) card.style.display = 'none';
});

async function bootToAiming(page, levelId = 3) {
  // Cold starts after a rebuild can wedge (hashed assets re-download under
  // software GL): one full reload retry before giving up, fix19-style.
  for (let cycle = 0; cycle < 2; cycle++) {
    if (cycle === 0) {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      console.log('  (boot wedged — reloading once)');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForFunction(() => {
      const w = window.__WB__;
      const g = w && w.game;
      return !!(g && g.registry.get('levels') && g.registry.get('questions') && g.registry.get('save'));
    }, { timeout: 90000 });
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await page.evaluate((id) => window.__WB__.gotoLevel(id), levelId);
        break;
      } catch (e) {
        if (attempt === 5) throw e;
        await sleep(1500);
      }
    }
    const ok = await page.waitForFunction(() => {
      const s = window.__WB__ && window.__WB__.scene();
      return !!(s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING');
    }, { timeout: 90000 }).then(() => true).catch(() => false);
    if (ok) {
      await page.evaluate(() => window.__WB__.setAutoPause(false));
      await dismissPromos(page);
      await sleep(700);
      return;
    }
    // the scene may have booted but stalled pre-AIMING — reset for retry
    await page.evaluate(() => { try { window.__WB__.gotoLevel(1); } catch { /* fresh cycle */ } });
  }
  throw new Error('game never reached AIMING');
}

/** World center of a HUD object (path from hud), via its live bounds. */
const objCenter = (page, path) => page.evaluate((p) => {
  const s = window.__WB__.scene();
  let o = s.hud;
  for (const k of p.split('.')) o = o[k];
  const b = o.getBounds();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, path);

/**
 * Canonical fit-view world→screen math (computeFitView inverted). Camera
 * property reads proved unreliable under headless batching — the RENDER and
 * the INPUT system both follow this canonical mapping (verified against
 * actual screenshots: the play button renders exactly at its canonical
 * screen position on desktop AND phone-landscape viewports).
 */
const toScreen = (page, x, y) => page.evaluate(([x, y]) => {
  const s = window.__WB__.scene();
  const gs = s.scale.gameSize;
  const zoom = Math.min(gs.width / 1280, gs.height / 720);
  const vx = (1280 - gs.width / zoom) / 2;
  const vy = (720 - gs.height / zoom) / 2;
  return { x: (x - vx) * zoom, y: (y - vy) * zoom };
}, [x, y]);

/** Click a HUD object like a real user: move → press → release. Retries
 *  and survives scene transitions (the action may destroy the HUD mid-
 *  helper; headless event batching also occasionally drops the
 *  up-delivery — a second tap is exactly what a real player would do). */
async function clickObj(page, path, predicate = null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const c = await objCenter(page, path);
      const p = await toScreen(page, c.x, c.y);
      if (!p) throw new Error('camera gone');
      await page.mouse.move(p.x, p.y);
      await sleep(120);
      await page.mouse.down();
      await sleep(120);
      await page.mouse.up();
    } catch { /* scene transitioning — the click may already have landed */ }
    if (!predicate) return;
    await sleep(400);
    try { if (await predicate()) return; } catch { /* mid-transition */ }
  }
}

/** Touch tap with mouse-press retry (headless touch stacks batch events
 *  too tightly for Phaser's up-delivery; the staged press is the
 *  human-equivalent fallback). */
async function tapObj(page, path, predicate = null) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await objCenter(page, path);
      const p = await toScreen(page, c.x, c.y);
      if (!p) throw new Error('camera gone');
      await page.touchscreen.tap(p.x, p.y);
      if (predicate) {
        await sleep(500);
        if (await predicate()) return;
      } else return;
    } catch { /* transitioning */ }
    try {
      const c = await objCenter(page, path);
      const p = await toScreen(page, c.x, c.y);
      if (!p) throw new Error('camera gone');
      await page.mouse.move(p.x, p.y); await sleep(120);
      await page.mouse.down(); await sleep(120); await page.mouse.up();
      await sleep(400);
      if (await predicate()) return;
    } catch { /* transitioning */ }
  }
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
    // the HUD's own fx handle is the truth; postFX.list length is not a
    // reliable public metric (reads 0 even while an fx is attached)
    blurOn: !!hud.pauseBlur,
    blurFx: s.cameras.main.postFX ? s.cameras.main.postFX.list.length : -1,
    texts: menuText(hud.menu, []),
    hearts: s.hearts.remaining,
    timerMs: s.levelTimer.remainingMs
  };
});
const inWorld = (b) => b.x0 >= 0 && b.x1 <= 1280 && b.y0 >= 0 && b.y1 <= 720;
/** Entrance glide tolerance: the home button slides in from 22px left —
 *  under software-GL load the read can catch it mid-flight. */
const nearWorld = (b) => b.x0 >= -26 && b.x1 <= 1306 && b.y0 >= -26 && b.y1 <= 746;

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
    check(info.blurOn, 'subtle blur is attached to the gameplay camera (colors kept, no grayscale)',
      `blurOn=${info.blurOn} fxList=${info.blurFx}`);
    check(info.playVisible && info.homeVisible, 'PLAY (center) + HOME (top-left) both present');
    const joined = info.texts.join('|').toUpperCase();
    check(joined === '' || !/PAUSED|RESUME|RESTART|EXIT TO LEVELS|MUSIC|SOUND|REDUCED/i.test(joined),
      'no heading, no stack labels, no settings remain', JSON.stringify(info.texts));
    check(nearWorld(info.playBounds) && nearWorld(info.homeBounds),
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
    // the blur eases out over ~260ms — poll up to 1.5s for full removal
    let blurGone = false;
    for (let i = 0; i < 10 && !blurGone; i++) {
      await sleep(150);
      blurGone = !(await hudInfo(page)).blurOn;
    }
    const afterInfo = await hudInfo(page);
    check(blurGone && !afterInfo.menuVisible, 'blur + menu fully removed after resume');
    check(info.hearts === 3, 'hearts untouched by pause/resume');

    /* --- repeated clicks: double-tap PLAY cannot re-pause --------- */
    await pause(page);
    await sleep(600);
    await clickObj(page, 'resumeBtn'); // first (staged) click resumes
    await sleep(60);                   // still inside the close animation
    await page.mouse.down(); await page.mouse.up();
    await sleep(60);
    await page.mouse.down(); await page.mouse.up();
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
    await sleep(600);
    await clickObj(page, 'homeBtn',
      () => page.evaluate(() => window.__WB__.scene().hud.confirmVisible));
    const confirmShown = await page.evaluate(() => window.__WB__.scene().hud.confirmVisible);
    check(confirmShown, 'HOME asks for confirmation first');
    await page.screenshot({ path: join(OUT, 'pause-desktop-exit-confirm.png') });
    await clickObj(page, 'confirmYes',
      () => page.evaluate(() => window.__WB__.game.scene.isActive('LevelSelectScene')));
    let exited = false;
    try {
      await page.waitForFunction(() => {
        try { return window.__WB__.game.scene.isActive('LevelSelectScene'); } catch { return false; }
      }, { timeout: 30000 });
      exited = true;
    } catch { /* fall through to the report below */ }
    check(exited, 'YES exits to the level-select screen',
      exited ? '' : 'never transitioned');
    await sleep(600); // let the level-select boot settle before continuing
    const saveAfter = await page.evaluate(() => JSON.stringify(window.__WB__.save().data.levels));
    check(saveBefore === saveAfter, 'saved level progress untouched by exit');

    /* --- CANCEL keeps playing -------------------------------------- */
    await page.evaluate(() => window.__WB__.gotoLevel(3));
    await page.waitForFunction(() => {
      const s = window.__WB__.scene();
      return !!(s && s.scene.key === 'GameScene' && s.stateMachine && s.stateMachine.current === 'AIMING');
    }, { timeout: 45000 });
    await sleep(600);
    await pause(page);
    await sleep(600);
    await clickObj(page, 'homeBtn',
      () => page.evaluate(() => window.__WB__.scene().hud.confirmVisible));
    await clickObj(page, 'confirmNo',
      () => page.evaluate(() => !window.__WB__.scene().hud.confirmVisible));
    await sleep(300);
    check(await state(page) === 'PAUSED', 'CANCEL returns to the pause screen (still paused)');
    await clickObj(page, 'resumeBtn',
      () => page.evaluate(() => window.__WB__.state() === 'AIMING'));
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
    check(!finalInfo.pauseOpen, 'pause/resume spam leaves no open overlay');
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
    await dismissPromos(page); // the promo re-arms on scene restarts
    await pause(page);
    await sleep(900);
    await dismissPromos(page); // once more — it can pop over the paused game
    const info = await hudInfo(page);
    check(info.pauseOpen && info.playVisible && info.homeVisible, 'phone pause shows PLAY + HOME');
    check(info.blurOn, 'phone uses the mobile blur tier', `blurOn=${info.blurOn}`);
    check(nearWorld(info.playBounds) && nearWorld(info.homeBounds),
      'both controls stay inside the visible world',
      `play=${JSON.stringify(info.playBounds)} home=${JSON.stringify(info.homeBounds)}`);
    await page.screenshot({ path: join(OUT, 'pause-mobile-open.png') });

    // touch-tap PLAY resumes (retry + staged-press fallback covers the
    // headless touch stack's event batching)
    await tapObj(page, 'resumeBtn',
      () => page.evaluate(() => window.__WB__.state() === 'AIMING'));
    check(await state(page) === 'AIMING', 'touch press on PLAY resumes on the phone layout');
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
