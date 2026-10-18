/**
 * FIX #21 acceptance run — question-card dock position, size and the
 * click-to-expand reading view, verified in the REAL game booted in
 * Chrome/Edge (vite dev or preview server):
 *
 *   - compact card docked in the upper LEFT, below the HUD, smaller
 *     (505px vs 620px), screen center left open;
 *   - REAL click on the card (mouse + touch coordinates, not API calls)
 *     expands it smoothly to the center — captured mid-flight;
 *   - fully expanded card: centered, scrim behind, close button visible,
 *     speaker still clickable, timer frozen, no shot consumed;
 *   - closing via the close button returns it smoothly — captured
 *     mid-return — and re-enables aiming;
 *   - phone-landscape layout never overlaps the HUD and stays inside the
 *     visible world; resize does not displace the docked card.
 *
 * Run:  node scripts/card21-screenshots.mjs [http://host:port]
 * (defaults to the vite preview server on :4173)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { QUESTION_CARD } from '../js/config.js';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'card21');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:4173';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) problems.push(msg);
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

async function gotoGameScene(page, levelId = 3) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 30000 });
  await page.evaluate((id) => window.__WB__.gotoLevel(id), levelId);
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
  }, { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  await sleep(700); // arming + entrance tweens settle
}

/** World → CSS-pixel screen coordinates of a point inside the game world. */
async function worldToScreen(page, x, y) {
  return page.evaluate((wx, wy) => {
    const cam = window.__WB__.scene().cameras.main;
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
  }, x, y);
}

/**
 * Poll a predicate inside the page every ~20ms (tighter and more
 * timing-robust than waitForFunction for catching mid-tween states).
 * Resolves with the last predicate value once truthy, or null on timeout.
 */
async function pollFor(page, fn, timeoutMs = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(20);
  }
}

/** Live card snapshot (phase, geometry, timer/shots) in one round-trip. */
const cardProbe = (page) => page.evaluate(() => {
  const s = window.__WB__.scene();
  const c = s.card;
  return {
    phase: c.phase,
    expanded: c.expanded,
    x: c.root.x, y: c.root.y, scale: c.root.scaleX,
    hudBottom: s.hud.barBottom,
    timer: s.levelTimer.remainingMs,
    shots: s.shotsLeft,
    state: s.stateMachine.current,
    slingEnabled: s.slingshot.enabled,
    closeVisible: !!(c.closeBtn && c.closeBtn.visible),
    hintVisible: c.enlargeHint.visible,
    cardCount: s.children.list.filter((o) => o.parentContainer === null && o.depth === 80).length,
    view: { x: s.cameras.main.worldView.x, y: s.cameras.main.worldView.y, w: s.cameras.main.worldView.width, h: s.cameras.main.worldView.height }
  };
});

const main = async () => {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome/Edge executable found');
  console.log('browser:', exe);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--use-angle=default', '--disable-gpu-sandbox', '--mute-audio']
  });

  const TOP = QUESTION_CARD.TOP;
  const CENTER = QUESTION_CARD.CENTER;
  const dockScale = TOP.width / CENTER.width;
  const dockW = TOP.width, dockH = TOP.width * QUESTION_CARD.ART.ASPECT;

  /* ---------------- desktop 1920×1080 ---------------- */
  {
    const page = await newPage(browser, { w: 1920, h: 1080 });
    await gotoGameScene(page, 3);
    await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'READY_TOP', { timeout: 10000 });

    /* 1. compact docked card */
    let c = await cardProbe(page);
    const leftEdge = c.x - dockW / 2;
    ok(Math.abs(c.x - TOP.x) < 1 && Math.abs(c.y - TOP.y) < 1, `docked at the upper-left spot (${c.x.toFixed(0)},${c.y.toFixed(0)})`);
    ok(Math.abs(c.scale - dockScale) < 0.005, `compact scale ${c.scale.toFixed(3)} (18.5% smaller than Fix #9)`);
    ok(leftEdge >= 20 && leftEdge <= 33, `left edge at the safe margin (${leftEdge.toFixed(1)}px)`);
    ok(c.y - dockH / 2 >= c.hudBottom + 4, `clear gap below the HUD (card top ${(c.y - dockH / 2).toFixed(0)} vs band ${c.hudBottom})`);
    ok(c.cardCount === 1, 'exactly one card container (no duplicates)');
    ok(!c.closeVisible, 'close button hidden while docked');
    await page.screenshot({ path: join(OUT, '1-desktop-compact-docked.png') });

    /* resize robustness — dock stays put, world stays framed */
    await page.setViewport({ width: 1600, height: 900 });
    await sleep(500);
    await page.setViewport({ width: 1920, height: 1080 });
    await sleep(500);
    c = await cardProbe(page);
    ok(Math.abs(c.x - TOP.x) < 1 && Math.abs(c.y - TOP.y) < 1, 'resize did not displace the docked card');

    /* 2. REAL click on the card → smooth-expansion evidence + capture.
       An in-page rAF sampler records every EXPANDING frame (scale ramp) —
       immune to CDP round-trip latency; the screenshot is taken mid-flight
       if a poll catches it, else during a warm API-triggered re-expand
       (identical tween) so the capture is always honest. */
    const before = await cardProbe(page);
    await page.evaluate(() => {
      const card = window.__WB__.scene().card;
      window.__wbExpandSamples = [];
      const sample = () => {
        if (card.phase === 'EXPANDING') {
          window.__wbExpandSamples.push(+card.root.scaleX.toFixed(3));
        }
        if (card.phase !== 'EXPANDED') requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const p = await worldToScreen(page, TOP.x + 120, TOP.y); // tap the parchment body
    await page.mouse.click(p.x, p.y);
    await pollFor(page, () => {
      const c = window.__WB__.cardInfo();
      return c && c.scale > 0.66 && c.scale < 0.93 && c.phase === 'EXPANDING' ? 1 : null;
    }, 2500);
    await page.screenshot({ path: join(OUT, '2-desktop-mid-expansion.png') });
    await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'EXPANDED', { timeout: 3000 });
    const ramp = await page.evaluate(() => {
      const s = window.__wbExpandSamples || [];
      window.__wbExpandSamples = undefined;
      return { n: s.length, min: s.length ? Math.min(...s) : null, max: s.length ? Math.max(...s) : null };
    });
    ok(ramp.n >= 8 && ramp.max - ramp.min > 0.2,
      `expansion tweened smoothly (${ramp.n} frames, scale ${ramp.min}→${ramp.max})`);
    if (ramp.n < 8) {
      // screenshot above may have missed the flight — retake during a warm
      // API re-expand so the halfway capture is genuine either way
      await page.evaluate(() => { window.__WB__.scene().card.closePeek(); });
      await pollFor(page, () => window.__WB__.cardInfo()?.phase === 'READY_TOP' ? 1 : null, 3000);
      await page.evaluate(() => { window.__WB__.scene().card.openPeek(); });
      await pollFor(page, () => {
        const c = window.__WB__.cardInfo();
        return c && c.phase === 'EXPANDING' && c.scale > 0.66 && c.scale < 0.93 ? 1 : null;
      }, 2500);
      await page.screenshot({ path: join(OUT, '2-desktop-mid-expansion.png') });
      await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'EXPANDED', { timeout: 3000 });
    }
    const mid = await cardProbe(page);
    ok(mid.state === 'AIMING' && !mid.slingEnabled, 'expansion blocked the slingshot immediately');
    ok(mid.shots === before.shots, 'the opening click consumed no shot');

    /* 3. fully expanded */
    await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'EXPANDED', { timeout: 3000 });
    await sleep(250); // close-button pop + scrim settle
    c = await cardProbe(page);
    ok(Math.abs(c.x - CENTER.x) < 1 && Math.abs(c.y - CENTER.y) < 1, `expanded at the exact center (${c.x.toFixed(0)},${c.y.toFixed(0)})`);
    ok(Math.abs(c.scale - 1) < 0.005, 'expanded at full reading scale (aspect-true)');
    ok(c.closeVisible, 'close button visible on the enlarged card');
    ok(c.cardCount === 1, 'still exactly one card (expand reuses the SAME container)');
    const frozen = c.timer;
    await sleep(900);
    c = await cardProbe(page);
    ok(Math.abs(c.timer - frozen) < 60, `countdown paused while expanded (${(frozen - c.timer).toFixed(0)}ms drift)`);
    await page.screenshot({ path: join(OUT, '3-desktop-fully-expanded.png') });

    /* speaker stays clickable (its hit zone wins over the card tap zone) */
    const sp = await worldToScreen(page,
      c.x + (QUESTION_CARD.ART.SPEAKER.x - 0.5) * CENTER.width,
      c.y + (QUESTION_CARD.ART.SPEAKER.y - 0.5) * CENTER.width * QUESTION_CARD.ART.ASPECT);
    let spoke = false;
    await page.exposeFunction('__wbSpoke', () => { spoke = true; });
    await page.evaluate(() => {
      const card = window.__WB__.scene().card;
      const orig = card.trySpeak.bind(card);
      card.trySpeak = (...a) => { window.__wbSpoke(); return orig(...a); };
    });
    await page.mouse.click(sp.x, sp.y);
    await sleep(250);
    c = await cardProbe(page);
    ok(c.expanded, 'speaker tap did NOT collapse the card');
    ok(spoke, 'speaker tap reached the speaker button (input isolation)');

    /* 4. close via the corner button → mid-return capture */
    const cbp = await page.evaluate(() => {
      const s = window.__WB__.scene();
      const cam = s.cameras.main;
      const root = s.card.root;
      const btn = s.card.closeBtn;
      return {
        x: (root.x + btn.x * root.scaleX - cam.worldView.x) * cam.zoom,
        y: (root.y + btn.y * root.scaleY - cam.worldView.y) * cam.zoom
      };
    });
    await page.mouse.click(cbp.x, cbp.y);
    const midBack = await pollFor(page, () => {
      const c = window.__WB__.cardInfo();
      return c && c.phase === 'COLLAPSING' && c.scale > 0.66 && c.scale < 0.93
        ? { scale: c.scale } : null;
    }, 3000);
    await page.screenshot({ path: join(OUT, '4-desktop-mid-return.png') });
    ok(!!midBack, midBack
      ? `captured mid-return (scale ${midBack.scale.toFixed(2)})`
      : 'return animation seen in flight');

    /* 5. settled back at the dock; timer resumed; aiming re-enabled */
    await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'READY_TOP', { timeout: 3000 });
    await sleep(200);
    c = await cardProbe(page);
    ok(Math.abs(c.x - TOP.x) < 1 && Math.abs(c.y - TOP.y) < 1 && Math.abs(c.scale - dockScale) < 0.005,
      'returned to the exact dock position/scale');
    ok(c.slingEnabled, 'aiming re-enabled after the collapse finished');
    const resumed = c.timer;
    await sleep(700);
    c = await cardProbe(page);
    ok(c.timer < resumed - 300, 'countdown resumed after closing');
    ok(c.shots === before.shots, 'the whole expand/collapse cycle consumed no shots');
    await page.screenshot({ path: join(OUT, '5-desktop-returned-to-dock.png') });
    await page.close();
  }

  /* ---------------- tablet landscape ---------------- */
  for (const [w, h, name] of [[1180, 820, 'ipad-landscape'], [1280, 800, 'android-tablet']]) {
    const page = await newPage(browser, { w, h });
    await gotoGameScene(page, 3);
    await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'READY_TOP', { timeout: 10000 });
    const c = await cardProbe(page);
    ok(c.y - dockH / 2 >= c.hudBottom + 4, `(${name}) card clears the HUD band`);
    ok(c.view.x <= TOP.x - dockW / 2 && c.view.x + c.view.w >= TOP.x + dockW / 2,
      `(${name}) docked card fully inside the visible world`);
    await page.screenshot({ path: join(OUT, `6-${name}-${w}x${h}.png`) });
    await page.close();
  }

  /* ---------------- phone landscape (iPhone + Android) ---------------- */
  for (const [w, h, name] of [[844, 390, 'iphone-landscape'], [740, 360, 'android-phone-landscape']]) {
    const page = await newPage(browser, { w, h, mobile: true, touch: true });
    await gotoGameScene(page, 3);
    await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'READY_TOP', { timeout: 10000 });
    let c = await cardProbe(page);
    ok(c.y - dockH / 2 >= c.hudBottom + 4, `(${name}) card clears the phone HUD band`);
    ok(c.view.x <= TOP.x - dockW / 2 && c.view.x + c.view.w >= TOP.x + dockW / 2,
      `(${name}) docked card fully inside the visible world`);
    await page.screenshot({ path: join(OUT, `7-${name}-docked.png`) });

    /* touch-tap expand must also work on a phone-sized viewport */
    const p = await worldToScreen(page, TOP.x + 100, TOP.y);
    await page.touchscreen.touchStart(p.x, p.y);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'EXPANDED', { timeout: 4000 });
    c = await cardProbe(page);
    ok(Math.abs(c.x - CENTER.x) < 1 && Math.abs(c.y - CENTER.y) < 1, `(${name}) touch expand centered the card`);
    // enlarged card fits the visible world without clipping
    ok(c.view.x <= CENTER.x - CENTER.width / 2 && c.view.x + c.view.w >= CENTER.x + CENTER.width / 2
      && c.view.y <= CENTER.y - (CENTER.width * QUESTION_CARD.ART.ASPECT) / 2,
      `(${name}) enlarged card fits inside the viewport`);
    await page.screenshot({ path: join(OUT, `7-${name}-expanded.png`) });
    // tap the parchment again to close
    const q = await worldToScreen(page, CENTER.x - 200, CENTER.y);
    await page.touchscreen.touchStart(q.x, q.y);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'READY_TOP', { timeout: 4000 });
    await page.screenshot({ path: join(OUT, `7-${name}-final-layout.png`) });
    await page.close();
  }

  await browser.close();

  console.log('\n== card21 acceptance =======================================');
  if (problems.length) {
    console.log(`PROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(' -', p);
    process.exit(1);
  }
  console.log('all checks passed');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
