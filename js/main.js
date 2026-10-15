/**
 * WORD BLAST entry point.
 * Fixed logical world (1280×720) + responsive camera scaling: physics is
 * completely independent of the device resolution.
 */
import Phaser from 'phaser';
import { WORLD, PHYSICS, COLORS } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { LevelSelectScene } from './scenes/LevelSelectScene.js';
import { GameScene } from './scenes/GameScene.js';
import { installDebugAPI } from './dev/DebugAPI.js';

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  backgroundColor: COLORS.SKY,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
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

installDebugAPI(game);
