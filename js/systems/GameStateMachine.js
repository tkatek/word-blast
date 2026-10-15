/**
 * Explicit game state machine.
 * Pure module — no Phaser. Guards transitions, prevents duplicates and race
 * conditions, and implements pause as a stack-free single-level suspension
 * that always restores the exact state that was active before pausing.
 */
import { STATES, STATE_TRANSITIONS } from '../config.js';

export class GameStateMachine {
  constructor(onChange) {
    this.current = STATES.BOOTING;
    this.previous = null;
    this.pausedFrom = null;
    this.history = [STATES.BOOTING];
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
  }

  is(next) {
    return this.current === next;
  }

  isPaused() {
    return this.current === STATES.PAUSED;
  }

  /** State before the current one (ignoring pause round-trips). */
  stateBeforePause() {
    return this.pausedFrom;
  }

  can(next) {
    if (next === STATES.PAUSED) {
      return !this.isPaused() && this.current !== STATES.BOOTING && this.current !== STATES.LOADING;
    }
    if (this.isPaused()) {
      // only resuming into the stored state is allowed
      return next === this.pausedFrom;
    }
    const allowed = STATE_TRANSITIONS[this.current];
    return Array.isArray(allowed) && allowed.includes(next);
  }

  /**
   * Attempt a transition. Returns true on success; false (and a console
   * warning) when the transition is not permitted. Duplicate transitions
   * are rejected because a state is never in its own allowed list.
   */
  set(next) {
    if (!this.can(next)) {
      console.warn(`[GameStateMachine] rejected transition ${this.current} -> ${next}`);
      return false;
    }
    if (next === STATES.PAUSED) {
      this.pausedFrom = this.current;
      this.current = STATES.PAUSED;
      this.history.push(STATES.PAUSED);
      this.onChange(STATES.PAUSED, this.pausedFrom);
      return true;
    }
    if (this.pausedFrom === next && this.current === STATES.PAUSED) {
      this.current = this.pausedFrom;
      this.pausedFrom = null;
      this.history.push(this.current);
      this.onChange(this.current, STATES.PAUSED);
      return true;
    }
    this.previous = this.current;
    this.current = next;
    this.history.push(next);
    this.onChange(next, this.previous);
    return true;
  }

  pause() {
    return this.set(STATES.PAUSED);
  }

  resume() {
    if (!this.isPaused()) return false;
    return this.set(this.pausedFrom);
  }
}
