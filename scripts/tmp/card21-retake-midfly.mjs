/**
 * Retake the two mid-flight Fix #21 captures with a temporally stretched
 * (identical code path, same easing) expand/collapse so the CDP screenshot
 * latency lands inside the true midpoint of the glide.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT = join(root, 'screenshots', 'card21');
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--use-angle=default', '--disable-gpu-sandbox', '--mute-audio']
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 30000 });
await page.evaluate(() => window.__WB__.gotoLevel(3));
await page.waitForFunction(() => {
  const s = window.__WB__ && window.__WB__.scene();
  return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
}, { timeout: 30000 });
await page.evaluate(() => window.__WB__.setAutoPause(false));
await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'READY_TOP', { timeout: 10000 });
await sleep(600);

// stretch the peek tween for latency-safe midpoint captures
await page.evaluate(() => window.__WB__.setCardTimings({ peekMs: 1200 }));

const pollFor = async (fn, timeoutMs = 4000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(15);
  }
};

/* real click on the docked card → capture the true midpoint */
const p = await page.evaluate(() => {
  const s = window.__WB__.scene();
  const cam = s.cameras.main;
  return { x: (399 - cam.worldView.x) * cam.zoom, y: (151 - cam.worldView.y) * cam.zoom };
});
await page.mouse.click(p.x, p.y);
const mid1 = await pollFor(() => {
  const c = window.__WB__.cardInfo();
  return c && c.phase === 'EXPANDING' && c.scale > 0.63 && c.scale < 0.70 ? c.scale : null;
});
console.log('mid-expansion captured at scale', mid1);
await page.screenshot({ path: join(OUT, '2-desktop-mid-expansion.png') });

await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'EXPANDED', { timeout: 5000 });
await sleep(400); // close button pop + scrim settle

/* close via the corner button → capture the true midpoint of the return */
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
const mid2 = await pollFor(() => {
  const c = window.__WB__.cardInfo();
  return c && c.phase === 'COLLAPSING' && c.scale > 0.86 && c.scale < 0.93 ? c.scale : null;
});
console.log('mid-return captured at scale', mid2);
await page.screenshot({ path: join(OUT, '4-desktop-mid-return.png') });

await page.waitForFunction(() => window.__WB__.cardInfo()?.phase === 'READY_TOP', { timeout: 5000 });
await page.evaluate(() => window.__WB__.setCardTimings({ peekMs: 460 })); // restore production timing
console.log('done');
await browser.close();
