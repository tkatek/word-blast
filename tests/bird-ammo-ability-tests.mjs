/**
 * FIX #19 TEST SUITE — bird selection cards, ammunition system and the new
 * ability mapping (BLUE→speed, YELLOW→split×5, BLACK→bomb-tap, PURPLE→ice).
 *
 * Headless but REAL: Phaser CANVAS renderer + real Matter.js physics + the
 * real scenes/state machine/factory (same harness as the other suites).
 * Bird PNGs fall back to legacy circles here — the UI/DOM/texture checks
 * run in the browser screenshot pass (scripts/ + verify-birds).
 *
 * Covers (spec §14 numbering where applicable):
 *   1-3   five cards exist with portraits + badges
 *   3     selecting a bird updates the slingshot
 *   4     selecting does not consume ammunition
 *   5-6   launching consumes one bird AND one shot
 *   7     inventory never goes negative
 *   8     unavailable cards cannot be selected
 *   9     red bird behaves normally (no ability)
 *   10    blue bird accelerates exactly once (capped)
 *   11    yellow bird splits into exactly five smaller birds
 *   12    split children share one shot identity
 *   13    five split birds cannot select multiple answers
 *   14    black bird explodes (manual mid-flight detonation)
 *   15    black bird cannot explode repeatedly
 *   16    purple bird freezes compatible objects
 *   17    ability activation gated (before launch / after resolve / paused)
 *   18    no ghost birds remain after question advance
 *   19    next bird auto-loads when ammo reaches zero
 *   20-22 correct / wrong progression + all four questions playable
 *   23    all 15 levels validate with their configured ammunition
 *   24    retry/restart preserve consistent ammunition
 *   shot  limit binds even with ample ammunition
 *
 * Run: node tests/bird-ammo-ability-tests.mjs
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';
import { BIRDS, birdForProjectile } from '../js/data/birds.js';
import { BirdInventory } from '../js/systems/BirdInventory.js';
import { SPLIT_CHILD, BIRD_AMMO, TUNNELING, BOOST, ICE } from '../js/config.js';
import { validateLevels } from '../js/systems/Validators.js';
import { readFileSync } from 'node:fs';

const questionsData = JSON.parse(readFileSync(new URL('../js/data/questions.json', import.meta.url), 'utf8'));
const levelsData = JSON.parse(readFileSync(new URL('../js/data/levels.json', import.meta.url), 'utf8'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ok  ${name}`); })
    .catch((e) => {
      failed++;
      failures.push({ name, error: e });
      console.log(`FAIL  ${name}\n      ${e.message}`);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'eq'}: expected ${expected}, got ${actual}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Pure data / unit layer                                              */
/* ------------------------------------------------------------------ */

await test('mapping: RED→basic, BLUE→speed, YELLOW→split, BLACK→bomb, PURPLE→ice', () => {
  eq(BIRDS.red.projectileKey, 'basic', 'red');
  eq(BIRDS.blue.projectileKey, 'speed', 'blue (Fix #19 swap)');
  eq(BIRDS.yellow.projectileKey, 'split', 'yellow (Fix #19 swap)');
  eq(BIRDS.black.projectileKey, 'bomb', 'black');
  eq(BIRDS.purple.projectileKey, 'ice', 'purple');
  eq(birdForProjectile('speed').id, 'blue', 'speed→blue');
  eq(birdForProjectile('split').id, 'yellow', 'split→yellow');
  eq(BIRDS.green.projectileKey, null, 'green stays deactivated');
});

await test('inventory: consume exactly one, never negative, zero not selectable', () => {
  const inv = new BirdInventory(['basic', 'speed'], { basic: 1, speed: 0 });
  eq(inv.count('basic'), 1, 'initial basic');
  assert(inv.consume('basic'), 'consume should succeed');
  eq(inv.count('basic'), 0, 'basic after consume');
  assert(!inv.consume('basic'), 'consume on empty must fail');
  eq(inv.count('basic'), 0, 'inventory must never go negative');
  assert(!inv.canSelect('basic'), 'zero-ammo bird cannot be selected');
  assert(!inv.canSelect('speed'), 'zero-ammo roster member cannot be selected');
  assert(!inv.canSelect('bomb'), 'out-of-roster bird cannot be selected');
  assert(!inv.consume('bomb'), 'out-of-roster consume refused');
  eq(inv.firstAvailable(), null, 'nothing available');
  assert(inv.empty, 'inventory is empty');
});

await test('inventory: per-question reset restores configured counts', () => {
  const inv = new BirdInventory(['basic', 'split'], { basic: 2, split: 2 });
  inv.consume('basic'); inv.consume('basic'); inv.consume('split');
  inv.resetForQuestion();
  eq(inv.count('basic'), 2, 'basic restored');
  eq(inv.count('split'), 2, 'split restored');
});

await test('inventory: missing ammo table falls back to BIRD_AMMO.DEFAULTS', () => {
  const inv = new BirdInventory(['basic', 'bomb', 'ice']);
  eq(inv.count('basic'), BIRD_AMMO.DEFAULTS.basic, 'basic default');
  eq(inv.count('bomb'), BIRD_AMMO.DEFAULTS.bomb, 'bomb default');
  eq(inv.count('ice'), BIRD_AMMO.DEFAULTS.ice, 'ice default');
});

await test('config: split produces FIVE children with non-overlapping separation', () => {
  eq(SPLIT_CHILD.COUNT, 5, 'exactly five children');
  assert(SPLIT_CHILD.SEPARATION >= 2 * SPLIT_CHILD.radius,
    `separation ${SPLIT_CHILD.SEPARATION} must be >= child diameter ${2 * SPLIT_CHILD.radius}`);
  assert(SPLIT_CHILD.speedScale > 0 && SPLIT_CHILD.speedScale <= 1, 'speed scale bounded');
});

await test('data: all 15 levels validate and carry completable birdAmmo', () => {
  const result = validateLevels(levelsData, questionsData);
  assert(result.ok, 'validateLevels errors: ' + result.errors.join('; '));
  for (const lvl of levelsData.levels) {
    const ammo = lvl.birdAmmo;
    assert(ammo && typeof ammo === 'object', `L${lvl.id}: birdAmmo missing`);
    let total = 0;
    for (const [k, n] of Object.entries(ammo)) {
      assert(lvl.projectiles.includes(k), `L${lvl.id}: birdAmmo key ${k} not in roster`);
      assert(Number.isInteger(n) && n >= 0, `L${lvl.id}: bad count for ${k}`);
      total += n;
    }
    assert(total >= lvl.shotsPerQuestion,
      `L${lvl.id}: ammo total ${total} < shotsPerQuestion ${lvl.shotsPerQuestion}`);
  }
});

await test('data: full-roster levels use the proposed inventory (3·2·2·1·1)', () => {
  for (const lvl of levelsData.levels) {
    if (lvl.projectiles.length === 5) {
      eq(lvl.birdAmmo.basic, 3, `L${lvl.id} red`);
      eq(lvl.birdAmmo.speed, 2, `L${lvl.id} blue`);
      eq(lvl.birdAmmo.split, 2, `L${lvl.id} yellow`);
      eq(lvl.birdAmmo.bomb, 1, `L${lvl.id} black`);
      eq(lvl.birdAmmo.ice, 1, `L${lvl.id} purple`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Integration layer (real Phaser + Matter)                            */
/* ------------------------------------------------------------------ */

const h = await createHeadlessGame();
const M = h.Phaser.Physics.Matter.Matter;

/** Gently teleport a live body onto a point with a small downward velocity. */
function placeBody(go, x, y) {
  M.Sleeping.set(go.body, false);
  M.Body.setPosition(go.body, { x, y: y - 26 });
  M.Body.setVelocity(go.body, { x: 0, y: 1.5 });
}

await test('cards: five selector cards exist with portraits + quantity badges', async () => {
  await h.gotoLevel(12);
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(s.birdSelector, 'BirdSelector not built');
  eq(s.birdSelector.cards.size, 5, 'expected five cards');
  for (const [key, rec] of s.birdSelector.cards) {
    assert(rec.portrait, `${key}: no portrait image`);
    assert(rec.badge && rec.badgeNum, `${key}: no quantity badge`);
    assert(s.textures.exists(rec.frame.texture.key), `${key}: frame texture missing`);
    const n = Number(rec.badgeNum.text);
    assert(Number.isFinite(n) && n >= 0, `${key}: badge shows "${rec.badgeNum.text}"`);
  }
  // roster cards show their configured counts; off-roster cards dim at ×0
  const rec = s.birdSelector.cards.get('basic');
  eq(Number(rec.badgeNum.text), 3, 'L12 red card should show ×3');
});

await test('cards: selecting updates the slingshot and consumes NO ammunition', async () => {
  const s = h.scene();
  const before = s.birdInventory.snapshot();
  assert(s.selectProjectile('ice'), 'ice selection refused');
  eq(s.slingshot.loadedType, 'ice', 'slingshot did not load the selected bird');
  assert(s.slingshot.preview, 'no preview after selection swap');
  eq(s.birdInventory.snapshot().ice, before.ice, 'selection must not consume ammo');
  assert(s.selectProjectile('basic'), 'back to basic');
  eq(s.birdInventory.snapshot().basic, before.basic, 'second selection still free');
});

await test('launch: consumes exactly one ammo unit AND one shot', async () => {
  const s = h.scene();
  const ammo0 = s.birdInventory.count('basic');
  const shots0 = s.shotsLeft;
  const scored0 = s.scoring.shotsUsed;
  assert(h.fire(-6, -5), 'launch refused'); // guaranteed miss (backward lob)
  eq(s.birdInventory.count('basic'), ammo0 - 1, 'exactly one basic consumed');
  eq(s.shotsLeft, shots0 - 1, 'exactly one shot consumed');
  eq(s.scoring.shotsUsed, scored0 + 1, 'shot recorded once');
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
});

await test('unavailable birds cannot be selected or launched', async () => {
  await h.gotoLevel(12); // fresh question: 3 shots, speed ×2
  await h.waitForState('AIMING');
  const s = h.scene();
  // drain blue (speed) to zero: fire both as guaranteed backward misses
  assert(s.selectProjectile('speed'), 'speed selection refused');
  assert(h.fire(-6, -5, 'speed'), 'speed launch 1 refused');
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
  await h.waitForState('AIMING', 15000);
  eq(s.birdInventory.count('speed'), 1, 'one speed left before second launch');
  assert(h.fire(-6.25, -5, 'speed'), 'speed launch 2 refused');
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
  await h.waitForState('AIMING', 15000);
  eq(s.birdInventory.count('speed'), 0, 'speed drained');
  assert(!s.selectProjectile('speed'), 'zero-ammo bird must not be selectable');
  assert(!h.fire(-6, -5, 'speed'), 'zero-ammo bird must not be launchable');
});

await test('red bird: no ability — activation is a no-op, flight normal', async () => {
  await h.gotoLevel(1);
  await h.waitForState('AIMING');
  const s = h.scene();
  eq(s.selectedProjectile, 'basic', 'level 1 default is the red bird');
  assert(h.fire(-6, -5), 'launch refused'); // guaranteed miss
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  const live = s.factory.projectilesOfShot(s.currentShot.id);
  eq(live.length, 1, 'exactly one projectile');
  assert(!s.factory.tryActivateAbility(live[0]), 'red bird must have no activatable ability');
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
});

await test('blue bird: accelerates exactly once, capped to the tunneling limit', async () => {
  await h.gotoLevel(4); // roster [basic, speed]
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(s.selectProjectile('speed'), 'speed selection refused');
  assert(h.fire(14, -7), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  const p = s.factory.projectilesOfShot(s.currentShot.id)[0];
  assert(p, 'no flying speed bird');
  const v0 = Math.hypot(p.body.velocity.x, p.body.velocity.y);
  assert(s.factory.tryActivateAbility(p), 'boost activation refused');
  const v1 = Math.hypot(p.body.velocity.x, p.body.velocity.y);
  assert(v1 > v0 * 1.2, `boost did not accelerate (${v0.toFixed(1)} → ${v1.toFixed(1)})`);
  assert(v1 <= TUNNELING.BOOST_SPEED_CAP + 0.01, `boost exceeded the safe cap (${v1.toFixed(1)})`);
  // second activation (double tap) must do nothing
  assert(!s.factory.tryActivateAbility(p), 'double activation must be refused');
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
});

await test('yellow bird: splits into exactly FIVE smaller birds, one shot identity, bounded energy', async () => {
  await h.gotoLevel(10);
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(s.selectProjectile('split'), 'split selection refused');
  assert(h.fire(15, -7), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  const parent = s.factory.projectilesOfShot(s.currentShot.id)[0];
  const parentSpeed = Math.hypot(parent.body.velocity.x, parent.body.velocity.y);
  const parentDisplay = parent.displayWidth;
  s.tryActivateAbilities();
  const kids = s.factory.projectilesOfShot(s.currentShot.id);
  eq(kids.length, 5, `expected exactly 5 children, got ${kids.length}`);
  assert(kids.every((k) => k.wb.typeKey === 'split-child'), 'non-child in the fan');
  assert(kids.every((k) => k.wb.shotId === s.currentShot.id), 'children must share ONE shot id');
  // visibly smaller than the parent, but recognizable
  for (const k of kids) {
    assert(k.displayWidth < parentDisplay * 0.75, 'child not smaller than the parent');
    assert(k.displayWidth > parentDisplay * 0.35, 'child too small to recognize');
    const sp = Math.hypot(k.body.velocity.x, k.body.velocity.y);
    assert(sp <= TUNNELING.SPLIT_CHILD_SPEED_CAP + 0.01, `child speed ${sp.toFixed(1)} over cap`);
    assert(sp <= parentSpeed * SPLIT_CHILD.speedScale + 2.01,
      `child speed ${sp.toFixed(1)} injects excessive energy (parent ${parentSpeed.toFixed(1)})`);
    assert(k.wb.ability === null, 'children must not carry an ability');
  }
  // fan formation: angles spread monotonically around the flight direction
  const angles = kids.map((k) => Math.atan2(k.body.velocity.y, k.body.velocity.x));
  angles.sort((a, b) => a - b);
  const fan = angles[4] - angles[0];
  assert(fan > 0.4 && fan < 1.6, `fan spread ${+(fan * 57.3).toFixed(1)}° outside a controlled range`);
  // no child spawned inside a sibling
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const d = Math.hypot(kids[i].x - kids[j].x, kids[i].y - kids[j].y);
      assert(d >= 2 * SPLIT_CHILD.radius - 2, `children ${i}/${j} overlap (${d.toFixed(1)}px)`);
    }
  }
  // split consumed no additional ammunition (1 launch = 1 unit)
  eq(s.birdInventory.count('split'), 1, 'split activation must not consume ammo');
  await h.waitFor(() => s.currentShot.resolvedHandled, 25000);
});

await test('split: the five birds cannot select multiple answers (one per shot)', async () => {
  await h.gotoLevel(10);
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(s.selectProjectile('split'), 'split selection refused');
  assert(h.fire(15, -7), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  s.tryActivateAbilities();
  let kids = s.factory.projectilesOfShot(s.currentShot.id);
  eq(kids.length, 5, 'fan did not spawn');
  // deliver child 0 onto a WRONG target and child 1 onto ANOTHER target —
  // only the first touch may select an answer for this shot
  const wrongA = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId);
  const others = s.factory.targets.filter((t) => t !== wrongA);
  const wrongB = others.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId) || others[0];
  placeBody(kids[0], wrongA.x, wrongA.y);
  placeBody(kids[1], wrongB.x, wrongB.y);
  assert(await h.waitFor(() => h.state() === 'ANSWER_FEEDBACK', 8000), 'first child never answered');
  assert(s.currentShot.answered, 'shot not marked answered');
  eq(s.scoring.wrongHits, 1, 'both children must not register wrong hits');
  const hitCount = s.factory.targets.filter((t) => t.wb.hit).length;
  eq(hitCount, 1, `exactly one target may be hit by one shot, got ${hitCount}`);
  // after re-arm, the leftover child touching another target changes nothing
  await h.waitForState('AIMING', 20000);
  kids = s.factory.projectilesOfShot(s.currentShot.id);
  const leftover = kids.find((k) => !k.wb.consumed);
  if (leftover) {
    const untouched = s.factory.targets.find((t) => !t.wb.hit);
    const scoreBefore = s.scoring.liveScore();
    const wrongBefore = s.scoring.wrongHits;
    placeBody(leftover, untouched.x, untouched.y);
    await sleep(900);
    eq(s.scoring.wrongHits, wrongBefore, 'late child registered a SECOND answer');
    eq(s.scoring.liveScore(), scoreBefore, 'late child changed the score');
    eq(s.factory.targets.filter((t) => t.wb.hit).length, 1, 'late child hit another target');
  }
});

await test('black bird: manual mid-flight detonation explodes once and damages blocks', async () => {
  await h.gotoLevel(12);
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(s.selectProjectile('bomb'), 'bomb selection refused');
  assert(h.fire(16, -6), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  const bomb = s.factory.projectilesOfShot(s.currentShot.id)[0];
  assert(bomb, 'no flying bomb');
  // fly it over the tower band, then detonate mid-flight
  await h.waitFor(() => bomb.x > 700 || bomb.wb.consumed, 5000);
  const at = { x: bomb.x, y: bomb.y };
  const nearBlocks = s.factory.blocks.filter((b) => !b.wb.removed
    && Math.hypot(b.x - at.x, b.y - at.y) <= 150);
  assert(s.factory.tryActivateAbility(bomb), 'manual detonation refused');
  assert(bomb.wb.consumed, 'detonated bomb must be consumed');
  // repeated detonation attempts must be refused (no double explosion)
  assert(!s.factory.tryActivateAbility(bomb), 'second detonation must be refused');
  assert(!s.tryActivateAbilities(), 'scene-level re-detonation must be refused');
  await sleep(300); // explosion queue drains on the next factory update
  eq(s.factory.explosionQueue.length, 0, 'explosion queue must drain');
  const damaged = nearBlocks.filter((b) => b.wb.removed || b.wb.hp < b.wb.maxHp);
  assert(damaged.length > 0 || nearBlocks.length === 0,
    'no block near the blast was damaged');
  await h.waitFor(() => s.currentShot.resolvedHandled, 25000);
});

await test('black bird: impact fallback also detonates exactly once', async () => {
  await h.gotoLevel(12);
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(s.selectProjectile('bomb'), 'bomb selection refused');
  assert(h.fire(16, -6), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  const bomb = s.factory.projectilesOfShot(s.currentShot.id)[0];
  assert(bomb, 'no flying bomb');
  // never tap: first impact must detonate (documented fallback)
  await h.waitFor(() => bomb.wb.firstImpactDone, 8000);
  assert(bomb.wb.consumed, 'impact must consume the bomb (explosion queued)');
  assert(!s.factory.tryActivateAbility(bomb), 'post-impact activation must be refused');
  await h.waitFor(() => s.currentShot.resolvedHandled, 25000);
});

await test('purple bird: mid-flight freeze weakens nearby blocks temporarily', async () => {
  await h.gotoLevel(7); // roster [basic, speed, ice]
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(s.selectProjectile('ice'), 'ice selection refused');
  assert(h.fire(16, -5), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  const ice = s.factory.projectilesOfShot(s.currentShot.id)[0];
  assert(ice, 'no flying ice bird');
  await h.waitFor(() => ice.x > 650 || ice.wb.firstImpactDone, 5000);
  const at = { x: ice.x, y: ice.y };
  const inRange = s.factory.blocks.filter((b) => !b.wb.removed
    && Math.hypot(b.x - at.x, b.y - at.y) <= ICE.RADIUS);
  assert(s.factory.tryActivateAbility(ice), 'manual freeze refused');
  assert(!s.factory.tryActivateAbility(ice), 'second freeze must be refused');
  const frozen = inRange.filter((b) => b.wb.frozenUntil > s.time.now);
  assert(frozen.length === inRange.length || frozen.length > 0,
    `expected in-range blocks frozen, got ${frozen.length}/${inRange.length}`);
  // frozen blocks are more fragile: damage multiplier applies while frozen
  const target = frozen[0] || inRange[0];
  if (target) {
    const hpBefore = target.wb.hp;
    s.factory.damageBlock(target, 20, 'test');
    assert(target.wb.hp < hpBefore - 20, 'frozen block must take amplified damage');
  }
  // physics keeps running (world not paused by the freeze)
  assert(!s.matter.world.isPaused, 'freeze must not pause the physics world');
  await h.waitFor(() => s.currentShot.resolvedHandled, 25000);
});

await test('ability gating: no activation before launch, after resolve, or while paused', async () => {
  await h.gotoLevel(2);
  await h.waitForState('AIMING');
  const s = h.scene();
  s.currentShot = null;
  assert(!s.tryActivateAbilities(), 'activation must be impossible before launch');
  assert(h.fire(-6, -5), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
  await h.waitForState('AIMING', 15000);
  assert(!s.tryActivateAbilities(), 'activation must be refused after the shot resolved');
  // paused mid-flight
  assert(h.fire(-6.5, -5), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  s.doPause();
  assert(!s.tryActivateAbilities(), 'activation must be refused while paused');
  s.togglePause();
  await h.waitFor(() => s.currentShot.resolvedHandled, 25000);
});

await test('no selection changes during an active flight', async () => {
  const s = h.scene();
  await h.waitForState('AIMING', 15000);
  assert(h.fire(-7, -5), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  assert(!s.selectProjectile('basic'), 'selection must be locked mid-flight');
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
});

await test('auto-select: next available bird loads when ammo hits zero', async () => {
  await h.gotoLevel(13); // shots 4, basic 3, speed 2, split 2, bomb 1, ice 1
  await h.waitForState('AIMING');
  const s = h.scene();
  eq(s.selectedProjectile, 'basic', 'start with red');
  for (let i = 0; i < 3; i++) {
    assert(h.fire(11, -6), `basic launch ${i + 1} refused`);
    await h.waitFor(() => s.currentShot.resolvedHandled, 25000);
    await h.waitForState('AIMING', 20000);
  }
  eq(s.birdInventory.count('basic'), 0, 'red drained');
  assert(h.fire(11, -6, 'basic') === false, 'zero-ammo launch must be refused');
  // the next valid loading opportunity auto-selected another bird
  assert(s.selectedProjectile !== 'basic', 'no auto-selection after red hit zero');
  assert(s.birdInventory.canSelect(s.selectedProjectile), 'auto-selected bird must have ammo');
  eq(s.slingshot.loadedType, s.selectedProjectile, 'slingshot must carry the auto-selected bird');
});

await test('shot limit binds even with plenty of ammunition', async () => {
  await h.gotoLevel(13); // 4 shots, 9 birds
  await h.waitForState('AIMING');
  const s = h.scene();
  eq(s.shotsLeft, 4, 'L13 shot budget');
  let fired = 0;
  // guaranteed-miss backward lobs (cannot touch plaques or towers) with a
  // different bird type each time — ammunition is plentiful throughout
  for (let i = 0; i < 4; i++) {
    const type = ['basic', 'speed', 'split', 'bomb'][i];
    assert(s.selectProjectile(type) || s.selectedProjectile === type, `${type} selection`);
    assert(h.fire(-6 - i * 0.25, -5, type), `shot ${i + 1} (${type}) refused`);
    fired++;
    await h.waitFor(() => s.currentShot.resolvedHandled, 25000);
    if (i < 3) await h.waitForState('AIMING', 20000);
  }
  eq(fired, 4, 'fired');
  eq(s.shotsLeft, 0, 'shots exhausted');
  const ammoLeft = Object.values(s.birdInventory.snapshot()).reduce((a, b) => a + b, 0);
  assert(ammoLeft > 0, 'ammunition should remain beyond the shot limit');
  assert(!h.fire(-6, -5, 'ice'), 'launch beyond the shot limit must be refused');
});

await test('retry/restart: question retry restores full ammunition consistently', async () => {
  await h.gotoLevel(12);
  await h.waitForState('AIMING');
  const s = h.scene();
  assert(h.fire(-6, -5), 'launch refused'); // guaranteed miss
  await h.waitFor(() => s.currentShot.resolvedHandled, 20000);
  await h.waitForState('AIMING', 15000);
  eq(s.birdInventory.count('basic'), 2, 'one basic consumed pre-retry');
  // the pause-menu path routes through LEVEL_FAILED (the only legal way to
  // reload a question from AIMING — matches restartQuestionFromMenu)
  s.restartQuestionFromMenu();
  await h.waitFor(() => h.scene() !== s || h.scene().questionIndex === s.questionIndex, 4000);
  await h.waitForState('AIMING', 20000);
  const reloaded = h.scene();
  eq(reloaded.birdInventory.count('basic'), 3, 'retry must restore the per-question inventory');
  eq(reloaded.shotsLeft, reloaded.level.shotsPerQuestion, 'retry must restore the shot budget');
  // restart level → fresh everything
  reloaded.restartLevel();
  await h.waitForState('AIMING', 25000);
  const fresh = h.scene();
  eq(fresh.birdInventory.count('basic'), 3, 'level restart must restore ammunition');
  eq(fresh.shotsLeft, fresh.level.shotsPerQuestion, 'level restart must restore shots');
});

await test('progression: correct answer via a split child advances the question', async () => {
  await h.gotoLevel(10);
  await h.waitForState('AIMING');
  const s = h.scene();
  const q0 = s.questionIndex;
  assert(s.selectProjectile('split'), 'split selection refused');
  assert(h.fire(15, -7), 'launch refused');
  await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
  s.tryActivateAbilities();
  const kids = s.factory.projectilesOfShot(s.currentShot.id);
  eq(kids.length, 5, 'fan did not spawn');
  const good = h.correctTarget();
  placeBody(kids[2], good.x, good.y);
  assert(await h.waitFor(() => h.state() === 'ANSWER_FEEDBACK', 8000), 'split child never answered');
  assert(await h.waitFor(() => h.scene().questionIndex === q0 + 1, 20000)
    || h.state() === 'LEVEL_COMPLETE', 'question did not advance after the correct answer');
});

await test('ghosts: no projectile bodies survive the question change', async () => {
  const s = h.scene();
  await h.waitForState('AIMING', 15000);
  eq(s.factory.projectiles.length, 0, `projectiles leaked across the question change: ${s.factory.projectiles.length}`);
  eq(s.factory.birdSkins.length, 0, 'skins leaked across the question change');
});

await test('four questions remain playable end-to-end with the new inventory', async () => {
  await h.gotoLevel(1);
  await h.waitForState('AIMING');
  const s = h.scene();
  const guard = { shots: 0 };
  while (h.state() !== 'LEVEL_COMPLETE' && guard.shots < 30) {
    await h.waitFor(() => h.state() === 'AIMING' || h.state() === 'LEVEL_COMPLETE' || h.state() === 'LEVEL_FAILED', 25000);
    if (h.state() === 'LEVEL_FAILED') throw new Error('out of shots — inventory broke playability');
    if (h.state() === 'LEVEL_COMPLETE') break;
    // ammunition invariant during play: never negative, selection always loadable
    for (const [k, n] of Object.entries(s.birdInventory.snapshot())) {
      assert(n >= 0, `negative ammunition for ${k}`);
    }
    const sol = s.debugAutoAim();
    if (!sol) throw new Error('autoAim found no solution');
    guard.shots++;
    await h.waitFor(() => h.state() !== 'PROJECTILE_FLYING', 25000);
  }
  await h.waitFor(() => h.state() === 'LEVEL_COMPLETE', 25000);
  console.log(`      (completed 4 questions in ${guard.shots} shots)`);
});

await h.destroy();

console.log(`\n== Fix #19 bird ammo & abilities suite: ${passed} passed, ${failed} failed ==`);
if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f.name}: ${f.error.message}`);
  process.exit(1);
}
process.exit(0);
