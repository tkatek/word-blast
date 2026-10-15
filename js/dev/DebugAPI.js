/**
 * Debug / automated-test API exposed on window.__WB__.
 * Used by the browser integration tests; harmless in normal play.
 */
import { WORLD } from '../config.js';
import { clientToWorld } from '../systems/InputMapper.js';

export function installDebugAPI(game) {
  const api = {
    version: '0.1.0',

    /** Current GameScene, if one is active. */
    scene() {
      return game.scene.getScene('GameScene');
    },

    /** Snapshot of gameplay state. */
    info() {
      const s = api.scene();
      return s && s.prepared ? s.debugInfo() : { state: 'no-game-scene' };
    },

    state() {
      const s = api.scene();
      return s ? s.stateMachine.current : 'none';
    },

    /** Programmatic launch (same internal path as a real slingshot release). */
    simulateShot({ vx, vy, type } = {}) {
      const s = api.scene();
      if (!s || !s.prepared) throw new Error('no active game scene');
      if (vx === undefined || vy === undefined) throw new Error('vx/vy required');
      return s.debugLaunch(vx, vy, type);
    },

    /** Auto-aim at a choice (default: the correct answer). Returns the solution. */
    autoAim(choiceId = null) {
      const s = api.scene();
      if (!s || !s.prepared) throw new Error('no active game scene');
      return s.debugAutoAim(choiceId);
    },

    /** Start any level directly (respects nothing — for tests). */
    gotoLevel(levelId) {
      const s = api.scene();
      if (s) s.scene.restart({ levelId });
      else game.scene.getScene('LevelSelectScene');
      return true;
    },

    /** Map client coords → world coords for the canvas (input mapping test). */
    mapClient(clientX, clientY) {
      const canvas = game.canvas;
      return clientToWorld(clientX, clientY, canvas.getBoundingClientRect());
    },

    /** Await a game state. */
    waitForState(target, timeoutMs = 12000) {
      const s = api.scene();
      if (!s) return Promise.reject(new Error('no game scene'));
      return s.waitForState(target, timeoutMs);
    },

    /** Positions of active projectiles (trajectory verification). */
    projectiles() {
      const s = api.scene();
      if (!s) return [];
      return s.factory.projectiles.map((p) => ({ type: p.wb.typeKey, x: +p.x.toFixed(1), y: +p.y.toFixed(1) }));
    },

    /** Save manager access (progress tests in browser). */
    save() {
      const boot = game.scene.getScene('BootScene');
      return boot ? boot.registry.get('save') : null;
    },

    game,
    world: { WIDTH: WORLD.WIDTH, HEIGHT: WORLD.HEIGHT }
  };

  window.__WB__ = api;
  return api;
}
