/**
 * FullscreenEntry — the mobile-landscape fullscreen PROMPT (DOM layer).
 *
 * Presentation contract (see FullscreenController for the state machine):
 *
 *   phone/tablet + landscape + boot finished + API available
 *       → centered wooden card:  ⛶ PLAY FULLSCREEN  (+ "Play with more
 *         screen space.") and a "Not now" link that keeps the game running.
 *       After dismissal (or after the player exits fullscreen) the card
 *         never blocks again — a small corner chip keeps the control
 *         AVAILABLE without covering gameplay.
 *
 *   phone + landscape + UNSUPPORTED (iPhone Safari & un-permitted iframes)
 *       → once per session: "Play without the address bar" card with the
 *         FULL Add-to-Home-Screen instructions + CONTINUE IN BROWSER. The
 *         game stays fully playable in normal landscape. After dismissal a
 *         compact corner chip can RE-OPEN the instructions (it never
 *         auto-prompts and never blocks) — the install route must stay
 *         findable, just not nagging.
 *
 *   standalone (installed web app) / desktop / portrait
 *       → nothing. Portrait is the rotate-gate's job (z-index above this).
 *
 * The card/chip are plain DOM above the canvas: taps on them never reach
 * Phaser input, and hiding the card reveals the untouched game — no pause,
 * no restart, no state change. Entering fullscreen only resizes the canvas
 * (ViewportController listens to the same fullscreenchange events).
 *
 * Pure decision logic lives in computeEntryMode() so it is unit-testable
 * in Node; everything DOM is guarded and no-ops headless.
 */
import { deviceInfo, DEVICE_TYPES } from './Device.js';
import { FULLSCREEN_STATES } from './FullscreenController.js';

/**
 * Pure: what should be on screen right now?
 * @param {object} c {
 *   booted:boolean, mobile:boolean, tablet:boolean, landscape:boolean,
 *   standalone:boolean, state:string, cardDismissed:boolean,
 *   hintDismissed:boolean
 * }
 * @returns {'card'|'hint'|'chip'|'hintchip'|null}
 *   'card'     blocking PLAY FULLSCREEN card (API available)
 *   'hint'     blocking install-instructions card (API unavailable)
 *   'chip'     compact ⛶ corner chip re-offering native fullscreen
 *   'hintchip' compact corner chip re-opening the install instructions
 */
export function computeEntryMode(c) {
  if (!c.booted || !c.landscape || c.standalone) return null;
  // Phones always; coarse-pointer tablets (real iPads) too — they have the
  // same browser-chrome problem and DO support element fullscreen. Fine-
  // pointer "tablets" (touch-screen laptops) are desktops: no prompt.
  if (!(c.mobile || c.tablet)) return null;
  switch (c.state) {
    case FULLSCREEN_STATES.STANDALONE:
      return null;
    case FULLSCREEN_STATES.ACTIVE:
      return null;
    case FULLSCREEN_STATES.UNSUPPORTED:
      return c.hintDismissed ? 'hintchip' : 'hint';
    case FULLSCREEN_STATES.REQUESTING:
      return c.cardDismissed ? 'chip' : 'card';
    case FULLSCREEN_STATES.DENIED:
    case FULLSCREEN_STATES.AVAILABLE:
    default:
      return c.cardDismissed ? 'chip' : 'card';
  }
}

/**
 * Install-instructions copy (cosmetic, platform-specific). The iOS steps
 * match what a real iPhone shows: in landscape Safari the Share button
 * lives inside the page menu, and recent iOS offers an "Open as Web App"
 * toggle in the Add dialog. JavaScript cannot install the app or hide the
 * address bar — these steps honestly describe the manual route.
 */
export function a2hsSteps(isApple) {
  return isApple
    ? [
      'Open WORD BLAST in <b>Safari</b>',
      'Tap <b>Share</b> \u2014 in landscape it\u2019s inside the page menu (the <b>aA</b> / sidebar button)',
      'Choose <b>Add to Home Screen</b>',
      'Keep <b>Open as Web App</b> on, if that option is shown',
      'Tap <b>Add</b>',
      'Launch WORD BLAST from the Home Screen \u2014 no address bar',
      'Turn the phone <b>sideways</b> to play'
    ]
    : [
      'Open the browser <b>\u22EE menu</b>',
      'Choose <b>Install app</b> / <b>Add to Home screen</b>',
      'Confirm \u2014 the game installs like a native app',
      'Open WORD BLAST from your Home Screen \u2014 full screen'
    ];
}

let instance = null;

/**
 * Install the entry UI (once). Call from main.js after the controller
 * exists; it waits for the Phaser game to be READY before anything can
 * appear (fullscreen controls must never show over a failed boot).
 *
 * @param {Phaser.Game} game
 * @param {FullscreenController} controller
 * @returns {object} { refresh, uninstall } (app-lifetime; tests may uninstall)
 */
export function installFullscreenEntry(game, controller) {
  if (instance) return instance;
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  const card = doc ? doc.getElementById('fs-entry') : null;
  const chip = doc ? doc.getElementById('fs-chip') : null;
  if (!doc || !win || !card || !chip || !controller) {
    return { refresh: () => {}, uninstall: () => {} };
  }

  const els = {
    card,
    scrim: card.querySelector('.fs-scrim'),
    variantPlay: card.querySelector('[data-variant="play"]'),
    variantHint: card.querySelector('[data-variant="hint"]'),
    playBtn: card.querySelector('.fs-btn-play'),
    playLabel: card.querySelector('.fs-btn-play .fs-btn-label'),
    playNote: card.querySelector('.fs-play-note'),
    dismissLink: card.querySelector('.fs-dismiss'),
    hintList: card.querySelector('.fs-hint-steps'),
    hintBtn: card.querySelector('.fs-btn-continue')
  };

  const state = {
    booted: false,
    cardDismissed: false,
    hintDismissed: false,
    mode: null
  };

  const isAppleLike = () => {
    const ua = (win.navigator && win.navigator.userAgent) || '';
    return /iPhone|iPad|iPod/i.test(ua);
  };

  const renderHint = () => {
    if (!els.variantHint || !els.hintList) return;
    els.hintList.innerHTML = '';
    for (const step of a2hsSteps(isAppleLike())) {
      const li = doc.createElement('li');
      li.innerHTML = step;
      els.hintList.appendChild(li);
    }
  };

  /** Apply the computed mode to the DOM (idempotent, cheap). */
  const apply = () => {
    raf = 0; // re-arm the debouncer — without this every later update is dropped
    const info = deviceInfo();
    // Coarse-pointer tablets (real iPads) get the same entry UI as phones;
    // fine-pointer touch devices (touch laptops) are desktops.
    const coarseTablet = info.type === DEVICE_TYPES.TABLET && !!info.hasTouch
      && typeof win.matchMedia === 'function'
      && win.matchMedia('(pointer: coarse)').matches;
    const mode = computeEntryMode({
      booted: state.booted,
      mobile: info.type === DEVICE_TYPES.MOBILE,
      tablet: coarseTablet,
      landscape: !info.portrait,
      standalone: controller.standalone || controller.state === FULLSCREEN_STATES.STANDALONE,
      state: controller.state,
      cardDismissed: state.cardDismissed,
      hintDismissed: state.hintDismissed
    });
    state.mode = mode;

    if (mode === 'card' || mode === 'hint') {
      const unsupported = mode === 'hint'
        || controller.state === FULLSCREEN_STATES.UNSUPPORTED;
      if (els.variantPlay) els.variantPlay.style.display = unsupported ? 'none' : '';
      if (els.variantHint) els.variantHint.style.display = unsupported ? '' : 'none';
      if (unsupported) renderHint();
      if (els.playBtn) {
        const busy = controller.state === FULLSCREEN_STATES.REQUESTING;
        els.playBtn.disabled = busy;
        els.playBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (els.playLabel) {
          els.playLabel.textContent = busy ? 'ENTERING\u2026' : 'PLAY FULLSCREEN';
        }
      }
      if (els.playNote) {
        els.playNote.textContent = controller.state === FULLSCREEN_STATES.DENIED
          ? 'The browser blocked fullscreen \u2014 you can retry or keep playing.'
          : 'Play with more screen space.';
      }
      card.classList.add('is-visible');
      card.setAttribute('aria-hidden', 'false');
    } else {
      card.classList.remove('is-visible');
      card.setAttribute('aria-hidden', 'true');
    }

    // compact corner chip — available (never blocking) after dismissal.
    // 'chip' re-offers native fullscreen; 'hintchip' re-opens the install
    // instructions (iPhone: the install route must stay reachable without
    // ever auto-prompting again).
    const chipVisible = mode === 'chip' || mode === 'hintchip';
    if (chipVisible) {
      const install = mode === 'hintchip';
      const busy = controller.state === FULLSCREEN_STATES.REQUESTING;
      chip.disabled = busy;
      const label = chip.querySelector('.fs-chip-label');
      if (label) label.textContent = busy ? '\u2699\uFE0F' : (install ? '\u2313 INSTALL' : '\u26F6');
      chip.setAttribute('aria-label', busy ? 'Entering fullscreen'
        : (install ? 'How to install Word Blast' : 'Play fullscreen'));
    }
    chip.classList.toggle('is-visible', chipVisible);
  };

  /* ---- interactions (each exactly one listener) ---- */

  els.playBtn?.addEventListener('click', async () => {
    // The controller guards double requests (REQUESTING state) itself.
    // Direct call inside the genuine gesture — no awaits before the request.
    await controller.enter(doc.documentElement);
    apply();
  });

  els.dismissLink?.addEventListener('click', (e) => {
    e.preventDefault();
    state.cardDismissed = true;
    apply();
  });

  els.hintBtn?.addEventListener('click', () => {
    state.hintDismissed = true;
    apply();
  });

  chip.addEventListener('click', () => {
    if (controller.state === FULLSCREEN_STATES.UNSUPPORTED) {
      // Install-route chip: RE-OPEN the instructions (never a request the
      // browser would only reject).
      state.hintDismissed = false;
      apply();
      return;
    }
    controller.enter(doc.documentElement).then(apply);
  });

  // Tapping the scrim = keep playing (same as "Not now"), NOT a fullscreen
  // request — requests must come from an explicit button tap.
  els.scrim?.addEventListener('click', () => {
    if (controller.state === FULLSCREEN_STATES.UNSUPPORTED) {
      state.hintDismissed = true;
    } else {
      state.cardDismissed = true;
    }
    apply();
  });

  /* ---- reactive wiring (single set of listeners, coalesced) ---- */

  // Timeout-coalesced (NOT rAF): rAF callbacks can stall while the document
  // is fullscreen/occluded — the prompt must still update then.
  let raf = 0;
  const schedule = () => {
    if (!raf) raf = win.setTimeout(apply, 60);
  };
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);
  const offController = controller.onChange(schedule);

  // Fullscreen exited (ESC / browser UI / pause-menu button): the entry
  // control becomes available again — as the unobtrusive chip, never the
  // blocking card (the player just deliberately left fullscreen).
  const offExit = controller.onChange((next, prev) => {
    if (prev === FULLSCREEN_STATES.ACTIVE && next !== FULLSCREEN_STATES.ACTIVE) {
      state.cardDismissed = true;
    }
    schedule();
  });

  // Boot gate: nothing fullscreen-related may appear until Phaser really
  // initialized (the index.html watchdog owns the failure case).
  const markBooted = () => {
    state.booted = true;
    schedule();
  };
  if (game && game.events) {
    if (game.isBooted) markBooted();
    else game.events.once('ready', markBooted);
  } else {
    markBooted();
  }

  apply();

  instance = {
    refresh: apply,
    get mode() { return state.mode; },
    uninstall: () => {
      win.removeEventListener('resize', schedule);
      win.removeEventListener('orientationchange', schedule);
      if (raf) win.clearTimeout(raf);
      offController();
      offExit();
      card.classList.remove('is-visible');
      chip.classList.remove('is-visible');
      instance = null;
    }
  };
  return instance;
}

/** Test/debug hook: current prompt mode ('card' | 'hint' | 'chip' | null). */
export function fullscreenEntryMode() {
  return instance ? instance.mode : null;
}
