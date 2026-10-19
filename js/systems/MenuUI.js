/**
 * MenuUI — reusable cartoon UI components for the WORD BLAST front end
 * (Fix #21). Purely DECORATIVE rendering helpers, fully decoupled from menu
 * BEHAVIOUR — MenuScene owns navigation and progress logic, this module
 * only draws and animates widgets.
 *
 * Everything is drawn with live Graphics inside Containers (vector redraws
 * at any camera zoom → crisp on desktop, tablet and phone) and needs no
 * binary assets to render: when the official artwork cannot be fetched
 * (headless test environments), ensureMenuArtFallback() generates procedural
 * stand-ins under the SAME texture keys — the project's established
 * fallback pattern (see HudArt.ensureHudArtFallback /
 * QuestionCard.ensureQuestionCardTexture).
 *
 * Visual identity (matches the gameplay HUD and question card):
 * golden wood, warm parchment, dark-brown ink, leaf-green accents,
 * rounded shapes, soft drop shadows, friendly cartoon typography.
 */
import Phaser from 'phaser';

/* ------------------------------------------------------------------ */
/* Asset registry + procedural fallbacks                               */
/* ------------------------------------------------------------------ */

/** The official main-menu artwork (Fix #21 sources, prepared by
 *  scripts/prepare-menu-assets.mjs from the supplied images). */
export const MENU_ART = {
  background: { key: 'menu-bg', file: 'background.webp' },
  logo: { key: 'menu-logo', file: 'logo.webp' },
  playButton: { key: 'menu-play-btn', file: 'play-button.webp' }
};

/** The supplied MENU button artwork for the level-select screen (same
 *  prepare pipeline; loaded by LevelSelectScene under this key). */
export const MENU_BUTTON_ART = { key: 'lvlsel-menu-btn', file: 'assets/images/ui/menu-button.webp' };

/** Loader list for MenuScene.preload (mirrors hudPreloadList). */
export function menuPreloadList() {
  return Object.values(MENU_ART).map(({ key, file }) => ({ key, file }));
}

/** Texture keys currently served by the procedural stand-in art. */
const FALLBACK_KEYS = new Set();

/** True when `key` is the procedural stand-in (official art unreachable). */
export function isFallbackTexture(key) {
  return FALLBACK_KEYS.has(key);
}

/**
 * Procedural stand-ins for the menu artwork (headless tests / offline).
 * Same keys, same aspects — the scene renders identically apart from the
 * art itself, and MenuScene only shows a text title when the LOGO is a
 * stand-in (never on top of the real artwork).
 */
export function ensureMenuArtFallback(scene, key) {
  if (!Object.values(MENU_ART).some((a) => a.key === key)) return;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics();

  if (key === MENU_ART.background.key) {
    // soft sky → meadow landscape, same 1672×941 canvas as the real art
    const W = 1672, H = 941, horizon = Math.round(H * 0.62), bands = 56;
    const skyA = Phaser.Display.Color.ValueToColor(0x8ecae6);
    const skyB = Phaser.Display.Color.ValueToColor(0xd8f3dc);
    for (let i = 0; i < bands; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(skyA, skyB, bands - 1, i);
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      g.fillRect(0, Math.floor((i * horizon) / bands), W, Math.ceil(horizon / bands) + 1);
    }
    g.fillStyle(0x74c69d, 1);
    g.fillRect(0, horizon, W, H - horizon);
    g.fillStyle(0x52b788, 1);
    g.fillRect(0, Math.round(H * 0.8), W, Math.round(H * 0.2));
    g.fillStyle(0xdad7cd, 1);
    g.fillCircle(W * 0.78, H * 0.16, 46);
    g.generateTexture(key, W, H);
  } else if (key === MENU_ART.playButton.key) {
    // wooden plate face, same 1254×1254 canvas as the supplied square art
    // (content ≈ 1194×1048 centred with padding like the real trim)
    const W = 1254, H = 1254;
    g.save();
    g.translateCanvas(W / 2, H / 2); // drawWoodSlab is centred on origin
    drawWoodSlab(g, 1170, 1030, 120, 'primary');
    g.restore();
    g.generateTexture(key, W, H);
  } else {
    // transparent wooden plaque, same 1774×887 aspect as the real logo
    const W = 1774, H = 887;
    g.fillStyle(0x4d3218, 1);
    g.fillRoundedRect(40, 190, W - 80, H - 380, 90);
    g.fillGradientStyle(0xd9a45f, 0xd9a45f, 0xa4682f, 0xa4682f, 1);
    g.fillRoundedRect(56, 206, W - 112, H - 412, 76);
    g.lineStyle(4, 0x4d3218, 1);
    g.strokeRoundedRect(56, 206, W - 112, H - 412, 76);
    g.generateTexture(key, W, H);
  }
  g.destroy();
  FALLBACK_KEYS.add(key);
}

/* ------------------------------------------------------------------ */
/* Shared palette + small drawing helpers                              */
/* ------------------------------------------------------------------ */

export const PALETTE = {
  edge: 0x4d3218,
  woodTop: 0xd9a45f, woodBottom: 0xa4682f, highlight: 0xf2cd8f,
  woodDarkTop: 0x8a5a2b, woodDarkBottom: 0x63401e, highlightDark: 0xb98a55,
  dangerTop: 0xc74a35, dangerBottom: 0x8e2a1c, dangerEdge: 0x531708, dangerHighlight: 0xe2836c,
  parchment: 0xf7e8c9, parchmentLight: 0xf2e0b6, parchmentShade: 0xdfc68f, parchmentEdge: 0x8a5a2b,
  ink: '#3d2814', inkSoft: '#5a4632',
  cream: '#fff3d6', creamStroke: '#4d2e12',
  leaf: 0x4c9a2a, leafDark: 0x2f6b1f,
  gold: 0xffc93c, goldEdge: 0xb8860b,
  green: 0x3f9142, greenDark: 0x2a6b2d
};

const VARIANTS = {
  primary: { top: PALETTE.woodTop, bottom: PALETTE.woodBottom, edge: PALETTE.edge, hi: PALETTE.highlight },
  secondary: { top: PALETTE.woodDarkTop, bottom: PALETTE.woodDarkBottom, edge: 0x3a2812, hi: PALETTE.highlightDark },
  danger: { top: PALETTE.dangerTop, bottom: PALETTE.dangerBottom, edge: PALETTE.dangerEdge, hi: PALETTE.dangerHighlight }
};

/** Crisp text at any zoom: resolution 2 matches the DPR-capped canvas.
 *  `origin` accepts a single value or [ox, oy] (left-aligned rows pass 0). */
export function menuText(scene, x, y, text, style = {}, origin = 0.5) {
  const [ox, oy] = Array.isArray(origin) ? origin : [origin, origin];
  return scene.add.text(x, y, text, style).setOrigin(ox, oy).setResolution(2);
}

/** Wooden slab: warm vertical gradient, carved edge, top light / bottom shade. */
export function drawWoodSlab(g, w, h, r, variant = 'primary') {
  const v = VARIANTS[variant] || VARIANTS.primary;
  g.fillGradientStyle(v.top, v.top, v.bottom, v.bottom, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
  g.lineStyle(4, v.edge, 1);
  g.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, Math.max(4, r - 2));
  g.lineStyle(2.5, v.hi, 0.8);
  g.beginPath();
  g.moveTo(-w / 2 + r + 4, -h / 2 + 7);
  g.lineTo(w / 2 - r - 4, -h / 2 + 7);
  g.strokePath();
  g.lineStyle(2.5, 0x000000, 0.16);
  g.beginPath();
  g.moveTo(-w / 2 + r + 4, h / 2 - 7);
  g.lineTo(w / 2 - r - 4, h / 2 - 7);
  g.strokePath();
}

/** Parchment sheet: cream fill, thin decorative double border, soft base. */
export function drawParchment(g, w, h, r = 14) {
  g.fillStyle(PALETTE.parchmentShade, 1);
  g.fillRoundedRect(-w / 2, -h / 2 + 3, w, h, r);
  g.fillGradientStyle(PALETTE.parchment, PALETTE.parchment, PALETTE.parchmentLight, PALETTE.parchmentLight, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
  g.lineStyle(3, PALETTE.parchmentEdge, 1);
  g.strokeRoundedRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, Math.max(4, r - 1.5));
  g.lineStyle(1, 0xc9a86a, 0.9);
  g.strokeRoundedRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, Math.max(4, r - 6));
}

/** Parchment ribbon banner with darker folded ends (subtitle strip). */
export function drawRibbon(g, w, h) {
  const fold = Math.min(34, h * 0.72);
  const bodyW = w - fold * 2;
  const half = h / 2;
  const P = (x, y) => ({ x, y });
  g.fillStyle(PALETTE.parchmentShade, 1);
  g.fillPoints([
    P(-bodyW / 2, -half + 3), P(-w / 2 + 3, -half + 7), P(-w / 2 + fold * 0.55, 4), P(-w / 2 + 3, half + 1), P(-bodyW / 2, half - 1)
  ], true);
  g.fillPoints([
    P(bodyW / 2, -half + 3), P(w / 2 - 3, -half + 7), P(w / 2 - fold * 0.55, 4), P(w / 2 - 3, half + 1), P(bodyW / 2, half - 1)
  ], true);
  g.fillStyle(0x000000, 0.14);
  g.fillRoundedRect(-bodyW / 2, -half + 4, bodyW, h, 10);
  drawParchment(g, bodyW, h, 10);
}

/** Five-point star (golden star icon). */
export function drawStar(g, cx, cy, outer, fill = PALETTE.gold, stroke = PALETTE.goldEdge, strokeW = 3) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : outer * 0.46;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  g.fillStyle(stroke, 1);
  g.fillPoints(pts.map((p) => ({ x: cx + (p.x - cx) * 1.14, y: cy + (p.y - cy) * 1.14 })), true);
  g.fillStyle(fill, 1);
  g.fillPoints(pts, true);
  if (strokeW > 0) {
    g.lineStyle(strokeW, stroke, 0.55);
    g.strokePoints(pts, true);
  }
}

/** Green circular badge with a white check (progress icon). */
export function drawCheckBadge(g, cx, cy, r) {
  g.fillStyle(0x000000, 0.15);
  g.fillCircle(cx, cy + 2.5, r);
  g.fillStyle(PALETTE.greenDark, 1);
  g.fillCircle(cx, cy, r);
  g.fillStyle(PALETTE.green, 1);
  g.fillCircle(cx, cy, r - 2.5);
  g.lineStyle(r * 0.22, 0xffffff, 1);
  g.beginPath();
  g.moveTo(cx - r * 0.46, cy + r * 0.06);
  g.lineTo(cx - r * 0.1, cy + r * 0.44);
  g.lineTo(cx + r * 0.52, cy - r * 0.36);
  g.strokePath();
}

/** Small decorative leaf. */
export function drawLeaf(g, cx, cy, len, rot = 0) {
  g.save();
  g.translateCanvas(cx, cy);
  g.rotateCanvas(rot);
  g.fillStyle(PALETTE.leafDark, 1);
  g.fillEllipse(1, 1.5, len, len * 0.44);
  g.fillStyle(PALETTE.leaf, 1);
  g.fillEllipse(0, 0, len, len * 0.42);
  g.lineStyle(1.6, PALETTE.leafDark, 0.9);
  g.beginPath();
  g.moveTo(-len * 0.42, 0);
  g.lineTo(len * 0.42, 0);
  g.strokePath();
  g.restore();
}

/**
 * Play triangle with a dark carved edge — cream by default, golden for the
 * main-menu PLAY button (fill/edge overridable).
 */
export function drawPlayIcon(g, cx, cy, size, fill = PALETTE.cream, edge = 0x4d2e12) {
  const h = size, w = size * 0.9;
  const big = [
    { x: cx - w * 0.56, y: cy - h * 0.58 },
    { x: cx + w * 0.6, y: cy },
    { x: cx - w * 0.56, y: cy + h * 0.58 }
  ];
  const small = [
    { x: cx - w * 0.4, y: cy - h * 0.42 },
    { x: cx + w * 0.44, y: cy },
    { x: cx - w * 0.4, y: cy + h * 0.42 }
  ];
  g.fillStyle(edge, 1);
  g.fillPoints(big, true);
  g.fillStyle(fill, 1);
  g.fillPoints(small, true);
}

/** Golden play-icon colors for the menu PLAY button (design tokens). */
export const PLAY_ICON_GOLD = { fill: 0xffd257, edge: 0x7a4c12 };

/** Circular reset arrow. */
export function drawResetIcon(g, cx, cy, r, color = PALETTE.cream, edge = 0x4d2e12) {
  const a0 = -Math.PI * 0.35, a1 = Math.PI * 1.08;
  g.lineStyle(r * 0.52, edge, 1);
  g.beginPath();
  g.arc(cx, cy, r, a0, a1, false);
  g.strokePath();
  g.lineStyle(r * 0.26, color, 1);
  g.beginPath();
  g.arc(cx, cy, r, a0, a1, false);
  g.strokePath();
  // arrowhead at the arc end, pointing along the tangent
  const hx = cx + Math.cos(a1) * r, hy = cy + Math.sin(a1) * r;
  const tang = a1 + Math.PI / 2;
  const ux = Math.cos(tang), uy = Math.sin(tang);
  const px = -uy, py = ux; // perpendicular
  const L = r * 0.62, Wd = r * 0.42;
  g.fillStyle(edge, 1);
  g.fillPoints([
    { x: hx + ux * L * 1.28, y: hy + uy * L * 1.28 },
    { x: hx + px * Wd, y: hy + py * Wd },
    { x: hx - px * Wd, y: hy - py * Wd }
  ], true);
  g.fillStyle(color, 1);
  g.fillPoints([
    { x: hx + ux * L * 0.92, y: hy + uy * L * 0.92 },
    { x: hx + px * Wd * 0.62, y: hy + py * Wd * 0.62 },
    { x: hx - px * Wd * 0.62, y: hy - py * Wd * 0.62 }
  ], true);
}

/* ------------------------------------------------------------------ */
/* WoodButton                                                          */
/* ------------------------------------------------------------------ */

/**
 * Polished wooden game button: soft shadow, wooden face (supplied artwork
 * via `bgTexture` when available, otherwise the procedural gradient slab),
 * carved edges, optional decorative leaves / icon, bold cream label.
 *
 * With `bgTexture` the face keeps the artwork's ASPECT: the button's height
 * follows width / artAspect (pass no explicit height), the art is scaled
 * uniformly (never stretched, never cropped) and is itself drawn at full
 * source resolution — if the source is smaller than the button's device
 * pixel size it is smoothly upscaled by the GPU (painted art tolerates the
 * mild resample). Headless environments fall back to the procedural slab
 * under the same texture key.
 *
 * Interaction: hover = brightness + slight grow (hand cursor), press =
 * scale compression, release-inside = click. setEnabled(false) silences
 * input and dims the label (popup / transition guards).
 *
 * All coordinates are world-space; the button never moves once placed.
 */
export class WoodButton {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} o
   * @param {number} o.x o.y o.width [o.height]
   * @param {string} o.label
   * @param {'primary'|'secondary'|'danger'} [o.variant]
   * @param {'play'|'reset'|null} [o.icon]
   * @param {{fill:number,edge:number}} [o.iconColors] icon fill/edge override
   * @param {() => void} [o.onClick]
   * @param {boolean} [o.leaves]     decorative corner leaves (primary look)
   * @param {boolean} [o.shine]      periodic light sweep (decorative)
   * @param {string|null} [bgTexture] artwork face key (e.g. the supplied
   *                                  wooden bar element for PLAY)
   */
  constructor(scene, o) {
    const {
      x = 0, y = 0, width = 300, height = null, label = '',
      variant = 'primary', icon = null, iconColors = null, onClick = null,
      leaves = false, shine = false, fontSize = null, bgTexture = null
    } = o;
    this.scene = scene;

    // artwork face: height follows the art's aspect when not forced
    let useArt = false, artScale = 1;
    if (bgTexture && scene.textures.exists(bgTexture)) {
      const src = scene.textures.get(bgTexture).getSourceImage();
      const h = height || Math.round(width * (src.height / src.width));
      this.height = h;
      artScale = width / src.width;
      useArt = true;
    } else {
      this.height = height || 92;
    }
    const btnH = this.height;
    this.width = width;
    this.enabled = true;
    this._hover = false;
    this._onClick = onClick;

    const r = Math.min(width, btnH) * 0.34;
    const c = scene.add.container(x, y);
    this.container = c;

    // soft drop shadow (two stacked passes)
    const gShadow = scene.add.graphics();
    gShadow.fillStyle(0x000000, 0.10);
    gShadow.fillRoundedRect(-width / 2 - 3, -btnH / 2 + 8, width + 6, btnH + 3, r + 4);
    gShadow.fillStyle(0x000000, 0.22);
    gShadow.fillRoundedRect(-width / 2, -btnH / 2 + 5, width, btnH, r);

    // face: supplied artwork (aspect preserved) or procedural slab
    let face;
    if (useArt) {
      face = scene.add.image(0, 0, bgTexture).setScale(artScale);
    } else {
      face = scene.add.graphics();
      drawWoodSlab(face, width, btnH, r, variant);
    }

    // hover brightness overlay (faded in/out)
    const gHover = scene.add.graphics();
    gHover.fillStyle(0xffffff, 1);
    gHover.fillRoundedRect(-width / 2 + 3, -btnH / 2 + 3, width - 6, btnH - 6, Math.max(4, r - 3));
    gHover.setAlpha(0);
    this._gHover = gHover;

    c.add([gShadow, face, gHover]);

    if (leaves) {
      const gl = scene.add.graphics();
      drawLeaf(gl, -width / 2 + 10, -btnH / 2 + 4, 30, -0.5);
      drawLeaf(gl, width / 2 - 10, -btnH / 2 + 4, 30, 0.5);
      drawLeaf(gl, -width / 2 + 26, btnH / 2 - 2, 22, 0.6);
      drawLeaf(gl, width / 2 - 26, btnH / 2 - 2, 22, -0.6);
      c.add(gl);
    }

    // icon + label, centred as one group (auto-shrink keeps long labels
    // inside the slab instead of riding over the rounded edges)
    const style = {
      fontFamily: '"Arial Black", "Segoe UI Black", Arial, sans-serif',
      fontStyle: 'bold',
      fontSize: fontSize || (variant === 'primary' ? Math.round(btnH * 0.44) + 'px' : '23px'),
      color: PALETTE.cream,
      stroke: PALETTE.creamStroke,
      strokeThickness: variant === 'primary' ? 6 : 4
    };
    const text = menuText(scene, 0, 2, label, style);
    const iconSize = variant === 'primary' ? btnH * 0.4 : 24;
    const gap = icon ? iconSize * 0.5 : 0;
    const minPad = 22;
    let groupScale = 1;
    const totalW = (icon ? iconSize + gap : 0) + text.width;
    if (totalW > width - minPad * 2) groupScale = (width - minPad * 2) / totalW;
    const scaledTotal = totalW * groupScale;
    const textX = icon ? -scaledTotal / 2 + (iconSize + gap) * groupScale + (text.width * groupScale) / 2 : 0;
    text.setX(textX);
    if (groupScale !== 1) text.setScale(groupScale);
    c.add(text);
    this.label = text;

    if (icon === 'play') {
      const gi = scene.add.graphics();
      const icx = -scaledTotal / 2 + (iconSize * groupScale) / 2;
      const icy = 2;
      drawPlayIcon(gi, icx, icy, iconSize * groupScale,
        iconColors ? iconColors.fill : PALETTE.cream,
        iconColors ? iconColors.edge : 0x4d2e12);
      c.add(gi);
    } else if (icon === 'reset') {
      const gi = scene.add.graphics();
      const icx = -scaledTotal / 2 + (iconSize * groupScale) / 2;
      const icy = 2;
      drawResetIcon(gi, icx, icy, iconSize * groupScale * 0.52);
      c.add(gi);
    }

    if (shine) this._addShine();

    c.setSize(width, btnH);
    // NOTE: containers hardcode origin 0.5, and InputManager.pointWithinHitArea
    // shifts the local point by +displayOrigin before testing — so a
    // container hit area must be in TOP-LEFT space (0,0,w,h), not centered.
    c.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, width, btnH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true
    });
    c.on('pointerover', () => this._setHover(true));
    c.on('pointerout', () => this._setHover(false));
    c.on('pointerdown', () => this._setPress(true));
    c.on('pointerup', () => {
      this._setPress(false);
      if (this.enabled && this._onClick) this._onClick();
    });
  }

  /**
   * Periodic light sweep (decorative): a small additive glint glides along
   * the slab's top edge, its path CLAMPED to the button bounds — no mask
   * needed (a GeometryMask source must stay off the display list; a live
   * graphics inside the container would render as a white slab on top of
   * the button, which is exactly what Fix #21's visual pass caught).
   */
  _addShine() {
    const { width: w, height: h } = this;
    const glint = this.scene.add.image(-w / 2 + 20, -h / 2 + h * 0.28, 'p-spark')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff8dc)
      .setScale(0.85)
      .setAlpha(0.8);
    this.container.add(glint);
    this.scene.tweens.add({
      targets: glint,
      x: w / 2 - 20,
      duration: 950,
      ease: 'Sine.easeInOut',
      repeat: -1,
      repeatDelay: 2500,
      onRepeat: () => glint.setX(-w / 2 + 20)
    });
  }

  _scaleTo(s, duration = 110) {
    this.scene.tweens.add({
      targets: this.container, scale: s, duration, ease: 'Sine.easeOut',
      overwrite: true
    });
  }

  _setHover(on) {
    if (!this.enabled) on = false;
    this._hover = on;
    this._scaleTo(on ? 1.05 : 1);
    this.scene.tweens.add({
      targets: this._gHover, alpha: on ? 0.13 : 0, duration: 130,
      overwrite: true
    });
  }

  _setPress(on) {
    if (!this.enabled) on = false;
    this._scaleTo(on ? 0.94 : this._hover ? 1.05 : 1, 90);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.container.setAlpha(enabled ? 1 : 0.75);
    if (!enabled) {
      this._hover = false;
      this.scene.tweens.add({ targets: this._gHover, alpha: 0, duration: 90, overwrite: true });
      this.container.disableInteractive();
    } else {
      this.container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(0, 0, this.width, this.height),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true
      });
    }
  }

  /** Brief celebratory pop (progress changed, etc.). */
  pulse(strength = 0.08) {
    this.scene.tweens.add({
      targets: this.container,
      scale: { from: 1, to: 1 + strength },
      duration: 130, yoyo: true, ease: 'Sine.easeInOut'
    });
  }

  destroy() {
    this.container.destroy();
  }
}

/* ------------------------------------------------------------------ */
/* ConfirmDialog                                                       */
/* ------------------------------------------------------------------ */

/**
 * Polished confirmation popup: dim scrim that swallows input, wooden
 * framed parchment card, warning badge, title/body, CANCEL + action
 * buttons. Purely presentational — the caller decides what the confirm
 * action does (MenuScene: SaveManager.reset()).
 */
export class ConfirmDialog {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} o
   * @param {{x:number,y:number,width:number,height:number}} o.view visible view (scrim)
   * @param {string} [o.title]
   * @param {string} [o.body]
   * @param {string} [o.confirmLabel]
   * @param {string} [o.cancelLabel]
   * @param {() => void} [o.onConfirm]
   * @param {() => void} [o.onCancel]
   * @param {boolean} [o.reducedMotion]
   */
  constructor(scene, o) {
    const {
      view, title = 'Are you sure?', body = '',
      confirmLabel = 'CONFIRM', cancelLabel = 'CANCEL',
      onConfirm = null, onCancel = null, reducedMotion = false
    } = o;
    this.scene = scene;
    this.closing = false;

    const root = scene.add.container(0, 0).setDepth(200);
    this.root = root;

    const scrim = scene.add.rectangle(
      view.x + view.width / 2, view.y + view.height / 2,
      view.width, view.height, 0x06120a, 0.55
    ).setInteractive(); // swallows clicks behind the dialog
    this.scrim = scrim;
    root.add(scrim);

    const W = 640, H = 340;
    const panel = scene.add.container(WORLD_CENTER_X(), 350);
    this.panel = panel;

    const frame = scene.add.graphics();
    frame.fillStyle(0x000000, 0.25);
    frame.fillRoundedRect(-W / 2, -H / 2 + 8, W, H, 26);
    drawWoodSlab(frame, W, H, 26, 'secondary');
    const inner = scene.add.graphics();
    drawParchment(inner, W - 48, H - 52, 18);
    panel.add([frame, inner]);

    // warning badge straddling the frame's top edge
    const badge = scene.add.graphics();
    badge.fillStyle(0x531708, 1);
    badge.fillCircle(0, -H / 2 + 2, 33);
    badge.fillStyle(PALETTE.dangerTop, 1);
    badge.fillCircle(0, -H / 2, 31);
    badge.lineStyle(3, 0xffffff, 0.5);
    badge.strokeCircle(0, -H / 2, 27);
    panel.add(badge);
    panel.add(menuText(scene, 0, -H / 2 + 2, '!', {
      fontFamily: '"Arial Black", Arial, sans-serif', fontSize: '40px', color: '#ffffff'
    }));

    panel.add(menuText(scene, 0, -H / 2 + 62, title, {
      fontFamily: '"Arial Black", Arial, sans-serif', fontSize: '34px', color: PALETTE.ink
    }));
    panel.add(menuText(scene, 0, -H / 2 + 116, body, {
      fontFamily: 'Arial, sans-serif', fontSize: '21px', fontStyle: 'bold',
      color: PALETTE.inkSoft, align: 'center', wordWrap: { width: W - 130 }, lineSpacing: 7
    }));

    this.cancelBtn = new WoodButton(scene, {
      x: -165, y: H / 2 - 62, width: 190, height: 58,
      label: cancelLabel, variant: 'secondary', onClick: () => this._act(onCancel)
    });
    this.confirmBtn = new WoodButton(scene, {
      x: 160, y: H / 2 - 62, width: 300, height: 58,
      label: confirmLabel, variant: 'danger', icon: 'reset',
      fontSize: '21px', onClick: () => this._act(onConfirm)
    });
    panel.add(this.cancelBtn.container);
    panel.add(this.confirmBtn.container);
    root.add(panel);

    // Esc cancels (desktop nicety)
    const kb = scene.input.keyboard;
    if (kb) {
      this._esc = () => { if (!this.closing) this._act(onCancel); };
      kb.once('keydown-ESC', this._esc);
    }

    if (reducedMotion) {
      scrim.setAlpha(1);
    } else {
      scrim.setAlpha(0);
      scene.tweens.add({ targets: scrim, alpha: 1, duration: 150 });
      panel.setScale(0.85).setAlpha(0);
      scene.tweens.add({
        targets: panel, scale: 1, alpha: 1, duration: 210, ease: 'Back.easeOut'
      });
    }
  }

  _act(cb) {
    if (this.closing) return;
    this.closing = true;
    this.scene.registry.get('audio')?.emit('ui-click'); // Fix #22 — dialog click
    if (this._esc && this.scene.input.keyboard) this.scene.input.keyboard.off('keydown-ESC', this._esc);
    if (cb) cb();
  }

  /** Re-fit the scrim after a viewport resize while the dialog is open. */
  fitView(view) {
    this.scrim.setPosition(view.x + view.width / 2, view.y + view.height / 2);
    this.scrim.setSize(view.width, view.height);
  }

  /** Animate out, destroy, then invoke `done`. */
  close(done) {
    const finish = () => {
      this.root.destroy();
      if (done) done();
    };
    this.closing = true;
    if (this._esc && this.scene.input.keyboard) {
      this.scene.input.keyboard.off('keydown-ESC', this._esc);
    }
    this.scene.tweens.add({
      targets: [this.scrim, this.panel], alpha: 0, duration: 140,
      onComplete: finish
    });
  }
}

/** World centre X of the fixed 1280×720 logical world. */
function WORLD_CENTER_X() { return 640; }
