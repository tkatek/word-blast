/**
 * Pointer → world coordinate mapping for scaled canvases.
 * Phaser's pointer.worldX already handles this in gameplay code (camera zoom
 * included); this pure helper exists so the debug API and automated tests can
 * verify the mapping used when synthesizing pointer events on the canvas
 * element (test spec #21).
 *
 * Fix #2: with the responsive viewport the canvas no longer IS the 1280×720
 * world rect — the camera shows a possibly larger world rect (fit zoom).
 * `view` describes that visible world rectangle; omit it for the legacy
 * assumption (canvas == world, e.g. FIT mode / headless 1:1 rendering).
 */
import { WORLD } from '../config.js';

/**
 * Map client (viewport) coordinates to logical game-world coordinates.
 * @param {number} clientX
 * @param {number} clientY
 * @param {DOMRect} rect canvas bounding rect
 * @param {object} [view] visible world rect {x,y,width,height} (Viewport.js);
 *        defaults to the whole world mapped onto the canvas.
 * @returns {{x:number, y:number, inside:boolean}} world coords + inside flag
 */
export function clientToWorld(clientX, clientY, rect, view = null) {
  if (!rect || rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0, inside: false };
  }
  const v = view || { x: 0, y: 0, width: WORLD.WIDTH, height: WORLD.HEIGHT };
  const x = v.x + ((clientX - rect.left) / rect.width) * v.width;
  const y = v.y + ((clientY - rect.top) / rect.height) * v.height;
  const inside = x >= 0 && x <= WORLD.WIDTH && y >= 0 && y <= WORLD.HEIGHT;
  return { x, y, inside };
}

/**
 * Inverse mapping: world → client coords (for synthesizing pointer events).
 * @param {number} wx
 * @param {number} wy
 * @param {DOMRect} rect canvas bounding rect
 * @param {object} [view] visible world rect (see clientToWorld)
 */
export function worldToClient(wx, wy, rect, view = null) {
  if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  const v = view || { x: 0, y: 0, width: WORLD.WIDTH, height: WORLD.HEIGHT };
  return {
    x: rect.left + ((wx - v.x) / v.width) * rect.width,
    y: rect.top + ((wy - v.y) / v.height) * rect.height
  };
}
