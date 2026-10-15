/**
 * TOWER ASSET MANIFEST — the single source of truth for the supplied sprite
 * pack (public/assets/images/tower/, from Word-Blast-Tower-Assets.zip).
 *
 * Every entry records:
 *   file        pack-relative path (lowercase, case-sensitive on Linux hosts)
 *   material    physics material preset (MATERIALS key)
 *   content     visible content size in source pixels (alpha > 10), measured
 *               with a pixel audit — NOT the canvas size, which carries 8px
 *               transparent padding on every side
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
    content: [190, 57], size: [168, 50], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  wood_beam_v: {
    file: 'wood/wood_beam_vertical.png', material: 'wood',
    content: [61, 158], size: [52, 134], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  wood_crate_cross: {
    file: 'wood/wood_crate_cross.png', material: 'wood',
    content: [154, 146], size: [88, 84], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  wood_crate_panel: {
    file: 'wood/wood_crate_panel.png', material: 'wood',
    content: [123, 121], size: [70, 69], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  wood_triangle: {
    file: 'wood/wood_triangle.png', material: 'wood',
    content: [152, 135], size: [86, 76], collider: { shape: 'rect', inset: 8 },
    rotatable: false, preload: true
  },
  wood_pillar: {
    file: 'wood/wood_support_pillar.png', material: 'wood',
    content: [84, 154], size: [48, 88], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  wood_log: {
    file: 'wood/wood_log_round.png', material: 'wood',
    content: [127, 130], size: [58, 59], collider: { shape: 'circle' },
    rotatable: true, preload: true, rolls: true
  },
  // ---- stone -------------------------------------------------------------
  stone_block_l: {
    file: 'stone/stone_block_large.png', material: 'stone',
    content: [125, 125], size: [76, 76], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  stone_block_s: {
    file: 'stone/stone_block_small.png', material: 'stone',
    content: [102, 99], size: [60, 58], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  stone_beam_h: {
    file: 'stone/stone_beam_horizontal.png', material: 'stone',
    content: [196, 73], size: [172, 64], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  stone_column: {
    file: 'stone/stone_column.png', material: 'stone',
    content: [82, 136], size: [52, 86], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  stone_triangle: {
    file: 'stone/stone_triangle.png', material: 'stone',
    content: [147, 95], size: [82, 53], collider: { shape: 'rect', inset: 8 },
    rotatable: false, preload: true
  },
  stone_boulder: {
    file: 'stone/stone_boulder.png', material: 'stone',
    content: [136, 135], size: [66, 65], collider: { shape: 'circle' },
    rotatable: true, preload: true, rolls: true
  },
  // ---- glass -------------------------------------------------------------
  glass_block_l: {
    file: 'glass/glass_block_large.png', material: 'glass',
    content: [135, 137], size: [78, 79], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  glass_block_s: {
    file: 'glass/glass_block_small.png', material: 'glass',
    content: [99, 99], size: [58, 58], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  glass_beam_h: {
    file: 'glass/glass_beam_horizontal.png', material: 'glass',
    content: [189, 80], size: [164, 70], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  glass_column: {
    file: 'glass/glass_column.png', material: 'glass',
    content: [82, 138], size: [52, 88], collider: { shape: 'rect', inset: 3 },
    rotatable: true, preload: true
  },
  glass_triangle: {
    file: 'glass/glass_triangle.png', material: 'glass',
    content: [164, 114], size: [90, 62], collider: { shape: 'rect', inset: 8 },
    rotatable: false, preload: true
  },
  glass_orb: {
    file: 'glass/glass_orb.png', material: 'glass',
    content: [121, 121], size: [56, 56], collider: { shape: 'circle' },
    rotatable: true, preload: true, rolls: true
  },
  // damaged visual variants (swapped in below 50% hp — art, not behavior)
  glass_block_cracked: {
    file: 'glass/glass_block_cracked.png', material: 'glass',
    content: [133, 122], size: [78, 79], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true, variantOf: 'glass_block_l'
  },
  stone_broken: {
    file: 'stone/stone_broken.png', material: 'stone',
    content: [148, 117], size: [76, 76], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true, variantOf: 'stone_block_l'
  },
  // ---- props -------------------------------------------------------------
  barrel_wood: {
    file: 'props/barrel_wood.png', material: 'wood',
    content: [132, 144], size: [60, 66], collider: { shape: 'circle' },
    rotatable: true, preload: true, rolls: true
  },
  crate_tnt: {
    file: 'props/crate_tnt.png', material: 'boom',
    content: [155, 133], size: [72, 62], collider: { shape: 'rect', inset: 3 },
    rotatable: false, preload: true
  },
  sign_blank: {
    file: 'props/sign_blank_wood.png', material: 'wood',
    content: [158, 110], size: [116, 80], collider: { shape: 'rect', inset: 5 },
    rotatable: false, preload: true
  },
  // decorative only (no physics unless placed with one explicitly)
  lantern: {
    file: 'props/lantern.png', material: 'wood',
    content: [70, 134], size: [38, 74], collider: { shape: 'none' },
    rotatable: false, preload: false
  },
  nest_eggs: {
    file: 'props/nest_eggs.png', material: 'wood',
    content: [188, 136], size: [82, 60], collider: { shape: 'none' },
    rotatable: false, preload: false
  },
  bullseye: {
    file: 'props/bullseye_target.png', material: 'wood',
    content: [132, 147], size: [58, 66], collider: { shape: 'none' },
    rotatable: false, preload: false
  },
  // ---- pigs (decorative occupants; never answer targets) -----------------
  pig_small: {
    file: 'pigs/pig_small.png', material: 'pig',
    content: [138, 121], size: [64, 56], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_medium: {
    file: 'pigs/pig_medium.png', material: 'pig',
    content: [162, 145], size: [74, 66], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_king: {
    file: 'pigs/pig_king.png', material: 'pig',
    content: [176, 179], size: [72, 73], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_worker: {
    file: 'pigs/pig_worker.png', material: 'pig',
    content: [146, 154], size: [62, 66], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_helmet: {
    file: 'pigs/pig_helmet.png', material: 'pig',
    content: [164, 143], size: [72, 63], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_aviator: {
    file: 'pigs/pig_aviator.png', material: 'pig',
    content: [174, 138], size: [76, 60], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_angry: {
    file: 'pigs/pig_angry.png', material: 'pig',
    content: [155, 151], size: [68, 66], collider: { shape: 'circle' },
    rotatable: false, preload: true
  },
  pig_chef: {
    file: 'pigs/pig_chef.png', material: 'pig',
    content: [150, 187], size: [58, 72], collider: { shape: 'circle' },
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
