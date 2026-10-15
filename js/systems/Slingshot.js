/**
 * Slingshot: drag aiming + launch + trajectory prediction.
 * The loaded projectile is a non-physics preview image until release; the
 * real Matter body is created by the GameScene at launch. This structurally
 * prevents double launches, stuck bodies and shooting while paused.
 */
import { SLINGSHOT, WORLD, COLORS, PROJECTILE_TYPES } from '../config.js';
import { predictPath } from './Trajectory.js';

export class Slingshot {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} callbacks { onLaunch(vx, vy, typeKey) }
   */
  constructor(scene, callbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.anchor = { x: WORLD.SLING_X, y: WORLD.SLING_Y };
    this.dragging = false;
    this.enabled = false;
    this.loadedType = 'basic';
    this.preview = null;

    // fork geometry (visual)
    this.forkBack = { x: this.anchor.x - 26, y: this.anchor.y - 18 };
    this.forkFront = { x: this.anchor.x + 26, y: this.anchor.y - 12 };

    this.graphics = scene.add.graphics().setDepth(10);
    this.bandBack = scene.add.graphics().setDepth(3);  // behind projectile
    this.drawFrame();

    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.input.on('pointerupoutside', this.onPointerUp, this); // touch cancellation
    scene.events.once('shutdown', this.destroy, this);
  }

  destroy() {
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
    this.scene.input.off('pointerupoutside', this.onPointerUp, this);
  }

  /** Static slingshot frame. */
  drawFrame() {
    const g = this.graphics;
    g.clear();
    g.fillStyle(0x6b4226, 1);
    g.fillRect(this.anchor.x - 34, this.anchor.y - 6, 12, WORLD.GROUND_Y - this.anchor.y + 6);
    g.fillRect(this.anchor.x + 22, this.anchor.y - 12, 12, WORLD.GROUND_Y - this.anchor.y + 12);
    g.lineStyle(6, 0x493323, 1);
    g.beginPath();
    g.moveTo(this.anchor.x - 28, this.anchor.y);
    g.lineTo(this.forkBack.x, this.forkBack.y);
    g.moveTo(this.anchor.x + 28, this.anchor.y);
    g.lineTo(this.forkFront.x, this.forkFront.y);
    g.strokePath();
  }

  /* ------------------------------------------------------------------ */

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.cancelDrag();
    this.redraw();
  }

  load(typeKey) {
    this.loadedType = typeKey;
    if (this.preview) this.preview.destroy();
    this.preview = this.scene.add.image(this.anchor.x, this.anchor.y, `proj-${typeKey}`).setDepth(9);
    const d = PROJECTILE_TYPES[typeKey].radius * 2;
    this.preview.setDisplaySize(d, d);
    this.redraw();
  }

  isDragging() {
    return this.dragging;
  }

  onPointerDown(pointer) {
    if (!this.enabled) return;
    const px = this.preview ? this.preview.x : this.anchor.x;
    const py = this.preview ? this.preview.y : this.anchor.y;
    if (Math.hypot(pointer.worldX - px, pointer.worldY - py) <= 70) {
      this.dragging = true;
    }
  }

  onPointerMove(pointer) {
    if (!this.dragging) return;
    const dx = pointer.worldX - this.anchor.x;
    const dy = pointer.worldY - this.anchor.y;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, SLINGSHOT.MAX_DRAG);
    const nx = len === 0 ? 0 : dx / len;
    const ny = len === 0 ? 0 : dy / len;
    if (this.preview) this.preview.setPosition(this.anchor.x + nx * clamped, this.anchor.y + ny * clamped);
    this.redraw();
  }

  onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    const px = this.preview ? this.preview.x : this.anchor.x;
    const py = this.preview ? this.preview.y : this.anchor.y;
    const dx = this.anchor.x - px;
    const dy = this.anchor.y - py;
    const dragLen = Math.hypot(dx, dy);
    const power = dragLen / SLINGSHOT.MAX_DRAG;
    if (power < SLINGSHOT.MIN_POWER_RATIO) {
      this.cancelDrag(); // dud — reload instead of launching
      return;
    }
    const speed = Math.min(power, 1) * SLINGSHOT.MAX_SPEED;
    const vx = (dx / dragLen) * speed;
    const vy = (dy / dragLen) * speed;
    this.firePreview();
    this.setEnabled(false);
    this.callbacks.onLaunch(vx, vy, this.loadedType);
  }

  cancelDrag() {
    this.dragging = false;
    if (this.preview) this.preview.setPosition(this.anchor.x, this.anchor.y);
    this.redraw();
  }

  firePreview() {
    if (this.preview) {
      this.preview.destroy();
      this.preview = null;
    }
    this.redraw();
  }

  /** Bands + dotted trajectory while dragging. */
  redraw() {
    this.bandBack.clear();
    if (!this.preview) return;
    const px = this.preview.x;
    const py = this.preview.y;

    this.bandBack.lineStyle(7, 0x2b2b2b, 1);
    this.bandBack.beginPath();
    this.bandBack.moveTo(this.forkBack.x, this.forkBack.y);
    this.bandBack.lineTo(px, py);
    this.bandBack.lineTo(this.forkFront.x, this.forkFront.y);
    this.bandBack.strokePath();

    if (!this.dragging) return;

    // trajectory dots — same integrator as the real physics
    const dx = this.anchor.x - px;
    const dy = this.anchor.y - py;
    const dragLen = Math.hypot(dx, dy);
    if (dragLen === 0) return;
    const power = dragLen / SLINGSHOT.MAX_DRAG;
    const speed = Math.min(power, 1) * SLINGSHOT.MAX_SPEED;
    const vx = (dx / dragLen) * speed;
    const vy = (dy / dragLen) * speed;
    const type = PROJECTILE_TYPES[this.loadedType];
    const pts = predictPath(px, py, vx, vy, { frictionAir: type.frictionAir });

    this.bandBack.fillStyle(COLORS.TRAJECTORY, 0.85);
    for (let i = 2; i < pts.length; i += 3) {
      const p = pts[i];
      if (p.y > WORLD.GROUND_Y) break;
      const r = Math.max(2, 4.5 - i * 0.05);
      this.bandBack.fillCircle(p.x, p.y, r);
    }
  }
}
