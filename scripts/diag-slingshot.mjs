/**
 * Diagnose the slingshot rendering: load level 1, screenshot the idle
 * slingshot region, dump the renderer's live object state (positions,
 * scales, depths, visibility) and the texture dimensions.
 */
import puppeteer from 'puppeteer-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling'],
  defaultViewport: { width: 1280, height: 720 }
});
try {
  const page = await browser.newPage();
  page.on('response', (r) => { if (r.status() >= 400) console.log('[http' + r.status() + ']', r.url()); });
  await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && g.textures.exists('bird-red');
  }, { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  await page.evaluate(() => window.__WB__.gotoLevel(1));
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await sleep(600);

  const dump = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const r = s.slingshot.renderer;
    const g = window.__WB__.game;
    const tex = g.textures.get('slingshot-wood');
    const src = tex.getSourceImage();
    const obj = (o) => o ? {
      x: +o.x.toFixed(1), y: +o.y.toFixed(1), sx: +o.scaleX.toFixed(3), sy: +o.scaleY.toFixed(3),
      d: o.depth, vis: o.visible, alpha: o.alpha, w: o.width, h: o.height, origin: [o.originX, o.originY]
    } : null;
    return {
      texSize: [src.width, src.height],
      frameCount: tex.get().length,
      woodBack: obj(r.woodBack),
      woodFront: obj(r.woodFront),
      scale: r.scale,
      rearTip: r.rearTip, frontTip: r.frontTip, base: r.base, tipsMid: r.tipsMid,
      anchor: r.anchor,
      groundY: 471,
      preview: s.slingshot.preview ? { x: s.slingshot.preview.x, y: s.slingshot.preview.y, tex: s.slingshot.preview.texture.key } : null,
      childrenDepths: s.children.list.slice(0, 40).map((c) => ({ type: c.type, d: c.depth, vis: c.visible }))
    };
  });
  console.log(JSON.stringify(dump, null, 1));

  await page.screenshot({ path: join(OUT, 'diag-idle-full.png') });
  await page.screenshot({ path: join(OUT, 'diag-idle-slingshot.png'), clip: { x: 0, y: 0, width: 420, height: 720 } });
  console.log('screens saved');
} finally {
  await browser.close();
}
