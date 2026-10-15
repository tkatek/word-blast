/**
 * Pointer → world coordinate mapping for scaled canvases.
 * Phaser's pointer.worldX already handles this in gameplay code; this pure
 * helper exists so the debug API and automated tests can verify the mapping
 * used when synthesizing pointer events on the canvas element (test spec #21).
 */
import { WORLD } from '../config.js';

/**
 * Map client (viewport) coordinates to logical game-world coordinates.
 * @param {number} clientX
 * @param {number} clientY
 * @param {DOMRect} rect canvas bounding rect
 * @returns {{x:number, y:number, inside:boolean}} world coords + inside flag
 */
export function clientToWorld(clientX, clientY, rect) {
  if (!rect || rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0, inside: false };
  }
  const x = ((clientX - rect.left) / rect.width) * WORLD.WIDTH;
  const y = ((clientY - rect.top) / rect.height) * WORLD.HEIGHT;
  const inside = x >= 0 && x <= WORLD.WIDTH && y >= 0 && y <= WORLD.HEIGHT;
  return { x, y, inside };
}

/**
 * Inverse mapping: world → client coords (for synthesizing pointer events).
 */
export function worldToClient(wx, wy, rect) {
  if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return {
    x: rect.left + (wx / WORLD.WIDTH) * rect.width,
    y: rect.top + (wy / WORLD.HEIGHT) * rect.height
  };
}
