/**
 * WORD BLAST entry point.
 * Fixed logical world (1280×720) + responsive "fit world, extend scenery"
 * presentation (Fix #2): physics is completely independent of the device
 * resolution; the canvas fills the whole browser viewport.
 */
import Phaser from 'phaser';
import { WORLD, PHYSICS, COLORS } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { LevelSelectScene } from './scenes/LevelSelectScene.js';
import { GameScene } from './scenes/GameScene.js';
import { ViewportController } from './systems/Viewport.js';
import { installOrientationGate, refreshOrientationGate } from './systems/OrientationGate.js';
import { FullscreenController } from './systems/FullscreenController.js';
import { installFullscreenEntry } from './systems/FullscreenEntry.js';
import { installDiagnostics } from './systems/Diagnostics.js';
import { installDebugAPI } from './dev/DebugAPI.js';
import { BUILD_ID } from './build-info.js';

// Build identity on the root element + console: a stale deployment (phone
// still serving an old build) is recognizable without any tools.
if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.dataset.wbBuild = BUILD_ID;
}
console.info(`[WORD BLAST] build ${BUILD_ID} — add ?diag=1 to the URL for on-device diagnostics.`);

// Boot watchdog handshake (Fix: Live Server blank screen): if Phaser cannot
// initialize, surface the failure via the index.html error overlay instead of
// leaving an empty sky-colored page; on success retire the loading chip.
function createGame() {
  try {
    return new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      width: WORLD.WIDTH,
      height: WORLD.HEIGHT,
      backgroundColor: COLORS.SKY,
      scale: {
        // NONE: the ViewportController is the single owner of the canvas size —
        // it tracks the real visible viewport (toolbar/notch aware) × DPR so the
        // game fills the window edge-to-edge with zero letterboxing. Scenes
        // frame the 1280×720 world with a camera zoom (systems/Viewport.js).
        mode: Phaser.Scale.NONE,
        autoCenter: Phaser.Scale.NO_CENTER
      },
      physics: {
        default: 'matter',
        matter: {
          gravity: { y: PHYSICS.GRAVITY_Y },
          enableSleeping: PHYSICS.ENABLE_SLEEPING,
          debug: false
        }
      },
      fps: {
        // Loop strategy: real players get the vsync-aligned rAF loop
        // (smoother pacing, no timer-coalescing jitter — the setTimeout
        // loop was a stutter source on iPhone Safari). Headless automation
        // keeps the setTimeout loop because rAF never fires on an occluded
        // headless page (window.__WB__.step remains the manual fallback).
        // ?wbtimeout=1 forces the setTimeout loop for debugging either way.
        forceSetTimeOut: typeof window !== 'undefined'
          && (/HeadlessChrome|PhantomJS|Puppeteer/.test(window.navigator.userAgent)
            || /[?&#]wbtimeout(=1)?\b/.test(window.location.search + window.location.hash)),
        target: 60
      },
      input: {
        activePointers: 3,   // multi-touch friendly
        touch: { capture: true }
      },
      scene: [BootScene, MenuScene, LevelSelectScene, GameScene]
    });
  } catch (err) {
    window.__wbBoot?.fail('Phaser failed to initialize: ' + (err?.message || err));
    throw err;
  }
}

export const game = createGame();
game.events.once('ready', () => window.__wbBoot?.ok());

// Fix #2 — full-bleed responsive viewport + landscape-only gate for phones.
export const viewport = new ViewportController(game, { onChange: refreshOrientationGate });
game.registry.set('viewport', viewport); // debug/test access
installOrientationGate();

// Mobile landscape fullscreen: one controller owns the Fullscreen API for
// the whole app (menu, gameplay, pause menu exit control). The entry UI
// (PLAY FULLSCREEN card / Add-to-Home-Screen hint) waits for game 'ready'
// before anything can appear — no fullscreen controls over a failed boot.
export const fullscreen = new FullscreenController();
game.registry.set('fullscreen', fullscreen);
installFullscreenEntry(game, fullscreen);

// On-device diagnostics (?diag=1): build identity, launch mode, fullscreen
// capability + last error, live dimensions, gate/pause state — copyable,
// nothing persisted. No-op without the URL flag.
export const diagnostics = installDiagnostics({ game, fullscreen });

installDebugAPI(game);
