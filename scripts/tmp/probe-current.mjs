import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', '..', 'screenshots', 'fix19');
const BASE = process.argv[2] || 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(existsSync);
  return candidates[0];
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run']
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
const boot = await page.evaluate(() => {
  const wb = window.__WB__;
  return { state: wb ? wb.state() : null, save: wb ? wb.save() !== null : false };
});
console.log('boot:', JSON.stringify(boot));
try {
  await page.evaluate(() => window.__WB__.gotoLevel(12));
} catch (e) { console.log('gotoLevel err:', e.message); }
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  const st = await page.evaluate(() => window.__WB__ ? window.__WB__.state() : null);
  if (i % 5 === 0 || st === 'AIMING') console.log(`t+${i}s state=${st}`);
  if (st === 'AIMING') break;
}
try { await page.evaluate(() => window.__WB__.setAutoPause(false)); } catch {}
await sleep(700);
await page.screenshot({ path: join(OUT, 'probe-current.png') });
await browser.close();
