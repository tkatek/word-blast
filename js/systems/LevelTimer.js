/**
 * LevelTimer — the authoritative per-level countdown (Fix #17).
 * Pure module, no Phaser: the owning scene feeds it frame deltas ONLY while
 * gameplay time is actually flowing (not paused, not in feedback, not in a
 * terminal state), so pause / tab-hidden / portrait rotation can never be
 * bypassed and the clock can never run fast after a restart.
 *
 * Why delta accumulation instead of Date.now()/setTimeout: the scene's
 * update(delta) is the single source of elapsed gameplay time (the same
 * pattern as GameScene.elapsedMs). A setTimeout chain would keep firing
 * while the tab throttles rAF; wall-clock subtraction would count paused
 * time. Accumulating deltas inside the guarded update loop does neither.
 */
export class LevelTimer {
  /**
   * @param {number} limitMs total countdown for the level (HUD.TIME_LIMIT_MS)
   */
  constructor(limitMs) {
    this.limitMs = Math.max(0, limitMs || 0);
    this.remainingMs = this.limitMs;
  }

  /** Advance the countdown by real elapsed gameplay milliseconds. */
  tick(deltaMs) {
    if (deltaMs <= 0 || this.remainingMs <= 0) return false;
    this.remainingMs = Math.max(0, this.remainingMs - deltaMs);
    return this.remainingMs === 0;
  }

  /** True exactly once-style when the countdown has reached zero. */
  get expired() {
    return this.remainingMs <= 0;
  }

  /** Seconds left, floored — convenient for "low time" warnings. */
  get secondsLeft() {
    return Math.ceil(this.remainingMs / 1000);
  }

  /**
   * MM:SS display string, clamped so the display can never go negative and
   * never exceeds the configured limit.
   */
  get display() {
    const total = Math.max(0, Math.min(this.limitMs, this.remainingMs));
    const s = Math.ceil(total / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  /** Restart the full countdown (new level / explicit level restart). */
  reset(limitMs) {
    if (typeof limitMs === 'number' && limitMs >= 0) this.limitMs = limitMs;
    this.remainingMs = this.limitMs;
  }

  /** Test/debug aid: pin the remaining time (screenshots, edge-case tests). */
  setRemaining(ms) {
    this.remainingMs = Math.max(0, Math.min(this.limitMs, ms));
  }
}
