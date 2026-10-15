/**
 * Headless integration harness: boots the REAL game (BootScene → MenuScene →
 * GameScene) with real Matter.js physics inside Phaser HEADLESS under Node.
 * The setTimeout game loop runs naturally at ~60 fps, so tests simply poll
 * for conditions. Physics, state machine, collisions, scoring — all real.
 *
 * Usage:
 *   const h = await createHeadlessGame();
 *   await h.gotoLevel(3);
 *   await h.waitForState('AIMING');
 *   h.fire(...); / h.nudgeBallIntoTarget(...)
 */
import { installPhaserEnv } from './phaser-env.mjs';

export async function createHeadlessGame() {
  installPhaserEnv();

  // Serve the game's bare JSON imports (Vite/browser convention) under Node.
  const { register } = await import('node:module');
  register(new URL('./json-loader.mjs', import.meta.url), import.meta.url);

  // Alias the dist bundle as the 'phaser' package for the game's own ESM
  // imports (Node would otherwise load the src build, which requires
  // phaser3spectorjs at module scope).
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const dist = await import('phaser/dist/phaser.esm.js');
  const Phaser = dist.default && dist.default.VERSION ? dist.default : dist;
  const srcPath = require.resolve('phaser');
  require.cache[srcPath] = { id: srcPath, filename: srcPath, loaded: true, exports: Phaser };

  const { WORLD, PHYSICS, COLORS } = await import('../../js/config.js');
  const { solveLaunch } = await import('../../js/systems/Trajectory.js');

  const { BootScene } = await import('../../js/scenes/BootScene.js');
  const { MenuScene } = await import('../../js/scenes/MenuScene.js');
  const { LevelSelectScene } = await import('../../js/scenes/LevelSelectScene.js');
  const { GameScene } = await import('../../js/scenes/GameScene.js');
  const { installDebugAPI } = await import('../../js/dev/DebugAPI.js');

  const game = new Phaser.Game({
    // CANVAS (into a no-op 2D context): generateTexture needs a renderer,
    // so pure HEADLESS cannot boot BootScene. Nothing is ever shown.
    type: Phaser.CANVAS,
    parent: 'game',
    width: WORLD.WIDTH,
    height: WORLD.HEIGHT,
    backgroundColor: COLORS.SKY,
    render: { antialias: false },
    physics: {
      default: 'matter',
      matter: { gravity: { y: PHYSICS.GRAVITY_Y }, enableSleeping: PHYSICS.ENABLE_SLEEPING, debug: false }
    },
    fps: { forceSetTimeOut: true, target: 60 },
    scene: [BootScene, MenuScene, LevelSelectScene, GameScene]
  });

  installDebugAPI(game);
  const api = globalThis.window.__WB__;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Live slingshot pouch anchor of the running scene (desktop fallback). */
  const slingAnchor = () => {
    const s = api.scene();
    return (s && s.slingshot && s.slingshot.anchor) || { x: WORLD.SLING_X, y: WORLD.SLING_Y };
  };

  const harness = {
    game, Phaser, api,
    scene: () => api.scene(),
    state: () => api.state(),
    info: () => api.info(),
    slingAnchor,
    /** The game's own inverse solver (Trajectory.js), from the live anchor. */
    solveLaunch: (tx, ty, opts) => {
      const a = slingAnchor();
      return solveLaunch(a.x, a.y, tx, ty, opts);
    },

    async gotoLevel(levelId) {
      // BootScene must finish wiring the shared managers into the registry
      const booted = await harness.waitFor(() => {
        try { return !!game.registry.get('questions') && !!game.registry.get('levels'); } catch { return false; }
      }, 8000, 'BootScene registry');
      if (!booted) throw new Error('BootScene never populated the game registry');
      api.gotoLevel(levelId);
      const ok = await harness.waitFor(() => {
        const s = harness.scene();
        return !!(s && s.prepared);
      }, 8000, `GameScene boot for level ${levelId}`);
      if (!ok) throw new Error(`GameScene failed to boot for level ${levelId}`);
      return true;
    },

    /** Poll every ~16ms until predicate is true. Returns false on timeout. */
    async waitFor(pred, timeoutMs = 12000, what = 'condition') {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        let v = false;
        try { v = !!pred(); } catch { /* scene mid-restart */ }
        if (v) return true;
        await sleep(16);
      }
      return false;
    },

    async waitForState(target, timeoutMs = 12000) {
      return harness.waitFor(() => harness.state() === target, timeoutMs, `state ${target}`);
    },

    /** Fire a shot with explicit velocity (same path as the slingshot). */
    fire(vx, vy, type) {
      return api.simulateShot({ vx, vy, type });
    },

    /** Ballistic landing predictor — mirrors the game's Trajectory integrator. */
    predictLandX(vx, vy, { x0, y0, groundY = WORLD.GROUND_Y - 16 } = {}) {
      const a = slingAnchor();
      x0 = x0 ?? a.x;
      y0 = y0 ?? a.y;
      let x = x0, y = y0, UX = vx, UY = vy;
      for (let i = 0; i < 1200; i++) {
        UX *= 0.995; UY = UY * 0.995 + 0.27778;
        x += UX; y += UY;
        if (y >= groundY) return x;
      }
      return x;
    },

    /** Solve a launch that lands at `wantX` (bisection over power per angle). */
    solveLanding(wantX) {
      const MAXV = 24;
      let best = null;
      for (const vy of [-8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5]) {
        const hiV = Math.sqrt(MAXV * MAXV - vy * vy) - 0.01;
        if (harness.predictLandX(hiV, vy) < wantX) continue;
        let lo = 2, hi = hiV;
        for (let it = 0; it < 40; it++) {
          const mid = (lo + hi) / 2;
          if (harness.predictLandX(mid, vy) < wantX) lo = mid; else hi = mid;
        }
        const vx = (lo + hi) / 2;
        const err = Math.abs(harness.predictLandX(vx, vy) - wantX);
        if (!best || err < best.err) best = { vx, vy, err };
      }
      return best;
    },

    liveBalls() {
      const s = harness.scene();
      return s ? s.factory.projectiles.filter((p) => !p.wb.consumed) : [];
    },

    correctTarget() {
      const s = harness.scene();
      return s.factory.targets.find((t) => t.wb.choiceId === s.prepared.question.correctAnswerId);
    },

    /** Apply a physical impulse to a body (simulates debris/mover contact). */
    setBodyVelocity(go, vx, vy) {
      const M = Phaser.Physics.Matter.Matter;
      M.Body.setVelocity(go.body, { x: vx, y: vy });
    },

    /** Advance the loop manually (deterministic; pauses the natural clock). */
    tick(n = 1) {
      for (let i = 0; i < n; i++) game.loop.tick();
    },

    async destroy() {
      game.destroy(false);
      await sleep(50);
    }
  };

  return harness;
}
