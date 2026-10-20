/**
 * On-device diagnostics (?diag=1) — phone-accessible, copyable, read-only.
 *
 * WHY: "fullscreen works in desktop emulation but fails on the iPhone" was
 * previously undiagnosable on the device itself. This panel shows, live:
 *   - build identity (a stale deployment is recognizable at a glance)
 *   - browser/device classification and touch/pointer capabilities
 *   - launch mode: browser tab vs installed standalone web app (and which
 *     signal said so)
 *   - Fullscreen API availability + enabled state + vendor + the CURRENT
 *     fullscreen element + the LAST fullscreen error name/message
 *   - container / visual viewport / canvas / buffer dimensions + DPR +
 *     effective safe-area padding (the one place padding is applied)
 *   - orientation-gate state and the active pause reasons (rotation /
 *     manual / hidden tab), derived from live signals
 *
 * PRIVACY: no personal data, no storage contents, no credentials. Only
 * capabilities, dimensions and error names — safe to paste into a bug
 * report. Nothing is persisted or sent anywhere.
 *
 * OPEN ON THE PHONE: add ?diag=1 to the URL (e.g.
 * https://tkatek.github.io/word-blast/?diag=1). A small 🛠 button appears
 * bottom-left; tapping it opens the panel. On desktop the same data is
 * available as window.__WB__.diag().
 *
 * Node-safe: installDiagnostics() without a DOM is a no-op; the pure
 * collector takes injected deps so unit tests can exercise it.
 */
import { BUILD_ID, IS_BUNDLED } from '../build-info.js';
import { deviceInfo } from './Device.js';
import { detectStandalone } from './FullscreenController.js';

/**
 * Assemble the diagnostics snapshot.
 * @param {object} [deps] { win, doc, game, fullscreen } — injected fakes
 *   for tests; defaults to the live globals when present.
 */
export function collectDiagnostics(deps = {}) {
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const game = deps.game || null;
  const fullscreen = deps.fullscreen || null;
  const out = {
    build: BUILD_ID,
    bundled: IS_BUNDLED,
    time: new Date().toISOString()
  };

  if (!win || !doc) return out; // headless

  /* --- browser / device ------------------------------------------------ */
  const nav = win.navigator || {};
  out.browser = {
    userAgent: nav.userAgent || '(none)',
    platform: nav.platform || '(unknown)',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    pointerCoarse: typeof win.matchMedia === 'function'
      ? win.matchMedia('(pointer: coarse)').matches : null
  };
  out.device = deviceInfo();

  /* --- launch mode ------------------------------------------------------ */
  const mm = (q) => {
    try { return typeof win.matchMedia === 'function' ? win.matchMedia(q).matches : null; }
    catch (e) { return null; }
  };
  out.launch = {
    displayMode: fullscreen ? fullscreen.displayMode : '(no controller)',
    standalone: detectStandalone(win),
    signals: {
      displayModeStandalone: mm('(display-mode: standalone)'),
      displayModeFullscreen: mm('(display-mode: fullscreen)'),
      displayModeMinimalUi: mm('(display-mode: minimal-ui)'),
      navigatorStandalone: nav.standalone === true
    },
    appleMetaPresent: !!doc.querySelector('meta[name="apple-mobile-web-app-capable"]')
  };

  /* --- fullscreen capability + last error ------------------------------- */
  if (fullscreen) {
    const fsEl = typeof fullscreen.fullscreenElement === 'function'
      ? fullscreen.fullscreenElement() : null;
    out.fullscreen = {
      state: fullscreen.state,
      displayMode: fullscreen.displayMode,
      supported: fullscreen.support ? fullscreen.support.supported : null,
      unsupportedReason: fullscreen.support ? fullscreen.support.reason : null,
      apiVendor: fullscreen.support && fullscreen.support.api ? fullscreen.support.api.vendor : null,
      fullscreenEnabled: fullscreen.support && fullscreen.support.api && fullscreen.support.api.enabled
        ? doc[fullscreen.support.api.enabled] : null,
      fullscreenElement: fsEl ? (fsEl.tagName || String(fsEl)) : null,
      lastError: fullscreen.lastError || null,
      orientationLock: !!(win.screen && win.screen.orientation
        && typeof win.screen.orientation.lock === 'function')
    };
  } else {
    out.fullscreen = { state: '(no controller)' };
  }

  /* --- viewport / canvas geometry --------------------------------------- */
  const vv = win.visualViewport;
  const canvas = doc.querySelector('#game canvas');
  const container = doc.getElementById('game');
  let rect = null;
  let pad = null;
  try {
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    if (container) {
      const cs = win.getComputedStyle(container);
      pad = {
        top: cs.paddingTop, right: cs.paddingRight,
        bottom: cs.paddingBottom, left: cs.paddingLeft
      };
    }
  } catch (e) { /* non-layout environments */ }
  out.viewport = {
    inner: { w: win.innerWidth, h: win.innerHeight },
    visualViewport: vv ? { w: Math.round(vv.width), h: Math.round(vv.height), scale: vv.scale } : null,
    screen: win.screen ? { w: win.screen.width, h: win.screen.height } : null,
    devicePixelRatio: win.devicePixelRatio || 1,
    canvasCssRect: rect,
    containerSafeAreaPadding: pad,
    buffer: game && game.scale
      ? { w: game.scale.gameSize.width, h: game.scale.gameSize.height } : null
  };

  /* --- orientation + pause state ---------------------------------------- */
  const gate = doc.getElementById('rotate-overlay');
  const scene = game && typeof game.scene !== 'undefined' && game.scene.getScene
    ? game.scene.getScene('GameScene') : null;
  out.orientation = {
    portrait: out.device.portrait,
    angle: (win.screen && win.screen.orientation && typeof win.screen.orientation.angle === 'number')
      ? win.screen.orientation.angle
      : (typeof win.orientation === 'number' ? win.orientation : null),
    gateVisible: !!(gate && gate.classList.contains('is-visible'))
  };
  out.pause = {
    documentHidden: doc.hidden,
    gameSceneActive: !!scene,
    state: scene && scene.stateMachine ? scene.stateMachine.current : null,
    paused: !!(scene && scene.stateMachine && scene.stateMachine.isPaused()),
    rotationPaused: !!(scene && scene.rotationPaused),
    pauseMenuOpen: !!(scene && scene.hud && scene.hud.pauseOpen === true)
  };

  /* --- boot health ------------------------------------------------------ */
  out.boot = {
    watchdogBooted: !!(win.__wbBoot && win.__wbBoot.booted),
    problems: (win.__wbBoot && typeof win.__wbBoot.problems === 'function')
      ? win.__wbBoot.problems() : []
  };
  out.canvases = doc.querySelectorAll('#game canvas').length;

  return out;
}

/** Format the snapshot as plain copyable text (stable order). */
export function diagnosticsToText(d) {
  const lines = [];
  const push = (k, v) => lines.push(`${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`);
  push('BUILD', d.build);
  push('bundled', d.bundled);
  push('time', d.time);
  if (d.browser) {
    push('UA', d.browser.userAgent);
    push('platform', d.browser.platform);
    push('maxTouchPoints', d.browser.maxTouchPoints);
    push('pointerCoarse', d.browser.pointerCoarse);
  }
  if (d.device) push('device', { type: d.device.type, portrait: d.device.portrait, aspect: d.device.aspect });
  if (d.launch) {
    push('launch.displayMode', d.launch.displayMode);
    push('launch.standalone', d.launch.standalone);
    push('launch.signals', d.launch.signals);
    push('launch.appleMeta', d.launch.appleMetaPresent);
  }
  if (d.fullscreen) {
    push('fs.state', d.fullscreen.state);
    push('fs.supported', d.fullscreen.supported);
    push('fs.unsupportedReason', d.fullscreen.unsupportedReason);
    push('fs.apiVendor', d.fullscreen.apiVendor);
    push('fs.fullscreenEnabled', d.fullscreen.fullscreenEnabled);
    push('fs.fullscreenElement', d.fullscreen.fullscreenElement);
    push('fs.lastError', d.fullscreen.lastError);
    push('fs.orientationLockApi', d.fullscreen.orientationLock);
  }
  if (d.viewport) {
    push('vp.inner', d.viewport.inner);
    push('vp.visualViewport', d.viewport.visualViewport);
    push('vp.screen', d.viewport.screen);
    push('vp.dpr', d.viewport.devicePixelRatio);
    push('vp.canvasRect', d.viewport.canvasCssRect);
    push('vp.safeAreaPadding', d.viewport.containerSafeAreaPadding);
    push('vp.buffer', d.viewport.buffer);
  }
  if (d.orientation) {
    push('orient.portrait', d.orientation.portrait);
    push('orient.angle', d.orientation.angle);
    push('orient.gateVisible', d.orientation.gateVisible);
  }
  if (d.pause) push('pause', d.pause);
  if (d.boot) {
    push('boot.booted', d.boot.watchdogBooted);
    push('boot.problems', d.boot.problems);
  }
  push('canvasCount', d.canvases);
  return lines.join('\n');
}

let installed = null;

/**
 * Install the on-phone panel. Only the small 🛠 launcher button is created
 * eagerly, and ONLY when the URL asks for it (?diag=1 / #diag) — normal
 * players never see anything. The panel itself is built on first open and
 * refreshes every second while open.
 *
 * @param {object} deps { game, fullscreen } (from main.js)
 * @returns {{ refresh:()=>void, uninstall:()=>void }}
 */
export function installDiagnostics(deps = {}) {
  if (installed) return installed;
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  if (!doc || !win) return { refresh: () => {}, uninstall: () => {} };

  const wanted = /[?&#]diag(=1)?\b/.test(win.location.search + win.location.hash);
  if (!wanted) return { refresh: () => {}, uninstall: () => {} };

  const button = doc.createElement('button');
  button.type = 'button';
  button.id = 'wb-diag-button';
  button.setAttribute('aria-label', 'Word Blast diagnostics');
  button.textContent = '🛠';
  doc.body.appendChild(button);

  let panel = null;
  let timer = null;
  let renderFn = null;

  const close = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (panel) { panel.remove(); panel = null; }
    renderFn = null;
  };

  const copy = async (ev) => {
    const text = diagnosticsToText(collectDiagnostics(deps));
    let ok = false;
    try {
      if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
        await win.navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) { /* fall through to the legacy path */ }
    if (!ok) {
      // iOS Safari fallback: select a temporary textarea + execCommand —
      // still inside the user gesture.
      const ta = doc.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      doc.body.appendChild(ta);
      ta.focus(); ta.select();
      try { ok = doc.execCommand('copy'); } catch (e) { /* nothing more to try */ }
      ta.remove();
    }
    const btn = ev && ev.target ? ev.target : null;
    if (btn) {
      const old = btn.textContent;
      btn.textContent = ok ? 'COPIED ✓' : 'COPY FAILED';
      setTimeout(() => { btn.textContent = old; }, 1600);
    }
  };

  const open = () => {
    close();
    panel = doc.createElement('div');
    panel.id = 'wb-diag-panel';

    const head = doc.createElement('div');
    head.className = 'wb-diag-head';
    const title = doc.createElement('span');
    title.textContent = 'WORD BLAST DIAGNOSTICS';
    const btns = doc.createElement('span');
    const copyBtn = doc.createElement('button');
    copyBtn.type = 'button'; copyBtn.textContent = 'COPY';
    copyBtn.addEventListener('click', copy);
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button'; closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', close);
    btns.append(copyBtn, closeBtn);
    head.append(title, btns);

    const body = doc.createElement('pre');
    body.className = 'wb-diag-body';
    renderFn = () => { body.textContent = diagnosticsToText(collectDiagnostics(deps)); };
    renderFn();
    panel.append(head, body);
    doc.body.appendChild(panel);
    timer = setInterval(renderFn, 1000);
  };

  button.addEventListener('click', open);

  installed = {
    refresh: () => { if (renderFn) renderFn(); },
    collect: () => collectDiagnostics(deps),
    uninstall: () => {
      close();
      button.remove();
      installed = null;
    }
  };
  return installed;
}
