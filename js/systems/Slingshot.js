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
import { projectileVisual } from '../data/birds.js';

const SNAP_MS = 160;            // release → pouch/bands back at rest (spec: 120–200ms)
const CANCEL_SNAP_MS = 140;     // gentler return for a cancelled / dud drag
const MAX_OVERSHOOT = 16;       // px the pouch may swing past rest (elastic rebound)
const GRAB_RADIUS = 72;         // pointer activation radius around the pouch
const POUCH_MARGIN = { x: 16, y: 64 }; // pouch never leaves the visible world
const TILT_GAIN = 0.45;         // fraction of the launch angle applied as bird tilt
const TILT_MAX = 0.42;          // rad — restrained, face stays readable

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
    this.previewIsBird = false;    // preview uses bird artwork (tilt-able)
    this.previewDisplay = 0;       // loaded bird display size (pouch fitting)
    this.grabOffset = null;        // pointer→pouch offset while dragging
    this.snap = null;              // { from:{x,y}, t0, ms } — snap-back animation
    this.lastShotDots = null;      // Fix #7 — last completed shot's dots (reference)

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
    // Fix #7 — scene shutdown destroys the graphics; drop the stored
    // reference so a stale array can never leak into another level.
    this.lastShotDots = null;
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
    if (this.preview) {
      this.scene.tweens.killTweensOf(this.preview);
      this.preview.destroy();
    }
    this.snap = null; // a fresh load ends any lingering snap animation
    const visual = projectileVisual(typeKey, this.scene.textures, PROJECTILE_TYPES[typeKey].radius, false);
    this.preview = this.scene.add.image(this.anchor.x, this.anchor.y, visual.texture)
      .setDepth(RENDER_DEPTH.PROJECTILE);
    this.preview.setDisplaySize(visual.display, visual.display);
    this.previewIsBird = !!visual.bird;
    this.previewDisplay = visual.display;
    if (this.previewIsBird) {
      // plain image — cosmetic tweens are safe (it carries no physics)
      const s = this.preview.scaleX;
      this.preview.setScale(s * 0.72);
      this.scene.tweens.add({
        targets: this.preview, scaleX: s, scaleY: s, duration: 150, ease: 'Back.out'
      });
      this.scene.tweens.add({
        targets: this.preview, scaleX: s * 1.02, scaleY: s * 1.02,
        duration: 850, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: 160
      });
    }
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
      // Fix #22 — audio hook: the stretch sound starts only when the bird
      // is ACTUALLY grabbed (never on every pointer move).
      this.scene.audio?.emit('sling-stretch-start', { tension: 0 });
      // Fix #6B: remember WHERE around the bird the player grabbed. The
      // pouch then follows pointer + offset, so the bird never teleports
      // to the pointer on the first move (fingers always press off-center
      // on touch — that jump read as the slingshot "disconnecting").
      const dx = p.x - pointer.worldX;
      const dy = p.y - pointer.worldY;
      const len = Math.hypot(dx, dy) || 1;
      const cap = Math.min(len, GRAB_RADIUS * 0.75);
      this.grabOffset = { x: (dx / len) * cap, y: (dy / len) * cap };
    }
  }

  onPointerMove(pointer) {
    if (!this.dragging) return;
    let x = pointer.worldX + (this.grabOffset ? this.grabOffset.x : 0);
    let y = pointer.worldY + (this.grabOffset ? this.grabOffset.y : 0);
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
    // Fix #22 — audio hook: tension feed (0..1) drives the stretch loop's
    // volume/pitch inside AudioManager — no sound spawns per move.
    this.scene.audio?.emit('sling-stretch', { tension: clamped / SLINGSHOT.MAX_DRAG });
    const nx = l === 0 ? 0 : dx / l;
    const ny = l === 0 ? 0 : dy / l;
    if (this.preview) {
      this.preview.setPosition(this.anchor.x + nx * clamped, this.anchor.y + ny * clamped);
      // bird tilts gently toward where it will fly (cosmetic, clamped)
      if (this.previewIsBird) {
        const launchAngle = Math.atan2(this.anchor.y - this.preview.y, this.anchor.x - this.preview.x);
        const tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX * 0.5, launchAngle * TILT_GAIN));
        this.preview.setRotation(tilt);
      }
    }
    this.redraw();
  }

  onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    this.grabOffset = null;
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
    const launched = this.callbacks.onLaunch(vx, vy, this.loadedType, { x: p.x, y: p.y });
    if (launched) {
      // Fix #7 — freeze the release-time prediction as the faded reference
      // for the next aim. Captured HERE (pouch position + exact launch
      // velocity just handed to the physics) so the kept dots are the arc
      // the player actually shot, never a recomputation.
      this.captureShotReference(this.computeDots(p, vx, vy, this.loadedType));
    } else {
      // launch refused (no shots / no ammo) — treat exactly like a dud:
      // stop the stretch sound, small return sound, NO launch audio.
      this.scene.audio?.emit('sling-cancel');
    }
  }

  /** Release without a shot: pouch + bird spring back to rest, nothing consumed. */
  cancelDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.grabOffset = null;
    // Fix #22 — audio hook: cancelled drag = smooth stretch stop + small
    // elastic return sound. NEVER a launch sound (that is 'launch').
    this.scene.audio?.emit('sling-cancel');
    this.startSnap(this.pouchPoint(), CANCEL_SNAP_MS);
    this.redraw();
  }

  firePreview() {
    if (this.preview) {
      this.scene.tweens.killTweensOf(this.preview);
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
    if (this.snap) {
      // the last animation frame ends exactly AT rest — pin the preview
      // there so no sub-pixel residue from the overshoot survives (Fix #6B)
      if (this.snapT() >= 1) {
        this.snap = null;
        if (this.preview) this.preview.setPosition(this.anchor.x, this.anchor.y);
      }
      // a cancelled drag keeps its bird: the preview rides the spring back
      if (this.preview) {
        const p = this.pouchPoint();
        this.preview.setPosition(p.x, p.y);
      }
      this.redraw();
    }
    // preview bird eases back to its resting orientation after a drag
    if (this.preview && !this.dragging && this.preview.rotation !== 0) {
      const r = this.preview.rotation * 0.82;
      this.preview.setRotation(Math.abs(r) < 0.008 ? 0 : r);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Redraw (mechanics state → renderer)                                 */
  /* ------------------------------------------------------------------ */

  redraw() {
    this.renderer.render({
      pouch: this.pouchPoint(),
      bird: this.preview,
      // pouch/band geometry follows the loaded bird's size so the cup
      // cradles the artwork instead of the old 32px ball (Fix #6B)
      birdR: this.preview ? this.previewDisplay / 2 : 0,
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
    return this.computeDots(p, vx, vy, this.loadedType);
  }

  /**
   * Shared dot sampler behind both the live aiming arc and the kept
   * reference (Fix #7): identical prediction for identical inputs, so the
   * faded dots always match what the shot was aimed along.
   */
  computeDots(p, vx, vy, typeKey) {
    const type = PROJECTILE_TYPES[typeKey];
    const pts = predictPath(p.x, p.y, vx, vy, { frictionAir: type.frictionAir });
    const dots = [];
    for (let i = 2; i < pts.length; i += 3) {
      const pt = pts[i];
      if (pt.y > WORLD.GROUND_Y - 6) break; // dots stop at the painted grass
      dots.push({ x: pt.x, y: pt.y });
    }
    return dots;
  }

  /**
   * Fix #7 — store and draw the most recent completed shot's trajectory as
   * the faded reference. Replaces (never accumulates) the previous one:
   * exactly one reference line exists at any time, in world coordinates,
   * never recomputed or moved afterwards.
   */
  captureShotReference(dots) {
    this.lastShotDots = dots;
    this.renderer.renderLastDots(dots);
  }

  /** Fix #7 — drop the reference line entirely (level change / restart / exit). */
  clearShotReference() {
    this.lastShotDots = null;
    this.renderer.renderLastDots(null);
  }
}
