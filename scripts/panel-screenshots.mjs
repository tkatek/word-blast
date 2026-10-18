/**
 * ANSWER PANEL acceptance screenshots — boots the REAL built game (vite build
 * served over HTTP) in Chrome/Edge and captures the panel system:
 *
 *   desktop 1920×1080 : short-answer question (compact panels)
 *   desktop 1920×1080 : long-answer question (XL parchment panels)
 *   desktop           : close-up crop of the three XL panels
 *   desktop           : the enlarged reading view (hold-a-panel peek)
 *   phone 844×390     : long answers on mobile landscape
 *   tablet 1180×820   : long answers on tablet landscape
 *
 * Run:  node scripts/panel-screenshots.mjs [http://host:port]
 * (defaults to the vite preview server on :4273)
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'docs', 'screenshots', 'panels');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:4273';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function gotoQuestion(page, levelId, index) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const booted = async () => {
    try {
      await page.waitForFunction(() => window.__WB__ && window.__WB__.scene()
        && window.__WB__.save() !== null, { timeout: 90000 });
      return true;
    } catch {
      return false;
    }
  };
  if (!await booted()) {
    console.log('  (boot wait timed out — reloading once)');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!await booted()) throw new Error('game never finished booting');
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const ok = await page.evaluate(([l, i]) => window.__WB__.gotoQuestion(l, i), [levelId, index]);
      if (ok) break;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1500);
    }
  }
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });
  // a moment for the settle visuals + label sync
  await sleep(700);
}

async function shot(page, name) {
  const file = join(OUT, name);
  await page.screenshot({ path: file });
  console.log('  saved', name);
  return file;
}

/** Crop a world-rectangle out of a full screenshot (canvas fills viewport). */
async function cropWorld(file, out, { x, y, w, h, viewW, viewH }) {
  const scale = Math.min(viewW / 1280, viewH / 720);
  const offX = (viewW - 1280 * scale) / 2;
  const offY = (viewH - 720 * scale) / 2;
  await sharp(file)
    .extract({
      left: Math.max(0, Math.round(offX + x * scale)),
      top: Math.max(0, Math.round(offY + y * scale)),
      width: Math.min(Math.round(w * scale), viewW),
      height: Math.min(Math.round(h * scale), viewH)
    })
    .png().toFile(out);
  console.log('  saved', join(OUT, basename(out)));
}
const basename = (p) => p.split(/[\\/]/).pop();

const browserPath = findBrowser();
if (!browserPath) throw new Error('no Chrome/Edge found');
const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
});
try {
  /* --- desktop: short answers (level 1, question 1: chair/blue/run) ------- */
  {
    const page = await newPage(browser, { w: 1920, h: 1080 });
    await gotoQuestion(page, 1, 0);
    await shot(page, 'desktop-short-answers.png');
    await page.close();
  }

  /* --- desktop: long answers (level 8 question 2: the 39-char sentences) -- */
  {
    const page = await newPage(browser, { w: 1920, h: 1080 });
    await gotoQuestion(page, 8, 1);
    await shot(page, 'desktop-long-answers.png');
    const info = await page.evaluate(() => {
      const t = window.__WB__.scene().factory.targets;
      return t.map((x) => ({ x: x.x, y: x.y, w: x.displayWidth, h: x.displayHeight, fmt: x.wb.format }));
    });
    console.log('  targets:', JSON.stringify(info));
    // close-up crop around the three panels
    const x0 = Math.min(...info.map((t) => t.x - t.w / 2)) - 30;
    const x1 = Math.max(...info.map((t) => t.x + t.w / 2)) + 30;
    const y0 = Math.min(...info.map((t) => t.y - t.h / 2)) - 30;
    const y1 = Math.max(...info.map((t) => t.y + t.h / 2)) + 30;
    await cropWorld(join(OUT, 'desktop-long-answers.png'), join(OUT, 'desktop-long-closeup.png'),
      { x: x0, y: y0, w: x1 - x0, h: y1 - y0, viewW: 1920, viewH: 1080 });

    // enlarged reading view (peek): simulate the Z key
    await page.keyboard.press('z');
    await sleep(450);
    await shot(page, 'desktop-answer-peek.png');
    await page.keyboard.press('z');
    await page.close();
  }

  /* --- phone landscape: long answers -------------------------------------- */
  {
    const page = await newPage(browser, { w: 844, h: 390, mobile: true, touch: true });
    await gotoQuestion(page, 8, 1);
    await shot(page, 'phone-landscape-long-answers.png');
    await page.close();
  }

  /* --- tablet landscape: long answers ------------------------------------- */
  {
    const page = await newPage(browser, { w: 1180, h: 820 });
    await gotoQuestion(page, 13, 1);
    await shot(page, 'tablet-long-answers.png');
    await page.close();
  }

  console.log('\nscreenshots written to', OUT);
} finally {
  await browser.close();
}
