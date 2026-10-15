/**
 * Measures the flat grass surface in a background artwork by pixel scanning.
 * For each sampled column it finds the topmost strongly-green pixel (grass),
 * then reports the dominant (modal) grass elevation inside given zones.
 *
 * Usage: node scripts/analyze-grass.mjs <image> [more images...]
 */
import sharp from 'sharp';

const isGrass = (r, g, b) => g > 60 && g > r + 18 && g > b + 18;

for (const file of process.argv.slice(2)) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const grassTop = new Array(W).fill(null);

  for (let x = 0; x < W; x += 6) {
    for (let y = Math.floor(H * 0.25); y < H; y += 3) {
      const i = (y * W + x) * C;
      if (isGrass(data[i], data[i + 1], data[i + 2])) {
        grassTop[x] = y;
        break;
      }
    }
  }

  const mode = (x0f, x1f, bin = 6) => {
    const counts = new Map();
    for (let x = 0; x < W; x += 6) {
      const f = x / W;
      if (f < x0f || f >= x1f) continue;
      const y = grassTop[x];
      if (y === null) continue;
      const key = Math.round(y / bin) * bin;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let best = null;
    for (const [k, n] of counts) if (!best || n > best.n) best = { y: k, n };
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return best ? { y: best.y, frac: +(best.y / H).toFixed(3), share: +(best.n / total).toFixed(2) } : null;
  };

  const slingZone = mode(0.05, 0.22);
  const playZone = mode(0.25, 0.95);
  console.log(JSON.stringify({
    file: file.split(/[\\/]/).pop(),
    size: `${W}x${H}`,
    slingZone: slingZone ? { y: slingZone.y, frac: slingZone.frac } : null,
    gameplayZone: playZone
  }));
}
