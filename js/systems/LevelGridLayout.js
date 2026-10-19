/**
 * LevelGridLayout — pure grid geometry for the level-selection cards.
 *
 * No Phaser import (Node-unit-testable like config.js): given the fixed
 * logical world and the usable band between the title sign and the bottom
 * margin, it derives ONE card size + gaps that fit every card inside the
 * band, centred, with the classic 5×3 desktop arrangement as the default.
 *
 * Because the Viewport system guarantees the whole 1280×720 world is
 * visible on EVERY landscape device (fit-world, extend-scenery), this one
 * layout serves desktop, tablet and phone landscape alike — no paging or
 * scrolling is ever needed, and cards stay comfortably touch-sized on
 * phones (≈210 css px wide on a 844×390 phone).
 */

/** Default arrangement + sizing inputs (world px / ratios). */
export const LEVEL_GRID_DEFAULTS = {
  cols: 5,                    // 5 × 3 = the 15 levels (desktop reference)
  cardAspect: 213 / 143,      // wooden card frame w/h (matches the art)
  top: 205,                   // first usable world y (below the title sign)
  bottom: 700,                // last usable world y (grass margin kept)
  marginX: 64,                // side clearance inside the 1280 world
  gapRatio: 0.10,             // gap as a fraction of the card dimension
  maxCardW: 232               // aesthetic cap — cards never get cartoonish
};

/**
 * Compute the card grid.
 *
 * @param {number} worldW logical world width (WORLD.WIDTH)
 * @param {number} worldH logical world height (WORLD.HEIGHT)
 * @param {number} count number of cards (the game's 15 levels)
 * @param {object} [opts] overrides of LEVEL_GRID_DEFAULTS
 * @returns {{
 *   cols:number, rows:number, cardW:number, cardH:number,
 *   gapX:number, gapY:number, centerX:number, centerY:number,
 *   positions:Array<{x:number,y:number,col:number,row:number}>
 * }}
 */
export function computeLevelGrid(worldW, worldH, count, opts = {}) {
  const o = { ...LEVEL_GRID_DEFAULTS, ...opts };
  const cols = Math.max(1, Math.min(o.cols, count));
  const rows = Math.max(1, Math.ceil(count / cols));
  const g = Math.max(0, o.gapRatio);

  // Card width that fits the width band and the height band, aspect kept.
  const availW = Math.max(1, worldW - o.marginX * 2);
  const availH = Math.max(1, o.bottom - o.top);
  const byWidth = availW / (cols + (cols - 1) * g);
  const byHeight = (o.cardAspect * availH) / (rows + (rows - 1) * g);
  const cardW = Math.max(40, Math.min(o.maxCardW, byWidth, byHeight));
  const cardH = cardW / o.cardAspect;
  const gapX = cardW * g;
  const gapY = cardH * g;

  const totalW = cols * cardW + (cols - 1) * gapX;
  const totalH = rows * cardH + (rows - 1) * gapY;
  const centerX = worldW / 2;
  const centerY = o.top + availH / 2;

  const positions = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      col,
      row,
      x: centerX - totalW / 2 + cardW / 2 + col * (cardW + gapX),
      y: centerY - totalH / 2 + cardH / 2 + row * (cardH + gapY)
    });
  }
  return { cols, rows, cardW, cardH, gapX, gapY, centerX, centerY, positions };
}
