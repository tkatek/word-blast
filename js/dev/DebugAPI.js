/**
 * Debug / automated-test API exposed on window.__WB__.
 * Used by the browser integration tests; harmless in normal play.
 */
import { WORLD, QUESTION_CARD } from '../config.js';
import { clientToWorld, worldToClient } from '../systems/InputMapper.js';
import { deviceInfo, setOrientationOverride, setTypeOverride } from '../systems/Device.js';
import { currentView } from '../systems/Viewport.js';
import { refreshOrientationGate } from '../systems/OrientationGate.js';
import { DebugLog } from '../systems/DebugLog.js';

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
      return s && s.stateMachine ? s.stateMachine.current : 'scene-pending';
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
      // SceneManager.start boots pending scenes and restarts running ones —
      // scene.restart() alone fails on a scene that never booted.
      game.scene.start('GameScene', { levelId });
      return true;
    },

    /**
     * Start a level AT A SPECIFIC QUESTION (answer-panel verification needs
     * the sentence questions on demand). Walks the legal state-machine path
     * to NEXT_QUESTION and loads the question from there. Async — resolves
     * once the question is loaded (QUESTION_READY or later).
     */
    async gotoQuestion(levelId, index) {
      api.gotoLevel(levelId);
      await new Promise((resolve) => {
        const poll = () => {
          const s = api.scene();
          if (s && s.prepared) return resolve();
          setTimeout(poll, 50);
        };
        poll();
      });
      const s = api.scene();
      if (s.questionIndex === index) return true;
      const sm = s.stateMachine;
      for (const st of ['AIMING', 'PROJECTILE_FLYING', 'PHYSICS_RESOLVING', 'NEXT_QUESTION']) {
        if (sm.current !== st) {
          if (!sm.set(st)) return false;
        }
      }
      s.loadQuestion(index);
      return s.questionIndex === index;
    },

    /** Map client coords → world coords for the canvas (input mapping test). */
    mapClient(clientX, clientY) {
      const canvas = game.canvas;
      // Fix #2: the canvas shows the camera's fit view (zoom-aware), not
      // necessarily the bare 1280×720 world rect.
      const scene = game.scene.getScenes(true)[0];
      return clientToWorld(clientX, clientY, canvas.getBoundingClientRect(), currentView(scene));
    },

    /** Inverse of mapClient: world coords → client (synthesizing pointer
     *  events in automated UI tests, e.g. clicking the menu buttons). */
    worldToClient(wx, wy) {
      const canvas = game.canvas;
      const scene = game.scene.getScenes(true)[0];
      return worldToClient(wx, wy, canvas.getBoundingClientRect(), currentView(scene));
    },

    /**
     * Fix #21 — main-menu diagnostics (progress, art source, transition
     * guards). The menu itself never draws developer text; this is the only
     * diagnostic channel.
     */
    menu() {
      const s = game.scene.getScene('MenuScene');
      if (!s || !s.sys.isActive()) return { active: false };
      return s.menuDebugInfo();
    },

    /** Await a game state (polling — robust across scene restarts). */
    waitForState(target, timeoutMs = 12000) {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const poll = () => {
          const s = api.scene();
          const current = s && s.stateMachine ? s.stateMachine.current : null;
          if (current === target) return resolve(true);
          if (Date.now() - start > timeoutMs) {
            return reject(new Error(`waitForState(${target}) timed out; state=${current || 'scene-pending'}`));
          }
          setTimeout(poll, 60);
        };
        poll();
      });
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
    world: { WIDTH: WORLD.WIDTH, HEIGHT: WORLD.HEIGHT },

    /** Disable/enable blur & visibility auto-pause (for automated runs). */
    setAutoPause(enabled) {
      const s = api.scene();
      if (s) s.disableAutoPause = !enabled;
      return enabled;
    },

    /** Current device classification + the official background in use. */
    device() {
      const s = api.scene();
      return { ...deviceInfo(), background: s && s.background ? s.background.type : null };
    },

    /** Force a viewport re-read + re-frame (responsive-system tests). */
    refreshViewport() {
      const vp = game.registry.get('viewport');
      if (vp) vp.refresh();
      return true;
    },

    /** Test-only orientation override: 'portrait' | 'landscape' | null. */
    setOrientationOverride(mode) {
      setOrientationOverride(mode);
      refreshOrientationGate(); // DOM rotate overlay follows the override
      const s = api.scene();
      if (s && s.updateOrientationState) s.updateOrientationState();
      return mode;
    },

    /** Test-only device-type override: 'desktop' | 'tablet' | 'mobile' | null. */
    setDeviceOverride(type) {
      setTypeOverride(type);
      refreshOrientationGate(); // portrait requirement depends on the device class
      const s = api.scene();
      if (s) s.device = { ...deviceInfo() };
      if (s && s.updateOrientationState) s.updateOrientationState();
      return type;
    },

    /**
     * Toggle development diagnostic logging (state transitions, shots,
     * collisions, answers, physics resolution). Equivalent to ?debug=1.
     */
    setDebug(enabled) {
      DebugLog.enabled = !!enabled;
      return DebugLog.enabled;
    },

    /**
     * Test/screenshot aid (Fix #17): pin the countdown without touching the
     * state machine — the next active-state frame ticks normally from there.
     */
    setTimeRemaining(ms) {
      const s = api.scene();
      if (!s || !s.levelTimer) return null;
      s.levelTimer.setRemaining(ms);
      return s.levelTimer.remainingMs;
    },

    /** Test/screenshot aid (Fix #17): force the displayed/ruled heart count. */
    setHearts(n) {
      const s = api.scene();
      if (!s || !s.hearts) return null;
      s.hearts.remaining = Math.max(0, Math.min(s.hearts.max, n | 0));
      s.refreshHUD();
      return s.hearts.remaining;
    },

    /**
     * Manually advance the game loop N frames. Used by automated tests when
     * the host tab is occluded and requestAnimationFrame stops firing.
     */
    step(frames = 1) {
      const loop = game.loop;
      let ran = 0;
      for (let i = 0; i < frames; i++) {
        if (typeof loop.tick === 'function') {
          loop.tick();
          ran++;
        } else {
          break;
        }
      }
      return ran;
    },

    /**
     * Fix #9 — shorten the question-card presentation phases for automated
     * runs (module-level timings, survives scene restarts). Omitted fields
     * keep their current value; production uses the config defaults.
     */
    setCardTimings(patch = {}) {
      Object.assign(QUESTION_CARD.TIMINGS, patch);
      return { ...QUESTION_CARD.TIMINGS };
    },

    /** Fix #9 — live question-card snapshot (phase, geometry, audio state). */
    cardInfo() {
      const s = api.scene();
      if (!s || !s.card) return null;
      return s.card.info();
    },

    /** True if the loop is currently advancing (for stall detection). */
    isLoopRunning() {
      return !game.loop.isStopped && document.visibilityState === 'visible';
    },

    /**
     * Fix #22 — live audio diagnostics: engine state, active voices,
     * per-key play/drop counters (used by the audio verification script).
     */
    audio() {
      const audio = game.registry.get('audio');
      return audio ? audio.audioDebugInfo() : { attached: false };
    }
  };

  window.__WB__ = api;
  return api;
}
