/**
 * Foreground terrain layer — the canonical gameplay ground, drawn FROM THE
 * SAME TERRAIN numbers the physics bodies use (config.TERRAIN), so what
 * the player sees and what collides are identical on every device.
 *
 * Layering (depth): background art -100  <  terrain -50  <  tower pieces
 * 4-6  <  slingshot 2-13 happens on the plateau ABOVE the terrain? No —
 * the slingshot sits on the plateau top edge; its layers (2..13) render
 * above terrain (-50), which is correct.
 *
 * The painted backgrounds remain pure scenery behind this layer: their
 * slightly different platform positions per device can never shift live
 * physics, exactly as the layout spec requires.
 */
import { WORLD, TERRAIN } from '../config.js';

const PALETTE = {
  grassLight: 0x8fbf5a,
  grass: 0x6fa348,
  grassDark: 0x527a37,
  dirt: 0x7a5425,
  dirtDark: 0x64451e,
  dirtDarker: 0x4f3617,
  water: 0x2e6f8e,
  waterDeep: 0x24597a,
  waterLight: 0x4b93b4,
  shadow: 0x1a2b12
};

export class TerrainLayer {
  constructor(scene) {
    this.scene = scene;
    this.g = scene.add.graphics().setDepth(-50);
    this.draw();
  }

  draw() {
    const g = this.g;
    g.clear();
    const H = WORLD.HEIGHT + 80;

    const drawLand = (seg) => {
      const w = seg.right - seg.left;
      // soft contact shadow along the top edge (grounds the towers)
      g.fillStyle(PALETTE.shadow, 0.18);
      g.fillRect(seg.left + 6, seg.top + 8, w - 12, 14);
      // dirt body
      g.fillStyle(PALETTE.dirt, 1);
      g.fillRect(seg.left, seg.top + 10, w, H - seg.top - 10);
      // darker dirt strata
      g.fillStyle(PALETTE.dirtDark, 1);
      g.fillRect(seg.left, seg.top + 34, w, 18);
      g.fillRect(seg.left, seg.top + 92, w, 26);
      g.fillStyle(PALETTE.dirtDarker, 0.55);
      for (let i = 0; i < 9; i++) {
        const rx = seg.left + 30 + ((i * 137) % Math.max(60, w - 90));
        const ry = seg.top + 60 + ((i * 83) % 130);
        g.fillCircle(rx, ry, 6 + (i % 3) * 3);
      }
      // grass lip
      g.fillStyle(PALETTE.grass, 1);
      g.fillRect(seg.left, seg.top + 2, w, 12);
      g.fillStyle(PALETTE.grassLight, 1);
      g.fillRect(seg.left, seg.top + 2, w, 5);
      // grass blades along the edge
      g.fillStyle(PALETTE.grassDark, 1);
      for (let x = seg.left; x < seg.right; x += 14) {
        g.fillRect(x + 3, seg.top - 4, 3, 6);
        g.fillRect(x + 9, seg.top - 2, 2, 4);
      }
    };

    drawLand(TERRAIN.PLATEAU);
    drawLand(TERRAIN.TERRACE);

    // plateau's right face drops into the water gap; terrace's left face too
    const [gl, gr] = [TERRAIN.PLATEAU.right, TERRAIN.TERRACE.left];
    const top = Math.max(TERRAIN.PLATEAU.top, TERRAIN.TERRACE.top);
    // water column in the gap, below the lower of the two surfaces
    const waterTop = TERRAIN.TERRACE.top + 16;
    g.fillStyle(PALETTE.water, 1);
    g.fillRect(gl, waterTop, gr - gl, H - waterTop);
    g.fillStyle(PALETTE.waterDeep, 1);
    g.fillRect(gl, waterTop + 70, gr - gl, H - waterTop - 70);
    // gentle highlight
    g.fillStyle(PALETTE.waterLight, 0.8);
    g.fillRect(gl + 4, waterTop + 8, gr - gl - 8, 4);
    g.fillRect(gl + 8, waterTop + 26, gr - gl - 16, 3);
    // dark cliff faces bookending the water
    g.fillStyle(PALETTE.dirtDark, 1);
    g.fillRect(gl - 10, TERRAIN.PLATEAU.top + 14, 10, H - TERRAIN.PLATEAU.top - 14);
    g.fillStyle(PALETTE.dirt, 1);
    g.fillRect(gr, TERRAIN.TERRACE.top + 14, 10, H - TERRAIN.TERRACE.top - 14);
    // rounded grass caps over the clifftop corners facing the gap
    g.fillStyle(PALETTE.grass, 1);
    g.fillCircle(gl - 4, TERRAIN.PLATEAU.top + 6, 9);
    g.fillCircle(gr + 4, TERRAIN.TERRACE.top + 6, 9);
    void top;
  }

  destroy() {
    this.g.destroy();
    this.g = null;
  }
}
