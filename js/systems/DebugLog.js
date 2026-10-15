/**
 * Development-only diagnostic logging. Silent in production unless the
 * player opts in with ?debug=1 (or DebugAPI.setDebug(true)) — then every
 * gameplay transition is traceable:
 *
 *   [WORD BLAST] L3 / Question 1
 *   [SHOT] … [COLLISION] … [ANSWER] … [STATE] a -> b
 *   [PHYSICS] … [FEEDBACK] … [QUESTION] … [READY] …
 *
 * A stalled progression logs the exact blocked transition plus the
 * responsible condition.
 */
const queryEnabled = (() => {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      return new URLSearchParams(window.location.search).has('debug');
    }
  } catch { /* non-browser */ }
  return false;
})();

export const DebugLog = {
  enabled: queryEnabled,

  info(...args) {
    if (this.enabled) console.log('[WORD BLAST]', ...args);
  },

  warn(...args) {
    if (this.enabled) console.warn('[WORD BLAST]', ...args);
  }
};
