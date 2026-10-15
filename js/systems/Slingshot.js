/**
 * Slingshot — side-view launcher standing on the elevated grassy cliff at
 * the left edge of the background art, facing right toward the towers.
 *
 * Rendering is layered back-to-front for a believable side view:
 *   depth 2   rear wooden arm (shaded — the "far" prong)
 *   depth 3   rear rubber band
 *   depth 8   leather pouch
 *   depth 9   loaded projectile (preview image, no physics until release)
 *   depth 11  front rubber band
 *   depth 12  front wooden arm + trunk (sunlit — the "near" prong)
 *   depth 13  aiming trajectory dots (still far below HUD 50 / panels 80)
 * The projectile therefore reads as held BETWEEN the two arms, and the
 * slingshot can never render in front of the HUD or question panel.
 *
 * The loaded projectile is a non-physics preview image until release; the
 * real Matter body is created by the GameScene at launch — at the exact
 * pouch position handed to onLaunch, so visual and physics projectile are
 * always the same point. This structurally prevents double launches,
 * stuck bodies and shooting while paused.
 */
import { SLINGSHOT, WORLD, COLORS, PROJECTILE_TYPES, terrainFor, slingshotAnchor } from '../config.js';
import { predictPath } from './Trajectory.js';
import { DEVICE_TYPES } from './Device.js';

const DEPTH = {
  BACK_ARM: 2,
  BAND_BACK: 3,
  POUCH: 8,
  PROJECTILE: 9,
  BAND_FRONT: 11,
  FRONT_ARM: 12,
  TRAJECTORY: 13
};

/** Cartoon wood / leather / rubber palette (matches the colorful art). */
const WOOD = {
  outline: 0x53331a,
  back: 0x8a5527,      // far prong — shaded
  front: 0xa9713f,     // near prong + trunk — sunlit
  frontLight: 0xc08b52,
  band: 0x4a2c1c,      // rubber
  bandDark: 0x331e13,
  pouch: 0x3d2b1f,     // leather
  pouchEdge: 0x241811
};

const SNAP_MS = 150;                  // band snap-back animation duration
const GRAB_RADIUS = 70;               // pointer activation radius around pouch
const POUCH_MARGIN = { x: 16, y: 64 }; // pouch never leaves the visible world

export class Slingshot {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} callbacks { onLaunch(vx, vy, typeKey, origin) }
   */
  constructor(scene, callbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.deviceType = null;
    this.dragging = false;
    this.enabled = false;
    this.loadedType = 'basic';
    this.preview = null;
    this.snap = null; // { from:{x,y}, t0 } — band snap-back animation

    // layered renderers (creation order resolves the equal-depth ties)
    this.layerBackArm = scene.add.graphics().setDepth(DEPTH.BACK_ARM);
    this.layerBandBack = scene.add.graphics().setDepth(DEPTH.BAND_BACK);
    this.layerPouch = scene.add.graphics().setDepth(DEPTH.POUCH);
    this.layerBandFront = scene.add.graphics().setDepth(DEPTH.BAND_FRONT);
    this.layerFrontArm = scene.add.graphics().setDepth(DEPTH.FRONT_ARM);
    this.layerTrajectory = scene.add.graphics().setDepth(DEPTH.TRAJECTORY);

    this.applyDeviceAnchor(scene.registry.get('device')?.type);

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
   * Stand on the anchor measured for a device background
   * (SLINGSHOT.ANCHORS in config.js). The scene only calls this between
   * drags; a projectile already in flight keeps its own physics body,
   * spawned at launch, so nothing live ever teleports.
   */
  applyDeviceAnchor(deviceType) {
    this.deviceType = DEVICE_TYPES[deviceType] ? deviceType : DEVICE_TYPES.DESKTOP;
    this.terrain = terrainFor(this.deviceType);
    this.setAnchor(slingshotAnchor(this.deviceType));
  }

  /** Configure the launcher around a pouch rest position (world px). */
  setAnchor(anchor) {
    this.anchor = { x: anchor.x, y: anchor.y };
    const a = this.anchor;
    // wooden base touches the cliff grass; the fork opens toward the towers
    this.base = { x: a.x, y: a.y + SLINGSHOT.BASE_OFFSET_Y };
    this.fork = { x: a.x, y: a.y + 24 };          // where the prongs split
    this.forkBack = { x: a.x - 21, y: a.y - 27 }; // far prong tip
    this.forkFront = { x: a.x + 24, y: a.y - 29 };// near prong tip (forward)
    this.drawWood();
    this.redraw();
  }

  /* ------------------------------------------------------------------ */
  /* Static wood (redrawn only when the anchor changes)                  */
  /* ------------------------------------------------------------------ */

  /** Trace a quadratic Bézier (p0 → p1, control p2) as a polyline. */
  curvePath(g, p0, p1, p2) {
    g.moveTo(p0.x, p0.y);
    if (!p2) { g.lineTo(p1.x, p1.y); return; }
    const N = 8;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const u = 1 - t;
      g.lineTo(u * u * p0.x + 2 * u * t * p2.x + t * t * p1.x, u * u * p0.y + 2 * u * t * p2.y + t * t * p1.y);
    }
  }

  /** Rounded "bone" from p0 to p1 (optional quadratic control p2). */
  limb(g, p0, p1, p2, width, fill) {
    for (const [w, c] of [[width + 5, WOOD.outline], [width, fill]]) {
      g.lineStyle(w, c, 1);
      g.beginPath();
      this.curvePath(g, p0, p1, p2);
      g.strokePath();
    }
    for (const p of [p0, p1]) this.knob(g, p, width / 2, fill);
  }

  knob(g, p, r, fill) {
    g.fillStyle(fill, 1);
    g.fillCircle(p.x, p.y, r);
    g.lineStyle(3, WOOD.outline, 1);
    g.strokeCircle(p.x, p.y, r);
  }

  drawWood() {
    // --- back layer: contact shadow + the far prong, shaded darker
    const b = this.layerBackArm;
    b.clear();
    b.fillStyle(0x1e2a12, 0.22); // soft shadow plants the base into the grass
    b.fillEllipse(this.base.x, this.base.y + 7, 58, 12);
    this.limb(b, this.fork, this.forkBack, { x: this.fork.x - 15, y: this.fork.y - 5 }, 9, WOOD.back);

    // --- front layer: trunk + near prong + foot plate
    const f = this.layerFrontArm;
    f.clear();
    this.limb(f, this.fork, this.base, null, 15, WOOD.front);
    // foot plate: the base sits naturally on the grass, never floating
    const fp = this.base;
    f.fillStyle(WOOD.front, 1);
    f.fillRoundedRect(fp.x - 24, fp.y - 7, 48, 13, 6);
    f.lineStyle(3, WOOD.outline, 1);
    f.strokeRoundedRect(fp.x - 24, fp.y - 7, 48, 13, 6);
    // sunlit highlight along the trunk
    f.lineStyle(3, WOOD.frontLight, 0.8);
    f.beginPath();
    f.moveTo(this.fork.x - 4, this.fork.y + 4);
    f.lineTo(this.base.x - 4, this.base.y - 10);
    f.strokePath();
    this.limb(f, this.fork, this.forkFront, { x: this.fork.x + 16, y: this.fork.y - 4 }, 11, WOOD.front);
    // band-wrap knobs at both tips
    this.knob(f, this.forkFront, 8, WOOD.front);
  }

  /* ------------------------------------------------------------------ */
  /* Interaction                                                         */
  /* ------------------------------------------------------------------ */

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.cancelDrag();
    this.redraw();
  }

  load(typeKey) {
    this.loadedType = typeKey;
    if (this.preview) this.preview.destroy();
    this.snap = null; // a fresh load ends any lingering snap animation
    this.preview = this.scene.add.image(this.anchor.x, this.anchor.y, `proj-${typeKey}`)
      .setDepth(DEPTH.PROJECTILE);
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
    // the pouch stays inside the visible world (pointer coords clamp at the
    // canvas edge; full power is still available on any diagonal pull)
    x = Math.max(POUCH_MARGIN.x, Math.min(WORLD.WIDTH - POUCH_MARGIN.x, x));
    y = Math.max(POUCH_MARGIN.y, Math.min(WORLD.HEIGHT - 24, y));
    const dx = x - this.anchor.x;
    const dy = y - this.anchor.y;
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
    const p = this.pouchPoint();
    const dx = this.anchor.x - p.x;
    const dy = this.anchor.y - p.y;
    const dragLen = Math.hypot(dx, dy);
    const power = dragLen / SLINGSHOT.MAX_DRAG;
    if (power < SLINGSHOT.MIN_POWER_RATIO) {
      this.cancelDrag(); // dud — reload instead of launching
      return;
    }
    const speed = Math.min(power, 1) * SLINGSHOT.MAX_SPEED;
    const vx = (dx / dragLen) * speed;
    const vy = (dy / dragLen) * speed;
    this.startSnap(p);
    this.firePreview();
    this.setEnabled(false);
    this.callbacks.onLaunch(vx, vy, this.loadedType, { x: p.x, y: p.y });
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

  /* ------------------------------------------------------------------ */
  /* Dynamic layers: bands, pouch, trajectory                            */
  /* ------------------------------------------------------------------ */

  /** Visual pouch position: dragged preview → snap animation → rest. */
  pouchPoint() {
    if (this.preview) return { x: this.preview.x, y: this.preview.y };
    if (this.snap) {
      const t = this.snapT();
      const f = (1 - t) * Math.cos(t * 4.2); // 1 → overshoot past rest → 0
      return {
        x: this.anchor.x + (this.snap.from.x - this.anchor.x) * f,
        y: this.anchor.y + (this.snap.from.y - this.anchor.y) * f
      };
    }
    return { x: this.anchor.x, y: this.anchor.y };
  }

  snapT() {
    if (!this.snap) return 1;
    return Math.max(0, Math.min(1, (this.scene.time.now - this.snap.t0) / SNAP_MS));
  }

  startSnap(from) {
    this.snap = { from: { x: from.x, y: from.y }, t0: this.scene.time.now };
  }

  onUpdate() {
    if (this.snap && !this.preview) {
      if (this.snapT() >= 1) this.snap = null;
      this.redraw();
    }
  }

  /** Where a band meets the pouch: on its surface, toward the tip. */
  bandAttach(pouch, tip) {
    const dx = tip.x - pouch.x;
    const dy = tip.y - pouch.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: pouch.x + (dx / len) * 11, y: pouch.y + (dy / len) * 11 };
  }

  redraw() {
    const rest = this.pouchPoint();
    const gB = this.layerBandBack;
    const gP = this.layerPouch;
    const gF = this.layerBandFront;
    const gT = this.layerTrajectory;
    gB.clear();
    gP.clear();
    gF.clear();
    gT.clear();

    // pull vector (tips midpoint → pouch) drives stretch + pouch facing
    const mid = {
      x: (this.forkBack.x + this.forkFront.x) / 2,
      y: (this.forkBack.y + this.forkFront.y) / 2
    };
    const pull = { x: rest.x - mid.x, y: rest.y - mid.y };
    const pullLen = Math.hypot(pull.x, pull.y) || 1;
    const stretch = Math.min(pullLen / SLINGSHOT.MAX_DRAG, 1);

    // leather pouch always visible (a real slingshot keeps its pouch)
    const angle = Math.atan2(pull.y, pull.x) + Math.PI / 2;
    this.drawPouch(gP, rest, angle);

    // rubber bands — thin as they stretch, slight sag when slack
    const thin = 4.5 - 2 * stretch;
    this.drawBand(gB, this.forkBack, this.bandAttach(rest, this.forkBack), thin + 0.5, WOOD.bandDark, stretch);
    this.drawBand(gF, this.forkFront, this.bandAttach(rest, this.forkFront), thin + 1.5, WOOD.band, stretch);

    if (this.dragging) this.drawTrajectory(gT);
  }

  drawBand(g, tip, target, width, color, stretch) {
    const sag = 7 * (1 - stretch); // taut when stretched, slack at rest
    const ctrl = { x: (tip.x + target.x) / 2, y: (tip.y + target.y) / 2 + sag };
    g.lineStyle(width + 2, WOOD.bandDark, 0.55);
    g.beginPath();
    this.curvePath(g, tip, target, ctrl);
    g.strokePath();
    g.lineStyle(width, color, 1);
    g.beginPath();
    this.curvePath(g, tip, target, ctrl);
    g.strokePath();
  }

  /** Capsule-shaped leather pouch, long axis perpendicular to the pull. */
  drawPouch(g, p, angle) {
    const w = 30; // long axis
    const h = 20; // thickness
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    const dx = ax * w / 2;
    const dy = ay * w / 2;
    const nx = -ay * h / 2;
    const ny = ax * h / 2;
    const pts = [
      { x: p.x + dx + nx, y: p.y + dy + ny },
      { x: p.x + dx - nx, y: p.y + dy - ny },
      { x: p.x - dx - nx, y: p.y - dy - ny },
      { x: p.x - dx + nx, y: p.y - dy + ny }
    ];
    g.fillStyle(WOOD.pouch, 1);
    g.fillPoints(pts, true);
    g.lineStyle(3, WOOD.pouchEdge, 1);
    g.strokePoints(pts, true, true);
    // rounded caps
    for (const cap of [{ x: p.x + dx, y: p.y + dy }, { x: p.x - dx, y: p.y - dy }]) {
      g.fillStyle(WOOD.pouch, 1);
      g.fillCircle(cap.x, cap.y, h / 2);
      g.lineStyle(3, WOOD.pouchEdge, 1);
      g.strokeCircle(cap.x, cap.y, h / 2);
    }
    // grip stitch
    g.lineStyle(2, 0x5d452f, 0.9);
    g.beginPath();
    g.moveTo(p.x - dx * 0.4, p.y - dy * 0.4);
    g.lineTo(p.x + dx * 0.4, p.y + dy * 0.4);
    g.strokePath();
  }

  /** Dotted aiming trajectory — same integrator as the real physics. */
  drawTrajectory(g) {
    const p = this.pouchPoint();
    const dx = this.anchor.x - p.x;
    const dy = this.anchor.y - p.y;
    const dragLen = Math.hypot(dx, dy);
    if (dragLen === 0) return;
    const power = dragLen / SLINGSHOT.MAX_DRAG;
    const speed = Math.min(power, 1) * SLINGSHOT.MAX_SPEED;
    const vx = (dx / dragLen) * speed;
    const vy = (dy / dragLen) * speed;
    const type = PROJECTILE_TYPES[this.loadedType];
    const pts = predictPath(p.x, p.y, vx, vy, { frictionAir: type.frictionAir });

    g.fillStyle(COLORS.TRAJECTORY, 0.85);
    for (let i = 2; i < pts.length; i += 3) {
      const pt = pts[i];
      // terrain-aware cutoff: dots stop at the painted platform surface
      const ground = pt.x < this.terrain.WATER_GAP[1] ? this.terrain.PLATEAU.top : this.terrain.TERRACE.top;
      if (pt.y > ground) break;
      const r = Math.max(2, 4.5 - i * 0.05);
      g.fillCircle(pt.x, pt.y, r);
    }
  }
}
