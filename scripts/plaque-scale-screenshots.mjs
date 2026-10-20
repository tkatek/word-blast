/**
 * PLAQUE SCALE acceptance screenshots — the giant-card fix, verified in a
 * REAL browser against the built game:
 *
 *   L13 Q1 (XL parchment, long answers): auto-aim a REAL shot at a WRONG
 *   answer and capture the hit plaque
 *     1. before the hit            (configured size)
 *     2. mid flash (+~150ms)       (the old bug doubled the card here)
 *     3. after the flash (+800ms)  (the old bug STAYED doubled here)
 *     4. after TRY AGAIN           (plaque persists through the retry)
 *   with close-up crops centered on the hit plaque + numeric size reads.
 *
 * Run:  node scripts/plaque-scale-screenshots.mjs [http://host:port]
 * (defaults to the vite preview server on :4273)
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'screenshots', 'plaque-scale');
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

/** Numeric size fingerprint of every plaque (in-page). */
const SIZES_FN = () => {
  const s = window.__WB__.scene();
  return s.factory.targets.map((t) => ({
    id: t.wb.choiceId, format: t.wb.format, hit: t.wb.hit,
    scale: +t.scaleX.toFixed(3),
    w: +t.displayWidth.toFixed(1), h: +t.displayHeight.toFixed(1),
    x: Math.round(t.x), y: Math.round(t.y)
  }));
};

async function cropAround(page, shotPath, cropPath, wx, wy) {
  const c = await page.evaluate(([x, y]) => {
    const p = window.__WB__.worldToClient(x, y);
    return { cx: p.x, cy: p.y };
  }, [wx, wy]);
  const W = 760, H = 340; // covers the hit plaque + neighbors + scale reference
  const left = Math.max(0, Math.round(c.cx - W / 2));
  const top = Math.max(0, Math.round(c.cy - H / 2));
  await sharp(shotPath).extract({ left, top, width: Math.min(W, 1920 - left), height: Math.min(H, 1080 - top) })
    .toFile(cropPath);
}

const main = async () => {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('no Chrome/Edge found');
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--window-size=1920,1080'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.game && window.__WB__.game.isBooted, { timeout: 30000 });
  // BootScene must finish wiring the shared managers into the registry
  await page.waitForFunction(() => {
    const g = window.__WB__.game;
    return !!(g.registry.get('questions') && g.registry.get('levels') && g.registry.get('save'));
  }, { timeout: 30000 });
  await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.setCardTimings({ enterMs: 40, readingMs: 150, moveMs: 60, exitMs: 50 }); });

  // L13 Q1 — XL parchment question (long sentence answers)
  await page.evaluate(() => window.__WB__.gotoQuestion(13, 0));
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await sleep(2500); // build-time settle

  const before = await page.evaluate(SIZES_FN);
  console.log('BEFORE :', JSON.stringify(before));
  await page.screenshot({ path: join(OUT, '1-before-hit.png') });

  // pick a WRONG answer and fire the game's own auto-aimed REAL shot at it
  const wrong = before.find((t) => !t.hit && t.id !== undefined);
  const wrongId = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const correct = s.prepared.question.correctAnswerId;
    const w = s.factory.targets.find((t) => t.wb.choiceId !== correct);
    return w ? w.wb.choiceId : null;
  });
  const aim = await page.evaluate((id) => window.__WB__.autoAim(id), wrongId);
  console.log('auto-aim at wrong answer', wrongId, '→', aim ? 'fired' : 'FAILED');
  if (!aim) throw new Error('auto-aim found no solution');

  await page.waitForFunction(() => window.__WB__.state() === 'ANSWER_FEEDBACK', { timeout: 20000 });
  await sleep(150); // inside the old 130ms scale-tween window
  const mid = await page.evaluate(SIZES_FN);
  console.log('FLASH  :', JSON.stringify(mid));
  const hit = mid.find((t) => t.hit);
  await page.screenshot({ path: join(OUT, '2-mid-flash.png') });
  if (hit) await cropAround(page, join(OUT, '2-mid-flash.png'), join(OUT, '2-mid-flash-crop.png'), hit.x, hit.y);

  await sleep(700); // flash window long over
  const after = await page.evaluate(SIZES_FN);
  console.log('AFTER  :', JSON.stringify(after));
  await page.screenshot({ path: join(OUT, '3-after-flash.png') });

  // TRY AGAIN → same question, plaque stays in the world
  await page.waitForFunction(() => {
    const i = window.__WB__.feedbackInfo();
    return i && i.visible && i.actionEnabled && !i.acted;
  }, { timeout: 20000 });
  await page.evaluate(() => window.__WB__.scene().feedbackCard.act());
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 });
  await sleep(1500);
  const retry = await page.evaluate(SIZES_FN);
  console.log('RETRY  :', JSON.stringify(retry));
  await page.screenshot({ path: join(OUT, '4-after-try-again.png') });
  const retryHit = retry.find((t) => t.hit);
  if (retryHit) await cropAround(page, join(OUT, '4-after-try-again.png'), join(OUT, '4-after-try-again-crop.png'), retryHit.x, retryHit.y);

  // numeric verdict: every stage must equal the before-stage sizes exactly
  const same = (a, b) => a.length === b.length && a.every((t, i) =>
    t.w === b[i].w && t.h === b[i].h && t.scale === b[i].scale);
  const okAll = same(after, before) && same(retry, before)
    && mid.every((t) => Math.abs(t.scale - 0.5) < 0.001 && t.w <= 300.5);
  console.log(okAll ? 'VERDICT: card sizes CONSTANT across hit / flash / retry' : 'VERDICT: SIZE CHANGED — BUG STILL PRESENT');

  await browser.close();
};

main().catch((e) => { console.error(e); process.exit(1); });
