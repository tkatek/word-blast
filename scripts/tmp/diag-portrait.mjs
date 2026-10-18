import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findBrowser() {
  return ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(existsSync)[0];
}
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: 'new',
  args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio','--disable-dev-shm-usage','--no-first-run']
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() => {
    const wb = window.__WB__;
    return !!(wb && wb.game && wb.game.registry.get('levels') && wb.game.registry.get('save'));
  }).catch(() => false);
  if (ok) break;
  await sleep(1000);
}
await page.evaluate(() => window.__WB__.gotoLevel(12));
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(() => window.__WB__ ? window.__WB__.state() : null).catch(() => null);
  if (st === 'AIMING') break;
  await sleep(500);
}
const metrics = await page.evaluate(() => {
  const s = window.__WB__.scene();
  const out = {};
  for (const [key, rec] of s.birdSelector.cards) {
    const p = rec.portrait;
    out[key] = {
      texture: p.texture.key,
      texW: p.texture.getSourceImage().width,
      scale: +p.scaleX.toFixed(3),
      dispW: Math.round(p.displayWidth),
      dispH: Math.round(p.displayHeight),
      posInWrap: { x: +p.x.toFixed(1), y: +p.y.toFixed(1) },
      wrapY: rec.portraitWrap.y,
      wrapScale: rec.portraitWrap.scaleX
    };
  }
  const L = s.birdSelector.root;
  return { cards: out, rootX: L.x, rootY: L.y, count: L.length };
});
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
