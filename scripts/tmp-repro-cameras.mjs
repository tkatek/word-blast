/**
 * BEFORE-state reproduction: boots the built game at 1920×1080 and 1366×768,
 * captures HUD + pause screenshots, and dumps the live camera framing of the
 * gameplay camera vs the HUD's UI camera vs the canonical fit-view.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'pause-ui');
mkdirSync(OUT, { recursive: true });
const BASE = process.argv[2] || 'http://localhost:4273';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage',
      '--disable-features=TranslateUI', '--no-first-run']
  });
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    const tag = `${w}x${h}`;
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => {
      const wb = window.__WB__;
      const g = wb && wb.game;
      return !!(g && g.registry.get('levels') && g.registry.get('questions') && g.registry.get('save'));
    }, { timeout: 90000 });
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
    await sleep(1200);

    const camInfo = await page.evaluate(() => {
      const s = window.__WB__.scene();
      const gs = s.scale.gameSize;
      const zoom = Math.min(gs.width / 1280, gs.height / 720);
      const hud = s.hud;
      const row = hud.layout;
      const sound = hud.soundBtn;
      return {
        gameSize: { w: gs.width, h: gs.height },
        canvasCss: { w: s.game.canvas.clientWidth, h: s.game.canvas.clientHeight },
        canonicalZoom: zoom,
        main: { zoom: s.cameras.main.zoom, x: s.cameras.main.scrollX, y: s.cameras.main.scrollY },
        uiCam: { zoom: hud.uiCam.zoom, x: hud.uiCam.scrollX, y: hud.uiCam.scrollY, w: hud.uiCam.width, h: hud.uiCam.height },
        layoutRow: { left: row.rowLeft, right: row.rowRight, mode: row.mode },
        soundBtnWorldX: sound.x
      };
    });
    console.log(`\n=== ${tag} ===`);
    console.log(JSON.stringify(camInfo, null, 2));
    await page.screenshot({ path: join(OUT, `before-hud-${tag}.png`) });

    await page.evaluate(() => window.__WB__.scene().doPause());
    await sleep(900);
    const scrim = await page.evaluate(() => {
      const s = window.__WB__.scene();
      const sc = s.hud.scrim;
      const b = sc.getBounds();
      return { w: b.width, h: b.height, x0: b.x, y0: b.y, zoom: s.hud.uiCam.zoom };
    });
    console.log('pause scrim bounds (screen px):', JSON.stringify(scrim));
    await page.screenshot({ path: join(OUT, `before-pause-${tag}.png`) });
    await page.close();
  }
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
