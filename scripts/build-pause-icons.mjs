/**
 * Pause-menu icon assets — polished cartoon SVG artwork rendered to PNG by
 * sharp (the project's established asset pipeline: sources deterministic,
 * outputs into public/assets, license-clean original work).
 *
 *   public/assets/images/ui/pause/restart-icon.png  (192×192, alpha)
 *   public/assets/images/ui/pause/home-icon.png     (192×192, alpha)
 *
 * Style contract — the game's existing icon language (see TEX.pauseIcon /
 * TEX.playIcon in GameHUD.js): cream parchment fills (#fff7e0 family),
 * dark brown outlines (#3a2410), warm amber roofs/doors, golden accents,
 * soft baked drop shadows. Rendered at 192 px for ~7× supersampling at
 * HUD sizes (crisp on phones at DPR 2–3).
 *
 * The runtime falls back to the small procedural textures (headless test
 * environments) when these PNGs are unreachable — same pattern as every
 * other artwork in the game.
 *
 * Run:  node scripts/build-pause-icons.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(root, '..', 'public', 'assets', 'images', 'pause');
mkdirSync(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Restart — chunky three-quarter circle with a big tangential head    */
/* ------------------------------------------------------------------ */
const RESTART_SVG = `<svg width="192" height="192" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="creamArc" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffbe8"/>
      <stop offset="1" stop-color="#eddca9"/>
    </linearGradient>
    <linearGradient id="creamHead" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffae0"/>
      <stop offset="1" stop-color="#eed89c"/>
    </linearGradient>
  </defs>
  <!-- soft baked shadow (arc + head silhouette, offset) -->
  <path d="M 128 55 A 58 58 0 1 1 46.4 81" fill="none"
        stroke="#1c1006" stroke-opacity="0.32" stroke-width="30" stroke-linecap="round"/>
  <polygon points="155,71.4 137.5,34.2 114.1,74.8" fill="#1c1006" opacity="0.32"/>
  <!-- dark outline arc -->
  <path d="M 125 49.8 A 58 58 0 1 1 43.4 75.5" fill="none"
        stroke="#3a2410" stroke-width="30" stroke-linecap="round"/>
  <!-- cream face arc -->
  <path d="M 125 49.8 A 58 58 0 1 1 43.4 75.5" fill="none"
        stroke="url(#creamArc)" stroke-width="19" stroke-linecap="round"/>
  <!-- arrowhead: dark base ring, cream face, gloss -->
  <polygon points="152,65.4 134.5,28.2 111.1,68.8" fill="#3a2410"
           stroke="#3a2410" stroke-width="6" stroke-linejoin="round"/>
  <polygon points="147.5,62.8 134,34.2 116,65.4" fill="url(#creamHead)"
           stroke="#3a2410" stroke-width="2.5" stroke-linejoin="round"/>
  <polygon points="145,59.5 139.5,46.5 134.5,57.5" fill="#ffffff" opacity="0.55"/>
</svg>`;

/* ------------------------------------------------------------------ */
/* Home — cartoon cottage: amber roof with eaves, cream plank wall,    */
/* arched door with a golden knob, chimney                             */
/* ------------------------------------------------------------------ */
const HOME_SVG = `<svg width="192" height="192" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffbe8"/>
      <stop offset="1" stop-color="#eedca9"/>
    </linearGradient>
    <linearGradient id="roof" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f0ba6e"/>
      <stop offset="1" stop-color="#cd8f45"/>
    </linearGradient>
    <linearGradient id="doorG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a06c34"/>
      <stop offset="1" stop-color="#7c4e1e"/>
    </linearGradient>
  </defs>
  <!-- soft baked shadow -->
  <g transform="translate(3,6)" fill="#1c1006" opacity="0.3">
    <rect x="44" y="82" width="104" height="80" rx="10"/>
    <polygon points="96,22 174,90 18,90"/>
  </g>
  <!-- chimney (roof drawn over its base) -->
  <rect x="127" y="34" width="27" height="38" rx="5" fill="url(#roof)"
        stroke="#3a2410" stroke-width="9"/>
  <!-- plank wall -->
  <rect x="44" y="82" width="104" height="80" rx="10" fill="url(#wall)"
        stroke="#3a2410" stroke-width="10"/>
  <line x1="57" y1="113" x2="135" y2="113" stroke="#3a2410" stroke-opacity="0.14" stroke-width="5"/>
  <line x1="57" y1="136" x2="135" y2="136" stroke="#3a2410" stroke-opacity="0.14" stroke-width="5"/>
  <!-- arched door + knob -->
  <path d="M 82 162 L 82 126 Q 82 110 96 110 Q 110 110 110 126 L 110 162 Z"
        fill="url(#doorG)" stroke="#3a2410" stroke-width="9" stroke-linejoin="round"/>
  <circle cx="104" cy="141" r="5" fill="#ffd166" stroke="#3a2410" stroke-width="4"/>
  <!-- roof with overhanging eaves -->
  <polygon points="96,22 174,90 18,90" fill="url(#roof)"
           stroke="#3a2410" stroke-width="11" stroke-linejoin="round"/>
  <!-- right-slope shine -->
  <line x1="99" y1="33" x2="152" y2="82" stroke="#ffe9c0" stroke-opacity="0.55"
        stroke-width="8" stroke-linecap="round"/>
</svg>`;

const jobs = [
  { name: 'restart icon (circular arrow)', svg: RESTART_SVG, file: 'restart-icon.png' },
  { name: 'home icon (cottage)', svg: HOME_SVG, file: 'home-icon.png' }
];

for (const job of jobs) {
  const out = join(OUT_DIR, job.file);
  await sharp(Buffer.from(job.svg)).png().toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${job.name}: ${meta.width}×${meta.height} -> ${job.file}`);
}
console.log('done ->', OUT_DIR);
