/**
 * One-time asset script: converts the official gameplay background PNG into
 * an optimized WebP at public/assets/images/backgrounds/gameplay.webp.
 *
 * Usage: node scripts/convert-backgrounds.mjs <source.png>
 */
import sharp from 'sharp';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node scripts/convert-backgrounds.mjs <source.png>');
  process.exit(1);
}

const OUT = 'public/assets/images/backgrounds/gameplay.webp';
const QUALITY = 82;

const meta = await sharp(SRC).metadata();
const info = await sharp(SRC).webp({ quality: QUALITY }).toFile(OUT);
console.log(`${OUT}: ${meta.width}x${meta.height} -> ${info.width}x${info.height}, ${Math.round(info.size / 1024)}KB`);
