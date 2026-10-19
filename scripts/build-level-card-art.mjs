/**
 * LEVEL-SELECT ART BUILDER — installs the user-supplied artwork:
 *
 *   1. the blank wooden parchment card (square, transparent PNG) →
 *      public/assets/images/ui/level-card.png — the LEVEL CARD background
 *      (level-select grid). The art stays BLANK: numbers, stars and the
 *      padlock are separate Phaser objects drawn by js/systems/LevelCard.js.
 *   2. the WORD BLAST lettering logo (gold, dark-brown outline) →
 *      public/assets/images/ui/level-select-logo.png — the level-select
 *      screen title (replaces the old hanging SELECT LEVEL plank).
 *
 * Both are alpha-trimmed to their visible content so origin-centred
 * placement is exact, and copied into assets-src/levelselect/ for
 * provenance (the same convention as the bird/tower art pipeline).
 *
 * Run: node scripts/build-level-card-art.mjs
 */
import sharp from 'sharp';
import { mkdirSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

const SRC_CARD = 'C:/Users/HP/Downloads/Image ChatGPT 19 oct. 2026, 20_42_22-1.png';
const SRC_LOGO = 'C:/Users/HP/Downloads/Image ChatGPT 19 oct. 2026, 20_42_24-2.png';

const PROV = join(here, '..', 'assets-src', 'levelselect');
const OUT_CARD = join(here, '..', 'public', 'assets', 'images', 'ui', 'level-card.png');
const OUT_LOGO = join(here, '..', 'public', 'assets', 'images', 'ui', 'level-select-logo.png');
mkdirSync(PROV, { recursive: true });

/** Visible-content bounding box (alpha > threshold) — same approach as the
 *  tower/answer-panel pipeline. */
async function contentBox(img) {
  const { data, info } = await img.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * info.channels + (info.channels - 1)];
      if (a > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function process(src, out, provenanceName, maxLongEdge = null) {
  const box = await contentBox(sharp(src));
  let img = sharp(src).extract(box);
  const meta = await img.metadata();
  if (maxLongEdge && Math.max(meta.width, meta.height) > maxLongEdge) {
    img = img.resize({ width: meta.width >= meta.height ? maxLongEdge : null, height: meta.height > meta.width ? maxLongEdge : null });
  }
  await img.png({ compressionLevel: 9 }).toFile(out);
  copyFileSync(src, join(PROV, provenanceName));
  const done = await sharp(out).metadata();
  console.log(`${provenanceName}: ${box.width}x${box.height} content → ${done.width}x${done.height} (${out.split('\\').pop().split('/').pop()})`);
}

await process(SRC_CARD, OUT_CARD, 'level-card-source.png', 1400);
await process(SRC_LOGO, OUT_LOGO, 'level-select-logo-source.png');
console.log('level-select art installed');
