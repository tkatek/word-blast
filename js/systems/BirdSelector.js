/**
 * BirdSelector — the bird-selection card row (Fix #19 redesign).
 *
 * Five premium cartoon cards in ONE shared tray along the bottom-center of
 * the gameplay screen, matching the supplied reference: rounded blue-gradient
 * card bodies, real bird artwork contained inside a portrait region, a
 * circular dark-blue ammunition badge at each card's bottom-right corner,
 * a glowing electric-blue selected state and a dimmed unavailable state.
 *
 * Architecture contract (unchanged from the first Fix #19 pass):
 *   - the selector OWNS NO gameplay state: sync() receives one snapshot
 *     (roster, ammo counts, selected key, enabled flag) from the scene's
 *     refreshHUD() funnel and only renders it; clicks call back out through
 *     onSelect() — the scene's selectProjectile() keeps every gate
 *   - all frames/badges are procedural canvas textures generated once and
 *     reused across scene restarts (guarded by textures.exists)
 *   - layout lives in the fixed 1280×720 world and the whole world is
 *     always framed on every device (Viewport), so the tray is effectively
 *     fixed relative to the screen; it is pure HUD (no physics body, never
 *     a child of any gameplay object) and the camera never scrolls — the
 *     only camera motion is the capped (≤0.6%) impact shake the whole HUD
 *     band shares
 *   - the row sits BELOW the slingshot aiming zone (pouch drag clamps at
 *     y ≤ 457; the tray top edge is y = 588) and below the answer towers,
 *     so it can never eat an aiming drag or cover a target
 *   - every card flags its pointerdown through markUi() so the scene's
 *     tap-to-activate-ability handler ignores card taps
 *
 * Portrait fitting (the original oversized-bird bug, fixed structurally):
 *   - each portrait is scaled by CONTAIN-fitting the texture's ACTUAL
 *     non-transparent pixel bounds (alpha bounds, measured once per texture
 *     and cached) into the card's portrait region — transparent padding is
 *     ignored, aspect ratio is preserved, no stretching, no cropping
 *   - the fitted scale is stored as the portrait's base scale; every later
 *     animation multiplies that base (portrait wrapper scale starts at 1)
 *     — nothing ever calls setScale(1) on the portrait image itself, which
 *     is exactly what used to reset the artwork to full texture size
 *
 * Also exports AbilityButton — the mid-flight ability trigger shown while
 * the active bird is flying (bottom-right, far from the cards).
 */
import Phaser from 'phaser';
import { PROJECTILE_TYPES } from '../config.js';
import { birdForProjectile } from '../data/birds.js';

/* Canonical card order: RED, BLUE, YELLOW, BLACK, PURPLE (spec §1). */
export const SELECTOR_ORDER = ['basic', 'speed', 'split', 'bomb', 'ice'];

const SELECTOR_DEPTH = 50; // same band as the top HUD; overlays sit higher

/**
 * Shared layout (all values in 1280×720 world px). The tray is the one
 * anchor: cards are laid out relative to it, so repositioning the selector
 * means changing exactly this object.
 */
export const SELECTOR_LAYOUT = {
  trayX: 640,          // tray center — bottom-CENTER of the gameplay screen
  trayY: 647,          // tray center (bottom edge lands 14px above the fold)
  cardW: 86,
  cardH: 96,
  cardGap: 10,
  trayPadX: 12,
  trayPadY: 11,
  get pitch() { return this.cardW + this.cardGap; },
  get width() { return SELECTOR_ORDER.length * this.cardW + (SELECTOR_ORDER.length - 1) * this.cardGap + 2 * this.trayPadX; },
  get height() { return this.cardH + 2 * this.trayPadY; },
  get topY() { return this.trayY - this.height / 2; },
  get leftX() { return this.trayX - this.width / 2; }
};

/* Texture margin around each card body (fits the selection glow rings). */
const MARGIN = 12;
const TEX_W = SELECTOR_LAYOUT.cardW + MARGIN * 2;   // 110
const TEX_H = SELECTOR_LAYOUT.cardH + MARGIN * 2;   // 120

/** Portrait region inside a card (contain-fit target, centered, badge-aware). */
const PORTRAIT = { w: 64, h: 62, y: -6 };

/* Per-card gradient palettes (idle body + brighter selected body). */
const PALETTES = {
  basic: { top: '#4d80cc', bottom: '#a9d9f2', selTop: '#74a5e2', selBottom: '#dcf3ff' },
  speed: { top: '#2c5fb2', bottom: '#7cb9f3', selTop: '#4b86d6', selBottom: '#aad6ff' },
  split: { top: '#1e8b90', bottom: '#70dac9', selTop: '#37b4b7', selBottom: '#a9f0e3' },
  bomb: { top: '#3b4457', bottom: '#7d89a1', selTop: '#57627c', selBottom: '#9caac2' },
  ice: { top: '#5c40a0', bottom: '#a68de9', selTop: '#7d61c3', selBottom: '#c6b3f3' }
};

const TEX = {
  shadow: 'wbsel-shadow',
  glow: 'wbsel-glow',
  off: 'wbsel-off',
  dim: 'wbsel-dim',
  sheen: 'wbsel-sheen',
  badge: 'wbsel-badge',
  bolt: 'wbsel-bolt',
  idle: (key) => `wbsel-idle-${key}`,
  sel: (key) => `wbsel-sel-${key}`
};

/* ------------------------------------------------------------------ */
/* Canvas texture helpers (identical result in WebGL and Canvas)       */
/* ------------------------------------------------------------------ */

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** One card body texture (rounded gradient + borders + sheen + shade). */
function drawCardBody(ctx, { top, bottom }, border, innerAlpha) {
  const x = MARGIN, y = MARGIN;
  const w = SELECTOR_LAYOUT.cardW, h = SELECTOR_LAYOUT.cardH;
  const r = 14;

  // body gradient
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // clip everything decorative to the rounded body
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();

  // bottom inner shade
  ctx.fillStyle = 'rgba(8,14,32,0.20)';
  ctx.fillRect(x, y + h - 24, w, 24);

  // top sheen (soft white gradient over the upper third)
  const sheen = ctx.createLinearGradient(0, y + 4, 0, y + 34);
  sheen.addColorStop(0, 'rgba(255,255,255,0.34)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  roundRectPath(ctx, x + 5, y + 4, w - 10, 30, 9);
  ctx.fill();
  ctx.restore();

  // outer border
  roundRectPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = border;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // decorative inner light border
  roundRectPath(ctx, x + 3.5, y + 3.5, w - 7, h - 7, r - 3.5);
  ctx.strokeStyle = `rgba(255,255,255,${innerAlpha})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Procedural textures (generated once; survive scene restarts). Guards on
 * textures.exists so a scene restart never duplicates them.
 */
export function ensureCardTextures(scene) {
  const T = scene.textures;
  if (T.exists(TEX.badge)) return;
  const add = (key, w, h, draw) => {
    if (T.exists(key)) return;
    const canvas = makeCanvas(w, h);
    draw(canvas.getContext('2d'));
    T.addCanvas(key, canvas);
  };

  // per-bird idle + selected card bodies
  for (const key of SELECTOR_ORDER) {
    const pal = PALETTES[key];
    add(TEX.idle(key), TEX_W, TEX_H, (ctx) => {
      drawCardBody(ctx, pal, 'rgba(10,18,38,0.9)', 0.32);
    });
    add(TEX.sel(key), TEX_W, TEX_H, (ctx) => {
      drawCardBody(ctx, { top: pal.selTop, bottom: pal.selBottom }, '#bff0ff', 0.55);
    });
  }

  // unavailable card body (desaturated dark navy)
  add(TEX.off, TEX_W, TEX_H, (ctx) => {
    drawCardBody(ctx, { top: '#2c3444', bottom: '#4a5468' }, 'rgba(12,16,28,0.9)', 0.14);
  });

  // soft drop shadow (offset down, pseudo-blurred by stacking)
  add(TEX.shadow, TEX_W, TEX_H, (ctx) => {
    const { cardW, cardH } = SELECTOR_LAYOUT;
    for (let i = 0; i < 3; i++) {
      roundRectPath(ctx, MARGIN - 1.5 - i, MARGIN + 2.5 + i, cardW + 3 + i * 2, cardH + 2 + i * 2, 15);
      ctx.fillStyle = 'rgba(3,8,20,0.13)';
      ctx.fill();
    }
  });

  // electric-blue selection glow rings (drawn BEHIND the brighter card)
  add(TEX.glow, TEX_W, TEX_H, (ctx) => {
    const { cardW, cardH } = SELECTOR_LAYOUT;
    const rings = [
      { grow: 3.5, alpha: 0.50 },
      { grow: 7, alpha: 0.26 },
      { grow: 10.5, alpha: 0.12 }
    ];
    for (const ring of rings) {
      roundRectPath(ctx, MARGIN - ring.grow, MARGIN - ring.grow,
        cardW + ring.grow * 2, cardH + ring.grow * 2, 14 + ring.grow);
      ctx.strokeStyle = `rgba(53,200,255,${ring.alpha})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  });

  // gray/blue overlay for unavailable cards (alpha-tweened at runtime)
  add(TEX.dim, TEX_W, TEX_H, (ctx) => {
    roundRectPath(ctx, MARGIN, MARGIN, SELECTOR_LAYOUT.cardW, SELECTOR_LAYOUT.cardH, 14);
    ctx.fillStyle = 'rgba(38,46,64,0.92)';
    ctx.fill();
  });

  // hover sheen (white, very low alpha, inside the border)
  add(TEX.sheen, TEX_W, TEX_H, (ctx) => {
    roundRectPath(ctx, MARGIN + 4, MARGIN + 4,
      SELECTOR_LAYOUT.cardW - 8, SELECTOR_LAYOUT.cardH - 8, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
  });

  // circular ammunition badge (dark navy + bright blue outline)
  add(TEX.badge, 40, 40, (ctx) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(20, 20, 16.5, 0, Math.PI * 2);
    ctx.fillStyle = '#141f3c';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(20, 20, 16.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#3fa7ff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(20, 20, 12.5, Math.PI * 1.05, Math.PI * 1.75);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // lightning bolt (ability button icon — shared with AbilityButton)
  const g = scene.add.graphics();
  g.fillStyle(0x4d3218, 1);
  g.fillPoints([
    new Phaser.Geom.Point(29, 4), new Phaser.Geom.Point(11, 34),
    new Phaser.Geom.Point(22, 34), new Phaser.Geom.Point(17, 58),
    new Phaser.Geom.Point(39, 26), new Phaser.Geom.Point(27, 26)
  ], true);
  g.fillStyle(0xffd60a, 1);
  g.fillPoints([
    new Phaser.Geom.Point(29, 9), new Phaser.Geom.Point(16, 32),
    new Phaser.Geom.Point(23, 32), new Phaser.Geom.Point(20, 51),
    new Phaser.Geom.Point(35, 28), new Phaser.Geom.Point(27, 28)
  ], true);
  g.generateTexture(TEX.bolt, 44, 62);
  g.destroy();
}

/* ------------------------------------------------------------------ */
/* Portrait fitting — alpha-bounds contain (the oversized-bird fix)    */
/* ------------------------------------------------------------------ */

/** Measured alpha bounds, keyed by texture key (module-lifetime cache). */
const alphaBoundsCache = new Map();

/**
 * Actual non-transparent pixel bounds of a texture ({x,y,w,h,srcW,srcH} in
 * texture px). Drawn once onto a scratch canvas and scanned; when pixel
 * data is unreadable (headless test env's no-op 2D context) or empty, the
 * full texture bounds are returned — the fit stays safe everywhere.
 */
export function alphaBoundsOf(scene, textureKey) {
  if (alphaBoundsCache.has(textureKey)) return alphaBoundsCache.get(textureKey);
  let bounds = null;
  try {
    const tex = scene.textures.get(textureKey);
    const src = tex && tex.getSourceImage ? tex.getSourceImage() : null;
    const srcW = (src && (src.naturalWidth || src.width)) || 0;
    const srcH = (src && (src.naturalHeight || src.height)) || 0;
    if (src && srcW > 0 && srcH > 0 && typeof document !== 'undefined'
      && typeof document.createElement === 'function') {
      const canvas = makeCanvas(srcW, srcH);
      const ctx = canvas.getContext('2d');
      if (ctx && typeof ctx.drawImage === 'function') {
        ctx.drawImage(src, 0, 0);
        const isBlank = (data, from, to) => {
          for (let i = from; i < to; i += 4) if (data[i + 3] > 12) return false;
          return true;
        };
        if (typeof ctx.getImageData === 'function') {
          const THRESH = 12;
          let minX = srcW, minY = srcH, maxX = -1, maxY = -1;
          // row scan: find the tight box of pixels above the alpha threshold
          for (let y = 0; y < srcH; y++) {
            const d = ctx.getImageData(0, y, srcW, 1).data;
            if (isBlank(d, 0, d.length)) continue;
            if (minY === srcH) minY = y;
            maxY = y;
            for (let x = 0; x < srcW; x++) {
              if (d[x * 4 + 3] > THRESH) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
              }
            }
          }
          if (maxX >= minX && maxY >= minY) {
            bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, srcW, srcH };
          }
        }
      }
    }
    if (!bounds) {
      const w = srcW || 1, h = srcH || 1;
      bounds = { x: 0, y: 0, w, h, srcW: w, srcH: h };
    }
  } catch {
    bounds = { x: 0, y: 0, w: 1, h: 1, srcW: 1, srcH: 1 };
  }
  alphaBoundsCache.set(textureKey, bounds);
  return bounds;
}

/**
 * Contain-fit a portrait image into a centered region, preserving aspect
 * ratio and ignoring transparent padding. Returns the base scale (all
 * later portrait animation multiplies it — never resets it).
 */
function fitPortrait(scene, image, regionW, regionH) {
  const b = alphaBoundsOf(scene, image.texture.key);
  const scale = Math.min(regionW / b.w, regionH / b.h);
  image.setScale(scale);
  // center the ALPHA bounds (not the padded texture) on the local origin
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  image.setPosition(-(cx - b.srcW / 2) * scale, -(cy - b.srcH / 2) * scale);
  return scale;
}

/* ------------------------------------------------------------------ */
/* The card row                                                        */
/* ------------------------------------------------------------------ */
export class BirdSelector {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} handlers {
   *   onSelect(key) — card clicked (scene gates availability),
   *   markUi()      — flags the pointerdown as UI (never an ability tap),
   *   audio         — event bus (optional 'ui-click')
   * }
   */
  constructor(scene, handlers = {}) {
    this.scene = scene;
    this.onSelect = handlers.onSelect || (() => {});
    this.markUi = handlers.markUi || (() => {});
    this.audio = handlers.audio || null;

    ensureCardTextures(scene);

    // ONE shared root: the tray + every card move as a single HUD unit
    this.root = scene.add.container(SELECTOR_LAYOUT.trayX, SELECTOR_LAYOUT.trayY)
      .setDepth(SELECTOR_DEPTH);
    this.cards = new Map();   // projectile key -> card record
    this.prevAmmo = {};       // for decrease-pulse detection
    this.prevSelected = null;
    this.enabled = true;      // false dims the row (terminal overlays)

    this.buildTray();
    SELECTOR_ORDER.forEach((key, i) => this.cards.set(key, this.buildCard(key, i)));
    scene.events.once('shutdown', () => this.destroy());
  }

  get reducedMotion() {
    const save = this.scene.registry.get('save');
    return !!(save && save.data && save.data.settings && save.data.settings.reducedMotion);
  }

  /** Shared dark-blue tray with rounded corners and generous padding. */
  buildTray() {
    const s = this.scene;
    const L = SELECTOR_LAYOUT;
    const halfW = L.width / 2, halfH = L.height / 2;

    const shadow = s.add.graphics();
    shadow.fillStyle(0x030814, 0.32);
    shadow.fillRoundedRect(-halfW - 2, -halfH + 4, L.width + 4, L.height, 20);

    const tray = s.add.graphics();
    tray.fillStyle(0x172036, 0.82);
    tray.fillRoundedRect(-halfW, -halfH, L.width, L.height, 18);
    tray.lineStyle(2, 0x7ea6e2, 0.30);
    tray.strokeRoundedRect(-halfW + 1, -halfH + 1, L.width - 2, L.height - 2, 17);
    // subtle top inner highlight
    tray.lineStyle(1.5, 0xbcd2f2, 0.18);
    tray.strokeRoundedRect(-halfW + 4, -halfH + 4, L.width - 8, L.height - 8, 14);

    this.root.add([shadow, tray]);
  }

  /** Build one card container at its slot inside the tray. */
  buildCard(key, index) {
    const s = this.scene;
    const L = SELECTOR_LAYOUT;
    const card = s.add.container((index - (SELECTOR_ORDER.length - 1) / 2) * L.pitch, 0);

    const shadow = s.add.image(0, 3, TEX.shadow);
    const glow = s.add.image(0, 0, TEX.glow).setVisible(false).setAlpha(0);
    const frame = s.add.image(0, 0, TEX.idle(key));
    const dimmer = s.add.image(0, 0, TEX.dim).setAlpha(0);
    const sheen = s.add.image(0, 0, TEX.sheen).setAlpha(0);

    // portrait wrapper: all portrait reactions scale/rotate THIS container
    // (scale 1 = fitted base) — the image's own fitted scale is untouchable
    const portraitWrap = s.add.container(0, PORTRAIT.y);
    const bird = birdForProjectile(key);
    const textureKey = bird && s.textures.exists(bird.texture)
      ? bird.texture
      : `proj-${key}`; // legacy procedural circle (headless / missing artwork)
    const portrait = s.add.image(0, 0, textureKey);
    fitPortrait(s, portrait, PORTRAIT.w, PORTRAIT.h);
    portraitWrap.add(portrait);

    const hotkey = s.add.text(-L.cardW / 2 + 7, -L.cardH / 2 + 6, String(index + 1), {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', fontStyle: 'bold',
      color: '#eaf4ff'
    }).setOrigin(0.5).setAlpha(0.75);
    hotkey.setStroke('rgba(8,16,34,0.9)', 3);

    // circular ammunition badge — bottom-right corner, tangent inside
    const badgeX = L.cardW / 2 - 13;
    const badgeY = L.cardH / 2 - 15;
    const badge = s.add.image(badgeX, badgeY, TEX.badge).setDisplaySize(30, 30);
    const badgeNum = s.add.text(badgeX, badgeY + 0.5, '0', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '16px', fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5);
    badgeNum.setStroke('#0d1830', 3);

    card.add([shadow, glow, frame, dimmer, sheen, portraitWrap, hotkey, badge, badgeNum]);
    this.root.add(card);

    const rec = {
      key, card, glow, frame, dimmer, sheen, portraitWrap, portrait,
      badge, badgeNum, hotkey,
      available: true,
      isSelected: false,
      hover: false,
      yTween: null,       // the card's ONE layout tween (y only)
      scaleTween: null,   // the card's ONE selection scale tween
      glowPulse: null,
      birdName: birdForProjectile(key)?.name || PROJECTILE_TYPES[key].name
    };

    card.setSize(L.cardW, L.cardH);
    card.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-L.cardW / 2, -L.cardH / 2, L.cardW, L.cardH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true
    });
    card.on('pointerover', () => {
      if (!this.enabled || !rec.available) return;
      rec.hover = true;
      this.layoutCard(rec);
      this.fade(rec.sheen, 1, 110);
    });
    card.on('pointerout', () => {
      rec.hover = false;
      this.layoutCard(rec);
      this.fade(rec.sheen, 0, 110);
    });
    card.on('pointerdown', () => {
      this.markUi();
      if (!this.enabled || !rec.available) return;
      this.audio?.emit('ui-click');
      this.pressCard(rec);
      this.onSelect(key);
    });

    return rec;
  }

  /* ---------------------------------------------------------------- */
  /* Micro-animations (all reduced-motion aware, all short)           */
  /* ---------------------------------------------------------------- */

  /** Tween a GameObject's alpha (instant when reduced motion is on). */
  fade(target, alpha, duration = 150) {
    if (this.reducedMotion) {
      this.scene.tweens.killTweensOf(target);
      target.setAlpha(alpha);
      return;
    }
    this.scene.tweens.killTweensOf(target);
    this.scene.tweens.add({ targets: target, alpha, duration, ease: 'Quad.out' });
  }

  /**
   * One funnel for the card's lift offset (selection −4, hover −3 on top).
   * Every y change routes through here and only ever touches the card's
   * OWN y tween reference, so hover can never kill the selection scale
   * tween (and vice versa).
   */
  layoutCard(rec, instant = false) {
    const targetY = (rec.isSelected ? -4 : 0) + (rec.hover ? -3 : 0);
    if (rec.card.y === targetY && !rec.yTween) return;
    if (rec.yTween) { rec.yTween.remove(); rec.yTween = null; }
    if (instant || this.reducedMotion) {
      rec.card.y = targetY;
      return;
    }
    rec.yTween = this.scene.tweens.add({
      targets: rec.card, y: targetY, duration: 130, ease: 'Quad.out',
      onComplete: () => { rec.yTween = null; }
    });
  }

  /** Press feedback: a quick dip of the card body (never the layout). */
  pressCard(rec) {
    if (this.reducedMotion) return;
    this.scene.tweens.killTweensOf(rec.frame);
    rec.frame.setScale(1);
    this.scene.tweens.add({
      targets: rec.frame, scale: 0.955, duration: 80, yoyo: true, ease: 'Quad.out',
      onComplete: () => rec.frame.setScale(1)
    });
  }

  /** Selection pop: card scales up slightly (never enough to overlap). */
  popSelection(rec) {
    if (rec.scaleTween) { rec.scaleTween.remove(); rec.scaleTween = null; }
    if (this.reducedMotion) {
      rec.card.setScale(1.05);
      return;
    }
    rec.scaleTween = this.scene.tweens.add({
      targets: rec.card, scale: 1.05, duration: 180, ease: 'Back.out',
      onComplete: () => { rec.scaleTween = null; }
    });
    // subtle portrait reaction (wrapper scale — base fit stays intact)
    this.scene.tweens.killTweensOf(rec.portraitWrap);
    this.scene.tweens.add({
      targets: rec.portraitWrap, scale: 1.07, duration: 150, yoyo: true, ease: 'Quad.out',
      onComplete: () => rec.portraitWrap.setScale(1)
    });
  }

  /** Quantity badge briefly pulses when its count drops. */
  pulseBadge(rec) {
    if (this.reducedMotion) return;
    this.scene.tweens.killTweensOf([rec.badge, rec.badgeNum]);
    this.scene.tweens.add({
      targets: [rec.badge, rec.badgeNum], scale: 1.35, duration: 130, yoyo: true,
      ease: 'Quad.out', onComplete: () => {
        rec.badge.setScale(1);
        rec.badgeNum.setScale(1);
      }
    });
  }

  /**
   * Apply/clear the selected state. The glow image (behind the brighter
   * card body) breathes gently instead of the whole card scaling forever.
   */
  applySelection(rec, on) {
    rec.isSelected = on;
    rec.frame.setTexture(on ? TEX.sel(rec.key) : rec.available ? TEX.idle(rec.key) : TEX.off);
    if (rec.glowPulse) {
      rec.glowPulse.stop();
      rec.glowPulse = null;
    }
    if (on) {
      rec.glow.setVisible(true);
      this.fade(rec.glow, 1, 160);
      if (!this.reducedMotion) {
        rec.glowPulse = this.scene.tweens.add({
          targets: rec.glow, alpha: { from: 1, to: 0.8 }, duration: 850, yoyo: true,
          repeat: -1, ease: 'Sine.inOut'
        });
      }
      this.popSelection(rec);
    } else {
      this.fade(rec.glow, 0, 140);
      if (rec.scaleTween) { rec.scaleTween.remove(); rec.scaleTween = null; }
      if (!this.reducedMotion) {
        rec.scaleTween = this.scene.tweens.add({
          targets: rec.card, scale: 1, duration: 140, ease: 'Quad.out',
          onComplete: () => { rec.scaleTween = null; }
        });
      } else {
        rec.card.setScale(1);
      }
    }
    this.layoutCard(rec);
  }

  /**
   * One snapshot render. snap = {
   *   roster: string[],       projectile keys usable this level
   *   ammo: {key: count},     remaining ammunition
   *   selected: string,       currently selected key
   *   enabled: boolean        row interactive/visible (true during play)
   * }
   */
  sync(snap = {}) {
    const roster = snap.roster || [];
    const ammo = snap.ammo || {};
    const selected = snap.selected || null;
    this.enabled = snap.enabled !== false;

    for (const [key, rec] of this.cards) {
      const inRoster = roster.includes(key);
      const count = Math.max(0, ammo[key] ?? 0);
      const available = inRoster && count > 0;
      const isSelected = key === selected && available;
      rec.available = available;

      // selection change → swap frame + pop (idempotent)
      if (rec.isSelected !== isSelected) this.applySelection(rec, isSelected);
      else if (isSelected) rec.frame.setTexture(TEX.sel(rec.key));

      // availability dimming (smooth gray/blue overlay)
      this.fade(rec.dimmer, available ? 0 : 0.55, 200);
      rec.portrait.setTint(available ? 0xffffff : 0x9aa4b8);

      // interactive only while selectable (no accidental taps on dead cards)
      if (rec.card.input) rec.card.input.enabled = available;
      rec.card.setAlpha(this.enabled ? 1 : 0.6);

      // ammunition badge — always the authoritative count
      rec.badgeNum.setText(String(count));

      // ammunition decreased → badge pulse
      const prev = this.prevAmmo[key];
      if (prev !== undefined && count < prev) this.pulseBadge(rec);
      this.prevAmmo[key] = count;
    }
    this.prevSelected = selected;
  }

  destroy() {
    for (const rec of this.cards.values()) {
      if (rec.glowPulse) rec.glowPulse.stop();
      if (rec.yTween) rec.yTween.remove();
      if (rec.scaleTween) rec.scaleTween.remove();
      this.scene.tweens.killTweensOf([
        rec.card, rec.frame, rec.glow, rec.dimmer, rec.sheen,
        rec.portraitWrap, rec.badge, rec.badgeNum
      ]);
    }
    this.cards.clear();
    this.root?.destroy();
    this.root = null;
  }
}

/* ------------------------------------------------------------------ */
/* The mid-flight ability button (mobile + desktop)                    */
/* ------------------------------------------------------------------ */

/**
 * Round wooden TAP-button shown ONLY while the active bird is flying and
 * has an ability (bottom-right — deliberately far from the card row and
 * from the slingshot's aiming zone). Clicking it flags markUi() and calls
 * onActivate; the scene's own state gates decide whether an ability runs.
 */
export class AbilityButton {
  constructor(scene, { onActivate, markUi } = {}) {
    this.scene = scene;
    ensureCardTextures(scene);

    const s = scene;
    this.root = s.add.container(1216, 626).setDepth(SELECTOR_DEPTH).setVisible(false);
    const ring = s.add.circle(0, 0, 44, 0xffd166, 0.28);
    const disc = s.add.circle(0, 0, 37, 0xe09f3e, 1).setStrokeStyle(4, 0x9c6b1f, 1);
    const inner = s.add.circle(0, -3, 31, 0xffd166, 1);
    const bolt = s.add.image(0, -3, TEX.bolt).setDisplaySize(22, 30);
    const label = s.add.text(0, 26, 'TAP', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px', fontStyle: 'bold',
      color: '#fff6e5'
    }).setOrigin(0.5).setAlpha(0.95);
    label.setStroke('#4d3218', 3);
    this.root.add([ring, disc, inner, bolt, label]);
    this.pulse = null;

    this.root.setSize(88, 88);
    this.root.setInteractive({ useHandCursor: true });
    this.root.on('pointerover', () => this.root.setScale(1.06));
    this.root.on('pointerout', () => this.root.setScale(1));
    this.root.on('pointerdown', () => {
      markUi?.();
      this.root.setScale(0.93);
    });
    this.root.on('pointerup', () => {
      this.root.setScale(1.06);
      onActivate?.();
    });

    scene.events.once('shutdown', () => this.destroy());
  }

  /**
   * Show/hide for the current shot. visible = the shot's bird has an
   * ability AND the state allows activation (the scene passes the flag).
   */
  sync({ visible }) {
    if (this.root.visible === visible) return;
    this.root.setVisible(visible);
    if (visible && !this.pulse) {
      const save = this.scene.registry.get('save');
      const reduced = !!(save && save.data && save.data.settings && save.data.settings.reducedMotion);
      if (!reduced) {
        this.pulse = this.scene.tweens.add({
          targets: this.root, scale: 1.07, duration: 340, yoyo: true,
          repeat: -1, ease: 'Sine.inOut'
        });
      }
    } else if (!visible && this.pulse) {
      this.pulse.stop();
      this.pulse = null;
      this.root.setScale(1);
    }
  }

  destroy() {
    if (this.pulse) this.pulse.stop();
    this.scene.tweens?.killTweensOf(this.root);
    this.root?.destroy();
    this.root = null;
  }
}
