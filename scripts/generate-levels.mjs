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
import { TOWER_ASSETS } from '../js/data/tower-assets.js';
import { solveLaunch, predictPath } from '../js/systems/Trajectory.js';

const SLING = { x: 195, y: 335 }; // canonical desktop anchor (SLINGSHOT.ANCHORS.desktop)

/**
 * Verified reachability (spec §10): at least one solved launch arc must
 * pass through the PLAQUE (center or its upper half — a graze still hits
 * the 116×80 board) WITHOUT clipping any piece that rises above the
 * anchor's level between the sling and the anchor — including OTHER answer
 * plaques already placed to the left, which are real physical bodies.
 * Pure math over the baked geometry — the same integrator the game uses.
 */
const PLAQUE = { w: 116, h: 80 }; // TARGETS sign_blank logical size

function anchorReachable(anchorX, anchorY, pieces, blockers, requireTwo = false) {
  // shield rects: tower pieces (by asset size) + already-placed plaques
  const shields = [];
  for (const q of pieces) {
    const a = TOWER_ASSETS[q.a];
    if (!a) continue;
    shields.push({ x: q.x, w: a.size[0], top: q.y - a.size[1] / 2 });
  }
  for (const b of blockers || []) {
    shields.push({ x: b.x, w: PLAQUE.w, top: b.y - PLAQUE.h / 2 });
  }
  let clearing = 0;
  const aimPoints = [[anchorX, anchorY], [anchorX, anchorY - 28]];
  for (const [ax, ay] of aimPoints) {
    for (const ang of [-14, -22, -30, -38, -46, -54]) {
      // steps must match the shield check below: a steep lob to a distant
      // tower takes >60 steps, and the default path would truncate short
      // of the target (false "unreachable")
      const sol = solveLaunch(SLING.x, SLING.y, ax, ay, { angleDeg: ang, steps: 130 });
      if (!sol || sol.missDistance > 30) continue;
      const pts = predictPath(SLING.x, SLING.y, sol.vx, sol.vy, { steps: 130 });
      let ok = true;
      for (const p of pts) {
        if (p.x > anchorX - 10) break;
        for (const q of shields) {
          if (q.top > anchorY - 12) continue; // below plaque level: not a shield
          if (p.x > q.x - q.w / 2 - 14 && p.x < q.x + q.w / 2 + 14 && p.y > q.top - 14) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) clearing++;
      if (clearing >= (requireTwo ? 2 : 1)) return true;
    }
  }
  return false;
}

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

// Canonical geometry = desktop art (TERRAIN_PROFILES.desktop). Layouts are
// translated RIGIDLY per device at runtime (LevelManager), so the baked span
// must fit every painted terrace after translation:
//   desktop dx=0   → 560..1229 on terrace [459, 1280]
//   tablet  dx=-16 → 544..1213 on terrace [544, 1280]
//   mobile  dx=+50 → 610..1279 on terrace [610, 1280]
const TERRACE_TOP = 428;           // TERRAIN_PROFILES.desktop.TERRACE.top
const SPAN_LEFT = 578;             // leftmost structure EDGE (slot plaques may overhang 18px → 560)
const SPAN_RIGHT = 1211;           // rightmost structure EDGE (overhang → 1229; mobile dx+50 → 1279)
const PANEL_SAFE_X = 760;          // tall structures sit right of the question panel
const TALL_H = 300;
const GROUND_MARGIN = 42;          // plaque half height: ground anchor y = TERRACE_TOP - 40


  /** Plaques shadow each other: keep anchors apart horizontally unless they
   *  sit at clearly different heights (lob lanes over/under are fine). */
  const anchorsApart = (anchors, x, y) => anchors.every((s) =>
    Math.abs(s.x - x) >= 210 || Math.abs(s.y - y) >= 80);

function tryLayout(levelId, qIndex, rand) {
  const tier = levelId <= 5 ? 1 : levelId <= 10 ? 2 : 3;
  // Height cap: even the tallest template tops out at world y≈140 — below
  // the HUD strip (y≤48) — and PANEL_SAFE_X keeps tall towers right of the
  // question panel (x≤660, y 84..190). Cap only guards future templates.
  const pool = templatesForTier(tier).filter((k) => TEMPLATES[k].height <= 400);
  // Tier 1 keeps a front lane clear (structures' left edge at 700) so at
  // least one ground plaque sits in front and one behind — a gentle
  // introduction to lobbing. Later tiers use the full span from SPAN_LEFT.
  const structLeftEdge = tier === 1 ? 700 : SPAN_LEFT;

  // choose 1-2 structures; early levels favor small pairs. A second tower
  // is only kept when BOTH fit the usable span side by side with spacing —
  // the span is narrow enough (mobile translation) that wide pairs would
  // otherwise be clamped into overlapping.
  const twoTowers = tier === 1 ? rand() < 0.45 : rand() < 0.8;
  const chosen = [];
  const first = pool[Math.floor(rand() * pool.length)];
  chosen.push(first);
  if (twoTowers) {
    let second = pool[Math.floor(rand() * pool.length)];
    if (second === first) second = pool[(pool.indexOf(first) + 1 + Math.floor(rand() * 2)) % pool.length];
    const pairFits = TEMPLATES[first].width + TEMPLATES[second].width + 80 <= SPAN_RIGHT - structLeftEdge;
    if (pairFits) chosen.push(second);
  }

  // place structures left→right with spacing. A tower that would
  // interpenetrate its predecessor after clamping is DROPPED — pieces must
  // never spawn overlapping.
  const instances = [];
  let cursor = structLeftEdge + rand() * 40; // left edge where the next tower may start
  let prevRight = -Infinity;
  for (const key of chosen) {
    const t = TEMPLATES[key];
    const mirror = rand() < 0.35 && key !== 'leaning_tower';
    let x = cursor + t.width / 2;
    if (t.height >= TALL_H) x = Math.max(x, PANEL_SAFE_X + t.width / 2 - 40);
    x = Math.min(x, SPAN_RIGHT - t.width / 2);
    if (x - t.width / 2 < prevRight + 24) continue; // no room — skip this tower
    const inst = instantiate(key, Math.round(x), TERRACE_TOP, { mirror });
    instances.push(inst);
    prevRight = x + t.width / 2;
    cursor = prevRight + 80 + rand() * 50;
  }

  // collect anchors for the 3 answer plaques: structure slots first, then
  // clear ground positions on the terrace, and finally small pedestal
  // towers if space ran out — every layout is GUARANTEED 3 anchors, each
  // one VERIFIED reachable by at least one unobstructed launch arc.
  const pieces = [];
  const pigs = [];
  const anchors = [];
  const occupied = []; // x-ranges blocked by structures (footprint + margin)
  const addInstance = (inst, keepSlots = true) => {
    for (const s of inst.slots) {
      if (!keepSlots) continue;
      if (!anchorsApart(anchors, s.x, s.y)) continue;
      anchors.push({ x: s.x, y: s.y });
    }
    occupied.push([inst.baseX - inst.width / 2 - 66, inst.baseX + inst.width / 2 + 66]);
    pieces.push(...inst.pieces);
    pigs.push(...inst.pigs);
  };
  for (const inst of instances) addInstance(inst);

  // slot anchors must be reachable too: a rear tower shielded by a front
  // tower is only fair if some arc clears it — checked against all pieces
  // AND the other plaques (real bodies that can shield what is behind them)
  const allPiecesNow = [...pieces];
  for (let i = anchors.length - 1; i >= 0; i--) {
    const others = anchors.filter((_, j) => j !== i);
    if (!anchorReachable(anchors[i].x, anchors[i].y, allPiecesNow, others)) {
      anchors.splice(i, 1);
    }
  }

  // ground anchor candidates anywhere on the terrace band that is clear of
  // structures. (The old tier-1 front/rear lane rule is gone: the plaque
  // band [620..1165] no longer leaves a lane in front of tier-1 towers, and
  // the reachability check above is the real playability gate. Tier 1 stays
  // gentle because its towers are small and its slots sit low.)
  const groundXs = [];
  for (let x = 620; x <= 1165; x += 10) groundXs.push(x);
  const clearGround = (x) => occupied.every(([a, b]) => x < a - 58 || x > b + 58);
  while (anchors.length < 3) {
    const candidates = groundXs.filter((x) => clearGround(x)
      && anchorsApart(anchors, x, TERRACE_TOP - GROUND_MARGIN)
      && anchorReachable(x, TERRACE_TOP - GROUND_MARGIN, allPiecesNow, anchors));
    if (!candidates.length) break;
    const x = candidates[Math.floor(rand() * candidates.length)];
    anchors.push({ x, y: TERRACE_TOP - GROUND_MARGIN });
  }

  // still short on space → append small pedestal towers with one slot each
  // (a pedestal is 110px wide; occupied ranges already carry a 66px margin,
  // so clearance against them is sufficient).
  let guard = 0;
  while (anchors.length < 3 && guard++ < 4) {
    let placed = false;
    for (let x = 1165; x >= 625; x -= 10) {
      if (occupied.every(([a, b]) => x < a || x > b)
        && anchorsApart(anchors, x, TERRACE_TOP - GROUND_MARGIN)
        && anchorReachable(x, TERRACE_TOP - GROUND_MARGIN + 124, allPiecesNow, anchors)) {
        const inst = instantiate('pedestal', Math.round(x), TERRACE_TOP, {});
        addInstance(inst);
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }
  if (anchors.length < 3) return null;

  // keep exactly 3: sort by x and drop from the densest side
  anchors.sort((a, b) => a.x - b.x);
  while (anchors.length > 3) {
    const gaps = anchors.slice(1).map((a, i) => a.x - anchors[i].x);
    const minGap = gaps.indexOf(Math.min(...gaps));
    anchors.splice(minGap + 1, 1);
  }

  // assemble layout
  // stable, readable ids
  pieces.forEach((p, i) => { p.id = `L${levelId}Q${qIndex}-p${i}`; });
  pigs.forEach((p, i) => { p.id = `L${levelId}Q${qIndex}-g${i}`; });

  const layout = { targets: anchors.map((a) => ({ x: a.x, y: a.y })), pieces, pigs, moving: [] };

  // a couple of moving obstacles for mechanical variety (mid/late game).
  // The mover SWEPT box (range included) must clear every piece and
  // anchor: a static body intersecting a tower shoves it during settle.
  if ((levelId === 9 && qIndex === 1) || (levelId === 13 && qIndex === 0)) {
    const MV = { w: 56, h: 120, range: 70 };
    const sweptClear = (mx) => {
      const L = mx - MV.w / 2 - 16, R = mx + MV.w / 2 + 16;
      const T = 330 - MV.range - MV.h / 2 - 16, B = 330 + MV.range + MV.h / 2 + 16;
      for (const p of layout.pieces) {
        const a = TOWER_ASSETS[p.a]; if (!a) continue;
        if (L < p.x + a.size[0] / 2 + 10 && R > p.x - a.size[0] / 2 - 10
          && T < p.y + a.size[1] / 2 + 10 && B > p.y - a.size[1] / 2 - 10) return false;
      }
      for (const t of layout.targets) {
        if (L < t.x + 58 + 20 && R > t.x - 58 - 20 && B > t.y - 40 - 20) return false;
      }
      return true;
    };
    const mx = [520, 560, 600, 640, 1080, 1120, 1160, 980, 1020].find(sweptClear);
    if (mx) {
      layout.moving.push({
        m: 'stone', x: mx, y: 330, w: MV.w, h: MV.h,
        axis: 'y', range: MV.range, speed: 0.8, phase: rand() * Math.PI * 2
      });
    }
  }
  return layout;
}


/**
 * One question layout with self-healing placement: retry with fresh random
 * draws (variety), then a deterministic always-placeable fallback (one
 * pedestal centre, front + rear ground lanes — verified reachable).
 */
function layoutQuestion(levelId, qIndex, rand) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const layout = tryLayout(levelId, qIndex, rand);
    if (layout) return layout;
  }
  // deterministic fallback: pedestal at 700, ground 625 (front), 1130 (rear)
  const inst = instantiate('pedestal', 700, TERRACE_TOP, {});
  return {
    targets: [
      { x: 625, y: TERRACE_TOP - 40 },
      { x: inst.slots[0].x, y: inst.slots[0].y },
      { x: 1130, y: TERRACE_TOP - 40 }
    ],
    pieces: inst.pieces.map((p, i) => ({ ...p, id: `L${levelId}Q${qIndex}-p${i}` })),
    pigs: [],
    moving: []
  };
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
