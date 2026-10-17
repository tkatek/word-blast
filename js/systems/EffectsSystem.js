/**
 * Effects system — material-specific destruction feedback, kept visually
 * subordinate to gameplay:
 *   - physical fragments are spawned by the factory (real bodies);
 *     this system adds the NON-physical layer: dust, splinters, shards,
 *     smoke, flashes
 *   - particle emitters are created on demand, capped (BUDGETS.MAX_EMITTERS)
 *     and destroyed when spent
 *   - camera shake only for strong impacts, magnitude capped, fully
 *     disabled by the reduced-motion setting
 *
 * Textures ('p-dust', 'p-splinter', 'p-shard', 'p-puff', 'p-spark') are
 * generated procedurally in BootScene — no binary assets required.
 */
import { BUDGETS } from '../config.js';

const PARTICLE_COLORS = {
  wood: [0xb08968, 0x8a6547, 0xd9b48f],
  glass: [0xa8dadc, 0xd7f4f6, 0xffffff],
  stone: [0x8d99ae, 0x6c7a92, 0xb8c2d4],
  boom: [0xe76f51, 0xffb703, 0x4a4a4a],
  pig: [0xf4a9b8, 0xffffff]
};

export class EffectsSystem {
  constructor(scene) {
    this.scene = scene;
    this.liveEmitters = 0;
  }

  get reducedMotion() {
    const save = this.scene.registry.get('save');
    return !!(save && save.data && save.data.settings && save.data.settings.reducedMotion);
  }

  /** Bounded emitter creation; returns null when over budget. */
  makeEmitter(texture, config) {
    if (this.liveEmitters >= BUDGETS.MAX_EMITTERS) return null;
    const emitter = this.scene.add.particles(0, 0, texture, config);
    this.liveEmitters++;
    emitter.once('complete', () => {
      this.liveEmitters--;
      emitter.destroy();
    });
    // hard stop even without explode() completion callbacks
    this.scene.time.delayedCall(2500, () => {
      if (emitter.active) {
        emitter.stop();
        this.liveEmitters--;
        emitter.destroy();
      }
    });
    return emitter;
  }

  /** Material-specific break burst. severity 0..1 scales counts/areas. */
  materialBreak(mat, x, y, severity = 0.5) {
    const s = Math.max(0.25, Math.min(1, severity));
    const colors = PARTICLE_COLORS[mat] || PARTICLE_COLORS.wood;
    if (mat === 'glass') this.glassBurst(x, y, s);
    else this.debrisBurst(x, y, s, colors);
    if (!this.reducedMotion && s > 0.45) {
      this.dust(x, y, Math.round(4 + 6 * s), mat === 'stone' ? 1.3 : 1);
    } else if (mat === 'stone') {
      this.dust(x, y, 4, 1.1);
    }
  }

  debrisBurst(x, y, s, colors) {
    const count = Math.round(5 + 9 * s);
    const emitter = this.makeEmitter('p-splinter', {
      speed: { min: 60, max: 60 + 160 * s },
      angle: { min: 200, max: 340 },
      gravityY: 700,
      lifespan: { min: 350, max: 650 },
      scale: { start: 0.9, end: 0.3 },
      alpha: { start: 1, end: 0.2 },
      rotate: { min: 0, max: 360 },
      tint: colors,
      emitting: false
    });
    emitter?.explode(count, x, y);
  }

  glassBurst(x, y, s) {
    const emitter = this.makeEmitter('p-shard', {
      speed: { min: 90, max: 90 + 200 * s },
      angle: { min: 180, max: 360 },
      gravityY: 550,
      lifespan: { min: 300, max: 600 },
      scale: { start: 1, end: 0.2 },
      alpha: { start: 0.95, end: 0.1 },
      tint: PARTICLE_COLORS.glass,
      emitting: false
    });
    emitter?.explode(Math.round(8 + 10 * s), x, y);
  }

  dust(x, y, count, sizeScale = 1) {
    const emitter = this.makeEmitter('p-dust', {
      speed: { min: 15, max: 60 },
      angle: { min: 220, max: 320 },
      gravityY: -40,
      lifespan: { min: 400, max: 900 },
      scale: { start: 0.7 * sizeScale, end: 1.6 * sizeScale },
      alpha: { start: 0.45, end: 0 },
      tint: [0xcbb89a, 0xb0a58c],
      emitting: false
    });
    emitter?.explode(count, x, y);
  }

  /** TNT / bomb blast: flash, directional debris, smoke, shake. */
  explosion(x, y) {
    // flash
    const flash = this.scene.add.circle(x, y, 16, 0xffe066, 0.95).setDepth(18);
    this.scene.tweens.add({
      targets: flash, radius: 120, alpha: 0, duration: 260, ease: 'Cubic.out',
      onComplete: () => flash.destroy()
    });
    const ring = this.scene.add.circle(x, y, 10).setStrokeStyle(5, 0xffb703, 0.9).setDepth(18);
    this.scene.tweens.add({
      targets: ring, radius: 130, alpha: 0, duration: 330, ease: 'Cubic.out',
      onComplete: () => ring.destroy()
    });
    if (this.reducedMotion) return;
    const emitter = this.makeEmitter('p-spark', {
      speed: { min: 120, max: 340 },
      angle: { min: 180, max: 360 },
      gravityY: 500,
      lifespan: { min: 250, max: 550 },
      scale: { start: 1.1, end: 0.2 },
      tint: [0xffd60a, 0xffb703, 0xe76f51],
      emitting: false
    });
    emitter?.explode(18, x, y);
    const smoke = this.makeEmitter('p-dust', {
      speed: { min: 25, max: 80 },
      angle: { min: 230, max: 310 },
      gravityY: -90,
      lifespan: { min: 500, max: 1100 },
      scale: { start: 0.9, end: 2.1 },
      alpha: { start: 0.5, end: 0 },
      tint: [0x555555, 0x3a3a3a],
      emitting: false
    });
    smoke?.explode(10, x, y - 10);
    this.shakeForImpact(120, 220);
  }

  /** Pig defeat: soft puff + a couple of stars. No gore, no fragments. */
  pigPop(x, y) {
    const emitter = this.makeEmitter('p-puff', {
      speed: { min: 40, max: 120 },
      lifespan: { min: 300, max: 600 },
      scale: { start: 0.8, end: 1.6 },
      alpha: { start: 0.8, end: 0 },
      tint: [0xffffff, 0xf4a9b8],
      emitting: false
    });
    emitter?.explode(10, x, y);
  }

  /**
   * Blue bird split activation: a quick white flash ring + a puff of
   * feather-light blue sparks at the split point (bird-projectile VFX,
   * Fix #6 — purely visual, no physics involvement).
   */
  splitPop(x, y) {
    const ring = this.scene.add.circle(x, y, 8).setStrokeStyle(4, 0xbde0fe, 0.95).setDepth(18);
    this.scene.tweens.add({
      targets: ring, radius: 46, alpha: 0, duration: 300, ease: 'Cubic.out',
      onComplete: () => ring.destroy()
    });
    if (this.reducedMotion) return;
    const emitter = this.makeEmitter('p-puff', {
      speed: { min: 50, max: 130 },
      lifespan: { min: 260, max: 520 },
      scale: { start: 0.7, end: 1.3 },
      alpha: { start: 0.9, end: 0 },
      tint: [0x9d4edd, 0xbde0fe, 0xffffff],
      emitting: false
    });
    emitter?.explode(9, x, y);
  }

  /**
   * Purple bird freeze activation (first impact): icy expanding ring +
   * a small burst of ice shards and snow. The frozen-tint on blocks is
   * applied by the factory; this is the impact-point feedback.
   */
  freezeBurst(x, y) {
    const ring = this.scene.add.circle(x, y, 10).setStrokeStyle(4, 0x90e0ef, 0.95).setDepth(18);
    this.scene.tweens.add({
      targets: ring, radius: 54, alpha: 0, duration: 380, ease: 'Cubic.out',
      onComplete: () => ring.destroy()
    });
    if (this.reducedMotion) return;
    const shards = this.makeEmitter('p-shard', {
      speed: { min: 70, max: 170 },
      angle: { min: 180, max: 360 },
      gravityY: 420,
      lifespan: { min: 280, max: 560 },
      scale: { start: 0.9, end: 0.2 },
      alpha: { start: 0.95, end: 0.1 },
      tint: [0x90e0ef, 0xbde0fe, 0xffffff],
      emitting: false
    });
    shards?.explode(11, x, y);
    const snow = this.makeEmitter('p-puff', {
      speed: { min: 20, max: 60 },
      gravityY: -50,
      lifespan: { min: 400, max: 800 },
      scale: { start: 0.6, end: 1.4 },
      alpha: { start: 0.7, end: 0 },
      tint: [0xffffff, 0xcaf0f8],
      emitting: false
    });
    snow?.explode(7, x, y - 8);
  }

  /** Plaque respawn marker. */
  respawnPuff(x, y) {
    const ring = this.scene.add.circle(x, y - 40, 8).setStrokeStyle(4, 0x90e0ef, 0.9).setDepth(18);
    this.scene.tweens.add({
      targets: ring, radius: 54, alpha: 0, duration: 420, ease: 'Cubic.out',
      onComplete: () => ring.destroy()
    });
  }

  /** Camera shake for strong impacts only; capped; reduced-motion skips. */
  shakeForImpact(dmg, duration = 130) {
    if (this.reducedMotion) return;
    const mag = Math.min(BUDGETS.MAX_SHAKE, 0.0015 + dmg * 0.00003);
    this.scene.cameras.main.shake(duration, mag);
  }

  destroy() {
    this.liveEmitters = 0;
  }
}
