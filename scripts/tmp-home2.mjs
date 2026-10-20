import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
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
await sleep(700);
await page.evaluate(() => window.__WB__.scene().doPause());
await sleep(700);
const probe = await page.evaluate(() => {
  const s = window.__WB__.scene();
  const h = s.hud;
  const hb = h.homeBtn;
  const out = {
    input: !!hb.input,
    enabled: hb.input ? hb.input.enabled : null,
    hitArea: hb.input ? hb.input.hitArea : null,
    sizeW: hb.width, sizeH: hb.height,
    pos: { x: hb.x, y: hb.y },
    parentMenuVisible: h.menu.visible,
    uiCamChildren: s.cameras.cameras.map((c) => ({ name: c.name, ignored: c.name }))
  };
  // manual hit test with a fake pointer at world (52,136)
  const cam = h.uiCam;
  const pointer = { x: 52.24, y: 136.24, worldX: 52, worldY: 136 };
  try {
    const hits = [];
    const Phaser = window.__WB__.game.config; // not exported; use scene
    // walk uiCam render list
    const list = cam.renderList || [];
    out.uiRenderList = list.length;
    for (const o of list) {
      if (o.input && o.input.enabled) {
        const b = o.getBounds ? o.getBounds() : null;
        if (b) out['hit_' + (o.texture ? o.texture.key : o.constructor.name)] = {
          b: [b.x, b.y, b.width, b.height],
          contains: 52 >= b.x && 52 <= b.x + b.width && 136 >= b.y && 136 <= b.y + b.height
        };
      }
      if (o.list) {
        for (const c2 of o.list) {
          if (c2.input && c2.input.enabled) {
            const b = c2.getBounds ? c2.getBounds() : null;
            if (b) out['hitC_' + (c2.texture ? c2.texture.key : c2.constructor.name)] = {
              b: [b.x, b.y, b.width, b.height],
              contains: 52 >= b.x && 52 <= b.x + b.width && 136 >= b.y && 136 <= b.y + b.height
            };
          }
        }
      }
    }
  } catch (e) { out.err = String(e).slice(0, 150); }
  return out;
});
console.log(JSON.stringify(probe, null, 1));
await browser.close();
