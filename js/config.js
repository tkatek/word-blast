/**
 * WORD BLAST — central configuration.
 * All gameplay tuning lives here (or in js/data/*.json).
 * Nothing in this file imports Phaser, so it stays unit-testable in Node.
 */

export const WORLD = {
  WIDTH: 1280,
  HEIGHT: 720,
  GROUND_Y: 560,          // top surface of the MAIN gameplay terrace (towers)
  GROUND_THICKNESS: 240,  // extends below the visible area
  // Canonical slingshot anchor (aliases SLINGSHOT.ANCHORS.desktop — kept
  // for the test suite and headless helpers; gameplay code reads the live
  // anchor off the Slingshot).
  SLING_X: 175,
  SLING_Y: 390,
  KILL_MARGIN: 260        // bodies this far outside the world get removed
};

/**
 * Canonical gameplay terrain (world px). Two flat surfaces:
 *  - LEFT plateau (slingshot): top y=448, spans x -120..390
 *  - MAIN terrace (towers):    top y=560, spans x 430..1400
 * The 40px gap between them shows the painted water; anything falling into
 * it leaves the playable area and is cleaned up. The foreground terrain
 * layer is drawn FROM THESE NUMBERS, so visual ground == collision ground
 * on every device — backgrounds can never shift live physics.
 */
export const TERRAIN = {
  PLATEAU: { left: -120, right: 390, top: 448 },
  TERRACE: { left: 430, right: 1400, top: 560 },
  get WATER_GAP() { return [this.PLATEAU.right, this.TERRACE.left]; }
};

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
   * Pouch rest position (world px in the fixed 1280×720 logical world).
   * The canonical anchor stands the slingshot on the FOREGROUND plateau
   * (TERRAIN.PLATEAU.top, identical on every device), so the anchor is the
   * same for all backgrounds: painted cliff heights can differ per art,
   * but the gameplay ground is the drawn foreground layer. Per-device
   * entries remain for compatibility and are all canonical.
   */
  ANCHORS: {
    desktop: { x: 175, y: 390 },
    tablet: { x: 175, y: 390 },
    mobile: { x: 175, y: 390 }
  },
  BASE_OFFSET_Y: 58        // pouch rest → wooden base (grass contact at 448)
};

/** Slingshot pouch anchor for a device type (clone; safe to mutate). */
export function slingshotAnchor(deviceType) {
  const a = SLINGSHOT.ANCHORS[deviceType] || SLINGSHOT.ANCHORS.desktop;
  return { x: a.x, y: a.y };
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
    abilityHint: 'Freezes and weakens blocks on first impact'
  },
  split: {
    key: 'split',
    name: 'Split',
    radius: 17,
    density: 0.0022,
    restitution: 0.35,
    frictionAir: 0.005,
    ability: 'split',
    abilityHint: 'Tap while flying: splits into three'
  },
  bomb: {
    key: 'bomb',
    name: 'Bomb',
    radius: 17,
    density: 0.0028,
    restitution: 0.2,
    frictionAir: 0.005,
    ability: 'detonate',
    abilityHint: 'Explodes on first impact'
  }
};

export const SPLIT_CHILD = {
  radius: 11,
  density: 0.0022,
  spreadAngleDeg: 11,
  restitution: 0.35,
  frictionAir: 0.005
};

export const BOOST = { MULTIPLIER: 1.6 };

export const TARGETS = {
  WIDTH: 116,             // logical plaque size (sign_blank_wood art)
  HEIGHT: 80,
  COLLIDER_INSET: 5,      // collider slightly inside the visible board
  RESTITUTION: 0.15,      // wooden plaques should not ping-pong
  CHOICE_LABELS: ['A', 'B', 'C'],
  RESPAWN_PUFF: true      // out-of-bounds plaque recovery shows a puff
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

export const COLORS = {
  SKY: 0x8ecae6,
  GROUND: 0x588157,
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
    speed: 0xfdca40,
    ice: 0x7bdff2,
    split: 0x9d4edd,
    bomb: 0x3a3a3a
  },
  TRAJECTORY: 0xffffff,
  HUD_BACKGROUND: 0x1d3557,
  HUD_TEXT: '#ffffff',
  FROZEN_TINT: 0x88ccff
};
