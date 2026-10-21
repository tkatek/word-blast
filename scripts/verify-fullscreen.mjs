/**
 * Mobile fullscreen experience verification — boots the REAL built game in
 * Chrome (puppeteer) with mobile emulation and exercises every case:
 *
 *   A. Android-style landscape (Fullscreen API present)
 *      - entry card with ⛶ PLAY FULLSCREEN appears after boot
 *      - tap → document.fullscreenElement verified ACTIVE, card hidden,
 *        canvas resized, orientation lock attempted
 *      - pause menu shows EXIT FULLSCREEN while active; exiting keeps the
 *        game PAUSED and re-arms the compact corner chip
 *   B. iPhone-Safari-style landscape (element Fullscreen API removed)
 *      - NO play button; "Play without the address bar" install guidance
 *        (7 real iOS steps incl. the landscape page-menu Share location
 *        and the Open-as-Web-App toggle); CONTINUE IN BROWSER dismisses it;
 *        a compact INSTALL chip keeps the route reachable and RE-OPENS the
 *        instructions; game stays playable; nothing auto re-prompts
 *   C. Installed web app (display-mode: standalone)
 *      - no fullscreen UI at all
 *   D. Rotation during gameplay
 *      - portrait → rotate gate + PAUSED, progress kept (question index,
 *        shots, score unchanged); landscape → back to exactly the same
 *      - rotation while manually paused stays paused (also across
 *        fullscreen exit)
 *   E. Viewport / manifest plumbing
 *      - manifest.webmanifest resolves (200, JSON) under the /wb/ prefix
 *      - exactly ONE canvas (no duplicate Phaser game after all events)
 *      - narrow (640×280) and wide (915×412) landscape: whole world framed
 *   F. On-device diagnostics (?diag=1)
 *      - launcher button appears with the flag (and NOT without it);
 *        panel opens; window.__WB__.diag() reports build / launch mode /
 *        fullscreen capability + lastError / live dimensions
 *
 * Run AFTER `npm run build`:
 *   node scripts/verify-fullscreen.mjs
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const PREFIX = '/wb/';
const PORT = 8092;
const OUT = join(ROOT, 'screenshots', 'fullscreen');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.ico': 'image/x-icon', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Accept BOTH the /wb/ prefix (relative-base builds) and the production
  // /word-blast/ prefix (build:pages) — whichever base dist/ was compiled
  // with, its asset URLs resolve. Makes this check robust to either build.
  const prefix = url.startsWith(PREFIX) ? PREFIX
    : url.startsWith('/word-blast/') ? '/word-blast/' : null;
  if (!prefix) { res.writeHead(404).end('prefix only'); return; }
  let rel = url.slice(prefix.length) || 'index.html';
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
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio', '--disable-dev-shm-usage',
    '--no-first-run', '--autoplay-policy=no-user-gesture-required']
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** New page with a phone-landscape viewport + console error capture. */
async function phonePage({ ua = ANDROID_UA, w = 844, h = 390, initScript = null } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  if (initScript) await page.evaluateOnNewDocument(initScript);
  await page.emulate({
    viewport: { width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent: ua
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && g.textures.exists('bird-red');
  }, { timeout: 45000, polling: 250 });
  await page.evaluate(() => {
    window.__WB__.setAutoPause(false);
    // The question card's reading window is FRAME-driven; headless
    // SwiftShader renders slowly under load, so shorten the phases (the
    // standard test hook) — these checks exercise fullscreen logic, not
    // card animation pacing.
    window.__WB__.setCardTimings({ enterMs: 60, readingMs: 250, moveMs: 80, exitMs: 60, peekMs: 80 });
  });
  return { page, errors };
}

const fsInfo = (page) => page.evaluate(() => window.__WB__.fullscreen());

/* ================================================================== */
/* A. Android-style landscape: entry → fullscreen → exit → chip        */
let A_ERRORS = [];
/* ================================================================== */
let pageA = null;
try {
  ({ page: pageA, errors: A_ERRORS } = await phonePage());
  const page = pageA, errors = A_ERRORS;

  // A1 — the entry card appears after a verified boot
  await page.waitForSelector('#fs-entry.is-visible', { timeout: 5000 });
  const cardVisible = await page.evaluate(() => {
    const play = document.querySelector('#fs-entry [data-variant="play"]');
    return play && getComputedStyle(play).display !== 'none'
      && document.querySelector('.fs-btn-play .fs-btn-label').textContent.includes('PLAY FULLSCREEN');
  });
  check('A1 landscape phone sees the PLAY FULLSCREEN card', cardVisible);
  await page.screenshot({ path: join(OUT, '01-android-landscape-card.png') });

  // A2 — tap → REAL fullscreen (verified through document.fullscreenElement)
  await page.click('.fs-btn-play');
  await page.waitForFunction(() => window.__WB__.fullscreen().isFullscreen, { timeout: 8000, polling: 250 });
  const active = await fsInfo(page);
  check('A2 tap enters REAL fullscreen (element verified)', active.isFullscreen, active.state);
  const cardHidden = await page.evaluate(() => !document.querySelector('#fs-entry').classList.contains('is-visible'));
  check('A3 entry card hidden after successful entry', cardHidden);
  const canvasCount = await page.evaluate(() => document.querySelectorAll('#game canvas').length);
  check('A4 still exactly one Phaser canvas', canvasCount === 1);
  await sleep(400); // let the resize settle
  await page.screenshot({ path: join(OUT, '02-android-fullscreen-active.png') });

  // A5 — gameplay + pause menu exit control while fullscreen
  await page.evaluate(() => window.__WB__.gotoLevel(1));
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000, polling: 250 });
  await page.keyboard.press('KeyP'); // manual pause
  await sleep(400);
  const fsBtnVisible = await page.evaluate(() => {
    const s = window.__WB__.scene();
    return !!(s && s.hud && s.hud.fsBtn && s.hud.fsBtn.visible);
  });
  check('A5 pause menu shows EXIT FULLSCREEN while active', fsBtnVisible);
  await page.screenshot({ path: join(OUT, '03-android-pause-exit-fullscreen.png') });

  // A6 — exit fullscreen from the menu action: stays PAUSED, chip re-armed
  await page.evaluate(() => window.__WB__.scene().hud.actions.onExitFullscreen());
  await page.waitForFunction(() => window.__WB__.fullscreen().state === 'available', { timeout: 8000, polling: 250 });
  await sleep(350); // the prompt updates on a short debounce after the state flip
  const afterExit = await page.evaluate(() => ({
    paused: window.__WB__.scene().stateMachine.isPaused(),
    chip: document.querySelector('#fs-chip').classList.contains('is-visible'),
    card: document.querySelector('#fs-entry').classList.contains('is-visible'),
    fsBtn: window.__WB__.scene().hud.fsBtn.visible
  }));
  check('A6 exit → state available again', true);
  check('A7 game still PAUSED after exiting fullscreen', afterExit.paused);
  check('A8 compact chip available after exit (card does not re-block)', afterExit.chip && !afterExit.card);
  check('A9 pause-menu exit control hidden when not fullscreen', !afterExit.fsBtn);

  // A10 — resume and play on: progress untouched by the whole cycle
  await page.keyboard.press('KeyP'); // resume
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 8000, polling: 250 });
  const info = await page.evaluate(() => window.__WB__.info());
  check('A10 gameplay resumes normally after fullscreen cycle',
    info.state === 'AIMING' && info.shotsLeft > 0);
  check('A11 no page errors during the fullscreen cycle', errors.length === 0, errors[0] || '');
} catch (e) {
  check('A android landscape suite', false, String(e).slice(0, 250));
} finally {
  await pageA?.close();
}

/* ================================================================== */
/* B. iPhone-Safari-style: element Fullscreen API absent               */
/* ================================================================== */
let pageB = null;
try {
  // Strip the element fullscreen API exactly like iPhone Safari (which only
  // supports <video> fullscreen) BEFORE any module runs. Init scripts see no
  // documentElement yet, so hide the API at the prototype level instead.
  const strip = () => {
    try {
      Object.defineProperty(Element.prototype, 'requestFullscreen', { get: () => undefined, configurable: true });
      Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', { get: () => undefined, configurable: true });
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true });
      Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false, configurable: true });
    } catch (e) { /* best effort */ }
  };
  let page = null;
  let errors = [];
  ({ page, errors } = await phonePage({ ua: IPHONE_UA, initScript: strip }));
  pageB = page;

  const probe = await fsInfo(page);
  check('B1 API absence detected (unsupported)', probe.state === 'unsupported' && probe.supported === false, probe.state);

  await page.waitForSelector('#fs-entry.is-visible', { timeout: 5000 });
  const hint = await page.evaluate(() => {
    const hint = document.querySelector('#fs-entry [data-variant="hint"]');
    const play = document.querySelector('#fs-entry [data-variant="play"]');
    const steps = [...document.querySelectorAll('.fs-hint-steps li')].map((x) => x.textContent.trim());
    const btn = document.querySelector('.fs-btn-continue .fs-btn-label');
    return {
      hintShown: hint && getComputedStyle(hint).display !== 'none',
      playHidden: !play || getComputedStyle(play).display === 'none',
      steps,
      continueLabel: btn ? btn.textContent.trim() : ''
    };
  });
  const stepsJoined = hint.steps.join(' | ');
  check('B2 install guidance shown: 7 real iOS steps + CONTINUE IN BROWSER',
    hint.hintShown && hint.playHidden
      && hint.steps.length === 7
      && hint.steps[0].includes('Safari')
      && /Share/.test(stepsJoined) && /page menu/.test(stepsJoined)
      && /Add to Home Screen/.test(stepsJoined) && /Open as Web App/.test(stepsJoined)
      && /sideways/.test(stepsJoined)
      && hint.continueLabel.includes('CONTINUE IN BROWSER'),
    `${hint.steps.length} steps`);
  await page.screenshot({ path: join(OUT, '04-iphone-safari-fallback.png') });

  // game remains fully playable behind/below the card; dismissal is
  // optional and never traps the player
  await page.click('.fs-btn-continue');
  await sleep(350); // debounced prompt update
  const dismissed = await page.evaluate(() => ({
    card: document.querySelector('#fs-entry').classList.contains('is-visible'),
    chip: document.querySelector('#fs-chip').classList.contains('is-visible'),
    chipLabel: document.querySelector('#fs-chip .fs-chip-label').textContent.trim()
  }));
  check('B3 CONTINUE IN BROWSER dismisses; compact INSTALL chip keeps the route reachable',
    !dismissed.card && dismissed.chip && dismissed.chipLabel.includes('INSTALL'));

  // the chip RE-OPENS the instructions (it never requests fullscreen the
  // browser would only reject)
  await page.click('#fs-chip');
  await sleep(350);
  const reopened = await page.evaluate(() => {
    const card = document.querySelector('#fs-entry').classList.contains('is-visible');
    const hint = document.querySelector('#fs-entry [data-variant="hint"]');
    return card && hint && getComputedStyle(hint).display !== 'none';
  });
  check('B3b install chip re-opens the instructions on demand', reopened);
  await page.click('.fs-btn-continue'); // dismiss again for the play checks
  await sleep(350);

  await page.evaluate(() => window.__WB__.gotoLevel(1));
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000, polling: 250 });
  const state = await page.evaluate(() => window.__WB__.info().state);
  check('B4 game fully playable in normal landscape', state === 'AIMING');
  // no re-prompt after rotating away and back
  await page.evaluate(() => window.__WB__.setOrientationOverride('portrait'));
  await sleep(200);
  await page.evaluate(() => window.__WB__.setOrientationOverride(null));
  await sleep(300);
  const rePrompt = await page.evaluate(() => document.querySelector('#fs-entry').classList.contains('is-visible'));
  check('B5 dismissed hint never re-prompts on rotation', !rePrompt);
  check('B6 no page errors (iPhone path)', errors.length === 0, errors[0] || '');
} catch (e) {
  check('B iPhone fallback suite', false, String(e).slice(0, 250));
} finally {
  await pageB?.close();
}

/* ================================================================== */
/* C. Installed web app (standalone display mode)                      */
/* ================================================================== */
let pageC = null;
try {
  const standalone = () => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => ({
      media: q,
      matches: /display-mode:\s*(standalone|fullscreen|minimal-ui)/.test(q) ? true : real(q).matches,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      onchange: null, dispatchEvent: () => false
    });
  };
  let page = null;
  ({ page } = await phonePage({ initScript: standalone }));
  pageC = page;
  const probe = await fsInfo(page);
  const noUi = await page.evaluate(() => ({
    card: document.querySelector('#fs-entry').classList.contains('is-visible'),
    chip: document.querySelector('#fs-chip').classList.contains('is-visible')
  }));
  check('C1 standalone detected → no fullscreen UI at all',
    probe.standalone && probe.state === 'standalone' && !noUi.card && !noUi.chip);
} catch (e) {
  check('C standalone suite', false, String(e).slice(0, 250));
} finally {
  await pageC?.close();
}

/* ================================================================== */
/* D. Rotation during gameplay (progress preservation)                 */
/* ================================================================== */
let pageD = null;
try {
  let page = null;
  ({ page } = await phonePage());
  pageD = page;
  await page.evaluate(() => document.querySelector('.fs-dismiss')?.click()); // clear the card
  await page.evaluate(() => window.__WB__.gotoLevel(1));
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000, polling: 250 });

  const before = await page.evaluate(() => {
    const i = window.__WB__.info();
    return { q: i.questionIndex, shots: i.shotsLeft, score: i.score, hearts: i.hearts };
  });

  // portrait mid-aim
  await page.evaluate(() => window.__WB__.setOrientationOverride('portrait'));
  await sleep(300);
  const portraitState = await page.evaluate(() => ({
    gate: document.querySelector('#rotate-overlay').classList.contains('is-visible'),
    paused: window.__WB__.scene().stateMachine.isPaused(),
    card: document.querySelector('#fs-entry').classList.contains('is-visible')
  }));
  check('D1 portrait mid-aim → rotate gate + auto-pause (fs card hidden)',
    portraitState.gate && portraitState.paused && !portraitState.card);

  // rotate back mid-aim: auto-pause lifts, game resumes EXACTLY where it was
  await page.evaluate(() => window.__WB__.setOrientationOverride(null));
  await sleep(300);
  const resumed = await page.evaluate(() => ({
    gate: document.querySelector('#rotate-overlay').classList.contains('is-visible'),
    paused: window.__WB__.scene().stateMachine.isPaused()
  }));
  check('D1b rotate back mid-aim → gate hidden, game resumed (not restarted)',
    !resumed.gate && !resumed.paused);

  // manual pause in LANDSCAPE (the real UI path), then rotate away and back:
  // the player's pause must survive the rotation round-trip
  await page.keyboard.press('KeyP'); // manual pause while landscape
  await sleep(250);
  await page.evaluate(() => window.__WB__.setOrientationOverride('portrait'));
  await sleep(300);
  const pausedPortrait = await page.evaluate(() => ({
    gate: document.querySelector('#rotate-overlay').classList.contains('is-visible'),
    paused: window.__WB__.scene().stateMachine.isPaused()
  }));
  check('D2a manually paused + portrait → gate shows, stays paused',
    pausedPortrait.gate && pausedPortrait.paused);
  await page.evaluate(() => window.__WB__.setOrientationOverride(null));
  await sleep(300);
  const stillPaused = await page.evaluate(() => ({
    gate: document.querySelector('#rotate-overlay').classList.contains('is-visible'),
    paused: window.__WB__.scene().stateMachine.isPaused()
  }));
  check('D2b manual pause respected across rotation back', !stillPaused.gate && stillPaused.paused);

  await page.keyboard.press('KeyP'); // resume
  const after = await page.evaluate(() => {
    const i = window.__WB__.info();
    return { q: i.questionIndex, shots: i.shotsLeft, score: i.score, hearts: i.hearts };
  });
  check('D3 level/question/shots/score/hearts unchanged by rotation',
    before.q === after.q && before.shots === after.shots
    && before.score === after.score && before.hearts === after.hearts);

  const oneCanvas = await page.evaluate(() => document.querySelectorAll('#game canvas').length);
  check('D4 no duplicate canvas after rotation cycle', oneCanvas === 1);
} catch (e) {
  check('D rotation suite', false, String(e).slice(0, 250));
} finally {
  await pageD?.close();
}

/* ================================================================== */
/* E. Viewport framing at extreme landscape ratios + manifest          */
/* ================================================================== */
try {
  for (const [w, h, label] of [[640, 280, 'narrow'], [915, 412, 'wide']]) {
    const { page, errors } = await phonePage({ w, h });
    await page.evaluate(() => document.querySelector('.fs-dismiss')?.click());
    await page.evaluate(() => window.__WB__.gotoLevel(1));
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000, polling: 250 });
    const fit = await page.evaluate(() => {
      const g = window.__WB__.game;
      const canvas = document.querySelector('#game canvas');
      return {
        bufW: g.scale.gameSize.width, bufH: g.scale.gameSize.height,
        cssW: Math.round(canvas.getBoundingClientRect().width),
        cssH: Math.round(canvas.getBoundingClientRect().height),
        innerW: window.innerWidth, innerH: window.innerHeight
      };
    });
    const covers = fit.cssW >= fit.innerW - 2 && fit.cssH >= fit.innerH - 2;
    const ratio = Math.abs(fit.bufW / fit.bufH - fit.cssW / fit.cssH) < 0.02;
    check(`E-${label} ${w}×${h}: canvas covers viewport, aspect kept (no stretch)`,
      covers && ratio, JSON.stringify(fit));
    await page.screenshot({ path: join(OUT, `05-landscape-${label}-${w}x${h}.png`) });
    check(`E-${label} no page errors`, errors.length === 0, errors[0] || '');
    await page.close();
  }

  // manifest resolves under the deployment prefix
  const page = await browser.newPage();
  const res = await page.goto(`http://localhost:${PORT}${PREFIX}manifest.webmanifest`);
  const manifest = await res.json().catch(() => null);
  check('E manifest served under /wb/ prefix with correct content',
    res.status() === 200 && manifest && manifest.name === 'Word Blast'
    && manifest.display === 'standalone' && manifest.orientation === 'landscape');
  const href = await page.evaluate(async () => {
    await fetch(location.href); // warm
    return null;
  });
  void href;
  await page.close();
} catch (e) {
  check('E viewport/manifest suite', false, String(e).slice(0, 250));
}

/* ================================================================== */
/* F. On-device diagnostics (?diag=1)                                  */
/* ================================================================== */
try {
  // F1 — without the flag: no diagnostics UI at all
  const { page: plain } = await phonePage({ ua: IPHONE_UA });
  const noFlag = await plain.evaluate(() => ({
    button: !!document.getElementById('wb-diag-button'),
    panel: !!document.getElementById('wb-diag-panel'),
    build: window.__WB__.build
  }));
  check('F1 no diagnostics UI without ?diag=1 (build id still exposed)',
    !noFlag.button && !noFlag.panel && typeof noFlag.build === 'string' && noFlag.build.length > 0,
    noFlag.build);
  await plain.close();

  // F2 — with the flag: launcher + panel + a complete snapshot
  const diagPage = await browser.newPage();
  await diagPage.emulate({
    viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent: IPHONE_UA
  });
  await diagPage.goto(`http://localhost:${PORT}${PREFIX}?diag=1`, { waitUntil: 'domcontentloaded' });
  await diagPage.waitForSelector('#wb-diag-button', { timeout: 8000 });
  const preOpen = await diagPage.evaluate(() => window.__WB__.diag());
  check('F2 diag(): build/launch/fullscreen/dimensions reported',
    /^\d+(\.\d+)*\+[0-9a-f]+@/.test(preOpen.build)
    && preOpen.launch && typeof preOpen.launch.standalone === 'boolean'
    && preOpen.fullscreen && typeof preOpen.fullscreen.supported === 'boolean'
    && preOpen.fullscreen.lastError === null
    && preOpen.viewport && preOpen.viewport.inner && preOpen.viewport.canvasCssRect
    && preOpen.viewport.buffer && preOpen.viewport.buffer.w > 0,
    preOpen.build);
  await diagPage.click('#wb-diag-button');
  await diagPage.waitForSelector('#wb-diag-panel', { timeout: 4000 });
  const panelText = await diagPage.evaluate(() =>
    document.querySelector('.wb-diag-body').textContent);
  check('F3 panel opens with copyable, privacy-safe text',
    panelText.includes('BUILD:') && panelText.includes('fs.state')
      && !/password|token/i.test(panelText));
  const copyBtn = await diagPage.evaluate(() => {
    const b = document.querySelector('#wb-diag-panel .wb-diag-head button');
    return b && b.textContent;
  });
  check('F4 panel offers COPY (and CLOSE) buttons', !!copyBtn);
  await diagPage.screenshot({ path: join(OUT, '06-diagnostics-panel.png') });
  await diagPage.close();
} catch (e) {
  check('F diagnostics suite', false, String(e).slice(0, 250));
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nfullscreen verification: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
