/**
 * BirdInventory — the authoritative bird ammunition model (Fix #19).
 *
 * Pure logic, no Phaser: unit-testable like the rest of the data layer.
 * The UI (BirdSelector) only ever RENDERS what this class rules.
 *
 * Rules enforced here (spec §2):
 *   - selecting a bird consumes nothing; only consume() on launch removes
 *     exactly one unit
 *   - counts can never go negative (consume() on an empty type returns false)
 *   - ability activation and split-generated children never touch inventory
 *   - a bird with zero ammo (or one outside the level roster) cannot be
 *     selected — canSelect() is the single gate
 *   - MODE 'per-question' (enabled): resetForQuestion() re-initializes the
 *     configured counts at the start of every question, so all four English
 *     challenges stay fair. MODE 'per-level' is supported (configure() keeps
 *     the initial counts across questions) but intentionally not enabled
 *     until the 15 levels are rebalanced and verified.
 */
import { BIRD_AMMO } from '../config.js';

export class BirdInventory {
  /**
   * @param {string[]} roster projectile keys usable this level
   *        (level.projectiles — basic/speed/split/bomb/ice)
   * @param {object} ammo initial counts keyed by projectile key
   *        (level.birdAmmo from levels.json; missing entries fall back to
   *        BIRD_AMMO.DEFAULTS)
   * @param {string} [mode] BIRD_AMMO.MODE override ('per-question'|'per-level')
   */
  constructor(roster = [], ammo = {}, mode = BIRD_AMMO.MODE) {
    this.mode = mode === 'per-level' ? 'per-level' : 'per-question';
    this.roster = [];
    this.initial = {};
    this.counts = {};
    this.configure(roster, ammo);
  }

  /**
   * Normalize a roster + ammo table into the live inventory. Unknown keys
   * are dropped; negative counts clamp to 0; roster members missing from
   * `ammo` inherit BIRD_AMMO.DEFAULTS.
   */
  configure(roster, ammo = {}) {
    this.roster = [...roster];
    this.initial = {};
    for (const key of this.roster) {
      const raw = ammo[key];
      const def = BIRD_AMMO.DEFAULTS[key] ?? 0;
      const n = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : def;
      this.initial[key] = n;
    }
    this.reset();
    return this;
  }

  /** Re-initialize to the configured counts (per-question mode entry point). */
  reset() {
    this.counts = { ...this.initial };
    return this;
  }

  /** Alias matching the question lifecycle vocabulary. */
  resetForQuestion() {
    return this.reset();
  }

  /** Remaining ammo of one bird type (0 when outside the roster). */
  count(key) {
    return this.counts[key] ?? 0;
  }

  /** True when the type can currently be selected (roster + ammo). */
  canSelect(key) {
    return this.roster.includes(key) && this.count(key) > 0;
  }

  /**
   * Consume exactly one unit for a launch. Returns false (and consumes
   * nothing) when the type is empty or unknown — inventory can never go
   * negative. Selecting / ability activation never call this.
   */
  consume(key) {
    if (!this.canSelect(key)) return false;
    this.counts[key] -= 1;
    return true;
  }

  /** Roster keys that still have ammunition, in roster order. */
  available() {
    return this.roster.filter((k) => this.count(k) > 0);
  }

  /** True when no bird of any type remains. */
  get empty() {
    return this.available().length === 0;
  }

  /** First selectable key in roster order (null when everything is out). */
  firstAvailable() {
    return this.available()[0] ?? null;
  }

  /** Snapshot for HUD / debugging (never the live object). */
  snapshot() {
    return { ...this.counts };
  }
}
