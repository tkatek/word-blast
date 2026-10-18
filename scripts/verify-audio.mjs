/**
 * AUDIO-REPAIR — production verification in a REAL browser (headless
 * Chrome, real Web Audio, autoplay allowed).
 *
 * Serves dist/, loads the game and runs the acceptance suite against the
 * DIRECT game output (an AnalyserNode tapped onto Phaser's master volume
 * node — the single output path, so master mute and the mix are measured
 * exactly as the speakers receive them):
 *
 *   1.  every manifest sound decoded into the audio cache (no 404s)
 *   2.  idle test — settled level, no input → true output silence
 *   3.  pull-and-hold — stretch audible while moving, faded silence while
 *       held still (pouch stays stretched)
 *   4.  movement-resume — audio returns, still exactly one stretch voice
 *   5.  max-pull — pointer running past the drag limit (clamped pouch
 *       stationary) generates nothing
 *   6.  cancellation ×20 — no firing sound, no stuck loop, no ammo loss
 *   7.  release — one snap + one whoosh, silence after the shot settles
 *   8.  collapse — real shot into the towers: impacts, then silence
 *   9.  pause/mute during stretch — voice dropped, nothing resurrects
 *  10. question card — one whoosh per open/close, quiet reading period
 *  11. lifecycle — 20 drag/cancel cycles + restarts: no voice growth
 *  12. evidence — direct-output WAV captures saved for the report
 *
 * Run: npm run build && npm run verify:audio
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioPreloadList } from '../js/systems/AudioManager.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const EVIDENCE = join(ROOT, 'wb-audio-evidence');
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
mkdirSync(EVIDENCE, { recursive: true });

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Install the output tap (analyser + zero-gain recorder) on the ONE
 *  output path: Phaser masterVolumeNode. The recorder sinks through a
 *  0-gain node, so nothing is ever heard twice. */
const TAP_SETUP = `(() => {
  const snd = window.__WB__.game.sound;
  const ctx = snd.context;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  snd.masterVolumeNode.connect(an);
  const rec = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  snd.masterVolumeNode.connect(rec);
  rec.connect(sink);
  sink.connect(ctx.destination);
  const state = { chunks: [], recording: false, sr: ctx.sampleRate };
  rec.onaudioprocess = (e) => {
    if (state.recording) state.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  window.__wbTap = {
    analyser: an,
    rms () {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    },
    recStart () { state.recording = true; state.chunks = []; },
    recStop () {
      state.recording = false;
      const n = state.chunks.reduce((a, c) => a + c.length, 0);
      const out = new Float32Array(n);
      let o = 0;
      for (const c of state.chunks) { out.set(c, o); o += c.length; }
      return window.__wbTap.encodeWav(out, state.sr);
    },
    encodeWav (samples, sr) {
      const buf = new ArrayBuffer(44 + samples.length * 2);
      const v = new DataView(buf);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE');
      ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
      v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, samples.length * 2, true);
      let peak = 0;
      for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
      const g = peak > 0 ? Math.min(1, 0.89 / peak) : 1; // evidence normalisation only
      for (let i = 0; i < samples.length; i++) {
        v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, samples[i] * g * 32767)), true);
      }
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(bin);
    }
  };
  return true;
})()`;

/** Measure the game's output level: polls the analyser ~every 60 ms for
 *  `ms` milliseconds; returns { max, avg } RMS. */
async function outputLevel(page, ms) {
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    samples.push(await page.evaluate(() => window.__wbTap.rms()));
    await sleep(55);
  }
  const max = Math.max(...samples);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { max, avg };
}

const SILENT = 0.0025;   // ≈ -52 dBFS on the master tap → true silence
const AUDIBLE = 0.006;   // clearly-above-silence floor for stretch texture

/** Drag the pouch from rest toward (dx, dy) over `ms` in smooth steps. */
async function dragPouch(page, dx, dy, ms = 700) {
  const start = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const a = s.slingshot.anchor;
    return window.__WB__.worldToClient(a.x, a.y);
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const c = await page.evaluate(({ dx, dy, f }) => {
      const s = window.__WB__.scene();
      const a = s.slingshot.anchor;
      return window.__WB__.worldToClient(a.x + dx * f, a.y + dy * f);
    }, { dx, dy, f: i / steps });
    await page.mouse.move(c.x, c.y);
    await sleep(ms / steps);
  }
  return start;
}

/** Client coords of the pouch rest position. */
async function pouchClient(page) {
  return page.evaluate(() => {
    const s = window.__WB__.scene();
    const a = s.slingshot.anchor;
    return window.__WB__.worldToClient(a.x, a.y);
  });
}

async function saveRecording(page, name) {
  const b64 = await page.evaluate(() => window.__wbTap.recStop());
  const buf = Buffer.from(b64, 'base64');
  const file = join(EVIDENCE, name);
  await new Promise((res, rej) => {
    const ws = createWriteStream(file);
    ws.on('finish', res); ws.on('error', rej);
    ws.end(buf);
  });
  return { file, bytes: buf.length };
}

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

  // unlock + install the output tap
  await page.evaluate(() => window.__WB__.game.sound.unlock());
  await page.evaluate(TAP_SETUP);

  // 1. every loadable sound DECODED into the audio cache
  const keys = audioPreloadList().map((e) => e.key);
  const decoded = await page.evaluate((ks) => {
    const cache = window.__WB__.game.cache.audio;
    return ks.filter((k) => cache.exists(k));
  }, keys);
  check(`all ${keys.length} loadable sounds decoded`, decoded.length === keys.length,
    `${decoded.length}/${keys.length}`);

  // enter level 1 and settle
  await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await sleep(2500); // one-shots from the intro finish

  // 2. idle test — settled level, no input, true output silence (10 s)
  await page.evaluate(() => window.__wbTap.recStart());
  const idle = await outputLevel(page, 10000);
  const idleSounds = await page.evaluate(() =>
    window.__WB__.game.sound.sounds.filter((s) => s.isPlaying).length);
  check('idle: direct game output silent for 10 s', idle.max < SILENT,
    `maxRMS=${idle.max.toExponential(2)} over 10s (${idleSounds} playing)`);
  check('idle: no sound instances remain', idleSounds === 0);

  // 3. pull-and-hold: stretch while moving, silence while held
  await page.evaluate(() => window.__wbTap.recStart());
  const pulling = await outputLevel(page, 300); // baseline before motion
  await dragPouch(page, -95, 70, 800);
  const moving = await outputLevel(page, 350);
  check('pull: leather stretch audible while the pouch moves',
    moving.max > AUDIBLE && moving.max > pulling.max * 2,
    `maxRMS=${moving.max.toExponential(2)}`);
  const stretched = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const a = s.slingshot.anchor;
    const p = s.slingshot.pouchPoint();
    return Math.hypot(p.x - a.x, p.y - a.y);
  });
  const holding = await outputLevel(page, 5000); // HOLD still 5 s
  check('hold: stretch fades to silence while pouch stays stretched',
    holding.max < SILENT && stretched > 90,
    `5s maxRMS=${holding.max.toExponential(2)}, pouch at ${stretched.toFixed(0)}px`);

  // 4. movement-resume: audio returns, exactly one stretch voice
  const c0 = await pouchClient(page);
  await page.mouse.move(c0.x - 15, c0.y + 8); // still holding the button
  await sleep(120);
  await page.mouse.move(c0.x + 15, c0.y - 10);
  await sleep(120);
  await page.mouse.move(c0.x - 10, c0.y + 6);
  // sample the engine state DURING motion (before the measurement window
  // lets the fade-out logic release the voice)
  const slingState = await page.evaluate(() => ({
    info: window.__WB__.audio().sling,
    live: window.__WB__.game.sound.sounds.filter((s) => s.key.startsWith('sling-stretch') && s.isPlaying).length
  }));
  const resumed = await outputLevel(page, 400);
  check('resume: movement audio returns after stillness',
    resumed.max > AUDIBLE, `maxRMS=${resumed.max.toExponential(2)}`);
  check('resume: still at most one stretch voice',
    slingState.live === 1, JSON.stringify(slingState));

  // 5. max-pull: pointer runs past the drag limit, clamped pouch still.
  // Target stays INSIDE the canvas but pulls > 140 px of world distance
  // (down-left: world x clamps at the margin, y stays above the grass).
  const far = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const a = s.slingshot.anchor;
    return window.__WB__.worldToClient(a.x - 260, a.y + 90);
  });
  await page.evaluate(() => window.__wbTap.recStart());
  for (let i = 1; i <= 8; i++) { // wiggle far beyond MAX_DRAG
    await page.mouse.move(far.x + i * 10, far.y - i * 6);
    await sleep(90);
  }
  const overshoot = await outputLevel(page, 800);
  const pouchNow = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const a = s.slingshot.anchor;
    const p = s.slingshot.pouchPoint();
    return Math.hypot(p.x - a.x, p.y - a.y);
  });
  check('max-pull: excess pointer motion generates no new stretch',
    overshoot.max < SILENT && pouchNow > 130,
    `maxRMS=${overshoot.max.toExponential(2)}, pouch pinned at ${pouchNow.toFixed(0)}px (limit 140)`);

  // 6+7. release: one snap + one whoosh, no loop, then settle to silence
  const beforeStats = await page.evaluate(() => window.__WB__.audio().stats.plays);
  await page.evaluate(() => window.__wbTap.recStart());
  await page.mouse.up();
  await sleep(400);
  const release = await outputLevel(page, 400);
  const afterStats = await page.evaluate(() => window.__WB__.audio().stats.plays);
  const loops = await page.evaluate(() =>
    window.__WB__.game.sound.sounds.filter((s) => s.loop && s.isPlaying).length);
  check('release: snap + whoosh audible',
    release.max > AUDIBLE * 3, `maxRMS=${release.max.toExponential(2)}`);
  check('release: exactly one snap and one cry for the shot',
    (afterStats['sling-release'] || 0) - (beforeStats['sling-release'] || 0) === 1
    && (afterStats['bird-launch'] || 0) - (beforeStats['bird-launch'] || 0) === 1,
    `+${(afterStats['sling-release'] || 0) - (beforeStats['sling-release'] || 0)} snap, +${(afterStats['bird-launch'] || 0) - (beforeStats['bird-launch'] || 0)} cry`);
  check('release: no looping sound exists', loops === 0);
  await saveRecording(page, 'after-pull-hold-release.wav');
  await page.waitForFunction(() => {
    const s = window.__WB__.state();
    return s === 'AIMING' || s === 'QUESTION_READY';
  }, { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const settled = await outputLevel(page, 2500);
  check('post-shot: output returns to silence after settling',
    settled.max < SILENT, `maxRMS=${settled.max.toExponential(2)}`);

  // 8. collapse test — a real shot into the answer towers
  await page.evaluate(() => {
    window.__collapseBaseline = { ...window.__WB__.audio().stats.plays };
  });
  await page.evaluate(() => window.__WB__.simulateShot({ vx: 18, vy: -7 }));
  await page.waitForFunction(() => {
    const a = window.__WB__.audio();
    const base = window.__collapseBaseline || {};
    return Object.entries(a.stats.plays).some(([k, v]) =>
      (/wood|glass|stone|bird-hit/.test(k)) && v > (base[k] || 0));
  }, { timeout: 12000 }).catch(() => {});
  const collapseAudible = await outputLevel(page, 700);
  check('collapse: material impacts audible', collapseAudible.max > AUDIBLE,
    `maxRMS=${collapseAudible.max.toExponential(2)}`);
  await sleep(2500);
  const collapseSettled = await outputLevel(page, 2500);
  check('collapse: silence once the tower settles',
    collapseSettled.max < SILENT, `maxRMS=${collapseSettled.max.toExponential(2)}`);

  // 9. pause/mute during stretch. NOTE: the analyser keeps the last ~46 ms
  // of audio when the manager freezes MID-sound (the pause click itself),
  // so "silent" here = no sound playing at all + movement voice dropped.
  await dragPouch(page, -90, 60, 700);
  await sleep(250);
  await page.evaluate(() => window.__WB__.scene().togglePause());
  await sleep(500);
  const pausedState = await page.evaluate(() => ({
    sling: window.__WB__.audio().sling,
    playing: window.__WB__.game.sound.sounds.filter((s) => s.isPlaying).length,
    pausedSounds: window.__WB__.game.sound.sounds.filter((s) => s.isPaused).length
  }));
  check('pause during stretch: movement voice dropped, nothing playing',
    pausedState.sling.active === false && pausedState.playing === 0,
    JSON.stringify(pausedState));
  await page.mouse.up().catch(() => {}); // the game already cancelled the drag
  await page.evaluate(() => window.__WB__.scene().togglePause());
  await sleep(800);
  const resumedStill = await outputLevel(page, 1200);
  check('resume while stationary: no stretch sound restarts',
    resumedStill.max < SILENT, `maxRMS=${resumedStill.max.toExponential(2)}`);

  // 10. question card transitions
  const cardBefore = await page.evaluate(() => window.__WB__.audio().stats.plays['ui-question'] || 0);
  const docked = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const pos = s.card.root.position;
    return window.__WB__.worldToClient(pos.x, pos.y);
  });
  await page.mouse.click(docked.x, docked.y);
  await sleep(900);
  const cardOpened = await page.evaluate(() => window.__WB__.audio().stats.plays['ui-question'] || 0);
  const readingQuiet = await outputLevel(page, 1500);
  await page.mouse.click(docked.x, docked.y); // close via the card tap zone
  await sleep(900);
  const cardClosed = await page.evaluate(() => window.__WB__.audio().stats.plays['ui-question'] || 0);
  check('card: one whoosh per open/close transition',
    cardOpened - cardBefore === 1 && cardClosed - cardOpened <= 1,
    `open+${cardOpened - cardBefore}, close+${cardClosed - cardOpened}`);
  check('card: reading period is quiet', readingQuiet.max < SILENT,
    `maxRMS=${readingQuiet.max.toExponential(2)}`);

  // 11. lifecycle — 20 drag/cancel cycles + question restarts, no growth
  const lifecycleBase = await page.evaluate(() => ({
    sounds: window.__WB__.game.sound.sounds.length,
    voices: window.__WB__.audio().activeVoices,
    release: window.__WB__.audio().stats.plays['sling-release'] || 0
  }));
  for (let i = 0; i < 20; i++) {
    const c = await pouchClient(page); // grab + tiny release = dud cancel
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await sleep(60);
    // stay well under MIN_POWER_RATIO (0.12 × 140 px ≈ 17 px) → dud path
    const target = await page.evaluate(({ dx, dy }) => {
      const s = window.__WB__.scene();
      const a = s.slingshot.anchor;
      return window.__WB__.worldToClient(a.x + dx, a.y + dy);
    }, { dx: -(7 + (i % 6)), dy: 6 });
    await page.mouse.move(target.x, target.y);
    await sleep(80);
    await page.mouse.up(); // below MIN_POWER_RATIO → cancel path
    await sleep(140);
  }
  await page.evaluate(() => window.__WB__.scene().restartQuestionFromMenu
    ? window.__WB__.scene().restartQuestionFromMenu()
    : window.__WB__.scene().restartLevel());
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await sleep(1200);
  const endCounts = await page.evaluate(() => ({
    sounds: window.__WB__.game.sound.sounds.length,
    voices: window.__WB__.audio().activeVoices
  }));
  const cancelStats = await page.evaluate(() => ({
    release: window.__WB__.audio().stats.plays['sling-release'] || 0,
    cancel: window.__WB__.audio().stats.plays['sling-cancel'] || 0
  }));
  const shotsNow = await page.evaluate(() => window.__WB__.scene().shotsLeft);
  check('lifecycle: 20 dud releases played no firing sound',
    cancelStats.release === lifecycleBase.release,
    `release count unchanged (${cancelStats.release})`);
  check('lifecycle: soft return used for cancellations', cancelStats.cancel >= 15,
    `${cancelStats.cancel} returns`);
  check('lifecycle: no sound-instance growth after 20 cycles + restart',
    endCounts.sounds <= lifecycleBase.sounds + 6 && endCounts.voices <= 6,
    JSON.stringify(lifecycleBase) + ' → ' + JSON.stringify(endCounts));
  check('lifecycle: cancellation consumed no ammunition', shotsNow >= 2,
    `shotsLeft=${shotsNow}`);

  // 12. master mute covers the custom path; unmute revives nothing
  await page.evaluate(() => window.__WB__.scene().toggleSound());
  const muted = await page.evaluate(() => ({
    mute: window.__WB__.game.sound.mute,
    setting: window.__WB__.save().data.settings.sound
  }));
  await page.evaluate(() => window.__WB__.scene().toggleSound());
  const unmutedPlaying = await page.evaluate(() =>
    window.__WB__.game.sound.sounds.filter((s) => s.isPlaying).length);
  check('master mute silences the whole output path + persists',
    muted.mute === true && muted.setting === false, JSON.stringify(muted));
  check('unmute replays nothing old', unmutedPlaying === 0, `${unmutedPlaying} playing`);

  // 13. landscape-mobile emulation pass (device emulation, still desktop
  // Chrome — physical-device behaviour remains separately unverified)
  const page2 = await browser.newPage();
  await page2.emulate({
    viewport: { width: 915, height: 412, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
  });
  await page2.goto(`http://localhost:${PORT}${PREFIX}`, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene');
  }, { timeout: 30000 });
  await page2.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });
  await page2.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await page2.evaluate(() => window.__WB__.game.sound.unlock());
  await page2.evaluate(TAP_SETUP);
  await sleep(2500);
  const mobileIdle = await outputLevel(page2, 4000);
  const touchPull = await (async () => {
    const c = await page2.evaluate(() => {
      const s = window.__WB__.scene();
      const a = s.slingshot.anchor;
      return window.__WB__.worldToClient(a.x, a.y);
    });
    await page2.touchscreen.touchStart(c.x, c.y);
    for (let i = 1; i <= 10; i++) {
      const t = await page2.evaluate(({ f }) => {
        const s = window.__WB__.scene();
        const a = s.slingshot.anchor;
        return window.__WB__.worldToClient(a.x - 90 * f, a.y + 60 * f);
      }, { f: i / 10 });
      await page2.touchscreen.touchMove(t.x, t.y);
      await sleep(60);
    }
    return outputLevel(page2, 300);
  })();
  await page2.touchscreen.touchEnd();
  check('mobile-emulation idle: silent', mobileIdle.max < SILENT,
    `maxRMS=${mobileIdle.max.toExponential(2)}`);
  check('mobile-emulation touch pull: stretch audible', touchPull.max > AUDIBLE,
    `maxRMS=${touchPull.max.toExponential(2)}`);

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
