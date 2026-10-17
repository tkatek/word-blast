/**
 * ANSWER PANEL BUILDER — bakes the three gameplay answer-plaque textures
 * from the uploaded parchment-and-wood panel art
 * ("Panneau de parchemin fantasy en bois").
 *
 * Variants share ONE design language (same frame, same 80px logical
 * height) and differ only in width so short / medium / long answer words
 * all render at a consistent font size:
 *
 *   answer_panel_s  116 x 80   short  words (<= 7 chars)
 *   answer_panel_m  142 x 80   medium words (<= 11 chars)
 *   answer_panel_l  170 x 80   long   words
 *
 * Width changes are made by CROPPING / MIRROR-TILING the panel's middle
 * band (plain parchment + horizontal frame planks) — the wooden corner
 * ornaments are never stretched, and organic blotches tile seamlessly
 * when mirrored, so all three read as the same object.
 *
 * Output is pre-trimmed (canvas == visible content, 2px pad), so the
 * physics factory can setDisplaySize(logical) and the painted frame lands
 * exactly on the collider — same contract as the trimmed tower pack.
 *
 * Run: node scripts/build-answer-panels.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'public/assets/images/tower/props');
const SRC = 'C:/Users/HP/Downloads/Panneau de parchemin fantasy en bois.png';

const FINAL_H = 80;
const VARIANTS = [
  { key: 'answer_panel_s', w: 116 },
  { key: 'answer_panel_m', w: 142 },
  { key: 'answer_panel_l', w: 170 }
];
const CUT_L = 0.30; // middle band starts 30% in (clear of corner ornaments)
const CUT_R = 0.70;
const PAD = 2;

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

/** Mirror-tile the middle band out to `width` px (organic texture, no smear). */
async function tileMiddle(mid, width, mw, mh) {
  const tiles = [];
  let acc = 0, flip = false;
  while (acc < width) {
    const take = Math.min(mw, width - acc);
    let piece = mid.clone();
    if (flip) piece = piece.flop();
    if (take < mw) piece = piece.extract({ left: 0, top: 0, width: take, height: mh });
    tiles.push({ input: await piece.png().toBuffer(), left: acc, top: 0 });
    acc += take;
    flip = !flip;
  }
  const out = sharp({
    create: { width, height: mh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  });
  return out.composite(tiles).png().toBuffer();
}

mkdirSync(OUT_DIR, { recursive: true });
const box = await contentBox(sharp(SRC));
// trim to content + PAD so the frame edge sits predictably at the canvas edge
const trimRect = {
  left: Math.max(0, box.left - PAD),
  top: Math.max(0, box.top - PAD),
  width: Math.min(box.width + PAD * 2, box.left - PAD + box.width + PAD * 2),
  height: Math.min(box.height + PAD * 2, box.top - PAD + box.height + PAD * 2)
};
const srcBuf = await sharp(SRC).extract(trimRect).png().toBuffer();
const src = sharp(srcBuf);
const { width: SW, height: SH } = await src.metadata();
const leftW = Math.round(SW * CUT_L);
const rightW = Math.round(SW * CUT_R);          // x where the right rail starts
const midW = rightW - leftW;                    // middle band width
const edgeW = leftW + (SW - rightW); // ornament rails kept 1:1 in every variant

const left = await sharp(srcBuf).extract({ left: 0, top: 0, width: leftW, height: SH }).png().toBuffer();
const right = await sharp(srcBuf).extract({ left: rightW, top: 0, width: SW - rightW, height: SH }).png().toBuffer();
const mid = sharp(await sharp(srcBuf).extract({ left: leftW, top: 0, width: midW, height: SH }).png().toBuffer());

for (const v of VARIANTS) {
  // source-scale width that maps 1:1 onto the final variant
  const targetSW = Math.round((v.w / FINAL_H) * SH);
  const needMid = targetSW - edgeW;
  let middleBuf;
  if (needMid <= midW) {
    // narrower: center-crop the band (crop loses nothing — it is plain wash)
    const cut = Math.floor((midW - needMid) / 2);
    middleBuf = await mid.clone()
      .extract({ left: cut, top: 0, width: needMid, height: SH }).png().toBuffer();
  } else {
    middleBuf = await tileMiddle(mid, needMid, midW, SH);
  }
  const panel = await sharp({
    create: { width: targetSW, height: SH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: middleBuf, left: leftW, top: 0 },
      { input: right, left: targetSW - (SW - rightW), top: 0 }
    ])
    .png().toBuffer();
  const out = join(OUT_DIR, `${v.key}.png`);
  await sharp(panel).resize(v.w, FINAL_H, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(out);
  console.log(`${v.key}: ${v.w}x${FINAL_H} (src band ${needMid}px, ${needMid <= midW ? 'cropped' : 'mirror-tiled'}) -> ${out}`);
}
console.log('done');
