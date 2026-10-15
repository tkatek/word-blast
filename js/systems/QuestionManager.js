/**
 * Question engine: validation, per-level sequencing, answer checking.
 * Pure module — no Phaser. The GameScene owns presentation.
 */
import { validateQuestions } from './Validators.js';
import { TARGETS } from '../config.js';

export class QuestionManager {
  /**
   * @param {object[]} questions raw questions.json array
   */
  constructor(questions) {
    this.questions = questions || [];
    const result = validateQuestions(this.questions);
    this.validation = result;
    if (!result.ok) {
      throw new Error(`Question bank invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    this.byLevel = new Map();
    for (const q of this.questions) {
      if (!this.byLevel.has(q.levelId)) this.byLevel.set(q.levelId, []);
      this.byLevel.get(q.levelId).push(q);
    }
  }

  /** Questions for a level, in bank order (stable). */
  getForLevel(levelId) {
    return this.byLevel.get(levelId) || [];
  }

  getQuestion(id) {
    return this.questions.find((q) => q.id === id) || null;
  }

  get size() {
    return this.questions.length;
  }

  /**
   * Build runtime state for one question: shuffled stable target mapping.
   * Choice letters are assigned by shuffle, but validation is always by
   * choice ID — never by visible text or position.
   */
  prepare(question) {
    const choices = question.choices.map((c) => ({ ...c }));
    shuffle(choices);
    return {
      question,
      targets: choices.map((c, i) => ({
        choiceId: c.id,
        text: c.text,
        label: TARGETS.CHOICE_LABELS[i]
      })),
      answered: false,
      attempt: 0
    };
  }

  /**
   * Strict answer validation. Returns a result object; never throws.
   * @param {object} prepared state from prepare()
   * @param {string} choiceId id of the target the projectile hit
   */
  checkAnswer(prepared, choiceId) {
    if (!prepared || prepared.answered) {
      return { valid: false, reason: 'already-answered' };
    }
    const choice = prepared.question.choices.find((c) => c.id === choiceId);
    if (!choice) {
      return { valid: false, reason: 'unknown-choice' };
    }
    prepared.attempt++;
    const correct = choiceId === prepared.question.correctAnswerId;
    if (correct) prepared.answered = true;
    return {
      valid: true,
      correct,
      choiceId,
      explanation: prepared.question.explanation,
      correctChoiceId: prepared.question.correctAnswerId
    };
  }
}

/** Fisher–Yates with a seedable PRNG so tests are deterministic. */
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
