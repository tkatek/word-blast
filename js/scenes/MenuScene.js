/**
 * Minimal debug menu (final UI comes in a later phase).
 */
import Phaser from 'phaser';
import { STATES, WORLD } from '../config.js';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    const save = this.registry.get('save');
    this.add.rectangle(WORLD.WIDTH / 2, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x134611);

    this.add.text(WORLD.WIDTH / 2, 150, 'WORD BLAST', {
      fontFamily: 'Arial', fontSize: '72px', fontStyle: 'bold', color: '#ffd60a'
    }).setOrigin(0.5);

    this.add.text(WORLD.WIDTH / 2, 215, 'physics-based English learning — debug build', {
      fontFamily: 'Arial', fontSize: '18px', color: '#dee2e6'
    }).setOrigin(0.5);

    const completed = Object.values(save.data.levels).filter((l) => l.completed).length;
    this.add.text(WORLD.WIDTH / 2, 270,
      `Progress: ${completed}/15 levels   Stars: ${save.totalStars}/45${save.allCompleted ? '   GAME COMPLETE!' : ''}`, {
        fontFamily: 'Arial', fontSize: '20px', color: '#ffffff'
      }).setOrigin(0.5);

    this.addButton('PLAY', WORLD.HEIGHT / 2 + 10, () => {
      this.registry.get('audio').emit('ui-click');
      this.scene.start('LevelSelectScene');
    });
    this.addButton('RESET SAVE', WORLD.HEIGHT / 2 + 100, () => {
      save.reset();
      this.scene.restart();
    });

    this.add.text(WORLD.WIDTH / 2, WORLD.HEIGHT - 40,
      'v0.1 gameplay foundation — final visuals pending', {
        fontFamily: 'Arial', fontSize: '14px', color: '#8b9a7b'
      }).setOrigin(0.5);
  }

  addButton(label, y, onClick) {
    const btn = this.add.text(WORLD.WIDTH / 2, y, label, {
      fontFamily: 'Arial', fontSize: '32px', fontStyle: 'bold', color: '#ffffff',
      backgroundColor: '#1d3557', padding: { x: 30, y: 12 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setStyle({ color: '#ffd60a' }));
    btn.on('pointerout', () => btn.setStyle({ color: '#ffffff' }));
    btn.on('pointerdown', onClick);
    return btn;
  }
}
