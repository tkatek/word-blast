import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run']
});
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 300)));
await page.goto('http://localhost:4273/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => {
  const w = window.__WB__; const g = w && w.game;
  return !!(g && g.registry.get('levels') && g.registry.get('save'));
}, { timeout: 90000 });
await page.evaluate(() => window.__WB__.gotoLevel(3));
await page.waitForFunction(() => {
  const s = window.__WB__.scene();
  return s && s.prepared && s.stateMachine.current === 'AIMING';
}, { timeout: 90000 });
await page.evaluate(() => window.__WB__.setAutoPause(false));
await sleep(900);
await page.evaluate(() => window.__WB__.scene().doPause());
await sleep(900);
const info = await page.evaluate(() => {
  const s = window.__WB__.scene();
  const cams = s.game.cameras.cameras.map((c) => ({
    name: c.name, sx: +c.scrollX.toFixed(1), sy: +c.scrollY.toFixed(1),
    z: +c.zoom.toFixed(3), w: c.width, h: c.height,
    wp: c.getWorldPoint(228.58, 39.54)
  }));
  const ptr = s.input.activePointer;
  return { cams, scaleW: s.scale.width, gameW: s.scale.gameSize.width,
    canvasW: s.game.canvas.width, canvasCSS: s.game.canvas.style.width,
    dispScale: s.scale.displayScale };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
