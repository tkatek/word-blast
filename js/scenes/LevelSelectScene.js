/**
 * Level select: 15 buttons with stars, locks and best scores.
 */
import Phaser from 'phaser';
import { SAVE, WORLD } from '../config.js';
import { attachViewport, coverView } from '../systems/Viewport.js';

export class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelectScene');
  }

  create() {
    const save = this.registry.get('save');
    const levels = this.registry.get('levels');
    // Audio-repair — silence-first configuration: no music on the level
    // select; only button clicks sound.
    // Full-bleed backdrop: covers the whole visible view on any aspect
    // ratio (Fix #2) — re-covered on every resize below.
    this.backdrop = this.add.rectangle(WORLD.WIDTH / 2, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x1b4332);
    this.viewport = attachViewport(this, (view) => coverView(this.backdrop, view));

    this.add.text(WORLD.WIDTH / 2, 60, 'SELECT LEVEL', {
      fontFamily: 'Arial', fontSize: '40px', fontStyle: 'bold', color: '#ffd60a'
    }).setOrigin(0.5);

    const cols = 5;
    const cellW = 190;
    const cellH = 140;
    const startX = WORLD.WIDTH / 2 - ((cols - 1) * cellW) / 2;
    const startY = 190;

    for (let id = 1; id <= SAVE.MAX_LEVELS; id++) {
      const lvl = levels.getLevel(id);
      const col = (id - 1) % cols;
      const row = Math.floor((id - 1) / cols);
      const x = startX + col * cellW;
      const y = startY + row * cellH;

      const unlocked = save.isLevelUnlocked(id);
      const entry = save.getLevelEntry(id);
      const stars = '★★★'.slice(0, entry.bestStars) + '☆☆☆'.slice(0, 3 - entry.bestStars);

      const box = this.add.container(x, y);
      const bg = this.add.rectangle(0, 0, 160, 110, unlocked ? 0x2d6a4f : 0x495057, 1)
        .setStrokeStyle(3, unlocked ? 0xffd60a : 0x6c757d);
      const num = this.add.text(0, -32, unlocked ? String(id) : '🔒', {
        fontFamily: 'Arial', fontSize: '30px', fontStyle: 'bold', color: '#ffffff'
      }).setOrigin(0.5);
      const name = this.add.text(0, -2, unlocked ? lvl.name : '', {
        fontFamily: 'Arial', fontSize: '12px', color: '#b7e4c7', align: 'center',
        wordWrap: { width: 150 }
      }).setOrigin(0.5);
      const starText = this.add.text(0, 34, unlocked ? `${stars}${entry.bestScore ? '  ' + entry.bestScore : ''}` : 'locked', {
        fontFamily: 'Arial', fontSize: '14px', color: '#ffd60a'
      }).setOrigin(0.5);
      box.add([bg, num, name, starText]);

      if (unlocked) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setFillStyle(0x40916c));
        bg.on('pointerout', () => bg.setFillStyle(0x2d6a4f));
        bg.on('pointerdown', () => {
          this.registry.get('audio').emit('ui-click');
          this.scene.start('GameScene', { levelId: id });
        });
      }
    }

    const back = this.add.text(80, 60, '← MENU', {
      fontFamily: 'Arial', fontSize: '22px', color: '#ffffff'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => {
      this.registry.get('audio')?.emit('ui-click'); // Fix #22
      this.scene.start('MenuScene');
    });

    if (save.allCompleted) {
      this.add.text(WORLD.WIDTH / 2, WORLD.HEIGHT - 50, '🏆 ALL LEVELS COMPLETE — GAME FINISHED!', {
        fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#ffd60a'
      }).setOrigin(0.5);
    }
  }
}
