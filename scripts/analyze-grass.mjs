/**
 * Measures the flat grass line of the OFFICIAL gameplay background
 * (public/assets/images/backgrounds/gameplay.webp) and prints the value for
 * BACKGROUND.GRASS_LINE_Y in js/config.js.
 *
 * Method: per column, find the topmost run of >= 25 strongly-green pixels
 * that is part of the contiguous foreground field, then report the modal
 * (dominant) elevation — the flat line every structure stands on. Columns
 * where distant green hills win are rejected by requiring the run to sit in
 * the lower half of the art.
 *
 * Usage: node scripts/analyze-grass.mjs [image]
 */
import sharp from 'sharp';
import { BACKGROUND } from '../js/config.js';

const file = process.argv[2] || new URL('../public/assets/images/backgrounds/gameplay.webp', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const isGrass = (r, g, b) => g > r + 12 && g > b + 12 && g > 90;

const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;

const tops = [];
for (let x = 0; x < W; x += Math.max(1, Math.round(W / 80))) {
  let run = 0;
  let top = null;
  for (let y = Math.floor(H * 0.3); y < H; y++) {
    const i = (y * W + x) * C;
    if (isGrass(data[i], data[i + 1], data[i + 2])) {
      if (++run >= 25) { top = y - 24; break; }
    } else {
      run = 0;
    }
  }
  if (top !== null && top > H * 0.5) tops.push(top); // foreground field only
}

const counts = new Map();
for (const y of tops) {
  const key = Math.round(y / 4) * 4;
  counts.set(key, (counts.get(key) || 0) + 1);
}
let best = null;
for (const [y, n] of counts) if (!best || n > best.n) best = { y, n };

console.log(JSON.stringify({
  file: file.split(/[\\/]/).pop(),
  size: `${W}x${H}`,
  grassLineY: best.y,
  frac: +(best.y / H).toFixed(4),
  columns: tops.length,
  spread: { min: Math.min(...tops), max: Math.max(...tops) },
  configured: BACKGROUND.GRASS_LINE_Y,
  matchesConfig: best.y === BACKGROUND.GRASS_LINE_Y
}, null, 2));
