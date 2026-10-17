import sharp from 'sharp';
import { TOWER_ASSETS } from '../../js/data/tower-assets.js';

const BASE = 'public/assets/images/tower/';
console.log('key                 canvas        content(manifest) measured      padL padR padT padB | scaleX scaleY gapBottom');
for (const [key, a] of Object.entries(TOWER_ASSETS)) {
  const img = sharp(BASE + a.file);
  const { width, height } = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * info.channels + (info.channels - 1)];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const padL = minX, padR = info.width - 1 - maxX, padT = minY, padB = info.height - 1 - maxY;
  const scaleX = a.size[0] / width, scaleY = a.size[1] / height;
  const gapBottom = padB * scaleY;
  const mc = [maxX - minX + 1, maxY - minY + 1];
  const match = Math.abs(mc[0] - a.content[0]) <= 2 && Math.abs(mc[1] - a.content[1]) <= 2;
  console.log(
    key.padEnd(19),
    `${width}x${height}`.padEnd(11),
    `${a.content[0]}x${a.content[1]}`.padEnd(14),
    (match ? `${mc[0]}x${mc[1]}` : `${mc[0]}x${mc[1]} MISMATCH`).padEnd(13),
    String(padL).padStart(4), String(padR).padStart(4), String(padT).padStart(4), String(padB).padStart(4),
    '|', scaleX.toFixed(3), scaleY.toFixed(3), 'gapBottom=', gapBottom.toFixed(1) + 'px'
  );
}
