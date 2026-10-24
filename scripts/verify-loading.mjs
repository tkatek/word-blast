/**
 * LOAD-TIME PASS acceptance (visual): boots the REAL built game over HTTP
 * in Chrome/Edge with throttled networking and captures, as screenshots:
 *
 *   1. the new HTML boot loading screen (#wb-loader) mid-download
 *   2. the Phaser BootScene loading bar mid-asset-batch
 *   3. the menu once it appears (menu art batch done, music downloading)
 *   4. music asset landed in the audio cache shortly after (deferred load)
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

  // Simulate a mid-range mobile connection so the loaders are observable
  // (page-level API — a raw CDP session does not reliably throttle).
  await page.emulateNetworkConditions({
    offline: false,
    latency: 150,
    downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8), // 1.6 Mbps, bytes/s
    uploadThroughput: Math.round((750 * 1024) / 8)
  });

  // NOTE: module scripts execute BEFORE DOMContentLoaded — with a real
  // throttle the HTML loader's visible window IS the bundle download, so
  // polling must run WHILE the navigation is in flight (evaluate calls
  // fail harmlessly until the first execution context exists).
  const nav = page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  // 1 — HTML boot loader visible while the JS bundle downloads: poll from
  // the first bytes until the boot handshake retires it.
  let htmlLoaderSeen = false;
  let shotTaken = false;
  const bootDeadline = Date.now() + 45000;
  while (Date.now() < bootDeadline) {
    const state = await page.evaluate(() => {
      const el = document.getElementById('wb-loader');
      const api = window.__wbBoot;
      return {
        visible: !!el && !el.classList.contains('is-done') && getComputedStyle(el).display !== 'none',
        booted: !!(api && api.booted)
      };
    }).catch(() => ({ visible: false, booted: false }));
    if (state.visible) {
      htmlLoaderSeen = true;
      if (!shotTaken) {
        await page.screenshot({ path: join(OUT, '01-html-boot-loader.png') });
        shotTaken = true;
      }
    }
    if (state.booted && htmlLoaderSeen) break;
    if (state.booted && !htmlLoaderSeen) {
      // booted without us catching it — give the poll a final grace sweep
      await sleep(120);
      continue;
    }
    await sleep(120);
  }
  if (!shotTaken) await page.screenshot({ path: join(OUT, '01-html-boot-loader.png') });
  check(htmlLoaderSeen, 'HTML boot loading screen visible during bundle download');
  await nav;

  // 2 — BootScene bar: wait for the canvas, then shoot mid-asset-batch.
  await page.waitForSelector('#game canvas', { timeout: 30000 });
  await sleep(250);
  await page.screenshot({ path: join(OUT, '02-bootscene-loading-bar.png') });

  // 3 — menu visible (boot assets + menu art done).
  await page.waitForFunction(() => {
    const wb = window.__WB__;
    return !!(wb && wb.menu && wb.menu().active);
  }, { timeout: 90000 });
  const menuAt = Date.now();
  await sleep(400);
  await page.screenshot({ path: join(OUT, '03-menu.png') });

  // 4 — deferred music: arrives AFTER the menu was already on screen.
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
