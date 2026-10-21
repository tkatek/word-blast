/**
 * Desktop HUD + pause-screen acceptance (fit-view alignment fix).
 *
 * Boots the REAL built game (vite build output over HTTP) in Chrome/Edge
 * and verifies, at 1920×1080 AND 1366×768:
 *
 *   - the HUD's UI camera carries the SAME canonical fit-view framing as
 *     the gameplay camera (the historical bug: stale zoom-1 defaults left
 *     the HUD bunched top-left and the pause scrim covering only part of
 *     the screen on every viewport ≠ 1280×720)
 *   - the top bar reaches BOTH visible edges (screen-space) on load and
 *     after a browser resize, with phone rows untouched
 *   - the pause scrim covers the ENTIRE visible view edge to edge (no
 *     rectangle boundary), PLAY sits at the visible view's center, HOME
 *     holds the top-left slot, clicks resume the exact prior state
 *   - resizing WHILE PAUSED re-covers the new viewport, stays paused
 *   - 10× pause/resume in a row: no duplicate overlays, no lost progress
 *     (score/hearts/timer), blur fully removed
 *
 * Run:  node scripts/desktop-hud-pause-verify.mjs [http://host:port]
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

async function launchBrowser() {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome/Edge executable found');
  return puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage',
      '--disable-features=TranslateUI', '--no-first-run']
  });
}

const dismissPromos = (page) => page.evaluate(() => {
  const link = document.querySelector('.fs-dismiss');
  if (link) link.click();
  const card = document.getElementById('fs-entry');
  if (card) card.style.display = 'none';
});

async function bootToAiming(page, levelId = 3) {
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
    await page.evaluate(() => { try { window.__WB__.gotoLevel(1); } catch { /* fresh cycle */ } });
  }
  throw new Error('game never reached AIMING');
}

/** Canonical fit-view (computeFitView) evaluated in the page. */
const fitView = (page) => page.evaluate(() => {
  const s = window.__WB__.scene();
  const gs = s.scale.gameSize;
  const zoom = Math.min(gs.width / 1280, gs.height / 720);
  return {
    zoom,
    x: (1280 - gs.width / zoom) / 2,
    y: (720 - gs.height / zoom) / 2,
    width: gs.width / zoom,
    height: gs.height / zoom,
    cssW: s.game.canvas.clientWidth,
    cssH: s.game.canvas.clientHeight
  };
});

/** world → CSS-pixel screen point via the canonical fit-view. */
async function toScreen(page, x, y) {
  const v = await fitView(page);
  return { x: (x - v.x) * v.zoom, y: (y - v.y) * v.zoom };
}

/** Live camera + coverage report (geometry from the layout, not
 *  Container.getBounds — container bounds are unreliable under headless
 *  batching and the layout IS what rendering uses). */
const coverage = (page) => page.evaluate(() => {
  const s = window.__WB__.scene();
  const gs = s.scale.gameSize;
  const zoom = Math.min(gs.width / 1280, gs.height / 720);
  const view = {
    x: (1280 - gs.width / zoom) / 2,
    y: (720 - gs.height / zoom) / 2,
    width: gs.width / zoom,
    height: gs.height / zoom
  };
  const hud = s.hud;
  const L = hud.layout;
  const E = L.elements;
  const vx = L.mode === 'phone' ? 0 : hud.view.x;
  return {
    mainZoom: s.cameras.main.zoom,
    uiZoom: hud.uiCam.zoom,
    zoom,
    // screen-space coverage of the HUD row (CSS px) from live layout
    hudLeftCss: (vx + E.pause.x - E.pause.w / 2 - view.x) * zoom,
    hudRightCss: (vx + E.sound.x + E.sound.w / 2 - view.x) * zoom,
    // screen-space coverage of the pause scrim (CSS px)
    scrimCss: (() => {
      const w = hud.view.width, h = hud.view.height;
      return { x0: (hud.view.x - view.x) * zoom, y0: (hud.view.y - view.y) * zoom,
        x1: (hud.view.x + w - view.x) * zoom, y1: (hud.view.y + h - view.y) * zoom };
    })(),
    playCss: { cx: (1280 / 2 - view.x) * zoom, cy: (720 / 2 - view.y) * zoom },
    playBtnWorld: { x: hud.menu.x + hud.resumeBtn.x, y: hud.menu.y + hud.resumeBtn.y },
    cssW: s.game.canvas.clientWidth,
    cssH: s.game.canvas.clientHeight,
    bandBottom: L.bandBottom,
    view
  };
});

/** Wait until fn() is true (poll), else return last value. */
async function poll(page, fn, ms) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn(page);
    if (last) return last;
    await sleep(100);
  }
  return last;
}

/** Click PLAY like a real user, with the retry pattern of the existing
 *  harness (headless event batching occasionally drops a delivery). */
async function clickPlay(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = await page.evaluate(() => {
      const s = window.__WB__.scene();
      // world center of the PLAY container = menu position + local offset
      const wx = s.hud.menu.x + s.hud.resumeBtn.x;
      const wy = s.hud.menu.y + s.hud.resumeBtn.y;
      const gs = s.scale.gameSize;
      const zoom = Math.min(gs.width / 1280, gs.height / 720);
      const vx = (1280 - gs.width / zoom) / 2;
      const vy = (720 - gs.height / zoom) / 2;
      return { x: (wx - vx) * zoom, y: (wy - vy) * zoom };
    });
    await page.mouse.move(c.x, c.y);
    await sleep(120);
    await page.mouse.down();
    await sleep(120);
    await page.mouse.up();
    const resumed = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return !s.hud.pauseOpen && s.stateMachine.current !== 'PAUSED';
    });
    if (resumed) return true;
    await sleep(250);
  }
  return false;
}

async function runSize(browser, w, h) {
  const tag = `${w}x${h}`;
  console.log(`\n== desktop ${tag} ==========================================`);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 300)));
  await bootToAiming(page, 3);

  /* --- both cameras share ONE canonical fit-view ------------------- */
  let cov = await coverage(page);
  check(Math.abs(cov.uiZoom - cov.zoom) < 0.005 && Math.abs(cov.mainZoom - cov.zoom) < 0.005,
    'UI camera and gameplay camera share the canonical fit-view zoom',
    `ui=${cov.uiZoom.toFixed(3)} main=${cov.mainZoom.toFixed(3)} canonical=${cov.zoom.toFixed(3)}`);

  /* --- HUD spans the full visible width ---------------------------- */
  // margins are world-px (11) × zoom; the requirement is edge-to-edge
  // reach with CONSISTENT left/right margins
  const mTol = 11.5 * cov.zoom + 2;
  const mLeft = cov.hudLeftCss, mRight = cov.cssW - cov.hudRightCss;
  check(mLeft <= mTol && mRight <= mTol && Math.abs(mLeft - mRight) <= 3,
    'top bar spans the full visible width with consistent margins',
    `left margin ${mLeft.toFixed(1)}px, right margin ${mRight.toFixed(1)}px of ${cov.cssW}`);
  check(cov.bandBottom + 4 <= 92.3, 'HUD band stays clear of the docked question card',
    `bandBottom=${cov.bandBottom}`);
  await page.screenshot({ path: join(OUT, `after-hud-${tag}.png`) });

  /* --- pause: continuous full-view overlay ------------------------- */
  await page.evaluate(() => window.__WB__.scene().doPause());
  await sleep(800);
  cov = await coverage(page);
  check(cov.scrimCss.x0 <= 1 && cov.scrimCss.y0 <= 1
    && cov.scrimCss.x1 >= cov.cssW - 1 && cov.scrimCss.y1 >= cov.cssH - 1,
    'pause scrim covers the ENTIRE visible view edge to edge (no rectangle boundary)',
    `${cov.scrimCss.x0.toFixed(0)},${cov.scrimCss.y0.toFixed(0)} → ${cov.scrimCss.x1.toFixed(0)},${cov.scrimCss.y1.toFixed(0)} of ${cov.cssW}×${cov.cssH}`);
  check(Math.abs(cov.playCss.cx - cov.cssW / 2) <= 4 && Math.abs(cov.playCss.cy - cov.cssH / 2) <= 4,
    'PLAY button centered in the actual visible viewport',
    `center=(${cov.playCss.cx.toFixed(0)},${cov.playCss.cy.toFixed(0)}) of (${cov.cssW},${cov.cssH})`);
  const info0 = await page.evaluate(() => {
    const s = window.__WB__.scene();
    return { hearts: s.hearts.remaining, score: s.scoring.liveScore(), timer: s.levelTimer.remainingMs };
  });
  await page.screenshot({ path: join(OUT, `after-pause-${tag}.png`) });

  /* --- resize WHILE PAUSED ----------------------------------------- */
  await page.setViewport({ width: Math.round(w * 0.8), height: Math.round(h * 0.85) });
  await sleep(900); // ViewportController debounce + settle
  await dismissPromos(page);
  let still = await page.evaluate(() => window.__WB__.scene().hud.pauseOpen);
  cov = await coverage(page);
  check(still && cov.scrimCss.x0 <= 1 && cov.scrimCss.x1 >= cov.cssW - 1
    && cov.scrimCss.y0 <= 1 && cov.scrimCss.y1 >= cov.cssH - 1,
    'resize while paused: still paused, overlay re-covers the new viewport',
    `scrim ${cov.scrimCss.x0.toFixed(0)},${cov.scrimCss.y0.toFixed(0)} → ${cov.scrimCss.x1.toFixed(0)},${cov.scrimCss.y1.toFixed(0)} of ${cov.cssW}×${cov.cssH}`);
  check(Math.abs(cov.playCss.cx - cov.cssW / 2) <= 4 && Math.abs(cov.playCss.cy - cov.cssH / 2) <= 4,
    'PLAY stays centered after the resize',
    `center=(${cov.playCss.cx.toFixed(0)},${cov.playCss.cy.toFixed(0)})`);
  await page.screenshot({ path: join(OUT, `after-pause-${tag}-resized.png`) });
  await page.setViewport({ width: w, height: h });
  await sleep(900);

  /* --- PLAY click resumes the exact prior state -------------------- */
  const resumed = await clickPlay(page);
  await sleep(400);
  let st = await page.evaluate(() => window.__WB__.state());
  check(resumed && st === 'AIMING', 'clicking PLAY resumes the exact prior state (AIMING)', st);
  const clean = await poll(page, (p) => p.evaluate(() => {
    const s = window.__WB__.scene();
    return !s.hud.pauseBlur && !s.hud.menu.visible;
  }), 2000);
  check(!!clean, 'blur + menu fully removed after resume (within the 260ms fade)');
  const info1 = await page.evaluate(() => {
    const s = window.__WB__.scene();
    return { hearts: s.hearts.remaining, score: s.scoring.liveScore() };
  });
  check(info1.hearts === info0.hearts && info1.score === info0.score,
    'no progress lost across pause → resize → resume',
    `hearts ${info0.hearts}→${info1.hearts}, score ${info0.score}→${info1.score}`);

  /* --- 10× pause/resume spam --------------------------------------- */
  let okSpam = true, lastErr = '';
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__WB__.scene().doPause());
    await sleep(160);
    const open = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return { open: s.hud.pauseOpen, menus: s.hud.menu.visible ? 1 : 0, state: s.stateMachine.current };
    });
    if (!open.open || open.state !== 'PAUSED') { okSpam = false; lastErr = `iter ${i} open=${open.open} state=${open.state}`; break; }
    const closedNow = await clickPlay(page);
    await sleep(140);
    const closed = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return { open: s.hud.pauseOpen, state: s.stateMachine.current };
    });
    if (!closedNow || closed.open || closed.state !== 'AIMING') {
      okSpam = false; lastErr = `iter ${i} close open=${closed.open} state=${closed.state}`;
      break;
    }
  }
  check(okSpam, '10× pause/resume: overlay reopens and closes every cycle, always resumes', lastErr);
  const blurGone = await poll(page, (p) => p.evaluate(() => !window.__WB__.scene().hud.pauseBlur), 2000);
  check(!!blurGone, 'pause blur fully detached after the spam (no accumulation)');
  const info2 = await page.evaluate(() => {
    const s = window.__WB__.scene();
    return { hearts: s.hearts.remaining, score: s.scoring.liveScore(),
      fx: s.cameras.main.postFX ? s.cameras.main.postFX.list.length : -1 };
  });
  check(info2.hearts === info0.hearts && info2.score === info0.score,
    'progress intact after the 10-cycle spam',
    `hearts ${info0.hearts}→${info2.hearts}, score ${info0.score}→${info2.score}`);

  await page.close();
}

const main = async () => {
  const browser = await launchBrowser();
  try {
    await runSize(browser, 1920, 1080);
    await runSize(browser, 1366, 768);
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} passed, ${failed} failed -> ${OUT}`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
