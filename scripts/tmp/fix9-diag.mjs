/** Fix #9 — diagnose: what does the browser game actually reach? */
import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
  defaultViewport: { width: 1280, height: 720 }
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') console.log('[console.' + t + ']', m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

  await page.goto('http://localhost:8091/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  let snap = await page.evaluate(() => ({
    hasApi: !!window.__WB__,
    menu: window.__WB__ ? !!window.__WB__.game.scene.isActive('MenuScene') : null,
    cardInfo: window.__WB__ ? window.__WB__.cardInfo() : null
  })).catch((e) => ({ evalError: String(e).slice(0, 200) }));
  console.log('after boot:', JSON.stringify(snap));

  await page.evaluate(() => window.__WB__.gotoLevel(1)).catch((e) => console.log('gotoLevel err', String(e)));
  for (const wait of [1000, 2000, 3000, 5000, 6000, 7000]) {
    await sleep(wait === 1000 ? 1000 : 1000);
    snap = await page.evaluate(() => ({
      state: window.__WB__.state(),
      card: window.__WB__.cardInfo()
    })).catch((e) => ({ evalError: String(e).slice(0, 120) }));
    console.log('t+' + wait + ':', JSON.stringify(snap));
  }
} finally {
  await browser.close();
}
