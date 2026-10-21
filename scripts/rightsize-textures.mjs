/**
 * RIGHT-SIZE OVERSIZED RUNTIME TEXTURES (perf pass).
 *
 * Four artworks ship far larger than any device ever displays them. Sized
 * here for ~2.2× their maximum on-screen WORLD size (phone landscape at
 * DPR 2 + fit-zoom ≈ 2.2 device px per world px), with headroom:
 *
 *   slingshot-wood.png   1254×1254 → 1024²   (max display ≈ 440 world px)
 *   menu/logo.webp       1774×887  → 1200×600 (display 530 world px)
 *   ui/level-card.webp   1192×1048 → 560×492  (card cap 232 world px)
 *   ui/menu-button.webp  2172×724  → 520×174  (button 176 world px)
 *
 * Alpha preserved everywhere (PNG stays PNG, WebP stays WebP); lanczos3
 * downscale only — no format change, no visual redesign. VRAM (w·h·4)
 * drops from ~23 MB to ~7.6 MB for these four, and the bytes leave the
 * network path. Original dimensions live in git history (tag pre-perf-opt)
 * — re-run nothing: this is a one-time asset normalization.
 */
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IMG = join(ROOT, 'public', 'assets', 'images');

const TARGETS = [
  { file: 'slingshot/slingshot-wood.png', width: 1024, height: 1024 },
  { file: 'menu/logo.webp', width: 1200, height: 600 },
  { file: 'ui/level-card.webp', width: 560, height: 492 },
  { file: 'ui/menu-button.webp', width: 520, height: 174 }
];

let beforeTotal = 0;
let afterTotal = 0;
const locked = [];
for (const t of TARGETS) {
  const p = join(IMG, t.file);
  try {
    const before = statSync(p).size;
    const isPng = p.endsWith('.png');
    let pipe = sharp(p).resize(t.width, t.height, { kernel: 'lanczos3', fit: 'fill' });
    pipe = isPng
      ? pipe.png({ compressionLevel: 9, palette: true, quality: 92 })
      : pipe.webp({ quality: 90, alphaQuality: 100 });
    // write via buffer (no temp-file rename: Windows EPERM on locked targets)
    const buf = await pipe.toBuffer();
    const { writeFileSync } = await import('node:fs');
    let wrote = false;
    for (let attempt = 0; attempt < 4 && !wrote; attempt++) {
      try { writeFileSync(p, buf); wrote = true; }
      catch { await new Promise((r) => setTimeout(r, 600)); }
    }
    if (!wrote) throw new Error('file locked by another process');
    const after = statSync(p).size;
    beforeTotal += before;
    afterTotal += after;
    const kb = (n) => (n / 1024).toFixed(0) + 'KB';
    console.log(`${t.file.padEnd(30)} ${kb(before).padStart(7)} → ${kb(after).padStart(7)}  (${t.width}×${t.height})`);
  } catch (e) {
    locked.push(t.file);
    console.log(`${t.file.padEnd(30)} SKIPPED (${e.message}) — retry later`);
  }
}
console.log(`total ${ (beforeTotal / 1024).toFixed(0) }KB → ${ (afterTotal / 1024).toFixed(0) }KB`);
if (locked.length) {
  console.log(`locked (run this script again when the other session's servers stop): ${locked.join(', ')}`);
}
