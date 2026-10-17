import puppeteer from 'puppeteer-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT = join(ROOT, 'screenshots', 'structures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.env.PORT || 8081;
const TAG = process.env.TAG || 'before';

async function poll(page, fn, timeout = 15000, everyMs = 60) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await page.evaluate(fn);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling'],
  defaultViewport: { width: 1280, height: 720 }
});
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene');
  }, { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));

  for (const [level, name] of [[1, 'L1'], [8, 'L8'], [13, 'L13']]) {
    await page.evaluate((l) => window.__WB__.gotoLevel(l), level);
    await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 100);
    await sleep(700);
    await page.screenshot({ path: join(OUT, `${TAG}-${name}.png`) });
    console.log(`captured ${TAG}-${name}.png`);
  }
} finally {
  await browser.close();
}
