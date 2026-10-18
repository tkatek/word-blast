/** One-off: sample gameplay vs UI camera matrices across a forced shake. */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 30000 });
await page.evaluate(() => window.__WB__.gotoLevel(3));
await page.waitForFunction(() => {
  const s = window.__WB__ && window.__WB__.scene();
  return s && s.prepared && s.stateMachine.current === 'AIMING';
}, { timeout: 30000 });
await page.evaluate(() => window.__WB__.setAutoPause(false));
await sleep(500);

const info = await page.evaluate(() => {
  const s = window.__WB__.scene();
  return {
    reducedMotion: s.save.data.settings.reducedMotion,
    sound: s.save.data.settings.sound,
    mainId: s.cameras.main.id,
    uiId: s.hud.uiCam.id,
    mainZoom: s.cameras.main.zoom,
    uiZoom: s.hud.uiCam.zoom
  };
});
console.log('scene info:', JSON.stringify(info));

const samples = await page.evaluate(async () => {
  const s = window.__WB__.scene();
  const main = s.cameras.main;
  const ui = s.hud.uiCam;
  const out = [];
  const t0 = performance.now();
  s.fx.shakeForImpact(160, 500);
  while (performance.now() - t0 < 600) {
    out.push({
      t: Math.round(performance.now() - t0),
      mtx: +main.matrix.tx.toFixed(2), mty: +main.matrix.ty.toFixed(2),
      utx: +ui.matrix.tx.toFixed(2), uty: +ui.matrix.ty.toFixed(2)
    });
    await new Promise((r) => requestAnimationFrame(r));
  }
  return out;
});
for (const smp of samples.filter((_, i) => i % 6 === 0)) console.log(JSON.stringify(smp));
const mMoved = samples.some((x) => Math.abs(x.mtx) > 0.5 || Math.abs(x.mty) > 0.5);
const uMoved = samples.some((x) => Math.abs(x.utx) > 0.5 || Math.abs(x.uty) > 0.5);
console.log('main cam matrix moved:', mMoved, '| ui cam matrix moved:', uMoved);
await browser.close();
