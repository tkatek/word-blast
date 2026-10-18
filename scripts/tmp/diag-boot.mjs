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
page.on('pageerror', (e) => console.log('[pageerror]', e.message, '\n', e.stack?.split('\n').slice(0,4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 30; i++) {
  const ok = await page.evaluate(() => !!(window.__WB__ && window.__WB__.scene() && window.__WB__.save() !== null)).catch(() => false);
  console.log(`boot poll ${i}: ${ok}`);
  if (ok) break;
  await sleep(1000);
}
try {
  await page.evaluate(() => {
    try { window.__WB__.gotoLevel(12); } catch (e) { console.error('gotoLevel threw: ' + e.stack); }
  });
} catch (e) { console.log('evaluate threw:', e.message); }
for (let i = 0; i < 24; i++) {
  const st = await page.evaluate(() => window.__WB__ ? window.__WB__.state() : null).catch(() => null);
  console.log(`t${i}: ${st}`);
  if (st === 'AIMING') break;
  await sleep(500);
}
await browser.close();
