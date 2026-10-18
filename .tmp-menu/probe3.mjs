import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:4273/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 90000 });
await sleep(1500);

const pt = await page.evaluate(() => window.__WB__.worldToClient(640, 566));
await page.mouse.move(pt.x, pt.y);
await sleep(200);
const dbg = await page.evaluate(() => {
  const s = window.__WB__.game.scene.getScene('MenuScene');
  const cam = s.cameras.main;
  return s.input._list.map((o) => {
    const within = window.__WB__.game.input.pointWithinHitArea(o, 0, 0);
    const info = {
      type: o.type, x: o.x, y: o.y, sx: o.scaleX, sy: o.scaleY, alpha: o.alpha,
      visible: o.visible, willRender: o.willRender(cam),
      inputEnabled: o.input.enabled, hitArea: o.input.hitArea ? { w: o.input.hitArea.width, h: o.input.hitArea.height } : null,
      within00: within
    };
    return info;
  });
});
console.log(JSON.stringify(dbg, null, 2));
await browser.close();
