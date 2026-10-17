/**
 * Pixel-precise analysis of the uploaded wooden parchment question card:
 *  - opaque content bounds (for tight trimming)
 *  - parchment writing area (cream-colored region)
 *  - blue circular button (center + radius) for the speaker icon alignment
 * Run: node scripts/tmp/analyze-question-card.mjs
 */
import sharp from 'sharp';

const SRC = 'C:/Users/HP/Downloads/Bannière parchemin en bois avec bouton bleu.png';

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, CH = info.channels;
const px = (x, y) => {
  const i = (y * W + x) * CH;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

// --- 1. opaque content bounds -----------------------------------------
let minX = W, maxX = -1, minY = H, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (px(x, y)[3] > 24) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
console.log('canvas:', `${W}x${H}`);
console.log('opaque content:', `${maxX - minX + 1}x${maxY - minY + 1}`, 'at', `(${minX},${minY})`);

// --- 2. blue button detection (blue-dominant pixels) -------------------
// blue: b notably above r and g, mid luminance, opaque
let bMinX = W, bMaxX = -1, bMinY = H, bMaxY = -1, blueCount = 0;
let sumX = 0, sumY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = px(x, y);
    if (a > 200 && b > 90 && b > r + 28 && b > g + 18 && r > 25) {
      blueCount++;
      sumX += x; sumY += y;
      if (x < bMinX) bMinX = x;
      if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y;
      if (y > bMaxY) bMaxY = y;
    }
  }
}
console.log('blue button bbox:', `(${bMinX},${bMinY})-(${bMaxX},${bMaxY})`,
  'center:', `(${Math.round(sumX / blueCount)},${Math.round(sumY / blueCount)})`,
  'diameter est:', bMaxX - bMinX + 1, 'x', bMaxY - bMinY + 1, 'count:', blueCount);

// --- 3. parchment writing area (cream pixels, per-column row extents) --
// cream: high luminance, r>g>b mildly (warm), opaque
const isCream = (x, y) => {
  const [r, g, b, a] = px(x, y);
  return a > 200 && r > 195 && g > 165 && b > 110 && r >= g && g > b;
};
// scan the middle row band for the parchment's left/right extent
const midY = Math.round(H / 2);
let pLeft = -1, pRight = -1;
for (let x = 0; x < W; x++) if (isCream(x, midY)) { pLeft = x; break; }
for (let x = W - 1; x >= 0; x--) if (isCream(x, midY)) { pRight = x; break; }
// vertical extent at parchment's horizontal center (excluding blue button zone)
const cx = Math.round((pLeft + pRight) / 2);
let pTop = -1, pBottom = -1;
for (let y = 0; y < H; y++) if (isCream(cx, y)) { pTop = y; break; }
for (let y = H - 1; y >= 0; y--) if (isCream(cx, y)) { pBottom = y; break; }
console.log('parchment @mid row:', `x ${pLeft}..${pRight}`, `center-col y ${pTop}..${pBottom}`);

// column where parchment is still wide enough left of the blue button
// (find, at mid height, the last cream x before blue bbox starts)
const usableRight = Math.min(pRight, bMinX - 1);
console.log('parchment usable text zone:', `x ${pLeft}..${usableRight}`, `y ${pTop}..${pBottom}`);
console.log('usable rect (w x h):', `${usableRight - pLeft + 1}x${pBottom - pTop + 1}`);

// --- 4. verify the blue circle: radius from centroid samples ----------
const bcx = Math.round(sumX / blueCount), bcy = Math.round(sumY / blueCount);
let rEdge = 0;
for (let r = 1; r < W; r++) {
  const [rr, gg, bb, aa] = px(Math.min(W - 1, bcx + r), bcy);
  if (!(aa > 200 && bb > rr + 20)) { rEdge = r; break; }
}
console.log('blue circle: center', `(${bcx},${bcy})`, 'radius ~', rEdge);
