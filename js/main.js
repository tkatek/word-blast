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
import { installDebugAPI } from './dev/DebugAPI.js';

export const game = new Phaser.Game({
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
    // setTimeout-based loop: keeps running when the canvas is occluded
    // (rAF stops), which headless testing and some embedded webviews need.
    forceSetTimeOut: true,
    target: 60
  },
  input: {
    activePointers: 3,   // multi-touch friendly
    touch: { capture: true }
  },
  scene: [BootScene, MenuScene, LevelSelectScene, GameScene]
});

// Fix #2 — full-bleed responsive viewport + landscape-only gate for phones.
export const viewport = new ViewportController(game, { onChange: refreshOrientationGate });
installOrientationGate();

installDebugAPI(game);
