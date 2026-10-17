/**
 * ASSET TRIM PASS — the systemic fix for "floating pieces / ground gaps".
 *
 * The shipped tower PNGs carry ~8px of transparent padding on every side.
 * createPiece() sizes the WHOLE canvas to the manifest's logical `size`
 * (setDisplaySize), so the painted content ended up 3–6.5px smaller than
 * the collider on every side — worst at the bottom, which read as pieces
 * hovering above the grass and resting surfaces.
 *
 * This script rewrites each PNG cropped to its visible content (plus a 1px
 * safety pad), and updates the manifest's `content` fields to the new
 * canvas dims. After the trim, canvas == content, and setDisplaySize(size)
 * paints the art edge-to-edge with the physics body: resting faces touch
 * EXACTLY, matching the zero-overlap stacking math in towers.js.
 *
 * Run: node scripts/trim-tower-assets.mjs [--check]
 *   --check  measure only, exit 1 if any asset still has >2px padding
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { TOWER_ASSETS } from '../js/data/tower-assets.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const BASE = join(root, 'public/assets/images/tower/');
const MANIFEST = join(root, 'js/data/tower-assets.js');
const PAD = 1; // keep 1 transparent px so linear texture filtering never
//               samples past the painted edge

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');

async function contentBox(file) {
  const img = sharp(file).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const a = data[(y * info.width + x) * info.channels + (info.channels - 1)];
      if (a > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1, cw: info.width, ch: info.height };
}

const report = [];
let idx = 0;
const manifest = readFileSync(MANIFEST, 'utf8');
const contentRegex = /content: \[\d+, \d+\]/g;
const matches = [...manifest.matchAll(contentRegex)];
const keys = Object.keys(TOWER_ASSETS);
if (matches.length !== keys.length) {
  console.error(`manifest mismatch: ${matches.length} content fields vs ${keys.length} assets`);
  process.exit(1);
}

let newManifest = manifest;
for (const key of keys) {
  const a = TOWER_ASSETS[key];
  const file = join(BASE, a.file);
  const box = await contentBox(file);
  const padL = Math.max(0, box.minX - PAD);
  const padT = Math.max(0, box.minY - PAD);
  const cropW = Math.min(box.cw - padL, box.w + PAD * 2);
  const cropH = Math.min(box.ch - padT, box.h + PAD * 2);
  const trimmed = [cropW, cropH];
  const worstPad = Math.max(padL, box.cw - padL - cropW, padT, box.ch - padT - cropH);
  report.push({ key, was: `${box.cw}x${box.ch}`, now: `${cropW}x${cropH}`, worstPad });
  if (CHECK_ONLY) continue;
  const buf = await sharp(file)
    .extract({ left: padL, top: padT, width: cropW, height: cropH })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(file, buf);
  // update this asset's content field, in manifest declaration order
  newManifest = newManifest.replace(`content: [${a.content[0]}, ${a.content[1]}]`,
    `content: [${trimmed[0]}, ${trimmed[1]}]`);
}

if (!CHECK_ONLY) writeFileSync(MANIFEST, newManifest);

for (const r of report) {
  console.log(`${r.key.padEnd(20)} ${r.was.padEnd(10)} -> ${r.now.padEnd(10)} worst pad ${r.worstPad}px`);
}
const bad = report.filter((r) => r.worstPad > 2);
if (CHECK_ONLY && bad.length) {
  console.error(`\n${bad.length} asset(s) still carry padding`);
  process.exit(1);
}
console.log(CHECK_ONLY ? '\nall assets trimmed' : `\ntrimmed ${report.length} assets; manifest content fields updated`);
