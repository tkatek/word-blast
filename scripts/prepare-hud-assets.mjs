/**
 * Prepare the supplied blank wooden HUD artwork for runtime use.
 *
 *   originals  -> assets-src/hud/                  (untouched sources)
 *   runtime    -> public/assets/images/ui/hud/     (alpha-trimmed, resized
 *                 to ~3x the largest display size, palettised PNGs)
 *
 * Trim rects and aspect ratios were measured by scripts/measure-hud-art.mjs
 * (pixel-accurate alpha scan + centre-tone run scan). The wide single-cell
 * strip asset is intentionally NOT shipped: the individual panels compose a
 * cleaner HUD and a second backing bar would only add thickness.
 *
 * Run: node scripts/prepare-hud-assets.mjs [sourceDir]
 */
import sharp from 'sharp';
import { mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = process.argv[2] || 'C:/Users/HP/AppData/Local/Temp/hud_assets/top bar elements';
const KEEP = join(root, 'assets-src', 'hud');
const OUT = join(root, 'public', 'assets', 'images', 'ui', 'hud');

/** source file -> { name, trim:[x,y,w,h], outH } (outH ≈ 3× display px) */
const SPECS = [
  { src: 'Image ChatGPT 18 oct. 2026, 15_56_06-1.png', name: 'pause-button-bg.png',   trim: [79, 64, 1096, 1110], outH: 220 },
  { src: 'Image ChatGPT 18 oct. 2026, 15_56_10-2.png', name: 'sound-button-bg.png',   trim: [117, 117, 1017, 1011], outH: 220 },
  { src: 'Image ChatGPT 18 oct. 2026, 15_56_11-3.png', name: 'level-panel-bg.png',    trim: [18, 74, 2144, 563], outH: 200 },
  { src: 'Image ChatGPT 18 oct. 2026, 15_56_12-4.png', name: 'progress-panel-bg.png', trim: [15, 123, 2143, 422], outH: 198 },
  { src: 'Image ChatGPT 18 oct. 2026, 15_56_14-5.png', name: 'hearts-panel-bg.png',   trim: [38, 176, 1707, 523], outH: 162 },
  { src: 'Image ChatGPT 18 oct. 2026, 15_56_15-6.png', name: 'shots-panel-bg.png',    trim: [77, 106, 1626, 648], outH: 162 },
  { src: 'Image ChatGPT 18 oct. 2026, 15_56_16-7.png', name: 'score-panel-bg.png',    trim: [25, 107, 1735, 680], outH: 162 }
];

mkdirSync(KEEP, { recursive: true });
mkdirSync(OUT, { recursive: true });

console.log('source dir:', SRC);
const srcFiles = readdirSync(SRC).filter((f) => f.endsWith('.png'));
console.log('source files:', srcFiles.length);

let totalBefore = 0;
let totalAfter = 0;
for (const spec of SPECS) {
  const from = join(SRC, spec.src);
  const keepPath = join(KEEP, spec.src.replace(/^Image ChatGPT [^,]+, /, ''));
  const outPath = join(OUT, spec.name);
  if (!statSync(from)) throw new Error(`missing source ${spec.src}`);

  // preserve the original once (bit-identical copy)
  if (!statSync(keepPath, { throwIfNoEntry: false })) copyFileSync(from, keepPath);

  const [x, y, w, h] = spec.trim;
  const outW = Math.round(spec.outH * (w / h));
  const before = statSync(from).size;
  await sharp(from)
    .ensureAlpha()
    .extract({ left: x, top: y, width: w, height: h })
    .resize(outW, spec.outH, { fit: 'fill' }) // exact target box; ratio preserved by construction
    .png({ palette: true, quality: 92, compressionLevel: 9, effort: 10 })
    .toFile(outPath);
  const after = statSync(outPath).size;
  totalBefore += before;
  totalAfter += after;
  console.log(
    `${spec.name.padEnd(22)} ${w}x${h} -> ${outW}x${spec.outH}  ` +
    `${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`
  );
}
console.log(`total ${(totalBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalAfter / 1024).toFixed(0)}KB`);
