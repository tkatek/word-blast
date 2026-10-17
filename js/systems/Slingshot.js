/**
 * Slingshot — the aiming/launch CONTROLLER. This class owns the shot
 * mechanics only: pointer → pouch mapping, drag clamping, launch-velocity
 * math, dud cancellation and the snap-back timing. Every pixel (the
 * supplied wooden artwork, the two elastic rubber bands, the leather
 * pouch, the trajectory dots) is drawn by SlingshotRenderer — visuals and
 * authoritative physics stay separated, and there is exactly ONE launch
 * system in the game.
 *
 * The loaded projectile is a non-physics preview image until release; the
 * real Matter body is created by the GameScene at launch — at the exact
 * pouch position handed to onLaunch, so the visual projectile, the physics
 * body, the trajectory dots and the launch origin are always the same
 * point. This structurally prevents double launches, stuck bodies and
 * shooting while paused.
 */
import { SLINGSHOT, WORLD, PROJECTILE_TYPES, slingshotAnchor } from '../config.js';
import { predictPath } from './Trajectory.js';
import { SlingshotRenderer, RENDER_DEPTH } from './SlingshotRenderer.js';

const SNAP_MS = 160;            // release → pouch/bands back at rest (spec: 120–200ms)
const CANCEL_SNAP_MS = 140;     // gentler return for a cancelled / dud drag
const MAX_OVERSHOOT = 16;       // px the pouch may swing past rest (elastic rebound)
const GRAB_RADIUS = 72;         // pointer activation radius around the pouch
const POUCH_MARGIN = { x: 16, y: 64 }; // pouch never leaves the visible world

export class Slingshot {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} callbacks { onLaunch(vx, vy, typeKey, origin) }
   */
  constructor(scene, callbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.deviceType = 'desktop';   // informational (one ground, one anchor)
    this.dragging = false;
    this.enabled = false;
    this.loadedType = 'basic';
    this.preview = null;
    this.snap = null;              // { from:{x,y}, t0, ms } — snap-back animation

    this.renderer = new SlingshotRenderer(scene);
    // single canonical anchor — the artwork's handle plants into the flat
    // gameplay ground (SlingshotRenderer.layout derives the exact fit)
    this.setAnchor(slingshotAnchor());

    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.input.on('pointerupoutside', this.onPointerUp, this); // touch cancellation
    scene.events.on('update', this.onUpdate, this);
    scene.events.once('shutdown', this.destroy, this);
  }

  destroy() {
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
    this.scene.input.off('pointerupoutside', this.onPointerUp, this);
    this.scene.events.off('update', this.onUpdate, this);
  }

  /* ------------------------------------------------------------------ */
  /* Geometry                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Legacy device hook: the ground, background and anchor are identical on
   * every device now, so this only records the type and re-affirms the
   * canonical anchor. Only called between drags — a projectile in flight
   * owns its physics body (spawned at launch), so nothing live ever moves.
   */
  applyDeviceAnchor(deviceType) {
    this.deviceType = deviceType || 'desktop';
    this.setAnchor(slingshotAnchor());
  }

  /** Configure the launcher around a pouch rest position (world px). */
  setAnchor(anchor) {
    this.anchor = { x: anchor.x, y: anchor.y };
    this.renderer.layout(this.anchor);
    if (this.preview && !this.dragging) this.preview.setPosition(this.anchor.x, this.anchor.y);
    this.snap = null; // re-anchoring ends any lingering animation
    this.redraw();
  }

  /* ------------------------------------------------------------------ */
  /* Interaction                                                         */
  /* ------------------------------------------------------------------ */

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.cancelDrag();
    this.redraw();
  }

  /** Load (or swap) the preview bird sitting in the pouch. */
  load(typeKey) {
    this.loadedType = typeKey;
    if (this.preview) this.preview.destroy();
    this.snap = null; // a fresh load ends any lingering snap animation
    this.preview = this.scene.add.image(this.anchor.x, this.anchor.y, `proj-${typeKey}`)
      .setDepth(RENDER_DEPTH.PROJECTILE);
    const d = PROJECTILE_TYPES[typeKey].radius * 2;
    this.preview.setDisplaySize(d, d);
    this.redraw();
  }

  isDragging() {
    return this.dragging;
  }

  onPointerDown(pointer) {
    if (!this.enabled) return;
    const p = this.pouchPoint();
    if (Math.hypot(pointer.worldX - p.x, pointer.worldY - p.y) <= GRAB_RADIUS) {
      this.dragging = true;
    }
  }

  onPointerMove(pointer) {
    if (!this.dragging) return;
    let x = pointer.worldX;
    let y = pointer.worldY;
    // the pouch stays inside the visible world and above the grass line
    // (pointer coords clamp at the canvas edge; full power is still
    // available on any back/diagonal pull)
    x = Math.max(POUCH_MARGIN.x, Math.min(WORLD.WIDTH - POUCH_MARGIN.x, x));
    y = Math.max(POUCH_MARGIN.y, Math.min(WORLD.HEIGHT - 24, y));
    y = Math.min(y, WORLD.GROUND_Y - 14);
    const dx = x - this.anchor.x;
    const dy = y - this.anchor.y;
    const l = Math.hypot(dx, dy);
    const clamped = Math.min(l, SLINGSHOT.MAX_DRAG);
    const nx = l === 0 ? 0 : dx / l;
    const ny = l === 0 ? 0 : dy / l;
    if (this.preview) this.preview.setPosition(this.anchor.x + nx * clamped, this.anchor.y + ny * clamped);
    this.redraw();
  }

  onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    const p = this.pouchPoint();
    const dx = this.anchor.x - p.x;
    const dy = this.anchor.y - p.y;
    const dragLen = Math.hypot(dx, dy);
    const power = dragLen / SLINGSHOT.MAX_DRAG;
    if (power < SLINGSHOT.MIN_POWER_RATIO) {
      this.cancelDrag(); // dud — spring back gently instead of launching
      return;
    }
    const speed = Math.min(power, 1) * SLINGSHOT.MAX_SPEED;
    const vx = (dx / dragLen) * speed;
    const vy = (dy / dragLen) * speed;
    this.startSnap(p, SNAP_MS);
    this.firePreview();
    this.setEnabled(false);
    this.callbacks.onLaunch(vx, vy, this.loadedType, { x: p.x, y: p.y });
  }

  /** Release without a shot: pouch + bird spring back to rest, nothing consumed. */
  cancelDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.startSnap(this.pouchPoint(), CANCEL_SNAP_MS);
    this.redraw();
  }

  firePreview() {
    if (this.preview) {
      this.preview.destroy();
      this.preview = null;
    }
    this.redraw();
  }

  /* ------------------------------------------------------------------ */
  /* Snap-back animation (visual only — never applies physics forces)    */
  /* ------------------------------------------------------------------ */

  /** Visual pouch position: dragged preview → snap animation → rest. */
  pouchPoint() {
    if (this.snap) {
      const from = this.snap.from;
      const f = this.snapFactor();
      return {
        x: this.anchor.x + (from.x - this.anchor.x) * f,
        y: this.anchor.y + (from.y - this.anchor.y) * f
      };
    }
    if (this.preview) return { x: this.preview.x, y: this.preview.y };
    return { x: this.anchor.x, y: this.anchor.y };
  }

  snapT() {
    if (!this.snap) return 1;
    return Math.max(0, Math.min(1, (this.scene.time.now - this.snap.t0) / this.snap.ms));
  }

  /**
   * Damped elastic interpolation: 1 → 0 (through rest) → small overshoot
   * past rest → settle at 0. The overshoot is capped in world px so even a
   * full-power release only swings the empty pouch a little past the fork.
   */
  snapFactor() {
    const t = this.snapT();
    let f = (1 - t) * Math.cos(t * 4.2);
    if (f < 0) {
      const d = Math.hypot(this.snap.from.x - this.anchor.x, this.snap.from.y - this.anchor.y) || 1;
      f = Math.max(f, -MAX_OVERSHOOT / d);
    }
    return f;
  }

  startSnap(from, ms = SNAP_MS) {
    this.snap = { from: { x: from.x, y: from.y }, t0: this.scene.time.now, ms };
  }

  onUpdate() {
    if (!this.snap) return;
    if (this.snapT() >= 1) this.snap = null;
    // a cancelled drag keeps its bird: the preview rides the spring back
    if (this.preview) {
      const p = this.pouchPoint();
      this.preview.setPosition(p.x, p.y);
    }
    this.redraw();
  }

  /* ------------------------------------------------------------------ */
  /* Redraw (mechanics state → renderer)                                 */
  /* ------------------------------------------------------------------ */

  redraw() {
    this.renderer.render({
      pouch: this.pouchPoint(),
      bird: this.preview,
      dots: this.dragging ? this.trajectoryDots() : null
    });
  }

  /**
   * Dotted aiming trajectory — same integrator as the real physics
   * (Trajectory.predictPath), starting at the CURRENT pouch position with
   * the CURRENT launch velocity; dots stop at the painted grass line.
   */
  trajectoryDots() {
    const p = this.pouchPoint();
    const dx = this.anchor.x - p.x;
    const dy = this.anchor.y - p.y;
    const dragLen = Math.hypot(dx, dy);
    if (dragLen === 0) return null;
    const power = dragLen / SLINGSHOT.MAX_DRAG;
    const speed = Math.min(power, 1) * SLINGSHOT.MAX_SPEED;
    const vx = (dx / dragLen) * speed;
    const vy = (dy / dragLen) * speed;
    const type = PROJECTILE_TYPES[this.loadedType];
    const pts = predictPath(p.x, p.y, vx, vy, { frictionAir: type.frictionAir });
    const dots = [];
    for (let i = 2; i < pts.length; i += 3) {
      const pt = pts[i];
      if (pt.y > WORLD.GROUND_Y - 6) break; // dots stop at the painted grass
      dots.push(pt);
    }
    return dots;
  }
}
