/**
 * TOWER ASSET MANIFEST — the single source of truth for the supplied sprite
 * pack (public/assets/images/tower/, from Word-Blast-Tower-Assets.zip).
 *
 * GROUNDING CONTRACT: every PNG in the pack is PRE-TRIMMED to its visible
 * content (canvas == content, ±1px; scripts/trim-tower-assets.mjs). The
 * physics factory sizes the whole canvas to `size` via setDisplaySize, so
 * the painted edge lands EXACTLY on the collider edge — resting faces
 * touch with zero gap, matching the zero-overlap stacking math in
 * towers.js. displaySizeFor() below enforces this defensively at runtime.
 *
 * Every entry records:
 *   file        pack-relative path (lowercase, case-sensitive on Linux hosts)
 *   material    physics material preset (MATERIALS key)
 *   content     visible content size in source pixels (alpha > 10) — equals
 *               the trimmed canvas size; kept for audits / re-verification
 *   size        recommended logical world size (uniform-ish scale of content)
 *   collider    { shape, inset } — collider is derived from `size`, inset
 *               pulls it inside the painted edge so bark/glints don't hover
 *   rotatable   sprite reads correctly when rotated for braces/beams
 *   preload     queued by BootScene (false = decorative, loaded on demand)
 *
 * Every piece keeps min(size) >= TUNNELING.MIN_PIECE_DIM: combined with the
 * projectile speed caps this is the verified anti-tunneling mitigation.
 */
export const TOWER_ASSETS = {
  // ---- wood --------------------------------------------------------------
  wood_beam_h: {
    file: 'wood/wood_beam_horizontal.png', material: 'wood',
    content: [192, 59], size: [168, 50], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  wood_beam_v: {
    file: 'wood/wood_beam_vertical.png', material: 'wood',
    content: [62, 160], size: [52, 134], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  wood_crate_cross: {
    file: 'wood/wood_crate_cross.png', material: 'wood',
    content: [156, 148], size: [88, 84], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  wood_crate_panel: {
    file: 'wood/wood_crate_panel.png', material: 'wood',
    content: [125, 123], size: [70, 69], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  wood_triangle: {
    file: 'wood/wood_triangle.png', material: 'wood',
    content: [154, 137], size: [86, 76], collider: { shape: 'rect', inset: 8 },
    rotatable: false, preload: true
  },
  wood_pillar: {
    file: 'wood/wood_support_pillar.png', material: 'wood',
    content: [86, 156], size: [48, 88], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  wood_log: {
    file: 'wood/wood_log_round.png', material: 'wood',
    content: [129, 132], size: [58, 59], collider: { shape: 'circle' },
    rotatable: true, preload: true, rolls: true
  },
  // ---- stone -------------------------------------------------------------
  stone_block_l: {
    file: 'stone/stone_block_large.png', material: 'stone',
    content: [127, 127], size: [76, 76], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  stone_block_s: {
    file: 'stone/stone_block_small.png', material: 'stone',
    content: [104, 101], size: [60, 58], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  stone_beam_h: {
    file: 'stone/stone_beam_horizontal.png', material: 'stone',
    content: [198, 75], size: [172, 64], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  stone_column: {
    file: 'stone/stone_column.png', material: 'stone',
    content: [84, 138], size: [52, 86], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  stone_triangle: {
    file: 'stone/stone_triangle.png', material: 'stone',
    content: [149, 97], size: [82, 53], collider: { shape: 'rect', inset: 8 },
    rotatable: false, preload: true
  },
  stone_boulder: {
    file: 'stone/stone_boulder.png', material: 'stone',
    content: [138, 137], size: [66, 65], collider: { shape: 'circle' },
    rotatable: true, preload: true, rolls: true
  },
  // ---- glass -------------------------------------------------------------
  glass_block_l: {
    file: 'glass/glass_block_large.png', material: 'glass',
    content: [137, 139], size: [78, 79], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  glass_block_s: {
    file: 'glass/glass_block_small.png', material: 'glass',
    content: [101, 101], size: [58, 58], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  glass_beam_h: {
    file: 'glass/glass_beam_horizontal.png', material: 'glass',
    content: [191, 82], size: [164, 70], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  glass_column: {
    file: 'glass/glass_column.png', material: 'glass',
    content: [84, 140], size: [52, 88], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  glass_triangle: {
    file: 'glass/glass_triangle.png', material: 'glass',
    content: [166, 116], size: [90, 62], collider: { shape: 'rect', inset: 8 },
    rotatable: false, preload: true
  },
  glass_orb: {
    file: 'glass/glass_orb.png', material: 'glass',
    content: [123, 123], size: [56, 56], collider: { shape: 'circle' },
    rotatable: true, preload: true, rolls: true
  },
  // damaged visual variants (swapped in below 50% hp — art, not behavior)
  glass_block_cracked: {
    file: 'glass/glass_block_cracked.png', material: 'glass',
    content: [135, 124], size: [78, 79], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true, variantOf: 'glass_block_l'
  },
  stone_broken: {
    file: 'stone/stone_broken.png', material: 'stone',
    content: [150, 119], size: [76, 76], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true, variantOf: 'stone_block_l'
  },
  // ---- props -------------------------------------------------------------
  barrel_wood: {
    file: 'props/barrel_wood.png', material: 'wood',
    content: [134, 146], size: [60, 66], collider: { shape: 'circle' },
    rotatable: true, preload: true, rolls: true
  },
  crate_tnt: {
    file: 'props/crate_tnt.png', material: 'boom',
    content: [157, 135], size: [72, 62], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  sign_blank: {
    file: 'props/sign_blank_wood.png', material: 'wood',
    content: [160, 112], size: [116, 80], collider: { shape: 'rect', inset: 5 },
    rotatable: false, preload: true
  },
  // answer plaques — the parchment-and-wood panel style baked from the
  // uploaded artwork (scripts/build-answer-panels.mjs). One design, three
  // widths: the frame and corner ornaments are identical in all variants,
  // only the parchment middle grows, so the word keeps ONE font size.
  // Pre-trimmed like the rest of the pack: canvas == content.
  answer_panel_s: {
    file: 'props/answer_panel_s.png', material: 'wood',
    content: [116, 80], size: [116, 80], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  answer_panel_m: {
    file: 'props/answer_panel_m.png', material: 'wood',
    content: [142, 80], size: [142, 80], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  answer_panel_l: {
    file: 'props/answer_panel_l.png', material: 'wood',
    content: [170, 80], size: [170, 80], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  // XL sentence panel — the newly uploaded wide parchment artwork, rail-thinned
  // between the corner posts (scripts/build-answer-panel-xl.mjs; never
  // stretched). Parchment writing box: x 0.083..0.864, y 0.245..0.797 of the
  // display size. Pre-trimmed like the rest of the pack: canvas == content.
  answer_panel_xl: {
    file: 'props/answer_panel_xl.png', material: 'wood',
    content: [600, 194], size: [300, 97], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  // decorative only (no physics unless placed with one explicitly)
  lantern: {
    file: 'props/lantern.png', material: 'wood',
    content: [72, 136], size: [38, 74], collider: { shape: 'none' },
    rotatable: false, preload: false
  },
  nest_eggs: {
    file: 'props/nest_eggs.png', material: 'wood',
    content: [190, 138], size: [82, 60], collider: { shape: 'none' },
    rotatable: false, preload: false
  },
  bullseye: {
    file: 'props/bullseye_target.png', material: 'wood',
    content: [134, 149], size: [58, 66], collider: { shape: 'none' },
    rotatable: false, preload: false
  },
  // ---- pigs (decorative occupants; never answer targets) -----------------
  pig_small: {
    file: 'pigs/pig_small.png', material: 'pig',
    content: [140, 123], size: [64, 56], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_medium: {
    file: 'pigs/pig_medium.png', material: 'pig',
    content: [164, 147], size: [74, 66], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_king: {
    file: 'pigs/pig_king.png', material: 'pig',
    content: [178, 181], size: [72, 73], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_worker: {
    file: 'pigs/pig_worker.png', material: 'pig',
    content: [148, 156], size: [62, 66], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_helmet: {
    file: 'pigs/pig_helmet.png', material: 'pig',
    content: [166, 145], size: [72, 63], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_aviator: {
    file: 'pigs/pig_aviator.png', material: 'pig',
    content: [176, 140], size: [76, 60], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_angry: {
    file: 'pigs/pig_angry.png', material: 'pig',
    content: [157, 153], size: [68, 66], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_chef: {
    file: 'pigs/pig_chef.png', material: 'pig',
    content: [152, 189], size: [58, 72], collider: { shape: 'circle' },
    rotatable: false, preload: true
  }
};

/** Assets referenced by name in level data must exist here. */
export function getAsset(key) {
  return TOWER_ASSETS[key] || null;
}

/** Texture keys the BootScene must queue (preload === true only). */
export function preloadList() {
  return Object.entries(TOWER_ASSETS)
    .filter(([, a]) => a.preload)
    .map(([key, a]) => ({ key, file: a.file }));
}

/** Collider box for an asset at its logical size (before rotation). */
export function colliderSize(key) {
  const a = TOWER_ASSETS[key];
  if (!a || a.collider.shape === 'none') return null;
  const inset = a.collider.inset || 0;
  return { w: a.size[0] - inset * 2, h: a.size[1] - inset * 2, shape: a.collider.shape };
}

/**
 * GROUNDING GUARD — the display size that makes an asset's VISIBLE CONTENT
 * span exactly its logical `size` on screen. The pack ships pre-trimmed
 * (canvas == content), so this is normally `size` itself. If an untrimmed
 * texture ever sneaks back in (padding around the content), the canvas is
 * scaled by content→size ratio instead, so the painted edge still meets the
 * physics body edge and pieces still touch the surfaces they rest on.
 *
 * @param {string} key asset key
 * @param {number} frameW live texture width (frame.realWidth)
 * @param {number} frameH live texture height
 * @returns {[number, number]} width/height for setDisplaySize
 */
export function displaySizeFor(key, frameW, frameH) {
  const a = TOWER_ASSETS[key];
  if (!a) return [frameW, frameH];
  const [cw, ch] = a.content;
  const [w, h] = a.size;
  if (!frameW || !frameH) return [w, h];
  const driftX = Math.abs(frameW - cw), driftY = Math.abs(frameH - ch);
  if (driftX <= 1.5 && driftY <= 1.5) return [w, h]; // trimmed: exact fit
  // untrimmed canvas: scale so the CONTENT box maps onto `size`
  return [w * frameW / cw, h * frameH / ch];
}
