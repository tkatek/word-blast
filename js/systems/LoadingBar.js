/**
 * Shared in-scene loading progress bar (load-time optimization pass).
 *
 * The game ships enough artwork that the first paint can trail the network
 * on slow connections; this keeps the player informed during every preload
 * batch instead of a blank sky-colored page. Two presentations:
 *
 *   full    — branded boot screen (title, caption, wooden bar + %):
 *             BootScene, shown while the gameplay asset batch downloads.
 *   compact — slim bottom bar with a small caption: MenuScene / any later
 *             scene that queues a visible batch.
 *
 * The bar is driven by the SCENE's own loader 'progress' events, so it
 * reflects real network progress file-by-file. The caller owns the
 * lifecycle: destroy() it first thing in create().
 */
import Phaser from 'phaser';
import { WORLD } from '../config.js';

/** Palette: the page shell + wooden UI established across the project. */
const THEME = {
  bg: 0x081c15,       // brand dark green (index.html shell / rotate overlay)
  wood: 0xa4713d,     // wooden frame (fullscreen-card palette)
  woodDark: 0x4d3218, // bar track
  fill: 0xffd60a,     // signature yellow
  title: '#ffd60a',
  caption: '#ffffff'
};

/**
 * Build a loading bar bound to `scene.load`.
 *
 * @param {Phaser.Scene} scene scene whose loader drives the bar
 * @param {object} [opts]
 * @param {string}  [opts.title='WORD BLAST']   heading (full mode only)
 * @param {string}  [opts.caption='Loading…']   small label under/next to the bar
 * @param {boolean} [opts.compact=false]        slim bottom-bar presentation
 * @returns {{destroy: () => void}} handle; call destroy() in create()
 */
export function createLoadingBar(scene, { title = 'WORD BLAST', caption = 'Loading\u2026', compact = false } = {}) {
  const cx = WORLD.WIDTH / 2;
  const W = compact ? 420 : 560;
  const H = compact ? 14 : 22;
  const y = compact ? WORLD.HEIGHT - 48 : 436;
  const depth = compact ? 900 : 8000; // full mode must cover everything at boot

  const objects = [];

  if (!compact) {
    objects.push(scene.add.rectangle(cx, WORLD.HEIGHT / 2, WORLD.WIDTH + 8, WORLD.HEIGHT + 8, THEME.bg).setDepth(depth));
    objects.push(scene.add.text(cx, 296, title, {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '54px', fontStyle: 'bold', color: THEME.title
    }).setOrigin(0.5).setDepth(depth + 1));
    objects.push(scene.add.text(cx, 352, caption, {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '19px', color: THEME.caption
    }).setOrigin(0.5).setDepth(depth + 1));
  }

  const frame = scene.add.graphics().setDepth(depth + 1);
  frame.fillStyle(THEME.wood, 1)
    .fillRoundedRect(cx - W / 2 - 6, y - H / 2 - 6, W + 12, H + 12, 10);
  frame.fillStyle(THEME.woodDark, 1)
    .fillRoundedRect(cx - W / 2, y - H / 2, W, H, 7);
  objects.push(frame);

  const fill = scene.add.graphics().setDepth(depth + 2);
  objects.push(fill);

  let pctText = null;
  if (!compact) {
    pctText = scene.add.text(cx, y - 44, '0%', {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: '22px', fontStyle: 'bold', color: THEME.title
    }).setOrigin(0.5).setDepth(depth + 2);
    objects.push(pctText);
  }

  const setProgress = (value) => {
    const p = Phaser.Math.Clamp(value || 0, 0, 1);
    fill.clear();
    const w = p * (W - 8);
    if (w > 2) {
      fill.fillStyle(THEME.fill, 1)
        .fillRoundedRect(cx - W / 2 + 4, y - H / 2 + 4, w, H - 8, 4);
    }
    if (pctText) pctText.setText(`${Math.round(p * 100)}%`);
  };
  setProgress(0);

  const onProgress = (value) => setProgress(value);
  scene.load.on('progress', onProgress);

  return {
    destroy() {
      scene.load.off('progress', onProgress);
      for (const obj of objects) obj.destroy();
      objects.length = 0;
    }
  };
}
