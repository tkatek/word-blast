/**
 * HudLayout — ONE pure calculation that returns every top-bar component's
 * position and size.
 *
 * Desktop/tablet rows are laid out across the FULL VISIBLE WORLD WIDTH —
 * the width of the camera's fit-view rectangle (systems/Viewport.js
 * computeFitView), which is ≥ 1280 and grows on aspect ratios wider than
 * 16:9. Returned x coordinates are relative to the visible view's LEFT
 * EDGE; the HUD anchors them into world space with view.x (GameHUD).
 * On a 16:9 screen (view = exactly the 1280×720 world) the coordinates ARE
 * world coordinates, so the row spans edge to edge there too.
 *
 *   desktop/tablet  [Pause] [LEVEL + title] [Q | clock MM:SS | ★★★] [♥♥♥] [bird ×N] [coin score] [Sound]
 *   phone           fixed 1280-wide row (unchanged by viewports): "LV n" chip,
 *                   single summary star, larger circular buttons with enlarged
 *                   touch hit-boxes (≥44 CSS px at phone zoom ≈ 0.52).
 *
 * Width distribution: the row keeps its measured-artwork panel sizes and
 * grows with the view only up to +15%; every remaining world pixel of width
 * is shared EQUALLY by the six inter-panel gaps, so margins and spacing
 * stay consistent while the bar always reaches both visible edges. The
 * modest uniform growth also keeps the HUD's on-screen size stable when
 * horizontal letterboxing lowers the camera zoom (browser chrome, etc.).
 *
 * All widths derive from each artwork's MEASURED aspect (HudArt) — panels
 * are never stretched. Module is Phaser-free and unit-tested in Node.
 */
import { HUD_ART } from './HudArt.js';
import { WORLD } from '../config.js';

const W = WORLD.WIDTH;

/**
 * Base display heights (world px at a 16:9 view) per device class.
 *
 * Final readability polish: the 1280-wide row is a zero-sum budget, so the
 * growth is spent where the player LOOKS — the center progress panel
 * (question · clock · stars) and the hearts/shots/score counters grow
 * ~10%, while the level plaque and the round buttons give the width back.
 * Typography scales with the panels (see `type` below) and was re-fitted
 * to each panel's measured inner window for the desktop readability pass.
 */
const SIZES = {
  desktop: {
    cy: 40, gap: 9, margins: 11,
    button: 60, soundButton: 54, hit: 60,
    level: 57, progress: 73, counter: 60
  },
  phone: {
    cy: 42, gap: 10, margins: 26,
    button: 66, soundButton: 58, hit: 94,
    level: 50, progress: 64, counter: 56
  }
};

/** Desktop row growth cap: wider views enlarge the bar at most this much. */
const WIDE_GROWTH_CAP = 1.15;

/**
 * @param {'desktop'|'tablet'|'mobile'} deviceType (Device.js DEVICE_TYPES)
 * @param {number} [viewWidth] visible world width (computeFitView().width,
 *        ≥ 1280). Phone rows ignore it (fixed layout). Defaults to the
 *        16:9 world width.
 * @returns {object} full layout: band bottom, per-element {x,y,w,h,hit}
 *          (x relative to the visible view's left edge), progress-panel
 *          compartment rects, typography sizes and flags.
 */
export function computeHudLayout(deviceType, viewWidth = WORLD.WIDTH) {
  const compact = deviceType === 'mobile';
  // the visible view is never narrower than the world (fit-view invariant)
  const vw = compact ? W : Math.max(W, viewWidth || 0);
  const k = compact ? 1 : Math.min(WIDE_GROWTH_CAP, vw / W);
  const S0 = compact ? SIZES.phone : SIZES.desktop;
  const S = {
    cy: S0.cy, gap: S0.gap, margins: S0.margins,
    button: S0.button * k, soundButton: S0.soundButton * k, hit: S0.hit * k,
    level: S0.level * k, progress: S0.progress * k, counter: S0.counter * k
  };
  const { cy } = S;

  const panel = (art, h) => ({ w: h * art.aspect, h });
  const level = panel(HUD_ART.level, S.level);
  const progress = panel(HUD_ART.progress, S.progress);
  const hearts = panel(HUD_ART.hearts, S.counter);
  const shots = panel(HUD_ART.shots, S.counter);
  const score = panel(HUD_ART.score, S.counter);

  // pack one row from the left margin; on views wider than the row the
  // leftover width is shared equally by the gaps (margins stay consistent)
  const widths = [S.button, level.w, progress.w, hearts.w, shots.w, score.w, S.soundButton];
  const rowW = widths.reduce((a, b) => a + b, 0);
  const slack = vw - rowW - 2 * S.margins - (widths.length - 1) * S.gap;
  // sub-pixel slack comes from aspect-ratio rounding, not a real overflow —
  // clamp it away instead of killing the boot; genuine overflows still throw
  if (slack < -1) throw new Error(`HUD row overflows: ${(-slack).toFixed(1)}px over`);
  const gap = S.gap + Math.max(0, slack) / (widths.length - 1);
  const margin = S.margins;

  const centers = [];
  let cursor = margin;
  for (const w of widths) {
    centers.push(cursor + w / 2);
    cursor += w + gap;
  }
  const [pauseX, levelX, progressX, heartsX, shotsX, scoreX, soundX] = centers;

  const timerCell = cellBox(HUD_ART.progress, 'timer', progressX, cy, progress);
  const qCell = cellBox(HUD_ART.progress, 'question', progressX, cy, progress);
  const starCell = cellBox(HUD_ART.progress, 'stars', progressX, cy, progress);

  return {
    mode: compact ? 'phone' : 'desktop',
    viewWidth: vw,
    cy,
    /** Lowest world-y the HUD artwork reaches (for docking). */
    bandBottom: Math.ceil(cy + Math.max(S.button, level.h, progress.h) / 2),
    rowLeft: margin,
    rowRight: vw - margin,
    elements: {
      pause: { x: pauseX, y: cy, w: S.button, h: S.button, hit: S.hit },
      sound: { x: soundX, y: cy, w: S.soundButton, h: S.soundButton, hit: S.hit },
      level: { x: levelX, y: cy, w: level.w, h: level.h },
      progress: { x: progressX, y: cy, w: progress.w, h: progress.h },
      hearts: { x: heartsX, y: cy, w: hearts.w, h: hearts.h },
      shots: { x: shotsX, y: cy, w: shots.w, h: shots.h },
      score: { x: scoreX, y: cy, w: score.w, h: score.h }
    },
    cells: { timer: timerCell, question: qCell, stars: starCell },
    // Desktop readability pass: every size re-fitted against the measured
    // inner windows (HudArt) with headroom verified up to the growth cap.
    // Phone typography is untouched.
    type: compact
      ? {
          levelMain: 21, levelTitle: 0, levelShort: true,
          timer: 22, timerIcon: 19, question: 15,
          hearts: 26, shotsIcon: 18, shots: 17, scoreIcon: 18, score: 17,
          stars: 20, starCount: 1
        }
      : {
          levelMain: 15 * k, levelTitle: 11 * k, levelShort: false,
          timer: 26 * k, timerIcon: 23 * k, question: 17 * k,
          hearts: 29 * k, shotsIcon: 20 * k, shots: 19 * k, scoreIcon: 20 * k, score: 19 * k,
          stars: 14 * k, starCount: 3
        }
  };
}

/** Absolute rect of one progress-panel compartment (relative to the row). */
function cellBox(art, name, x, y, box) {
  const c = art.cells[name];
  const i = art.inner;
  const pad = 0.008;
  const x0 = x - box.w / 2 + (c.x0 + pad) * box.w;
  const x1 = x - box.w / 2 + (c.x1 - pad) * box.w;
  const y0 = y - box.h / 2 + (i.y0 + 0.014) * box.h;
  const y1 = y + box.h / 2 - (1 - i.y1 + 0.014) * box.h;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, x0, x1, y0, y1 };
}
