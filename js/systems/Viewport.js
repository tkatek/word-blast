/**
 * Responsive viewport system (Fix #2).
 *
 * Strategy — "fit world, extend scenery":
 *   - The Phaser canvas fills the whole browser viewport (100% × 100% CSS,
 *     buffer sized by the device pixel ratio, capped for GPU memory).
 *   - Scale mode is NONE: the ViewportController is the single owner of the
 *     canvas buffer size. It reads the REAL visible viewport
 *     (visualViewport-aware, toolbar/notch safe) and calls
 *     game.scale.resize(cssW·dpr, cssH·dpr) — one code path for desktop
 *     window resizes, fullscreen enter/exit, and mobile rotation.
 *   - Every scene frames the fixed 1280×720 logical world with a camera
 *     zoom = min(bufferW/1280, bufferH/720) centered on the world. The whole
 *     gameplay region is therefore ALWAYS fully visible on every aspect
 *     ratio (never cropped, never distorted) — wider/taller screens simply
 *     see more decorative scenery around it (BackgroundManager.extendTo).
 *   - Physics, trajectories and input run in world space: zoom and buffer
 *     size are pure presentation. Resizing can never change bird speed,
 *     gravity, launch angle or collision behaviour.
 *
 * This module must stay importable from Node (unit tests) — no Phaser
 * import. Phaser event names are used as literals ('resize', 'ready').
 */
import { WORLD } from '../config.js';

/** Sharp but GPU-friendly: never render more than 2× physical pixels. */
export const DPR_CAP = 2;

/**
 * Below this (CSS px) a measured rect/viewport is a TRANSIENT value (iOS
 * rotation animations, toolbar transitions, display toggles) — resizing
 * the game to it would flash a sliver; instead we keep the last good size
 * and retry until dimensions stabilize.
 */
export const MIN_USABLE_PX = 60;

/**
 * Pure: pick the usable CSS size for the canvas.
 * @returns {{w:number, h:number, ok:boolean}} ok=false → every source is a
 *   transient/degenerate measurement — callers must NOT resize to it; they
 *   should keep the last good size and retry.
 */
export function usableCssSize(rectW, rectH, fallbackW, fallbackH) {
  const w = Math.round(rectW || 0);
  const h = Math.round(rectH || 0);
  if (w >= MIN_USABLE_PX && h >= MIN_USABLE_PX) return { w, h, ok: true };
  const fw = Math.round(fallbackW || 0);
  const fh = Math.round(fallbackH || 0);
  if (fw >= MIN_USABLE_PX && fh >= MIN_USABLE_PX) return { w: fw, h: fh, ok: true };
  return { w: Math.max(2, fw), h: Math.max(2, fh), ok: false };
}

/**
 * Pure: given the canvas buffer size, compute the camera zoom and the
 * visible world rectangle that shows the ENTIRE 1280×720 world.
 *
 * @param {number} bufferW canvas buffer width (css px × dpr)
 * @param {number} bufferH canvas buffer height
 * @returns {{zoom:number, x:number, y:number, width:number, height:number}}
 *          zoom — camera zoom so the world fits; x/y/width/height — the
 *          world-space rectangle the camera shows (always ⊇ the world).
 */
export function computeFitView(bufferW, bufferH) {
  if (!(bufferW > 0) || !(bufferH > 0)) {
    return { zoom: 1, x: 0, y: 0, width: WORLD.WIDTH, height: WORLD.HEIGHT };
  }
  const zoom = Math.min(bufferW / WORLD.WIDTH, bufferH / WORLD.HEIGHT);
  const width = bufferW / zoom;
  const height = bufferH / zoom;
  return {
    zoom,
    x: (WORLD.WIDTH - width) / 2,
    y: (WORLD.HEIGHT - height) / 2,
    width,
    height
  };
}

/** Effective device pixel ratio, clamped to [1, DPR_CAP]. */
export function effectiveDPR(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const raw = w && w.devicePixelRatio ? w.devicePixelRatio : 1;
  return Math.max(1, Math.min(DPR_CAP, raw));
}

/**
 * The actually visible viewport in CSS px. window.innerHeight lies on
 * mobile browsers with dynamic toolbars; visualViewport reports the real
 * visible area. Falls back to innerWidth/innerHeight where absent.
 */
export function visibleCssSize(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return { w: WORLD.WIDTH, h: WORLD.HEIGHT };
  const vv = w.visualViewport;
  const width = vv ? vv.width : w.innerWidth;
  const height = vv ? vv.height : w.innerHeight;
  return {
    w: Math.max(1, Math.round(width)),
    h: Math.max(1, Math.round(height))
  };
}

/* ------------------------------------------------------------------ */
/* Scene-side framing                                                  */
/* ------------------------------------------------------------------ */

/** Live fit view of a scene (works with or without attachViewport). */
export function currentView(scene) {
  if (scene && scene.__wbView) return scene.__wbView;
  if (!scene || !scene.scale) return computeFitView(WORLD.WIDTH, WORLD.HEIGHT);
  return computeFitView(scene.scale.gameSize.width, scene.scale.gameSize.height);
}

/**
 * Stretch a rectangle game object so it exactly covers the visible view —
 * used by menu backdrops so no letterbox bars appear on non-16:9 screens.
 * @param {Phaser.GameObjects.Rectangle} rect
 * @param {object} view visible world rectangle (computeFitView)
 */
export function coverView(rect, view) {
  if (!rect || !view) return rect;
  rect.setSize(view.width, view.height);
  rect.setPosition(view.x + view.width / 2, view.y + view.height / 2);
  return rect;
}

/**
 * Frame a scene's main camera on the whole logical world and keep it framed
 * across resizes. Registers exactly one listener on the (game-wide) scale
 * manager and removes it on scene shutdown — safe for scene restarts and
 * multiple simultaneous scenes (each handler touches only its own camera).
 *
 * @param {Phaser.Scene} scene
 * @param {(view:object)=>void} [onResize] called after every re-frame
 * @returns {{view:object, refresh:()=>void, detach:()=>void}}
 */
export function attachViewport(scene, onResize) {
  const apply = () => {
    const view = computeFitView(scene.scale.gameSize.width, scene.scale.gameSize.height);
    scene.__wbView = view;
    const cam = scene.cameras.main;
    cam.setZoom(view.zoom);
    cam.centerOn(WORLD.WIDTH / 2, WORLD.HEIGHT / 2);
    if (onResize) onResize(view);
    return view;
  };

  const onScaleResize = () => apply();
  const detach = () => scene.scale.off('resize', onScaleResize);
  scene.scale.on('resize', onScaleResize);
  scene.events.once('shutdown', detach);
  scene.events.once('destroy', detach);

  const view = apply();
  return { view, refresh: apply, detach };
}

/* ------------------------------------------------------------------ */
/* Game-level canvas sizing                                            */
/* ------------------------------------------------------------------ */

/**
 * Owns the canvas buffer size for the whole game (browser only; created in
 * main.js). Debounced so dragging a desktop window or animating mobile
 * toolbars never thrashes the GPU with per-frame buffer reallocs.
 */
export class ViewportController {
  /**
   * @param {Phaser.Game} game
   * @param {{onChange?:()=>void, debounceMs?:number}} [opts]
   */
  constructor(game, opts = {}) {
    this.game = game;
    this.onChange = opts.onChange || null;
    this.debounceMs = opts.debounceMs ?? 120;
    this.pending = false;
    this.lastW = 0;
    this.lastH = 0;

    this.schedule = () => this.scheduleApply();
    const win = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (!win || !doc) return; // headless/Node — scenes still frame via attachViewport

    win.addEventListener('resize', this.schedule);
    win.addEventListener('orientationchange', this.schedule);
    // All vendor spellings: the canvas must re-measure on every fullscreen
    // transition (enter AND exit), whatever the engine calls the event.
    for (const evt of ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange']) {
      doc.addEventListener(evt, this.schedule);
    }
    if (win.visualViewport) win.visualViewport.addEventListener('resize', this.schedule);

    // The canvas does not exist until the game boots — apply on READY and
    // also try immediately (covers the common case where boot already ran).
    game.events.once('ready', () => this.applyNow());
    this.applyNow();
  }

  scheduleApply(delayMs) {
    if (this.pending) return;
    this.pending = true;
    setTimeout(() => {
      this.pending = false;
      this.applyNow();
    }, delayMs ?? this.debounceMs);
  }

  /**
   * One outstanding settle check at a time (reschedules freely — the
   * newest deadline wins). Bounded by _settleDepth so a chain can never
   * loop forever: normal chains stop after 3 unchanged checks, degenerate
   * (transient/hidden) measurements retry at most 10 times.
   */
  _later(ms) {
    if (this._settleTimer) clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      this._settleDepth = (this._settleDepth || 0) + 1;
      this.applyNow(true);
    }, ms);
  }

  /** Resize the canvas buffer to the visible viewport × DPR (idempotent). */
  applyNow(fromSettle = false) {
    const scale = this.game.scale;
    if (!scale || !this.game.canvas) return; // not booted yet ('ready' retries)
    if (!fromSettle) this._settleDepth = 0;  // a real event restarts the chain
    const visible = visibleCssSize();

    // Transient/degenerate measurements (iOS rotation & toolbar animations,
    // a briefly hidden shell): NEVER resize the game to a temporary
    // near-zero value — keep the last good size and retry until stable.
    const first = usableCssSize(null, null, visible.w, visible.h);
    if (!first.ok) {
      if ((this._settleDepth || 0) < 10) {
        this._later(180 + (this._settleDepth || 0) * 120);
      }
      return;
    }

    // Shrink the fixed shell to the VISIBLE viewport when mobile toolbars
    // hide part of the layout viewport (visualViewport < innerHeight), so
    // the canvas CSS box always matches the buffer's CSS size — the bitmap
    // is never CSS-stretched and input scaling stays exact.
    const parent = scale.parent && scale.parent !== document.body ? scale.parent : null;
    if (parent) {
      // Write styles only when they change (avoid layout churn during the
      // resize/orientation event storm).
      const wpx = visible.w + 'px';
      const hpx = visible.h + 'px';
      if (parent.style.width !== wpx) parent.style.width = wpx;
      if (parent.style.height !== hpx) parent.style.height = hpx;
    }

    // Authoritative source: the canvas's own CSS box (parent minus
    // safe-area padding), re-measured AFTER the shell write so the buffer
    // always matches the exact final box; the visible viewport is the
    // fallback when the rect is still transient.
    const rect = this.game.canvas.getBoundingClientRect();
    const usable = usableCssSize(rect.width, rect.height, visible.w, visible.h);
    if (!usable.ok) {
      if ((this._settleDepth || 0) < 10) this._later(180);
      return;
    }

    const dpr = effectiveDPR();
    const bw = Math.max(2, Math.round(usable.w * dpr));
    const bh = Math.max(2, Math.round(usable.h * dpr));
    if (bw === this.lastW && bh === this.lastH) {
      // Stable — but an EVENT-triggered check can run before layout
      // catches up with visualViewport, and a just-applied change can be
      // superseded moments later: at most 3 short follow-up checks, then
      // the chain stops until the next real event.
      if (this._settleDepth === 0) this._later(300);
      else if (this._settleDepth < 3) this._later(650);
      return;
    }
    this.lastW = bw;
    this.lastH = bh;
    // Emits 'resize' → cameras/renderer follow, scenes re-frame themselves.
    scale.resize(bw, bh);
    if (this.onChange) this.onChange();
    // Mobile viewport sources (visualViewport vs innerWidth vs layout) can
    // disagree while toolbars animate or the window settles: follow up
    // shortly, then once more (bounded by the depth counter).
    this._settleDepth = 1;
    this._later(250);
  }

  /** Test/debug hook: force a re-read of the viewport. */
  refresh() {
    this.lastW = 0;
    this.lastH = 0;
    this.applyNow();
  }

  destroy() {
    const win = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (win) {
      win.removeEventListener('resize', this.schedule);
      win.removeEventListener('orientationchange', this.schedule);
      if (win.visualViewport) win.visualViewport.removeEventListener('resize', this.schedule);
    }
    if (doc) {
      for (const evt of ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange']) {
        doc.removeEventListener(evt, this.schedule);
      }
    }
    if (this._settleTimer) clearTimeout(this._settleTimer);
    this._settleDepth = 0;
    this.pending = false;
  }
}
