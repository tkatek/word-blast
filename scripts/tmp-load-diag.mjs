// Quick diagnostic: what state is the page actually in?
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const findBrowser = () => [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: findBrowser(), headless: 'new',
  args: ['--no-sandbox', '--mute-audio']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200)); });

const client = await page.createCDPSession();
await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
  offline: false, latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8
});

await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await sleep(600);
console.log('--- t+600ms ---');
console.log(await page.evaluate(() => {
  const el = document.getElementById('wb-loader');
  return {
    loaderExists: !!el,
    display: el ? getComputedStyle(el).display : null,
    classList: el ? el.className : null,
    innerLen: el ? el.innerHTML.length : 0,
    booted: window.__wbBoot ? window.__wbBoot.booted : 'no-api'
  };
}));

// follow the game for a while
for (const t of [3000, 8000, 15000, 25000, 40000]) {
  await sleep(t === 3000 ? 2400 : t - (t === 8000 ? 3000 : t === 15000 ? 8000 : t === 25000 ? 15000 : 25000));
  const s = await page.evaluate(() => {
    const d = window.__WB__ && window.__WB__.diag ? window.__WB__.diag() : null;
    const g = d && d.game;
    const scenes = g ? g.scene.getScenes(true).map((x) => x.sys.isActive() ? x.sys.settings.key + '*' : x.sys.settings.key) : null;
    return {
      loaderGone: !document.getElementById('wb-loader'),
      problems: window.__wbBoot ? window.__wbBoot.problems().slice(0, 3) : [],
      scenes,
      menuActive: g ? !!(g.scene.getScene('MenuScene') && g.scene.getScene('MenuScene').sys.isActive()) : null,
      musicCached: g && g.cache ? g.cache.audio.exists('music-theme') : null,
      canvas: !!document.querySelector('#game canvas')
    };
  }).catch((e) => ({ evalError: String(e).slice(0, 150) }));
  console.log(`--- t+${t}ms ---`, JSON.stringify(s));
}
await browser.close();
