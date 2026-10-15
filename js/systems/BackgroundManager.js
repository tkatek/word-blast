/**
 * Background manager: loads, selects, scales and swaps the device
 * background behind the gameplay world.
 *
 * - The world stays a fixed 1280×720; the background is a world-space
 *   image at depth -100 so it can never overlap gameplay objects.
 * - Aspect-preserving cover-fit (no stretching); per-device anchor
 *   offsets tune which slice of the art is visible.
 * - Textures are cached by Phaser; switching layouts reuses loaded
 *   textures and never creates duplicates.
 */
import { WORLD } from '../config.js';
import { DEVICE_TYPES, deviceInfo } from './Device.js';

const BASE = (import.meta.env.BASE_URL || '/') + 'assets/images/backgrounds/';
const FILES = {
  [DEVICE_TYPES.DESKTOP]: 'desktop.webp',
  [DEVICE_TYPES.TABLET]: 'tablet.webp',
  [DEVICE_TYPES.MOBILE]: 'mobile-landscape.webp'
};

/**
 * Cover-fit tuning per device (world px). Positive Y shifts art down,
 * positive X shifts art right. Used to protect important art regions
 * from cover-cropping instead of stretching.
 */
const FIT_TUNING = {
  [DEVICE_TYPES.DESKTOP]: { offsetX: 0, offsetY: 0 },
  [DEVICE_TYPES.TABLET]: { offsetX: 0, offsetY: -30 },   // keep sky for the HUD
  [DEVICE_TYPES.MOBILE]: { offsetX: -30, offsetY: 0 }    // keep the right platforms
};

export class BackgroundManager {
  /** Queue the asset for one device type (call from scene.preload). */
  static preload(scene, type) {
    scene.load.image(this.keyFor(type), BASE + FILES[type]);
  }

  static keyFor(type) {
    return `bg-${type}`;
  }

  constructor(scene) {
    this.scene = scene;
    this.image = null;
    this.type = null;
  }

  /** Show the background for a device type (no-op if already shown). */
  apply(type) {
    if (this.type === type && this.image) return false;
    const key = BackgroundManager.keyFor(type);
    if (!this.scene.textures.exists(key)) {
      // Not preloaded for this class — load it, then swap once.
      this.type = null;
      this.scene.load.image(key, BASE + FILES[type]);
      this.scene.load.once(`filecomplete-image-${key}`, () => this.apply(type));
      this.scene.load.start();
      return false;
    }
    if (this.image) this.image.destroy(); // exactly one background, ever
    this.type = type;
    this.image = this.scene.add.image(WORLD.WIDTH / 2, WORLD.HEIGHT / 2, key)
      .setOrigin(0.5, 0.5)
      .setDepth(-100); // behind ground strip (1), bodies (0+), HUD (50+)
    this.layout();
    return true;
  }

  /** Aspect-preserving cover-fit into the logical world. */
  layout() {
    if (!this.image) return;
    const src = this.image.texture.getSourceImage();
    const tune = FIT_TUNING[this.type] || { offsetX: 0, offsetY: 0 };
    const scale = Math.max(WORLD.WIDTH / src.width, WORLD.HEIGHT / src.height);
    this.image.setScale(scale);
    this.image.setPosition(
      WORLD.WIDTH / 2 + tune.offsetX,
      WORLD.HEIGHT / 2 + tune.offsetY
    );
  }

  /** Re-evaluate the device class after a viewport change (debounced). */
  refreshFromViewport() {
    const info = deviceInfo();
    if (info.type !== this.type) this.apply(info.type);
  }

  destroy() {
    if (this.image) this.image.destroy();
    this.image = null;
    this.type = null;
  }
}
