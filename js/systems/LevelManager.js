/**
 * Level data layer: validation + accessors for the 15 levels.
 * Pure module — no Phaser. The GameScene + PhysicsObjects build the actual
 * Matter bodies from this data; nothing about structures is hardcoded in
 * scene code.
 */
import { validateLevels } from './Validators.js';

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

  /** Per-question runtime layout: blocks + targets + moving obstacles. */
  getLayout(levelId, index) {
    const entry = this.getQuestionEntry(levelId, index);
    if (!entry) return null;
    return {
      blocks: (entry.layout && entry.layout.blocks) || [],
      targets: (entry.layout && entry.layout.targets) || [],
      moving: (entry.layout && entry.layout.moving) || []
    };
  }

  isProjectileAvailable(levelId, typeKey) {
    const lvl = this.getLevel(levelId);
    return !!lvl && lvl.projectiles.includes(typeKey);
  }

  get totalShotsForLevel(levelId) {
    const lvl = this.getLevel(levelId);
    return lvl ? lvl.shotsPerQuestion * lvl.questions.length : 0;
  }
}
