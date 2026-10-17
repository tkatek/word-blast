import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(existsSync);

const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864 });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 220)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(-70), r.failure() && r.failure().errorText));
await page.goto('http://127.0.0.1:4273/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 7000));
const state = await page.evaluate(() => ({
  hasWB: !!window.__WB__,
  save: window.__WB__ ? !!window.__WB__.save() : null,
  scenes: window.__WB__ ? window.__WB__.game.scene.scenes.map((s) => s.sys.settings.key + ':' + s.sys.settings.status) : []
})).catch((e) => ({ err: String(e) }));
console.log(JSON.stringify(state, null, 1));
try {
  await page.evaluate(() => window.__WB__.gotoLevel(12));
  await new Promise((r) => setTimeout(r, 3000));
  const after = await page.evaluate(() => ({
    state: window.__WB__.state(),
    prepared: !!(window.__WB__.scene() && window.__WB__.scene().prepared)
  })).catch((e) => ({ err: String(e) }));
  console.log('after gotoLevel:', JSON.stringify(after));
} catch (e) {
  console.log('gotoLevel error:', String(e).slice(0, 300));
}
await browser.close();
