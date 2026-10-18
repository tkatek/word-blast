/**
 * Fix #21 — prepare the official MAIN-MENU artwork from the supplied sources:
 *
 *   - background: the official fantasy landscape with the painted red bird
 *     (1672×941) → public/assets/images/menu/background.webp
 *   - logo: the transparent WORD BLAST logo (1774×887 RGBA)
 *     → public/assets/images/menu/logo.webp — FULL resolution kept (the
 *       source stays ≥ the logo's device-pixel width on every screen in the
 *       support matrix up to 4K·DPR1.5), alpha channel preserved, quality 95
 *       keeps the lettering edges crisp; webp-with-alpha is ~3× smaller than
 *       PNG here and matches the project's existing background format.
 *
 * Aspect ratios are PRESERVED (no stretching, no cropping). Re-runnable:
 * outputs are deterministic conversions of the immutable sources in
 * assets-src.
 *
 * Run:  node scripts/prepare-menu-assets.mjs
 */
import sharp from 'sharp';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(root, '..', 'assets-src', 'menu');
const OUT_DIR = join(root, '..', 'public', 'assets', 'images', 'menu');
mkdirSync(OUT_DIR, { recursive: true });

const jobs = [
  {
    src: join(SRC_DIR, 'background.png'),
    out: join(OUT_DIR, 'background.webp'),
    transform: (img) => img.webp({ quality: 90, effort: 5 }),
    desc: 'menu background (fantasy landscape, red bird painted in)'
  },
  {
    src: join(SRC_DIR, 'logo.png'),
    out: join(OUT_DIR, 'logo.webp'),
    transform: (img) => img.webp({ quality: 95, effort: 5 }),
    desc: 'WORD BLAST logo (transparent, aspect preserved)'
  },
  {
    // Supplied wooden bar element (628×143) — the PLAY button face. Kept
    // at FULL source resolution (≥ the button's device-pixel size across
    // the support matrix); the game scales it to the button, aspect
    // preserved, and centre-crops nothing.
    src: join(SRC_DIR, 'play-button.png'),
    out: join(OUT_DIR, 'play-button.webp'),
    transform: (img) => img.webp({ quality: 95, effort: 5 }),
    desc: 'PLAY button wooden face (supplied element)'
  }
];

for (const job of jobs) {
  if (!existsSync(job.src)) {
    // The source was already copied into place once — keep idempotent.
    if (existsSync(job.out)) {
      console.log(`skip (source missing, output present): ${job.desc}`);
      continue;
    }
    throw new Error(`missing source: ${job.src}`);
  }
  const meta = await sharp(job.src).metadata();
  const img = sharp(job.src).rotate(); // respect EXIF, keep pixels otherwise
  await job.transform(img, meta).toFile(job.out);
  const before = (statSync(job.src).size / 1024).toFixed(0);
  const after = (statSync(job.out).size / 1024).toFixed(0);
  const outMeta = await sharp(job.out).metadata();
  console.log(
    `${job.desc}: ${meta.width}×${meta.height} ${before}KB → ` +
    `${outMeta.width}×${outMeta.height} ${after}KB (${outMeta.format})`
  );
}
console.log('done ->', OUT_DIR);
