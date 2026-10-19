/**
 * LevelSelectBackground — the fantasy scenery behind the level cards
 * (Fix #23).
 *
 * The screen integrates the game's OFFICIAL fantasy landscape — the same
 * art family as the main menu (bright sky, snowy mountains, waterfalls,
 * the cliff village, the lake, grass/flowers and the painted red bird
 * lower-left) — as a CLEAN asset: no level buttons, numbers, locks or
 * headings are baked into it; every interactive element is a separate
 * Phaser object owned by LevelSelectScene.
 *
 * The cover-fit keeps the art's aspect (never stretched, never tiled)
 * and biases crops so the painted red bird survives on every aspect
 * ratio, exactly like MenuScene.fitBackground. A soft warm haze behind
 * the card grid adds subtle atmospheric separation from the scenery
 * WITHOUT darkening the scene.
 *
 * Headless environments (no binary fetch): ensureLevelSelectArtFallback
 * paints a procedural sky→mountains→meadow stand-in under the SAME key —
 * the project's established fallback pattern.
 */
import Phaser from 'phaser';

/** Official artwork for this screen (served from the menu art folder —
 *  one shared, UI-free landscape asset for the game's front end). */
export const LEVEL_SELECT_ART = {
  background: { key: 'lvlsel-bg', file: 'background.webp' }
};

/** Loader list for LevelSelectScene.preload. */
export function levelSelectPreloadList() {
  return Object.values(LEVEL_SELECT_ART).map(({ key, file }) => ({ key, file }));
}

/** Texture keys currently served by the procedural stand-in art. */
const FALLBACK_KEYS = new Set();

/** True when `key` is the procedural stand-in (official art unreachable). */
export function isLevelSelectFallbackTexture(key) {
  return FALLBACK_KEYS.has(key);
}

/**
 * Procedural stand-in for the landscape (headless tests / offline): same
 * 1672×941 canvas as the official art, sky gradient, sun, clouds, snowy
 * mountains, meadow and a lake — enough for layout/contrast verification.
 */
export function ensureLevelSelectArtFallback(scene, key) {
  if (key !== LEVEL_SELECT_ART.background.key || scene.textures.exists(key)) return;
  const g = scene.add.graphics();
  const W = 1672, H = 941, horizon = Math.round(H * 0.62);

  const skyA = Phaser.Display.Color.ValueToColor(0x7ec8e3);
  const skyB = Phaser.Display.Color.ValueToColor(0xe8f6ef);
  const bands = 56;
  for (let i = 0; i < bands; i++) {
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(skyA, skyB, bands - 1, i);
    g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
    g.fillRect(0, Math.floor((i * horizon) / bands), W, Math.ceil(horizon / bands) + 1);
  }
  // sun + soft halo
  g.fillStyle(0xfff3c0, 0.5);
  g.fillCircle(W * 0.82, H * 0.12, 92);
  g.fillStyle(0xfff8dc, 0.95);
  g.fillCircle(W * 0.82, H * 0.12, 58);
  // clouds
  g.fillStyle(0xffffff, 0.92);
  for (const [cx, cy, s] of [[0.16, 0.12, 1], [0.4, 0.08, 0.7], [0.66, 0.16, 0.85], [0.3, 0.24, 0.5]]) {
    g.fillEllipse(W * cx, H * cy, 210 * s, 64 * s);
    g.fillEllipse(W * cx + 90 * s, H * cy + 10, 150 * s, 48 * s);
    g.fillEllipse(W * cx - 95 * s, H * cy + 12, 130 * s, 42 * s);
  }
  // snowy mountains
  for (const [mx, mh, mw] of [[0.26, 0.30, 470], [0.62, 0.26, 380], [0.84, 0.34, 520], [0.05, 0.2, 300]]) {
    const base = horizon + 20;
    g.fillStyle(0x7a8b6f, 1);
    g.fillTriangle(W * mx - mw / 2, base, W * mx + mw / 2, base, W * mx, base - H * mh);
    g.fillStyle(0xe9efe4, 1);
    const peak = base - H * mh;
    g.fillTriangle(W * mx - mw * 0.16, base - H * mh * 0.68, W * mx + mw * 0.16, base - H * mh * 0.68, W * mx, peak);
  }
  // meadow bands
  g.fillStyle(0x74c69d, 1);
  g.fillRect(0, horizon, W, H - horizon);
  g.fillStyle(0x52b788, 1);
  g.fillRect(0, Math.round(H * 0.8), W, Math.round(H * 0.2));
  // lake
  g.fillStyle(0x6fb7d9, 1);
  g.fillEllipse(W * 0.72, H * 0.87, 560, 130);
  g.fillStyle(0x9bd3ea, 0.7);
  g.fillEllipse(W * 0.72, H * 0.865, 430, 74);

  g.generateTexture(key, W, H);
  g.destroy();
  FALLBACK_KEYS.add(key);
}

/* ------------------------------------------------------------------ */
/* Background game object                                              */
/* ------------------------------------------------------------------ */

export class LevelSelectBackground {
  /**
   * @param {Phaser.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.image = scene.add.image(0, 0, LEVEL_SELECT_ART.background.key)
      .setOrigin(0.5, 0.5)
      .setDepth(-100);
  }

  /**
   * Cover-fit to the visible view (called on every resize by the scene's
   * attachViewport callback). Uniform scale, never stretched; horizontal
   * crops keep the painted red bird clear of the left edge (same verified
   * bias as the menu), vertical crops keep the foreground grass/lake.
   * @param {{x:number,y:number,width:number,height:number}} view
   */
  fit(view) {
    if (!this.image) return;
    const src = this.image.texture.getSourceImage();
    const scale = Math.max(view.width / src.width, view.height / src.height);
    const dw = src.width * scale;
    const dh = src.height * scale;
    const leftCut = Math.max(0, dw - view.width) * 0.08;
    const topCut = Math.max(0, dh - view.height) * 0.40;
    this.image.setScale(scale);
    this.image.setPosition(view.x - leftCut + dw / 2, view.y - topCut + dh / 2);
  }
}

/* ------------------------------------------------------------------ */
/* Atmosphere                                                          */
/* ------------------------------------------------------------------ */

/**
 * Subtle atmospheric separation for the card grid: a soft warm haze
 * (SCREEN blend) centred behind the cards so they read clearly against
 * the scenery while the landscape stays bright. Returns the container
 * (scene-owned lifetime).
 *
 * @param {Phaser.Scene} scene
 * @param {{x:number,y:number,width:number,height:number}} rect grid bounds
 */
export function buildLevelSelectAtmosphere(scene, rect) {
  const c = scene.add.container(rect.x + rect.width / 2, rect.y + rect.height / 2)
    .setDepth(-50);
  const g = scene.add.graphics().setBlendMode(Phaser.BlendModes.SCREEN);
  // concentric soft washes — brightest behind the cards, feathering out
  const layers = [
    { pad: 30, alpha: 0.10 },
    { pad: 90, alpha: 0.07 },
    { pad: 160, alpha: 0.05 },
    { pad: 240, alpha: 0.035 }
  ];
  for (const { pad, alpha } of layers) {
    g.fillStyle(0xfff6dd, alpha);
    g.fillRoundedRect(
      -rect.width / 2 - pad, -rect.height / 2 - pad,
      rect.width + pad * 2, rect.height + pad * 2, 60
    );
  }
  c.add(g);
  return c;
}
