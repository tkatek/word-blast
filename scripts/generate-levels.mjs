/**
 * LEVEL LAYOUT GENERATOR — expands tower templates into absolute piece
 * lists for all 15 levels × 4 questions, writing js/data/levels.json.
 *
 * Deterministic (seeded PRNG): the same input always produces the same
 * layouts, so data tests, headless batteries and the shipped JSON agree.
 *
 * Preserved EXACTLY from the existing file: level names, cefr,
 * shotsPerQuestion, projectiles, starThresholds, questionIds, world block.
 * Only each question's `layout` is regenerated.
 *
 * Run: node scripts/generate-levels.mjs [--out js/data/levels.json] [--seed 42]
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TEMPLATES, instantiate, templatesForTier } from '../js/data/towers.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const seedIdx = args.indexOf('--seed');
const OUT = outIdx !== -1 ? args[outIdx + 1] : join(root, 'js/data/levels.json');
const SEED = seedIdx !== -1 ? Number(args[seedIdx + 1]) : 20261015;

/** mulberry32 — small, fast, deterministic. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TERRACE_TOP = 560;           // TERRAIN.TERRACE.top (kept literal: script has no Phaser import path issue — config import works, but explicit is clearer)
const STRUCT_MIN_X = 560;          // keep the approach lane over the water gap clear
const STRUCT_MAX_X = 1195;
const PANEL_SAFE_X = 760;          // tall structures sit right of the question panel
const TALL_H = 300;
const GROUND_MARGIN = 42;          // plaque half height: ground anchor y = TERRACE_TOP - 40

function layoutQuestion(levelId, qIndex, rand) {
  const tier = levelId <= 5 ? 1 : levelId <= 10 ? 2 : 3;
  const pool = templatesForTier(tier);

  // choose 1-2 structures; early levels favor single small ones
  const twoTowers = tier === 1 ? rand() < 0.3 : rand() < 0.62;
  const chosen = [];
  const first = pool[Math.floor(rand() * pool.length)];
  chosen.push(first);
  if (twoTowers) {
    let second = pool[Math.floor(rand() * pool.length)];
    if (second === first) second = pool[(pool.indexOf(first) + 1 + Math.floor(rand() * 2)) % pool.length];
    chosen.push(second);
  }

  // place structures left→right with spacing
  const instances = [];
  let cursor = STRUCT_MIN_X + rand() * 40;
  for (const key of chosen) {
    const t = TEMPLATES[key];
    const mirror = rand() < 0.35 && key !== 'leaning_tower';
    let x = cursor + t.width / 2;
    if (x + t.width / 2 > STRUCT_MAX_X) x = STRUCT_MAX_X - t.width / 2;
    if (t.height >= TALL_H) x = Math.max(x, PANEL_SAFE_X + t.width / 2 - 40);
    x = Math.min(x, STRUCT_MAX_X - t.width / 2);
    const inst = instantiate(key, Math.round(x), TERRACE_TOP, { mirror });
    instances.push(inst);
    cursor = x + t.width / 2 + 90 + rand() * 50;
  }

  // collect anchors for the 3 answer plaques: structure slots first, then
  // clear ground positions on the terrace
  const anchors = [];
  const occupied = []; // x-ranges blocked by structures (footprint + margin)
  for (const inst of instances) {
    for (const s of inst.slots) anchors.push({ x: s.x, y: s.y });
    occupied.push([inst.baseX - inst.width / 2 - 78, inst.baseX + inst.width / 2 + 78]);
  }
  // ground anchor candidates across the terrace
  const groundXs = [];
  for (let x = 560; x <= 1180; x += 10) groundXs.push(x);
  const clearGround = (x) => occupied.every(([a, b]) => x < a - 58 || x > b + 58);
  while (anchors.length < 3) {
    const candidates = groundXs.filter((x) => clearGround(x) && !anchors.some((s) => Math.abs(s.x - x) < 130));
    if (!candidates.length) break;
    const x = candidates[Math.floor(rand() * candidates.length)];
    anchors.push({ x, y: TERRACE_TOP - GROUND_MARGIN });
  }
  if (anchors.length > 3) {
    // keep variety: prefer spread — sort by x and drop from the densest side
    anchors.sort((a, b) => a.x - b.x);
    while (anchors.length > 3) {
      const gaps = anchors.slice(1).map((a, i) => a.x - anchors[i].x);
      const minGap = gaps.indexOf(Math.min(...gaps));
      anchors.splice(minGap + 1, 1);
    }
  }

  // assemble layout
  const pieces = [];
  const pigs = [];
  for (const inst of instances) {
    pieces.push(...inst.pieces);
    pigs.push(...inst.pigs);
  }
  // stable, readable ids
  pieces.forEach((p, i) => { p.id = `L${levelId}Q${qIndex}-p${i}`; });
  pigs.forEach((p, i) => { p.id = `L${levelId}Q${qIndex}-g${i}`; });

  const layout = { targets: anchors.map((a) => ({ x: a.x, y: a.y })), pieces, pigs, moving: [] };

  // a couple of moving obstacles for mechanical variety (mid/late game)
  if ((levelId === 9 && qIndex === 1) || (levelId === 13 && qIndex === 0)) {
    layout.moving.push({
      m: 'stone', x: 505, y: 400, w: 56, h: 120,
      axis: 'y', range: 70, speed: 0.8, phase: rand() * Math.PI * 2
    });
  }
  return layout;
}

const main = () => {
  const src = JSON.parse(readFileSync(join(root, 'js/data/levels.json'), 'utf8'));
  const rand = rng(SEED);
  let pieceCount = 0, pigCount = 0, tallWarnings = 0;

  for (const lvl of src.levels) {
    lvl.questions.forEach((entry, qi) => {
      entry.layout = layoutQuestion(lvl.id, qi, rand);
      pieceCount += entry.layout.pieces.length;
      pigCount += entry.layout.pigs.length;
      for (const t of entry.layout.targets) {
        if (t.y < 210) tallWarnings++;
      }
    });
  }

  writeFileSync(OUT, JSON.stringify(src, null, 1) + '\n');
  console.log(`wrote ${OUT}`);
  console.log(`seed=${SEED} levels=15 questions=60 pieces=${pieceCount} pigs=${pigCount} highAnchors=${tallWarnings}`);
};

main();
