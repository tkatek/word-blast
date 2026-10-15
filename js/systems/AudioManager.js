/**
 * Audio event bus. The gameplay foundation only EMITS semantic events;
 * final sound design comes later (per project phase restrictions). Wiring
 * real audio later means implementing `attach()` — no gameplay changes.
 */
export class AudioManager {
  constructor() {
    this.events = new Map(); // name -> [handler]
    this.eventLog = [];      // capped, for tests/debugging
    this.enabled = true;
  }

  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event).push(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const list = this.events.get(event);
    if (!list) return;
    const i = list.indexOf(handler);
    if (i !== -1) list.splice(i, 1);
  }

  emit(event, payload) {
    this.eventLog.push({ event, payload, t: Date.now() });
    if (this.eventLog.length > 200) this.eventLog.shift();
    if (!this.enabled) return;
    for (const handler of this.events.get(event) || []) {
      try {
        handler(payload);
      } catch (e) {
        console.warn(`[AudioManager] handler for "${event}" failed:`, e.message);
      }
    }
  }

  /** Placeholder sink — replace with real playback in the audio phase. */
  attach() {
    const known = [
      'launch', 'boost', 'split', 'freeze', 'explode',
      'hit-wood', 'hit-glass', 'hit-stone',
      'break-wood', 'break-glass', 'break-stone',
      'answer-correct', 'answer-wrong', 'shot-missed',
      'question-ready', 'level-complete', 'level-failed', 'ui-click'
    ];
    for (const name of known) {
      this.on(name, () => {});
    }
  }

  clearLog() {
    this.eventLog.length = 0;
  }
}
