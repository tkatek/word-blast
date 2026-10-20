/**
 * Fullscreen + PWA tests (mobile landscape experience).
 *
 * Covers, fully in Node (no DOM required — fakes are injected):
 *   - FullscreenController capability detection: standard API, webkit-only,
 *     missing API (iPhone Safari), fullscreenEnabled === false (iframe
 *     without allowfullscreen / feature policy), standalone display mode.
 *   - State machine: enter() success path (request → VERIFIED element →
 *     ACTIVE → orientation lock attempted, lock failure swallowed),
 *     rejected request → DENIED (no retry storm), unsupported → no-op,
 *     double-enter guard, exit path re-arms AVAILABLE.
 *   - FullscreenEntry.computeEntryMode visibility truth table: never before
 *     boot, never on desktop/portrait/standalone/active, card → chip after
 *     dismissal, UNSUPPORTED → one-time hint.
 *   - manifest.webmanifest: name Word Blast, standalone display, landscape
 *     orientation, relative start_url/scope (portable across deployment
 *     bases), and every referenced icon exists on disk.
 *
 * Run: node tests/fullscreen-tests.mjs   (also part of `npm test`)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FULLSCREEN_STATES,
  FullscreenController,
  detectFullscreenSupport,
  detectStandalone,
  probeFullscreenApi
} from '../js/systems/FullscreenController.js';
import { computeEntryMode, a2hsSteps } from '../js/systems/FullscreenEntry.js';

const root = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push({ name, error: e });
      console.log(`FAIL  ${name}\n      ${e.message}`);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/* ------------------------------------------------------------------ */
/* Fake DOM builders                                                   */
/* ------------------------------------------------------------------ */

/** Minimal EventTarget-ish document fake. */
function makeDoc({ api = 'std', enabled = true } = {}) {
  const listeners = {};
  const props = {};
  const doc = {
    fullscreenElement: null,
    fullscreenEnabled: enabled,
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener: (name, fn) => {
      listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
    },
    dispatch: (name) => {
      for (const fn of (listeners[name] || []).slice()) fn({ type: name });
    },
    documentElement: {}
  };
  if (api === 'none') return { doc: { ...doc, documentElement: {} }, props, fire: () => {} };
  if (api === 'webkit') {
    doc.webkitFullscreenElement = null;
    doc.webkitFullscreenEnabled = enabled;
    doc.documentElement.webkitRequestFullscreen = function () {
      doc.webkitFullscreenElement = doc.documentElement;
      return Promise.resolve();
    };
    doc.webkitExitFullscreen = function () {
      doc.webkitFullscreenElement = null;
      return Promise.resolve();
    };
    return { doc, fire: (on) => { doc.webkitFullscreenElement = on ? doc.documentElement : null; } };
  }
  doc.documentElement.requestFullscreen = function () {
    doc.fullscreenElement = doc.documentElement;
    return Promise.resolve();
  };
  doc.exitFullscreen = function () {
    doc.fullscreenElement = null;
    return Promise.resolve();
  };
  return { doc, fire: (on) => { doc.fullscreenElement = on ? doc.documentElement : null; } };
}

function makeWin({ standalone = false, orientationLock = true } = {}) {
  return {
    navigator: { userAgent: 'TestRunner' },
    matchMedia: (q) => ({ matches: standalone && q.includes('standalone') }),
    screen: orientationLock
      ? { orientation: { lock: async () => {} } }
      : { orientation: {} }
  };
}

/* ------------------------------------------------------------------ */
/* Capability detection                                                */
/* ------------------------------------------------------------------ */

await test('probe: standard API detected', () => {
  const { doc } = makeDoc();
  eq(probeFullscreenApi(doc).vendor, 'std');
});

await test('probe: webkit-only engine detected', () => {
  const { doc } = makeDoc({ api: 'webkit' });
  eq(probeFullscreenApi(doc).vendor, 'webkit');
});

await test('probe: no API (headless / iPhone Safari HTML elements)', () => {
  const { doc } = makeDoc({ api: 'none' });
  eq(probeFullscreenApi(doc).vendor, 'none');
  eq(detectFullscreenSupport(makeWin(), doc).supported, false);
  eq(detectFullscreenSupport(makeWin(), doc).reason, 'no-api');
});

await test('detect: fullscreenEnabled === false (iframe without allowfullscreen)', () => {
  const { doc } = makeDoc({ enabled: false });
  const r = detectFullscreenSupport(makeWin(), doc);
  eq(r.supported, false);
  eq(r.reason, 'disabled');
});

await test('detect: normal browser is supported', () => {
  const { doc } = makeDoc();
  eq(detectFullscreenSupport(makeWin(), doc).supported, true);
});

await test('detect: standalone display mode (installed web app)', () => {
  eq(detectStandalone(makeWin({ standalone: true })), true);
  eq(detectStandalone(makeWin({ standalone: false })), false);
  // navigator.standalone legacy iOS signal
  eq(detectStandalone({ navigator: { standalone: true } }), true);
});

/* ------------------------------------------------------------------ */
/* Controller state machine                                            */
/* ------------------------------------------------------------------ */

await test('controller: unsupported env starts UNSUPPORTED and enter() is a no-op', async () => {
  const { doc } = makeDoc({ api: 'none' });
  const c = new FullscreenController({ win: makeWin(), doc });
  eq(c.state, FULLSCREEN_STATES.UNSUPPORTED);
  const s = await c.enter();
  eq(s, FULLSCREEN_STATES.UNSUPPORTED);
});

await test('controller: supported env starts AVAILABLE', () => {
  const { doc } = makeDoc();
  const c = new FullscreenController({ win: makeWin(), doc });
  eq(c.state, FULLSCREEN_STATES.AVAILABLE);
});

await test('controller: enter() verifies the real fullscreen element → ACTIVE', async () => {
  const { doc, fire } = makeDoc();
  const c = new FullscreenController({ win: makeWin(), doc });
  fire(true); // element set (some engines set it before the promise resolves)
  await c.enter();
  eq(c.state, FULLSCREEN_STATES.ACTIVE);
  eq(c.isFullscreen, true);
});

await test('controller: enter() with a resolving-but-unverified request → DENIED, never ACTIVE', async () => {
  const { doc } = makeDoc();
  // request resolves but the browser never sets fullscreenElement (denied)
  doc.documentElement.requestFullscreen = () => Promise.resolve();
  const c = new FullscreenController({ win: makeWin(), doc });
  const s = await c.enter();
  eq(s, FULLSCREEN_STATES.DENIED);
  eq(c.isFullscreen, false);
});

await test('controller: rejected request → DENIED without throwing', async () => {
  const { doc } = makeDoc();
  doc.documentElement.requestFullscreen = () => Promise.reject(new Error('denied'));
  const c = new FullscreenController({ win: makeWin(), doc });
  const s = await c.enter();
  eq(s, FULLSCREEN_STATES.DENIED);
});

await test('controller: double-enter while REQUESTING is a guarded no-op', async () => {
  const { doc } = makeDoc();
  let calls = 0;
  doc.documentElement.requestFullscreen = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    doc.fullscreenElement = doc.documentElement;
  };
  const c = new FullscreenController({ win: makeWin(), doc });
  const p1 = c.enter();
  const p2 = c.enter(); // must not fire a second request
  await Promise.all([p1, p2]);
  eq(calls, 1);
  eq(c.state, FULLSCREEN_STATES.ACTIVE);
});

await test('controller: exit() → AVAILABLE again (entry control re-armed)', async () => {
  const { doc, fire } = makeDoc();
  const c = new FullscreenController({ win: makeWin(), doc });
  fire(true);
  await c.enter();
  eq(c.state, FULLSCREEN_STATES.ACTIVE);
  await c.exit();
  fire(false);
  c._syncFromDocument();
  eq(c.state, FULLSCREEN_STATES.AVAILABLE);
  eq(c.canEnter, true);
});

await test('controller: DOM fullscreenchange drives state without enter()', () => {
  const { doc } = makeDoc();
  const c = new FullscreenController({ win: makeWin(), doc });
  doc.fullscreenElement = doc.documentElement;
  doc.dispatch('fullscreenchange');
  eq(c.state, FULLSCREEN_STATES.ACTIVE);
  doc.fullscreenElement = null;
  doc.dispatch('fullscreenchange');
  eq(c.state, FULLSCREEN_STATES.AVAILABLE);
});

await test('controller: fullscreenerror during REQUESTING → DENIED', () => {
  const { doc } = makeDoc();
  const c = new FullscreenController({ win: makeWin(), doc });
  c._set(FULLSCREEN_STATES.REQUESTING);
  doc.dispatch('fullscreenerror');
  eq(c.state, FULLSCREEN_STATES.DENIED);
});

await test('controller: standalone starts STANDALONE and enter() never requests', async () => {
  const { doc } = makeDoc();
  let requested = 0;
  doc.documentElement.requestFullscreen = () => { requested++; return Promise.resolve(); };
  const c = new FullscreenController({ win: makeWin({ standalone: true }), doc });
  eq(c.state, FULLSCREEN_STATES.STANDALONE);
  await c.enter();
  eq(requested, 0);
});

await test('controller: orientation lock attempted on success, failures swallowed', async () => {
  const { doc, fire } = makeDoc();
  const winLocked = makeWin();
  let locks = 0;
  winLocked.screen.orientation.lock = async () => { locks++; };
  const c1 = new FullscreenController({ win: winLocked, doc });
  fire(true);
  await c1.enter();
  eq(locks, 1);

  const winNoLock = makeWin({ orientationLock: false });
  const { doc: doc2, fire: fire2 } = makeDoc();
  const c2 = new FullscreenController({ win: winNoLock, doc: doc2 });
  fire2(true);
  await c2.enter(); // no lock API — must not throw
  eq(c2.state, FULLSCREEN_STATES.ACTIVE);

  const winBadLock = makeWin();
  winBadLock.screen.orientation.lock = async () => { throw new Error('locked by user'); };
  const { doc: doc3, fire: fire3 } = makeDoc();
  const c3 = new FullscreenController({ win: winBadLock, doc: doc3 });
  fire3(true);
  await c3.enter(); // rejected lock — must not throw, still ACTIVE
  eq(c3.state, FULLSCREEN_STATES.ACTIVE);
});

await test('controller: webkit engine path works end-to-end', async () => {
  const { doc, fire } = makeDoc({ api: 'webkit' });
  const c = new FullscreenController({ win: makeWin(), doc });
  eq(c.support.supported !== false || c.support.api.vendor === 'webkit', true);
  fire(true);
  await c.enter();
  eq(c.state, FULLSCREEN_STATES.ACTIVE);
});

await test('controller: onChange fires on transitions and unsubscribes cleanly', () => {
  const { doc } = makeDoc();
  const c = new FullscreenController({ win: makeWin(), doc });
  const seen = [];
  const off = c.onChange((n) => seen.push(n));
  doc.fullscreenElement = doc.documentElement;
  doc.dispatch('fullscreenchange');
  doc.fullscreenElement = null;
  doc.dispatch('fullscreenchange');
  off();
  doc.fullscreenElement = doc.documentElement;
  doc.dispatch('fullscreenchange');
  eq(seen.length, 2);
  eq(seen[0], FULLSCREEN_STATES.ACTIVE);
  eq(seen[1], FULLSCREEN_STATES.AVAILABLE);
});

/* ------------------------------------------------------------------ */
/* Entry UI visibility truth table                                     */
/* ------------------------------------------------------------------ */

const base = {
  booted: true, mobile: true, landscape: true, standalone: false,
  state: FULLSCREEN_STATES.AVAILABLE, cardDismissed: false, hintDismissed: false
};

await test('entry: card shown on booted mobile landscape with API available', () => {
  eq(computeEntryMode(base), 'card');
});

await test('entry: nothing before boot (failed start never shows fullscreen UI)', () => {
  eq(computeEntryMode({ ...base, booted: false }), null);
});

await test('entry: nothing on desktop or portrait (rotate gate owns portrait)', () => {
  eq(computeEntryMode({ ...base, mobile: false }), null);
  eq(computeEntryMode({ ...base, landscape: false }), null);
});

await test('entry: nothing in standalone or while fullscreen active', () => {
  eq(computeEntryMode({ ...base, standalone: true }), null);
  eq(computeEntryMode({ ...base, state: FULLSCREEN_STATES.ACTIVE }), null);
  eq(computeEntryMode({ ...base, state: FULLSCREEN_STATES.STANDALONE }), null);
});

await test('entry: dismissed card downgrades to the non-blocking chip', () => {
  eq(computeEntryMode({ ...base, cardDismissed: true }), 'chip');
});

await test('entry: UNSUPPORTED (iPhone Safari) → hint once, then nothing', () => {
  eq(computeEntryMode({ ...base, state: FULLSCREEN_STATES.UNSUPPORTED }), 'hint');
  eq(computeEntryMode({ ...base, state: FULLSCREEN_STATES.UNSUPPORTED, hintDismissed: true }), null);
});

await test('entry: DENIED keeps the card (retry only by explicit tap)', () => {
  eq(computeEntryMode({ ...base, state: FULLSCREEN_STATES.DENIED }), 'card');
});

await test('entry: REQUESTING keeps visible but the button disables (no double request)', () => {
  eq(computeEntryMode({ ...base, state: FULLSCREEN_STATES.REQUESTING }), 'card');
  eq(computeEntryMode({ ...base, state: FULLSCREEN_STATES.REQUESTING, cardDismissed: true }), 'chip');
});

await test('entry: A2HS steps name the right platform flow', () => {
  assert(a2hsSteps(true)[1].includes('Add to Home Screen'));
  assert(a2hsSteps(false)[1].includes('Install app'));
});

/* ------------------------------------------------------------------ */
/* Manifest (installed web app config)                                 */
/* ------------------------------------------------------------------ */

await test('manifest: valid JSON with the required Word Blast fields', () => {
  const raw = readFileSync(join(root, '../public/manifest.webmanifest'), 'utf8');
  const m = JSON.parse(raw);
  eq(m.name, 'Word Blast');
  eq(m.short_name, 'Word Blast');
  eq(m.display, 'standalone');
  eq(m.orientation, 'landscape');
});

await test('manifest: relative start_url/scope — portable across deployment bases', () => {
  const m = JSON.parse(readFileSync(join(root, '../public/manifest.webmanifest'), 'utf8'));
  assert(!m.start_url.startsWith('/'), 'start_url must be relative (works under /word-blast/ and any future base)');
  assert(!m.scope.startsWith('/'), 'scope must be relative');
  eq(m.start_url, './');
  eq(m.scope, './');
});

await test('manifest: every icon exists on disk with declared sizes', () => {
  const m = JSON.parse(readFileSync(join(root, '../public/manifest.webmanifest'), 'utf8'));
  assert(m.icons.length >= 2, 'need at least 2 icons');
  for (const icon of m.icons) {
    const p = join(root, '../public', icon.src);
    assert(existsSync(p), `missing icon file: ${icon.src}`);
    const png = readFileSync(p);
    // PNG IHDR width/height at bytes 16..23
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const [sw, sh] = icon.sizes.split('x').map(Number);
    eq(w, sw, `${icon.src} width`);
    eq(h, sh, `${icon.src} height`);
  }
});

await test('apple-touch-icon exists (180×180 opaque) for iOS home screen', () => {
  const p = join(root, '../public/assets/images/icons/apple-touch-icon.png');
  assert(existsSync(p), 'apple-touch-icon.png missing');
  const png = readFileSync(p);
  eq(png.readUInt32BE(16), 180);
  eq(png.readUInt32BE(20), 180);
});

await test('index.html: manifest + apple metadata linked relatively', () => {
  const html = readFileSync(join(root, '../index.html'), 'utf8');
  assert(html.includes('rel="manifest"'), 'manifest link missing');
  assert(html.includes('href="./manifest.webmanifest"'), 'manifest link must be relative');
  assert(html.includes('rel="apple-touch-icon"'), 'apple-touch-icon link missing');
  assert(html.includes('apple-mobile-web-app-capable'), 'apple web-app meta missing');
});

/* ------------------------------------------------------------------ */

console.log(`\nfullscreen/pwa: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  • ${f.name}: ${f.error.message}`);
  process.exit(1);
}
