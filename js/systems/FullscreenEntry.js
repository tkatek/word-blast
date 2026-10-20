/**
 * FullscreenEntry — the mobile-landscape fullscreen PROMPT (DOM layer).
 *
 * Presentation contract (see FullscreenController for the state machine):
 *
 *   phone + landscape + boot finished + API available
 *       → centered wooden card:  ⛶ PLAY FULLSCREEN  (+ "Play with more
 *         screen space.") and a "Not now" link that keeps the game running.
 *       After dismissal (or after the player exits fullscreen) the card
 *       never blocks again — a small corner chip keeps the control
 *         AVAILABLE without covering gameplay.
 *
 *   phone + landscape + UNSUPPORTED (iPhone Safari & un-permitted iframes)
 *       → once per session: "Add to Home Screen" guidance card + CONTINUE
 *         PLAYING. No fullscreen button is ever shown (a broken-looking
 *         button is worse than none); the game stays fully playable in
 *         normal landscape. Never re-prompts after dismissal.
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
 *   booted:boolean, mobile:boolean, landscape:boolean, standalone:boolean,
 *   state:string, cardDismissed:boolean, hintDismissed:boolean
 * }
 * @returns {'card'|'hint'|'chip'|null}
 */
export function computeEntryMode(c) {
  if (!c.booted || !c.mobile || !c.landscape || c.standalone) return null;
  switch (c.state) {
    case FULLSCREEN_STATES.STANDALONE:
      return null;
    case FULLSCREEN_STATES.ACTIVE:
      return null;
    case FULLSCREEN_STATES.UNSUPPORTED:
      return c.hintDismissed ? null : 'hint';
    case FULLSCREEN_STATES.REQUESTING:
      return c.cardDismissed ? 'chip' : 'card';
    case FULLSCREEN_STATES.DENIED:
    case FULLSCREEN_STATES.AVAILABLE:
    default:
      return c.cardDismissed ? 'chip' : 'card';
  }
}

/** iOS vs Android copy for the Add-to-Home-Screen steps (cosmetic only). */
export function a2hsSteps(isApple) {
  return isApple
    ? [
      'Tap the <b>Share</b> button <svg viewBox="0 0 24 24" width="15" height="15" style="vertical-align:-2px"><path d="M12 3v11M8l4-4 4 4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> in Safari',
      'Choose <b>Add to Home Screen</b>',
      'Open WORD BLAST from your Home Screen — no address bar'
    ]
    : [
      'Open the browser <b>⋮ menu</b>',
      'Choose <b>Install app</b> / <b>Add to Home screen</b>',
      'Open WORD BLAST from your Home Screen — full screen'
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
    const info = deviceInfo();
    const mode = computeEntryMode({
      booted: state.booted,
      mobile: info.type === DEVICE_TYPES.MOBILE,
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

    // compact corner chip — available (never blocking) after dismissal
    const chipVisible = mode === 'chip';
    if (chipVisible) {
      const busy = controller.state === FULLSCREEN_STATES.REQUESTING;
      chip.disabled = busy;
      chip.querySelector('.fs-chip-label').textContent = busy ? '\u2699\uFE0F' : '\u26F6';
      chip.setAttribute('aria-label', busy ? 'Entering fullscreen' : 'Play fullscreen');
    }
    chip.classList.toggle('is-visible', chipVisible);
  };

  /* ---- interactions (each exactly one listener) ---- */

  els.playBtn?.addEventListener('click', async () => {
    // The controller guards double requests (REQUESTING state) itself.
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

  chip.addEventListener('click', async () => {
    await controller.enter(doc.documentElement);
    apply();
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

  /* ---- reactive wiring (single set of listeners, rAF-coalesced) ---- */

  let raf = 0;
  const schedule = () => {
    if (!raf) raf = win.requestAnimationFrame(apply);
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
      if (raf) win.cancelAnimationFrame(raf);
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
