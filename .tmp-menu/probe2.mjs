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
  const p = s.input.activePointer;
  const cam = s.cameras.main;
  const hits = s.input.hitTestPointer(p).map((o) => o.type + '#' + (o.list ? 'container' : ''));
  return {
    pointerWorld: { x: p.worldX, y: p.worldY },
    camera: { zoom: cam.zoom, x: cam.x, y: cam.y, worldView: { x: cam.worldView.x, y: cam.worldView.y, w: cam.worldView.width, h: cam.worldView.height } },
    hits,
    resetBtn: { x: s.resetButton.container.x, y: s.resetButton.container.y, scale: s.resetButton.container.scale, input: s.resetButton.container.input ? { dropZone: s.resetButton.container.input.dropZone, over: s.resetButton.container.input.state } : null },
    interactiveCount: s.input._list.length
  };
});
console.log(JSON.stringify(dbg, null, 2));
await browser.close();
