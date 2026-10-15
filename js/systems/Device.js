/**
 * Device detection & layout selection.
 * Chooses desktop / tablet / mobile from real signals (pointer type,
 * touch points, viewport, aspect) — user-agent is only a tiebreaker for
 * the ambiguous size band, never the primary signal.
 *
 * Pure module — safe to unit test in Node by injecting an environment.
 */

export const DEVICE_TYPES = {
  DESKTOP: 'desktop',
  TABLET: 'tablet',
  MOBILE: 'mobile'
};

/** Test-only orientation override ('portrait' | 'landscape' | null). */
let orientationOverride = null;

/** Test-only device-type override ('desktop' | 'tablet' | 'mobile' | null). */
let typeOverride = null;

export function setOrientationOverride(value) {
  orientationOverride = value;
}

export function setTypeOverride(value) {
  typeOverride = value;
}

function readEnv(env) {
  if (env && env.viewport) return env;
  const hasWindow = typeof window !== 'undefined';
  const coarse = hasWindow && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
  return {
    viewport: hasWindow
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 1280, h: 720 },
    coarse,
    maxTouchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
  };
}

/**
 * @param {object} [env] {viewport:{w,h}, coarse, maxTouchPoints, userAgent}
 * @returns {{type:string, hasTouch:boolean, portrait:boolean, viewport:{w,h}, aspect:number}}
 */
export function deviceInfo(env) {
  const e = readEnv(env);
  const { w, h } = e.viewport;
  const min = Math.min(w, h);
  const max = Math.max(w, h);
  const ua = e.userAgent || '';

  const hasTouch = !!(e.coarse || (e.maxTouchPoints && e.maxTouchPoints > 0)
    || /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua));

  let type;
  if (!hasTouch) {
    // No touch capability -> desktop, no matter how small the window is.
    type = DEVICE_TYPES.DESKTOP;
  } else if (max >= 1366 && min >= 900) {
    type = DEVICE_TYPES.TABLET;
  } else if (max < 900) {
    type = DEVICE_TYPES.MOBILE;
  } else {
    // Ambiguous 900–1366 band: refine with platform hints.
    const iPadOS = /iPad/.test(ua) || (ua.includes('Macintosh') && e.maxTouchPoints > 1);
    if (iPadOS) type = DEVICE_TYPES.TABLET;
    else if (/Android/.test(ua) && !/Mobile/.test(ua)) type = DEVICE_TYPES.TABLET;
    else if (/iPhone|iPod|Mobile/.test(ua)) type = DEVICE_TYPES.MOBILE;
    else type = min >= 600 ? DEVICE_TYPES.TABLET : DEVICE_TYPES.MOBILE;
  }

  const realPortrait = h > w;
  const portrait = orientationOverride === 'portrait' ? true
    : orientationOverride === 'landscape' ? false
      : realPortrait;

  return { type: typeOverride || type, hasTouch, portrait, viewport: { w, h }, aspect: +(max / min).toFixed(3) };
}

/**
 * Phones must play in landscape; tablets are nudged but not forced.
 * @returns {boolean} true when the rotate-device overlay must show.
 */
export function requiresLandscape(info = deviceInfo()) {
  return info.type === DEVICE_TYPES.MOBILE && info.portrait;
}
