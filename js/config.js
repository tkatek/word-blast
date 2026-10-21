/**
 * WORD BLAST — central configuration.
 * All gameplay tuning lives here (or in js/data/*.json).
 * Nothing in this file imports Phaser, so it stays unit-testable in Node.
 */

export const WORLD = {
  WIDTH: 1280,
  HEIGHT: 720,
  /**
   * THE gameplay ground — one flat, continuous surface across the whole
   * world. Everything stands on it: slingshot on the left, answer towers
   * center-right. It is the ONLY ground constant in the codebase:
   *   - the invisible static Matter.js collider top is exactly GROUND_Y
   *     (PhysicsObjects.createTerrain)
   *   - the background art is placed so its painted grass line lands on
   *     GROUND_Y (BackgroundManager.computeBackgroundFit)
   *   - the slingshot base rests on it (SLINGSHOT.ANCHOR.y + BASE_OFFSET_Y)
   *   - baked level layouts are translated onto it at runtime
   *     (LevelManager, via LAYOUT_BAKED_GROUND_Y)
   * Change it here and the whole game follows — never anywhere else.
   */
  GROUND_Y: 471,
  // Canonical slingshot pouch anchor (aliases SLINGSHOT.ANCHOR — kept for
  // the test suite and headless helpers; gameplay code reads the live
  // anchor off the Slingshot).
  SLING_X: 195,
  SLING_Y: 346,
  KILL_MARGIN: 260        // bodies this far outside the world get removed
};

/**
 * The official gameplay background — ONE flat-grass landscape for every
 * device (desktop, laptop, tablet, phone landscape). GRASS_LINE_Y is the
 * painted top edge of the flat grassy foreground, measured across the full
 * art width (scripts/analyze-grass.mjs). The BackgroundManager aligns that
 * line onto WORLD.GROUND_Y, so the visible grass and the invisible collider
 * can never drift apart.
 */
export const BACKGROUND = {
  FILE: 'gameplay.webp',
  GRASS_LINE_Y: 615       // px from the top of the 1672×941 source art
};

/**
 * Level layouts in levels.json are baked against this ground line
 * (structures' base pieces sit on it). LevelManager rigidly translates
 * them onto the live WORLD.GROUND_Y at runtime — translation only, never
 * scaled, so tower stacking geometry is preserved exactly. If the ground
 * ever moves, the layouts follow automatically.
 */
export const LAYOUT_BAKED_GROUND_Y = 428;

export const PHYSICS = {
  GRAVITY_Y: 1,
  ENABLE_SLEEPING: true,
  // Matter integrates gravity as:  dV per step = gravity.y * gravityScale * dt^2
  // with gravityScale 0.001 and dt = 1000/60  ->  0.27778 px/step per step.
  G_STEP: 0.27778,
  SETTLE_SPEED: 0.25,      // bodies slower than this count as "at rest"
  SETTLE_FRAMES: 45,       // must stay slow this many frames for physics to be "resolved"
  SETTLE_TIMEOUT_MS: 6000, // never wait longer than this for physics to settle
  SHOT_TIMEOUT_MS: 9000,   // force-resolve a shot after this long (anti-stuck)
  // Shot resolution (miss/wrong path): the shot only counts as over after
  // EVERYTHING dynamic has stayed quiet this many consecutive frames —
  // projectiles AND destructible blocks (movers never settle by design and
  // are excluded). A single slow frame is not enough: a ball can dip below
  // the speed threshold at a bounce apex or while creeping and still reach
  // an answer target afterwards.
  RESOLVE_STABLE_FRAMES: 18,
  PROJECTILE_REST_SPEED: 0.35,
  BLOCK_REST_SPEED: 0.6,
  // Build-time stability: silent fixed steps run before the player can fire.
  SETTLE_STEPS: 75,
  SETTLE_MAX_DRIFT: 8,      // px a piece may move during the settling phase
  // Post-shot grace: tower pieces may keep settling this long after the
  // projectiles stop before the shot is declared resolved.
  DEBRIS_GRACE_MS: 1200
};

/**
 * Answer feedback pacing: minimum visible feedback and a hard cap on the
 * active resolution window after a validated correct answer (spec §9).
 */
export const FEEDBACK = {
  MIN_VISIBLE_MS: 1100,
  MAX_RESOLVE_MS: 3200
};

/** Performance budgets — configuration from profiling, not constants of nature. */
export const BUDGETS = {
  MAX_PIECES: 40,        // destructible pieces per question layout
  MAX_FRAGMENTS: 22,     // physical fragments alive at once
  MAX_EMITTERS: 6,       // simultaneous particle emitters
  MAX_SHAKE: 0.006       // camera shake magnitude cap
};

/**
 * Tunneling guards. Matter.js has no continuous collision detection; the
 * verified geometric mitigation is: every piece's smaller side >= 20px and
 * every projectile slower than (10 + radius) px/step, so a fast ball can
 * never jump clean across a piece in one 60 Hz step.
 */
export const TUNNELING = {
  MIN_PIECE_DIM: 20,
  BOOST_SPEED_CAP: 24,
  SPLIT_CHILD_SPEED_CAP: 20
};

export const SLINGSHOT = {
  MAX_DRAG: 140,
  MIN_POWER_RATIO: 0.12,   // below this the shot is cancelled (dud prevention)
  MAX_SPEED: 24,           // launch velocity magnitude, px/step
  TRAJECTORY_STEPS: 60,
  TRAJECTORY_STEP_MS: 1000 / 60,
  /**
   * Pouch rest position = launch origin (world px in the fixed 1280×720
   * logical world). The handle bottom of the supplied artwork plants into
   * the flat gameplay ground:
   *   ANCHOR.y + BASE_OFFSET_Y === WORLD.GROUND_Y + ART.GRASS_EMBED
   * (asserted by the tests). One ground, one anchor — every device.
   */
  ANCHOR: { x: 195, y: 346 },
  // pouch rest → handle bottom of the artwork at the live scale; includes
  // the grass embed so the base reads as planted, not floating.
  BASE_OFFSET_Y: 133,
  /**
   * Anchors on the supplied wooden slingshot artwork
   * (public/assets/images/slingshot/slingshot-wood.png, 1254×1254 RGBA),
   * NORMALIZED to the texture so every attachment survives re-scaling:
   *   REAR_TIP   left/rear fork tip    (texture px 501, 46)
   *   FRONT_TIP  right/front fork tip  (texture px 864, 88)
   *   POUCH      pouch rest / launch origin, centered in the fork gap
   *                                                  (682, 78)
   *   BASE       handle bottom planted into the grass (732, 1205)
   * Measured from the artwork's alpha silhouette (scripts/measure-slingshot-art.mjs);
   * tune freely — the mechanics all derive from these values. The artwork
   * is rendered as ONE complete static sprite (never cropped or split).
   */
  ART: {
    KEY: 'slingshot-wood',
    TEXTURE_SIZE: 1254,   // reference size; runtime reads the live texture
    REAR_TIP: { x: 0.399522, y: 0.036683 },
    FRONT_TIP: { x: 0.688995, y: 0.070175 },
    POUCH: { x: 0.543860, y: 0.062200 },
    BASE: { x: 0.583732, y: 0.960925 },
    GRASS_EMBED: 8        // px the handle bottom sinks below GROUND_Y
  }
};

/**
 * Slingshot pouch anchor (clone; safe to mutate). The ground is identical
 * on every device, so the anchor is too — the legacy deviceType argument is
 * accepted and ignored for call-site compatibility.
 */
export function slingshotAnchor() {
  return { x: SLINGSHOT.ANCHOR.x, y: SLINGSHOT.ANCHOR.y };
}

/** Destructible materials. hp = damage pool; density drives mass. */
export const MATERIALS = {
  wood: { label: 'wood', hp: 70, density: 0.0009, friction: 0.6, restitution: 0.05, damageScale: 1.0 },
  glass: { label: 'glass', hp: 30, density: 0.0008, friction: 0.4, restitution: 0.1, damageScale: 1.0 },
  stone: { label: 'stone', hp: 130, density: 0.0025, friction: 0.8, restitution: 0.02, damageScale: 1.0 },
  boom: { label: 'boom', hp: 25, density: 0.001, friction: 0.5, restitution: 0.05, damageScale: 1.0, isExplosive: true },
  pig: { label: 'pig', hp: 45, density: 0.0008, friction: 0.5, restitution: 0.15, damageScale: 1.0 }
};

export const DAMAGE = {
  // dmg = closingSpeed * clamp(otherMass, MIN_MASS, MAX_MASS) * FACTOR
  FACTOR: 1.5,
  MIN_MASS: 0.5,
  MAX_MASS: 10,
  MIN_CLOSING_SPEED: 1.2,  // resting contact / micro-vibrations never damage
  PAIR_COOLDOWN_MS: 120,   // dedupe repeated damage from sustained contact
  STRONG_IMPACT: 40        // severity above which camera shake is allowed
};

export const EXPLOSION = {
  RADIUS: 150,
  POWER: 0.09,        // force magnitude scale applied per body (times body mass)
  DAMAGE: 160,        // damage at the blast center, linear falloff to 0 at RADIUS
  ANSWER_TARGET_IMMUNE: true // answer targets are never damaged/validated by blasts
};

export const ICE = {
  RADIUS: 130,
  DURATION_MS: 6000,
  DAMAGE_MULTIPLIER: 2.0
};

/** Projectile roster. Availability per level is defined in levels.json. */
export const PROJECTILE_TYPES = {
  basic: {
    key: 'basic',
    name: 'Basic',
    radius: 16,
    density: 0.0025,
    restitution: 0.35,
    frictionAir: 0.005,
    ability: null,
    abilityHint: ''
  },
  speed: {
    key: 'speed',
    name: 'Speed',
    radius: 15,
    density: 0.0025,
    restitution: 0.3,
    frictionAir: 0.005,
    ability: 'boost',
    abilityHint: 'Tap while flying: forward speed boost (once)'
  },
  ice: {
    key: 'ice',
    name: 'Ice',
    radius: 15,
    density: 0.0024,
    restitution: 0.25,
    frictionAir: 0.005,
    ability: 'freeze',
    abilityHint: 'Tap while flying: freezes & weakens blocks'
  },
  split: {
    key: 'split',
    name: 'Split',
    radius: 17,
    density: 0.0022,
    restitution: 0.35,
    frictionAir: 0.005,
    ability: 'split',
    abilityHint: 'Tap while flying: splits into five'
  },
  bomb: {
    key: 'bomb',
    name: 'Bomb',
    radius: 17,
    density: 0.0028,
    restitution: 0.2,
    frictionAir: 0.005,
    ability: 'detonate',
    abilityHint: 'Tap while flying: detonate the bomb'
  }
};

/**
 * Fix #19 — the yellow bird's split now produces FIVE smaller birds in a fan.
 *
 * Physics notes (reviewed, not just "raised the count"):
 *   - child radius 11 keeps each child's mass at ~0.84 (density 0.0022 ×
 *     π·11²) vs the parent's ~2.0, so five children carry ≈2.1× the parent
 *     mass — speedScale 0.69 (kinetic-energy-preserving) keeps the fan from
 *     injecting excessive energy while still feeling snappy; a purely
 *     momentum-preserving 0.48× would leave the fan sluggish.
 *   - per-child speeds stay under SPLIT_CHILD_SPEED_CAP (tunneling guard).
 *   - SEPARATION offsets spawn each child ≥ SEPARATION px apart along the
 *     axis perpendicular to flight, so no child ever spawns inside a
 *     sibling (2 × radius = 22 px < 24).
 *   - five bodies (not three) stay well inside the engine's broadphase
 *     budget; children share the parent's shotId (one shot identity, one
 *     answer-selection lock per shot).
 */
export const SPLIT_CHILD = {
  COUNT: 5,
  radius: 11,
  density: 0.0022,
  spreadAngleDeg: 11,   // angle BETWEEN adjacent fan rays (total fan ≈ 44°)
  SEPARATION: 24,       // px between adjacent children at spawn (⊥ to flight)
  speedScale: 0.69,     // child speed = parent speed × this (energy-bounded)
  restitution: 0.35,
  frictionAir: 0.005
};

export const BOOST = { MULTIPLIER: 1.6 };

/**
 * Fix #19 — bird ammunition (inventory) defaults.
 *
 * Ammunition is DATA-DRIVEN per level (levels.json "birdAmmo"); this block
 * is only the fallback when a level does not configure it, plus the mode
 * switch. Values follow the proposed starting inventory:
 *   RED 3 · BLUE 2 · YELLOW 2 · BLACK 1 · PURPLE 1  (9 birds total)
 *
 * MODE:
 *   'per-question' — inventory re-initialized at the start of every
 *                    question (the enabled, verified default).
 *   'per-level'    — one shared pool across all four questions of a level.
 *                    SUPPORTED by BirdInventory but NOT enabled: the 15
 *                    levels must be rebalanced and verified first.
 *
 * Ammunition ≠ shots: launching consumes one ammo unit AND one shot; the
 * question's shot limit always binds even when several birds remain.
 */
export const BIRD_AMMO = {
  MODE: 'per-question',
  DEFAULTS: {
    basic: 3,
    speed: 2,
    split: 2,
    bomb: 1,
    ice: 1
  }
};

export const TARGETS = {
  WIDTH: 116,             // canonical plaque size (small variant — audits
  HEIGHT: 80,             // and generators use WIDTH/HEIGHT as the minimum)
  COLLIDER_INSET: 5,      // collider slightly inside the visible board
  RESTITUTION: 0.15,      // wooden plaques should not ping-pong
  CHOICE_LABELS: ['A', 'B', 'C'],
  RESPAWN_PUFF: true,     // out-of-bounds plaque recovery shows a puff
  /**
   * Parchment answer panels. S/M/L are the original baked variants of one
   * design; XL is the newly uploaded wide parchment artwork for sentences
   * (scripts/build-answer-panel-xl.mjs). Panel choice is MEASUREMENT-driven
   * (js/systems/AnswerPanel.js — real Phaser text metrics against each
   * format's parchment writing box), never character-count-driven; the
   * entries below are metadata for audits and legacy tooling.
   */
  VARIANTS: [
    { key: 'answer_panel_s', width: 116, maxChars: 7 },
    { key: 'answer_panel_m', width: 142, maxChars: 11 },
    { key: 'answer_panel_l', width: 170, maxChars: 19 },
    { key: 'answer_panel_xl', width: 300, maxChars: 99 }
  ],
  MAX_WIDTH: 300,
  /** XL panels keep the mass of the historical L plaque (tower-friendly). */
  DENSITY: 0.0012,
  XL_REFERENCE_MASS: 0.0012 * 170 * 80,
  /** Parchment typography: dark ink on cream, sized to fit the panel. */
  TEXT: {
    FONT: 'Arial',
    MAX_SIZE: 24,          // px — shrink-to-fit never enlarges past this
    MIN_SIZE: 14,          // px — floor; beyond it the L panel is used
    PADDING_X: 16,         // inner padding each side (inside the frame)
    COLOR: '#3d2814',
    BADGE_RADIUS: 12,      // circular letter badge at the panel's top-left
    BADGE_FILL: 0x8a5a2b,
    BADGE_TEXT: '#ffefd8'
  }
};

export const SCORING = {
  BASE_BY_ATTEMPT: [1000, 750, 500, 250], // points by which attempt answered the question
  WRONG_HIT_PENALTY: 100,                 // per wrong answer target hit
  UNUSED_SHOT_BONUS: 150,                 // per unused shot at level end
  COMPLETION_BONUS: 500,                  // finishing all four questions
  MIN_SCORE: 0
};

export const SAVE = {
  KEY: 'wordblast.save',
  VERSION: 1,
  MAX_LEVELS: 15,
  QUESTIONS_PER_LEVEL: 4,
  CHOICES_PER_QUESTION: 3,
  TOTAL_QUESTIONS: 60
};

/** CEFR ordering used by the difficulty-progression validator. */
export const CEFR_ORDER = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+'];

/** Game state machine definitions (see systems/GameStateMachine.js). */
export const STATES = {
  BOOTING: 'BOOTING',
  LOADING: 'LOADING',
  MENU: 'MENU',
  LEVEL_READY: 'LEVEL_READY',
  QUESTION_READY: 'QUESTION_READY',
  AIMING: 'AIMING',
  PROJECTILE_FLYING: 'PROJECTILE_FLYING',
  PHYSICS_RESOLVING: 'PHYSICS_RESOLVING',
  ANSWER_FEEDBACK: 'ANSWER_FEEDBACK',
  NEXT_QUESTION: 'NEXT_QUESTION',
  LEVEL_COMPLETE: 'LEVEL_COMPLETE',
  LEVEL_FAILED: 'LEVEL_FAILED',
  PAUSED: 'PAUSED',
  GAME_COMPLETE: 'GAME_COMPLETE'
};

/** Allowed state transitions. Anything not listed is rejected. */
export const STATE_TRANSITIONS = {
  [STATES.BOOTING]: [STATES.LOADING, STATES.MENU],
  [STATES.LOADING]: [STATES.MENU, STATES.LEVEL_READY],
  [STATES.MENU]: [STATES.LEVEL_READY, STATES.GAME_COMPLETE],
  [STATES.LEVEL_READY]: [STATES.QUESTION_READY, STATES.MENU],
  [STATES.QUESTION_READY]: [STATES.AIMING, STATES.LEVEL_FAILED, STATES.MENU],
  // AIMING -> ANSWER_FEEDBACK: a projectile of the current shot can touch an
  // answer target AFTER the shot already resolved and the slingshot re-armed
  // (ball creeps in below the speed threshold, or debris / a moving obstacle
  // shoves the resting ball). A validated answer must still be honored from
  // there, so the transition is legal.
  [STATES.AIMING]: [STATES.PROJECTILE_FLYING, STATES.ANSWER_FEEDBACK, STATES.LEVEL_FAILED, STATES.MENU],
  [STATES.PROJECTILE_FLYING]: [STATES.PHYSICS_RESOLVING, STATES.ANSWER_FEEDBACK, STATES.LEVEL_FAILED],
  [STATES.PHYSICS_RESOLVING]: [STATES.ANSWER_FEEDBACK, STATES.AIMING, STATES.NEXT_QUESTION, STATES.LEVEL_FAILED],
  [STATES.ANSWER_FEEDBACK]: [STATES.PHYSICS_RESOLVING, STATES.NEXT_QUESTION, STATES.AIMING, STATES.LEVEL_FAILED],
  [STATES.NEXT_QUESTION]: [STATES.QUESTION_READY, STATES.LEVEL_COMPLETE],
  [STATES.LEVEL_COMPLETE]: [STATES.QUESTION_READY, STATES.MENU, STATES.GAME_COMPLETE, STATES.LEVEL_READY],
  [STATES.LEVEL_FAILED]: [STATES.QUESTION_READY, STATES.LEVEL_READY, STATES.MENU],
  [STATES.GAME_COMPLETE]: [STATES.MENU, STATES.LEVEL_READY]
  // PAUSED handled separately by the machine (pausedFrom stack)
};

/**
 * The animated English question card (Fix #9) — the supplied wooden
 * parchment banner (public/assets/images/ui/question-card.png).
 *
 * Geometry ratios were measured from the artwork's pixels
 * (scripts/tmp/analyze-question-card.mjs):
 *   - the trimmed art is 2082×484 (aspect preserved everywhere);
 *   - the parchment writing area sits at x 0.075..0.78 of the card box,
 *     y 0.19..0.815 — text NEVER touches the wooden frame or bolts;
 *   - the blue circular medallion (the audio button) is centered at
 *     (0.8778, 0.4902) with radius 0.0403 × card width.
 *
 * Presentation timeline per question (all values in ms of ACTIVE,
 * unpaused time — the reading countdown is frame-driven and freezes
 * under pause/portrait/auto-pause exactly like the level timer):
 *   CARD_ENTERING (350) → CARD_READING (4000) → CARD_MOVING_TO_TOP (600)
 *   → CARD_READY (gameplay armed) → CARD_EXITING (240) on question change.
<<<<<<< Updated upstream
 * After docking the card is tappable (Fix #21): EXPANDING (460) → EXPANDED
 * (timer frozen, aiming blocked) → COLLAPSING (460) → CARD_READY again.
=======
>>>>>>> Stashed changes
 *
 * TIMINGS is a mutable runtime object: the debug API
 * (window.__WB__.setCardTimings) shortens the phases for automated test
 * runs — production always reads the defaults below.
 */
export const QUESTION_CARD = {
  TEXTURE: 'ui-question-card',
  ART: {
    ASPECT: 484 / 2082,
    TEXT: { x0: 0.075, x1: 0.78, y0: 0.19, y1: 0.815 },
    SPEAKER: { x: 0.8778, y: 0.4902, r: 0.0403 }
  },
  /** Center presentation (world px inside the fixed 1280×720 world). */
  CENTER: { x: 640, y: 352, width: 860 },
  /**
<<<<<<< Updated upstream
   * Docked resting spot (Fix #21): upper-LEFT, below the HUD. The card is
   * the SAME artwork ~18% smaller than the Fix #9 top card (620 → 505) and
   * its left edge sits SAFE_X from the world's left margin, keeping the
   * whole screen center open. The top edge (y 92) keeps a ≥14px gap under
   * the tallest HUD band (phone layout reaches y=78; desktop y=73), so the
   * card never overlaps the HUD on any device. The bottom edge (y≈210)
   * stays above the slingshot fork (y≥260), so aiming is never covered.
   * All 15 level layouts are unaffected: plaques live center-right.
   */
  TOP: { x: 279, y: 151, width: 505 },
  /** Left margin of the docked card (world px from the world's edge). */
  SAFE_X: 26.5,
  TYPE: {
    KICKER: { size: 17, min: 11, color: '#8a5a2b' },
    // The min floors exist for the longest sentence questions: layout is
    // fitted once against the DOCK scale (the smallest readable size), and
    // the enlarged view shows the identical layout scaled up — the "tap to
    // enlarge" hint covers the rare minimum-size case.
    MAIN: { size: 30, min: 12, color: '#3d2814' }
=======
   * Top resting spot: below the HUD (safe 10px gap under its y≤76 band).
   * Deliberately biased left of the tower band: a top-CENTER card would
   * cover up to 22.8% of the answer plaques (they reach y=102 in level
   * 11); at x 110..730 the card covers effectively zero plaques across
   * all 15 levels and leaves the slingshot (x≈195, fork y≥260) clear.
   */
  TOP: { x: 420, y: 158, width: 620 },
  TYPE: {
    KICKER: { size: 18, min: 12, color: '#8a5a2b' },
    MAIN: { size: 30, min: 15, color: '#3d2814' }
>>>>>>> Stashed changes
  },
  TIMINGS: {
    enterMs: 350,     // fade + 0.9→1.0 scale, Sine.easeOut
    readingMs: 4000,  // mandatory centered reading time (spec §2)
<<<<<<< Updated upstream
    moveMs: 600,      // center → dock, Sine.easeInOut (spec §3)
    exitMs: 240,      // brief exit fade on question change / level end
    peekMs: 460       // dock ↔ enlarged reading view, Cubic.easeInOut (Fix #21)
  },
  /** Enlarged reading view (Fix #21): scrim + close affordance. */
  PEEK: { scrimAlpha: 0.38 },
=======
    moveMs: 600,      // center → top, Sine.easeInOut (spec §3)
    exitMs: 240,      // brief exit fade on question change / level end
    peekMs: 320       // top ↔ enlarged reading view
  },
>>>>>>> Stashed changes
  SHADOW: { dy: 7, alpha: 0.2 }
};

/**
 * Top game HUD (Fix #17). Gameplay-facing values only — every color and
 * geometry constant used by the wooden cartoon HUD lives in GameHUD.js
 * next to its rendering code. Keep this block small and tunable:
 * playtesting adjusts TIME_LIMIT_MS / LOW_TIME_MS / HEARTS_PER_LEVEL only.
 */
export const HUD = {
  /** Countdown per level (ms). Proposed default: 5 minutes for 4 questions. */
  TIME_LIMIT_MS: 5 * 60 * 1000,
  /** Below this the timer pill turns red and pulses. */
  LOW_TIME_MS: 30 * 1000,
  /** Lives per level; one is consumed per question attempt failed by
   *  exhausting its shots (never per individual missed shot). */
  HEARTS_PER_LEVEL: 3
};

export const COLORS = {
  SKY: 0x8ecae6,
  WOOD: 0xb08968,
  WOOD_DARK: 0x7f5539,
  GLASS: 0xa8dadc,
  GLASS_DARK: 0x61a5c2,
  STONE: 0x8d99ae,
  STONE_DARK: 0x6c7a92,
  BOOM: 0xe76f51,
  TARGET: 0xfff3b0,
  TARGET_CORRECT_FLASH: 0x90be6d,
  TARGET_WRONG_FLASH: 0xe63946,
  PROJECTILES: {
    basic: 0xd94801,
    speed: 0x48cae4,   // Fix #19: speed bird is the BLUE bird
    ice: 0x7bdff2,
    split: 0xfdca40,   // Fix #19: split bird is the YELLOW bird
    bomb: 0x3a3a3a
  },
  TRAJECTORY: 0xffffff,
  HUD_BACKGROUND: 0x1d3557,
  HUD_TEXT: '#ffffff',
  FROZEN_TINT: 0x88ccff
};
