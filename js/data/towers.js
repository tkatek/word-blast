/**
 * TOWER TEMPLATE LIBRARY — modular structures assembled from independent
 * physical pieces. Pure module (no Phaser): the level generator expands
 * these into absolute piece lists in levels.json; the physics factory
 * instantiates them as individual Matter bodies + sprites.
 *
 * Coordinate convention:
 *   - Template origin (0,0) sits at the CENTER of the structure's footprint
 *     ON the ground surface (terrace top). x grows right, y grows UP
 *     (templates are authored bottom-up; instantiation flips to screen y).
 *   - Pieces are placed by CENTER, computed so resting faces touch exactly
 *     (zero overlap — verified mechanically by scripts/check-towers.mjs).
 *   - `slots` are answer-plaque anchor centers (plaque is 116x80, so a slot
 *     resting on a surface at height h sits at h + 40).
 *   - `pigs` are decorative occupants — they never carry answer data.
 *
 * Stability contract: every resting face is backed by a real piece below
 * (no floating parts, no invisible constraints). The headless stability
 * battery re-verifies this with real Matter physics for all 60 layouts.
 */
import { TOWER_ASSETS } from './tower-assets.js';

const H = (key) => TOWER_ASSETS[key].size[1]; // logical height
const W = (key) => TOWER_ASSETS[key].size[0]; // logical width

const plaqueHalf = 40; // TARGETS.HEIGHT / 2 — literal to stay dependency-light
const pigHalf = (key) => TOWER_ASSETS[key].size[1] / 2;

/** Two posts + a plank across their tops. Returns pieces + surface height. */
function frame(postKey, plankKey, halfSpan) {
  const postH = H(postKey);
  return {
    pieces: [
      { a: postKey, x: -halfSpan, y: postH / 2 },
      { a: postKey, x: halfSpan, y: postH / 2 },
      { a: plankKey, x: 0, y: postH + H(plankKey) / 2 }
    ],
    top: postH + H(plankKey)
  };
}

export const TEMPLATES = {
  /* ---- tier 1 (L1–5): small wood structures, generous arcs ------------- */
  pedestal: {
    width: 110, height: 210,
    pieces: [{ a: 'wood_crate_cross', x: 0, y: H('wood_crate_cross') / 2 }],
    slots: [{ x: 0, y: H('wood_crate_cross') + plaqueHalf }],
    pigs: []
  },
  panel_pedestal: {
    width: 90, height: 175,
    pieces: [{ a: 'wood_crate_panel', x: 0, y: H('wood_crate_panel') / 2 }],
    slots: [{ x: 0, y: H('wood_crate_panel') + plaqueHalf }],
    pigs: []
  },
  wood_frame: {
    width: 210, height: 268,
    ...withFrame(frame('wood_beam_v', 'wood_beam_h', 62)),
    pigs: [{ a: 'pig_small', x: 0, y: pigHalf('pig_small') }]
  },
  crate_pyramid: {
    width: 160, height: 240,
    pieces: [
      { a: 'wood_crate_panel', x: -36, y: H('wood_crate_panel') / 2 },
      { a: 'wood_crate_panel', x: 36, y: H('wood_crate_panel') / 2 },
      { a: 'wood_crate_cross', x: 0, y: H('wood_crate_panel') + H('wood_crate_cross') / 2 }
    ],
    slots: [{ x: 0, y: H('wood_crate_panel') + H('wood_crate_cross') + plaqueHalf }],
    pigs: []
  },
  log_stand: {
    width: 176, height: 195,
    pieces: [
      { a: 'wood_log', x: -30, y: 30 },
      { a: 'wood_log', x: 30, y: 30 },
      { a: 'wood_beam_h', x: 0, y: 60 + H('wood_beam_h') / 2 }
    ],
    slots: [{ x: 0, y: 60 + H('wood_beam_h') + plaqueHalf }],
    pigs: []
  },
  asym_peak: {
    width: 240, height: 250,
    // tall post + triangle peak on the left, low crate on the right
    pieces: [
      { a: 'wood_beam_v', x: -80, y: H('wood_beam_v') / 2 },
      { a: 'wood_triangle', x: -80, y: H('wood_beam_v') + H('wood_triangle') / 2 },
      { a: 'wood_crate_cross', x: 50, y: H('wood_crate_cross') / 2 }
    ],
    slots: [{ x: 50, y: H('wood_crate_cross') + plaqueHalf }],
    pigs: []
  },

  /* ---- tier 2 (L6–10): mixed materials, protected targets -------------- */
  glass_frame: {
    width: 200, height: 242,
    ...withFrame(frame('glass_column', 'glass_beam_h', 60)),
    pigs: [{ a: 'pig_small', x: 0, y: pigHalf('pig_small') }]
  },
  stone_keep: {
    width: 270, height: 308,
    pieces: [
      { a: 'stone_block_l', x: -38, y: H('stone_block_l') / 2 },
      { a: 'stone_block_l', x: 38, y: H('stone_block_l') / 2 },
      { a: 'stone_beam_h', x: 0, y: H('stone_block_l') + H('stone_beam_h') / 2 },
      { a: 'wood_crate_cross', x: 0, y: H('stone_block_l') + H('stone_beam_h') + H('wood_crate_cross') / 2 }
    ],
    slots: [{ x: 0, y: H('stone_block_l') + H('stone_beam_h') + H('wood_crate_cross') + plaqueHalf }],
    pigs: [{ a: 'pig_worker', x: 130, y: pigHalf('pig_worker') }]
  },
  bridge: {
    width: 360, height: 230,
    // stone columns carry a stone beam; barrels flank them on the ground,
    // the plaque rests on the beam, a pig shelters underneath
    pieces: [
      { a: 'stone_column', x: -80, y: H('stone_column') / 2 },
      { a: 'stone_column', x: 80, y: H('stone_column') / 2 },
      { a: 'stone_beam_h', x: 0, y: H('stone_column') + H('stone_beam_h') / 2 },
      { a: 'barrel_wood', x: -145, y: 30 },
      { a: 'barrel_wood', x: 145, y: 30 }
    ],
    slots: [{ x: 0, y: H('stone_column') + H('stone_beam_h') + plaqueHalf }],
    pigs: [{ a: 'pig_medium', x: 0, y: pigHalf('pig_medium') }]
  },
  shelter_wall: {
    width: 280, height: 190,
    // stacked wall in front (left), ground plaque sheltered behind (right)
    pieces: [
      { a: 'stone_block_l', x: -95, y: H('stone_block_l') / 2 },
      { a: 'stone_block_l', x: -95, y: H('stone_block_l') * 1.5 },
      { a: 'wood_crate_panel', x: -15, y: H('wood_crate_panel') / 2 },
      { a: 'wood_crate_panel', x: -15, y: H('wood_crate_panel') * 1.5 }
    ],
    slots: [{ x: 85, y: plaqueHalf }],
    pigs: []
  },
  glass_house: {
    width: 210, height: 300,
    // glass walls sheltering a stone core; plaque on the core
    pieces: [
      { a: 'glass_column', x: -76, y: H('glass_column') / 2 },
      { a: 'glass_column', x: 76, y: H('glass_column') / 2 },
      { a: 'glass_beam_h', x: 0, y: H('glass_column') + H('glass_beam_h') / 2 },
      { a: 'stone_block_s', x: 0, y: H('glass_column') + H('glass_beam_h') + H('stone_block_s') / 2 }
    ],
    slots: [{ x: 0, y: H('glass_column') + H('glass_beam_h') + H('stone_block_s') + plaqueHalf }],
    pigs: []
  },

  /* ---- tier 3 (L11–15): taller, combined mechanics ---------------------- */
  two_storey: {
    width: 300, height: 380,
    pieces: [
      { a: 'stone_column', x: -64, y: H('stone_column') / 2 },
      { a: 'stone_column', x: 64, y: H('stone_column') / 2 },
      { a: 'stone_beam_h', x: 0, y: H('stone_column') + H('stone_beam_h') / 2 },
      { a: 'wood_crate_cross', x: 0, y: 150 + H('wood_crate_cross') / 2 },
      { a: 'wood_beam_h', x: 0, y: 150 + H('wood_crate_cross') + H('wood_beam_h') / 2 }
    ],
    slots: [{ x: 0, y: 150 + H('wood_crate_cross') + H('wood_beam_h') + plaqueHalf }],
    pigs: [
      { a: 'pig_small', x: 0, y: pigHalf('pig_small') },
      { a: 'pig_king', x: 150, y: pigHalf('pig_king') }
    ]
  },
  glass_tower: {
    width: 190, height: 370,
    pieces: [
      { a: 'glass_column', x: -54, y: H('glass_column') / 2 },
      { a: 'glass_column', x: 54, y: H('glass_column') / 2 },
      { a: 'glass_beam_h', x: 0, y: H('glass_column') + H('glass_beam_h') / 2 },
      { a: 'glass_block_s', x: -32, y: 158 + H('glass_block_s') / 2 },
      { a: 'glass_block_s', x: 32, y: 158 + H('glass_block_s') / 2 },
      { a: 'glass_beam_h', x: 0, y: 158 + H('glass_block_s') + H('glass_beam_h') / 2 }
    ],
    slots: [{ x: 0, y: 158 + H('glass_block_s') + H('glass_beam_h') + plaqueHalf }],
    pigs: []
  },
  tnt_depot: {
    width: 360, height: 330,
    // TNT crate inside a wood frame, second TNT on the roof plank
    pieces: [
      { a: 'wood_beam_v', x: -76, y: H('wood_beam_v') / 2 },
      { a: 'wood_beam_v', x: 76, y: H('wood_beam_v') / 2 },
      { a: 'crate_tnt', x: 0, y: H('crate_tnt') / 2 },
      { a: 'wood_beam_h', x: 0, y: H('wood_beam_v') + H('wood_beam_h') / 2 },
      { a: 'crate_tnt', x: 0, y: H('wood_beam_v') + H('wood_beam_h') + H('crate_tnt') / 2 }
    ],
    slots: [
      { x: 0, y: H('wood_beam_v') + H('wood_beam_h') + H('crate_tnt') + plaqueHalf },
      { x: 160, y: plaqueHalf }
    ],
    pigs: [{ a: 'pig_helmet', x: -160, y: pigHalf('pig_helmet') }]
  },
  fortress: {
    width: 260, height: 285,
    // two stone towers + a beam between them; plaques on tower tops + beam
    pieces: [
      { a: 'stone_block_l', x: -80, y: H('stone_block_l') / 2 },
      { a: 'stone_block_l', x: 80, y: H('stone_block_l') / 2 },
      { a: 'stone_block_s', x: -80, y: H('stone_block_l') + H('stone_block_s') / 2 },
      { a: 'stone_block_s', x: 80, y: H('stone_block_l') + H('stone_block_s') / 2 },
      { a: 'stone_beam_h', x: 0, y: H('stone_block_l') + H('stone_block_s') + H('stone_beam_h') / 2 }
    ],
    slots: [
      { x: -80, y: H('stone_block_l') + H('stone_block_s') + plaqueHalf },
      { x: 80, y: H('stone_block_l') + H('stone_block_s') + plaqueHalf },
      { x: 0, y: H('stone_block_l') + H('stone_block_s') + H('stone_beam_h') + plaqueHalf }
    ],
    pigs: []
  },
  leaning_tower: {
    width: 250, height: 330,
    pieces: [
      { a: 'stone_block_l', x: 0, y: H('stone_block_l') / 2 },
      { a: 'wood_crate_cross', x: 0, y: H('stone_block_l') + H('wood_crate_cross') / 2 },
      { a: 'wood_crate_cross', x: 0, y: H('stone_block_l') + H('wood_crate_cross') * 1.5 }
    ],
    slots: [{ x: 0, y: H('stone_block_l') + H('wood_crate_cross') * 2 + plaqueHalf }],
    pigs: [{ a: 'pig_angry', x: 110, y: pigHalf('pig_angry') }]
  }
};

function withFrame(f) {
  return {
    pieces: f.pieces,
    slots: [{ x: 0, y: f.top + plaqueHalf }]
  };
}

/**
 * Expand a template instance into absolute world-space definitions.
 * @param {string} key template name
 * @param {number} baseX footprint center X (world)
 * @param {number} groundY ground surface Y the structure stands on (world)
 * @param {object} [opts] { mirror } flip horizontally
 */
export function instantiate(key, baseX, groundY, opts = {}) {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`unknown tower template "${key}"`);
  const m = opts.mirror ? -1 : 1;
  const pieces = t.pieces.map((p, i) => ({
    id: `${key}@${baseX}#${i}`,
    a: p.a,
    x: +(baseX + p.x * m).toFixed(1),
    y: +(groundY - p.y).toFixed(1),
    rot: p.rot || 0
  }));
  const pigs = t.pigs.map((p, i) => ({
    id: `${key}@${baseX}-pig${i}`,
    a: p.a,
    x: +(baseX + p.x * m).toFixed(1),
    y: +(groundY - p.y).toFixed(1)
  }));
  const slots = t.slots.map((s) => ({
    x: +(baseX + s.x * m).toFixed(1),
    y: +(groundY - s.y).toFixed(1)
  }));
  return { template: key, baseX, pieces, pigs, slots, width: t.width, height: t.height };
}

/** Template names for a difficulty tier (1=early .. 3=late). */
export function templatesForTier(tier) {
  if (tier <= 1) return ['pedestal', 'panel_pedestal', 'wood_frame', 'crate_pyramid', 'log_stand', 'asym_peak'];
  if (tier === 2) return ['wood_frame', 'glass_frame', 'stone_keep', 'bridge', 'shelter_wall', 'glass_house', 'crate_pyramid', 'asym_peak'];
  return ['two_storey', 'glass_tower', 'tnt_depot', 'fortress', 'leaning_tower', 'bridge', 'stone_keep', 'glass_house'];
}
