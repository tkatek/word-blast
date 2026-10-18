import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => existsSync(p));
console.log('exe:', exe);

const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto('http://127.0.0.1:4273/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 90000 });
await sleep(1600);

const probe = await page.evaluate(() => {
  const s = window.__WB__.game.scene.getScene('MenuScene');
  const b = s.resetButton.container.getBounds();
  const r = window.__WB__.game.canvas.getBoundingClientRect();
  return {
    enabled: s.resetButton.enabled,
    interactive: !!s.resetButton.container.input,
    bounds: { x: b.x, y: b.y, w: b.width, h: b.height },
    clientPt: window.__WB__.worldToClient(640, 566),
    canvasRect: { x: r.x, y: r.y, w: r.width, h: r.height }
  };
});
console.log(JSON.stringify(probe, null, 2));

const clientPt = await page.evaluate(() => window.__WB__.worldToClient(640, 566));
await page.mouse.move(clientPt.x, clientPt.y);
await sleep(150);
const over = await page.evaluate(() => {
  const s = window.__WB__.game.scene.getScene('MenuScene');
  return { hover: s.resetButton._hover, scale: +s.resetButton.container.scale.toFixed(3) };
});
console.log('after move:', JSON.stringify(over));

await page.mouse.click(clientPt.x, clientPt.y, { delay: 40 });
await sleep(600);
const after = await page.evaluate(() => ({
  dialogOpen: window.__WB__.menu().dialogOpen,
  saveUnlocked: window.__WB__.save().unlockedLevel
}));
console.log('after click:', JSON.stringify(after));
await page.screenshot({ path: 'C:/tmp-menu/probe-after-click.png' });

await browser.close();
