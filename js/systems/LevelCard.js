/**
 * LevelCard — the reusable wooden level-selection card (Fix #23).
 *
 * One component renders every card state from live data (never hardcoded
 * per level):
 *   unlocked  — wooden frame + warm parchment, LEVEL kicker, big number,
 *               level name (word-wrapped), 0–3 earned golden stars,
 *               hover brighten/grow, press compress;
 *   locked    — same wooden card, slightly dimmed/desaturated, a metallic
 *               padlock centred on the parchment, gentle shake on tap;
 *   highlighted (next playable) — soft golden glow ring behind the frame
 *               with a slow, restrained pulse.
 *
 * All decorative artwork (frame, padlock, stars, glow) is painted ONCE
 * per game into cached textures (ensureLevelCardTextures) at 3 texture px
 * per world px — crisp up to DPR 2 × camera zoom ~1.3 — and reused by all
 * 15 cards; dynamic content (number, name, stars, lock) is a separate
 * game object per card, exactly like the HUD/question-card pattern.
 *
 * Interaction contract mirrors MenuUI.WoodButton: containers hardcode
 * origin 0.5 while the input hit test shifts by +displayOrigin, so the
 * hit area is a TOP-LEFT-space rectangle.
 */
import Phaser from 'phaser';
import { menuText, drawParchment, drawLeaf, drawStar } from './MenuUI.js';

/** Cached texture keys (game-wide; generated once by the first visit). */
export const CARD_ART = {
  frame: 'lvlsel-card-frame',
  lock: 'lvlsel-lock',
  star: 'lvlsel-star',
  starEmpty: 'lvlsel-star-empty',
  glow: 'lvlsel-card-glow'
};

/** texture px per world px */
const S = 3;

/** World-space design size of the card art (grid cards scale to fit). */
export const CARD_DESIGN = { w: 213, h: 143, shadowPad: 12 };

/**
 * y-origin that maps the FRAME region's centre (not the padded canvas
 * centre) onto the display origin, so text/star children align with the
 * card box while the baked shadow still hangs below it.
 */
const FRAME_ORIGIN_Y = (CARD_DESIGN.h / 2) / (CARD_DESIGN.h + CARD_DESIGN.shadowPad);

/* ------------------------------------------------------------------ */
/* Texture painters (run once, cached game-wide)                       */
/* ------------------------------------------------------------------ */

/**
 * Generate every level-card texture if missing. Idempotent — safe on scene
 * restarts; the keys survive scene shutdowns by design (decorative cache).
 */
export function ensureLevelCardTextures(scene) {
  if (!scene.textures.exists(CARD_ART.frame)) paintCardFrame(scene);
  if (!scene.textures.exists(CARD_ART.lock)) paintLock(scene);
  if (!scene.textures.exists(CARD_ART.star) || !scene.textures.exists(CARD_ART.starEmpty)) paintStars(scene);
  if (!scene.textures.exists(CARD_ART.glow)) paintGlow(scene);
}

/** Metal bolt shared by the card frame corners and the title sign. */
export function paintBolt(g, x, y, r) {
  g.fillStyle(0x000000, 0.25);
  g.fillCircle(x + 2, y + 3, r);
  g.fillStyle(0x39414b, 1);
  g.fillCircle(x, y, r);
  g.fillStyle(0x9aa5b1, 1);
  g.fillCircle(x, y, r - 4);
  g.fillStyle(0xcdd5dd, 1);
  g.fillCircle(x - r * 0.22, y - r * 0.24, r * 0.42);
  g.lineStyle(3, 0x2b323a, 0.8);
  g.strokeCircle(x, y, r - 1.5);
}

/**
 * Wooden card frame with parchment centre, baked soft shadow, wood grain,
 * corner bolts and decorative leaves on the top/bottom edges (the level-
 * select reference look).
 */
function paintCardFrame(scene) {
  const W = CARD_DESIGN.w * S;
  const H = CARD_DESIGN.h * S;
  const P = CARD_DESIGN.shadowPad * S;
  const r = Math.round(W * 0.063);
  const g = scene.add.graphics();

  // soft ground shadow (two stacked passes)
  g.fillStyle(0x000000, 0.10);
  g.fillRoundedRect(-6, 15, W + 12, H, r + 8);
  g.fillStyle(0x000000, 0.20);
  g.fillRoundedRect(0, 8, W, H, r + 4);

  // wooden frame slab (warm vertical gradient like the menu/HUD wood)
  g.fillGradientStyle(0xd9a45f, 0xd9a45f, 0xa4682f, 0xa4682f, 1);
  g.fillRoundedRect(0, 0, W, H, r);
  // subtle plank grain — parchment covers the middle, so it only reads on
  // the frame band
  g.lineStyle(3, 0x7a4c1e, 0.16);
  for (const gy of [Math.round(H * 0.09), Math.round(H * 0.16), Math.round(H * 0.84), Math.round(H * 0.91)]) {
    g.beginPath();
    g.moveTo(24, gy);
    g.lineTo(W - 24, gy);
    g.strokePath();
  }
  // carved edge + light/shade lines
  g.lineStyle(11, 0x4d3218, 1);
  g.strokeRoundedRect(5.5, 5.5, W - 11, H - 11, r - 6);
  g.lineStyle(6, 0xf2cd8f, 0.75);
  g.beginPath();
  g.moveTo(r + 8, 17);
  g.lineTo(W - r - 8, 17);
  g.strokePath();
  g.lineStyle(6, 0x000000, 0.18);
  g.beginPath();
  g.moveTo(r + 8, H - 13);
  g.lineTo(W - r - 8, H - 13);
  g.strokePath();

  // warm parchment centre (recessed writing surface)
  g.save();
  g.translateCanvas(W / 2, H / 2);
  drawParchment(g, W - 80, H - 80, 26);
  g.restore();

  // metal bolts on the four corners of the frame band
  const b = 38;
  paintBolt(g, b, b, 19);
  paintBolt(g, W - b, b, 19);
  paintBolt(g, b, H - b, 19);
  paintBolt(g, W - b, H - b, 19);

  // decorative leaves fanned over the top and bottom edges (centred)
  drawLeaf(g, W / 2, 8, 46, -Math.PI / 2 - 0.5);
  drawLeaf(g, W / 2, 10, 56, -Math.PI / 2);
  drawLeaf(g, W / 2, 8, 46, -Math.PI / 2 + 0.5);
  drawLeaf(g, W / 2, H - 8, 46, Math.PI / 2 - 0.5);
  drawLeaf(g, W / 2, H - 10, 56, Math.PI / 2);
  drawLeaf(g, W / 2, H - 8, 46, Math.PI / 2 + 0.5);

  g.generateTexture(CARD_ART.frame, W, H + P);
  g.destroy();
}

/**
 * Illustrated metallic padlock (silver/steel body, curved shackle, keyhole,
 * baked ground shadow) — centred content, symmetric canvas.
 */
function paintLock(scene) {
  const W = 144, H = 222, cx = W / 2;
  const g = scene.add.graphics();

  // soft shadow the lock casts on the parchment
  g.fillStyle(0x000000, 0.20);
  g.fillEllipse(cx, 198, 100, 26);

  // shackle (three passes: dark rim, steel core, bright edge)
  const strokes = [
    { w: 27, c: 0x454e58, a: 1 },
    { w: 15, c: 0x8f99a4, a: 1 },
    { w: 5, c: 0xdde3ea, a: 0.9 }
  ];
  for (const s of strokes) {
    g.lineStyle(s.w, s.c, s.a);
    g.beginPath();
    g.arc(cx, 66, 36, Math.PI, Math.PI * 2, false);
    g.strokePath();
  }

  // body
  g.fillStyle(0x000000, 0.25);
  g.fillRoundedRect(26, 70, 92, 86, 18);
  g.fillGradientStyle(0xd9e0e8, 0xd9e0e8, 0x8b95a1, 0x8b95a1, 1);
  g.fillRoundedRect(26, 66, 92, 86, 18);
  g.lineStyle(6, 0x39414b, 1);
  g.strokeRoundedRect(29, 69, 86, 80, 15);
  g.lineStyle(4, 0xf2f6fa, 0.8);
  g.beginPath();
  g.moveTo(42, 78);
  g.lineTo(W - 42, 78);
  g.strokePath();
  // bottom lip plate
  g.fillStyle(0x6f7986, 1);
  g.fillRoundedRect(38, 128, 68, 16, 8);
  // keyhole
  g.fillStyle(0x23292f, 1);
  g.fillCircle(cx, 103, 11);
  g.fillRoundedRect(cx - 4, 105, 8, 22, 4);
  // specular glints
  g.fillStyle(0xffffff, 0.5);
  g.fillEllipse(50, 84, 20, 8);
  g.fillEllipse(86, 122, 12, 6);

  g.generateTexture(CARD_ART.lock, W, H);
  g.destroy();
}

/** Golden earned star + dark unearned star (one canvas each). */
function paintStars(scene) {
  const g = scene.add.graphics();
  drawStar(g, 39, 41, 31, 0xffc93c, 0xb8860b, 3);
  g.generateTexture(CARD_ART.star, 78, 78);
  g.clear();
  drawStar(g, 39, 41, 31, 0x857c6c, 0x565045, 3.5);
  g.generateTexture(CARD_ART.starEmpty, 78, 78);
  g.destroy();
}

/**
 * Soft golden glow ring for the highlighted (next playable) card: a CRISP
 * warm-gold border hugging the card edge plus a short tight halo — bright
 * enough to guide, never muddy. Rendered with ADD blend behind the frame
 * (the opaque card covers the canvas centre, so only the outer ring and
 * halo read). Glow canvas = card + 56 world px margins (card edge sits at
 * 84 texture px inset).
 */
function paintGlow(scene) {
  const W = 269 * S, H = 199 * S;
  const g = scene.add.graphics();
  // faint wash that survives around the card edges
  g.fillStyle(0xffd257, 0.05);
  g.fillRoundedRect(8, 8, W - 16, H - 16, 124);
  // tight halo just outside the card edge
  g.lineStyle(30, 0xffc93c, 0.14);
  g.strokeRoundedRect(69, 69, W - 138, H - 138, 100);
  // crisp golden border straddling the card edge (outer half visible)
  g.lineStyle(15, 0xffe08a, 0.95);
  g.strokeRoundedRect(76, 76, W - 152, H - 152, 96);
  g.lineStyle(4, 0xfff3c0, 0.9);
  g.strokeRoundedRect(64, 64, W - 128, H - 128, 104);
  g.generateTexture(CARD_ART.glow, W, H);
  g.destroy();
}

/* ------------------------------------------------------------------ */
/* LevelCard                                                           */
/* ------------------------------------------------------------------ */

export class LevelCard {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} o
   * @param {number} o.x o.y o.width o.height
   * @param {number} o.levelId
   * @param {string} o.levelName      from LevelManager (never hardcoded)
   * @param {number} o.stars          saved best rating 0–3
   * @param {boolean} o.unlocked      from SaveManager
   * @param {boolean} [o.highlighted] golden next-playable glow
   * @param {boolean} [o.reducedMotion]
   * @param {(card:LevelCard)=>void} [o.onSelect]      unlocked tap
   * @param {(card:LevelCard)=>void} [o.onLockedTap]   locked tap feedback
   */
  constructor(scene, o) {
    const {
      x = 0, y = 0, width = CARD_DESIGN.w, height = CARD_DESIGN.h,
      levelId = 1, levelName = '', stars = 0, unlocked = true,
      highlighted = false, reducedMotion = false,
      onSelect = null, onLockedTap = null
    } = o;
    this.scene = scene;
    this.levelId = levelId;
    this.stars = stars;
    this.unlocked = unlocked;
    this.highlighted = false;
    this.width = width;
    this.height = height;
    this.reducedMotion = reducedMotion;
    this._onSelect = onSelect;
    this._onLockedTap = onLockedTap;
    this._hover = false;
    this._baseBright = 0;
    this._pulseTween = null;
    this._shaking = false;

    const c = scene.add.container(x, y);
    this.container = c;

    // golden highlight glow (behind the frame)
    this.glow = scene.add.image(0, 0, CARD_ART.glow)
      .setDisplaySize(width + 56, height + 56)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
    c.add(this.glow);

    // wooden frame — uniform scale by width (aspect preserved, never
    // stretched); origin y maps the frame region centre onto the origin
    const src = scene.textures.get(CARD_ART.frame).getSourceImage();
    this.frame = scene.add.image(0, 0, CARD_ART.frame)
      .setOrigin(0.5, FRAME_ORIGIN_Y)
      .setScale(width / src.width);
    c.add(this.frame);

    // hover/brightness overlay (white, faded by state)
    this.hoverGlow = scene.add.graphics();
    this.hoverGlow.fillStyle(0xffffff, 1);
    this.hoverGlow.fillRoundedRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10, 20);
    this.hoverGlow.setAlpha(0);
    c.add(this.hoverGlow);

    // dynamic content — unlocked look
    this.kicker = menuText(scene, 0, -height * 0.35, 'LEVEL', {
      fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
      fontSize: Math.round(height * 0.095) + 'px', color: '#7a4c1f', letterSpacing: 2.5
    });
    this.number = menuText(scene, 0, -height * 0.125, String(levelId), {
      fontFamily: '"Arial Black", "Segoe UI Black", Arial, sans-serif', fontStyle: 'bold',
      fontSize: Math.round(height * 0.33) + 'px', color: '#fff8e7',
      stroke: '#5b3a13', strokeThickness: Math.max(5, Math.round(height * 0.04))
    }).setResolution(3);
    this.name = menuText(scene, 0, height * 0.15, levelName, {
      fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
      fontSize: Math.round(height * 0.095) + 'px', color: '#3d2814',
      align: 'center', wordWrap: { width: width - 36 }
    });
    const starSize = height * 0.20;
    const step = starSize * 1.15;
    this.starsRow = [-1, 0, 1].map((i, idx) =>
      scene.add.image(i * step, height * 0.325, idx < stars ? CARD_ART.star : CARD_ART.starEmpty)
        .setDisplaySize(starSize, starSize)
    );
    c.add([this.kicker, this.number, this.name, ...this.starsRow]);

    // locked look — big metallic padlock + clear dimming overlay
    const lockH = height * 0.62;
    this.lock = scene.add.image(0, -height * 0.03, CARD_ART.lock)
      .setDisplaySize(lockH * (144 / 222), lockH);
    this.dim = scene.add.graphics();
    this.dim.fillStyle(0x241a10, 0.34);
    this.dim.fillRoundedRect(-width / 2 + 4, -height / 2 + 4, width - 8, height - 8, 22);
    c.add([this.dim, this.lock]);

    this.applyLook(unlocked);
    this.setHighlighted(highlighted);

    // interaction (top-left hit area — container input convention)
    c.setSize(width, height);
    c.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: unlocked
    });
    c.on('pointerover', () => this.setHover(true));
    c.on('pointerout', () => this.setHover(false));
    c.on('pointerdown', () => this.setPressed(true));
    c.on('pointerup', () => {
      this.setPressed(false);
      if (this.unlocked) {
        if (this._onSelect) this._onSelect(this);
      } else if (this._onLockedTap) {
        this._onLockedTap(this);
      }
    });
  }

  /* ---------------- state / looks ---------------- */

  /** Swap the card's visible content between locked and unlocked looks. */
  applyLook(unlocked) {
    this.unlocked = unlocked;
    const u = unlocked;
    this.kicker.setVisible(u);
    this.number.setVisible(u);
    this.name.setVisible(u);
    this.starsRow.forEach((s) => s.setVisible(u));
    this.lock.setVisible(!u);
    this.dim.setVisible(!u);
    this.frame.setTint(u ? 0xffffff : 0xcfc6b8); // locked wood reads muted
  }

  /** Called by the unlock celebration (or instantly on first paint). */
  revealUnlocked(instant = false) {
    if (instant) {
      this.applyLook(true);
      return;
    }
    this.applyLook(true);
    this.scene.tweens.add({
      targets: this.container, scale: { from: 0.92, to: 1 },
      duration: 260, ease: 'Back.easeOut', overwrite: true
    });
  }

  /** Golden next-playable highlight with a slow, restrained pulse. */
  setHighlighted(on) {
    this.highlighted = on;
    this._baseBright = on ? 0.05 : 0;
    this._refreshBrightness();
    if (this._pulseTween) {
      this._pulseTween.remove();
      this._pulseTween = null;
    }
    if (!on) {
      this.glow.setAlpha(0);
      return;
    }
    if (this.reducedMotion) {
      this.glow.setAlpha(0.8); // static glow, no pulsing
      return;
    }
    this.glow.setAlpha(0.85);
    this._pulseTween = this.scene.tweens.add({
      targets: this.glow, alpha: { from: 0.72, to: 1 },
      duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
  }

  setHover(on) {
    if (!this.unlocked) return;
    this._hover = on;
    this._refreshBrightness();
    if (!this.reducedMotion) {
      this.scene.tweens.add({
        targets: this.container, scale: on ? 1.045 : 1,
        duration: 110, ease: 'Sine.easeOut', overwrite: true
      });
    }
  }

  setPressed(on) {
    const target = on ? (this.unlocked ? 0.95 : 0.97) : this._hover ? 1.045 : 1;
    this.scene.tweens.add({
      targets: this.container, scale: target,
      duration: 90, ease: 'Sine.easeOut', overwrite: true
    });
  }

  _refreshBrightness() {
    const a = this._baseBright + (this._hover && this.unlocked ? 0.09 : 0);
    this.scene.tweens.add({
      targets: this.hoverGlow, alpha: a, duration: 120, overwrite: true
    });
  }

  /** Gentle restrained shake + lock wobble (locked-tap feedback). */
  shakeLocked() {
    if (this._shaking) return;
    this._shaking = true;
    const baseX = this.container.x;
    this.scene.tweens.add({
      targets: this.container, x: baseX + 8, duration: 48, yoyo: true,
      repeat: 3, ease: 'Sine.easeInOut',
      onComplete: () => {
        this.container.x = baseX;
        this._shaking = false;
      }
    });
    if (this.lock.visible) {
      this.scene.tweens.add({
        targets: this.lock, angle: { from: -9, to: 9 }, duration: 70,
        yoyo: true, repeat: 2, ease: 'Sine.easeInOut',
        onComplete: () => this.lock.setAngle(0)
      });
    }
  }

  /** Enable/disable input (popup / transition / pre-reveal guards). */
  setInteractionEnabled(on) {
    if (on) {
      this.container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, this.width, this.height),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: this.unlocked
      });
    } else {
      this.container.disableInteractive();
    }
  }

  /** Debug/test snapshot. */
  info() {
    return {
      id: this.levelId,
      x: Math.round(this.container.x),
      y: Math.round(this.container.y),
      unlocked: this.unlocked,
      stars: this.stars,
      highlighted: this.highlighted
    };
  }

  destroy() {
    if (this._pulseTween) this._pulseTween.remove();
    this.container.destroy();
  }
}
