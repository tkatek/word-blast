/**
 * FEEDBACK CARD BUILDER — bakes the blank wooden parchment feedback panel
 * ("correct / wrong answer" card background) as a transparent PNG.
 *
 * Design contract (from the supplied reference mockup):
 *   - rounded wooden frame built from planks (vertical on the sides,
 *     horizontal rails top/bottom), chocolate edge + warm plank shades;
 *   - warm parchment center with a soft vignette (no baked text!);
 *   - four metal bolts inset in the frame corners;
 *   - green leaf sprigs overlapping the top corners;
 *   - soft drop shadow baked with alpha so it scales with the card.
 *
 * Everything else (green/red status header, badge, texts, button) is drawn
 * dynamically by js/systems/FeedbackCard.js — this PNG stays BLANK.
 *
 * Output: public/assets/images/ui/feedback-card.png  (1120×800 @2x)
 * Run:    node scripts/build-feedback-card.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.fileToUrl ? import.meta.url : import.meta.url));
const OUT = join(here, '..', 'public', 'assets', 'images', 'ui', 'feedback-card.png');
mkdirSync(dirname(OUT), { recursive: true });

const W = 1120;
const H = 800;

const EDGE = '#5d3a1a';
const PLANK_LIGHT = '#b98b5e';
const PLANK_MID = '#a06e3f';
const PLANK_DARK = '#7a4e26';
const PARCH = '#f9eac5';
const PARCH_EDGE = '#e8d5a8';
const PARCH_CORNER = '#dcc48e';
const BOLT_OUTER = '#8d8d99';
const BOLT_INNER = '#5a5a66';
const LEAF_HI = '#3e8e41';
const LEAF_LO = '#1b5e20';

const R = 44;          // card corner radius
const FRAME = 64;      // frame thickness
const BOLT_R = 17;

const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(1234);

/** Short horizontal wood-grain strokes on a rail. */
function railGrain(x0, x1, y, count, color, op) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const gx = x0 + rnd() * (x1 - x0);
    const gy = y + 6 + rnd() * (FRAME - 20);
    const gw = 26 + rnd() * 60;
    s += `<line x1="${gx}" y1="${gy}" x2="${gx + gw}" y2="${gy}" stroke="${color}" stroke-width="4" stroke-linecap="round" opacity="${op}"/>`;
  }
  return s;
}

/** Vertical grain strokes on a side plank. */
function sideGrain(x, y0, y1, count, color, op) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const gx = x + 6 + rnd() * (FRAME - 20);
    const gy = y0 + rnd() * (y1 - y0 - 30);
    const gh = 22 + rnd() * 52;
    s += `<line x1="${gx}" y1="${gy}" x2="${gx}" y2="${gy + gh}" stroke="${color}" stroke-width="4" stroke-linecap="round" opacity="${op}"/>`;
  }
  return s;
}

/** One leaf sprig: 5 leaves fanned along a gentle arc, pointing inward. */
function leafSprig(cx, cy, flip) {
  const k = flip ? -1 : 1;
  let s = `<g transform="translate(${cx},${cy}) scale(${k},1)">`;
  const leaves = [
    { a: -158, l: 64, w: 26 }, { a: -128, l: 72, w: 30 }, { a: -100, l: 68, w: 28 },
    { a: -74, l: 58, w: 24 }, { a: -48, l: 46, w: 20 }
  ];
  for (const lv of leaves) {
    const rad = lv.a * Math.PI / 180;
    const tipX = Math.cos(rad) * lv.l;
    const tipY = Math.sin(rad) * lv.l;
    const ctlX = Math.cos(rad) * lv.l * 0.55 - Math.sin(rad) * lv.w;
    const ctlY = Math.sin(rad) * lv.l * 0.55 + Math.cos(rad) * lv.w * 0.35;
    const ctl2X = Math.cos(rad) * lv.l * 0.55 + Math.sin(rad) * lv.w;
    const ctl2Y = Math.sin(rad) * lv.l * 0.55 - Math.cos(rad) * lv.w * 0.35;
    s += `<path d="M0,0 Q${ctlX},${ctlY} ${tipX},${tipY} Q${ctl2X},${ctl2Y} 0,0 Z" fill="url(#leaf)" stroke="#1b5e20" stroke-width="2.5"/>`;
    s += `<line x1="0" y1="0" x2="${tipX * 0.8}" y2="${tipY * 0.8}" stroke="#2e7d32" stroke-width="2" opacity="0.7"/>`;
  }
  return s + '</g>';
}

/** Metal bolt with six-sided shading + specular dot. */
function bolt(cx, cy) {
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${BOLT_R}" fill="${BOLT_OUTER}"/>
    <circle cx="${cx}" cy="${cy}" r="${BOLT_R}" fill="none" stroke="#3f3f47" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="${BOLT_R - 6}" fill="${BOLT_INNER}"/>
    <polygon points="${cx - 6},${cy - 4} ${cx + 2},${cy - 8} ${cx + 7},${cy + 1} ${cx - 2},${cy + 7} ${cx - 8},${cy + 3}" fill="#74747f"/>
    <circle cx="${cx - 5}" cy="${cy - 6}" r="3.4" fill="#ffffff" opacity="0.85"/>
  </g>`;
}

const innerX = FRAME;
const innerY = FRAME;
const innerW = W - FRAME * 2;
const innerH = H - FRAME * 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="leaf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${LEAF_HI}"/>
      <stop offset="1" stop-color="${LEAF_LO}"/>
    </linearGradient>
    <radialGradient id="parchVin" cx="0.5" cy="0.42" r="0.75">
      <stop offset="0" stop-color="${PARCH}"/>
      <stop offset="0.72" stop-color="${PARCH}"/>
      <stop offset="1" stop-color="${PARCH_EDGE}"/>
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#1a0f05" flood-opacity="0.35"/>
    </filter>
    <filter id="leafShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#12300f" flood-opacity="0.4"/>
    </filter>
  </defs>

  <!-- soft drop shadow under the whole panel -->
  <g filter="url(#softShadow)">
    <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="${R}" fill="${EDGE}"/>
  </g>

  <!-- frame ring: planks -->
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="${R}" fill="${PLANK_MID}"/>
  <!-- alternate plank bands around the ring (top & bottom rails split in 3, sides in 4) -->
  <g>
    <rect x="${4 + R * 0.6}" y="4" width="${(W - 8) / 3 - R * 0.4}" height="${FRAME}" fill="${PLANK_LIGHT}"/>
    <rect x="${4 + (W - 8) / 3}" y="4" width="${(W - 8) / 3}" height="${FRAME}" fill="${PLANK_DARK}" opacity="0.55"/>
    <rect x="${4 + 2 * (W - 8) / 3}" y="4" width="${(W - 8) / 3 - R * 0.6}" height="${FRAME}" fill="${PLANK_LIGHT}"/>
    <rect x="${4 + R * 0.6}" y="${H - 4 - FRAME}" width="${(W - 8) / 3 - R * 0.4}" height="${FRAME}" fill="${PLANK_DARK}" opacity="0.75"/>
    <rect x="${4 + (W - 8) / 3}" y="${H - 4 - FRAME}" width="${(W - 8) / 3}" height="${FRAME}" fill="${PLANK_LIGHT}"/>
    <rect x="${4 + 2 * (W - 8) / 3}" y="${H - 4 - FRAME}" width="${(W - 8) / 3 - R * 0.6}" height="${FRAME}" fill="${PLANK_MID}"/>
    <rect x="4" y="${4 + R * 0.6}" width="${FRAME}" height="${(H - 8) / 2 - R * 0.4}" fill="${PLANK_LIGHT}"/>
    <rect x="4" y="${4 + (H - 8) / 2}" width="${FRAME}" height="${(H - 8) / 2 - R * 0.6}" fill="${PLANK_DARK}" opacity="0.6"/>
    <rect x="${W - 4 - FRAME}" y="${4 + R * 0.6}" width="${FRAME}" height="${(H - 8) / 2 - R * 0.4}" fill="${PLANK_MID}"/>
    <rect x="${W - 4 - FRAME}" y="${4 + (H - 8) / 2}" width="${FRAME}" height="${(H - 8) / 2 - R * 0.6}" fill="${PLANK_LIGHT}"/>
  </g>
  <!-- frame inner + outer bevels -->
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="${R}" fill="none" stroke="${EDGE}" stroke-width="8"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="${R - 6}" fill="none" stroke="${PLANK_LIGHT}" stroke-width="4" opacity="0.55"/>
  <rect x="${innerX - 6}" y="${innerY - 6}" width="${innerW + 12}" height="${innerH + 12}" rx="26" fill="none" stroke="${PLANK_DARK}" stroke-width="10" opacity="0.85"/>
  <!-- wood grain -->
  ${railGrain(4 + R, W - 4 - R, 4, 9, EDGE, 0.25)}
  ${railGrain(4 + R, W - 4 - R, H - 4 - FRAME, 9, EDGE, 0.25)}
  ${sideGrain(4, 4 + R, H - 4 - R, 8, EDGE, 0.22)}
  ${sideGrain(W - 4 - FRAME, 4 + R, H - 4 - R, 8, EDGE, 0.22)}

  <!-- parchment center with warm vignette -->
  <rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="22" fill="url(#parchVin)"/>
  <!-- parchment corner stains -->
  <ellipse cx="${innerX + 60}" cy="${innerY + 52}" rx="120" ry="70" fill="${PARCH_CORNER}" opacity="0.35"/>
  <ellipse cx="${innerX + innerW - 70}" cy="${innerY + innerH - 60}" rx="140" ry="80" fill="${PARCH_CORNER}" opacity="0.3"/>
  <ellipse cx="${innerX + innerW / 2}" cy="${innerY + innerH - 40}" rx="240" ry="60" fill="${PARCH_EDGE}" opacity="0.4"/>
  <!-- inner shadow ring (parchment sits below the frame) -->
  <rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="22" fill="none" stroke="#8a6a3a" stroke-width="5" opacity="0.45"/>

  <!-- corner bolts -->
  ${bolt(FRAME / 2 + 14, FRAME / 2 + 14)}
  ${bolt(W - FRAME / 2 - 14, FRAME / 2 + 14)}
  ${bolt(FRAME / 2 + 14, H - FRAME / 2 - 14)}
  ${bolt(W - FRAME / 2 - 14, H - FRAME / 2 - 14)}

  <!-- leaf sprigs overlapping the top corners (drawn last, above the frame) -->
  <g filter="url(#leafShadow)">
    ${leafSprig(FRAME + 26, 20, false)}
    ${leafSprig(W - FRAME - 26, 20, true)}
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(OUT);
const meta = await sharp(OUT).metadata();
console.log(`feedback card baked: ${OUT} (${meta.width}x${meta.height})`);
