/** Reproduce two browser-verify failures:
 *  1. game stuck in ANSWER_FEEDBACK after the collapse shot
 *  2. masterMuteNode gain read-back after setMasterEnabled(false)
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wav': 'audio/wav', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json'
};
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.writeHead(302, { location: '/wb/' }).end(); return; }
  if (!url.startsWith('/wb/')) { res.writeHead(404).end('prefix only'); return; }
  let rel = url.slice(4) || 'index.html' || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(8093, r));
const browser = await puppeteer.launch({
  executablePath: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].find((p) => existsSync(p)),
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 }
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));
  page.on('console', (m) => console.log('CONSOLE[' + m.type() + ']:', m.text().slice(0, 200)));
  await page.goto('http://localhost:8093/wb/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.game.scene.isActive('MenuScene'), { timeout: 30000 });
  await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2000));

  await page.evaluate(() => window.__WB__.simulateShot({ vx: 18, vy: -7 }));
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const s = await page.evaluate(() => ({
      state: window.__WB__.state(),
      sceneTime: Math.round(window.__WB__.scene().time.now),
      hidden: document.hidden,
      projectiles: window.__WB__.projectiles().length
    }));
    console.log(JSON.stringify(s));
    if (!['ANSWER_FEEDBACK', 'PROJECTILE_FLYING', 'PHYSICS_RESOLVING'].includes(s.state)) break;
  }

  // mute-gain probe
  const muteProbe = await page.evaluate(() => {
    const g = window.__WB__.game;
    const a = g.registry.get('audio');
    a.setMasterEnabled(false);
    const afterFalse = g.sound.masterMuteNode.gain.value;
    a.setMasterEnabled(true);
    const afterTrue = g.sound.masterMuteNode.gain.value;
    return { afterFalse, afterTrue, enabledNow: a.enabled };
  });
  console.log('MUTE PROBE:', JSON.stringify(muteProbe));
} catch (e) {
  console.error('REPRO FAILED:', String(e).slice(0, 400));
} finally {
  await browser.close();
  server.close();
}
