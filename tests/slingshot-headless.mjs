/**
 * SLINGSHOT INTEGRATION TEST (headless, real Phaser + Matter physics).
 *
 * Boots the real game like tests/helpers/headless-game.mjs, but serves a
 * *normalized* copy of levels.json (every question exactly 3 targets) so the
 * run is independent of in-flight level-data migrations. The slingshot is
 * then driven through its real handler path:
 *
 *   1. anchor = per-device cliff anchor (SLINGSHOT.ANCHORS)
 *   2. loaded preview rests at the anchor
 *   3. drag (pointer down/move/up handlers) stretches toward MAX_DRAG
 *   4. release → projectile spawns AT THE POUCH POSITION with rightward v
 *   5. trajectory/physics agree (dots start where the body spawns)
 *   6. re-arm reloads at the anchor; debugAutoAim completes all 4 questions
 *      from the new anchor through the real launch path
 *
 * Run: node tests/slingshot-headless.mjs
 */
import { installPhaserEnv } from './helpers/phaser-env.mjs';
import { readFileSync } from 'node:fs';

const fail = (msg) => { console.error('FAIL ' + msg); process.exit(1); };
const ok = (msg) => console.log('  ok  ' + msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Loader hooks: Vite-style import.meta.env shim + normalized levels.json
// ---------------------------------------------------------------------------
const rawLevels = JSON.parse(readFileSync(new URL('../js/data/levels.json', import.meta.url), 'utf8'));
for (const lvl of rawLevels.levels) {
  for (const q of lvl.questions) {
    if (!q.layout || !Array.isArray(q.layout.targets) || q.layout.targets.length !== 3) {
      // canonical reachable triple — baked heights (translated onto
      // WORLD.GROUND_Y at runtime like every layout)
      q.layout = { ...(q.layout || {}), targets: [{ x: 660, y: 360 }, { x: 880, y: 360 }, { x: 1100, y: 360 }] };
    }
  }
}
const patchedLevels = JSON.stringify(rawLevels);

const { register } = await import('node:module');
register(new URL('./helpers/json-loader.mjs', import.meta.url), import.meta.url);
// hooks run on a separate thread — the patch must be embedded in the hook
// module itself, not passed through a global
const hookSrc = `
export async function load(url, context, next) {
  if (url.endsWith('js/data/levels.json')) {
    return { format: 'json', shortCircuit: true, source: ${JSON.stringify(patchedLevels)} };
  }
  return next(url, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hookSrc), import.meta.url);

installPhaserEnv();

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const dist = await import('phaser/dist/phaser.esm.js');
const Phaser = dist.default && dist.default.VERSION ? dist.default : dist;
const srcPath = require.resolve('phaser');
require.cache[srcPath] = { id: srcPath, filename: srcPath, loaded: true, exports: Phaser };

const { WORLD, SLINGSHOT, slingshotAnchor } = await import('../js/config.js');

const { BootScene } = await import('../js/scenes/BootScene.js');
const { MenuScene } = await import('../js/scenes/MenuScene.js');
const { LevelSelectScene } = await import('../js/scenes/LevelSelectScene.js');
const { GameScene } = await import('../js/scenes/GameScene.js');
const { installDebugAPI } = await import('../js/dev/DebugAPI.js');

const game = new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'game',
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  backgroundColor: 0x8ecae6,
  render: { antialias: false },
  physics: {
    default: 'matter',
    matter: { gravity: { y: 1 }, enableSleeping: true, debug: false }
  },
  fps: { forceSetTimeOut: true, target: 60 },
  scene: [BootScene, MenuScene, LevelSelectScene, GameScene]
});
installDebugAPI(game);
const api = globalThis.window.__WB__;

const waitFor = async (pred, timeoutMs = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let v = false;
    try { v = !!pred(); } catch { /* scene mid-restart */ }
    if (v) return true;
    await sleep(16);
  }
  return false;
};
const state = () => api.state();
const scene = () => api.scene();

// ---------------------------------------------------------------------------
const main = async () => {
  if (!(await waitFor(() => !!game.registry.get('questions'), 8000))) fail('BootScene never populated the registry');
  api.gotoLevel(1);
  if (!(await waitFor(() => scene()?.prepared, 8000))) fail('GameScene failed to boot');
  if (!(await waitFor(() => state() === 'AIMING', 8000))) fail(`never armed (state=${state()})`);

  const a = slingshotAnchor('desktop');
  const sl = scene().slingshot;

  // 1. anchor + device art selection
  if (sl.deviceType !== 'desktop') fail(`deviceType ${sl.deviceType}`);
  if (Math.abs(sl.anchor.x - a.x) > 0.01 || Math.abs(sl.anchor.y - a.y) > 0.01) fail(`anchor ${JSON.stringify(sl.anchor)} != ${JSON.stringify(a)}`);
  const baseY = sl.anchor.y + SLINGSHOT.BASE_OFFSET_Y;
  const wantBase = WORLD.GROUND_Y + SLINGSHOT.ART.GRASS_EMBED;
  if (Math.abs(baseY - wantBase) > 1) fail(`handle bottom y ${baseY} not planted on the gameplay ground (${wantBase})`);
  ok(`anchor at (${a.x}, ${a.y}), base y ${baseY} planted into the grass line ${WORLD.GROUND_Y}`);

  // 2. loaded preview rests at the anchor
  if (!sl.preview) fail('no preview image loaded');
  if (Math.hypot(sl.preview.x - a.x, sl.preview.y - a.y) > 0.01) fail('preview not resting at the anchor');
  ok('projectile preview rests in the pouch at the anchor');

  // 3. drag through the real handlers (pull back-left, 120px)
  const pull = { x: a.x - 120, y: a.y + 45 };
  sl.onPointerDown({ worldX: a.x, worldY: a.y });
  if (!sl.isDragging()) fail('pointerdown near the pouch did not start a drag');
  sl.onPointerMove({ worldX: pull.x, worldY: pull.y });
  const dLen = Math.hypot(sl.preview.x - a.x, sl.preview.y - a.y);
  if (Math.abs(dLen - Math.min(129.0, SLINGSHOT.MAX_DRAG)) > 3) fail(`drag length ${dLen.toFixed(1)} not clamped to the pull`);
  ok(`drag stretches the pouch to ${dLen.toFixed(0)}px (clamped ≤ ${SLINGSHOT.MAX_DRAG})`);

  // 4. release → launch from the pouch position, flying right
  sl.onPointerUp();
  if (state() !== 'PROJECTILE_FLYING') fail(`release did not launch (state=${state()})`);
  const balls = scene().factory.projectiles.filter((p) => !p.wb.consumed);
  if (balls.length !== 1) fail(`expected 1 live projectile, got ${balls.length}`);
  const b = balls[0];
  const spawnErr = Math.hypot(b.x - pull.x, b.y - pull.y);
  if (spawnErr > 6) fail(`physics body spawned ${spawnErr.toFixed(1)}px from the visual release point`);
  if (b.body.velocity.x <= 0) fail('projectile not flying rightward');
  ok(`projectile spawned at the pouch position (err ${spawnErr.toFixed(1)}px), v=(${b.body.velocity.x.toFixed(1)}, ${b.body.velocity.y.toFixed(1)})`);

  // 5. shot resolves and the slingshot re-arms at the anchor
  if (!(await waitFor(() => state() === 'AIMING' || state() === 'PHYSICS_RESOLVING' || state() === 'ANSWER_FEEDBACK', 12000))) fail('shot never resolved');
  if (!(await waitFor(() => state() === 'AIMING' || state() === 'ANSWER_FEEDBACK', 12000))) fail('never re-armed');
  if (!(await waitFor(() => state() === 'AIMING', 20000))) fail(`re-arm timeout (state=${state()})`);
  if (!sl.preview || Math.hypot(sl.preview.x - a.x, sl.preview.y - a.y) > 0.01) fail('reloaded preview not back at the anchor');
  ok('shot resolved and the next projectile reloaded at the anchor');

  // 6. all four questions completed from the new anchor (real physics).
  // The manual drag shot above may already have answered its question.
  const t0 = Date.now();
  let guard = 0;
  while (state() !== 'LEVEL_COMPLETE' && guard++ < 40) {
    if (!(await waitFor(() => state() === 'AIMING' || state() === 'LEVEL_COMPLETE' || state() === 'LEVEL_FAILED', 20000))) {
      fail(`never re-armed (state=${state()})`);
    }
    if (state() === 'LEVEL_COMPLETE') break;
    if (state() === 'LEVEL_FAILED') fail('out of shots before completing the level');
    const q = scene().questionIndex;
    let fired = 0;
    while (fired < 4 && scene().questionIndex === q && state() !== 'LEVEL_FAILED' && state() !== 'LEVEL_COMPLETE') {
      const sol = scene().debugAutoAim();
      if (sol) fired++;
      else fail(`autoAim found no solution from anchor (${a.x}, ${a.y})`);
      await waitFor(() => scene().questionIndex !== q || state() === 'LEVEL_COMPLETE' || state() === 'AIMING' || state() === 'LEVEL_FAILED', 25000);
      if (state() === 'LEVEL_FAILED') fail('out of shots');
    }
  }
  if (guard >= 40) fail('too many shots — level never completed');
  if (!(await waitFor(() => state() === 'LEVEL_COMPLETE', 20000))) fail(`level not complete (state=${state()})`);
  ok(`all 4 questions completed from the cliff anchor in ${Date.now() - t0}ms`);

  // 7. restart preserves the anchor (no regression to the old position)
  scene().scene.restart({ levelId: 1 });
  if (!(await waitFor(() => scene()?.prepared && state() === 'AIMING', 15000))) fail(`restart did not re-arm (state=${state()})`);
  if (Math.hypot(scene().slingshot.anchor.x - a.x, scene().slingshot.anchor.y - a.y) > 0.01) fail('restart lost the anchor');
  ok('restart keeps the slingshot on the cliff anchor');

  game.destroy(false);
  await sleep(80);
  console.log('\nSLINGSHOT INTEGRATION: ALL CHECKS PASSED');
  process.exit(0);
};

main().catch((e) => fail(e && e.stack || String(e)));
