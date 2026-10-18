import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(existsSync);

const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 250)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 250)); });
await page.goto('http://127.0.0.1:4276/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__WB__ && window.__WB__.save() !== null, { timeout: 60000 });
const pre = await page.evaluate(() => ({
  levels: !!window.__WB__.game.registry.get('levels'),
  questions: !!window.__WB__.game.registry.get('questions'),
  gameSceneStatus: window.__WB__.game.scene.getScene('GameScene').sys.settings.status
}));
console.log('pre-gotoLevel:', JSON.stringify(pre));
try {
  await page.evaluate(() => window.__WB__.gotoLevel(12));
  console.log('gotoLevel ok');
} catch (e) {
  console.log('gotoLevel threw:', String(e).slice(0, 250));
  const post = await page.evaluate(() => ({
    levels: !!window.__WB__.game.registry.get('levels'),
    scenes: window.__WB__.game.scene.scenes.map((s) => s.sys.settings.key + ':' + s.sys.settings.status)
  }));
  console.log('post:', JSON.stringify(post));
}
await new Promise((r) => setTimeout(r, 3000));
const fin = await page.evaluate(() => ({ state: window.__WB__.state() }));
console.log('final state:', JSON.stringify(fin));
await browser.close();
