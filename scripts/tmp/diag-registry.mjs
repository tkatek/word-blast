import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findBrowser() {
  return ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(existsSync)[0];
}
const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: 'new',
  args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio','--disable-dev-shm-usage','--no-first-run']
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console-error]', m.text().slice(0, 200)); });
await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 60000 });
// immediate gotoLevel attempt with throw-time registry dump
const dumpAtThrow = await page.evaluate(() => {
  try {
    window.__WB__.gotoLevel(12);
    return { threw: false, levels: !!window.__WB__.game.registry.get('levels'), save: !!window.__WB__.game.registry.get('save') };
  } catch (e) {
    const g = window.__WB__.game;
    return {
      threw: true, msg: e.message,
      levels: !!g.registry.get('levels'),
      save: !!g.registry.get('save'),
      questions: !!g.registry.get('questions'),
      scenes: g.scene.scenes.map((s) => s.scene.key + ':' + s.sysStatus).join(',')
    };
  }
}).catch((e) => ({ evalErr: e.message }));
console.log('immediate gotoLevel:', JSON.stringify(dumpAtThrow));
const dump2 = await page.evaluate(() => {
  try {
    window.__WB__.gotoLevel(12);
    return { threw2: false };
  } catch (e) {
    const g = window.__WB__.game;
    return { threw2: true, levels2: !!g.registry.get('levels') };
  }
}).catch((e) => ({ evalErr: e.message }));
console.log('second gotoLevel:', JSON.stringify(dump2));
for (let i = 0; i < 20; i++) {
  const dump = await page.evaluate(() => {
    const wb = window.__WB__;
    if (!wb || !wb.game) return null;
    const keys = null;
    const boot = wb.game.scene.getScene('BootScene');
    const menu = wb.game.scene.getScene('MenuScene');
    return {
      keys,
      bootSys: boot ? boot.sysStatus || (boot.sys && boot.sys.settings.status) : 'none',
      menuActive: menu ? !!(menu.sys && menu.sys.isActive && menu.sys.isActive()) : false,
      levels: !!wb.game.registry.get('levels'),
      save: !!wb.game.registry.get('save')
    };
  }).catch((e) => ({ err: e.message }));
  console.log(i, JSON.stringify(dump));
  if (dump && dump.levels && dump.save) break;
  await sleep(1000);
}
await browser.close();
