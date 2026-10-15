/**
 * Boot: generates all procedural textures (no binary assets in phase 1),
 * validates the full question/level data set, and wires the shared
 * managers into the scene registry. Invalid data stops the game with a
 * visible error instead of loading broken levels.
 */
import Phaser from 'phaser';
import { STATES, COLORS, WORLD, SLINGSHOT, PROJECTILE_TYPES } from '../config.js';
import { QuestionManager } from '../systems/QuestionManager.js';
import { LevelManager } from '../systems/LevelManager.js';
import { SaveManager } from '../systems/SaveManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { deviceInfo } from '../systems/Device.js';
import { BackgroundManager } from '../systems/BackgroundManager.js';
import questionsData from '../data/questions.json';
import levelsData from '../data/levels.json';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
    this.state = STATES.BOOTING;
  }

  /**
   * Detect the device once and queue only the background variant it needs.
   */
  preload() {
    const info = deviceInfo();
    this.registry.set('device', info);
    BackgroundManager.preload(this, info.type);
  }

  create() {
    this.state = STATES.LOADING;
    this.generateTextures();

    try {
      const questionManager = new QuestionManager(questionsData);
      const levelManager = new LevelManager(levelsData, questionsData);
      const save = new SaveManager();
      save.load();
      const audio = new AudioManager();
      audio.attach();

      this.registry.set('questions', questionManager);
      this.registry.set('levels', levelManager);
      this.registry.set('save', save);
      this.registry.set('audio', audio);
      this.registry.set('bootTime', this.time.now);

      if (levelManager.validation.warnings.length) {
        console.warn('[Boot] level warnings:\n  - ' + levelManager.validation.warnings.join('\n  - '));
      }
      this.state = STATES.MENU;
      this.scene.start('MenuScene');
    } catch (err) {
      console.error('[Boot] data validation failed:', err);
      this.cameras.main.setBackgroundColor('#2a2a2a');
      const lines = String(err.message).split('\n');
      this.add.text(40, 40, 'WORD BLAST — DATA ERROR\n\n' + lines.join('\n'), {
        fontFamily: 'monospace', fontSize: '16px', color: '#ff6b6b', wordWrap: { width: WORLD.WIDTH - 80 }
      }).setDepth(100);
    }
  }

  /* ------------------------------------------------------------------ */

  generateTextures() {
    const g = this.add.graphics();

    // ground
    g.fillStyle(COLORS.GROUND, 1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle(0x3a5a40, 1);
    g.fillRect(0, 0, 64, 10);
    g.generateTexture('tex-ground', 64, 64);

    // blocks
    this.blockTexture(g, 'tex-wood', COLORS.WOOD, COLORS.WOOD_DARK);
    this.blockTexture(g, 'tex-glass', COLORS.GLASS, COLORS.GLASS_DARK, 0.75);
    this.blockTexture(g, 'tex-stone', COLORS.STONE, COLORS.STONE_DARK);
    // explosive barrel
    g.clear();
    g.fillStyle(COLORS.BOOM, 1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle(0xfdc500, 1);
    g.fillRect(0, 24, 64, 16);
    g.generateTexture('tex-boom', 64, 64);

    // answer target
    g.clear();
    g.fillStyle(COLORS.TARGET, 1);
    g.fillRoundedRect(0, 0, 128, 72, 12);
    g.lineStyle(4, 0x1d3557, 1);
    g.strokeRoundedRect(0, 0, 128, 72, 12);
    g.generateTexture('tex-target', 128, 72);

    // projectiles
    for (const key of Object.keys(PROJECTILE_TYPES)) {
      this.circleTexture(g, `proj-${key}`, COLORS.PROJECTILES[key]);
    }
    this.circleTexture(g, 'proj-split-child', COLORS.PROJECTILES.split);

    // trajectory dot
    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('dot', 8, 8);

    g.destroy();
  }

  blockTexture(g, key, fill, edge, alpha = 1) {
    g.clear();
    g.fillStyle(fill, alpha);
    g.fillRect(0, 0, 64, 64);
    g.lineStyle(4, edge, 1);
    g.strokeRect(2, 2, 60, 60);
    if (key === 'tex-wood') {
      g.lineStyle(2, edge, 0.6);
      for (let i = 1; i < 4; i++) {
        g.beginPath();
        g.moveTo(6, i * 16);
        g.lineTo(58, i * 16);
        g.strokePath();
      }
    } else if (key === 'tex-glass') {
      g.lineStyle(3, 0xffffff, 0.7);
      g.beginPath();
      g.moveTo(8, 52);
      g.lineTo(48, 10);
      g.strokePath();
    } else if (key === 'tex-stone') {
      g.fillStyle(edge, 0.5);
      g.fillRect(10, 12, 12, 10);
      g.fillRect(40, 30, 14, 12);
      g.fillRect(16, 44, 10, 8);
    }
    g.generateTexture(key, 64, 64);
  }

  circleTexture(g, key, color) {
    g.clear();
    g.fillStyle(color, 1);
    g.fillCircle(20, 20, 18);
    g.fillStyle(0xffffff, 0.45);
    g.fillCircle(14, 13, 6);
    g.generateTexture(key, 40, 40);
  }
}
