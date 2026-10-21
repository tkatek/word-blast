/**
 * Focused repro: rapid pause/resume spam until the blur handle sticks —
 * dumps full pause-FX state at the failing moment.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://localhost:4273';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

const clickPlay = async (page) => {
  const c = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const wx = s.hud.menu.x + s.hud.resumeBtn.x;
    const wy = s.hud.menu.y + s.hud.resumeBtn.y;
    const gs = s.scale.gameSize;
    const zoom = Math.min(gs.width / 1280, gs.height / 720);
    const vx = (1280 - gs.width / zoom) / 2;
    const vy = (720 - gs.height / zoom) / 2;
    return { x: (wx - vx) * zoom, y: (wy - vy) * zoom };
  });
  await page.mouse.move(c.x, c.y);
  await sleep(110);
  await page.mouse.down();
  await sleep(110);
  await page.mouse.up();
};

const dump = (page) => page.evaluate(() => {
  const s = window.__WB__.scene();
  const hud = s.hud;
  const blur = hud.pauseBlur;
  const cam = s.cameras.main;
  let fxNames = null;
  try { fxNames = cam.postFX ? cam.postFX.list.map((p) => p.name || '?') : null; } catch (e) { fxNames = ['ERR']; }
  return {
    open: hud.pauseOpen, state: s.stateMachine.current, menuVis: hud.menu.visible,
    menuAlpha: hud.menu.alpha, scrimAlpha: hud.scrim.alpha,
    blur: !!blur, strength: blur ? blur.strength : null,
    fxNames,
    sceneStatus: s.sys.settings.status,
    timeScale: s.tweens.timeScale,
    now: s.time.now
  };
});

const rafLiveness = (page) => page.evaluate(() => new Promise((resolve) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => {
    n++;
    if (performance.now() - t0 >= 500) resolve(n);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run']
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
for (let cycle = 0; cycle < 2; cycle++) {
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => {
      const w = window.__WB__;
      const g = w && w.game;
      return !!(g && g.registry.get('levels') && g.registry.get('questions') && g.registry.get('save'));
    }, { timeout: 60000 });
    break;
  } catch (e) {
    if (cycle === 1) throw e;
    console.log('(cold boot wedge — reloading once)');
  }
}
await page.evaluate(() => window.__WB__.gotoLevel(3));
await page.waitForFunction(() => {
  const s = window.__WB__.scene();
  return !!(s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING');
}, { timeout: 90000 });
await page.evaluate(() => window.__WB__.setAutoPause(false));
await page.evaluate(() => {
  const link = document.querySelector('.fs-dismiss');
  if (link) link.click();
  const card = document.getElementById('fs-entry');
  if (card) card.style.display = 'none';
});
await sleep(800);

let stuck = null;
for (let i = 0; i < 40; i++) {
  await page.evaluate(() => window.__WB__.scene().doPause());
  await sleep(150);
  let d = await dump(page);
  if (!d.open || d.state !== 'PAUSED') { console.log(`iter ${i}: BAD OPEN`, JSON.stringify(d)); break; }
  await clickPlay(page);
  await sleep(150);
  d = await dump(page);
  if (d.open || d.state !== 'AIMING') { console.log(`iter ${i}: BAD CLOSE (click miss?)`, JSON.stringify(d)); break; }
  // give the fade + guard ample time every 10 iterations
  if (i % 5 === 4) {
    await sleep(500);
    d = await dump(page);
    console.log(`iter ${i}: fx=[${d.fxNames}] blur=${d.blur} menu=${d.menuVis}`);
    if (d.blur || d.menuVis) {
      console.log(`iter ${i}: STUCK`, JSON.stringify(d));
      const rafs = await rafLiveness(page);
      const d2 = await dump(page);
      console.log(`raf(500ms)=${rafs} second-sample:`, JSON.stringify(d2));
      stuck = d;
      break;
    }
  }
}
if (!stuck) {
  await sleep(1200);
  const d = await dump(page);
  console.log(d.blur ? 'STUCK BLUR at end: ' + JSON.stringify(d) : 'clean: ' + JSON.stringify(d));
}
await page.screenshot({ path: join(root, '..', 'screenshots', 'pause-ui', 'tmp-blur-state.png') });
await browser.close();
