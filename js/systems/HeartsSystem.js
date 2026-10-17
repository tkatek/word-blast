/**
 * HeartsSystem — the level-life rules for the top HUD (Fix #17).
 * Pure module, no Phaser, fully deterministic and unit-tested.
 *
 * Rules (integrated with the existing retry flow):
 *   - A level starts with `max` hearts (HUD.HEARTS_PER_LEVEL).
 *   - Exactly ONE heart is consumed when a question attempt fails because
 *     its available shots are exhausted — never per individual missed or
 *     wrong shot inside that attempt, and never twice for the same failure
 *     (a `charge()` guard flag clears only when the next question loads).
 *   - Hearts remaining > 0 → the failed question may be retried
 *     (the existing LEVEL_FAILED → QUESTION_READY path).
 *   - Hearts reaching 0 → the existing level-failed state is terminal for
 *     the level (retry-question is withdrawn).
 *   - Hearts reset to full on a new level or an explicit level restart.
 */
export class HeartsSystem {
  constructor(max = 3) {
    this.max = Math.max(1, max | 0);
    this.remaining = this.max;
    this.charged = false; // one-charge-per-failed-attempt guard
  }

  /** Full reset (new level / restart level). */
  reset(max) {
    if (typeof max === 'number' && max >= 1) this.max = max | 0;
    this.remaining = this.max;
    this.charged = false;
  }

  /**
   * Consume one heart for a failed question attempt. Idempotent per
   * attempt: returns false when this attempt was already charged.
   * @returns {boolean} true if a heart was consumed now
   */
  charge() {
    if (this.charged || this.remaining <= 0) return false;
    this.charged = true;
    this.remaining -= 1;
    return true;
  }

  /** Index (0-based, left-to-right) of the heart just lost, or -1. */
  lastLostIndex() {
    return this.remaining >= 0 && this.remaining < this.max ? this.remaining : -1;
  }

  get empty() {
    return this.remaining <= 0;
  }

  /** Clear the charge guard — called when the next question loads. */
  clearCharge() {
    this.charged = false;
  }
}
