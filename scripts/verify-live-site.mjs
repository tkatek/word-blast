/**
 * LIVE SITE verification — runs the full boot→menu→level pipeline against the
 * PUBLISHED GitHub Pages build (not a local server): menu loads, textures
 * load, level starts, no 404s/console errors, plus desktop/mobile-portrait/
 * mobile-landscape screenshots. Run: node scripts/verify-live-site.mjs
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOTS = join(ROOT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const URL = 'https://tkatek.github.io/word-blast/';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => existsSync(p));

const failures = [];
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) failures.push(name);
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 }
});

async function openGame(viewport, mobile) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // GitHub Pages 404s the user-root favicon.ico request (empty-URL message)
    const loc = m.location() && m.location().url || '';
    if (m.type() === 'error' && !loc.includes('favicon') && !m.text().includes('favicon')) {
      errors.push('console: ' + m.text() + (loc ? ' @ ' + loc : ''));
    }
  });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('http ' + r.status() + ' ' + r.url()); });
  await page.setViewport({ ...viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  if (mobile) await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return { page, errors };
}

try {
  console.log(`LIVE SITE ${URL}`);
  {
    const { page, errors } = await openGame({ width: 1280, height: 720 }, false);
    await page.waitForFunction(() => {
      const g = window.__WB__ && window.__WB__.game;
      return g && g.scene.isActive('MenuScene');
    }, { timeout: 45000 });
    check('menu boots on live site (MenuScene active, boot watchdog ok)', true);
    await page.evaluate(() => window.__WB__.setAutoPause(false));
    const logo = await page.evaluate(() => {
      const s = window.__WB__;
      return !!(s.menu && s.menu().active);
    });
    check('menu diagnostics available', logo);
    await page.screenshot({ path: join(SHOTS, '13-live-desktop-menu.png') });
    await page.evaluate(() => window.__WB__.gotoLevel(1));
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
    const tex = await page.evaluate(() => {
      const g = window.__WB__.game;
      return ['bird-red', 'bird-blue', 'bird-yellow', 'bird-black', 'bird-purple', 'bird-green']
        .every((k) => g.textures.exists(k));
    });
    check('level 1 starts (AIMING), all bird textures loaded', tex);
    const sol = await page.evaluate(() => window.__WB__.autoAim());
    check('slingshot launch path works on live build', !!sol);
    await new Promise(r => setTimeout(r, 2200));
    await page.screenshot({ path: join(SHOTS, '13-live-desktop-gameplay.png') });
    check('no console/http errors (live desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
  {
    const { page, errors } = await openGame({ width: 667, height: 375 }, true);
    await page.waitForFunction(() => {
      const g = window.__WB__ && window.__WB__.game;
      return g && g.scene.isActive('MenuScene');
    }, { timeout: 45000 });
    const ovL = await page.evaluate(() => getComputedStyle(document.getElementById('rotate-overlay')).display);
    check('mobile landscape: no rotate overlay', ovL === 'none');
    await page.screenshot({ path: join(SHOTS, '13-live-mobile-landscape.png') });
    check('no console/http errors (live mobile landscape)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
  {
    const { page, errors } = await openGame({ width: 375, height: 667 }, true);
    await page.waitForFunction(() => {
      const g = window.__WB__ && window.__WB__.game;
      return g && g.scene.isActive('MenuScene');
    }, { timeout: 45000 });
    await new Promise(r => setTimeout(r, 800));
    const cs = await page.evaluate(() => {
      const el = getComputedStyle(document.getElementById('rotate-overlay'));
      return { display: el.display, bg: el.backgroundColor };
    });
    check('mobile portrait: styled rotate overlay visible', cs.display === 'flex' && cs.bg.includes('8, 28, 21'), cs.display + ' ' + cs.bg);
    await page.screenshot({ path: join(SHOTS, '13-live-mobile-portrait.png') });
    check('no console/http errors (live mobile portrait)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(failures.length === 0
  ? '== LIVE SITE verification PASSED =='
  : `== LIVE SITE verification FAILED: ${failures.join(', ')} ==`);
process.exit(failures.length === 0 ? 0 : 1);
