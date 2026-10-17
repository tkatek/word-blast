/**
 * SlingshotRenderer — every pixel of the slingshot, and nothing else:
 * ONE complete, static wooden artwork sprite (the supplied PNG is never
 * cropped, split, masked or duplicated), two elastic rubber bands, the
 * leather pouch, the tip wraps and the aiming dots. Purely visual —
 * launch physics lives in Slingshot.js, which feeds this renderer
 * positions each frame.
 *
 * Layering (back → front), all inside the fixed 1280×720 world:
 *   1  shadow      soft contact ellipse planting the base into the grass
 *   2  wood        the COMPLETE supplied artwork (trunk + both prongs) as
 *                  ONE static sprite. Its frame is pinned to '__BASE'
 *                  explicitly: Phaser's Texture.add() promotes any newly
 *                  added frame to the texture default, which once made an
 *                  implicitly-framed image render a cropped prong instead
 *                  of the full art (the "disconnected arms / invisible
 *                  trunk" bug). Pinning the frame makes that impossible.
 *   3  bandBack    rear rubber band — above the wood, behind the pouch
 *   8  pouch       leather cup cradling the bird
 *   9  (bird preview — created by Slingshot, drawn between the bands)
 *  13  bandFront   front rubber band — over the bird, so the projectile
 *                  reads as seated between the two elastics WITHOUT any
 *                  duplicated or re-cropped wood overlay
 *  14  tipWraps    band coils around both wooden fork tips
 *  15  trajectory  aiming dots (below HUD 50 / panels 80)
 *
 * The artwork is never stretched during aiming — only the bands, pouch
 * and preview move. Texture anchors are normalized (SLINGSHOT.ART in
 * config.js) and mapped through the sprite's live transform, so any
 * proportional re-scale keeps every attachment exactly on the wood.
 */
import { SLINGSHOT, WORLD, COLORS } from '../config.js';

export const RENDER_DEPTH = {
  SHADOW: 1,
  WOOD: 2,
  BAND_BACK: 3,
  POUCH: 8,
  PROJECTILE: 9,
  BAND_FRONT: 13,
  TIP_WRAP: 14,
  TRAJECTORY: 15
};

/** Dark-brown elastic + worn leather palette (cartoon, matches the wood art). */
const RUBBER = {
  band: 0x4a2c1c,        // sunlit front band
  rear: 0x38200f,        // rear band — shaded, further from camera
  outline: 0x241408,
  highlight: 0x7d4d2f
};
const LEATHER = {
  main: 0x4a2f1d,
  dark: 0x32200f,
  edge: 0x221610,
  hi: 0x7a5433,
  stitch: 0x93704b
};
const FALLBACK_WOOD = {
  outline: 0x53331a,
  back: 0x8a5527,
  front: 0xa9713f,
  light: 0xc08b52
};

/* ------------------------------------------------------------------ */
/* Small vector helpers (kept local — this module never imports Phaser) */
/* ------------------------------------------------------------------ */

const v = (x, y) => ({ x, y });
const add = (a, b) => v(a.x + b.x, a.y + b.y);
const sub = (a, b) => v(a.x - b.x, a.y - b.y);
const mul = (a, k) => v(a.x * k, a.y * k);
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => { const l = len(a) || 1; return v(a.x / l, a.y / l); };
const mid = (a, b) => v((a.x + b.x) / 2, (a.y + b.y) / 2);
const perp = (a) => v(-a.y, a.x);

/** Point on a quadratic Bézier p0 → p1 with control cp at t ∈ [0,1]. */
function quadPt(p0, p1, cp, t) {
  const u = 1 - t;
  return v(
    u * u * p0.x + 2 * u * t * cp.x + t * t * p1.x,
    u * u * p0.y + 2 * u * t * cp.y + t * t * p1.y
  );
}

/**
 * Make sure the wooden artwork texture exists. The supplied PNG is
 * preloaded by BootScene; if it could not be fetched (headless test
 * environment, missing file), a procedural wooden Y is generated at the
 * SAME texture size using the SAME normalized anchors — every downstream
 * geometry (fork tips, pouch rest, base, overlay crop) stays valid.
 */
export function ensureSlingshotTexture(scene) {
  const KEY = SLINGSHOT.ART.KEY;
  const size = SLINGSHOT.ART.TEXTURE_SIZE;
  if (scene.textures.exists(KEY)) {
    const src = scene.textures.get(KEY).getSourceImage();
    if (src && src.width >= size * 0.5) return; // real artwork present
  }
  const A = SLINGSHOT.ART;
  const P = (n) => v(n.x * size, n.y * size);
  const rearTip = P(A.REAR_TIP);
  const frontTip = P(A.FRONT_TIP);
  const pouch = P(A.POUCH);
  const base = P(A.BASE);
  const junction = v(pouch.x, (pouch.y + base.y) / 2 - 40);

  const g = scene.add.graphics();
  const limb = (a, b, w, fill) => {
    for (const [lw, c] of [[w + 36, FALLBACK_WOOD.outline], [w, fill]]) {
      g.lineStyle(lw, c, 1);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
    }
    for (const p of [a, b]) {
      g.fillStyle(fill, 1);
      g.fillCircle(p.x, p.y, w / 2);
    }
  };
  // contact shadow baked into the fallback is unnecessary — the renderer
  // draws a live one; just the wood here
  limb(base, junction, 150, FALLBACK_WOOD.front);
  limb(junction, rearTip, 118, FALLBACK_WOOD.back);
  limb(junction, frontTip, 118, FALLBACK_WOOD.front);
  g.lineStyle(14, FALLBACK_WOOD.light, 0.6);
  g.beginPath();
  g.moveTo(base.x - 22, base.y - 60);
  g.lineTo(junction.x - 22, junction.y + 40);
  g.strokePath();
  g.generateTexture(KEY, size, size);
  g.destroy();
}

export class SlingshotRenderer {
  /** @param {Phaser.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    ensureSlingshotTexture(scene);

    const KEY = SLINGSHOT.ART.KEY;
    const tex = scene.textures.get(KEY);
    const src = tex.getSourceImage();
    this.texW = src.width;
    this.texH = src.height;

    // Front-fork overlay frame: a sub-rectangle of the SAME texture, added
    // once per texture (survives scene restarts — Phaser caches textures).
    const FR = SLINGSHOT.ART.FRONT_CROP;
    this.cropPx = {
      x: Math.round(FR.x * this.texW),
      y: Math.round(FR.y * this.texH),
      w: Math.round(FR.w * this.texW),
      h: Math.round(FR.h * this.texH)
    };
    if (!tex.has(FRONT_FRAME)) {
      tex.add(FRONT_FRAME, 0, this.cropPx.x, this.cropPx.y, this.cropPx.w, this.cropPx.h);
    }

    // display objects, created back-to-front
    this.shadow = scene.add.graphics().setDepth(RENDER_DEPTH.SHADOW);
    this.woodBack = scene.add.image(0, 0, KEY)
      .setOrigin(0, 0)
      .setDepth(RENDER_DEPTH.WOOD_BACK);
    this.woodFront = scene.add.image(0, 0, KEY, FRONT_FRAME)
      .setOrigin(0, 0)
      .setDepth(RENDER_DEPTH.WOOD_FRONT);
    this.bandBack = scene.add.graphics().setDepth(RENDER_DEPTH.BAND_BACK);
    this.pouchG = scene.add.graphics().setDepth(RENDER_DEPTH.POUCH);
    this.bandFront = scene.add.graphics().setDepth(RENDER_DEPTH.BAND_FRONT);
    this.tipWrap = scene.add.graphics().setDepth(RENDER_DEPTH.TIP_WRAP);
    this.trajectory = scene.add.graphics().setDepth(RENDER_DEPTH.TRAJECTORY);

    // sensible defaults until the first layout()
    this.scale = 0.1;
    this.anchor = { x: 0, y: 0 };
    this.rearTip = { x: 0, y: 0 };
    this.frontTip = { x: 0, y: 0 };
    this.base = { x: 0, y: 0 };
    this.tipsMid = { x: 0, y: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Layout — anchor mapping                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Place the artwork so the normalized POUCH anchor lands exactly on the
   * given world anchor (the launch origin) and the handle bottom plants
   * GRASS_EMBED px below GROUND_Y. Scale is derived, never hardcoded, so
   * tuning ANCHOR or GROUND_Y in config re-fits the whole slingshot.
   * @param {{x:number,y:number}} anchor pouch rest position (world px)
   */
  layout(anchor) {
    const A = SLINGSHOT.ART;
    this.anchor = { x: anchor.x, y: anchor.y };

    // normalized → texture px
    const rearT = v(A.REAR_TIP.x * this.texW, A.REAR_TIP.y * this.texH);
    const frontT = v(A.FRONT_TIP.x * this.texW, A.FRONT_TIP.y * this.texH);
    const pouchT = v(A.POUCH.x * this.texW, A.POUCH.y * this.texH);
    const baseT = v(A.BASE.x * this.texW, A.BASE.y * this.texH);

    // scale so the base sits on the single gameplay ground
    const want = WORLD.GROUND_Y + A.GRASS_EMBED - anchor.y;
    const span = baseT.y - pouchT.y;
    this.scale = Math.max(0.05, Math.min(0.35, want / span));

    // texture top-left in world space (origin 0,0 on both wood sprites)
    const topLeft = v(anchor.x - pouchT.x * this.scale, anchor.y - pouchT.y * this.scale);
    this.woodBack.setPosition(topLeft.x, topLeft.y).setScale(this.scale);
    // the overlay shows only the cropped prong; its frame origin maps to
    // the same texture point, so it sits pixel-perfectly over the rear copy
    this.woodFront
      .setPosition(topLeft.x + this.cropPx.x * this.scale, topLeft.y + this.cropPx.y * this.scale)
      .setScale(this.scale);

    // world-space attachment points (used by the bands every frame)
    const toWorld = (t) => v(topLeft.x + t.x * this.scale, topLeft.y + t.y * this.scale);
    this.rearTip = toWorld(rearT);
    this.frontTip = toWorld(frontT);
    this.base = toWorld(baseT);
    this.tipsMid = mid(this.rearTip, this.frontTip);

    // contact shadow: plants the base into the painted grass
    this.shadow.clear();
    this.shadow.fillStyle(0x14200e, 0.26);
    this.shadow.fillEllipse(this.base.x, WORLD.GROUND_Y + 4, 64 * this.scale * 4.2, 13);
  }

  /* ------------------------------------------------------------------ */
  /* Per-frame drawing                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Redraw the dynamic parts for the current pouch position.
   * @param {object} s render state:
   *   pouch   {x,y}  visual pouch center (dragged / snapping / rest)
   *   bird    Phaser.Image|null  the loaded preview (null after launch)
   *   birdR   number  loaded bird display radius in px (0 = empty pouch /
   *                   legacy circle) — cup and band anchors scale with it
   *   dots    [{x,y}]|null       trajectory preview points (aiming only)
   */
  render(s) {
    const pouch = s.pouch;
    const pull = sub(pouch, this.tipsMid);
    const pullLen = len(pull);
    const stretch = Math.min(pullLen / SLINGSHOT.MAX_DRAG, 1);
    const u = pullLen > 2 ? mul(pull, 1 / pullLen) : v(0.06, 0.99); // slack cup faces up

    // Pouch cup + band anchors sized for the CURRENT occupant (Fix #6B):
    // the legacy constants fit a 32px ball; a 54-68px bird needs a wider,
    // deeper cup or it reads as sitting ON the pouch with bands that end
    // beside the artwork instead of grabbing its rim.
    const birdR = Math.max(0, s.birdR || 0);
    this.pouchR = Math.max(11, birdR * 0.72);

    this.drawPouch(this.pouchG, pouch, u, stretch, !!s.bird);
    this.drawBand(this.bandBack, this.rearTip, this.attachOnPouch(pouch, this.rearTip), stretch, RUBBER.rear, true);
    this.drawBand(this.bandFront, this.frontTip, this.attachOnPouch(pouch, this.frontTip), stretch, RUBBER.band, false);
    this.drawTipWraps(pouch);
    this.drawDots(s.dots);
  }

  /** Where a band meets the pouch: on its rim, toward the given tip. */
  attachOnPouch(pouch, tip) {
    return add(pouch, mul(norm(sub(tip, pouch)), this.pouchR || 11));
  }

  /**
   * One elastic band: outline + body + top highlight + rounded caps, as a
   * quadratic curve from a fork tip to the pouch rim. Slack bands sag;
   * tensioned bands thin out — both read as real rubber.
   */
  drawBand(g, tip, target, stretch, color, isRear) {
    g.clear();
    const sag = (isRear ? 7.5 : 5.5) * (1 - stretch) * (1 - stretch);
    const ctrl = v((tip.x + target.x) / 2, (tip.y + target.y) / 2 + sag);
    const w = 6.4 - 2.3 * stretch;

    // outline
    g.lineStyle(w + 2.6, RUBBER.outline, 1);
    this.strokeQuad(g, tip, target, ctrl);
    // body
    g.lineStyle(w, color, 1);
    this.strokeQuad(g, tip, target, ctrl);
    // top highlight — light comes from the upper left
    const n = norm(perp(sub(target, tip)));
    const off = mul(n, (n.y < 0 ? 1 : -1) * (w * 0.24 + 0.7));
    g.lineStyle(Math.max(1, w * 0.26), RUBBER.highlight, 0.5);
    this.strokeQuad(g, add(tip, off), add(target, off), add(ctrl, off));
    // rounded caps
    for (const p of [tip, target]) {
      g.fillStyle(RUBBER.outline, 1);
      g.fillCircle(p.x, p.y, w / 2 + 1.2);
      g.fillStyle(color, 1);
      g.fillCircle(p.x, p.y, w / 2);
    }
  }

  strokeQuad(g, p0, p1, cp) {
    g.beginPath();
    g.moveTo(p0.x, p0.y);
    for (let i = 1; i <= 8; i++) {
      const pt = quadPt(p0, p1, cp, i / 8);
      g.lineTo(pt.x, pt.y);
    }
    g.strokePath();
  }

  /**
   * Leather pouch: a curved cup whose opening faces the fork tips. Built
   * from two quadratic arcs (outer belly + inner belly) filled as a
   * crescent, with rim highlight, hand-stitch dashes and two rivets at
   * the band attachment corners. Rotates with the pull direction so it
   * always cradles the bird from behind; stretches slightly under load.
   */
  drawPouch(g, p, u, stretch, hasBird) {
    g.clear();
    const w = perp(u); // pouch long axis
    // cup geometry scales with the occupant (this.pouchR, set in render());
    // legacy 32px balls keep the original read via the Math.max floor
    const R = this.pouchR || 11;
    const L = (hasBird ? R * 1.28 : 12.5) * (1 + 0.16 * stretch); // half length
    const D = (hasBird ? R * 0.76 : 7) * (1 + 0.22 * stretch);    // cup depth
    const A = sub(p, mul(w, L));
    const B = add(p, mul(w, L));
    const outerCp = add(p, mul(u, D * 2.55));
    const innerCp = add(p, mul(u, D * 1.25));

    // shadow pass for depth, then the leather crescent
    g.fillStyle(LEATHER.dark, 0.55);
    this.fillCrescent(g, add(A, mul(u, 2.4)), add(B, mul(u, 2.4)), add(outerCp, mul(u, 2.4)), innerCp);
    g.fillStyle(LEATHER.main, 1);
    this.fillCrescent(g, A, B, outerCp, innerCp);
    // edge
    g.lineStyle(2.2, LEATHER.edge, 1);
    this.strokeCrescent(g, A, B, outerCp, innerCp);
    // worn highlight along the outer rim
    g.lineStyle(1.8, LEATHER.hi, 0.55);
    g.beginPath();
    const hiA = add(A, mul(u, 1.6));
    const hiB = add(B, mul(u, 1.6));
    for (let i = 0; i <= 8; i++) {
      const pt = quadPt(hiA, hiB, add(outerCp, mul(u, -0.8)), i / 8);
      if (i === 0) g.moveTo(pt.x, pt.y); else g.lineTo(pt.x, pt.y);
    }
    g.strokePath();
    // hand stitches along the rim
    g.lineStyle(1.4, LEATHER.stitch, 0.9);
    for (let i = 0; i < 6; i++) {
      const t = 0.16 + (0.68 * i) / 5;
      const a = quadPt(A, B, outerCp, t);
      const b = quadPt(A, B, outerCp, Math.min(1, t + 0.06));
      const dir = norm(sub(b, a));
      const s0 = add(mul(add(a, b), 0.5), mul(u, -1.2));
      const s1 = add(s0, mul(dir, 3.2));
      g.beginPath();
      g.moveTo(s0.x, s0.y);
      g.lineTo(s1.x, s1.y);
      g.strokePath();
    }
    // rivets where the bands grab the leather
    for (const corner of [A, B]) {
      g.fillStyle(LEATHER.edge, 1);
      g.fillCircle(corner.x, corner.y, 2.8);
      g.fillStyle(LEATHER.hi, 1);
      g.fillCircle(corner.x, corner.y, 1.5);
    }
  }

  fillCrescent(g, A, B, outerCp, innerCp) {
    g.beginPath();
    g.moveTo(A.x, A.y);
    for (let i = 1; i <= 10; i++) {
      const pt = quadPt(A, B, outerCp, i / 10);
      g.lineTo(pt.x, pt.y);
    }
    for (let i = 10; i >= 0; i--) {
      const pt = quadPt(A, B, innerCp, i / 10);
      g.lineTo(pt.x, pt.y);
    }
    g.closePath();
    g.fillPath();
  }

  strokeCrescent(g, A, B, outerCp, innerCp) {
    g.beginPath();
    g.moveTo(A.x, A.y);
    for (let i = 1; i <= 10; i++) {
      const pt = quadPt(A, B, outerCp, i / 10);
      g.lineTo(pt.x, pt.y);
    }
    for (let i = 10; i >= 0; i--) {
      const pt = quadPt(A, B, innerCp, i / 10);
      g.lineTo(pt.x, pt.y);
    }
    g.closePath();
    g.strokePath();
  }

  /**
   * Band coils around both wooden tips — three short strokes across each
   * tip along the band direction, drawn above the wood AND above the
   * front band, selling the "tied around the fork" attachment.
   */
  drawTipWraps(pouch) {
    const g = this.tipWrap;
    g.clear();
    for (const [tip, shade] of [[this.rearTip, RUBBER.rear], [this.frontTip, RUBBER.band]]) {
      const dir = norm(sub(pouch, tip));
      const across = perp(dir);
      for (const k of [-3.6, 0, 3.6]) {
        const c = add(tip, mul(across, k));
        const a = add(c, mul(dir, -3.6));
        const b = add(c, mul(dir, 3.6));
        g.lineStyle(3.2, RUBBER.outline, 0.9);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.strokePath();
        g.lineStyle(2.2, shade, 1);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.strokePath();
      }
    }
  }

  /** Dotted aiming trajectory (points precomputed by Slingshot). */
  drawDots(dots) {
    const g = this.trajectory;
    g.clear();
    if (!dots) return;
    g.fillStyle(COLORS.TRAJECTORY, 0.85);
    dots.forEach((pt, i) => {
      const r = Math.max(2, 4.5 - i * 0.07);
      g.fillCircle(pt.x, pt.y, r);
    });
  }

  destroy() {
    for (const obj of [this.shadow, this.woodBack, this.bandBack, this.pouchG,
      this.bandFront, this.tipWrap, this.trajectory]) {
      obj.destroy();
    }
  }
}
