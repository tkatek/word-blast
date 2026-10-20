/**
 * Generates the PWA icon set from the game logo (assets-src/menu/logo.png).
 *
 *   public/assets/images/icons/icon-192.png          — regular 192
 *   public/assets/images/icons/icon-512.png          — regular 512
 *   public/assets/images/icons/icon-maskable-512.png — 512 with the logo
 *       inside the 80% safe zone (platforms may crop to a circle)
 *   public/assets/images/icons/apple-touch-icon.png  — 180×180 opaque
 *
 * The wide (2:1) logo is centered on the game's sky color so transparent
 * margins never render black under iOS/square-crop compositing.
 *
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, '..', 'assets-src', 'menu', 'logo.png');
const OUT_DIR = join(root, '..', 'public', 'assets', 'images', 'icons');
const SKY = { r: 142, g: 202, b: 230 }; // COLORS.SKY #8ecae6

mkdirSync(OUT_DIR, { recursive: true });

/** Logo scaled to `fill` of the icon, centered on sky, with soft ground strip. */
async function makeIcon(size, fill, file) {
  const logoH = Math.round(size * fill);
  const logoW = Math.round(logoH * (1774 / 887)); // keep aspect
  const logo = await sharp(SRC).resize({
    width: Math.min(logoW, size - Math.round(size * 0.06)),
    height: logoH,
    fit: 'inside'
  }).png().toBuffer();

  await sharp({
    create: {
      width: size, height: size, channels: 4,
      background: { r: SKY.r, g: SKY.g, b: SKY.b, alpha: 1 }
    }
  }).composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(join(OUT_DIR, file));
  console.log('wrote', file, `${size}x${size}`);
}

await makeIcon(192, 0.62, 'icon-192.png');
await makeIcon(512, 0.62, 'icon-512.png');
await makeIcon(512, 0.5, 'icon-maskable-512.png'); // safe zone for round crops
await makeIcon(180, 0.66, 'apple-touch-icon.png');
console.log('done');
