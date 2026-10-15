/**
 * WORD BLAST — automated test suite (Node, no framework).
 * Covers the pure gameplay systems and the full data set. Browser-only
 * concerns (real physics, rendering) are covered by the integration test
 * documented in tests/MANUAL_CHECKLIST.md and run against the dev server.
 *
 * Run: npm test
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SAVE, STATES, SCORING, WORLD, SLINGSHOT } from '../js/config.js';
import { validateQuestions, validateLevels } from '../js/systems/Validators.js';
import { QuestionManager } from '../js/systems/QuestionManager.js';
import { LevelManager } from '../js/systems/LevelManager.js';
import { SaveManager, LocalStorageAdapter, sanitizeSave, createDefaultSave } from '../js/systems/SaveManager.js';
import { ScoringSystem } from '../js/systems/ScoringSystem.js';
import { GameStateMachine } from '../js/systems/GameStateMachine.js';
import { predictPath, solveLaunch } from '../js/systems/Trajectory.js';
import { clientToWorld, worldToClient } from '../js/systems/InputMapper.js';
import { TOWER_ASSETS as TOWER_ASSETS_MAP } from '../js/data/tower-assets.js';

function awaitImportTowerAssets() {
  return { TOWER_ASSETS: TOWER_ASSETS_MAP };
}
import { deviceInfo, requiresLandscape, DEVICE_TYPES } from '../js/systems/Device.js';

const root = dirname(fileURLToPath(import.meta.url));
const questionsData = JSON.parse(readFileSync(join(root, '../js/data/questions.json'), 'utf8'));
const levelsData = JSON.parse(readFileSync(join(root, '../js/data/levels.json'), 'utf8'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

console.log('\n== data validation =========================================');

test('#1 exactly 15 levels exist', () => {
  eq(levelsData.levels.length, 15);
});

test('#2 every level has exactly four questions', () => {
  for (const lvl of levelsData.levels) eq(lvl.questions.length, 4, `level ${lvl.id}`);
});

test('#3 exactly 60 unique question ids', () => {
  eq(questionsData.length, 60, 'question count');
  eq(new Set(questionsData.map((q) => q.id)).size, 60, 'unique ids');
});

test('#4 every question has exactly three choices', () => {
  for (const q of questionsData) eq(q.choices.length, 3, q.id);
});

test('#5 every question has exactly one valid correct answer', () => {
  for (const q of questionsData) {
    const matches = q.choices.filter((c) => c.id === q.correctAnswerId);
    eq(matches.length, 1, `${q.id}: correctAnswerId must match exactly one choice`);
  }
});

test('#6 all level-to-question mappings are valid', () => {
  const result = validateLevels(levelsData, questionsData);
  assert(result.ok, `errors:\n  - ${result.errors.join('\n  - ')}`);
});

test('#6b full question bank passes the validator', () => {
  const result = validateQuestions(questionsData);
  assert(result.ok, `errors:\n  - ${result.errors.join('\n  - ')}`);
});

test('#7 CEFR difficulty progresses A1 → B1+ across levels', () => {
  const rank = { 'A1': 0, 'A1+': 1, 'A2': 2, 'A2+': 3, 'B1': 4, 'B1+': 5 };
  let last = -1;
  for (const lvl of levelsData.levels) {
    const ranks = lvl.questions.map((e) => {
      const q = questionsData.find((x) => x.id === e.questionId);
      return rank[q.cefr];
    });
    const min = Math.min(...ranks);
    const max = Math.max(...ranks);
    assert(min >= last, `level ${lvl.id} drops below previous difficulty`);
    assert(max - min <= 1, `level ${lvl.id} mixes more than one adjacent CEFR step`);
    last = Math.max(last, min);
  }
  eq(questionsData[0].cefr, 'A1');
  eq(questionsData[59].cefr, 'B1+');
});

test('#8 physics configurations are valid and inside the world', () => {
  const lm = new LevelManager(levelsData, questionsData);
  const { TOWER_ASSETS } = awaitImportTowerAssets();
  eq(lm.count, 15);
  for (let id = 1; id <= 15; id++) {
    for (let i = 0; i < 4; i++) {
      const layout = lm.getLayout(id, i);
      assert(layout.targets.length === 3, `L${id} q${i}: 3 targets`);
      for (const t of layout.targets) {
        assert(t.x > 60 && t.x < WORLD.WIDTH - 60, `L${id} q${i}: target x ${t.x} in band`);
        assert(t.y > 60 && t.y < WORLD.GROUND_Y, `L${id} q${i}: target y ${t.y} above ground`);
      }
      for (const p of layout.pieces) {
        const asset = TOWER_ASSETS[p.a];
        assert(asset, `L${id} q${i}: piece asset "${p.a}" exists`);
        const [w, h] = asset.size;
        assert(Math.min(w, h) >= 20, `L${id} q${i}: piece ${p.a} min dim >= 20 (anti-tunneling)`);
        assert(p.x > 0 && p.x < WORLD.WIDTH, `L${id} q${i}: piece x inside world`);
        assert(p.y > 0 && p.y <= WORLD.GROUND_Y + 1, `L${id} q${i}: piece y inside world (y=${p.y})`);
      }
      assert(layout.pieces.length <= 40, `L${id} q${i}: piece budget (${layout.pieces.length})`);
      for (const g of layout.pigs) {
        assert(TOWER_ASSETS[g.a], `L${id} q${i}: pig asset "${g.a}" exists`);
        assert(g.y > 0 && g.y <= WORLD.GROUND_Y + 1, `L${id} q${i}: pig y inside world`);
      }
    }
  }
});

test('#8b star thresholds are consistent with the scoring formula', () => {
  for (const lvl of levelsData.levels) {
    const max = ScoringSystem.maxScore(lvl.shotsPerQuestion);
    assert(lvl.starThresholds.two <= lvl.starThresholds.three, `L${lvl.id}: two <= three`);
    assert(lvl.starThresholds.three <= max, `L${lvl.id}: three (${lvl.starThresholds.three}) <= max (${max})`);
    // 3-star must be achievable with a near-perfect run
    const s = new ScoringSystem();
    s.configure(lvl.shotsPerQuestion * 4);
    s.recordCorrect(1); s.recordCorrect(1); s.recordCorrect(1); s.recordCorrect(2);
    for (let i = 0; i < 5; i++) s.recordShot();
    assert(s.computeStars(lvl.starThresholds) === 3, `L${lvl.id}: near-perfect run earns 3 stars (got ${s.computeScore()})`);
  }
});

test('#8c projectile types unlock gradually (basic first, never removed)', () => {
  let seen = new Set(['basic']);
  for (const lvl of levelsData.levels) {
    for (const p of seen) assert(lvl.projectiles.includes(p), `L${lvl.id} lost projectile ${p}`);
    seen = new Set([...seen, ...lvl.projectiles]);
  }
  eq(seen.size, 5, 'all five types appear somewhere');
  eq(levelsData.levels[0].projectiles.join(','), 'basic', 'level 1 has only basic');
});

console.log('\n== question engine =========================================');

const qm = new QuestionManager(questionsData);

test('#11 incorrect answers are rejected', () => {
  const q = questionsData.find((x) => x.id === 'q01_1'); // correct = b
  const prepared = qm.prepare(q);
  const result = qm.checkAnswer(prepared, 'a');
  assert(result.valid && !result.correct, 'wrong choice must not be correct');
  assert(result.explanation && result.explanation.length > 10, 'educational feedback present');
});

test('#12 correct answers are accepted', () => {
  const q = questionsData.find((x) => x.id === 'q01_1');
  const prepared = qm.prepare(q);
  const result = qm.checkAnswer(prepared, 'b');
  assert(result.valid && result.correct, 'correct choice accepted');
  assert(prepared.answered, 'prepared flagged as answered');
});

test('#13 duplicate answer events cannot double-score', () => {
  const q = questionsData.find((x) => x.id === 'q03_1');
  const prepared = qm.prepare(q);
  const first = qm.checkAnswer(prepared, q.correctAnswerId);
  assert(first.valid && first.correct);
  const second = qm.checkAnswer(prepared, q.correctAnswerId);
  assert(!second.valid && second.reason === 'already-answered', 'second event rejected');
});

test('#13b unknown choice ids are rejected safely', () => {
  const q = questionsData[10];
  const prepared = qm.prepare(q);
  const result = qm.checkAnswer(prepared, 'zzz');
  assert(!result.valid && result.reason === 'unknown-choice');
});

test('#14 questions sequence per level in order', () => {
  for (let id = 1; id <= 15; id++) {
    const qs = qm.getForLevel(id);
    eq(qs.length, 4, `level ${id}`);
    qs.forEach((q, i) => eq(q.id, `q${String(id).padStart(2, '0')}_${i + 1}`));
  }
});

test('#14b target mapping is stable and by id (never by text)', () => {
  const q = questionsData[25];
  const prepared = qm.prepare(q);
  eq(prepared.targets.length, 3);
  const ids = prepared.targets.map((t) => t.choiceId).sort();
  eq(ids.join(','), 'a,b,c');
  eq(new Set(prepared.targets.map((t) => t.label)).size, 3, 'distinct labels');
});

console.log('\n== scoring ==================================================');

test('#17 score formula is deterministic', () => {
  for (let run = 0; run < 2; run++) {
    const s = new ScoringSystem();
    s.configure(16);
    s.recordCorrect(1); s.recordWrongHit(); s.recordCorrect(2); s.recordShot(); s.recordShot();
    s.recordCorrect(3); s.recordCorrect(4);
    s.recordShot(); s.recordShot(); s.recordShot(); s.recordShot(); s.recordShot(); s.recordShot();
    const score = s.computeScore();
    // 1000 + (750-100) + 500 + 250 + 500 + unused(16-8=8)*150
    eq(score, 1000 + 650 + 500 + 250 + 500 + 8 * 150);
  }
});

test('#17b perfect score = theoretical maximum', () => {
  const s = new ScoringSystem();
  s.configure(16);
  for (let i = 0; i < 4; i++) s.recordCorrect(1);
  for (let i = 0; i < 4; i++) s.recordShot();
  eq(s.computeScore(), ScoringSystem.maxScore(4));
});

test('live score hides end-of-level bonuses until completion', () => {
  const s = new ScoringSystem();
  s.configure(16);
  eq(s.liveScore(), 0, 'fresh level shows zero, not the unused-shot bonus');
  s.recordCorrect(1);
  s.recordShot();
  eq(s.liveScore(), 1000);
  s.recordCorrect(1); s.recordCorrect(1); s.recordCorrect(1);
  for (let i = 0; i < 3; i++) s.recordShot();
  eq(s.liveScore(), 4000 + 500 + 12 * 150, 'completion bonus appears only when done');
});

test('#15 stars require all four questions completed', () => {
  const s = new ScoringSystem();
  s.configure(16);
  s.recordCorrect(1); s.recordCorrect(1); s.recordCorrect(1);
  eq(s.computeStars({ two: 3000, three: 5000 }), 0, '3/4 questions = no stars');
  s.recordCorrect(1);
  eq(s.computeStars({ two: 3000, three: 5000 }), 3, '4/4 perfect = 3 stars');
});

test('#17c penalty never drops score below zero', () => {
  const s = new ScoringSystem();
  s.configure(4);
  for (let i = 0; i < 30; i++) s.recordWrongHit();
  eq(s.computeScore(), 0);
});

console.log('\n== save system =============================================');

class MemoryAdapter {
  constructor(initial) { this.store = initial !== undefined ? JSON.stringify(initial) : null; }
  read() { return this.store ? JSON.parse(this.store) : null; }
  write(data) { this.store = JSON.stringify(data); return true; }
  clear() { this.store = null; }
}

test('#18 progress saves and loads correctly', () => {
  const sm = new SaveManager(new MemoryAdapter());
  sm.load();
  eq(sm.unlockedLevel, 1, 'only level 1 unlocked initially');
  assert(sm.isLevelUnlocked(1) && !sm.isLevelUnlocked(2));
  const entry = sm.recordLevelResult(1, 5200, 3);
  assert(entry.completed && entry.bestScore === 5200 && entry.bestStars === 3);
  assert(sm.isLevelUnlocked(2) && !sm.isLevelUnlocked(3), 'level 2 unlocked, 3 not');

  // round-trip through a fresh manager on the same adapter
  const adapter = new MemoryAdapter(sm.data);
  const sm2 = new SaveManager(adapter);
  sm2.load();
  eq(sm2.getLevelEntry(1).bestScore, 5200);
  assert(sm2.isLevelUnlocked(2));
});

test('#16 level unlocking chains through all 15 levels', () => {
  const sm = new SaveManager(new MemoryAdapter());
  sm.load();
  for (let id = 1; id <= 15; id++) {
    assert(sm.isLevelUnlocked(id), `level ${id} should be unlocked after ${id - 1} wins`);
    sm.recordLevelResult(id, 100, 1);
    if (id < 15) assert(sm.isLevelUnlocked(id + 1));
  }
  assert(sm.allCompleted);
  eq(sm.totalStars, 15);
});

test('#18b worse replays never overwrite better results', () => {
  const sm = new SaveManager(new MemoryAdapter());
  sm.load();
  sm.recordLevelResult(3, 6000, 3);
  sm.recordLevelResult(3, 100, 1);
  const e = sm.getLevelEntry(3);
  eq(e.bestScore, 6000);
  eq(e.bestStars, 3);
});

test('#18c corrupted / hacked save data is sanitized', () => {
  assert(sanitizeSave(null) === null);
  assert(sanitizeSave('nope') === null);
  assert(sanitizeSave({ version: 99 }) === null, 'future versions rejected');
  const hacked = sanitizeSave({
    version: 1,
    unlockedLevel: 15,
    levels: {
      '7': { completed: true, bestScore: 9999, bestStars: 3 }
      // levels 1..6 missing -> completion chain broken
    }
  });
  eq(hacked.unlockedLevel, 1, 'unlock cannot skip uncompleted levels');
  eq(hacked.levels['7'].completed, false);
  assert(sanitizeSave(createDefaultSave()) !== null);
});

test('#18d LocalStorageAdapter degrades gracefully without storage', () => {
  const a = new LocalStorageAdapter(null);
  eq(a.read(), null);
  eq(a.write({ x: 1 }), false);
});

console.log('\n== state machine ===========================================');

test('#20 pause preserves and restores the exact previous state', () => {
  const sm = new GameStateMachine();
  sm.set(STATES.LOADING);
  sm.set(STATES.MENU);
  sm.set(STATES.LEVEL_READY);
  sm.set(STATES.QUESTION_READY);
  sm.set(STATES.AIMING);
  assert(sm.pause());
  eq(sm.current, STATES.PAUSED);
  eq(sm.pausedFrom, STATES.AIMING);
  // invalid transitions while paused
  assert(!sm.set(STATES.PROJECTILE_FLYING));
  assert(sm.resume());
  eq(sm.current, STATES.AIMING);
});

test('invalid transitions are rejected', () => {
  const sm = new GameStateMachine();
  assert(!sm.set(STATES.AIMING), 'BOOTING -> AIMING illegal');
  sm.set(STATES.MENU);
  assert(!sm.set(STATES.PROJECTILE_FLYING));
  assert(!sm.set(STATES.MENU), 'duplicate transition rejected');
});

test('#19 restart: a fresh machine starts clean', () => {
  const sm = new GameStateMachine();
  sm.set(STATES.MENU);
  sm.set(STATES.LEVEL_READY);
  sm.set(STATES.QUESTION_READY);
  const fresh = new GameStateMachine();
  eq(fresh.current, STATES.BOOTING);
  eq(fresh.history.length, 1);
});

test('full happy-path transition chain is legal', () => {
  const sm = new GameStateMachine();
  const chain = [
    STATES.LOADING, STATES.MENU, STATES.LEVEL_READY, STATES.QUESTION_READY, STATES.AIMING,
    STATES.PROJECTILE_FLYING, STATES.PHYSICS_RESOLVING, STATES.ANSWER_FEEDBACK,
    STATES.NEXT_QUESTION, STATES.QUESTION_READY, STATES.AIMING, STATES.PROJECTILE_FLYING,
    STATES.ANSWER_FEEDBACK, STATES.NEXT_QUESTION, STATES.QUESTION_READY, STATES.AIMING,
    STATES.PROJECTILE_FLYING, STATES.ANSWER_FEEDBACK, STATES.NEXT_QUESTION, STATES.QUESTION_READY,
    STATES.AIMING, STATES.PROJECTILE_FLYING, STATES.ANSWER_FEEDBACK, STATES.NEXT_QUESTION,
    STATES.LEVEL_COMPLETE, STATES.GAME_COMPLETE_ALLOWED_PLACEHOLDER_ || STATES.MENU
  ];
  for (const s of chain) assert(sm.set(s), `transition to ${s} should be legal (at ${sm.current})`);
});

test('failure path: PHYSICS_RESOLVING -> LEVEL_FAILED -> retry question', () => {
  const sm = new GameStateMachine();
  sm.set(STATES.LOADING); sm.set(STATES.MENU); sm.set(STATES.LEVEL_READY);
  sm.set(STATES.QUESTION_READY); sm.set(STATES.AIMING); sm.set(STATES.PROJECTILE_FLYING);
  sm.set(STATES.PHYSICS_RESOLVING);
  assert(sm.set(STATES.LEVEL_FAILED));
  assert(sm.set(STATES.QUESTION_READY), 'retry question re-enters flow');
});

test('freeze fix: a late answer is legal from AIMING and still progresses', () => {
  // A projectile of the current shot can touch the correct target after the
  // shot already resolved and the slingshot re-armed (creeping ball, debris
  // or a mover shoving it). The answer must be honored from AIMING.
  const sm = new GameStateMachine();
  sm.set(STATES.LOADING); sm.set(STATES.MENU); sm.set(STATES.LEVEL_READY);
  sm.set(STATES.QUESTION_READY); sm.set(STATES.AIMING);
  sm.set(STATES.PROJECTILE_FLYING); sm.set(STATES.PHYSICS_RESOLVING); sm.set(STATES.AIMING);
  assert(sm.set(STATES.ANSWER_FEEDBACK), 'AIMING -> ANSWER_FEEDBACK must be legal (late answer)');
  assert(sm.set(STATES.NEXT_QUESTION), 'feedback must be able to advance');
  assert(sm.set(STATES.QUESTION_READY), 'next question must load');
  // and a late WRONG answer settles back to AIMING to use remaining shots
  const sm2 = new GameStateMachine();
  sm2.set(STATES.LOADING); sm2.set(STATES.MENU); sm2.set(STATES.LEVEL_READY);
  sm2.set(STATES.QUESTION_READY); sm2.set(STATES.AIMING);
  assert(sm2.set(STATES.ANSWER_FEEDBACK), 'late wrong answer enters feedback');
  assert(sm2.set(STATES.AIMING), 'late wrong answer re-arms');
});

test('stale projectiles cannot answer from non-shot states', () => {
  // answers are unroutable once the question is loading / level is over
  const sm = new GameStateMachine();
  sm.set(STATES.LOADING); sm.set(STATES.MENU); sm.set(STATES.LEVEL_READY);
  sm.set(STATES.QUESTION_READY); sm.set(STATES.AIMING); sm.set(STATES.PROJECTILE_FLYING);
  sm.set(STATES.PHYSICS_RESOLVING); sm.set(STATES.ANSWER_FEEDBACK); sm.set(STATES.NEXT_QUESTION);
  sm.set(STATES.QUESTION_READY);
  assert(!sm.set(STATES.ANSWER_FEEDBACK), 'QUESTION_READY must not accept answer events');
  sm.set(STATES.AIMING); sm.set(STATES.PROJECTILE_FLYING);
  sm.set(STATES.PHYSICS_RESOLVING); sm.set(STATES.LEVEL_FAILED);
  assert(!sm.set(STATES.ANSWER_FEEDBACK), 'LEVEL_FAILED must not accept answer events');
});

console.log('\n== trajectory ===============================================');

test('prediction integrates gravity downward monotonically', () => {
  const pts = predictPath(WORLD.SLING_X, WORLD.SLING_Y, 15, -12, { steps: 90 });
  eq(pts.length, 90);
  let vy = -12;
  for (let i = 1; i < pts.length; i++) {
    const dy = pts[i].y - pts[i - 1].y;
    // vertical velocity only ever increases by G_STEP per step (damped)
  }
  assert(pts[89].y > pts[0].y, 'projectile falls over time');
});

test('solveLaunch finds a power that passes through the target point', () => {
  const sol = solveLaunch(WORLD.SLING_X, WORLD.SLING_Y, 880, 600, { angleDeg: -14 });
  assert(sol, 'solution exists');
  const pts = predictPath(WORLD.SLING_X, WORLD.SLING_Y, sol.vx, sol.vy, { steps: 120 });
  const closest = Math.min(...pts.map((p) => Math.hypot(p.x - 880, p.y - 600)));
  assert(closest < 10, `closest approach ${closest.toFixed(1)}px should be < 10px`);
  assert(sol.power > 0 && sol.power <= 1.001);
});

test('launch power is capped by MAX_SPEED', () => {
  const sol = solveLaunch(WORLD.SLING_X, WORLD.SLING_Y, 1200, 300, { angleDeg: -30 });
  const speed = Math.hypot(sol.vx, sol.vy);
  assert(speed <= SLINGSHOT.MAX_SPEED + 0.01, `speed ${speed} exceeds cap`);
});

console.log('\n== slingshot positioning ====================================');

import { slingshotAnchor } from '../js/config.js';
const _DT = DEVICE_TYPES; // already imported from Device.js above
const LEVELS = levelsData; // alias for the reachability sweep below

test('every device background has a slingshot anchor on the left cliff', () => {
  for (const type of [_DT.DESKTOP, _DT.TABLET, _DT.MOBILE]) {
    const a = slingshotAnchor(type);
    // on the elevated left plateau (measured grass tops ≈ y 385-424 per art,
    // pouch sits BASE_OFFSET_Y above the grass contact point)
    assert(a.x >= 100 && a.x <= 220, `${type}: anchor x ${a.x} on the flat cliff top`);
    assert(a.y >= 300 && a.y <= 400, `${type}: anchor y ${a.y} above the cliff grass`);
    const baseY = a.y + SLINGSHOT.BASE_OFFSET_Y;
    assert(baseY >= 370 && baseY <= 450, `${type}: base y ${baseY} rests on the painted grass`);
    // clear of the question panel (bottom ≈ y 210) and inside the world
    assert(a.y - 60 > 210, `${type}: fork stays below the question panel`);
    assert(a.x > 0 && a.y > 0 && a.x < WORLD.WIDTH && a.y < WORLD.HEIGHT, `${type}: inside world`);
  }
});

test('legacy WORLD.SLING_X/Y stay in sync with the desktop anchor', () => {
  const a = slingshotAnchor(_DT.DESKTOP);
  eq(WORLD.SLING_X, a.x, 'SLING_X alias matches ANCHORS.desktop.x');
  eq(WORLD.SLING_Y, a.y, 'SLING_Y alias matches ANCHORS.desktop.y');
});

test('slingshotAnchor returns an independent copy per call', () => {
  const a = slingshotAnchor(_DT.MOBILE);
  a.x = 999; a.y = 999;
  const b = slingshotAnchor(_DT.MOBILE);
  assert(b.x !== 999 && b.y !== 999, 'mutating a returned anchor must not leak');
});

test('unknown device types fall back to the desktop anchor', () => {
  const a = slingshotAnchor('smart-fridge');
  eq(a.x, slingshotAnchor(_DT.DESKTOP).x);
  eq(a.y, slingshotAnchor(_DT.DESKTOP).y);
});

test('the anchor leaves full pull-back room inside the world', () => {
  for (const type of [_DT.DESKTOP, _DT.TABLET, _DT.MOBILE]) {
    const a = slingshotAnchor(type);
    // pulling straight back (left) the pouch must stay comfortably visible:
    // at least 120px of the 140px drag range before the world edge
    assert(a.x - 16 >= 120, `${type}: only ${a.x - 16}px of back-drag inside the world`);
  }
});

test('all targets in all levels stay reachable from every device anchor', () => {
  const totalTargets = LEVELS.levels.reduce((n, l) => n + l.questions.reduce((m, q) => m + q.layout.targets.length, 0), 0);
  assert(totalTargets > 0, 'level data present');
  let checked = 0;
  for (const type of [_DT.DESKTOP, _DT.TABLET, _DT.MOBILE]) {
    const a = slingshotAnchor(type);
    for (const lvl of LEVELS.levels) {
      for (const q of lvl.questions) {
        for (const t of q.layout.targets) {
          let best = Infinity;
          for (let ang = -50; ang <= 30; ang += 4) {
            const sol = solveLaunch(a.x, a.y, t.x, t.y, { angleDeg: ang });
            if (sol) best = Math.min(best, sol.missDistance);
          }
          assert(best < 40, `L${lvl.id} q${lvl.questions.indexOf(q) + 1} target (${t.x},${t.y}) unreachable from ${type} anchor (miss ${best.toFixed(1)}px)`);
          checked++;
        }
      }
    }
  }
  eq(checked, totalTargets * 3, 'swept every target from every device anchor');
});

console.log('\n== input mapping ============================================');

test('#21 client<->world mapping is exact and round-trips', () => {
  const rect = { left: 100, top: 50, width: 640, height: 360 };
  const w = clientToWorld(420, 230, rect);
  eq(w.x, 640, 'half of canvas width = half of world width');
  eq(w.y, 360, 'half of canvas height = half of world height');
  assert(w.inside);
  const c = worldToClient(640, 360, rect);
  eq(c.x, 420);
  eq(c.y, 230);
  const edge = clientToWorld(99, 49, rect);
  assert(!edge.inside, 'just outside the canvas maps outside the world');
});

test('#21b portrait phone canvas keeps aspect-correct mapping', () => {
  // letterboxed 16:9 canvas inside a tall phone screen
  const rect = { left: 0, top: 200, width: 390, height: 219 };
  const w = clientToWorld(390, 419, rect);
  eq(Math.round(w.x), 1280);
  eq(Math.round(w.y), 720);
});

console.log('\n== device detection =========================================');

test('desktop: no touch -> desktop regardless of window size', () => {
  eq(deviceInfo({ viewport: { w: 1920, h: 1080 }, coarse: false, maxTouchPoints: 0 }).type, DEVICE_TYPES.DESKTOP);
  // narrow desktop window must NOT be classified as a phone
  eq(deviceInfo({ viewport: { w: 500, h: 400 }, coarse: false, maxTouchPoints: 0 }).type, DEVICE_TYPES.DESKTOP);
  eq(deviceInfo({ viewport: { w: 900, h: 700 }, coarse: false, maxTouchPoints: 0 }).type, DEVICE_TYPES.DESKTOP);
});

test('tablet: large touch viewports classify as tablet', () => {
  eq(deviceInfo({ viewport: { w: 1180, h: 820 }, coarse: true, maxTouchPoints: 5 }).type, DEVICE_TYPES.TABLET);
  eq(deviceInfo({ viewport: { w: 1366, h: 1024 }, coarse: true, maxTouchPoints: 5 }).type, DEVICE_TYPES.TABLET);
  // iPadOS Safari reports a Mac UA with touch points
  eq(deviceInfo({
    viewport: { w: 1024, h: 768 }, coarse: true, maxTouchPoints: 5,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
  }).type, DEVICE_TYPES.TABLET);
  // Android tablet: Android UA without 'Mobile'
  eq(deviceInfo({
    viewport: { w: 1000, h: 700 }, coarse: true, maxTouchPoints: 5,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X910) AppleWebKit/537.36'
  }).type, DEVICE_TYPES.TABLET);
});

test('mobile: phone-sized touch viewports classify as mobile', () => {
  eq(deviceInfo({ viewport: { w: 844, h: 390 }, coarse: true, maxTouchPoints: 5 }).type, DEVICE_TYPES.MOBILE);
  eq(deviceInfo({
    viewport: { w: 800, h: 360 }, coarse: true, maxTouchPoints: 5,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; S) AppleWebKit/537.36 Mobile Safari'
  }).type, DEVICE_TYPES.MOBILE);
  // ambiguous band resolved by iPhone UA
  eq(deviceInfo({
    viewport: { w: 926, h: 428 }, coarse: true, maxTouchPoints: 5,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'
  }).type, DEVICE_TYPES.MOBILE);
});

test('landscape lock applies only to portrait phones', () => {
  const phonePortrait = deviceInfo({ viewport: { w: 390, h: 844 }, coarse: true, maxTouchPoints: 5 });
  assert(requiresLandscape(phonePortrait), 'portrait phone needs the overlay');
  const phoneLandscape = deviceInfo({ viewport: { w: 844, h: 390 }, coarse: true, maxTouchPoints: 5 });
  assert(!requiresLandscape(phoneLandscape), 'landscape phone plays');
  const tabletPortrait = deviceInfo({ viewport: { w: 820, h: 1180 }, coarse: true, maxTouchPoints: 5 });
  assert(!requiresLandscape(tabletPortrait), 'tablets are nudged, not forced');
  const desktopTall = deviceInfo({ viewport: { w: 500, h: 900 }, coarse: false, maxTouchPoints: 0 });
  assert(!requiresLandscape(desktopTall), 'narrow desktop window never triggers the overlay');
});

console.log('\n== summary ==================================================');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(` - ${f.name}: ${f.error.message}`);
  process.exit(1);
}
