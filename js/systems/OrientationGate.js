/**
 * Orientation gate (Fix #2): phones must play in LANDSCAPE.
 *
 * A single fullscreen DOM overlay ("Rotate Your Phone") covering the canvas
 * whenever a phone is held in portrait — on EVERY scene (menu, level select,
 * gameplay), because a player can rotate at any time. While it is shown the
 * canvas receives no input (the overlay sits on top and swallows touches).
 *
 * The gameplay-side freeze (physics, timers, shooting disabled, progress
 * kept) is handled by GameScene.updateOrientationState — this gate is the
 * always-on visual layer, independent of scene lifecycles.
 *
 * Node-safe: no-ops without a DOM (headless tests never see it).
 */
import { requiresLandscape } from './Device.js';

let active = null;

/** Show/hide the overlay for the current orientation (cheap, idempotent). */
export function refreshOrientationGate() {
  if (!active) return;
  active.update();
}

/**
 * Install the gate. Call once from main.js after the DOM exists.
 * @returns {()=>void} uninstall function (tests only; app-lifetime otherwise)
 */
export function installOrientationGate() {
  if (active) return active.uninstall;
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  const el = doc ? doc.getElementById('rotate-overlay') : null;
  if (!doc || !win || !el) return () => {};

  let raf = 0;
  const update = () => {
    raf = 0;
    el.classList.toggle('is-visible', requiresLandscape());
  };
  const schedule = () => {
    if (!raf) raf = win.requestAnimationFrame(update);
  };

  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);

  active = {
    update: () => {
      if (raf) win.cancelAnimationFrame(raf);
      update();
    },
    uninstall: () => {
      win.removeEventListener('resize', schedule);
      win.removeEventListener('orientationchange', schedule);
      if (raf) win.cancelAnimationFrame(raf);
      el.classList.remove('is-visible');
      active = null;
    }
  };

  update();
  return active.uninstall;
}
