/**
 * ANSWER PEEK — accessible enlarged reading view for sentence answers.
 *
 * Long answers render on the wide XL parchment panel, which stays readable at
 * desktop/tablet scale but gets small on phones (world 1280×720 shrunk to a
 * ~0.54 zoom). Instead of shrinking the ink further, players can HOLD a
 * pointer on any answer panel (or press Z) while AIMING to read all three
 * choices at comfortable size; release (or tap / press Z again) closes.
 *
 * Purely presentational: it never pauses gameplay, never validates answers
 * and never moves physics — the targets stay exactly where they are.
 */
import { WORLD } from '../config.js';

const HOLD_MS = 320;

export class AnswerPeek {
  /**
   * @param {Phaser.Scene} scene   GameScene
   * @param {{text:string,label:string}[]} choices prepared targets (label A/B/C)
   */
  constructor(scene, choices) {
    this.scene = scene;
    this.choices = choices;
    this.open = false;
    this.holdTimer = null;
    this.heldPointerId = null;

    this.root = scene.add.container(0, 0).setDepth(95).setVisible(false);

    const scrim = scene.add.rectangle(
      WORLD.WIDTH / 2, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x08131f, 0.55
    );

    const cardW = Math.min(940, WORLD.WIDTH - 80);
    const rowH = 74;
    const cardH = 64 + rowH * choices.length + 26;
    const card = scene.add.rectangle(
      WORLD.WIDTH / 2, WORLD.HEIGHT / 2, cardW, cardH, 0xf3e3c0, 0.98
    ).setStrokeStyle(6, 0x8a5a2b);

    const title = scene.add.text(WORLD.WIDTH / 2, WORLD.HEIGHT / 2 - cardH / 2 + 34,
      'Read the answers', {
        fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#8a5a2b'
      }).setOrigin(0.5);

    this.root.add([scrim, card, title]);

    const topY = WORLD.HEIGHT / 2 - cardH / 2 + 64 + rowH / 2 - 6;
    choices.forEach((c, i) => {
      const y = topY + i * rowH;
      const badge = scene.add.circle(WORLD.WIDTH / 2 - cardW / 2 + 56, y, 18, 0x8a5a2b)
        .setStrokeStyle(3, 0x5d3a17);
      const badgeText = scene.add.text(badge.x, y + 1, c.label, {
        fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#ffefd8'
      }).setOrigin(0.5);
      const answerText = scene.add.text(badge.x + 40, y, c.text, {
        fontFamily: 'Arial', fontSize: '25px', fontStyle: 'bold', color: '#3d2814',
        wordWrap: { width: cardW - 140, useAdvancedWrap: true }
      }).setOrigin(0, 0.5);
      this.root.add([badge, badgeText, answerText]);
    });

    this.bind();
    scene.events.once('shutdown', () => this.destroy());
  }

  bind() {
    const s = this.scene;
    this.onDown = (pointer) => {
      if (!s.stateMachine || !s.stateMachine.is('AIMING')) return;
      const hit = (s.factory ? s.factory.targets : []).some((t) => Math.abs(pointer.worldX - t.x) <= t.displayWidth / 2
        && Math.abs(pointer.worldY - t.y) <= t.displayHeight / 2);
      if (!hit) return;
      this.heldPointerId = pointer.id;
      this.holdTimer = s.time.delayedCall(HOLD_MS, () => this.show());
    };
    this.onUp = () => {
      this.heldPointerId = null;
      if (this.holdTimer) { this.holdTimer.remove(false); this.holdTimer = null; }
      if (this.open) this.hide();
    };
    this.onKey = (e) => {
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (this.open) this.hide(); else this.show();
    };
    s.input.on('pointerdown', this.onDown);
    s.input.on('pointerup', this.onUp);
    s.input.on('pointerupoutside', this.onUp);
    if (s.input.keyboard) s.input.keyboard.on('keydown', this.onKey);
  }

  show() {
    this.open = true;
    this.root.setVisible(true);
    this.root.setAlpha(0);
    this.scene.tweens.add({ targets: this.root, alpha: 1, duration: 90 });
  }

  hide() {
    this.open = false;
    this.root.setVisible(false);
  }

  destroy() {
    const s = this.scene;
    if (this.holdTimer) { this.holdTimer.remove(false); this.holdTimer = null; }
    if (s.input) {
      s.input.off('pointerdown', this.onDown);
      s.input.off('pointerup', this.onUp);
      s.input.off('pointerupoutside', this.onUp);
      if (s.input.keyboard) s.input.keyboard.off('keydown', this.onKey);
    }
    this.root.destroy();
  }
}
