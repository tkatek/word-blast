/**
 * PLAY/MENU wooden-art buttons — acceptance screenshots + behavioural
 * checks (boots the REAL built game in headless Chrome/Edge):
 *
 *   desktop (1536×864)
 *     - fresh menu: PLAY plate loaded from the supplied artwork (no
 *       fallback), sized from its alpha-trimmed content, centred below
 *       the progress panel with clear space (no overlap)
 *     - PLAY hover: +5% scale + warm glow tween values
 *     - PLAY press-and-hold: 95% compression; release restores
 *     - PLAY click → LevelSelectScene; rapid triple-tap single transition
 *     - level select: MENU bar art (no fallback) upper-left, inside the
 *       screen bounds; hover = gentle brightening + 5% grow; press 95%
 *     - MENU click → MenuScene, saved progress intact (UI + storage)
 *     - screenshots of every stable state
 *   tablet landscape (1180×820) + phone landscape (844×390)
 *     - both screens rendered with the buttons proportionally scaled
 *
 * Run:  npm run build && npx vite preview --port 4273
 *       node scripts/buttons-screenshots.mjs [http://host:port]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'buttons');
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

/** Click a world-space point through the real canvas (full input path). */
async function clickWorld(page, wx, wy, delay = 40) {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.click(pt.x, pt.y, { delay });
}

/** Move the mouse onto a world-space point (hover). */
async function moveWorld(page, wx, wy) {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.move(pt.x, pt.y);
}

/** Press-and-hold at a world-space point. */
async function downWorld(page, wx, wy) {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
}

/** World-space layout of the two buttons (single source: the live scene).
 *  `art` is true for the ArtButton component (production minifies class
 *  names, so identify by its stable internals instead). */
async function playInfo(page) {
  return page.evaluate(() => {
    const s = window.__WB__.game.scene.getScene('MenuScene');
    const b = s.playButton;
    return {
      art: typeof b._hoverScale === 'number' && !!b.art,
      enabled: b.enabled,
      x: b.container.x, y: b.container.y, w: b.width, h: b.height,
      hover: b._hover, scale: b.container.scale,
      glow: b._glow ? b._glow.alpha : null
    };
  });
}

async function menuInfo(page) {
  return page.evaluate(() => window.__WB__.menu());
}

async function backInfo(page) {
  return page.evaluate(() => {
    const s = window.__WB__.game.scene.getScene('LevelSelectScene');
    const b = s.backButton;
    return {
      art: typeof b._hoverScale === 'number' && !!b.art,
      x: b.container.x, y: b.container.y, w: b.width, h: b.height,
      hover: b._hover, pressed: b._pressed, scale: b.container.scale,
      bright: b._bright ? b._bright.alpha : null
    };
  });
}

async function activeScenes(page) {
  return page.evaluate(() => window.__WB__.game.scene.getScenes(true).map((s) => s.scene.key));
}

/** Wait until the menu is active and the entrance has armed PLAY. */
async function gotoMenuSettled(page) {
  await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 90000, polling: 150 });
  // entrance choreography arms PLAY ~0.95 s in — on the slow software
  // renderer that stretches, so poll for the armed state instead of sleeping
  await page.waitForFunction(() => {
    const s = window.__WB__.game.scene.getScene('MenuScene');
    return s && s.playButton && s.playButton.enabled;
  }, { timeout: 15000, polling: 150 });
  await sleep(400); // final settle of the late-entrance tweens
}

/** Poll a page-side predicate until it passes (screenshots stall the page
 *  thread and the software renderer runs tweens slowly — fixed sleeps are
 *  unreliable mid-animation). Returns the last reading. */
async function pollUntil(page, readFn, predicate, timeout = 6000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await readFn(page);
    if (predicate(last)) return last;
    await sleep(150);
  }
  return last;
}

async function gotoLevelSelect(page) {
  await clickWorld(page, 640, 534); // PLAY
  await page.waitForFunction(() => window.__WB__.game.scene.isActive('LevelSelectScene'), { timeout: 15000, polling: 150 });
  await sleep(1500); // entrance + sign settle
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
    /* 1 — fresh menu: PLAY is the supplied artwork plate */
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await gotoMenuSettled(page);
    const info = await menuInfo(page);
    const play = await playInfo(page);
    check('menu active with official art (no fallbacks)',
      info.active && info.usingBackgroundArt && info.usingLogoArt);
    check('PLAY is the supplied ArtButton (aspect-trimmed ≈237×208, centred at 640)',
      play.art && Math.abs(play.w - 237) <= 2 && Math.abs(play.h - 208) <= 2
      && play.x === 640 && play.y === 534,
      `art=${play.art} ${play.w}×${play.h} @(${play.x},${play.y})`);
    check('PLAY clear of the progress panel (top ≥ 425)',
      play.y - play.h / 2 >= 425, `top=${play.y - play.h / 2}`);
    check('PLAY armed after entrance', play.enabled && !info.transitioning);
    await snap('desktop-menu-fresh.png');

    /* 2 — hover: +5% + glow */
    await moveWorld(page, 200, 200);
    await sleep(150);
    await moveWorld(page, 640, 534);
    const hovered = await pollUntil(page, playInfo,
      (p) => p.hover && Math.abs(p.scale - 1.05) < 0.02 && (p.glow || 0) > 0.4);
    check('PLAY hover: scale 1.05 + glow visible',
      hovered.hover && Math.abs(hovered.scale - 1.05) < 0.02 && hovered.glow > 0.35,
      `scale=${hovered.scale.toFixed(3)} glow=${(hovered.glow || 0).toFixed(2)}`);
    await snap('desktop-play-hover.png');

    /* 3 — press-and-hold: 95% compression, release restores */
    await downWorld(page, 640, 534);
    const pressed = await pollUntil(page, playInfo, (p) => Math.abs(p.scale - 0.95) < 0.02);
    check('PLAY press: scale 0.95',
      Math.abs(pressed.scale - 0.95) < 0.02, `scale=${pressed.scale.toFixed(3)}`);
    await snap('desktop-play-press.png');
    await page.mouse.up();
    await sleep(350);

    /* 4 — PLAY navigation + rapid-tap single transition */
    await clickWorld(page, 640, 534, 20);
    await clickWorld(page, 640, 534, 20);   // the two extra taps race the
    await clickWorld(page, 640, 534, 20);   // fade — the guard must eat them
    await page.waitForFunction(() =>
      window.__WB__.game.scene.isActive('LevelSelectScene'), { timeout: 15000, polling: 150 });
    await sleep(1200);
    const scenes = await activeScenes(page);
    check('PLAY → level select exactly once (rapid taps guarded)',
      scenes.length === 1 && scenes[0] === 'LevelSelectScene', scenes.join(','));
    await snap('desktop-levelselect.png');

    /* 5 — MENU bar: supplied art, upper-left, on-screen */
    const back = await backInfo(page);
    check('MENU is the supplied ArtButton (≈176×57 @124,52)',
      back.art && Math.abs(back.w - 176) <= 2 && Math.abs(back.h - 57) <= 2
      && Math.abs(back.x - 124) <= 1 && Math.abs(back.y - 52) <= 1,
      `art=${back.art} ${back.w}×${back.h} @(${back.x},${back.y})`);
    const inView = await page.evaluate((b) => {
      const tl = window.__WB__.worldToClient(b.x - b.w / 2, b.y - b.h / 2);
      const br = window.__WB__.worldToClient(b.x + b.w / 2, b.y + b.h / 2);
      return { tl, br, inside: tl.x >= 0 && tl.y >= 0 && br.x <= innerWidth && br.y <= innerHeight };
    }, back);
    check('MENU fully inside the viewport with comfortable margins',
      inView.inside && inView.tl.x >= 8 && inView.tl.y >= 8,
      `client(${Math.round(inView.tl.x)},${Math.round(inView.tl.y)})→(${Math.round(inView.br.x)},${Math.round(inView.br.y)})`);

    /* 6 — MENU hover: brightness + grow */
    await moveWorld(page, 600, 300);
    await sleep(150);
    await moveWorld(page, 124, 52);
    const backHover = await pollUntil(page, backInfo,
      (b) => b.hover && Math.abs(b.scale - 1.05) < 0.02 && (b.bright || 0) > 0.12);
    check('MENU hover: scale 1.05 + gentle brightening',
      backHover.hover && Math.abs(backHover.scale - 1.05) < 0.02 && backHover.bright > 0.1,
      `scale=${backHover.scale.toFixed(3)} bright=${(backHover.bright || 0).toFixed(2)}`);
    await snap('desktop-menu-button-hover.png');

    /* 7 — MENU press + return path (save intact) */
    await page.evaluate(() => {
      const s = window.__WB__.save();
      s.recordLevelResult(1, 900, 3);
      s.recordLevelResult(2, 950, 2);
    });
    const storageBefore = await page.evaluate(() => localStorage.getItem('wordblast.save'));
    await downWorld(page, 124, 52);
    const backPressed = await pollUntil(page, backInfo, (b) => Math.abs(b.scale - 0.95) < 0.02);
    check('MENU press: scale 0.95', Math.abs(backPressed.scale - 0.95) < 0.02, `scale=${backPressed.scale.toFixed(3)}`);
    await page.mouse.up();
    await page.waitForFunction(() => window.__WB__.menu() && window.__WB__.menu().active, { timeout: 15000, polling: 150 });
    await sleep(1200);
    const backScenes = await activeScenes(page);
    const storageAfter = await page.evaluate(() => localStorage.getItem('wordblast.save'));
    const texts = await page.evaluate(() => {
      const s = window.__WB__.game.scene.getScene('MenuScene');
      return { levels: s.progressLevelsText.text, stars: s.progressStarsText.text };
    });
    check('MENU returns to the menu exactly once',
      backScenes.length === 1 && backScenes[0] === 'MenuScene', backScenes.join(','));
    check('saved progress intact after MENU return (UI + storage)',
      texts.levels.includes('2/15') && texts.stars.includes('5/45') && storageAfter === storageBefore,
      `${texts.levels} | ${texts.stars} | storage=${storageAfter === storageBefore ? 'unchanged' : 'CHANGED'}`);
    await snap('desktop-return-menu.png');

    check('desktop pass: no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  } catch (e) {
    const at = (e.stack || '').split('\n').slice(0, 4).join(' | ');
    check('desktop campaign', false, `${e.message} @@ ${at}`);
  } finally {
    await page.close();
    await browser.close();
  }
}

async function runViewportPass(cfg, name) {
  const browser = await launchBrowser();
  const page = await newPage(browser, cfg);
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await gotoMenuSettled(page);
    const play = await playInfo(page);
    const fit = await page.evaluate((b) => {
      const tl = window.__WB__.worldToClient(b.x - b.w / 2, b.y - b.h / 2);
      const br = window.__WB__.worldToClient(b.x + b.w / 2, b.y + b.h / 2);
      return { tl, br, vw: innerWidth, vh: innerHeight };
    }, play);
    check(`${name}: PLAY proportionally scaled on-screen`,
      fit.br.x - fit.tl.x > 60 && fit.br.x <= fit.vw && fit.tl.x >= 0,
      `${Math.round(fit.br.x - fit.tl.x)}px wide @(${Math.round(fit.tl.x)},${Math.round(fit.tl.y)})`);
    await page.screenshot({ path: join(OUT, `${name}-menu.png`) });
    console.log('shot', `${name}-menu.png`);

    await gotoLevelSelect(page);
    const back = await backInfo(page);
    const fitB = await page.evaluate((b) => {
      const tl = window.__WB__.worldToClient(b.x - b.w / 2, b.y - b.h / 2);
      const br = window.__WB__.worldToClient(b.x + b.w / 2, b.y + b.h / 2);
      return { tl, br, vw: innerWidth, vh: innerHeight };
    }, back);
    check(`${name}: MENU on-screen with margins`,
      fitB.tl.x >= 0 && fitB.tl.y >= 0 && fitB.br.x <= fitB.vw && fitB.br.y <= fitB.vh && fitB.tl.x >= 4,
      `client(${Math.round(fitB.tl.x)},${Math.round(fitB.tl.y)})→(${Math.round(fitB.br.x)},${Math.round(fitB.br.y)})`);
    await page.screenshot({ path: join(OUT, `${name}-levelselect.png`) });
    console.log('shot', `${name}-levelselect.png`);

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
  console.log(`\n== buttons acceptance: ${results.length - failed.length}/${results.length} passed ==`);
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
