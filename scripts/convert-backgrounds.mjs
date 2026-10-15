/**
 * One-time asset script: converts the three source background PNGs into
 * optimized WebP files under public/assets/images/backgrounds/.
 *
 * Usage: node scripts/convert-backgrounds.mjs <source-dir>
 * (source dir = folder containing the three original PNGs)
 */
import { mkdir, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import sharp from 'sharp';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node scripts/convert-backgrounds.mjs <source-dir-with-pngs>');
  process.exit(1);
}

// Source images keyed by aspect ratio:
//   ~16:9 (1.70-1.85) -> desktop
//   ~4:3  (1.25-1.45) -> tablet
//   ~2:1  (1.85-2.15) -> mobile-landscape
const TARGETS = { desktop: [1.7, 1.85], tablet: [1.25, 1.45], 'mobile-landscape': [1.85, 2.2] };
const OUT_DIR = 'public/assets/images/backgrounds';
const QUALITY = 82;

const files = (await readdir(SRC)).filter((f) => extname(f).toLowerCase() === '.png');
await mkdir(OUT_DIR, { recursive: true });

let matched = new Set();
for (const file of files) {
  const meta = await sharp(join(SRC, file)).metadata();
  const ar = meta.width / meta.height;
  const name = Object.entries(TARGETS).find(([, [lo, hi]]) => ar >= lo && ar < hi)?.[0];
  if (!name || matched.has(name)) {
    console.warn(`skip ${file} (aspect ${ar.toFixed(3)} unmatched or duplicate)`);
    continue;
  }
  matched.add(name);
  const out = join(OUT_DIR, `${name}.webp`);
  const info = await sharp(join(SRC, file)).webp({ quality: QUALITY }).toFile(out);
  console.log(`${name}: ${meta.width}x${meta.height} (ar ${ar.toFixed(3)}) -> ${out} ${(info.size / 1024).toFixed(0)} KB`);
}

for (const need of Object.keys(TARGETS)) {
  if (!matched.has(need)) {
    console.error(`MISSING: no source matched "${need}"`);
    process.exitCode = 1;
  }
}
