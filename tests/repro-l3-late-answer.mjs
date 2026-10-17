/**
 * Focused repro for: "freeze regression: correct answer landing AFTER
 * re-arm still advances (L3)" — instruments every step of the soft-lob +
 * teleport-deliver sequence to see where the answer contact is lost.
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

const { WORLD } = await import('../js/config.js');
const { BootScene } = await import('../js/scenes/BootScene.js');
const { MenuScene } = await import('../js/scenes/MenuScene.js');
const { LevelSelectScene } = await import('../js/scenes/LevelSelectScene.js');
const { GameScene } = await import('../js/scenes/GameScene.js');
const { installDebugAPI } = await import('../js/dev/DebugAPI.js');
const { solveLaunch, predictPath } = await import('../js/systems/Trajectory.js');

const game = new Phaser.Game({
  type: Phaser.CANVAS, parent: 'game', width: WORLD.WIDTH, height: WORLD.HEIGHT,
  backgroundColor: 0x8ecae6, render: { antialias: false },
  physics: { default: 'matter', matter: { gravity: { y: 1 }, enableSleeping: true, debug: false } },
  fps: { forceSetTimeOut: true, target: 60 },
  scene: [BootScene, MenuScene, LevelSelectScene, GameScene]
});
installDebugAPI(game);
const api = globalThis.window.__WB__;
const M = Phaser.Physics.Matter.Matter;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, timeoutMs = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let v = false; try { v = !!pred(); } catch { /* mid-restart */ }
    if (v) return true;
    await sleep(16);
  }
  return false;
};
const state = () => api.state();
const scene = () => api.scene();

const main = async () => {
  await waitFor(() => !!game.registry.get('questions'), 8000);
  api.gotoLevel(3);
  await waitFor(() => scene()?.prepared, 8000);
  await waitFor(() => state() === 'AIMING', 8000);
  const s = scene();
  const correct = s.factory.targets.find((t) => t.wb.choiceId === s.prepared.question.correctAnswerId);
  console.log(`GROUND_Y=${WORLD.GROUND_Y} anchor=${JSON.stringify(s.slingshot.anchor)}`);
  console.log('targets:', s.factory.targets.map((t) => `${t.wb.choiceId}(${t.x.toFixed(0)},${t.y.toFixed(0)})${t.wb.choiceId === correct.wb.choiceId ? '<=CORRECT' : ''}`).join(' '));
  console.log('blocks:', s.factory.blocks.map((b) => `${b.wb.asset}(${b.x.toFixed(0)},${b.y.toFixed(0)})`).join(' '));

  // instrument collisions involving the correct target
  const tgtBodyId = correct.body.id;
  s.matter.world.on('collisionstart', (ev) => {
    for (const p of ev.pairs) {
      const other = p.bodyA.id === tgtBodyId ? p.bodyB : p.bodyB.id === tgtBodyId ? p.bodyA : null;
      if (!other) continue;
      const og = other.gameObject;
      console.log(`  [coll] target<-${other.label}${og && og.wb && og.wb.kind ? ':' + og.wb.kind : ''} otherStatic=${other.isStatic} state=${state()} hit=${correct.wb.hit}`);
    }
  });

  // soft lob far short
  const landX = Math.max(530, correct.x - 260);
  const anchor = s.slingshot.anchor;
  let sol = null;
  for (const ang of [-30, -35, -25, -40, -20]) {
    const cand = solveLaunch(anchor.x, anchor.y, landX, WORLD.GROUND_Y - 16, { angleDeg: ang, steps: 200 });
    if (cand && cand.missDistance < 30) { sol = cand; break; }
  }
  if (!sol) { // fallback: modest arc
    sol = { vx: 9.5, vy: -6 };
  }
  console.log(`lob: landX=${landX} v=(${sol.vx.toFixed(1)},${sol.vy.toFixed(1)})`);
  s.debugLaunch(sol.vx, sol.vy);
  await waitFor(() => state() === 'AIMING', 20000);
  const ball0 = s.factory.projectiles.filter((p) => !p.wb.consumed)[0];
  console.log(`after re-arm: state=${state()} ball=${ball0 ? `(${ball0.x.toFixed(0)},${ball0.y.toFixed(0)}) sleeping=${ball0.body.isSleeping}` : 'GONE'} shotId=${s.currentShot && s.currentShot.id} answered=${s.currentShot && s.currentShot.answered} qIdx=${s.questionIndex}`);
  if (!ball0) { console.log('REPRO END: no live ball'); process.exit(1); }

  const offsets = [8, -8, 0, 20, -20, 12, 4, -16];
  for (let i = 0; i < offsets.length; i++) {
    const t = s.factory.targets.find((x) => x.wb.choiceId === s.prepared.question.correctAnswerId);
    if (!t || !ball0.body) break;
    M.Sleeping.set(ball0.body, false);
    M.Body.setPosition(ball0.body, { x: t.x + offsets[i], y: t.y - 30 });
    M.Body.setVelocity(ball0.body, { x: 0, y: 1 });
    console.log(`try${i}: teleport ball to (${(t.x + offsets[i]).toFixed(0)},${(t.y - 30).toFixed(0)}) tgt=(${t.x.toFixed(0)},${t.y.toFixed(0)}) top=${(t.y - 40).toFixed(0)}`);
    const landed = await waitFor(() => s.prepared && s.prepared.answered === true, 3500);
    if (landed) { console.log(`try${i}: ANSWERED ✔ state=${state()}`); break; }
    console.log(`try${i}: no answer — ball now (${ball0.x.toFixed(0)},${ball0.y.toFixed(0)}) v=(${ball0.body.velocity.x.toFixed(1)},${ball0.body.velocity.y.toFixed(1)}) state=${state()} hit=${t.wb.hit} answeredFlag=${s.prepared && s.prepared.answered}`);
  }
  await waitFor(() => s.questionIndex === 1 || state() === 'ANSWER_FEEDBACK' || state() === 'NEXT_QUESTION', 8000);
  console.log(`final: qIdx=${s.questionIndex} state=${state()}`);
  game.destroy(false);
  await sleep(80);
  process.exit(0);
};
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
