/**
 * XL PANEL LAYOUT ADJUSTMENT — adapts the tower layouts of every question
 * whose answers render on the wide XL parchment panel (measurement-selected:
 * all of levels 8 and 13), plus two pre-existing tight spots flagged by the
 * panel-geometry audit (L4Q4 / L7Q3 same-height L panels 4px apart).
 *
 * Rules applied (see tests/answer-panel-tests.mjs — the audit that gates this):
 *   - every XL panel rests on a real support (beam / crate / post / ground)
 *   - panel AABBs keep >= 12px separation in x or y
 *   - panels stay inside the world, below the HUD band (y >= 84)
 *   - clear of the resting question card (x >= 740 when the panel top is
 *     above y ~230) and clear of vertical movers
 *   - towers stay physically stable (verified by the settle battery)
 *
 * Idempotent: run once; re-running detects the already-adjusted state.
 *
 * Run: node scripts/adjust-xl-layouts.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const LEVELS = join(here, '../js/data/levels.json');
const data = JSON.parse(readFileSync(LEVELS, 'utf8'));

const byQuestion = new Map();
for (const lvl of data.levels) for (const q of lvl.questions) byQuestion.set(q.questionId, q);

const pieceId = (qid, n) => `${qid}-xl${n}`;

/** Move target i (and remember the slot). */
function setTarget(qid, i, x, y) {
  const q = byQuestion.get(qid);
  q.layout.targets[i].x = x;
  q.layout.targets[i].y = y;
}

/** Move a piece identified by asset + rounded position. */
function movePiece(qid, asset, x, y, nx, ny) {
  const q = byQuestion.get(qid);
  const p = q.layout.pieces.find((pp) => pp.a === asset && Math.abs(pp.x - x) < 1 && Math.abs(pp.y - y) < 1);
  if (!p) throw new Error(`${qid}: piece ${asset}@${x},${y} not found`);
  p.x = nx; p.y = ny;
  return p;
}

function removePiece(qid, asset, x, y) {
  const q = byQuestion.get(qid);
  const i = q.layout.pieces.findIndex((pp) => pp.a === asset && Math.abs(pp.x - x) < 1 && Math.abs(pp.y - y) < 1);
  if (i === -1) throw new Error(`${qid}: piece ${asset}@${x},${y} not found`);
  return q.layout.pieces.splice(i, 1)[0];
}

function addPiece(qid, n, asset, x, y) {
  const q = byQuestion.get(qid);
  q.layout.pieces.push({ id: pieceId(qid, n), a: asset, x, y, rot: 0 });
}

function movePig(qid, x, y, nx, ny) {
  const q = byQuestion.get(qid);
  const pig = (q.layout.pigs || []).find((pp) => Math.abs(pp.x - x) < 1 && Math.abs(pp.y - y) < 1);
  if (!pig) throw new Error(`${qid}: pig@${x},${y} not found`);
  pig.x = nx; pig.y = ny;
}

if (byQuestion.get('q08_1').layout.targets[1].y === 254) {
  console.log('layouts already adjusted — nothing to do');
  process.exit(0);
}

/* ---- q08_1: crate tops get beams; far target raised on a glass post ----- */
// t0 645 stays on its ground crate (support 88, top 247 clears the card)
movePiece('q08_1', 'wood_crate_cross', 895, 386, 965, 386);
addPiece('q08_1', 1, 'wood_beam_h', 965, 319);      // beam on the moved crate
setTarget('q08_1', 1, 965, 254);                    // slot on the beam top 294
addPiece('q08_1', 2, 'glass_column', 1111, 226);    // post on the glass beam
setTarget('q08_1', 2, 1111, 142);                   // slot on the post top 182
removePiece('q08_1', 'wood_beam_v', 765, 361);      // totem inside t0's XL span
removePiece('q08_1', 'wood_triangle', 765, 256);

/* ---- q08_2: mid tower right + wood cap; far tower removed, t2 grounded -- */
movePiece('q08_2', 'glass_column', 749, 384, 825, 384);
movePiece('q08_2', 'glass_column', 901, 384, 955, 384);
movePiece('q08_2', 'glass_beam_h', 825, 305, 890, 305);
removePiece('q08_2', 'stone_block_s', 825, 241);
addPiece('q08_2', 1, 'wood_beam_h', 890, 245);      // cap beam: slot 180
setTarget('q08_2', 1, 890, 180);
movePiece('q08_2', 'wood_crate_cross', 645, 386, 635, 386);
setTarget('q08_2', 0, 635, 304);
removePiece('q08_2', 'wood_beam_v', 1044, 361);
removePiece('q08_2', 'wood_beam_v', 1168, 361);
removePiece('q08_2', 'wood_beam_h', 1106, 269);
setTarget('q08_2', 2, 1106, 386);                   // grounded far target
movePig('q08_2', 1106, 400, 750, 400);

/* ---- q08_3: near stack lowered; mid target right; far target on a stand -- */
removePiece('q08_3', 'wood_crate_cross', 688, 317); // panel rides the two crates
setTarget('q08_3', 0, 688, 319);
setTarget('q08_3', 1, 1010, 386);
addPiece('q08_3', 1, 'wood_crate_cross', 1110, 386);
addPiece('q08_3', 2, 'wood_beam_h', 1110, 319);
setTarget('q08_3', 2, 1110, 252);

/* ---- q08_4: mid tower right + wood cap; far tower removed, t2 grounded -- */
movePiece('q08_4', 'glass_column', 749, 384, 825, 384);
movePiece('q08_4', 'glass_column', 901, 384, 955, 384);
movePiece('q08_4', 'glass_beam_h', 825, 305, 890, 305);
removePiece('q08_4', 'stone_block_s', 825, 241);
addPiece('q08_4', 1, 'wood_beam_h', 890, 245);
setTarget('q08_4', 1, 890, 180);
movePiece('q08_4', 'wood_crate_cross', 645, 386, 635, 386);
setTarget('q08_4', 0, 635, 304);
removePiece('q08_4', 'glass_column', 1051, 384);
removePiece('q08_4', 'glass_column', 1171, 384);
removePiece('q08_4', 'glass_beam_h', 1111, 305);
setTarget('q08_4', 2, 1111, 386);

/* ---- q13_1: mid tower rebuilt one storey lower (card + HUD clearance) --- */
movePiece('q13_1', 'glass_column', 761, 384, 825, 384);
movePiece('q13_1', 'glass_column', 869, 384, 955, 384);
movePiece('q13_1', 'glass_beam_h', 815, 305, 890, 305);
removePiece('q13_1', 'glass_block_s', 783, 241);
removePiece('q13_1', 'glass_block_s', 847, 241);
removePiece('q13_1', 'glass_beam_h', 815, 177);
addPiece('q13_1', 1, 'wood_beam_h', 890, 245);
setTarget('q13_1', 1, 890, 180);
movePiece('q13_1', 'wood_crate_cross', 645, 386, 705, 386); // clear of the mover
setTarget('q13_1', 0, 705, 304);
setTarget('q13_1', 2, 1118, 386);

/* ---- q13_2 / q13_4: mid tower right + wood cap; far target edge-safe ----- */
for (const qid of ['q13_2', 'q13_4']) {
  movePiece(qid, 'glass_column', 749, 384, 825, 384);
  movePiece(qid, 'glass_column', 901, 384, 955, 384);
  movePiece(qid, 'glass_beam_h', 825, 305, 890, 305);
  removePiece(qid, 'stone_block_s', 825, 241);
  addPiece(qid, 1, 'wood_beam_h', 890, 245);
  setTarget(qid, 1, 890, 180);
  movePiece(qid, 'wood_crate_cross', 645, 386, 635, 386);
  setTarget(qid, 0, 635, 304);
}
setTarget('q13_4', 2, 1118, 386); // q13_2 far target already fits at 1100

/* ---- q13_3: leaning tower right of the card; far target edge-safe -------- */
movePiece('q13_3', 'stone_block_l', 870, 390, 885, 390);
movePiece('q13_3', 'wood_crate_cross', 870, 310, 885, 310);
movePiece('q13_3', 'wood_crate_cross', 870, 226, 885, 226);
setTarget('q13_3', 1, 885, 144);
setTarget('q13_3', 2, 1118, 386);

/* ---- q04_4 / q07_3: pre-existing 4px gap between same-height L panels ---- */
for (const qid of ['q04_4', 'q07_3']) {
  movePiece(qid, 'wood_crate_cross', 700, 386, 810, 386);
  setTarget(qid, 1, 810, 304);
}

writeFileSync(LEVELS, JSON.stringify(data, null, 2) + '\n');
console.log('levels.json updated (XL layouts + two L-format spacing fixes)');
