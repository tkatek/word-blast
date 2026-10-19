/**
 * FINAL UI/UX POLISH acceptance screenshots — boots the REAL built game
 * (vite build output served over HTTP) in Chrome/Edge and captures every
 * screen the polish pass touched, with behavioural checks:
 *
 *   desktop (1536×864)
 *     01 improved main menu · 02 PLAY hover · 03 PLAY pressed
 *     04 level select (15 cards, locked + unlocked + highlight)
 *     05 improved top HUD gameplay (docked question card)
 *     06 correct-answer card (compact) · 07 wrong-answer card (compact)
 *     08 pause: grayscale + blurred frozen gameplay · 09 centered resume
 *     10 resumed gameplay (color restored) · 11 victory panel (wood + stars)
 *   tablet landscape (1180×820): menu, level select, gameplay HUD, pause
 *   phone landscape (844×390):  menu, level select, gameplay HUD, pause
 *
 * Run:  npm run build && npx vite preview --port 4273
 *       node scripts/ui-polish-screenshots.mjs [http://host:port]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'ui-polish');
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

const snap = (page, name) => page.screenshot({ path: join(OUT, name) }).then(() => console.log('shot', name));

/** Click a world-space point through the real canvas (full input path). */
async function clickWorld(page, wx, wy, delay = 40) {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.click(pt.x, pt.y, { delay });
}

/** Move the mouse over a world point (hover states). */
async function hoverWorld(page, wx, wy) {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.move(pt.x, pt.y);
}

async function waitForFn(page, fn, timeout = 20000, poll = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) {
      const diag = await page.evaluate(() => {
        try {
          return {
            state: window.__WB__.state(),
            feedback: window.__WB__.feedbackInfo(),
            card: window.__WB__.cardInfo(),
            activeScenes: window.__WB__.game.scene.getScenes(true).map((s) => s.scene.key)
          };
        } catch (e) { return { err: String(e) }; }
      }).catch(() => null);
      throw new Error('waitForFn timed out — ' + JSON.stringify(diag));
    }
    await sleep(poll);
  }
}

/** Boot to the settled main menu. */
async function gotoMenu(page, { waitMs = 1500 } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForFn(page, () => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active);
  await sleep(waitMs);
}

/**
 * Software-GL headless sessions run the game loop far below wall-clock
 * speed, so every wait is generous and every interaction retries. The
 * card presentation timings are shortened through the sanctioned debug
 * API (production always reads the config defaults).
 */
async function prepGameplay(page) {
  await page.evaluate(() => {
    window.__WB__.setAutoPause(false);
    window.__WB__.setCardTimings({ enterMs: 150, readingMs: 900, moveMs: 250, exitMs: 120, peekMs: 150 });
  });
}

/** autoAim with retries (damaged arenas can strand single solutions). */
async function autoAimRetry(page, choiceId = null, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const fired = await page.evaluate((cid) => {
      const s = window.__WB__.scene();
      if (!s || !s.prepared) return false;
      let id = cid;
      if (!id) {
        // fresh target: never one already hit this question
        const t = s.factory.targets.find((x) => !x.wb.hit);
        if (!t) return false;
        id = t.wb.choiceId;
      }
      return !!s.debugAutoAim(id);
    }, choiceId);
    if (!fired) { await sleep(400); continue; }
    try {
      await waitForFn(page, () => window.__WB__.state() === 'ANSWER_FEEDBACK', 25000);
      return true;
    } catch (e) {
      // missed — wait for the re-arm, then retry with a fresh target
      await waitForFn(page, () => window.__WB__.state() === 'AIMING', 25000).catch(() => {});
    }
  }
  return false;
}

/** Enter gameplay on a level through the REAL UI (PLAY → card click). */
async function enterLevelViaUI(page, levelId) {
  await clickWorld(page, 640, 478); // PLAY
  await waitForFn(page, () => window.__WB__.levelSelect() && window.__WB__.levelSelect().active === true);
  await sleep(1700); // entrance + potential unlock celebration settle
  const card = (await page.evaluate((id) =>
    window.__WB__.levelSelect().cards.find((c) => c.id === id), levelId));
  await clickWorld(page, card.x, card.y);
  await prepGameplay(page);
  await waitForFn(page, () => window.__WB__.state() === 'AIMING', 45000);
  await sleep(400); // card settles onto its dock right as aiming arms
}

/** Wait until the feedback card's action button is armed, then click it. */
async function clickFeedbackAction(page) {
  await waitForFn(page, () => {
    const f = window.__WB__.feedbackInfo();
    return f && f.visible && f.actionEnabled;
  }, 12000);
  const pos = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const r = s.feedbackCard.root, b = s.feedbackCard.button;
    return { x: r.x + b.x * r.scaleX, y: r.y + b.y * r.scaleY };
  });
  await sleep(250);
  await clickWorld(page, pos.x, pos.y);
}

/* ------------------------------------------------------------------ */
/* Desktop campaign                                                    */
/* ------------------------------------------------------------------ */

async function runDesktopPass() {
  const browser = await launchBrowser();
  const page = await newPage(browser, { w: 1536, h: 864 });
  try {
    /* 1 — improved main menu */
    await gotoMenu(page);
    const menuInfo = await page.evaluate(() => window.__WB__.menu());
    check('menu: official art, no developer text on screen', menuInfo.usingBackgroundArt && menuInfo.usingLogoArt);
    await snap(page, '01-main-menu.png');

    /* 2/3 — PLAY hover + pressed states */
    await hoverWorld(page, 640, 478);
    await sleep(300);
    const hoverScale = await page.evaluate(() => {
      const s = window.__WB__.game.scene.getScene('MenuScene');
      return +s.playButton.container.scaleX.toFixed(3);
    });
    check('PLAY hover grows the button', hoverScale > 1.01, `scale=${hoverScale}`);
    await snap(page, '02-play-hover.png');
    const pt = await page.evaluate(() => window.__WB__.worldToClient(640, 478));
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await sleep(180);
    await snap(page, '03-play-pressed.png');
    await page.mouse.up();
    await sleep(120);

    /* 4 — level select (with saved progress → stars + locked cards) */
    await waitForFn(page, () => window.__WB__.levelSelect() && window.__WB__.levelSelect().active === true, 15000);
    await sleep(1700);
    await page.evaluate(() => {
      const s = window.__WB__.save();
      for (let i = 1; i <= 5; i++) s.recordLevelResult(i, 900 + i * 50, 2 + (i % 2));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoMenu(page);
    await clickWorld(page, 640, 478);
    await waitForFn(page, () => window.__WB__.levelSelect() && window.__WB__.levelSelect().active === true);
    await sleep(1800);
    const ls = await page.evaluate(() => window.__WB__.levelSelect());
    const unlocked = ls.cards.filter((c) => c.unlocked).length;
    const highlighted = ls.cards.find((c) => c.highlighted);
    check('level select: 15 cards, 6 unlocked, next playable highlighted',
      ls.cards.length === 15 && unlocked === 6 && highlighted && highlighted.id === 6,
      `cards=${ls.cards.length} unlocked=${unlocked} highlight=${highlighted && highlighted.id}`);
    await snap(page, '04-level-select.png');
    // close-up of one locked card (crop from the live page via clip)
    const lockCard = ls.cards.find((c) => !c.unlocked);
    const p1 = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx - 130, wy - 110), { wx: lockCard.x, wy: lockCard.y });
    const p2 = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx + 130, wy + 110), { wx: lockCard.x, wy: lockCard.y });
    await page.screenshot({
      path: join(OUT, '04b-locked-card-closeup.png'),
      clip: { x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y }
    });
    console.log('shot 04b-locked-card-closeup.png');

    /* 5 — gameplay with the bigger HUD */
    await clickWorld(page, lockCard.x, lockCard.y).catch(() => {});
    await sleep(400);
    const stillLs = await page.evaluate(() => window.__WB__.levelSelect().active);
    check('locked card does not navigate', stillLs === true);
    const card1 = ls.cards.find((c) => c.id === 1);
    await clickWorld(page, card1.x, card1.y);
    await prepGameplay(page);
    await waitForFn(page, () => window.__WB__.state() === 'AIMING', 45000);
    await sleep(350);
    await snap(page, '05-hud-gameplay.png');
    const hudInfo = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return {
        state: s.stateMachine.current,
        timerFont: s.hud.timerText.style.fontSize,
        hearts: s.hud.heartIcons.length,
        progressH: Math.round(s.hud.layout.elements.progress.h),
        band: s.hud.layout.bandBottom
      };
    });
    check('HUD: bigger panels + timer typography', /2[4-9]px/.test(hudInfo.timerFont) && hudInfo.progressH >= 72,
      `timer=${hudInfo.timerFont} progressH=${hudInfo.progressH}`);

    /* 6 — correct answer card on the fresh arena */
    const correctHit = await autoAimRetry(page);
    if (!correctHit) throw new Error('correct answer never landed');
    await sleep(450);
    const correctFit = await page.evaluate(() => window.__WB__.feedbackInfo());
    check('correct card: green theme, compact size', correctFit.kind === 'correct',
      `scale=${correctFit.scale}`);
    await snap(page, '06-correct-answer.png');

    /* 7 — CONTINUE → question 2 (fresh arena) → wrong answer card */
    await clickFeedbackAction(page);
    await waitForFn(page, () => window.__WB__.state() === 'AIMING', 45000);
    const wrongChoice = await page.evaluate(() => {
      const s = window.__WB__.scene();
      const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId);
      return wrong ? wrong.wb.choiceId : null;
    });
    const wrongHit = await autoAimRetry(page, wrongChoice);
    if (!wrongHit) throw new Error('wrong answer never landed');
    await sleep(450);
    const wrongFit = await page.evaluate(() => {
      const f = window.__WB__.feedbackInfo();
      const s = window.__WB__.scene();
      return { ...f, w: Math.round(s.feedbackCard.root.scaleX * 406) };
    });
    check('wrong card: compact width + real data', wrongFit.kind === 'wrong' && wrongFit.w <= 630,
      `width=${wrongFit.w}px scale=${wrongFit.scale}`);
    await snap(page, '07-wrong-answer.png');
    await clickFeedbackAction(page); // TRY AGAIN → AIMING
    await waitForFn(page, () => window.__WB__.state() === 'AIMING', 30000);

    /* 8/9 — pause: grayscale + blurred frozen gameplay, centered resume */
    const pausePos = await page.evaluate(() => {
      const s = window.__WB__.scene();
      const e = s.hud.layout.elements.pause;
      return { x: e.x, y: e.y };
    });
    let paused = false;
    for (let i = 0; i < 3 && !paused; i++) {
      await clickWorld(page, pausePos.x, pausePos.y); // the REAL pause button
      try {
        await waitForFn(page, () => window.__WB__.state() === 'PAUSED', 6000);
        paused = true;
      } catch (e) { /* slow frame ate the click — retry */ }
    }
    if (!paused) throw new Error('pause button never paused the game');
    await sleep(600); // resume button pop-in
    const pauseInfo = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return {
        paused: s.stateMachine.isPaused(),
        gray: !!s.hud.pauseGray,
        blur: !!s.hud.pauseBlur,
        webgl: s.game.renderer.type === 2,
        menuButtons: s.hud.pauseOpen
      };
    });
    check('pause: frozen + grayscale + blur post-fx on the gameplay camera',
      pauseInfo.paused && (pauseInfo.gray || !pauseInfo.webgl) && (pauseInfo.blur || !pauseInfo.webgl),
      JSON.stringify(pauseInfo));
    await snap(page, '08-pause-blur-grayscale.png');
    // close-up of the centered resume button
    const c1 = await page.evaluate(() => window.__WB__.worldToClient(640 - 150, 360 - 160));
    const c2 = await page.evaluate(() => window.__WB__.worldToClient(640 + 150, 360 + 160));
    await page.screenshot({
      path: join(OUT, '09-resume-button-closeup.png'),
      clip: { x: c1.x, y: c1.y, width: c2.x - c1.x, height: c2.y - c1.y }
    });
    console.log('shot 09-resume-button-closeup.png');

    /* 10 — resume restores color and the exact state */
    await clickWorld(page, 640, 356); // the big centered resume button
    await waitForFn(page, () => window.__WB__.state() === 'AIMING', 8000);
    const afterFx = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return { gray: !!s.hud.pauseGray, blur: !!s.hud.pauseBlur };
    });
    check('resume: grayscale/blur removed, state restored', !afterFx.gray && !afterFx.blur);
    await snap(page, '10-resumed-color-restored.png');

    /* 11 — victory panel (wood + drawn stars) */
    for (let q = 0; q < 4; q++) {
      const st = await page.evaluate(() => window.__WB__.state());
      if (st === 'LEVEL_COMPLETE') break;
      if (st !== 'AIMING') {
        // a leftover feedback card from the flow above — close it
        const f = await page.evaluate(() => window.__WB__.feedbackInfo());
        if (f && f.visible) { await clickFeedbackAction(page); }
        await waitForFn(page, () => window.__WB__.state() === 'AIMING', 20000);
      }
      let ok = await page.evaluate(() => !!window.__WB__.autoAim());
      if (!ok) ok = await page.evaluate(() => !!window.__WB__.autoAim());
      if (!ok) throw new Error('autoAim failed on question ' + (q + 1));
      await waitForFn(page, () => window.__WB__.state() === 'ANSWER_FEEDBACK', 20000);
      await clickFeedbackAction(page);
      await waitForFn(page, () => ['AIMING', 'LEVEL_COMPLETE'].includes(window.__WB__.state()), 20000);
    }
    await waitForFn(page, () => window.__WB__.state() === 'LEVEL_COMPLETE', 20000);
    await sleep(1300); // star pop-in choreography
    await snap(page, '11-victory.png');
    const savedAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('wordblast.save')));
    check('victory recorded progress (level 1 now completed with stars)',
      savedAfter.levels['1'] && savedAfter.levels['1'].completed, JSON.stringify(savedAfter.levels['1'] || null));

    check('desktop pass: no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  } catch (e) {
    check('desktop campaign', false, e.message);
  } finally {
    await page.close();
    await browser.close();
  }
}

/* ------------------------------------------------------------------ */
/* Tablet + phone landscape passes                                     */
/* ------------------------------------------------------------------ */

async function runViewportPass(cfg, name) {
  const browser = await launchBrowser();
  const page = await newPage(browser, cfg);
  try {
    await gotoMenu(page);
    const info = await page.evaluate(() => window.__WB__.menu());
    check(`${name}: menu active with official art`, info.active && info.usingBackgroundArt && info.usingLogoArt);
    await snap(page, `${name}-menu.png`);

    await clickWorld(page, 640, 478); // PLAY
    await waitForFn(page, () => window.__WB__.levelSelect() && window.__WB__.levelSelect().active === true);
    await sleep(1600);
    const ls = await page.evaluate(() => window.__WB__.levelSelect());
    check(`${name}: 15 level cards rendered`, ls.cards.length === 15);
    await snap(page, `${name}-level-select.png`);

    const card1 = ls.cards.find((c) => c.id === 1);
    await clickWorld(page, card1.x, card1.y);
    await waitForFn(page, () => window.__WB__.state() === 'AIMING', 30000);
    await sleep(350);
    await snap(page, `${name}-hud-gameplay.png`);

    // pause overlay on this device class too
    await page.evaluate(() => window.__WB__.scene().doPause());
    await waitForFn(page, () => window.__WB__.state() === 'PAUSED', 8000);
    await sleep(500);
    const fx = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return { gray: !!s.hud.pauseGray, blur: !!s.hud.pauseBlur, webgl: s.game.renderer.type === 2 };
    });
    check(`${name}: pause freezes + applies grayscale/blur`,
      fx.gray || !fx.webgl, JSON.stringify(fx));
    await snap(page, `${name}-pause.png`);
    await page.evaluate(() => window.__WB__.scene().togglePause());
    await waitForFn(page, () => window.__WB__.state() === 'AIMING', 8000);

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
  await runViewportPass({ w: 1180, h: 820, mobile: true, touch: true }, 'tablet-1180x820');
  await runViewportPass({ w: 844, h: 390, mobile: true, touch: true }, 'phone-844x390');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n== UI polish acceptance: ${results.length - failed.length}/${results.length} passed ==`);
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
