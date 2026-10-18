/**
 * FIX #22 — production audio verification in a REAL browser.
 *
 * Serves dist/ (like verify-build.mjs), loads the game in headless Chrome
 * with autoplay allowed, and verifies with actual Web Audio:
 *   1. every manifest sound DECODED into the audio cache (no 404s),
 *   2. menu music genuinely playing,
 *   3. scene switch menu → gameplay crossfades to the gameplay theme +
 *      forest ambience loop,
 *   4. a real fired shot produces launch + impact plays through the engine,
 *   5. pause suspends audio, resume does not duplicate the music track,
 *   6. the master mute toggle silences and restores.
 *
 * Run: npm run build && npm run verify:audio
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioManifestKeys } from '../js/systems/AudioManager.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const PREFIX = '/wb/';
const PORT = 8091;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon', '.map': 'application/json'
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ missing — run `npm run build` first');
  process.exit(1);
}

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(PREFIX)) { res.writeHead(404).end('prefix only'); return; }
  let rel = url.slice(PREFIX.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found: ' + rel);
    return;
  }
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
  const bad = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) bad.push(r.status() + ' ' + r.url());
  });
  page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}${PREFIX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene');
  }, { timeout: 30000 });

  // 1. every manifest key decoded into the audio cache
  const keys = audioManifestKeys();
  const decoded = await page.evaluate((ks) => {
    const cache = window.__WB__.game.cache.audio;
    return ks.filter((k) => cache.exists(k));
  }, keys);
  check(`all ${keys.length} manifest sounds decoded`, decoded.length === keys.length,
    `${decoded.length}/${keys.length}`);

  // 2. menu music genuinely playing through Web Audio
  await page.evaluate(() => window.__WB__.game.sound.unlock());
  await new Promise((r) => setTimeout(r, 1200));
  const menuMusic = await page.evaluate(() => {
    const g = window.__WB__.game;
    const s = g.sound.sounds.find((x) => x.key === 'music-menu');
    return {
      playing: !!(s && s.isPlaying),
      ctx: g.sound.context ? g.sound.context.state : 'none'
    };
  });
  check('menu theme playing', menuMusic.playing, `ctx=${menuMusic.ctx}`);

  // 3. gameplay scene switches music + starts ambience
  await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  const gameAudio = await page.evaluate(() => {
    const g = window.__WB__.game;
    return {
      music: g.sound.sounds.filter((x) => x.key === 'music-game' && x.isPlaying).length,
      menuLeft: g.sound.sounds.filter((x) => x.key === 'music-menu' && x.isPlaying).length,
      ambience: g.sound.sounds.filter((x) => x.key === 'amb-forest' && x.isPlaying).length
    };
  });
  check('gameplay theme playing (crossfaded)', gameAudio.music === 1);
  check('menu theme faded out', gameAudio.menuLeft === 0);
  check('forest ambience loop playing', gameAudio.ambience === 1);

  // 4. a real shot → launch + impact sounds actually play
  await page.evaluate(() => window.__WB__.simulateShot({ vx: 16, vy: -11 }));
  await page.waitForFunction(() => {
    const a = window.__WB__.audio();
    return (a.stats.plays['sling-release'] || 0) >= 1;
  }, { timeout: 8000 });
  await page.waitForFunction(() => {
    const a = window.__WB__.audio();
    const impacts = ['wood-light-1', 'wood-light-2', 'wood-light-3', 'wood-heavy-1', 'wood-heavy-2',
      'glass-hit-1', 'glass-hit-2', 'stone-light-1', 'stone-light-2', 'stone-heavy-1',
      'bird-hit'].reduce((n, k) => n + (a.stats.plays[k] || 0), 0);
    return impacts >= 1;
  }, { timeout: 10000 }).catch(() => {});
  const shotStats = await page.evaluate(() => window.__WB__.audio().stats.plays);
  const impactPlays = Object.entries(shotStats)
    .filter(([k]) => /wood|glass|stone|bird-hit/.test(k))
    .reduce((n, [, v]) => n + v, 0);
  check('launch snap played', (shotStats['sling-release'] || 0) >= 1);
  check('bird cry played', (shotStats['bird-launch'] || 0) >= 1);
  check('material/bird impact sounds played', impactPlays >= 1, `${impactPlays} impact plays`);

  // 5. pause suspends, resume does not duplicate music
  await page.evaluate(() => window.__WB__.scene().togglePause());
  await new Promise((r) => setTimeout(r, 300));
  const paused = await page.evaluate(() => window.__WB__.audio().paused);
  await page.evaluate(() => window.__WB__.scene().togglePause());
  await new Promise((r) => setTimeout(r, 300));
  const resumed = await page.evaluate(() => {
    const g = window.__WB__.game;
    return {
      paused: window.__WB__.audio().paused,
      musicCount: g.sound.sounds.filter((x) => x.key === 'music-game').length,
      playing: g.sound.sounds.filter((x) => x.key === 'music-game' && x.isPlaying).length
    };
  });
  check('pause suspends all audio', paused === true);
  check('resume continues without duplication', resumed.paused === false
    && resumed.musicCount === 1 && resumed.playing === 1,
    `tracks=${resumed.musicCount} playing=${resumed.playing}`);

  // 6. master mute silences and restores
  await page.evaluate(() => window.__WB__.scene().toggleSound());
  const muted = await page.evaluate(() => ({
    mute: window.__WB__.game.sound.mute,
    setting: window.__WB__.save().data.settings.sound
  }));
  await page.evaluate(() => window.__WB__.scene().toggleSound());
  const unmuted = await page.evaluate(() => window.__WB__.game.sound.mute);
  check('master mute silences output + persists', muted.mute === true && muted.setting === false);
  check('unmute restores output', unmuted === false);

  check('no HTTP/page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
} catch (e) {
  ok = false;
  console.error('FAILED:', String(e).slice(0, 400));
} finally {
  await browser.close();
  server.close();
}

console.log(ok ? '== browser audio verification PASSED ==' : '== browser audio verification FAILED ==');
process.exit(ok ? 0 : 1);
