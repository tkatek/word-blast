/**
 * HudLayout — ONE pure calculation that returns every top-bar component's
 * position and size (world px inside the fixed 1280×720 world).
 *
 * The Viewport always frames the whole world on every device, so the layout
 * never needs to move on resize; it is chosen once per scene from the device
 * class and keys every number the HUD renders with:
 *
 *   desktop/tablet  [Pause] [LEVEL + title] [Q | clock MM:SS | ★★★] [♥♥♥] [bird ×N] [coin score] [Sound]
 *   phone           same row, compact: "LV n" chip, single summary star,
 *                   larger circular buttons with enlarged touch hit-boxes
 *                   (≥44 CSS px at phone zoom ≈ 0.52).
 *
 * All widths derive from each artwork's MEASURED aspect (HudArt) — panels
 * are never stretched. Module is Phaser-free and unit-tested in Node.
 */
import { HUD_ART } from './HudArt.js';
import { WORLD } from '../config.js';

const W = WORLD.WIDTH;

/** Display heights (world px) per device class. */
const SIZES = {
  desktop: {
    cy: 40, gap: 10,
    button: 64, hit: 64,
    level: 66, progress: 66, counter: 54,
    margins: 24
  },
  phone: {
    cy: 42, gap: 14,
    button: 72, hit: 92,
    level: 52, progress: 60, counter: 54,
    margins: 40
  }
};

/**
 * @param {'desktop'|'tablet'|'mobile'} deviceType (Device.js DEVICE_TYPES)
 * @returns {object} full layout: band bottom, per-element {x,y,w,h,hit},
 *          progress-panel compartment rects, typography sizes and flags.
 */
export function computeHudLayout(deviceType) {
  const compact = deviceType === 'mobile';
  const S = compact ? SIZES.phone : SIZES.desktop;
  const { cy, gap } = S;

  const panel = (art, h) => ({ w: h * art.aspect, h });
  const level = panel(HUD_ART.level, S.level);
  const progress = panel(HUD_ART.progress, S.progress);
  const hearts = panel(HUD_ART.hearts, S.counter);
  const shots = panel(HUD_ART.shots, S.counter);
  const score = panel(HUD_ART.score, S.counter);

  // pack one row from the left margin, then re-centre the whole row
  const widths = [S.button, level.w, progress.w, hearts.w, shots.w, score.w, S.button];
  const rowW = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  const slack = W - rowW - 2 * S.margins;
  // sub-pixel slack comes from aspect-ratio rounding, not a real overflow —
  // clamp it away instead of killing the boot; genuine overflows still throw
  if (slack < -1) throw new Error(`HUD row overflows: ${(-slack).toFixed(1)}px over`);
  const margin = S.margins + Math.max(0, slack) / 2;

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
    cy,
    /** Lowest screen-space pixel the HUD artwork reaches (for docking). */
    bandBottom: Math.ceil(cy + Math.max(S.button, level.h, progress.h) / 2),
    rowLeft: margin,
    rowRight: W - margin,
    elements: {
      pause: { x: pauseX, y: cy, w: S.button, h: S.button, hit: S.hit },
      sound: { x: soundX, y: cy, w: S.button, h: S.button, hit: S.hit },
      level: { x: levelX, y: cy, w: level.w, h: level.h },
      progress: { x: progressX, y: cy, w: progress.w, h: progress.h },
      hearts: { x: heartsX, y: cy, w: hearts.w, h: hearts.h },
      shots: { x: shotsX, y: cy, w: shots.w, h: shots.h },
      score: { x: scoreX, y: cy, w: score.w, h: score.h }
    },
    cells: { timer: timerCell, question: qCell, stars: starCell },
    type: compact
      ? {
          levelMain: 20, levelTitle: 0, levelShort: true,
          timer: 19, timerIcon: 17, question: 15,
          hearts: 23, shotsIcon: 16, shots: 14, scoreIcon: 16, score: 15,
          stars: 18, starCount: 1
        }
      : {
          levelMain: 14, levelTitle: 10, levelShort: false,
          timer: 21, timerIcon: 19, question: 14,
          hearts: 24, shotsIcon: 17, shots: 15, scoreIcon: 17, score: 15,
          stars: 12.5, starCount: 3
        }
  };
}

/** Absolute world rect of one progress-panel compartment. */
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
