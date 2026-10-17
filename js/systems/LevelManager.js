/**
 * Level data layer: validation + accessors for the 15 levels.
 * Pure module — no Phaser. The GameScene + PhysicsObjects build the actual
 * Matter bodies from this data; nothing about structures is hardcoded in
 * scene code.
 */
import { validateLevels } from './Validators.js';
import { WORLD, LAYOUT_BAKED_GROUND_Y } from '../config.js';

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

  totalShotsForLevel(levelId) {
    const lvl = this.getLevel(levelId);
    return lvl ? lvl.shotsPerQuestion * lvl.questions.length : 0;
  }
}
