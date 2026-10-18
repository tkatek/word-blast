/** Probe: per-dot whiteness values in a mid-drag screenshot. */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(existsSync);

const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle2' });
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
const p0 = await page.evaluate(() => window.__map.toClient(195, 346));
const p1 = await page.evaluate(() => window.__map.toClient(120, 430));
await page.mouse.move(p0.x, p0.y);
await page.mouse.down();
await page.mouse.move(p1.x, p1.y, { steps: 8 });
await sleep(250);
const dots = await page.evaluate(() => {
  const sl = window.__WB__.scene().slingshot;
  return sl.trajectoryDots().map((p) => window.__map.toClient(p.x, p.y));
});
const path = 'C:/wb-fix7/probe.png';
await page.screenshot({ path });
const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
const w = (cx, cy, box) => {
  let best = 0;
  for (let y = Math.max(0, Math.round(cy) - box); y <= Math.min(info.height - 1, Math.round(cy) + box); y++)
    for (let x = Math.max(0, Math.round(cx) - box); x <= Math.min(info.width - 1, Math.round(cx) + box); x++) {
      const i = (y * info.width + x) * info.channels;
      best = Math.max(best, Math.min(data[i], data[i + 1], data[i + 2]));
    }
  return best;
};
const vals = dots.map((c, i) => ({ i, r: +(4.5 - i * 0.07).toFixed(2), fg2: w(c.x, c.y, 2), fg4: w(c.x, c.y, 4) }));
console.log(JSON.stringify(vals));
await browser.close();
