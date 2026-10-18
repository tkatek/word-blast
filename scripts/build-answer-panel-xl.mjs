/**
 * XL ANSWER PANEL BUILDER — bakes the sentence-sized gameplay plaque texture
 * from the newly uploaded wide parchment artwork (1774×887 RGBA, transparent
 * background).
 *
 * The artwork is a chunkier sibling of the S/M/L panel design: tall corner
 * posts left/right, horizontal planks between them, parchment in the middle.
 * At gameplay size the stock rails are too thick for text, so the horizontal
 * planks are THINNED with full-width band splices (crop-and-rejoin — the
 * frame is never scaled non-uniformly, and the bands contain no bolts, only
 * vertical wood-edge lines that continue seamlessly across the splice):
 *
 *   source content   1719 × 652   (alpha-trimmed; faint 18px bottom sliver cut)
 *   top band         y 196..238   (42px plain top-rail plank)      -> removed
 *   bottom band      y 686..744   (58px plain bottom plank; bolts at 748+) -> removed
 *   result           1719 × 552   (parchment y-share 0.551)
 *   width            ~uncropped (≤17px center-crop to hit the exact aspect)
 *
 * Output: props/answer_panel_xl.png, 600×194 (2× the 300×97 display size),
 * pre-trimmed so canvas == content — same contract as the rest of the pack.
 *
 * Run: node scripts/build-answer-panel-xl.mjs
 */
import sharp from 'sharp';
import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'public/assets/images/tower/props');
const SRC_STASH = join(here, 'assets-src', 'answer-panel-xl-source.png');

const SRC_CANDIDATES = [
  'C:/Users/HP/.zcode/cli/image-cache/sess_0eef7106-b1a9-4421-819b-03ad22591954/image-2c3f1be4c70966249b3360899aa9b280.png',
  SRC_STASH
];

// Display geometry (must match TOWER_ASSETS.answer_panel_xl.size).
const DISPLAY_W = 300;
const DISPLAY_H = 97;
const TEX_SCALE = 2;

// Measured from the artwork's alpha silhouette (verified stable):
const CONTENT = { left: 28, top: 128, right: 1746, bottom: 780 };
// Full-width vertical bands removed (plain plank; no bolts — verified).
const BANDS = [
  { y0: 196, y1: 238 },
  { y0: 686, y1: 744 }
];
// Parchment (light writing surface) canvas-y extent, for the metrics report.
const PARCHMENT = { y0: 306, y1: 610, x0: 176, x1: 1507 };

const src = SRC_CANDIDATES.find(existsSync);
if (!src) throw new Error('XL source artwork not found');
if (src !== SRC_STASH) {
  mkdirSync(dirname(SRC_STASH), { recursive: true });
  copyFileSync(src, SRC_STASH); // keep a project-local copy for rebuilds
  console.log('stashed source ->', SRC_STASH);
}

const contentH = CONTENT.bottom - CONTENT.top + 1;
const FW = CONTENT.right - CONTENT.left + 1;

// Strata = vertical slices of the trimmed art between the removed bands.
const bounds = [CONTENT.top, ...BANDS.flatMap((b) => [b.y0, b.y1 + 1]), CONTENT.bottom + 1];
const strata = [];
for (let i = 0; i < bounds.length; i += 2) {
  const y0 = bounds[i], y1 = bounds[i + 1] - 1;
  if (y1 < y0) continue;
  strata.push(await sharp(src)
    .extract({ left: CONTENT.left, top: y0, width: FW, height: y1 - y0 + 1 })
    .png().toBuffer());
}
const assembledH = strata.reduce((h, _b, i) => h, 0) || 0;
const heights = [];
{
  let y = CONTENT.top;
  for (let i = 0; i < bounds.length; i += 2) {
    const y0 = bounds[i], y1 = bounds[i + 1] - 1;
    if (y1 < y0) continue;
    heights.push(y1 - y0 + 1);
    y = y1;
  }
}
const MID_H = heights.reduce((a, b) => a + b, 0);
console.log(`strata: ${heights.join('+')} = ${MID_H} (was ${contentH})`);

const assembled = await sharp({ create: { width: FW, height: MID_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(strata.map((input, i) => ({ input, left: 0, top: heights.slice(0, i).reduce((a, b) => a + b, 0) })))
  .png().toBuffer();

// Center-crop to the exact display aspect (frame proportions untouched).
const aspect = DISPLAY_W / DISPLAY_H;
const targetW = Math.round(MID_H * aspect);
if (targetW > FW) throw new Error(`aspect needs width ${targetW} > source ${FW}`);
const cutEach = Math.floor((FW - targetW) / 2);
const finalSrc = targetW === FW ? assembled : await sharp(assembled)
  .extract({ left: cutEach, top: 0, width: targetW, height: MID_H }).png().toBuffer();
console.log(`assembled ${FW}x${MID_H} -> center-crop ${targetW}x${MID_H} (${FW - targetW}px)`);

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, 'answer_panel_xl.png');
await sharp(finalSrc)
  .resize(DISPLAY_W * TEX_SCALE, DISPLAY_H * TEX_SCALE, { kernel: 'lanczos3', fit: 'fill' })
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log(`answer_panel_xl: display ${DISPLAY_W}x${DISPLAY_H}, texture ${DISPLAY_W * TEX_SCALE}x${DISPLAY_H * TEX_SCALE} -> ${out}`);

// Parchment metrics for the runtime manifest (fractions of the final texture).
const removedAbove = (y) => BANDS.filter((b) => b.y1 < y).reduce((s, b) => s + (b.y1 - b.y0 + 1), 0);
const py0 = (PARCHMENT.y0 - CONTENT.top - removedAbove(PARCHMENT.y0)) / MID_H;
const py1 = (PARCHMENT.y1 - CONTENT.top - removedAbove(PARCHMENT.y1)) / MID_H;
const px0 = (PARCHMENT.x0 - CONTENT.left - cutEach) / targetW;
const px1 = (PARCHMENT.x1 - CONTENT.left - cutEach) / targetW;
console.log(`parchment fractions: x ${px0.toFixed(4)}..${px1.toFixed(4)}  y ${py0.toFixed(4)}..${py1.toFixed(4)}`);
