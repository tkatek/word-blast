/**
 * One-time asset script: turns the supplied 1254×1254 bird artwork into
 * game-ready textures at public/assets/images/birds/.
 *
 * For every bird it:
 *   1. measures the alpha bounding box (transparent padding removed)
 *   2. finds the LARGEST INSCRIBED CIRCLE of the silhouette (chamfer
 *      distance transform) — the round main body, ignoring crest / tail /
 *      wing protrusions. This circle is the visual reference for the
 *      Matter.js projectile collider.
 *   3. renders a square texture with that circle CENTERED exactly and its
 *      diameter normalized to BODY_TARGET px, so one display-size formula
 *      fits all six birds and the collider can be a plain centered circle.
 *
 * The measured geometry (texture size + body-circle radius) is written to
 * public/assets/images/birds/birds-manifest.json, which js/data/birds.js
 * mirrors for the runtime (kept in sync by tests/unit? — reviewed by hand;
 * the numbers are stable because the script is deterministic).
 *
 * Usage: node scripts/build-birds.mjs
 * Source art is expected in assets-src/birds/game_ready/*.png (originals
 * and 4K upscales stay there as source assets, never deployed).
 */
import sharp from 'sharp';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(ROOT, 'assets-src', 'birds', 'game_ready');
const OUT_DIR = join(ROOT, 'public', 'assets', 'images', 'birds');

const BODY_TARGET = 160;   // px body-circle diameter in the final texture
const ALPHA_MIN = 16;      // alpha threshold: below = transparent
const EDGE_PAD = 2;        // px safety padding around the silhouette

/** Largest inscribed circle {cx, cy, r} of an alpha mask (raw RGBA buffer). */
function inscribedCircle(alpha, w, h) {
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inside[i] = alpha[i] >= ALPHA_MIN ? 1 : 0;
  // chamfer 2-pass distance transform (values are 3 per axis step, 4 diagonal)
  // distance TO THE NEAREST BACKGROUND pixel: background = 0, inside = far
  const INF = 1 << 20;
  const dist = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = inside[i] ? INF : 0;
  const d = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? INF : dist[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i]) continue;
      dist[i] = Math.min(dist[i], d(x - 1, y) + 3, d(x, y - 1) + 3, d(x - 1, y - 1) + 4, d(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!inside[i]) continue;
      dist[i] = Math.min(dist[i], d(x + 1, y) + 3, d(x, y + 1) + 3, d(x + 1, y + 1) + 4, d(x - 1, y + 1) + 4);
    }
  }
  let best = { cx: w / 2, cy: h / 2, r: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = dist[y * w + x];
      if (v > best.r * 3) best = { cx: x, cy: y, r: v / 3 };
    }
  }
  return best;
}

/** Alpha bounding box of a raw RGBA buffer. */
function alphaBounds(alpha, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] >= ALPHA_MIN) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Furthest opaque pixel from (cx,cy) — sets the required square half-size. */
function maxExtent(alpha, w, h, cx, cy) {
  let m = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (alpha[y * w + x] >= ALPHA_MIN) {
        m = Math.max(m, Math.hypot(x - cx, y - cy));
      }
    }
  }
  return m;
}

mkdirSync(OUT_DIR, { recursive: true });
const manifest = {};

for (const file of readdirSync(SRC_DIR).filter((f) => f.endsWith('.png')).sort()) {
  const key = file.replace('.png', '');
  const src = join(SRC_DIR, file);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];

  const bounds = alphaBounds(alpha, w, h);
  const circle = inscribedCircle(alpha, w, h);
  const extent = maxExtent(alpha, w, h, circle.cx, circle.cy);
  const k = BODY_TARGET / (2 * circle.r);            // original → final scale
  const half = Math.ceil(extent * k) + EDGE_PAD;     // square half-size
  const size = half * 2;

  // scaled silhouette pasted so the body circle sits at the exact center
  const scaledW = Math.round(bounds.w * k);
  const scaledH = Math.round(bounds.h * k);
  const left = Math.round(half - (circle.cx - bounds.x0) * k);
  const top = Math.round(half - (circle.cy - bounds.y0) * k);
  const scaled = await sharp(src)
    .extract({ left: bounds.x0, top: bounds.y0, width: bounds.w, height: bounds.h })
    .resize(scaledW, scaledH, { kernel: 'lanczos3' }).png().toBuffer();
  const outPath = join(OUT_DIR, `${key}.png`);
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  // verify the final texture: re-measure body circle + centering
  const chk = await sharp(outPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const chkAlpha = new Uint8Array(chk.info.width * chk.info.height);
  for (let i = 0; i < chkAlpha.length; i++) chkAlpha[i] = chk.data[i * 4 + 3];
  const chkCircle = inscribedCircle(chkAlpha, chk.info.width, chk.info.height);
  const kb = Math.round(statSync(outPath).size / 1024);
  manifest[key] = {
    texture: `bird-${key.split('_')[0]}`,
    file: `${key}.png`,
    size: chk.info.width,
    bodyRadius: +chkCircle.r.toFixed(2),
    centerOffsetX: +(chkCircle.cx - chk.info.width / 2).toFixed(1),
    centerOffsetY: +(chkCircle.cy - chk.info.height / 2).toFixed(1),
    kb
  };
  console.log(`${key}: tex ${size}x${size}, body r=${manifest[key].bodyRadius}px, ` +
    `center off=(${manifest[key].centerOffsetX},${manifest[key].centerOffsetY}), ${kb}KB ` +
    `(source bbox ${bounds.w}x${bounds.h}, circle r=${circle.r.toFixed(0)} @ ${circle.cx},${circle.cy})`);
}

writeFileSync(join(OUT_DIR, 'birds-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nwrote public/assets/images/birds/birds-manifest.json');
