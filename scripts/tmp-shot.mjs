/** TEMP: gameplay screenshot with the resized slingshot (visual sanity). */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json'
};
const server = createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].replace('/wb/', '')) || 'index.html';
  const file = join(process.cwd(), 'dist', rel);
  if (!file.startsWith(join(process.cwd(), 'dist')) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(8097, r));

const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--mute-audio', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:8097/wb/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__WB__ && window.__wbBoot.booted && window.__WB__.game.registry.get('levels'), { timeout: 30000 });
await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });
await page.waitForFunction(() => { const s = window.__WB__.scene(); return s && s.prepared; }, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 6000));
await page.screenshot({ path: 'screenshots/perf/gameplay-after.png' });
console.log('screenshot saved');
await browser.close();
server.close();
process.exit(0);
