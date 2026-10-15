/**
 * Deterministic scoring and three-star rating.
 * Pure module. The GameScene records plain event counters during play;
 * this module turns them into a score and stars. Same inputs always
 * produce the same outputs — verified by tests.
 *
 * Score model:
 *   - Each correct answer scores by attempt number: 1000 / 750 / 500 / 250.
 *   - Each wrong target hit: -100 (score never drops below 0).
 *   - Each unused shot at level end: +150.
 *   - Completing all four questions: +500.
 * Stars require completing ALL four questions — never awarded otherwise.
 */
import { SCORING } from '../config.js';

export class ScoringSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this.correctAttempts = [];   // attempt index (1-based) per answered question
    this.wrongHits = 0;          // wrong answer targets hit
    this.shotsUsed = 0;
    this.totalShots = 0;         // shotsPerQuestion * 4
    this.questionsCompleted = 0;
    this.projectilesUsed = 0;
  }

  configure(totalShots) {
    this.totalShots = totalShots;
  }

  /** Called when the current question is answered correctly. */
  recordCorrect(attemptNumber) {
    if (attemptNumber < 1) attemptNumber = 1;
    this.correctAttempts.push(attemptNumber);
    this.questionsCompleted = this.correctAttempts.length;
  }

  recordWrongHit() {
    this.wrongHits++;
  }

  recordShot() {
    this.shotsUsed++;
  }

  get unusedShots() {
    return Math.max(0, this.totalShots - this.shotsUsed);
  }

  /** Final raw score for the level (includes end-of-level bonuses). */
  computeScore() {
    let score = 0;
    for (const attempt of this.correctAttempts) {
      const idx = Math.min(attempt, SCORING.BASE_BY_ATTEMPT.length) - 1;
      score += SCORING.BASE_BY_ATTEMPT[idx];
    }
    score -= this.wrongHits * SCORING.WRONG_HIT_PENALTY;
    score += this.unusedShots * SCORING.UNUSED_SHOT_BONUS;
    if (this.questionsCompleted === 4) score += SCORING.COMPLETION_BONUS;
    return Math.max(SCORING.MIN_SCORE, score);
  }

  /**
   * Score as it should be displayed mid-level: no unused-shot or
   * completion bonuses before the level is actually finished.
   */
  liveScore() {
    const finals = this.computeScore();
    if (this.questionsCompleted === 4) return finals;
    return Math.max(SCORING.MIN_SCORE, finals - this.unusedShots * SCORING.UNUSED_SHOT_BONUS);
  }

  /**
   * Stars for the level. thresholds = { two, three } from levels.json.
   * 1 star: all four questions completed.
   * 2 stars: score >= thresholds.two.
   * 3 stars: score >= thresholds.three.
   */
  computeStars(thresholds) {
    if (this.questionsCompleted < 4) return 0;
    const score = this.computeScore();
    if (thresholds && score >= thresholds.three) return 3;
    if (thresholds && score >= thresholds.two) return 2;
    return 1;
  }

  /** Theoretical maximum, used to author star thresholds per level. */
  static maxScore(shotsPerQuestion) {
    const perfect = SCORING.BASE_BY_ATTEMPT[0] * 4;
    const unused = (shotsPerQuestion - 1) * 4 * SCORING.UNUSED_SHOT_BONUS;
    return perfect + unused + SCORING.COMPLETION_BONUS;
  }
}
