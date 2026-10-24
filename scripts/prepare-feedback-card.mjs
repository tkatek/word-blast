/**
 * FEEDBACK CARD ARTWORK PREPARER — installs the supplied wooden-parchment
 * PNG (assets-src/parchment-new-a.png) as the answer-feedback card
 * background.
 *
 * The uploaded artwork is used EXACTLY as painted: the only processing is
 * trimming the fully-transparent outer margin (12/13px sides, 46px top,
 * 69px bottom in the 1448×1086 upload) so the visible artwork is centered
 * on the card. Every visible pixel, the transparency and the proportions
 * are preserved byte-for-byte; NOTHING is baked in — header banner, badge,
 * texts and the action button are all drawn at runtime by
 * js/systems/FeedbackCard.js.
 *
 * Geometry measured from the trimmed artwork (1424×972, aspect 1.4649):
 *   parchment inner area  x 131..1280  y 162..841
 *   → side insets ≈ 9.2% / 10.1% of width, top ≈ 16.7%, bottom ≈ 13.5%
 *   (FeedbackCard.js L.* constants mirror these fractions).
 *
 * Output: public/assets/images/ui/feedback-card.webp (WebP since the
 *         load-time optimization pass — the runtime path in
 *         js/systems/FeedbackCard.js points here; re-run
 *         scripts/optimize-assets.mjs afterwards to re-apply the
 *         downsize/compress step)
 * Run:    node scripts/prepare-feedback-card.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'assets-src', 'parchment-new-a.png');
const OUT = join(here, '..', 'public', 'assets', 'images', 'ui', 'feedback-card.webp');
mkdirSync(dirname(OUT), { recursive: true });

/** Smallest alpha bounding box (threshold 8) of the raw pixel buffer. */
async function alphaBBox(input) {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + (C - 1)] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const box = await alphaBBox(SRC);
// Trim via a lossless in-memory step, then encode the shipped WebP at the
// same settings scripts/optimize-assets.mjs uses (900 px wide, q85) so a
// re-install can never quietly regress the load-time budget.
const trimmed = await sharp(SRC).extract(box).png({ compressionLevel: 9 }).toBuffer();
const trimmedMeta = await sharp(trimmed).metadata();
await sharp(trimmed)
  .resize({ width: Math.min(900, trimmedMeta.width) })
  .webp({ quality: 85, alphaQuality: 90, effort: 5 })
  .toFile(OUT);

const meta = await sharp(OUT).metadata();
console.log(`feedback card artwork installed: ${OUT}`);
console.log(`  trimmed ${box.left}/${box.top} + ${box.width}x${box.height} of the upload → ${meta.width}x${meta.height} (aspect ${(meta.width / meta.height).toFixed(4)})`);
