/** One-off: reproduce the '.position' pageerror and print its stack. */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const BASE = 'http://localhost:5199/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const seen = new Set();
page.on('pageerror', (e) => {
  const key = e.stack.split('\n').slice(0, 4).join('|');
  if (seen.has(key)) return;
  seen.add(key);
  console.log('--- pageerror ---\n' + e.stack.split('\n').slice(0, 8).join('\n'));
});
await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 20000 });
await page.evaluate(() => {
  const api = window.__WB__;
  api.setAutoPause(false);
  api.setCardTimings({ enterMs: 150, readingMs: 400, moveMs: 150, exitMs: 120 });
  api.gotoLevel(1);
});
await page.waitForFunction(() => {
  const s = window.__WB__.scene();
  return s && s.prepared && s.stateMachine.current === 'AIMING';
}, { timeout: 30000, polling: 100 });
// calibrate world->client
await page.evaluate(() => {
  const api = window.__WB__;
  const rect = api.game.canvas.getBoundingClientRect();
  const c0 = { x: rect.left + rect.width * 0.25, y: rect.top + rect.height * 0.25 };
  const w0 = api.mapClient(c0.x, c0.y);
  const wx = api.mapClient(c0.x + 50, c0.y);
  const wy = api.mapClient(c0.x, c0.y + 50);
  const sx = (wx.x - w0.x) / 50, sy = (wy.y - w0.y) / 50;
  window.__map = { toClient(x, y) { return { x: c0.x + (x - w0.x) / sx, y: c0.y + (y - w0.y) / sy }; } };
});
// the same drag as the failing run: pull to (115, 432), release
const p0 = await page.evaluate(() => window.__map.toClient(195, 346));
const p1 = await page.evaluate(() => window.__map.toClient(120, 428));
await page.mouse.move(p0.x, p0.y);
await page.mouse.down();
await page.mouse.move(p1.x, p1.y, { steps: 8 });
await sleep(220);
await page.mouse.up();
// watch up to 25s for AIMING and collect stacks
try {
  await page.waitForFunction(() => {
    const s = window.__WB__.scene();
    return s.stateMachine.current === 'AIMING';
  }, { timeout: 25000, polling: 120 });
  console.log('reached AIMING');
} catch {
  console.log('never reached AIMING; state =', await page.evaluate(() => window.__WB__.state()));
}
await browser.close();
