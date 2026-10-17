/**
 * Background manager: the ONE official gameplay background — a single
 * flat-grass landscape shared by every device (desktop, laptop, tablet,
 * phone landscape).
 *
 * - The world stays a fixed 1280×720; the background is a world-space
 *   image at depth -100 so it can never overlap gameplay objects.
 * - The fit is a single uniform scale (aspect-preserving, no stretching,
 *   no per-device variants): cover the world, then slide the art so its
 *   painted grass line (BACKGROUND.GRASS_LINE_Y) lands exactly on
 *   WORLD.GROUND_Y. The visible grass and the invisible ground collider
 *   are therefore always the same line, on every screen size.
 * - Textures are cached by Phaser; exactly one background image ever
 *   exists per scene.
 */
import { WORLD, BACKGROUND } from '../config.js';

// (import.meta.env is Vite-only; the guard keeps the pure fit function
// importable from the Node unit suite)
const BASE = ((import.meta.env && import.meta.env.BASE_URL) || '/') + 'assets/images/backgrounds/';
const KEY = 'bg-gameplay';

/**
 * Pure fit computation (unit-tested): where to place and scale the source
 * art so it covers the world and its grass line sits on WORLD.GROUND_Y.
 *
 * @param {number} srcW source art width  (px)
 * @param {number} srcH source art height (px)
 * @returns {{scale:number, x:number, y:number, grassWorldY:number}}
 *          x/y are the CENTER of the placed image (Phaser origin 0.5);
 *          grassWorldY is where the painted grass line ends up.
 */
export function computeBackgroundFit(srcW, srcH) {
  const cover = Math.max(WORLD.WIDTH / srcW, WORLD.HEIGHT / srcH);
  const dw = srcW * cover;
  const dh = srcH * cover;
  // y so that GRASS_LINE_Y maps onto GROUND_Y; clamped so the art always
  // fully covers the world (never a gap above or below).
  let y = WORLD.GROUND_Y - (BACKGROUND.GRASS_LINE_Y - srcH / 2) * cover;
  y = Math.min(y, dh / 2);                      // top edge never below world top
  y = Math.max(y, WORLD.HEIGHT - dh / 2);       // bottom edge never above world bottom
  const grassWorldY = y + (BACKGROUND.GRASS_LINE_Y - srcH / 2) * cover;
  return { scale: cover, x: WORLD.WIDTH / 2, y, grassWorldY };
}

export class BackgroundManager {
  /** Queue the official background asset (call from scene.preload). */
  static preload(scene) {
    scene.load.image(KEY, BASE + BACKGROUND.FILE);
  }

  static keyFor() {
    return KEY;
  }

  /** Most mirrored rings ever generated per axis (insane aspect ratios). */
  static get MAX_RINGS() { return 3; }

  constructor(scene) {
    this.scene = scene;
    this.image = null;
    this.type = 'gameplay'; // stable identifier for debug tooling
    this.mirrors = [];      // decorative out-fill beyond the art (Fix #2)
    this.fit = null;        // last computed fit (reused by extendTo)
    this.lastView = null;
  }

  /** Show the official background (idempotent; loads on demand if needed). */
  apply() {
    if (this.image) return false;
    if (!this.scene.textures.exists(KEY)) {
      this.scene.load.image(KEY, BASE + BACKGROUND.FILE);
      this.scene.load.once(`filecomplete-image-${KEY}`, () => this.apply());
      this.scene.load.start();
      return false;
    }
    this.image = this.scene.add.image(0, 0, KEY)
      .setOrigin(0.5, 0.5)
      .setDepth(-100); // behind bodies (0+), HUD (50+)
    this.layout();
    if (this.lastView) this.extendTo(this.lastView); // late texture arrival
    return true;
  }

  /** Re-run the fit (needed only if the art or ground constants change). */
  layout() {
    if (!this.image) return;
    const src = this.image.texture.getSourceImage();
    this.fit = computeBackgroundFit(src.width, src.height);
    this.image.setScale(this.fit.scale);
    this.image.setPosition(this.fit.x, this.fit.y);
    for (const m of this.mirrors) m.setScale(this.fit.scale);
    if (this.lastView) this.extendTo(this.lastView);
  }

  /**
   * Fix #2 — decorative out-fill. When the responsive camera shows MORE than
   * the 1280×720 world (ultrawide desktops, 4:3 tablets, phone landscape),
   * the area beyond the art is filled with MIRRORED copies of the art itself:
   * seams are pixel-continuous, the aspect ratio is preserved (no stretching)
   * and no new assets are needed. Purely decorative — no physics, no input,
   * and the aligned main image (depth -100) on top guarantees the painted
   * grass line stays exactly on the ground collider. Mirrors sit behind it
   * at depth -101 and are pooled: resizes only reposition/reflip them.
   *
   * @param {{x:number, y:number, width:number, height:number}} view visible
   *        world rectangle (Viewport.computeFitView)
   */
  extendTo(view) {
    if (!this.image || !this.fit || !view) return;
    this.lastView = view;
    const { scale, x, y } = this.fit;
    const src = this.image.texture.getSourceImage();
    const dw = src.width * scale;
    const dh = src.height * scale;
    const artLeft = x - dw / 2;
    const artTop = y - dh / 2;

    const ringsBeyond = (marginBefore, marginAfter) =>
      Math.max(Math.ceil(marginBefore), Math.ceil(marginAfter), 0);
    const ringsX = ringsBeyond((artLeft - view.x) / dw, (view.x + view.width - (artLeft + dw)) / dw);
    const ringsY = ringsBeyond((artTop - view.y) / dh, (view.y + view.height - (artTop + dh)) / dh);
    const rings = Math.min(BackgroundManager.MAX_RINGS, Math.max(ringsX, ringsY));

    let i = 0;
    for (let ix = -rings; ix <= rings; ix++) {
      for (let iy = -rings; iy <= rings; iy++) {
        if (ix === 0 && iy === 0) continue; // the real, aligned art
        let m = this.mirrors[i];
        if (!m) {
          m = this.scene.add.image(0, 0, KEY)
            .setOrigin(0.5, 0.5)
            .setDepth(-101) // behind the aligned art, in front of the sky
            .setScale(scale);
          this.mirrors[i] = m;
        }
        // Alternating flips per ring keep every seam a perfect mirror joint.
        m.setVisible(true)
          .setPosition(x + ix * dw, y + iy * dh)
          .setFlipX(Math.abs(ix) % 2 === 1)
          .setFlipY(Math.abs(iy) % 2 === 1);
        i++;
      }
    }
    for (; i < this.mirrors.length; i++) this.mirrors[i].setVisible(false);
  }

  destroy() {
    for (const m of this.mirrors) m.destroy();
    this.mirrors.length = 0;
    if (this.image) this.image.destroy();
    this.image = null;
  }
}
