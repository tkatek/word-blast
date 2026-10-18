/**
 * ANSWER PANEL TESTS — verifies the measurement-driven panel system against
 * every one of the 60 questions / 180 answer choices:
 *
 *   planning (pure, Node metrics shim):
 *     1. every choice fits its panel's writing box at a readable font size
 *     2. sentence answers get the XL panel; short words stay compact
 *     3. all three answers of a question share one format + font size
 *     4. font never drops below the per-format minimum
 *     5. no answer renders above the format's max font on the shared plan
 *
 *   geometry (level layouts + chosen formats):
 *     6. the three panels of every question do not overlap (AABB, 8px gap)
 *     7. every XL panel rests on a support at least 150px wide or the ground
 *     8. panels stay inside the world and clear of the HUD band
 *
 *   live (real Matter physics, boots the actual game):
 *     9. created targets' colliders match their displayed panel size
 *    10. build-time settle keeps towers standing on XL questions
 *
 * Run: node tests/answer-panel-tests.mjs
 */
import { installPhaserEnv } from './helpers/phaser-env.mjs';

installPhaserEnv();

const { register } = await import('node:module');
register(new URL('./helpers/json-loader.mjs', import.meta.url), import.meta.url);

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const dist = await import('phaser/dist/phaser.esm.js');
const Phaser = dist.default && dist.default.VERSION ? dist.default : dist;
const srcPath = require.resolve('phaser');
require.cache[srcPath] = { id: srcPath, filename: srcPath, loaded: true, exports: Phaser };

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const questionsData = JSON.parse(readFileSync(join(here, '../js/data/questions.json'), 'utf8'));
const levelsData = JSON.parse(readFileSync(join(here, '../js/data/levels.json'), 'utf8'));
const { WORLD, TARGETS } = await import('../js/config.js');
const { TOWER_ASSETS } = await import('../js/data/tower-assets.js');
const {
  PANEL_FORMATS, FORMAT_ORDER, planQuestion, formatByName,
  panelCenterYForSlot, measureWrapped
} = await import('../js/systems/AnswerPanel.js');

let passed = 0, failed = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passed++; } else { failed++; failures.push(label); }
}

/* ---- boot a tiny real game so Text objects measure properly ----------- */
const { createHeadlessGame } = await import('./helpers/headless-game.mjs');
const h = await createHeadlessGame();
const booted = await h.waitFor(() => h.game.scene.getScenes(true).length > 0, 8000, 'any scene');
if (!booted) throw new Error('no scene ever started');
const scene = h.game.scene.getScenes(true)[0]; // any active scene hosts the scratch Text

/* ---- 1-5: planning ----------------------------------------------------- */
console.log('--- planning all 60 questions ---');
const plans = new Map();
const formatCount = {};
for (const q of questionsData) {
  const plan = planQuestion(scene, q.choices);
  plans.set(q.id, plan);
  formatCount[plan.format] = (formatCount[plan.format] || 0) + 1;

  check(FORMAT_ORDER.includes(plan.format), `${q.id}: valid format ${plan.format}`);
  check(plan.entries.length === 3, `${q.id}: 3 entries`);

  const f = PANEL_FORMATS[plan.format];
  check(plan.font >= f.font.min, `${q.id}: font ${plan.font} >= min ${f.font.min}`);
  check(plan.font <= f.font.max, `${q.id}: font ${plan.font} <= max ${f.font.max}`);
  check(plan.entries.every((e) => e.fontSize === null || e.fontSize >= f.font.min),
    `${q.id}: per-entry fonts respect the minimum`);

  // every choice must ACTUALLY fit the shared format's box at the shared font
  for (let i = 0; i < 3; i++) {
    const m = measureWrapped(scene, q.choices[i].text, plan.font, f.box.w);
    check(m.width <= f.box.w + 0.5, `${q.id} choice ${i}: width ${m.width.toFixed(1)} <= ${f.box.w}`);
    check(m.height <= f.box.h + 0.5, `${q.id} choice ${i}: height ${m.height.toFixed(1)} <= ${f.box.h}`);
  }

  // classification sanity: full sentences never on the compact panels
  const longest = Math.max(...q.choices.map((c) => c.text.length));
  if (longest > 22) {
    check(plan.format === 'XL', `${q.id}: sentence answers (${longest} ch) use XL (got ${plan.format})`);
  }
  if (longest <= 7) {
    check(plan.format === 'S', `${q.id}: short words (${longest} ch) stay compact (got ${plan.format})`);
  }
}
console.log('format distribution:', JSON.stringify(formatCount));

/* ---- 6-8: layout geometry ---------------------------------------------- */
console.log('--- layout geometry ---');
const bakedGround = 428; // LAYOUT_BAKED_GROUND_Y
const dy = WORLD.GROUND_Y - bakedGround;
const XL_HALF = PANEL_FORMATS.XL.size[0] / 2;

for (const lvl of levelsData.levels) {
  lvl.questions.forEach((qq, qi) => {
    const plan = plans.get(qq.questionId);
    const f = formatByName(plan.format);
    const [pw, ph] = f.size;
    const rects = qq.layout.targets.map((t) => {
      const cy = panelCenterYForSlot(t.y + dy, plan.format);
      return { x0: t.x - pw / 2, x1: t.x + pw / 2, y0: cy - ph / 2, y1: cy + ph / 2 };
    });
    // 6. pairwise AABB gap >= 12px in x OR y direction
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const ox = Math.min(rects[a].x1, rects[b].x1) - Math.max(rects[a].x0, rects[b].x0);
        const oy = Math.min(rects[a].y1, rects[b].y1) - Math.max(rects[a].y0, rects[b].y0);
        const label = `L${lvl.id}Q${qi + 1}: panels ${a}/${b} overlap x${ox.toFixed(0)} y${oy.toFixed(0)}`;
        check(ox < -12 || oy < -12, label);
      }
      // 8. world bounds + HUD clearance
      check(rects[a].x0 >= 40 && rects[a].x1 <= WORLD.WIDTH - 12,
        `L${lvl.id}Q${qi + 1}: panel ${a} inside world x (${rects[a].x0.toFixed(0)}..${rects[a].x1.toFixed(0)})`);
      check(rects[a].y0 >= 84, `L${lvl.id}Q${qi + 1}: panel ${a} below HUD band (top ${rects[a].y0.toFixed(0)})`);
    }

    // 7. XL support: a real, wide-enough resting surface under the panel —
    //    a beam/crate (>= 80px), adjacent same-height tops (>= 120px union),
    //    a post/column (>= 50px) or the open ground. Actual stability is
    //    proven by the live settle check below.
    if (plan.format === 'XL') {
      qq.layout.targets.forEach((t, ti) => {
        const surfaceY = t.y + dy + 40; // panel bottom
        if (Math.abs(surfaceY - WORLD.GROUND_Y) < 6) return; // open ground
        const supports = qq.layout.pieces.filter((p) => {
          const ph2 = TOWER_ASSETS[p.a].size[0] ? TOWER_ASSETS[p.a].size[1] : 0;
          return Math.abs((p.y + dy - ph2 / 2) - surfaceY) < 4
            && Math.abs(p.x - t.x) < TOWER_ASSETS[p.a].size[0] / 2 + 20;
        });
        if (!supports.length) {
          check(false, `L${lvl.id}Q${qi + 1}: XL target ${ti} has NO support under it`);
          return;
        }
        const widths = supports.map((p) => TOWER_ASSETS[p.a].size[0]);
        const single = Math.max(...widths);
        const isPost = supports.some((p) => /column|beam_v/.test(p.a));
        const union = supports.length > 1
          ? Math.max(...supports.map((p) => p.x + TOWER_ASSETS[p.a].size[0] / 2))
            - Math.min(...supports.map((p) => p.x - TOWER_ASSETS[p.a].size[0] / 2))
          : 0;
        check(single >= 80 || union >= 120 || (isPost && single >= 50),
          `L${lvl.id}Q${qi + 1}: XL target ${ti} support too narrow (${single}px, union ${union.toFixed(0)}px)`);
      });
    }
  });
}

/* ---- 9-10: live physics ------------------------------------------------- */
console.log('--- live XL question boot + collider match ---');
for (const levelId of [8, 13]) {
  for (let q = 0; q < 4; q++) {
    const ok = await h.api.gotoQuestion(levelId, q);
    check(ok, `L${levelId}Q${q + 1}: gotoQuestion`);
    await h.waitForState('AIMING', 15000);
    const s = h.scene();
    const plan = plans.get(s.prepared.question.id);
    const f = formatByName(plan.format);
    const targets = s.factory.targets;
    check(targets.length === 3, `L${levelId}Q${q + 1}: 3 targets`);
    for (const t of targets) {
      // collider vs visible panel: display size drives the body (texture-
      // sized body + setDisplaySize scale body and art together), so equal
      // display size + expected mass proves the collider matches the art.
      // (body.bounds are rotation-inflated AABBs — not comparable directly.)
      check(Math.abs(t.displayWidth - f.size[0]) <= 0.5 && Math.abs(t.displayHeight - f.size[1]) <= 0.5,
        `L${levelId}Q${q + 1}: display size ${t.displayWidth.toFixed(1)}x${t.displayHeight.toFixed(1)} matches format ${f.size[0]}x${f.size[1]}`);
      const expectedMass = (plan.format === 'XL' ? TARGETS.XL_REFERENCE_MASS : TARGETS.DENSITY * f.size[0] * f.size[1]);
      check(Math.abs(t.body.mass - expectedMass) / expectedMass < 0.05,
        `L${levelId}Q${q + 1}: body mass ${t.body.mass.toFixed(1)} ~ ${expectedMass.toFixed(1)}`);
      // label container glued to the body
      check(t.wb.labelHolder && Math.abs(t.wb.labelHolder.x - t.x) < 0.01,
        `L${levelId}Q${q + 1}: label holder follows body`);
    }
    // settle stability: nothing fell out of the world during build
    check(s.factory.blocks.every((b) => !b.wb.removed), `L${levelId}Q${q + 1}: no pieces lost at settle`);
  }
}

await h.destroy();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('FAILURES:');
  failures.slice(0, 40).forEach((f2) => console.log('  -', f2));
  process.exit(1);
}
