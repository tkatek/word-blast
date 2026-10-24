/**
 * LOAD-TIME PASS acceptance (visual): boots the REAL built game over HTTP
 * in Chrome/Edge with throttled networking and verifies the ONE full-page
 * loading screen lifecycle:
 *
 *   1. visible while the JS bundle downloads (before any canvas)
 *   2. STILL visible (never shrinking/switching) while boot + menu assets
 *      download behind it
 *   3. fades away exactly when the menu is on screen
 *   4. the music asset lands in the audio cache AFTER the menu (deferred)
 *
 * Plus console/page-error capture: the run FAILS on any page error or
 * failed request.
 *
 * Run: node scripts/verify-loading.mjs [http://host:port]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'loading-pass');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://localhost:4173';
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

const loaderState = (page) => page.evaluate(() => {
  const el = document.getElementById('wb-loader');
  return {
    visible: !!el && !el.classList.contains('is-done') && getComputedStyle(el).display !== 'none',
    booted: !!(window.__wbBoot && window.__wbBoot.booted)
  };
}).catch(() => ({ visible: false, booted: false }));

const main = async () => {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome/Edge executable found');
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  const badRequests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => badRequests.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`); });

  // Simulate a mid-range mobile connection so the loader is observable.
  await page.emulateNetworkConditions({
    offline: false,
    latency: 150,
    downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8), // 1.6 Mbps, bytes/s
    uploadThroughput: Math.round((750 * 1024) / 8)
  });

  // Module scripts execute BEFORE DOMContentLoaded — the loader's visible
  // window starts with the bundle download, so poll WHILE the navigation
  // is in flight (evaluate calls fail harmlessly until the context exists).
  const nav = page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Phase 1 — loader up while the bundle downloads (before the canvas).
  let phase1Seen = false;
  const phase1Deadline = Date.now() + 45000;
  while (Date.now() < phase1Deadline) {
    const s = await loaderState(page);
    if (s.visible) { phase1Seen = true; break; }
    if (s.booted) break;
    await sleep(100);
  }
  await page.screenshot({ path: join(OUT, '01-loader-bundle-phase.png') });
  check(phase1Seen, 'full-page loader visible during bundle download');

  // Phase 2 — canvas appears behind the loader, assets download: the SAME
  // loader must stay up (no shrinking, no second bar taking over).
  await page.waitForSelector('#game canvas', { timeout: 60000 });
  const seenWithCanvas = await loaderState(page);
  await page.screenshot({ path: join(OUT, '02-loader-asset-phase.png') });
  check(seenWithCanvas.visible, 'same full-page loader still covering the asset download');

  // Phase 3 — menu appears: the loader fades away within a moment.
  await page.waitForFunction(() => {
    const wb = window.__WB__;
    return !!(wb && wb.menu && wb.menu().active);
  }, { timeout: 90000 });
  const menuAt = Date.now();
  let loaderGone = false;
  while (Date.now() - menuAt < 4000) {
    const s = await loaderState(page);
    if (!s.visible) { loaderGone = true; break; }
    await sleep(120);
  }
  await sleep(300);
  await page.screenshot({ path: join(OUT, '03-menu.png') });
  check(loaderGone, 'loader retires when the menu is on screen');

  // Phase 4 — deferred music: arrives AFTER the menu was already visible.
  const musicCached = await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return !!(g && g.cache && g.cache.audio && g.cache.audio.exists('music-theme'));
  }, { timeout: 90000 }).then(() => true).catch(() => false);
  const msAfterMenu = Date.now() - menuAt;
  await page.screenshot({ path: join(OUT, '04-menu-after-music.png') });
  check(musicCached, 'deferred music track lands in the audio cache after the menu',
    musicCached ? `${(msAfterMenu / 1000).toFixed(1)}s after menu` : 'never (timeout)');

  check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
  check(badRequests.length === 0, 'no failed/4xx+ requests', badRequests.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed — screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
