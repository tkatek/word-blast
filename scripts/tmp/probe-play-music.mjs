/**
 * One-off: verify the REAL PLAY-button path in the browser.
 * Boot → menu → click the PLAY plate → music starts (exactly one voice)
 * and the level-select scene loads with music still playing.
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DIST = join(ROOT, 'dist');
const PORT = 8093;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav' };

const server = createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].slice(1)) || 'index.html';
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

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

let ok = true;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};

try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.game.scene.isActive('MenuScene'), { timeout: 30000 });
  await page.evaluate(() => window.__WB__.game.sound.unlock());
  await new Promise((r) => setTimeout(r, 1200)); // entrance animation arms PLAY

  // menu is silent before PLAY
  const before = await page.evaluate(() => window.__WB__.audio().music);
  check('menu: music not started before PLAY', before.playing === false, JSON.stringify(before));

  // locate the real PLAY button container and click its centre
  const btn = await page.evaluate(() => {
    const s = window.__WB__.game.scene.getScene('MenuScene');
    const c = s.playButton && s.playButton.container;
    if (!c) return null;
    const m = c.getWorldTransformMatrix();
    return window.__WB__.worldToClient(m.tx, m.ty);
  });
  check('menu: PLAY button located', !!btn, JSON.stringify(btn));
  await page.mouse.click(btn.x, btn.y);

  // fade transition (300ms) → LevelSelectScene; music must be playing
  await page.waitForFunction(() => window.__WB__.game.scene.isActive('LevelSelectScene'), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1500));
  const after = await page.evaluate(() => {
    const v = window.__WB__.game.sound.sounds.filter((s) => s.key === 'music-theme');
    return {
      count: v.length,
      playing: v.filter((s) => s.isPlaying).length,
      loop: v.every((s) => s.loop),
      info: window.__WB__.audio().music
    };
  });
  check('PLAY click: exactly one looping theme voice started',
    after.count === 1 && after.playing === 1 && after.loop && after.info.want,
    JSON.stringify(after));
  const vol = after.info.volume;
  check('PLAY click: music level in the intended low window', vol > 0.3 && vol < 0.55, `vol=${vol}`);

  // double-click PLAY is impossible (transitioning guard) but re-entering
  // the menu and pressing again must NOT stack a second voice
  await page.evaluate(() => window.__WB__.game.scene.getScene('LevelSelectScene').scene.start('MenuScene'));
  await page.waitForFunction(() => window.__WB__.game.scene.isActive('MenuScene'), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1300));
  const b2 = await page.evaluate(() => {
    const s = window.__WB__.game.scene.getScene('MenuScene');
    const c = s.playButton && s.playButton.container;
    const m = c.getWorldTransformMatrix();
    return window.__WB__.worldToClient(m.tx, m.ty);
  });
  await page.mouse.click(b2.x, b2.y);
  await page.waitForFunction(() => window.__WB__.game.sound.sounds.filter((s) => s.key === 'music-theme').length <= 2, { timeout: 6000 });
  await new Promise((r) => setTimeout(r, 1200));
  const second = await page.evaluate(() => {
    const v = window.__WB__.game.sound.sounds.filter((s) => s.key === 'music-theme');
    return { count: v.length, playing: v.filter((s) => s.isPlaying).length };
  });
  check('second PLAY press: still exactly one voice (never stacked)',
    second.count === 1 && second.playing === 1, JSON.stringify(second));
} catch (e) {
  ok = false;
  console.error('FAILED:', String(e).slice(0, 300));
} finally {
  await browser.close();
  server.close();
}
console.log(ok ? '== PLAY-path music probe PASSED ==' : '== PLAY-path music probe FAILED ==');
process.exit(ok ? 0 : 1);
