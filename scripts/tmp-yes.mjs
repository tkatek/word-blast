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
await sleep(800);
// staged click on HOME (works per last probe)
const homeP = await page.evaluate(() => {
  const cam = window.__WB__.scene().hud.uiCam;
  return { x: (52 - cam.scrollX) * cam.zoom + cam.x, y: (136 - cam.scrollY) * cam.zoom + cam.y };
});
await page.mouse.move(homeP.x, homeP.y); await sleep(90);
await page.mouse.down(); await sleep(90); await page.mouse.up();
await sleep(400);
console.log('confirm visible:', await page.evaluate(() => window.__WB__.scene().hud.confirmVisible));

await page.evaluate(() => {
  const s = window.__WB__.scene();
  const h = s.hud;
  window.__hits = [];
  const tag = (go) => go === h.confirmYes ? 'YES' : go === h.confirmNo ? 'CANCEL'
    : go === h.homeBtn ? 'HOMEBTN' : go === h.scrim ? 'SCRIM' : (go.constructor.name + (go.labelText ? ':' + go.labelText.text : ''));
  s.input.on('gameobjectdown', (p, go) => window.__hits.push('down:' + tag(go)));
  s.input.on('gameobjectup', (p, go) => window.__hits.push('up:' + tag(go)));
  const origRun = h.runConfirm.bind(h);
  window.__ranConfirm = false;
  h.runConfirm = () => { window.__ranConfirm = true; origRun(); };
});
const yesP = await page.evaluate(() => {
  const h = window.__WB__.scene().hud;
  const b = h.confirmYes.getBounds();
  const cam = h.uiCam;
  return { x: (b.x + b.width / 2 - cam.scrollX) * cam.zoom + cam.x,
           y: (b.y + b.height / 2 - cam.scrollY) * cam.zoom + cam.y,
           bx: [b.x, b.y, b.width, b.height], enabled: h.confirmYes.input.enabled };
});
console.log('YES state:', JSON.stringify(yesP));
await page.mouse.move(yesP.x, yesP.y); await sleep(120);
await page.mouse.down(); await sleep(120); await page.mouse.up();
await sleep(600);
console.log('hits:', JSON.stringify(await page.evaluate(() => window.__hits)));
console.log('ranConfirm:', await page.evaluate(() => window.__ranConfirm));
console.log('scene:', await page.evaluate(() => window.__WB__.scene().scene.key));
await browser.close();
