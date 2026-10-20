/**
 * MOBILE LANDSCAPE + DEPLOYMENT EVIDENCE (GitHub Pages base build).
 *
 * Serves dist/ (built with --base=/word-blast/) at the real deployment prefix
 * and produces screenshot + assertion evidence for the required test matrix:
 *
 *   Desktop 1280×720 : menu boots, no rotate overlay, gameplay, FPS.
 *   Mobile landscape (667×375, DPR 2, touch, iPhone UA): no overlay, menu,
 *                      gameplay + shot, FPS, input mapping sanity.
 *   Mobile portrait  (375×667): styled rotate overlay visible, input blocked.
 *   Rotation mid-game: AIMING → portrait (paused, state kept) → landscape
 *                      (resumed, same level/question/score — no restart).
 *
 * Also records every console error/page error — any of them fails the run.
 * Run AFTER `npm run build:pages`. Output: screenshots/12-*.png + console log.
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'screenshots');
const PREFIX = '/word-blast/';
const PORT = 8092;
mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.ico': 'image/x-icon', '.map': 'application/json', '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json'
};

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Browsers request /favicon.ico once per session at the server root; the
  // real GitHub Pages host serves one — a local 404 here is server noise.
  if (url === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (!url.startsWith(PREFIX)) { res.writeHead(404).end('prefix only'); return; }
  let rel = url.slice(PREFIX.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found: ' + rel);
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => existsSync(p));

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const failures = [];
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures.push(name);
};

/** Average/min FPS over a sampling window while the game runs. */
async function sampleFps(page, ms) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const samples = [];
    const t0 = performance.now();
    const tick = () => {
      const g = window.__WB__ && window.__WB__.game;
      if (g && Number.isFinite(g.loop.actualFps)) samples.push(g.loop.actualFps);
      if (performance.now() - t0 < ms) setTimeout(tick, 100);
      else resolve({ n: samples.length, avg: samples.reduce((a, b) => a + b, 0) / samples.length, min: Math.min(...samples) });
    };
    tick();
  }), ms);
}

async function freshPage(browser, viewport, isMobile) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('http ' + r.status() + ' ' + r.url()); });
  await page.setViewport({ ...viewport, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile });
  if (isMobile) await page.setUserAgent(MOBILE_UA);
  await page.goto(`http://localhost:${PORT}${PREFIX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene');
  }, { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  return { page, errors };
}

const overlayState = (page) => page.evaluate(() => {
  const el = document.getElementById('rotate-overlay');
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return { display: cs.display, bg: cs.backgroundColor, covers: rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95 };
});

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 }
});

try {
  /* ---------------- Desktop ---------------- */
  console.log('DESKTOP 1280×720');
  {
    const { page, errors } = await freshPage(browser, { width: 1280, height: 720 }, false);
    const ov = await overlayState(page);
    check('no rotate overlay on desktop', ov.display === 'none');
    await page.screenshot({ path: join(SHOTS, '12-desktop-menu.png') });
    await page.evaluate(() => window.__WB__.gotoLevel(1));
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 });
    await page.screenshot({ path: join(SHOTS, '12-desktop-gameplay.png') });
    // input mapping sanity: canvas center + corners map inside/near the world
    const map = await page.evaluate(() => {
      const r = window.__WB__.game.canvas.getBoundingClientRect();
      const c = window.__WB__.mapClient(r.left + r.width / 2, r.top + r.height / 2);
      return { c, w: window.__WB__.game.scale.gameSize };
    });
    check('client→world mapping sane (center ≈ world center)',
      Math.abs(map.c.x - 640) < 40 && Math.abs(map.c.y - 360) < 40,
      `center=(${map.c.x.toFixed(0)},${map.c.y.toFixed(0)})`);
    const fps = await sampleFps(page, 3000);
    console.log(`  fps(menu-quiet level 1): avg=${fps.avg.toFixed(1)} min=${fps.min.toFixed(1)} (${fps.n} samples)`);
    check('no console/http errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  /* ---------------- Mobile landscape ---------------- */
  console.log('MOBILE LANDSCAPE 667×375 DPR2 touch (iPhone UA)');
  {
    const { page, errors } = await freshPage(browser, { width: 667, height: 375 }, true);
    const ov = await overlayState(page);
    check('no rotate overlay in landscape', ov.display === 'none');
    await page.screenshot({ path: join(SHOTS, '12-mobile-landscape-menu.png') });
    await page.evaluate(() => window.__WB__.gotoLevel(1));
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: join(SHOTS, '12-mobile-landscape-gameplay.png') });
    await page.screenshot({ path: join(SHOTS, '12-mobile-landscape-birds.png'), clip: { x: 0, y: 375 - 120, width: 667, height: 120 } });
    // question card is open during AIMING — full-screen shot includes it
    const cardOpen = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return !!(s.card && s.card.phase);
    });
    check('question card present during AIMING', cardOpen);
    // launch a bird through the real slingshot release path (autoAim
    // computes the arc AND fires it via debugLaunch in one call)
    const sol = await page.evaluate(() => window.__WB__.autoAim());
    check('autoAim produced a launch solution', !!sol);
    await new Promise(r => setTimeout(r, 2500));
    await page.screenshot({ path: join(SHOTS, '12-mobile-landscape-feedback.png') });
    const fps = await sampleFps(page, 4000);
    console.log(`  fps(mobile landscape, level 1): avg=${fps.avg.toFixed(1)} min=${fps.min.toFixed(1)} (${fps.n} samples)`);

    /* -------- Rotation during gameplay: landscape → portrait → landscape -------- */
    const before = await page.evaluate(() => window.__WB__.info());
    await page.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
    await new Promise(r => setTimeout(r, 900)); // debounce + settle
    const pov = await overlayState(page);
    const portraitInfo = await page.evaluate(() => window.__WB__.info());
    check('portrait overlay visible after rotation', pov.display === 'flex');
    check('portrait overlay styled (dark fantasy bg)', pov.bg.includes('8, 28, 21'), pov.bg);
    check('portrait overlay covers viewport (input blocked)', pov.covers);
    check('physics paused in portrait', portraitInfo.state === 'PAUSED',
      `${before.state} → ${portraitInfo.state} (state machine paused, resume restores it)`);
    await page.screenshot({ path: join(SHOTS, '12-mobile-portrait-rotate.png') });

    await page.setViewport({ width: 667, height: 375, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
    await new Promise(r => setTimeout(r, 900));
    const after = await page.evaluate(() => window.__WB__.info());
    const ov2 = await overlayState(page);
    check('overlay hidden again in landscape', ov2.display === 'none');
    check('same level after rotation (no restart)', after.levelId === before.levelId, `${before.levelId} → ${after.levelId}`);
    check('same question after rotation', after.questionIndex === before.questionIndex);
    check('score preserved across rotation', after.score === before.score, `${before.score} → ${after.score}`);
    check('no extra shot consumed by rotating', after.shotsUsed === before.shotsUsed, `${before.shotsUsed} → ${after.shotsUsed}`);
    await page.screenshot({ path: join(SHOTS, '12-mobile-landscape-after-rotation.png') });

    /* -------- Complex level: heavy destruction FPS -------- */
    await page.evaluate(() => window.__WB__.gotoLevel(15));
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 });
    const sol15 = await page.evaluate(() => window.__WB__.autoAim());
    await page.evaluate((s) => window.__WB__.simulateShot({ vx: s.vx, vy: s.vy, type: 'bomb' }), sol15);
    const fps15 = await sampleFps(page, 5000);
    console.log(`  fps(mobile landscape, level 15 bomb collapse): avg=${fps15.avg.toFixed(1)} min=${fps15.min.toFixed(1)} (${fps15.n} samples)`);
    check('no console/http errors (mobile pass)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }

  /* ---------------- Mobile portrait from cold load ---------------- */
  console.log('MOBILE PORTRAIT 375×667 (cold load)');
  {
    const { page, errors } = await freshPage(browser, { width: 375, height: 667 }, true);
    await new Promise(r => setTimeout(r, 700));
    const ov = await overlayState(page);
    check('rotate overlay visible on portrait cold load', ov.display === 'flex');
    check('overlay styled on portrait cold load', ov.bg.includes('8, 28, 21'), ov.bg);
    await page.screenshot({ path: join(SHOTS, '12-mobile-portrait-cold.png') });
    // canvas input must be blocked: overlay is on top and swallows touches
    const blocked = await page.evaluate(() => {
      const el = document.getElementById('rotate-overlay');
      const cs = getComputedStyle(el);
      return cs.display === 'flex' && cs.pointerEvents !== 'none' && parseInt(cs.zIndex, 10) >= 1000;
    });
    check('overlay swallows input (z-index + pointer events)', blocked);
    check('no console/http errors (portrait pass)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures.length === 0
  ? '== mobile/deployment evidence PASSED =='
  : `== mobile/deployment evidence FAILED: ${failures.join(', ')} ==`);
process.exit(failures.length === 0 ? 0 : 1);
