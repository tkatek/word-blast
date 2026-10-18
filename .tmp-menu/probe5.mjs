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
await page.goto('http://127.0.0.1:4273/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 90000 });
await sleep(1500);

const pt = await page.evaluate(() => window.__WB__.worldToClient(640, 566));
await page.mouse.move(pt.x, pt.y);
await sleep(200);
const dbg = await page.evaluate(() => {
  const game = window.__WB__.game;
  const s = game.scene.getScene('MenuScene');
  const ptr = s.input.activePointer;
  const cam = s.cameras.main;
  const im = game.input; // InputManager (has hitTest, inputCandidate, pointWithinHitArea)
  const btn = s.resetButton.container;

  // exact hitTest replication
  const csx = cam.scrollX, csy = cam.scrollY;
  const tempPoint = { x: 0, y: 0 };
  cam.getWorldPoint(ptr.x, ptr.y, tempPoint);
  const px = tempPoint.x + (csx * btn.scrollFactorX) - csx;
  const py = tempPoint.y + (csy * btn.scrollFactorY) - csy;
  const point = { x: 0, y: 0 };
  const T = Phaser.Math.TransformXY;
  T(px, py, btn.x, btn.y, btn.rotation, btn.scaleX, btn.scaleY, point);
  return {
    tempPoint, px, py, localPoint: { ...point },
    candidate: im.inputCandidate(btn, cam),
    within: im.pointWithinHitArea(btn, point.x, point.y),
    hitAreaType: btn.input.hitArea ? btn.input.hitArea.constructor.name : null,
    hitAreaGeom: btn.input.hitArea ? { x: btn.input.hitArea.x, y: btn.input.hitArea.y, w: btn.input.hitArea.width, h: btn.input.hitArea.height } : null,
    callbackName: btn.input.hitAreaCallback ? btn.input.hitAreaCallback.name : null
  };
});
console.log(JSON.stringify(dbg, null, 2));
await browser.close();
