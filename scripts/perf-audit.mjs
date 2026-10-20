/**
 * PERFORMANCE AUDIT — reproducible before/after measurement harness.
 *
 * Serves dist/ locally, boots the PRODUCTION build in real Chrome (CPU
 * render via SwiftShader so numbers are comparable across runs), and runs
 * ONE fixed scenario per device profile:
 *
 *   load      : navigationStart -> boot watchdog OK (+ transfer bytes, with
 *               browser cache disabled, averaged over 3 cold loads)
 *   idle      : 3 s of AIMING stillness (baseline loop cost)
 *   aim-drag  : real pointer drag on the pouch (input + renderer redraw)
 *   flight    : one basic shot in flight
 *   collapse  : bomb into the tier-3 towers (heaviest physics + FX window)
 *   transition: question change (includes the 75-step synchronous settle)
 *   restarts  : 8 level restarts, then a leak sweep: heap, Matter bodies,
 *               display-list children, textures, tweens, timers, sounds
 *
 * Frame cost is measured around the game loop's own events (prestep ->
 * postrender = one full update+render tick) and long tasks (>50 ms) are
 * bucketed per phase. Output: console table + JSON next to the script.
 *
 * Run:  node scripts/perf-audit.mjs [label]      (label default: run)
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const PREFIX = '/wb/';
const PORT = 8095;
const LABEL = process.argv[2] || 'run';
const OUTDIR = join(ROOT, 'screenshots', 'perf');
mkdirSync(OUTDIR, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.ico': 'image/x-icon', '.map': 'application/json', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json'
};

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const prefix = url.startsWith(PREFIX) ? PREFIX : null;
  if (!prefix) { res.writeHead(404).end(); return; }
  let rel = url.slice(prefix.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(DIST, rel);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found: ' + rel);
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store' // every load is cold — comparable load numbers
  });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  // HEADFUL + real GPU: SwiftShader headless throttles/occludes the page,
  // which punishes the timer-driven loop with multi-second spikes — useless
  // for before/after comparison. Headful with a real compositor reflects
  // the JS+physics+render cost a capable device actually pays.
  headless: false,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--mute-audio',
    '--disable-dev-shm-usage', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--window-size=1400,900',
    '--js-flags=--expose-gc']
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In-page collector: loop-tick durations, gaps, long tasks, phase labels. */
const COLLECTOR = () => {
  window.__perf = {
    phase: '(boot)',
    ticks: [],        // { d: tickDurationMs, g: gapSinceLastTickMs }
    longTasks: [],    // { d, phase }
    bootOkAt: null,
    canvasAt: null,
    fcpAt: null
  };
  const perf = window.__perf;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'first-contentful-paint') perf.fcpAt = e.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) perf.longTasks.push({ d: e.duration, phase: perf.phase });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) { /* longtask unsupported */ }
  const poll = setInterval(() => {
    if (perf.bootOkAt === null && window.__wbBoot && window.__wbBoot.booted) {
      perf.bootOkAt = performance.now();
    }
    if (perf.canvasAt === null && document.querySelector('#game canvas')) {
      perf.canvasAt = performance.now();
    }
    if (perf.bootOkAt !== null && perf.canvasAt !== null) clearInterval(poll);
  }, 16);
  // hook the game loop once Phaser exists
  const hook = setInterval(() => {
    if (!window.__WB__ || !window.__WB__.game) return;
    clearInterval(hook);
    const game = window.__WB__.game;
    let last = null;
    game.events.on('prestep', () => { last = performance.now(); });
    game.events.on('postrender', () => {
      const now = performance.now();
      if (last !== null) perf.ticks.push({ d: now - last, g: last });
      last = null;
    });
  }, 50);
};

/**
 * Wait for a stable playable state, clicking through answer feedback the
 * same way the CONTINUE button does (a wild shot can hit a wrong plaque).
 * Returns 'AIMING' | 'LEVEL_FAILED' | 'LEVEL_COMPLETE'.
 */
async function settleToAiming(page, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => window.__WB__.state());
    if (st === 'AIMING') return st;
    if (st === 'ANSWER_FEEDBACK') {
      await page.evaluate(() => {
        const s = window.__WB__.scene();
        if (s.feedbackArmed) s.onFeedbackAction();
        else if (s.feedbackCard) s.feedbackCard.setActionEnabled(true);
      });
      await sleep(250);
    } else if (st === 'LEVEL_FAILED' || st === 'LEVEL_COMPLETE') {
      return st;
    } else if (Date.now() - t0 > timeout) {
      throw new Error('settleToAiming timeout, state=' + st);
    } else {
      await sleep(200);
    }
  }
}

/** Start/stop sampling into a phase bucket. */
async function phase(page, name, ms) {
  await page.evaluate((n) => { window.__perf.phase = n; window.__perf.ticks.length = 0; }, name);
  await sleep(ms);
  const snap = await page.evaluate(() => {
    const t = window.__perf.ticks.map((x) => x.d);
    window.__perf.ticks.length = 0;
    return t;
  });
  return stats(name, snap);
}

function stats(name, arr) {
  if (!arr.length) return { phase: name, frames: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const total = s.reduce((a, b) => a + b, 0);
  return {
    phase: name, frames: s.length,
    avgMs: total / s.length,
    p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1],
    over20ms: s.filter((v) => v > 20).length,
    over33ms: s.filter((v) => v > 33.3).length
  };
}
const sum = (s) => s.reduce((a, b) => a + b, 0);

/** Cold-load measurement (server sends no-store): navigationStart -> boot OK. */
async function coldLoad(page) {
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}${PREFIX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wbBoot && window.__wbBoot.booted, { timeout: 30000 });
  const bootMs = await page.evaluate(() => window.__perf.bootOkAt);
  const res = await page.evaluate(() => {
    const rs = performance.getEntriesByType('resource');
    let bytes = 0, count = 0;
    for (const r of rs) { bytes += r.transferSize || 0; count++; }
    return { bytes, count, fcp: window.__perf.fcpAt, canvas: window.__perf.canvasAt };
  });
  return { bootMs, wallMs: Date.now() - t0, ...res };
}

async function runProfile(profile) {
  const page = await browser.newPage();
  await page.emulate(profile.emulate);
  await page.evaluateOnNewDocument(COLLECTOR);
  page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 160)}`));

  // ---- load (x3 cold) -----------------------------------------------
  const loads = [];
  loads.push(await coldLoad(page));
  loads.push(await coldLoad(page));
  loads.push(await coldLoad(page));
  const load = {
    bootMsAvg: +(sum(loads.map((l) => l.bootMs)) / 3).toFixed(0),
    fcpMsAvg: +(sum(loads.map((l) => l.fcp || 0)) / 3).toFixed(0),
    canvasMsAvg: +(sum(loads.map((l) => l.canvas || 0)) / 3).toFixed(0),
    transferKB: Math.round(sum(loads.map((l) => l.bytes)) / 3 / 1024),
    requests: Math.round(sum(loads.map((l) => l.count)) / 3)
  };

  // ---- enter gameplay -------------------------------------------------
  await page.goto(`http://localhost:${PORT}${PREFIX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__WB__ && window.__wbBoot.booted
    && window.__WB__.game.registry.get('levels'), { timeout: 30000 });
  await page.evaluate(() => {
    window.__WB__.setAutoPause(false);
    // shorten the card intro BEFORE the level boots so every phase starts
    // from a comparable armed state (card reads timings live per phase)
    window.__WB__.setCardTimings({ enterMs: 60, readingMs: 200, moveMs: 80, exitMs: 60 });
    window.__WB__.gotoLevel(12);
  });
  await page.waitForFunction(() => {
    const s = window.__WB__.scene();
    return s && s.prepared;
  }, { timeout: 20000 });
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });

  const env = await page.evaluate(() => {
    const g = window.__WB__.game;
    const c = g.canvas;
    return {
      renderer: g.renderer.type === 2 ? 'webgl' : 'canvas',
      buffer: `${c.width}x${c.height}`,
      dpr: window.devicePixelRatio
    };
  });

  const results = { profile: profile.name, env, load, phases: [] };

  // ---- idle ------------------------------------------------------------
  results.phases.push(await phase(page, 'idle', 3000));

  // ---- aim-drag (real pointer input through the canvas) ----------------
  const drag = await page.evaluate(() => {
    const wb = window.__WB__;
    const s = wb.scene();
    // pull down-left from the pouch: power without a launch until release
    const a = s.slingshot.anchor;
    return { from: wb.worldToClient(a.x, a.y), to: wb.worldToClient(a.x - 90, a.y + 60) };
  });
  await page.mouse.move(drag.from.x, drag.from.y);
  await page.mouse.down();
  const dragPhase = phase(page, 'aim-drag', 2500);
  // keep the pointer slowly circling during the sampling window
  await page.mouse.move(drag.to.x, drag.to.y, { steps: 30 });
  await sleep(1200);
  await page.mouse.move(drag.to.x + 12, drag.to.y - 8, { steps: 10 });
  results.phases.push(await dragPhase);
  await page.mouse.up(); // low-power release may cancel (dud) — fine either way
  await sleep(600);

  // ---- flight -----------------------------------------------------------
  await page.evaluate(() => window.__WB__.simulateShot({ vx: 17, vy: -4, type: 'basic' }));
  results.phases.push(await phase(page, 'flight', 2500));
  await settleToAiming(page);

  // ---- collapse (bomb into the towers) -----------------------------------
  const bombFired = await page.evaluate(() => window.__WB__.simulateShot({ vx: 17, vy: -3, type: 'bomb' }));
  if (!bombFired) console.log('  [warn] bomb shot refused — collapse phase may measure idle');
  results.phases.push(await phase(page, 'collapse', 6000));
  await settleToAiming(page);

  // ---- question transition (includes synchronous 75-step settle) ----------
  const t0 = Date.now();
  await page.evaluate(() => window.__WB__.gotoQuestion(12, 1));
  await page.waitForFunction(() => {
    const s = window.__WB__.scene();
    return s && s.questionIndex === 1 && s.prepared;
  }, { timeout: 20000 });
  const transWall = Date.now() - t0;
  const transTask = await page.evaluate(() => {
    const t = window.__perf.longTasks.filter((x) => x.phase === 'transition');
    window.__perf.longTasks = window.__perf.longTasks.filter((x) => x.phase !== 'transition');
    return t;
  });
  results.transition = {
    wallMs: transWall,
    longTasksMs: +sum(transTask.map((x) => x.d)).toFixed(1),
    worstTaskMs: transTask.length ? Math.max(...transTask.map((x) => x.d)).toFixed(1) : 0
  };

  // ---- repeated restarts → leak sweep --------------------------------------
  await page.evaluate(() => {
    window.__perf.phase = 'restarts';
  });
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.__WB__.gotoLevel(3));
    await page.waitForFunction(() => {
      const s = window.__WB__.scene();
      return s && s.prepared;
    }, { timeout: 20000 });
    await sleep(250);
  }
  const leak = await page.evaluate(() => {
    const g = window.__WB__.game;
    const scenes = g.scene.getScenes(true);
    const s = window.__WB__.scene();
    if (window.gc) { try { window.gc(); window.gc(); } catch (e) { /* ok */ } }
    const mem = performance.memory
      ? { usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
          totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) } : null;
    return {
      mem,
      bodies: s.matter.world.localWorld.bodies.length,
      children: scenes.reduce((a, sc) => a + sc.children.length, 0),
      textures: g.textures.getTextureKeys().length,
      tweens: scenes.reduce((a, sc) => a + (sc.tweens.tweens ? sc.tweens.tweens.length : 0), 0),
      timers: scenes.reduce((a, sc) => {
        const t = sc.time;
        if (typeof t.getAllEvents === 'function') return a + t.getAllEvents().length;
        if (t.timeline && Array.isArray(t.timeline.events)) return a + t.timeline.events.length;
        return a;
      }, 0),
      sounds: g.sound ? g.sound.sounds.length : 0,
      blocks: s.factory.blocks.length,
      projectiles: s.factory.projectiles.length,
      fragments: s.factory.fragments.length,
      birdSkins: s.factory.birdSkins.length
    };
  });
  const restartTasks = await page.evaluate(() => {
    const t = window.__perf.longTasks.filter((x) => x.phase === 'restarts');
    window.__perf.longTasks.length = 0;
    const total = t.reduce((a, x) => a + x.d, 0);
    return { count: t.length, worstMs: t.length ? Math.max(...t.map((x) => x.d)) : 0, totalMs: +total.toFixed(0) };
  });
  results.leak = leak;
  results.restarts = restartTasks;

  await page.close();
  return results;
}

const PROFILES = [
  {
    name: 'phone-landscape (Pixel 7, DPR2)',
    emulate: {
      viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
    }
  },
  {
    name: 'desktop (1280x720, DPR1)',
    emulate: {
      viewport: { width: 1280, height: 720, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    }
  }
];

const all = [];
for (const p of PROFILES) {
  console.log(`\n=== ${p.name} ===`);
  const r = await runProfile(p);
  all.push(r);
  console.log(`load: boot ${r.load.bootMsAvg}ms  fcp ${r.load.fcpMsAvg}ms  canvas ${r.load.canvasMsAvg}ms  ${r.load.transferKB}KB / ${r.load.requests} req`);
  for (const ph of r.phases) {
    console.log(`${ph.phase.padEnd(11)} frames ${String(ph.frames).padStart(4)}  avg ${ph.avgMs.toFixed(1).padStart(5)}ms  p95 ${String(ph.p95.toFixed(1)).padStart(6)}  p99 ${String(ph.p99.toFixed(1)).padStart(6)}  max ${String(ph.max.toFixed(1)).padStart(7)}  >20ms ${ph.over20ms}  >33ms ${ph.over33ms}`);
  }
  console.log(`transition: wall ${r.transition.wallMs}ms, longtasks ${r.transition.longTasksMs}ms (worst ${r.transition.worstTaskMs}ms)`);
  console.log(`restarts(8): longtasks ${r.restarts.count} total ${r.restarts.totalMs}ms worst ${r.restarts.worstMs.toFixed(1)}ms`);
  console.log(`leak sweep: ${JSON.stringify(r.leak)}`);
}

writeFileSync(join(OUTDIR, `audit-${LABEL}.json`), JSON.stringify(all, null, 2));
console.log(`\nwritten: screenshots/perf/audit-${LABEL}.json`);
await browser.close();
server.close();
process.exit(0);
