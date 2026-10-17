/**
 * Pixel-level verification of the rendered slingshot (desktop 1280×720).
 *
 * The canvas maps the 1280×720 world 1:1 in this viewport, so world
 * coordinates are canvas pixel coordinates. Asserts:
 *   A. the wooden TRUNK is rendered: brown wood pixels all the way down
 *      the expected trunk column, from the fork to the grass line
 *   B. BOTH fork tips carry wood + dark rubber (tip wraps)
 *   C. the bird is seated at the pouch anchor (reddish pixels there)
 *   D. the bands are attached: dark rubber pixels along the tip→pouch lines
 *   E. the base is planted: wood pixels reach GROUND_Y+GRASS_EMBED
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GROUND_Y = 471;
const ANCHOR = { x: 195, y: 346 };
const REAR_TIP = { x: 173.6, y: 342.2 };
const FRONT_TIP = { x: 216.5, y: 347.2 };
const BASE_Y = 479;

const { data, info } = await sharp(join(ROOT, 'screenshots', 'diag-fixed-idle-slingshot.png'))
  .raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => {
  const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const isWood = ([r, g, b]) => r > 70 && r < 200 && g > 35 && g < 130 && b < 90 && r > g && g >= b - 12;
const isDark = ([r, g, b]) => r < 90 && g < 70 && b < 60;
const isBirdRed = ([r, g, b]) => r > 130 && g < 110 && b < 110 && r - g > 40;

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// A. trunk column: wood present at every y from just below the fork
// junction down to the grass (sample a few x around the trunk center)
const trunkXs = [192, 196, 200];
let trunkGaps = [];
for (let y = 400; y <= GROUND_Y - 4; y += 6) {
  const hit = trunkXs.some((x) => isWood(px(x, y)));
  if (!hit) trunkGaps.push(y);
}
check('A. trunk rendered from fork to grass', trunkGaps.length === 0,
  trunkGaps.length ? `missing at y=${trunkGaps.slice(0, 5).join(',')}` : '');

// E. base planted: wood within 3px of BASE_Y at the trunk center
const nearBase = [BASE_Y - 2, BASE_Y, BASE_Y + 2].some((y) => trunkXs.some((x) => isWood(px(x, y))));
check('E. base planted at ground', nearBase, `sampled around y=${BASE_Y}`);

// B. fork tips: wood within 8px of each tip
const tipWood = (t) => {
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    if (isWood(px(t.x + dx, t.y + dy))) return true;
  }
  return false;
};
check('B1. rear (left) fork tip present', tipWood(REAR_TIP));
check('B2. front (right) fork tip present', tipWood(FRONT_TIP));

// B'. tip wraps: dark rubber near each tip
const tipRubber = (t) => {
  for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
    if (isDark(px(t.x + dx, t.y + dy))) return true;
  }
  return false;
};
check('B1\'. rubber wrap on rear tip', tipRubber(REAR_TIP));
check('B2\'. rubber wrap on front tip', tipRubber(FRONT_TIP));

// C. bird seated at the anchor
let birdHits = 0;
for (let dy = -20; dy <= 20; dy += 4) for (let dx = -20; dx <= 20; dx += 4) {
  if (isBirdRed(px(ANCHOR.x + dx, ANCHOR.y + dy))) birdHits++;
}
check('C. bird seated in the pouch at the anchor', birdHits >= 6, `${birdHits} red samples`);

// D. bands attached: dark rubber along the tip→anchor lines (sample midpoints)
const bandSample = (t) => {
  const mid = { x: (t.x + ANCHOR.x) / 2, y: (t.y + ANCHOR.y) / 2 };
  const q1 = { x: (t.x * 2 + ANCHOR.x) / 3, y: (t.y * 2 + ANCHOR.y) / 3 };
  for (const p of [mid, q1]) {
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      if (isDark(px(p.x + dx, p.y + dy))) return true;
    }
  }
  return false;
};
check('D1. rear band attached tip→pouch', bandSample(REAR_TIP));
check('D2. front band attached tip→pouch', bandSample(FRONT_TIP));

// F. aspect preserved: wood column height ≈ artwork span × scale
// (top of fork ~336.8+31*0.118 ≈ 340.5, base 479 → ~138px tall; find the
// topmost wood pixel in the slingshot x-range 150..230)
let topWood = null;
for (let y = 300; y < 500 && topWood === null; y++) {
  for (let x = 150; x <= 240; x += 2) {
    if (isWood(px(x, y))) { topWood = y; break; }
  }
}
check('F. fork tops near expected height (~340)', topWood !== null && Math.abs(topWood - 340) < 10,
  topWood === null ? 'no wood found' : `topmost wood y=${topWood}`);

console.log(failures === 0 ? '\nRENDER VERIFICATION PASSED' : `\nRENDER VERIFICATION FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
