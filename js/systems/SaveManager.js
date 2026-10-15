/**
 * Versioned progress persistence over an injectable storage adapter.
 * Pure module apart from the adapter — LocalStorageAdapter wraps
 * window.localStorage and is only instantiated in the browser; Node tests
 * inject an in-memory adapter. A CloudSaveAdapter interface is documented
 * for the future backend; no server code is shipped in v1.
 */
import { SAVE } from '../config.js';

export class LocalStorageAdapter {
  constructor(storage) {
    // storage injected for testability; defaults to window.localStorage
    this.storage = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  }

  read() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(SAVE.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[SaveManager] unreadable save data, starting fresh:', e.message);
      return null;
    }
  }

  write(data) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE.KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('[SaveManager] could not persist save data:', e.message);
      return false;
    }
  }

  clear() {
    if (!this.storage) return;
    try {
      this.storage.removeItem(SAVE.KEY);
    } catch (e) {
      /* ignore */
    }
  }
}

/**
 * Future cloud persistence should implement this interface and be passed to
 * SaveManager. Keep methods async so gameplay code never blocks:
 *   class CloudSaveAdapter {
 *     async read()  -> object|null   // fetch remote save
 *     async write(data) -> boolean
 *     async clear()
 *   }
 * Merge strategy (local vs remote timestamps) is a backend concern; the
 * gameplay-facing API below stays identical.
 */

export function createDefaultSave() {
  return {
    version: SAVE.VERSION,
    unlockedLevel: 1,
    tutorialDone: false,
    settings: { sound: true },
    levels: {} // id -> { completed, bestScore, bestStars, attempts }
  };
}

function sanitizeLevelEntry(entry) {
  const e = {
    completed: !!(entry && entry.completed),
    bestScore: Number.isInteger(entry && entry.bestScore) && entry.bestScore > 0 ? entry.bestScore : 0,
    bestStars: Number.isInteger(entry && entry.bestStars) ? Math.max(0, Math.min(3, entry.bestStars)) : 0,
    attempts: Number.isInteger(entry && entry.attempts) ? entry.attempts : 0
  };
  return e;
}

/** Structural + range validation of loaded save data. Returns a clean save or null. */
export function sanitizeSave(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!Number.isInteger(data.version) || data.version > SAVE.VERSION) return null;

  const out = createDefaultSave();
  if (Number.isInteger(data.unlockedLevel)) {
    out.unlockedLevel = Math.max(1, Math.min(SAVE.MAX_LEVELS, data.unlockedLevel));
  }
  if (typeof data.tutorialDone === 'boolean') out.tutorialDone = data.tutorialDone;
  if (data.settings && typeof data.settings === 'object' && typeof data.settings.sound === 'boolean') {
    out.settings.sound = data.settings.sound;
  }
  if (data.levels && typeof data.levels === 'object' && !Array.isArray(data.levels)) {
    for (let id = 1; id <= SAVE.MAX_LEVELS; id++) {
      const key = String(id);
      if (data.levels[key]) out.levels[key] = sanitizeLevelEntry(data.levels[key]);
    }
  }

  // invariant: a level cannot be completed while a previous one is not,
  // and unlockedLevel must not exceed completed count + 1
  let completedThrough = 0;
  for (let id = 1; id <= SAVE.MAX_LEVELS; id++) {
    if (out.levels[String(id)] && out.levels[String(id)].completed) completedThrough = id;
    else break;
  }
  for (let id = 1; id <= SAVE.MAX_LEVELS; id++) {
    if (id > completedThrough && out.levels[String(id)]) {
      out.levels[String(id)].completed = false;
    }
  }
  out.unlockedLevel = Math.min(out.unlockedLevel, completedThrough + 1);

  return out;
}

export class SaveManager {
  constructor(adapter) {
    this.adapter = adapter || new LocalStorageAdapter();
    this.data = null;
  }

  load() {
    const raw = this.adapter.read();
    const clean = sanitizeSave(raw);
    if (raw && !clean) {
      console.warn('[SaveManager] corrupted save data detected; resetting progress.');
    }
    this.data = clean || createDefaultSave();
    return this.data;
  }

  save() {
    return this.adapter.write(this.data);
  }

  get unlockedLevel() {
    this.ensureLoaded();
    return this.data.unlockedLevel;
  }

  isLevelUnlocked(id) {
    this.ensureLoaded();
    return id >= 1 && id <= SAVE.MAX_LEVELS && id <= this.data.unlockedLevel;
  }

  getLevelEntry(id) {
    this.ensureLoaded();
    return this.data.levels[String(id)] || { completed: false, bestScore: 0, bestStars: 0, attempts: 0 };
  }

  markAttempt(id) {
    this.ensureLoaded();
    const key = String(id);
    const entry = this.data.levels[key] || (this.data.levels[key] = sanitizeLevelEntry(null));
    entry.attempts++;
    this.save();
  }

  /**
   * Record a finished level. Best results are kept (a worse replay never
   * overwrites a better one). Unlocks the next level. Returns the stored entry.
   */
  recordLevelResult(id, score, stars) {
    this.ensureLoaded();
    const key = String(id);
    const entry = this.data.levels[key] || (this.data.levels[key] = sanitizeLevelEntry(null));
    entry.completed = true;
    entry.bestScore = Math.max(entry.bestScore, score);
    entry.bestStars = Math.max(entry.bestStars, stars);
    if (id < SAVE.MAX_LEVELS) {
      this.data.unlockedLevel = Math.max(this.data.unlockedLevel, id + 1);
    }
    this.save();
    return { ...entry };
  }

  setTutorialDone(done = true) {
    this.ensureLoaded();
    this.data.tutorialDone = !!done;
    this.save();
  }

  setSetting(name, value) {
    this.ensureLoaded();
    this.data.settings[name] = value;
    this.save();
  }

  get totalStars() {
    this.ensureLoaded();
    let sum = 0;
    for (let id = 1; id <= SAVE.MAX_LEVELS; id++) sum += this.getLevelEntry(id).bestStars;
    return sum;
  }

  get allCompleted() {
    this.ensureLoaded();
    for (let id = 1; id <= SAVE.MAX_LEVELS; id++) {
      if (!this.getLevelEntry(id).completed) return false;
    }
    return true;
  }

  reset() {
    this.data = createDefaultSave();
    this.adapter.clear();
    this.save();
  }

  ensureLoaded() {
    if (!this.data) this.load();
  }
}
