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
 * Subtle atmospheric separation for the card grid: one SMOOTH radial
 * canvas gradient (scrim that settles the scenery behind the cards,
 * warmed back up by a light haze) so the landscape stays bright while the
 * cards pop and painted details can't read as interface artifacts through
 * the gaps. Radial falloff = no visible layer edges on any aspect ratio.
 * Falls back to layered graphics when canvas gradients are unavailable.
 * Returns the container (scene-owned lifetime).
 *
 * @param {Phaser.Scene} scene
 * @param {{x:number,y:number,width:number,height:number}} rect grid bounds
 */
export function buildLevelSelectAtmosphere(scene, rect) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const c = scene.add.container(cx, cy).setDepth(-50);

  const texture = ensureAtmosphereTexture(scene, rect);
  if (texture) {
    // drawn once at grid scale + generous feather, uniform scale to fit
    const img = scene.add.image(0, 0, texture.key)
      .setDisplaySize(rect.width + 520, rect.height + 520);
    c.add(img);
    return c;
  }

  // headless fallback: layered rounded rects (no canvas gradients there)
  const scrim = scene.add.graphics();
  for (const { pad, alpha } of [{ pad: 24, alpha: 0.13 }, { pad: 80, alpha: 0.085 }, { pad: 150, alpha: 0.05 }]) {
    scrim.fillStyle(0x2b2416, alpha);
    scrim.fillRoundedRect(
      -rect.width / 2 - pad, -rect.height / 2 - pad,
      rect.width + pad * 2, rect.height + pad * 2, 60
    );
  }
  c.add(scrim);
  const haze = scene.add.graphics().setBlendMode(Phaser.BlendModes.SCREEN);
  for (const { pad, alpha } of [{ pad: 16, alpha: 0.07 }, { pad: 90, alpha: 0.045 }, { pad: 170, alpha: 0.03 }]) {
    haze.fillStyle(0xfff6dd, alpha);
    haze.fillRoundedRect(
      -rect.width / 2 - pad, -rect.height / 2 - pad,
      rect.width + pad * 2, rect.height + pad * 2, 60
    );
  }
  c.add(haze);
  return c;
}

/**
 * Paint the atmosphere as a canvas texture: an elliptical warm-dark scrim
 * (radial gradient, smooth falloff) + a soft cream haze on top. One
 * texture, cached under a fixed key (grid geometry is fixed in the world).
 * Returns { key } or null when canvas gradients are unavailable.
 */
const ATMO_KEY = 'lvlsel-atmo';
function ensureAtmosphereTexture(scene, rect) {
  try {
    if (scene.textures.exists(ATMO_KEY)) return { key: ATMO_KEY };
    const W = 1200, H = 900;
    const canvasTex = scene.textures.createCanvas(ATMO_KEY, W, H);
    if (!canvasTex) return null;
    const ctx = canvasTex.getContext();
    if (!ctx || typeof ctx.createRadialGradient !== 'function') {
      scene.textures.remove(ATMO_KEY);
      return null;
    }
    ctx.clearRect(0, 0, W, H);
    // settling scrim — elliptical via scaled transform
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1, (H * 0.62) / (W * 0.62));
    let g = ctx.createRadialGradient(0, 0, W * 0.16, 0, 0, W * 0.5);
    g.addColorStop(0, 'rgba(43, 36, 22, 0.15)');
    g.addColorStop(0.62, 'rgba(43, 36, 22, 0.075)');
    g.addColorStop(1, 'rgba(43, 36, 22, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-W, -W, W * 2, W * 2);
    ctx.restore();
    // warm haze — lighter, wider
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1, (H * 0.72) / (W * 0.72));
    g = ctx.createRadialGradient(0, 0, W * 0.2, 0, 0, W * 0.5);
    g.addColorStop(0, 'rgba(255, 246, 221, 0.10)');
    g.addColorStop(0.65, 'rgba(255, 246, 221, 0.05)');
    g.addColorStop(1, 'rgba(255, 246, 221, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-W, -W, W * 2, W * 2);
    ctx.restore();
    canvasTex.refresh();
    return { key: ATMO_KEY };
  } catch (e) {
    return null;
  }
}
