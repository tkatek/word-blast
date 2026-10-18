import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:4273/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 90000 });
await sleep(1500);

// give progress 6/15 (15 stars), reload, wait settle
await page.evaluate(() => {
  const s = window.__WB__.save();
  for (let i = 1; i <= 6; i++) s.recordLevelResult(i, 1000 + i, 2 + (i % 2));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__WB__ && window.__WB__.menu() && window.__WB__.menu().active, { timeout: 90000 });
await sleep(1800);

const click = async (wx, wy) => {
  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });
  await page.mouse.click(pt.x, pt.y, { delay: 40 });
};

await click(640, 566);   // RESET SAVE
await sleep(600);
console.log('dialog open:', await page.evaluate(() => window.__WB__.menu().dialogOpen));
const t0 = Date.now();
await click(792, 458);   // RESET PROGRESS
for (let i = 0; i < 14; i++) {
  await sleep(100);
  const st = await page.evaluate(() => {
    const s = window.__WB__.game.scene.getScene('MenuScene');
    return {
      dialog: !!s.dialog,
      unlocked: window.__WB__.save().unlockedLevel,
      txt: s.progressLevelsText.text + ' | ' + s.progressStarsText.text,
    };
  });
  console.log(`+${Date.now() - t0}ms`, JSON.stringify(st));
}
await browser.close();
