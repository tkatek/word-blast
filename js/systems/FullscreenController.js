/**
 * FullscreenController — the single owner of the Fullscreen API (mobile
 * landscape experience).
 *
 * A small, reusable state machine around the (heavily prefixed) Fullscreen
 * API with honest capability detection:
 *
 *   AVAILABLE    API present & allowed, not fullscreen yet — the PLAY
 *                FULLSCREEN entry control may be offered.
 *   REQUESTING   a request() promise is in flight — controls disabled so a
 *                double-tap can never fire a second request.
 *   ACTIVE       document.fullscreenElement is truthy (verified, never
 *                assumed from a resolved promise alone).
 *   UNSUPPORTED  the API is missing or disallowed (iPhone Safari for HTML
 *                elements — verified: no element fullscreen through iOS 26,
 *                <video> only — or an iframe without allowfullscreen).
 *                NEVER show a fullscreen button; the Add-to-Home-Screen
 *                hint and normal landscape play are the fallback.
 *   DENIED       the browser rejected the last user-initiated request.
 *                Only a fresh user gesture may try again — nothing retries
 *                on its own.
 *   STANDALONE   launched from the home screen (installed web app) — the
 *                browser chrome is already gone; no fullscreen UI at all.
 *
 * The three DISPLAY MODES the app distinguishes (never conflated — a
 * full-viewport CSS layout is NOT native fullscreen, and a standalone app
 * does NOT need document.fullscreenElement):
 *   'native-fullscreen'  ACTIVE — a real Fullscreen API request succeeded
 *   'standalone'         launched as an installed web app
 *   'browser'            normal tab (with or without collapsed bars)
 *
 * Fullscreen state changes emit 'change' (newState, previousState) so the
 * entry overlay, the HUD exit control and the ViewportController can react.
 * The ViewportController listens to the DOM fullscreenchange events itself
 * and resizes the canvas — this controller never touches the canvas.
 *
 * The LAST fullscreen error (name + message, from fullscreenerror events
 * and request rejections) is kept in `lastError` for the on-device
 * diagnostics panel — a rejection is never conflated with "no API".
 *
 * Node-safe: constructed without a DOM it reports UNSUPPORTED and every
 * method is a safe no-op (headless tests import it freely).
 */

export const FULLSCREEN_STATES = {
  AVAILABLE: 'available',
  REQUESTING: 'requesting',
  ACTIVE: 'active',
  UNSUPPORTED: 'unsupported',
  DENIED: 'denied',
  STANDALONE: 'standalone'
};

/** Vendor-prefixed Fullscreen API surface of a document (probed once). */
export function probeFullscreenApi(doc) {
  if (!doc) return { vendor: 'none', request: null, exit: null, element: null, enabled: null };
  const d = doc.documentElement;
  if (typeof d.requestFullscreen === 'function' && 'fullscreenElement' in doc) {
    return {
      vendor: 'std',
      request: 'requestFullscreen',
      exit: 'exitFullscreen',
      element: 'fullscreenElement',
      enabled: 'fullscreenEnabled'
    };
  }
  if (typeof d.webkitRequestFullscreen === 'function' || typeof doc.webkitFullscreenElement !== 'undefined') {
    return {
      vendor: 'webkit',
      request: 'webkitRequestFullscreen',
      exit: 'webkitExitFullscreen',
      element: 'webkitFullscreenElement',
      enabled: 'webkitFullscreenEnabled'
    };
  }
  if (typeof d.msRequestFullscreen === 'function') {
    return {
      vendor: 'ms',
      request: 'msRequestFullscreen',
      exit: 'msExitFullscreen',
      element: 'msFullscreenElement',
      enabled: 'msFullscreenEnabled'
    };
  }
  return { vendor: 'none', request: null, exit: null, element: null, enabled: null };
}

/**
 * True when the page runs as an installed standalone web app (no browser
 * chrome to reclaim — fullscreen UI would be pointless).
 */
export function detectStandalone(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return false;
  if (w.matchMedia && typeof w.matchMedia === 'function') {
    try {
      if (w.matchMedia('(display-mode: standalone)').matches) return true;
      if (w.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (w.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (e) { /* ancient engines */ }
  }
  // iOS Safari pre-16.4 signal for home-screen web apps.
  return w.navigator && w.navigator.standalone === true;
}

/**
 * Honest "can this document go fullscreen?" answer.
 * @returns {{supported:boolean, reason:string, api:object}}
 *   reason: 'ok' | 'no-api' | 'disabled' (fullscreenEnabled === false —
 *   iframe without allowfullscreen, or a platform refusal like iPhone
 *   Safari's missing element API surface which reports as no-api).
 */
export function detectFullscreenSupport(win, doc) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const api = probeFullscreenApi(d);
  if (!w || !d || api.vendor === 'none') {
    return { supported: false, reason: 'no-api', api };
  }
  // Chrome/Firefox expose fullscreenEnabled === false inside iframes the
  // parent has not granted allowfullscreen to, and when a feature policy
  // blocks it. Safari (all) lacks the element API entirely → 'no-api'.
  if (api.enabled && d[api.enabled] === false) {
    return { supported: false, reason: 'disabled', api };
  }
  return { supported: true, reason: 'ok', api };
}

export const DISPLAY_MODES = {
  NATIVE_FULLSCREEN: 'native-fullscreen',
  STANDALONE: 'standalone',
  BROWSER: 'browser'
};

/** How long to wait for fullscreenchange after request() resolves (ms). */
const CHANGE_TIMEOUT_MS = 1600;

export class FullscreenController {
  /**
   * @param {object} [opts] { win, doc } — injectable for unit tests; both
   *   default to the live globals when present.
   */
  constructor(opts = {}) {
    this.win = opts.win || (typeof window !== 'undefined' ? window : null);
    this.doc = opts.doc || (typeof document !== 'undefined' ? document : null);
    this.support = detectFullscreenSupport(this.win, this.doc);
    this.standalone = detectStandalone(this.win);
    this._listeners = [];
    /** Last fullscreen failure: {name, message, ts} | null (diagnostics). */
    this.lastError = null;
    this._state = this.standalone
      ? FULLSCREEN_STATES.STANDALONE
      : (this.support.supported ? FULLSCREEN_STATES.AVAILABLE : FULLSCREEN_STATES.UNSUPPORTED);
    this._lockTriedForSession = 0;

    // Track real transitions through the DOM events (all vendor spellings)
    // — a resize/orientation storm must never duplicate these.
    if (this.win && this.doc) {
      this._onFsChange = () => this._syncFromDocument();
      for (const name of ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange']) {
        this.doc.addEventListener(name, this._onFsChange);
      }
      // A rejected request can also surface as fullscreenerror.
      this._onFsError = (event) => {
        this._recordError(event && event.type ? { name: 'FullscreenError', message: 'document fullscreenerror event (' + event.type + ')' } : event);
        if (this._state === FULLSCREEN_STATES.REQUESTING) this._set(FULLSCREEN_STATES.DENIED);
      };
      for (const name of ['fullscreenerror', 'webkitfullscreenerror']) {
        this.doc.addEventListener(name, this._onFsError);
      }
      // Launch-mode changes (e.g. display-mode flips when an installed app
      // starts): re-classify instead of trusting the boot-time snapshot.
      if (typeof this.win.matchMedia === 'function') {
        this._displayQuery = this.win.matchMedia('(display-mode: standalone)');
        this._onDisplayMode = () => this.refresh();
        const dq = this._displayQuery;
        if (dq && typeof dq.addEventListener === 'function') dq.addEventListener('change', this._onDisplayMode);
        else if (dq && typeof dq.addListener === 'function') dq.addListener(this._onDisplayMode);
      }
    }
  }

  /**
   * The display mode the app is running in — one of DISPLAY_MODES. This is
   * the authoritative mode signal for UI decisions (a full-viewport CSS
   * layout must never be reported as native fullscreen).
   */
  get displayMode() {
    if (this._state === FULLSCREEN_STATES.STANDALONE) return DISPLAY_MODES.STANDALONE;
    if (this._state === FULLSCREEN_STATES.ACTIVE) return DISPLAY_MODES.NATIVE_FULLSCREEN;
    return DISPLAY_MODES.BROWSER;
  }

  /** Remember a fullscreen failure for the diagnostics panel. */
  _recordError(err) {
    const name = (err && (err.name || err.type)) || 'FullscreenError';
    const message = (err && err.message) || 'fullscreen request failed';
    this.lastError = { name: String(name), message: String(message), ts: Date.now() };
  }

  get state() {
    return this._state;
  }

  /** Convenience predicates for UI gating. */
  get isFullscreen() {
    return this._state === FULLSCREEN_STATES.ACTIVE;
  }

  get canEnter() {
    return this._state === FULLSCREEN_STATES.AVAILABLE || this._state === FULLSCREEN_STATES.DENIED;
  }

  /** Subscribe to state transitions. Returns an unsubscribe function. */
  onChange(cb) {
    if (typeof cb === 'function') this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((f) => f !== cb);
    };
  }

  _set(next) {
    if (next === this._state) return;
    const prev = this._state;
    this._state = next;
    for (const cb of this._listeners.slice()) {
      try { cb(next, prev); } catch (e) { /* a UI listener must never break the machine */ }
    }
  }

  /** Live fullscreen element (vendor-aware) or null. */
  fullscreenElement() {
    const d = this.doc;
    if (!d || this.support.api.vendor === 'none') return null;
    return d[this.support.api.element] || null;
  }

  _syncFromDocument() {
    if (this.standalone) { this._set(FULLSCREEN_STATES.STANDALONE); return; }
    const active = !!this.fullscreenElement();
    if (active) {
      this._set(FULLSCREEN_STATES.ACTIVE);
    } else {
      // Exited (user gesture, browser UI, or ESC) → the API still works, so
      // the entry control becomes available again.
      this._set(this.support.supported ? FULLSCREEN_STATES.AVAILABLE : FULLSCREEN_STATES.UNSUPPORTED);
    }
  }

  /**
   * Wait until the document reports a fullscreen element (or not). Browsers
   * set fullscreenElement either before or shortly after request()
   * resolves; we never trust the promise alone.
   */
  _waitForElement(wantActive, timeoutMs = CHANGE_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (!!this.fullscreenElement() === wantActive) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  /**
   * User-gesture-driven fullscreen request for the game shell.
   * Resolves with the FINAL state (ACTIVE on success, DENIED/UNSUPPORTED on
   * failure) — never throws, never retries by itself.
   *
   * @param {HTMLElement} [element] defaults to document.documentElement
   * @param {object} [opts] { lockOrientation: 'landscape' | null } — locked
   *   after a SUCCESSFUL entry where the platform allows it (silently
   *   skipped everywhere else; iOS has no lock API at all).
   */
  async enter(element, opts = {}) {
    if (!this.support.supported) return this._state;             // UNSUPPORTED/STANDALONE
    if (this._state === FULLSCREEN_STATES.STANDALONE) return this._state;
    if (this._state === FULLSCREEN_STATES.ACTIVE) return this._state;
    if (this._state === FULLSCREEN_STATES.REQUESTING) return this._state;

    const el = element || (this.doc && this.doc.documentElement);
    if (!el || !this.doc) return this._state;

    const api = this.support.api;
    const request = el[api.request];
    if (typeof request !== 'function') {
      this.support = detectFullscreenSupport(this.win, this.doc);
      this._set(this.support.supported ? FULLSCREEN_STATES.AVAILABLE : FULLSCREEN_STATES.UNSUPPORTED);
      return this._state;
    }

    this._set(FULLSCREEN_STATES.REQUESTING);
    try {
      await request.call(el);
    } catch (err) {
      this._recordError(err); // rejected promise — keep name+message for diagnostics
      await this._waitForElement(true, 250); // some engines resolve late
      if (!this.fullscreenElement()) {
        this._set(FULLSCREEN_STATES.DENIED);
        return this._state;
      }
    }
    // Verify the REAL outcome — the resolved promise is not proof.
    const reached = await this._waitForElement(true);
    if (!this.fullscreenElement()) {
      // Promise resolved but the document never entered fullscreen: record
      // it distinctly from an outright rejection (diagnostics tell them
      // apart; both fall back to playable landscape browser mode).
      if (!this.lastError) {
        this._recordError({ name: 'TimeoutError', message: 'request resolved but fullscreenElement never appeared' });
      }
      this._set(FULLSCREEN_STATES.DENIED);
      return this._state;
    }
    this.lastError = null; // success clears the last failure
    this._set(FULLSCREEN_STATES.ACTIVE);
    await this._tryLockOrientation(opts.lockOrientation === undefined ? 'landscape' : opts.lockOrientation);
    return this._state;
  }

  /** Orientation lock — best effort, only inside fullscreen, never fatal. */
  async _tryLockOrientation(mode) {
    if (!mode) return;
    const scr = this.win && this.win.screen;
    const orientation = scr && scr.orientation;
    if (!orientation || typeof orientation.lock !== 'function') return;
    try {
      await orientation.lock(mode);
    } catch (e) { /* unsupported on iOS, may be rejected on desktop — fine */ }
  }

  /** Leave fullscreen (HUD exit control / browser ESC both land here or in
   *  the DOM event). Safe when not fullscreen. */
  async exit() {
    if (!this.support.supported || !this.doc) return this._state;
    if (this._state !== FULLSCREEN_STATES.ACTIVE && this._state !== FULLSCREEN_STATES.REQUESTING) {
      return this._state;
    }
    const api = this.support.api;
    const exit = this.doc[api.exit];
    if (typeof exit !== 'function') return this._state;
    try {
      await exit.call(this.doc);
    } catch (e) { /* browser already exited */ }
    await this._waitForElement(false, 800);
    this._syncFromDocument();
    return this._state;
  }

  /** Test/debug + re-probe hook (e.g. after an iframe permission change). */
  refresh() {
    this.support = detectFullscreenSupport(this.win, this.doc);
    this.standalone = detectStandalone(this.win);
    this._syncFromDocument();
    return this._state;
  }

  destroy() {
    if (this.doc && this._onFsChange) {
      for (const name of ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange']) {
        this.doc.removeEventListener(name, this._onFsChange);
      }
    }
    if (this.doc && this._onFsError) {
      for (const name of ['fullscreenerror', 'webkitfullscreenerror']) {
        this.doc.removeEventListener(name, this._onFsError);
      }
    }
    if (this._displayQuery && this._onDisplayMode) {
      const dq = this._displayQuery;
      if (typeof dq.removeEventListener === 'function') dq.removeEventListener('change', this._onDisplayMode);
      else if (typeof dq.removeListener === 'function') dq.removeListener('change', this._onDisplayMode);
      this._displayQuery = null;
    }
    this._listeners = [];
  }
}
