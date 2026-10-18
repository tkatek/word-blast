/**
 * Fix #7 visual verification — previous-shot trajectory reference.
 *
 * Boots the REAL game (vite dev server) in headless Chrome (WebGL via
 * swiftshader), drives it with REAL trusted input (CDP mouse + touch),
 * and verifies + screenshots every required behavior:
 *
 *   A. aiming          — bright dotted arc while dragging
 *   B. after release   — the shot's dots STAY on screen (faded reference)
 *   C. aiming again    — bright arc + faded previous arc together
 *   D. second shot     — the reference is REPLACED by the newest shot
 *   E. level 1 → 2     — NEXT LEVEL button: every dot gone, fresh start
 *   F. level 2 aiming  — only the new bright arc, no stale reference
 *   G. mobile touch    — same flow on a phone-landscape touch viewport
 *   H. pause/resume    — reference survives
 *
 * Objective dot checks: each screenshot is pixel-sampled (sharp) at the
 * exact world coordinates of the live aiming dots / stored reference dots —
 * a dot counts as visible when its pixel is meaningfully brighter than the
 * background sampled a few px beside it.
 *
 * Run:  node scripts/verify-fix7.mjs        (needs vite on :5199 or :5173)
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const BASE = process.env.BASE
  || (await (async () => {
    const probe = async (port) => {
      try {
        const r = await fetch(`http://localhost:${port}/`, { method: 'HEAD' });
        return r.ok ? `http://localhost:${port}/` : null;
      } catch { return null; }
    };
    return (await probe(5199)) || (await probe(5173)) || 'http://localhost:5173/';
  })());
const OUT = fileURLToPath(new URL('../fix7-screens/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}`); }
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

/** World→client affine from the game's own mapClient (zoom-aware). */
async function installMapper(page) {
  await page.evaluate(() => {
    const api = window.__WB__;
    const canvas = api.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const c0 = { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.25 };
    const w0 = api.mapClient(c0.x, c0.y);
    const wx = api.mapClient(c0.x + 50, c0.y);
    const wy = api.mapClient(c0.x, c0.y + 50);
    const sx = (wx.x - w0.x) / 50, sy = (wy.y - w0.y) / 50; // world per client px
    window.__map = {
      toClient(wx2, wy2) {
        return { x: c0.x + (wx2 - w0.x) / sx, y: c0.y + (wy2 - w0.y) / sy };
      }
    };
  });
}

async function gotoAiming(page, levelId) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 30000 });
  // BootScene must finish wiring the shared managers into the registry
  await page.waitForFunction(() => {
    const g = window.__WB__.game;
    return g && g.registry && g.registry.get('questions') && g.registry.get('levels');
  }, { timeout: 30000, polling: 100 });
  await page.evaluate((id) => {
    const api = window.__WB__;
    api.setAutoPause(false);
    api.setCardTimings({ enterMs: 150, readingMs: 400, moveMs: 150, exitMs: 120 });
    api.gotoLevel(id);
  }, levelId);
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
  }, { timeout: 30000, polling: 100 });
  await installMapper(page);
  await sleep(400);
}

const wb = (page, expr) => page.evaluate(expr);

/** Live aiming dots / stored reference dots in WORLD coords. */
const liveDots = (page) => wb(page, `(() => {
  const sl = window.__WB__.scene().slingshot;
  const d = sl.dragging ? sl.trajectoryDots() : null;
  return d ? d.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) })) : [];
})()`);
const refDots = (page) => wb(page, `(() => {
  const d = window.__WB__.scene().slingshot.lastShotDots;
  return d ? d.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) })) : [];
})()`);

/**
 * Pixel-verify dots in a screenshot. World dots are mapped to client
 * (CSS) px in-page, then scaled by the viewport DPR to screenshot pixels.
 * Visibility = LOCAL CONTRAST: the dot's whiteness (min RGB channel, best
 * pixel in a ±3 box) minus the background sampled 10px PERPENDICULAR to
 * the arc (the arc curves, so a fixed below-sample can land on clouds or
 * the next dot). SwiftShader composites the white fills at roughly half
 * their fillStyle alpha, so absolute thresholds are meaningless — the
 * bright layer (0.85) contrasts ~2.6× stronger than the faded one (0.32).
 */
async function countVisibleDots(page, shotPath, worldDots, { faded = false, box = 3 } = {}) {
  const dpr = page.viewport().deviceScaleFactor || 1;
  const client = await page.evaluate((dots) => dots.map((p) => window.__map.toClient(p.x, p.y)), worldDots);
  // background candidates per dot: both perpendicular offsets and below —
  // dense arc regions (apex, flat shots) can put ONE offset on a neighbor
  // dot, so the cleanest available background (minimum) wins.
  const bgPts = worldDots.map((p, i) => {
    const q = worldDots[Math.min(i + 1, worldDots.length - 1)];
    const dx = q.x - p.x, dy = q.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    return [
      { x: p.x + nx * 12, y: p.y + ny * 12 },
      { x: p.x - nx * 12, y: p.y - ny * 12 },
      { x: p.x, y: p.y + 14 }
    ];
  });
  const bgClient = await page.evaluate((pts) => pts.map((three) => three.map((p) => window.__map.toClient(p.x, p.y))), bgPts);
  const { data, info } = await sharp(shotPath).raw().toBuffer({ resolveWithObject: true });
  const whiteness = (cx, cy) => {
    let best = 0;
    for (let y = Math.max(0, Math.round(cy * dpr) - box); y <= Math.min(info.height - 1, Math.round(cy * dpr) + box); y++) {
      for (let x = Math.max(0, Math.round(cx * dpr) - box); x <= Math.min(info.width - 1, Math.round(cx * dpr) + box); x++) {
        const i = (y * info.width + x) * info.channels;
        best = Math.max(best, Math.min(data[i], data[i + 1], data[i + 2]));
      }
    }
    return best;
  };
  const minContrast = faded ? 6 : 15;
  let visible = 0;
  client.forEach((c, i) => {
    const bg = Math.min(...bgClient[i].map((b) => whiteness(b.x, b.y)));
    if (whiteness(c.x, c.y) - bg >= minContrast) visible++;
  });
  return { visible, total: worldDots.length };
}

/** Real mouse drag; hold=true leaves the button pressed mid-drag. */
async function mouseDrag(page, pullWorld, { hold = false } = {}) {
  const a = await wb(page, `(() => {
    const a = window.__WB__.scene().slingshot.anchor;
    return { x: a.x, y: a.y };
  })()`);
  const p0 = await page.evaluate((w) => window.__map.toClient(w.x, w.y), a);
  const p1 = await page.evaluate((w) => window.__map.toClient(w.x, w.y), pullWorld);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await sleep(220);
  if (!hold) {
    await page.mouse.up();
    await sleep(150);
  }
}

/** Real touch drag on the touchscreen surface; hold=true keeps the finger down. */
async function touchDrag(page, pullWorld, { hold = false } = {}) {
  const a = await wb(page, `(() => {
    const a = window.__WB__.scene().slingshot.anchor;
    return { x: a.x, y: a.y };
  })()`);
  const p0 = await page.evaluate((w) => window.__map.toClient(w.x, w.y), a);
  const p1 = await page.evaluate((w) => window.__map.toClient(w.x, w.y), pullWorld);
  await page.touchscreen.touchStart(p0.x, p0.y);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await page.touchscreen.touchMove(p0.x + (p1.x - p0.x) * i / steps, p0.y + (p1.y - p0.y) * i / steps);
    await sleep(30);
  }
  await sleep(200);
  if (!hold) await page.touchscreen.touchEnd();
}

async function waitAiming(page, timeoutMs = 30000) {
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.stateMachine && s.stateMachine.current === 'AIMING';
  }, { timeout: timeoutMs, polling: 120 });
  await sleep(300);
}

/** Answer every question with real aimed shots until the level completes. */
async function completeLevel(page) {
  const t0 = Date.now();
  for (;;) {
    const st = await wb(page, `window.__WB__.state()`);
    if (st === 'LEVEL_COMPLETE' || st === 'GAME_COMPLETE') return st;
    if (Date.now() - t0 > 240000) throw new Error(`level never completed (state ${st})`);
    if (st === 'LEVEL_FAILED') {
      await wb(page, `window.__WB__.scene().retryQuestion()`);
      await waitAiming(page, 15000);
    } else if (st === 'AIMING') {
      await page.waitForFunction(() => {
        const s = window.__WB__.scene();
        return s.factory.blocksQuiet();
      }, { timeout: 8000, polling: 100 }).catch(() => {});
      await wb(page, `window.__WB__.autoAim()`);
      await sleep(1500);
    } else {
      await sleep(250);
    }
  }
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}` });

/* ------------------------------------------------------------------ */
const exe = findBrowser();
if (!exe) throw new Error('No Chrome/Edge executable found');
console.log('browser:', exe, '\nserver:', BASE, '\noutput:', OUT);

const newBrowser = () => puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--mute-audio', '--window-size=1300,760']
});

const watchErrors = (page) => {
  const seen = new Set();
  page.on('pageerror', (e) => {
    const key = (e.stack || e.message).split('\n').slice(0, 3).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    console.log('  [pageerror]', (e.stack || e.message).split('\n').slice(0, 6).join('\n           '));
  });
};

/** Fire one real shot and wait for the re-arm. */
async function fireShot(page, pullWorld) {
  await mouseDrag(page, pullWorld);
  await waitAiming(page);
}

/* Each phase is self-contained (own level setup) so a browser crash costs
 * only one phase; the runner retries it once on a fresh browser. */
const phases = {

  async 'A+B' (browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    watchErrors(page);
    await gotoAiming(page, 1);

    console.log('\n== A. aiming: bright dotted arc while dragging ==');
    await mouseDrag(page, { x: 115, y: 432 }, { hold: true });
    const dotsA = await liveDots(page);
    await shot(page, 'fix7-A-aiming.png');
    const vA = await countVisibleDots(page, `${OUT}/fix7-A-aiming.png`, dotsA);
    ok(dotsA.length >= 12, `aiming arc computed (${dotsA.length} dots)`);
    ok(vA.visible >= Math.ceil(vA.total * 0.6), `bright dots visible on screen (${vA.visible}/${vA.total})`);
    ok((await refDots(page)).length === 0, 'no reference before the first shot');

    console.log('\n== B. release: the shot dots STAY on screen ==');
    await page.mouse.up();
    await sleep(150);
    await page.waitForFunction(() => {
      const s = window.__WB__.scene();
      return s.stateMachine.current === 'PROJECTILE_FLYING';
    }, { timeout: 5000, polling: 50 });
    const dotsB = await refDots(page);
    await shot(page, 'fix7-B-after-release.png');
    await waitAiming(page);
    const vB = await countVisibleDots(page, `${OUT}/fix7-B-after-release.png`, dotsB, { faded: true });
    ok(dotsB.length >= 12, `reference stored at release (${dotsB.length} dots)`);
    ok(vB.visible >= Math.ceil(vB.total * 0.55), `faded reference visible after release (${vB.visible}/${vB.total})`);
  },

  async 'C' (browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    watchErrors(page);
    await gotoAiming(page, 1);
    await fireShot(page, { x: 115, y: 432 });

    console.log('\n== C. aiming again: bright arc + faded previous together ==');
    await mouseDrag(page, { x: 150, y: 415 }, { hold: true });
    const dotsC = await liveDots(page);
    const refC = await refDots(page);
    await shot(page, 'fix7-C-aiming-with-reference.png');
    const vCbright = await countVisibleDots(page, `${OUT}/fix7-C-aiming-with-reference.png`, dotsC);
    const vCref = await countVisibleDots(page, `${OUT}/fix7-C-aiming-with-reference.png`, refC, { faded: true });
    ok(vCbright.visible >= Math.ceil(vCbright.total * 0.6), `new bright arc visible (${vCbright.visible}/${vCbright.total})`);
    ok(vCref.visible >= Math.ceil(vCref.total * 0.45), `previous faded arc still visible (${vCref.visible}/${vCref.total})`);
  },

  async 'D' (browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    watchErrors(page);
    await gotoAiming(page, 1);
    await fireShot(page, { x: 115, y: 432 });

    console.log('\n== D. second shot REPLACES the reference ==');
    const beforeD = JSON.stringify(await refDots(page));
    await fireShot(page, { x: 140, y: 425 });
    const afterD = await refDots(page);
    await shot(page, 'fix7-D-replaced.png');
    ok(afterD.length > 0 && JSON.stringify(afterD) !== beforeD, 'reference replaced by the newest shot');
    const vD = await countVisibleDots(page, `${OUT}/fix7-D-replaced.png`, afterD, { faded: true });
    ok(vD.visible >= Math.ceil(vD.total * 0.55), `replaced reference visible (${vD.visible}/${vD.total})`);
  },

  async 'E+F' (browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    watchErrors(page);
    await gotoAiming(page, 1);

    console.log('\n== E. question flow keeps it; NEXT LEVEL clears everything ==');
    const st = await completeLevel(page);
    ok(st === 'LEVEL_COMPLETE', `level 1 completed (state ${st})`);
    const refWin = await refDots(page); // the final answering shot's reference
    const btn = await page.evaluate(() => window.__map.toClient(640, 360)); // NEXT LEVEL button
    await page.mouse.click(btn.x, btn.y);
    await page.waitForFunction(() => {
      const s = window.__WB__ && window.__WB__.scene();
      return s && s.levelId === 2 && s.stateMachine && s.stateMachine.current === 'AIMING';
    }, { timeout: 30000, polling: 120 });
    await installMapper(page); // fresh scene → fresh canvas rect
    await sleep(500);
    await shot(page, 'fix7-E-level2-clean.png');
    ok((await refDots(page)).length === 0, `level 2 starts with zero reference dots (was ${refWin.length} in level 1)`);

    console.log('\n== F. aiming in level 2: only the new bright arc ==');
    await mouseDrag(page, { x: 120, y: 430 }, { hold: true });
    const dotsF = await liveDots(page);
    await shot(page, 'fix7-F-level2-aiming.png');
    const vF = await countVisibleDots(page, `${OUT}/fix7-F-level2-aiming.png`, dotsF);
    ok(dotsF.length >= 12 && (await refDots(page)).length === 0, `fresh aiming arc, no stale reference (${dotsF.length} dots)`);
    ok(vF.visible >= Math.ceil(vF.total * 0.6), `level-2 bright dots visible (${vF.visible}/${vF.total})`);
  },

  async 'H' (browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    watchErrors(page);
    await gotoAiming(page, 1);
    await fireShot(page, { x: 135, y: 420 });

    console.log('\n== H. pause/resume keeps the reference ==');
    const refH = await refDots(page);
    await page.keyboard.press('p');
    await sleep(400);
    const pausedKeep = await refDots(page);
    await page.keyboard.press('p');
    await waitAiming(page, 10000);
    ok(JSON.stringify(pausedKeep) === JSON.stringify(refH) && (await refDots(page)).length === refH.length,
      `reference intact across pause/resume (${refH.length} dots)`);
  },

  async 'G (mobile)' (browser) {
    console.log('\n== G. mobile landscape: touch controls drive the same flow ==');
    const m = await browser.newPage();
    await m.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    watchErrors(m);
    await gotoAiming(m, 1);
    await touchDrag(m, { x: 110, y: 435 }, { hold: true });
    const dotsG = await liveDots(m);
    await shot(m, 'fix7-G-mobile-aiming.png');
    const vG = await countVisibleDots(m, `${OUT}/fix7-G-mobile-aiming.png`, dotsG);
    ok(dotsG.length >= 12, `touch drag shows the aiming arc (${dotsG.length} dots)`);
    ok(vG.visible >= Math.ceil(vG.total * 0.6), `mobile bright dots visible (${vG.visible}/${vG.total})`);
    await m.touchscreen.touchEnd();
    await waitAiming(m);
    const refG = await refDots(m);
    await shot(m, 'fix7-G-mobile-after-release.png');
    const vGref = await countVisibleDots(m, `${OUT}/fix7-G-mobile-after-release.png`, refG, { faded: true });
    ok(refG.length >= 12, `touch shot kept its reference (${refG.length} dots)`);
    ok(vGref.visible >= Math.ceil(vGref.total * 0.55), `mobile faded reference visible (${vGref.visible}/${vGref.total})`);
  }
};

for (const [name, fn] of Object.entries(phases)) {
  let done = false;
  for (let attempt = 1; attempt <= 2 && !done; attempt++) {
    const browser = await newBrowser();
    try {
      await fn(browser);
      done = true;
    } catch (e) {
      if (attempt >= 2) {
        failed++;
        console.log(`FAIL  phase ${name} aborted after retry: ${e.message.split('\n')[0]}`);
      } else {
        console.log(`  [retry phase ${name}: browser hiccup — ${e.message.split('\n')[0]}]`);
        await sleep(1500);
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }
}

console.log(`\n== summary ==\n${passed} passed, ${failed} failed`);
console.log(`screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
