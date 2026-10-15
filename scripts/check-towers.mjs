/**
 * TEMPLATE GEOMETRY CHECKER — mechanically verifies every tower template:
 *   1. all piece keys exist in the asset manifest
 *   2. min piece dimension >= TUNNELING.MIN_PIECE_DIM
 *   3. pieces rest on something (ground, or another piece's top face with
 *      horizontal overlap) — no floating pieces
 *   4. no initial interpenetration (SAT for rotated rects, circle checks)
 *   5. declared width/height enclose the real footprint
 *   6. slots sit just above a supporting surface
 *
 * Run: node scripts/check-towers.mjs   (exit 1 on any violation)
 */
import { TEMPLATES } from '../js/data/towers.js';
import { TOWER_ASSETS } from '../js/data/tower-assets.js';
import { TUNNELING } from '../js/config.js';

const PLAQUE_W = 116, PLAQUE_H = 80;

function corners(p) {
  const a = TOWER_ASSETS[p.a];
  const [w, h] = a.size;
  const rot = ((p.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const dx = w / 2, dy = h / 2;
  return [
    [-dx, -dy], [dx, -dy], [dx, dy], [-dx, dy]
  ].map(([lx, ly]) => ({
    x: p.x + lx * cos - ly * sin,
    y: p.y - lx * sin - ly * cos // template y grows up
  }));
}

function satOverlap(cA, cB) {
  const axes = [];
  for (const cs of [cA, cB]) {
    for (let i = 0; i < 2; i++) {
      const ax = cs[i + 1].x - cs[i].x, ay = cs[i + 1].y - cs[i].y;
      const len = Math.hypot(ax, ay) || 1;
      axes.push({ x: -ay / len, y: ax / len });
    }
  }
  for (const axis of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const c of cA) { const d = c.x * axis.x + c.y * axis.y; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
    for (const c of cB) { const d = c.x * axis.x + c.y * axis.y; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
    if (maxA <= minB || maxB <= minA) return { overlap: false, depth: 0 };
  }
  // overlap depth: smallest axis penetration
  let depth = Infinity;
  for (const axis of axes) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const c of cA) { const d = c.x * axis.x + c.y * axis.y; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
    for (const c of cB) { const d = c.x * axis.x + c.y * axis.y; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
    depth = Math.min(depth, Math.min(maxA - minB, maxB - minA));
  }
  return { overlap: true, depth };
}

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };

for (const [name, t] of Object.entries(TEMPLATES)) {
  console.log(`template ${name} (${t.pieces.length} pieces, ${t.slots.length} slots, ${t.pigs.length} pigs)`);
  const bodies = [...t.pieces, ...t.pigs.map((p) => ({ ...p }))];

  for (const p of bodies) {
    const a = TOWER_ASSETS[p.a];
    if (!a) { fail(`${p.a}: not in manifest`); continue; }
    if (a.collider.shape !== 'none' && Math.min(...a.size) < TUNNELING.MIN_PIECE_DIM) {
      fail(`${p.a}: min dim ${Math.min(...a.size)} < ${TUNNELING.MIN_PIECE_DIM}`);
    }
    if (p.y < 0) fail(`${p.a} at y=${p.y}: below ground`);
  }

  // pairwise overlap (skip decor pieces without colliders)
  const solid = bodies.filter((p) => TOWER_ASSETS[p.a] && TOWER_ASSETS[p.a].collider.shape !== 'none');
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const r = satOverlap(corners(solid[i]), corners(solid[j]));
      if (r.overlap && r.depth > 1.5) {
        fail(`${solid[i].a} #${i} overlaps ${solid[j].a} #${j} by ${r.depth.toFixed(1)}px`);
      }
    }
  }

  // support check: every solid piece's bottom must be backed by ground or a top face
  // (template y grows UP: a piece's bottom face is its MINIMUM y)
  for (let i = 0; i < solid.length; i++) {
    const p = solid[i];
    const cs = corners(p);
    const bottomY = Math.min(...cs.map((c) => c.y));
    const minX = Math.min(...cs.map((c) => c.x));
    const maxX = Math.max(...cs.map((c) => c.x));
    if (bottomY <= 0.6) continue; // rests on the ground
    let supported = false;
    for (let j = 0; j < solid.length; j++) {
      if (i === j) continue;
      const q = solid[j];
      const qcs = corners(q);
      const qTop = Math.max(...qcs.map((c) => c.y));
      const qMinX = Math.min(...qcs.map((c) => c.x));
      const qMaxX = Math.max(...qcs.map((c) => c.x));
      const gapY = Math.abs(qTop - bottomY);
      const xOverlap = Math.min(maxX, qMaxX) - Math.max(minX, qMinX);
      if (gapY < 2.5 && xOverlap > 8) { supported = true; break; }
    }
    if (!supported) fail(`${p.a} #${i} at (${p.x},${p.y}) floats: bottom=${bottomY.toFixed(1)} has no support`);
  }

  // slot support: each slot bottom should nearly touch a surface top
  for (const s of t.slots) {
    const slotBottom = s.y - PLAQUE_H / 2;
    let ok = Math.abs(slotBottom) < 2.5; // ground slot
    if (!ok) {
      for (const q of solid) {
        const qcs = corners(q);
        const qTop = Math.max(...qcs.map((c) => c.y));
        const qMinX = Math.min(...qcs.map((c) => c.x));
        const qMaxX = Math.max(...qcs.map((c) => c.x));
        if (Math.abs(qTop - slotBottom) < 2.5 && Math.min(s.x + PLAQUE_W / 2, qMaxX) - Math.max(s.x - PLAQUE_W / 2, qMinX) > 20) {
          ok = true; break;
        }
      }
    }
    if (!ok) fail(`slot (${s.x},${s.y}) floats: bottom=${slotBottom.toFixed(1)} unsupported`);
  }

  // footprint / height declaration
  const allX = bodies.flatMap((p) => corners(p).map((c) => c.x));
  const allBottom = bodies.flatMap((p) => corners(p).map((c) => c.y));
  const realW = Math.max(...allX) - Math.min(...allX);
  const slotTop = Math.max(...t.slots.map((s) => s.y + PLAQUE_H / 2), ...allBottom);
  const realH = slotTop;
  if (realW > t.width + 1) fail(`declared width ${t.width} < real ${realW.toFixed(0)}`);
  if (realH > t.height + 1) fail(`declared height ${t.height} < real ${realH.toFixed(0)}`);
  console.log(`  footprint ${realW.toFixed(0)}w x ${realH.toFixed(0)}h (declared ${t.width}x${t.height})`);
}

if (failures) {
  console.log(`\n${failures} violation(s)`);
  process.exit(1);
}
console.log('\nall templates valid');
