/**
 * Level data layer: validation + accessors for the 15 levels.
 * Pure module — no Phaser. The GameScene + PhysicsObjects build the actual
 * Matter bodies from this data; nothing about structures is hardcoded in
 * scene code.
 */
import { validateLevels } from './Validators.js';
import { WORLD, LAYOUT_BAKED_GROUND_Y, BIRD_AMMO } from '../config.js';

export class LevelManager {
  /**
   * @param {object} levelsData parsed levels.json
   * @param {object[]} questions parsed questions.json (for cross-validation)
   */
  constructor(levelsData, questions) {
    this.raw = levelsData;
    this.levels = (levelsData && levelsData.levels) || [];
    const result = validateLevels(levelsData, questions || []);
    this.validation = result;
    if (!result.ok) {
      throw new Error(`Level set invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    this.byId = new Map(this.levels.map((l) => [l.id, l]));
  }

  get count() {
    return this.levels.length;
  }

  getLevel(id) {
    return this.byId.get(id) || null;
  }

  getQuestionEntry(levelId, index) {
    const lvl = this.getLevel(levelId);
    if (!lvl || index < 0 || index >= lvl.questions.length) return null;
    return lvl.questions[index];
  }

  /**
   * Per-question runtime layout: pieces + pigs + targets + movers.
   * Layouts are baked against LAYOUT_BAKED_GROUND_Y and translated RIGIDLY
   * (never scaled, so tower stacking survives exactly) onto the live flat
   * ground WORLD.GROUND_Y — the same single surface on every device.
   */
  getLayout(levelId, index) {
    const entry = this.getQuestionEntry(levelId, index);
    if (!entry) return null;
    const l = entry.layout || {};
    const base = {
      pieces: l.pieces || [],
      pigs: l.pigs || [],
      targets: l.targets || [],
      moving: l.moving || []
    };
    const dy = WORLD.GROUND_Y - LAYOUT_BAKED_GROUND_Y;
    if (dy === 0) return base;
    const move = (p) => ({ ...p, x: p.x, y: +(p.y + dy).toFixed(1) });
    return {
      pieces: base.pieces.map(move),
      pigs: base.pigs.map(move),
      targets: base.targets.map(move),
      moving: base.moving.map(move)
    };
  }

  isProjectileAvailable(levelId, typeKey) {
    const lvl = this.getLevel(levelId);
    return !!lvl && lvl.projectiles.includes(typeKey);
  }

  /**
   * Fix #19 — per-level bird ammunition (data-driven from levels.json
   * "birdAmmo"). Only roster members are returned; a level without the
   * block falls back to BIRD_AMMO.DEFAULTS (intersects the roster). The
   * GameScene resets these counts at the start of every question
   * (BIRD_AMMO.MODE 'per-question'); a future 'per-level' shared pool can
   * be enabled by switching that mode after rebalancing.
   */
  getBirdAmmo(levelId) {
    const lvl = this.getLevel(levelId);
    const roster = lvl ? lvl.projectiles : [];
    const raw = lvl && lvl.birdAmmo && typeof lvl.birdAmmo === 'object' ? lvl.birdAmmo : null;
    const ammo = {};
    for (const key of roster) {
      ammo[key] = raw && Number.isFinite(raw[key])
        ? Math.max(0, Math.floor(raw[key]))
        : (BIRD_AMMO.DEFAULTS[key] ?? 0);
    }
    return ammo;
  }

  totalShotsForLevel(levelId) {
    const lvl = this.getLevel(levelId);
    return lvl ? lvl.shotsPerQuestion * lvl.questions.length : 0;
  }
}
