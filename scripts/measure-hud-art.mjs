/**
 * Measure the supplied blank wooden HUD artwork (pixel-accurate).
 *
 * For each PNG: alpha-trim to the visible artwork, then compute
 *   - trimmed size / offsets,
 *   - the inner content box (contiguous run around the centre tone along
 *     the middle row/column — works for light AND dark recessed centres),
 *   - for the three-compartment panel: real divider positions from a
 *     column-luminance scan of the central band (never assumed thirds).
 *
 * Run: node scripts/measure-hud-art.mjs [dir]
 */
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'C:/Users/HP/AppData/Local/Temp/hud_assets/top bar elements';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

async function measure(file) {
  const { data, info } = await sharp(join(dir, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const px = (x, y) => {
    const i = (y * W + x) * C;
    return { a: data[i + 3], l: lum(data[i], data[i + 1], data[i + 2]) };
  };

  // --- alpha trim ---
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px(x, y).a > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const tw = maxX - minX + 1, th = maxY - minY + 1;

  // --- inner content box around the centre tone ---
  const cx = Math.floor(minX + tw / 2), cy = Math.floor(minY + th / 2);
  const refSamples = [];
  for (let dy = -Math.floor(th * 0.08); dy <= Math.floor(th * 0.08); dy++) {
    for (let dx = -Math.floor(tw * 0.08); dx <= Math.floor(tw * 0.08); dx++) {
      refSamples.push(px(cx + dx, cy + dy).l);
    }
  }
  const ref = median(refSamples);
  const tol = 26;
  const run = (from, to, step, fixed) => {
    let start = null;
    for (let v = from; step > 0 ? v <= to : v >= to; v += step) {
      const p = fixed === 'y' ? px(v, cy) : px(cx, v);
      const ok = Math.abs(p.l - ref) <= tol && p.a > 16;
      if (ok && start === null) start = v;
      if (!ok && start !== null) {
        if (Math.abs(v - start) > (to - from) * 0.06) return { start, end: v - step };
        start = null;
      }
    }
    return start !== null ? { start, end: from + (step > 0 ? (to - from) : 0) } : null;
  };
  const innerX = run(minX, maxX, 1, 'y');
  const innerY = run(minY, maxY, 1, 'x');

  // --- dividers: column luminance over the central vertical band ---
  const yA = Math.floor(minY + th * 0.35), yB = Math.floor(minY + th * 0.65);
  const colLum = [];
  for (let x = minX; x <= maxX; x++) {
    let s = 0, n = 0;
    for (let y = yA; y <= yB; y++) { s += px(x, y).l; n++; }
    colLum.push({ x, l: s / n });
  }
  // smooth (window 5)
  const sm = colLum.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j >= 0 && j < colLum.length) { s += colLum[j].l; n++; }
    }
    return { x: colLum[i].x, l: s / n };
  });
  // dark columns well below the centre tone = dividers / frame
  const dark = sm.filter((c) => c.l < ref - 55).map((c) => c.x);
  // group contiguous dark runs, keep interior ones (not touching the frame edge)
  const groups = [];
  for (const x of dark) {
    const g = groups[groups.length - 1];
    if (g && x - g.end <= 3) g.end = x;
    else groups.push({ start: x, end: x });
  }
  const interior = groups.filter((g) => g.start > minX + tw * 0.15 && g.end < maxX - tw * 0.15);

  const f = (n) => +(n / tw).toFixed(4);
  return {
    file,
    canvas: `${W}x${H}`,
    trimmed: `${tw}x${th} at (${minX},${minY})`,
    aspect: +(tw / th).toFixed(3),
    centreTone: Math.round(ref),
    inner: {
      x0: f(innerX.start - minX), x1: f(innerX.end - minX),
      y0: +((innerY.start - minY) / th).toFixed(4), y1: +((innerY.end - minY) / th).toFixed(4)
    },
    dividers: interior.map((g) => ({
      x0: f(g.start - minX), x1: f(g.end - minX),
      wPx: g.end - g.start + 1
    }))
  };
}

const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
for (const f of files) {
  const m = await measure(f);
  console.log(JSON.stringify(m, null, 1));
}
