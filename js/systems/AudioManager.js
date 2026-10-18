/**
 * AudioManager (audio-repair) — the game's single audio authority.
 *
 * Two layers in one class:
 *
 *   1. EVENT BUS (unchanged public API): gameplay systems emit semantic
 *      events (`audio.emit('launch', {...})`); nothing about physics or
 *      scoring lives here.
 *
 *   2. PLAYBACK ENGINE: after `attach(scene)` binds the Phaser sound
 *      manager, every incoming event is interpreted into concrete playback
 *      decisions — variation pick, pitch jitter, category bus volume,
 *      per-key cooldowns, voice caps with severity priority for collisions,
 *      and mobile unlock handling.
 *
 * SILENCE-FIRST CONFIGURATION (audio repair):
 *   - No background music, no ambience loops, no flight whistle. The game
 *     is sound-effects-only: after one-shots finish, a settled scene with
 *     no input is completely silent.
 *   - The slingshot stretch is MOTION-DRIVEN: short leather-creak segments
 *     (cut from the user-supplied Freesound recording #63057) play only
 *     while the pouch actually moves, and fade out ~120 ms after it stops —
 *     a held, fully-stretched pouch is silent.
 *
 * Design constraints honored:
 *   - ONE audio manager per game (created once in BootScene, kept in the
 *     scene registry; attach() is idempotent, so scene restarts can never
 *     stack duplicate listeners or managers).
 *   - Missing assets never crash: every play is guarded by a cache check.
 *   - Audio reacts to gameplay; it never drives physics or scoring.
 *   - One output path: everything plays through the Phaser sound manager
 *     (master mute covers the whole game).
 */

/**
 * Sound manifest. `vars` lists interchangeable variation keys (random pick,
 * no immediate repeat), `detune` is the ± pitch jitter in cents, `cooldown`
 * the minimum gap between plays of the same entry, `vol` the base level.
 * Categories: sfx | ui.
 */
export const AUDIO_MANIFEST = {
  // slingshot — leather-creak segments from the supplied recording
  'sling-grab': { file: 'slingshot/grab.wav', cat: 'sfx', vol: 0.5, cooldown: 300 },
  'sling-stretch': { file: 'slingshot/stretch-1.wav', cat: 'sfx', vol: 1.0, vars: ['sling-stretch-1', 'sling-stretch-2', 'sling-stretch-3', 'sling-stretch-4', 'sling-stretch-5'] },
  'sling-release': { file: 'slingshot/release.wav', cat: 'sfx', vol: 1.0, detune: 40 },
  'sling-cancel': { file: 'slingshot/return.wav', cat: 'sfx', vol: 0.6, detune: 30 },
  // wood
  'wood-light': { file: 'wood/hit-light-1.wav', cat: 'sfx', vol: 0.85, detune: 90, vars: ['wood-light-1', 'wood-light-2', 'wood-light-3'] },
  'wood-heavy': { file: 'wood/hit-heavy-1.wav', cat: 'sfx', vol: 1.0, detune: 70, vars: ['wood-heavy-1', 'wood-heavy-2'] },
  'wood-crack': { file: 'wood/crack.wav', cat: 'sfx', vol: 0.9, detune: 60 },
  'wood-break': { file: 'wood/break.wav', cat: 'sfx', vol: 1.0, detune: 50 },
  'wood-collapse': { file: 'wood/collapse.wav', cat: 'sfx', vol: 0.85, cooldown: 1500 },
  // glass
  'glass-hit': { file: 'glass/hit-1.wav', cat: 'sfx', vol: 0.8, detune: 110, vars: ['glass-hit-1', 'glass-hit-2'] },
  'glass-crack': { file: 'glass/crack.wav', cat: 'sfx', vol: 0.85, detune: 70 },
  'glass-shatter': { file: 'glass/shatter.wav', cat: 'sfx', vol: 1.0, detune: 45 },
  // stone
  'stone-light': { file: 'stone/hit-light-1.wav', cat: 'sfx', vol: 0.85, detune: 70, vars: ['stone-light-1', 'stone-light-2'] },
  'stone-heavy': { file: 'stone/hit-heavy-1.wav', cat: 'sfx', vol: 1.0, detune: 50, vars: ['stone-heavy-1', 'stone-heavy-2'] },
  'stone-crack': { file: 'stone/crack.wav', cat: 'sfx', vol: 0.95, detune: 45 },
  'stone-collapse': { file: 'stone/collapse.wav', cat: 'sfx', vol: 0.85, cooldown: 1500 },
  // abilities
  'boost': { file: 'abilities/boost.wav', cat: 'sfx', vol: 1.0, detune: 50 },
  'split': { file: 'abilities/split.wav', cat: 'sfx', vol: 1.0, detune: 30 },
  'explosion': { file: 'abilities/explosion.wav', cat: 'sfx', vol: 1.0, cooldown: 120 },
  'freeze': { file: 'abilities/freeze.wav', cat: 'sfx', vol: 1.0, detune: 25 },
  'ice-shatter': { file: 'abilities/ice-shatter.wav', cat: 'sfx', vol: 0.9, detune: 60 },
  // birds
  'bird-launch': { file: 'birds/launch.wav', cat: 'sfx', vol: 0.8, detune: 80 },
  'bird-hit': { file: 'birds/hit.wav', cat: 'sfx', vol: 0.8, detune: 90, cooldown: 260 },
  // pigs
  'pig-pop': { file: 'pigs/pop.wav', cat: 'sfx', vol: 1.0, detune: 60 },
  // UI / feedback
  'ui-click': { file: 'ui/click.wav', cat: 'ui', vol: 0.9, cooldown: 40 },
  'ui-hover': { file: 'ui/hover.wav', cat: 'ui', vol: 0.45, cooldown: 150 },
  'ui-select': { file: 'ui/select.wav', cat: 'ui', vol: 0.9, cooldown: 60 },
  'ui-pause': { file: 'ui/pause.wav', cat: 'ui', vol: 0.9 },
  'ui-resume': { file: 'ui/resume.wav', cat: 'ui', vol: 0.9 },
  'ui-correct': { file: 'ui/correct.wav', cat: 'ui', vol: 1.0 },
  'ui-wrong': { file: 'ui/wrong.wav', cat: 'ui', vol: 1.0 },
  'ui-star': { file: 'ui/star.wav', cat: 'ui', vol: 1.0 },
  'ui-heart': { file: 'ui/heart-lost.wav', cat: 'ui', vol: 1.0 },
  'ui-complete': { file: 'ui/level-complete.wav', cat: 'ui', vol: 1.0 },
  'ui-failed': { file: 'ui/level-failed.wav', cat: 'ui', vol: 1.0 },
  'ui-missed': { file: 'ui/missed.wav', cat: 'ui', vol: 0.8 },
  'ui-question': { file: 'ui/question-ready.wav', cat: 'ui', vol: 0.8 }
};

/** Flat key list for tests: manifest keys + every variation key. */
export function audioManifestKeys() {
  const keys = new Set();
  for (const [key, def] of Object.entries(AUDIO_MANIFEST)) {
    keys.add(key);
    for (const v of def.vars || []) keys.add(v);
  }
  return [...keys];
}

/**
 * Preload list: one {key, file} pair per loadable sound. Entries with
 * variations load ONLY the variation keys (the base key is never played
 * directly), so each file is decoded exactly once.
 */
export function audioPreloadList() {
  const list = [];
  for (const [key, def] of Object.entries(AUDIO_MANIFEST)) {
    if (def.vars && def.vars.length) {
      def.vars.forEach((v, i) => {
        list.push({ key: v, file: def.file.replace(/(-\d+)?\.wav$/, `-${i + 1}.wav`) });
      });
    } else {
      list.push({ key, file: def.file });
    }
  }
  return list;
}

/** Category bus defaults (mixer levels). Master additionally multiplies. */
const BUS_DEFAULTS = { master: 0.9, music: 0.55, sfx: 1.0, ui: 0.9, ambience: 0.6, voice: 1.0 };

/** Voice caps per category (max simultaneous one-shot instances). */
const VOICE_CAPS = { sfx: 8, ui: 4, impact: 6 };

/**
 * Slingshot motion-audio tuning. Speeds are game-world px/s measured from
 * the ACCEPTED, clamped pouch position (never the raw pointer).
 */
const SLING = {
  START_SPEED: 90,  // smoothed speed that starts movement audio
  STOP_SPEED: 38,   // below this the fade-out countdown begins
  STOP_HOLD: 130,   // ms below STOP_SPEED before fading (tremor tolerance)
  SMOOTH: 0.28,     // EMA factor per frame (noisy-input smoothing)
  FADE_OUT: 120,    // ms fade when the pouch stops moving
  RETRIG_GAP: 90,   // ms minimum between segment starts (no machine-gunning)
  MAX_VOL: 0.9      // ceiling for the movement-audio gain
};

/** How much competing sfx are reduced while the question voice speaks. */
const SPEECH_DUCK = 0.35;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class AudioManager {
  constructor() {
    // ---- event bus (pre-existing public API) --------------------------
    this.events = new Map(); // name -> [handler]
    this.eventLog = [];      // capped, for tests/debugging
    this.enabled = true;     // master gate (persisted setting `sound`)

    // ---- engine state --------------------------------------------------
    this._scene = null;
    this.sound = null;         // Phaser sound manager (bound in attach)
    this._cache = null;        // scene.cache.audio
    this.save = null;          // SaveManager (settings persistence)
    this._attached = false;
    this.bus = { ...BUS_DEFAULTS };      // numeric mixer levels
    this.mutes = { music: false, sfx: false, ambience: false }; // category toggles
    this._voices = [];         // active tracked sounds {s, key, cat, tag, sev, baseVol}
    this._lastPlay = new Map(); // key -> timestamp (cooldowns)
    this._lastVar = new Map();  // base key -> last variation picked
    this._breaks = [];          // recent break events for collapse detection
    this._lastCollapseAt = -1e9;
    this._lastExplosion = { t: -1e9, x: 0, y: 0 };
    this._paused = false;
    this._unlockBound = false;
    this._speechDuck = false;   // true while the question voice speaks
    // slingshot movement audio (one controlled voice per drag session)
    this._sling = {
      voice: null,       // the active Phaser Sound (at most one)
      key: null,         // its variation key
      active: false,     // movement currently drives playback
      smoothed: 0,       // smoothed pouch speed (px/s)
      belowSince: 0,     // engine time speed first dipped below STOP_SPEED
      lastStart: -1e9,   // engine time of the last segment start
      lastVariant: null  // no immediate repeats
    };
    // engine-side clock queues (filled in attach(); defaults keep
    // destroy()/pre-attach calls safe)
    this._ramps = [];
    this._timers = [];
    this._tickTime = null;
    this._game = null;
    this._tickHandler = null;
    this.stats = { plays: Object.create(null), dropped: Object.create(null), events: Object.create(null) };
  }

  /* ------------------------------------------------------------------ */
  /* Event bus (unchanged semantics)                                     */
  /* ------------------------------------------------------------------ */
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
    this.stats.events[event] = (this.stats.events[event] || 0) + 1;
    if (!this.enabled) return;
    for (const handler of this.events.get(event) || []) {
      try {
        handler(payload);
      } catch (e) {
        console.warn(`[AudioManager] handler for "${event}" failed:`, e.message);
      }
    }
  }

  clearLog() {
    this.eventLog.length = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Attachment (once per game)                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Bind the playback engine. Called once from BootScene.create() with the
   * boot scene. CRITICAL: all timing (cooldowns, fades, delayed chimes)
   * runs off the GAME's post-step clock, never off a scene — scenes shut
   * down and their clocks freeze, which would stall every cooldown after
   * boot. Safe to call repeatedly — the second call is a no-op.
   */
  attach(scene) {
    if (this._attached) return;
    this._attached = true;
    this._scene = scene || null;
    this.sound = scene && scene.sound ? scene.sound : null;
    this._cache = scene && scene.cache ? scene.cache.audio : null;
    this.save = scene && scene.registry ? scene.registry.get('save') : null;
    this._game = scene && scene.game ? scene.game : null;

    this._ramps = [];   // {s, from, to, t0, ms, onDone} — volume fades
    this._timers = [];  // {due, fn, cancelled} — short audio-side delays
    this._tickTime = null;

    this._readSettings();
    this._registerRoutes();
    this._installUnlock();
    this._installTicker();
  }

  /** Drive ramps/timers/the engine clock from the game loop (every frame). */
  _installTicker() {
    if (!this._game || !this._game.events || typeof this._game.events.on !== 'function') return;
    this._tickHandler = (time) => this._tick(time);
    // Phaser.Core.Events.POST_STEP — fires for the whole game lifetime with
    // the loop's monotonic ms clock, regardless of which scene is active.
    this._game.events.on('poststep', this._tickHandler);
  }

  /** One engine tick: advance clock, apply due volume ramps, fire timers. */
  _tick(time) {
    if (typeof time === 'number' && Number.isFinite(time)) this._tickTime = time;
    const now = this._now();
    if (this._ramps.length) {
      const done = [];
      for (const r of this._ramps) {
        let v;
        if (now >= r.t0 + r.ms) {
          v = r.to;
          done.push(r);
        } else {
          v = r.from + (r.to - r.from) * ((now - r.t0) / Math.max(1, r.ms));
        }
        try { r.s.setVolume(v); } catch { done.push(r); continue; }
      }
      if (done.length) {
        this._ramps = this._ramps.filter((r) => !done.includes(r));
        for (const r of done) { try { r.onDone && r.onDone(); } catch { /* owner gone */ } }
      }
    }
    if (this._timers.length) {
      const due = this._timers.filter((t) => !t.cancelled && t.due <= now);
      if (due.length) {
        this._timers = this._timers.filter((t) => !due.includes(t));
        for (const t of due) { try { t.fn(); } catch { /* owner gone */ } }
      }
    }
  }

  /** Detach everything (game destroy only — scenes never call this). */
  destroy() {
    this._attached = false;
    try { this.stopSlingMotion(0); } catch { /* none yet */ }
    if (this._game && this._game.events && this._tickHandler) {
      try { this._game.events.off('poststep', this._tickHandler); } catch { /* gone */ }
      this._tickHandler = null;
    }
    if (this._unlockBound && typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('pointerdown', this._onGesture);
      document.removeEventListener('touchstart', this._onGesture);
      document.removeEventListener('keydown', this._onGesture);
    }
    this._unlockBound = false;
  }

  _readSettings() {
    if (!this.save || !this.save.data) return;
    const s = this.save.data.settings || {};
    this.enabled = s.sound !== false;
    this.mutes.music = s.music === false;
    this.mutes.sfx = s.sfx === false;
    this.mutes.ambience = s.ambience === false;
    if (s.volumes && typeof s.volumes === 'object') {
      for (const k of Object.keys(BUS_DEFAULTS)) {
        if (typeof s.volumes[k] === 'number') this.bus[k] = clamp01(s.volumes[k]);
      }
    }
    // NOTE (silence-first migration): older saves may say music/ambience ON.
    // There is nothing to restart — this build ships no music or ambience
    // tracks at all — and no save field is modified here. Progress, scores
    // and inventory are untouched.
    this._applyMute();
  }

  _applyMute() {
    if (this.sound && typeof this.sound.mute !== 'undefined') {
      try { this.sound.mute = !this.enabled; } catch { /* manager gone */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mobile / browser unlock                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Mobile browsers block audio until a real gesture. Phaser's own unlock
   * handles the common case; we additionally resume a suspended
   * AudioContext on the first document-level gesture. Effects requested
   * before the unlock are simply dropped (never queued for later replay).
   */
  _installUnlock() {
    if (!this.sound || typeof document === 'undefined' || !document.addEventListener) return;
    this._onGesture = () => {
      this.unlock();
    };
    document.addEventListener('pointerdown', this._onGesture, { passive: true });
    document.addEventListener('touchstart', this._onGesture, { passive: true });
    document.addEventListener('keydown', this._onGesture);
    this._unlockBound = true;
  }

  /** Explicit unlock attempt (safe to call any time). */
  unlock() {
    if (!this.sound) return;
    try {
      if (typeof this.sound.unlock === 'function') this.sound.unlock();
    } catch { /* locked manager */ }
    const ctx = this.sound.context;
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }
  }

  /* ------------------------------------------------------------------ */
  /* Core playback                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Engine clock. Prefers the game-loop time updated by _tick (monotonic,
   * scene-independent); falls back to wall clock for the rare frame before
   * the first post-step (and for engine-only unit tests without a game).
   */
  _now() {
    return typeof this._tickTime === 'number' ? this._tickTime : Date.now();
  }

  /** Audio-side delayed call on the engine clock (survives scene swaps). */
  _delay(ms, fn) {
    const rec = { due: this._now() + ms, fn, cancelled: false };
    this._timers.push(rec);
    return rec;
  }

  _loaded(key) {
    if (!this.sound || !this._cache) return false;
    try { return this._cache.exists(key); } catch { return false; }
  }

  _catVolume(cat) {
    const c = cat || 'sfx';
    let v = this.bus.master * (this.bus[c] !== undefined ? this.bus[c] : 1);
    if (this._speechDuck && c === 'sfx') v *= SPEECH_DUCK;
    return v;
  }

  /** Pick a variation key (random, no immediate repeat). Always returns a
   *  LOADED key — when variations exist the base key is never played. */
  _pick(baseKey, def) {
    const vars = def.vars;
    if (!vars || vars.length < 2) return baseKey;
    let key = null;
    for (let i = 0; i < 4 && (key === null || key === this._lastVar.get(baseKey)); i++) {
      key = vars[Math.floor(Math.random() * vars.length)];
    }
    this._lastVar.set(baseKey, key);
    return key;
  }

  /** Drop finished/destroyed voices from the active list. */
  _prune() {
    for (let i = this._voices.length - 1; i >= 0; i--) {
      const v = this._voices[i];
      try {
        if (!v.s || !v.s.isPlaying) this._voices.splice(i, 1);
      } catch {
        this._voices.splice(i, 1);
      }
    }
  }

  _countVoices(cat, tag) {
    let n = 0;
    for (const v of this._voices) {
      if (cat && v.cat !== cat) continue;
      if (tag && v.tag !== tag) continue;
      n++;
    }
    return n;
  }

  /**
   * Play a manifest sound.
   * @param {string} key manifest key (or variation key)
   * @param {object} opts { volume (0..1 multiplier), detune (extra cents),
   *                        cooldown (ms override), tag ('impact' priority
   *                        group), severity (impact strength 0..100) }
   * @returns the started Phaser Sound, or null when skipped
   */
  play(key, opts = {}) {
    if (!this.sound) return null;
    const base = AUDIO_MANIFEST[key];
    if (!base) return null;
    if (base.cat !== 'music' && this.mutes[base.cat]) {
      this.stats.dropped[key] = (this.stats.dropped[key] || 0) + 1;
      return null;
    }
    const actual = this._pick(key, base);
    if (!this._loaded(actual)) {
      this.stats.dropped[key] = (this.stats.dropped[key] || 0) + 1;
      return null;
    }

    const now = this._now();
    const cd = opts.cooldown !== undefined ? opts.cooldown : (base.cooldown || 0);
    const lastPlay = this._lastPlay.get(key); // NOTE: 0 is a valid timestamp
    if (cd > 0 && now - (lastPlay === undefined ? -Infinity : lastPlay) < cd) {
      this.stats.dropped[key] = (this.stats.dropped[key] || 0) + 1;
      return null;
    }
    this._lastPlay.set(key, now);

    this._prune();

    // concurrency — impacts use severity priority (strongest wins)
    const tag = opts.tag || null;
    if (tag === 'impact') {
      const active = this._voices.filter((v) => v.tag === 'impact');
      if (active.length >= VOICE_CAPS.impact) {
        let weakest = active[0];
        for (const v of active) if (v.sev < weakest.sev) weakest = v;
        const sev = opts.severity || 0;
        if (sev >= (weakest.sev || 0)) {
          this._stopVoice(weakest);
        } else {
          this.stats.dropped[key] = (this.stats.dropped[key] || 0) + 1;
          return null;
        }
      }
    } else {
      const cat = base.cat;
      if (this._countVoices(cat) >= (VOICE_CAPS[cat] || 8)) {
        this.stats.dropped[key] = (this.stats.dropped[key] || 0) + 1;
        return null;
      }
    }

    const detune = Math.round((base.detune || 0) * (Math.random() * 2 - 1) + (opts.detune || 0));
    const volume = clamp01((base.vol || 1) * (opts.volume !== undefined ? opts.volume : 1) * this._catVolume(base.cat));
    let s = null;
    try {
      s = this.sound.add(actual, { volume, detune, loop: !!base.loop });
      if (!s) return null;
      s.play();
    } catch {
      this.stats.dropped[key] = (this.stats.dropped[key] || 0) + 1;
      return null;
    }
    this.stats.plays[key] = (this.stats.plays[key] || 0) + 1;

    if (!base.loop) {
      const rec = { s, key, cat: base.cat, tag, sev: opts.severity || 0, baseVol: volume };
      this._voices.push(rec);
      const drop = () => {
        const i = this._voices.indexOf(rec);
        if (i !== -1) this._voices.splice(i, 1);
      };
      // one-shots RELEASE their source + nodes when they finish — a long
      // session must not accumulate dead Sound instances in the manager.
      s.once('ended', () => {
        drop();
        try { s.destroy(); } catch { /* already gone */ }
      });
      s.once('destroyed', drop);
    }
    return s;
  }

  _stopVoice(rec) {
    try { rec.s.stop(); } catch { /* already gone */ }
    const i = this._voices.indexOf(rec);
    if (i !== -1) this._voices.splice(i, 1);
  }

  /* ------------------------------------------------------------------ */
  /* Volume ramp helper — game-loop driven, never scene-driven           */
  /* ------------------------------------------------------------------ */
  _ramp(sound, to, ms, onDone) {
    if (!sound) { if (onDone) onDone(); return; }
    let from = 0;
    try { from = sound.volume || 0; } catch { if (onDone) onDone(); return; }
    if (ms <= 40) {
      try { sound.setVolume(to); } catch { /* gone */ }
      if (onDone) onDone();
      return;
    }
    this._ramps.push({ s: sound, from, to, t0: this._now(), ms, onDone });
  }

  /* ------------------------------------------------------------------ */
  /* Slingshot movement audio (motion-driven leather segments)            */
  /* ------------------------------------------------------------------ */

  /**
   * Feed ONE drag session's motion measurements, every frame the drag is
   * alive. The Slingshot computes these from the accepted, clamped pouch
   * position in game-world coordinates:
   *
   *   movementSpeed = distance(currentPouch, previousPouch) / elapsedTime
   *   tension       = distance(rest, currentPouch) / MAX_DRAG
   *
   * Movement ALONE decides audibility (tension only colours it), so a held
   * fully-stretched pouch is silent, and pointer motion beyond the drag
   * limit (pouch clamped stationary) generates nothing.
   */
  updateSlingMotion(tension, speed, towardRest = false) {
    if (!this.sound || this.mutes.sfx) {
      this.stopSlingMotion(0);
      return;
    }
    const s = this._sling;
    const now = this._now();
    s.smoothed = s.smoothed * (1 - SLING.SMOOTH) + Math.max(0, speed) * SLING.SMOOTH;

    if (!s.active) {
      if (s.smoothed > SLING.START_SPEED && now - s.lastStart > SLING.RETRIG_GAP) {
        this._startSlingSegment(tension, towardRest);
      }
      return;
    }

    if (!s.voice) {
      // segment ended naturally: chain the next one while movement lasts
      if (s.smoothed > SLING.STOP_SPEED) this._startSlingSegment(tension, towardRest);
      else this.stopSlingMotion(SLING.FADE_OUT);
      return;
    }

    // continuous control of the live segment — speed → loudness,
    // tension → slight character. This is the ONLY gain owner of the voice.
    const target = clamp01(
      (0.5 + 0.3 * clamp01(s.smoothed / 500) + 0.2 * clamp01(tension)) * SLING.MAX_VOL
    ) * this._catVolume('sfx');
    try {
      s.voice.setVolume(target);
      s.voice.setDetune(Math.round(-40 + 80 * clamp01(tension)));
    } catch { /* voice gone */ }

    if (s.smoothed < SLING.STOP_SPEED) {
      if (!s.belowSince) s.belowSince = now;
      if (now - s.belowSince >= SLING.STOP_HOLD) this.stopSlingMotion(SLING.FADE_OUT);
    } else {
      s.belowSince = 0;
    }
  }

  /** Start one leather segment (max one voice; chaining handled above). */
  _startSlingSegment(tension, towardRest) {
    const s = this._sling;
    const def = AUDIO_MANIFEST['sling-stretch'];
    let key;
    if (towardRest) {
      key = 'sling-stretch-5'; // the softer texture suits the relaxed return
    } else {
      const mains = def.vars.slice(0, 4);
      do { key = mains[Math.floor(Math.random() * mains.length)]; }
      while (key === s.lastVariant);
      s.lastVariant = key;
    }
    if (!this._loaded(key)) {
      this.stats.dropped['sling-stretch'] = (this.stats.dropped['sling-stretch'] || 0) + 1;
      return;
    }
    try {
      const vol = clamp01((0.5 + 0.3 * clamp01(s.smoothed / 500) + 0.2 * clamp01(tension)) * SLING.MAX_VOL)
        * (towardRest ? 0.7 : 1) * this._catVolume('sfx');
      const voice = this.sound.add(key, {
        volume: vol,
        detune: Math.round(-40 + 80 * clamp01(tension)),
        loop: false
      });
      if (!voice) return;
      s.voice = voice;
      s.key = key;
      s.active = true;
      s.belowSince = 0;
      s.lastStart = this._now();
      voice.play();
      voice.once('ended', () => {
        if (this._sling.voice === voice) {
          this._sling.voice = null; // next updateSlingMotion chains or fades
          this._sling.key = null;
        }
        try { voice.destroy(); } catch { /* gone */ }
      });
      this.stats.plays['sling-stretch'] = (this.stats.plays['sling-stretch'] || 0) + 1;
    } catch { /* blocked */ }
  }

  /** Fade out and release the movement voice (cancel/release/pause/mute). */
  stopSlingMotion(fadeMs = SLING.FADE_OUT) {
    const s = this._sling;
    s.active = false;
    s.smoothed = 0;
    s.belowSince = 0;
    const voice = s.voice;
    s.voice = null;
    s.key = null;
    if (!voice) return;
    if (fadeMs <= 0) {
      try { voice.stop(); voice.destroy(); } catch { /* gone */ }
      return;
    }
    this._ramp(voice, 0, fadeMs, () => { try { voice.stop(); voice.destroy(); } catch { /* gone */ } });
  }

  /* ------------------------------------------------------------------ */
  /* Speech ducking (question pronunciation)                             */
  /* ------------------------------------------------------------------ */

  /**
   * Temporarily reduce competing effects while the question voice speaks,
   * then restore their intended levels smoothly. Never touches saved
   * volume settings (it is a live multiplier, not a settings change).
   */
  duckForSpeech(on) {
    if (this._speechDuck === !!on) return;
    this._speechDuck = !!on;
    const factor = this._speechDuck ? SPEECH_DUCK : 1;
    for (const v of this._voices) {
      if (v.cat !== 'sfx') continue;
      const base = v.baseVol !== undefined ? v.baseVol : 1;
      this._ramp(v.s, clamp01(base * factor), 120);
    }
    if (!this._speechDuck) this._prune();
  }

  /* ------------------------------------------------------------------ */
  /* Pause / resume (all audio)                                          */
  /* ------------------------------------------------------------------ */

  /** Pause or resume every channel (game pause, portrait, hidden tab). */
  setPaused(paused) {
    if (paused === this._paused) return;
    this._paused = paused;
    if (!this.sound) return;
    try {
      if (paused) this.sound.pauseAll();
      else this.sound.resumeAll();
    } catch { /* manager gone */ }
    if (paused) {
      // movement audio never survives a pause; on resume the pouch is
      // re-measured from scratch (Slingshot resets its motion tracker), so
      // a stationary pouch stays silent instead of replaying old motion.
      this.stopSlingMotion(0);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Collision audio (severity → material layers)                        */
  /* ------------------------------------------------------------------ */

  /**
   * Material impact. severity is the same damage number the physics damage
   * model computed — light taps stay quiet, heavy strikes get the heavy
   * layer. `grounded` (terrain contact) gets a small trim so resting drops
   * do not dominate.
   */
  impact(material, { severity = 10, grounded = false } = {}) {
    const sev = Math.max(0, severity);
    const vol = clamp01(0.45 + sev / 55) * (grounded ? 0.8 : 1);
    if (material === 'wood' || material === 'boom') {
      this.play(sev >= 22 ? 'wood-heavy' : 'wood-light', { volume: vol, tag: 'impact', severity: sev, cooldown: 70 });
    } else if (material === 'glass') {
      this.play(sev >= 22 ? 'glass-crack' : 'glass-hit', { volume: vol, tag: 'impact', severity: sev, cooldown: 70 });
    } else if (material === 'stone') {
      this.play(sev >= 22 ? 'stone-heavy' : 'stone-light', { volume: vol, tag: 'impact', severity: sev, cooldown: 70 });
    } else if (material === 'pig') {
      this.play('wood-light', { volume: vol * 0.5, detune: 250, tag: 'impact', severity: sev, cooldown: 110 });
    }
  }

  /** Material destruction (once per destroyed body — physics guarantees). */
  breakSound(material, { severity = 30, frozen = false } = {}) {
    if (material === 'wood' || material === 'boom') this.play('wood-break', { volume: clamp01(0.6 + severity / 90) });
    else if (material === 'glass') this.play('glass-shatter', { volume: clamp01(0.6 + severity / 90) });
    else if (material === 'stone') this.play(frozen ? 'ice-shatter' : 'stone-crack', { volume: clamp01(0.6 + severity / 90) });
    else if (material === 'pig') this.play('pig-pop');
    if (frozen && (material === 'glass' || material === 'wood')) this.play('ice-shatter', { volume: 0.7 });
    this._noteBreak(material);
  }

  /** Several breaks in a short window == structural collapse accent. */
  _noteBreak(material) {
    const now = this._now();
    this._breaks.push({ t: now, material });
    while (this._breaks.length && now - this._breaks[0].t > 700) this._breaks.shift();
    if (this._breaks.length >= 3 && now - this._lastCollapseAt > 1600) {
      this._lastCollapseAt = now;
      this._breaks.length = 0;
      const wood = this._countRecent('wood') >= this._countRecent('stone');
      this.play(wood ? 'wood-collapse' : 'stone-collapse', { volume: 0.8 });
    }
  }

  _countRecent(material) {
    return this._breaks.filter((b) => b.material === material || b.material === 'boom').length;
  }

  /** Explosion with position/time dedupe (bomb + TNT chains never stack). */
  explosion(x, y) {
    const now = this._now();
    const last = this._lastExplosion;
    const dist = Math.hypot((x || 0) - last.x, (y || 0) - last.y);
    if (now - last.t < 120 || (dist < 90 && now - last.t < 450)) {
      this.stats.dropped.explosion = (this.stats.dropped.explosion || 0) + 1;
      return;
    }
    this._lastExplosion = { t: now, x: x || 0, y: y || 0 };
    this.play('explosion');
  }

  /* ------------------------------------------------------------------ */
  /* Settings (persisted through the existing SaveManager)               */
  /* ------------------------------------------------------------------ */

  setMasterEnabled(v) {
    this.enabled = !!v;
    if (this.save) this.save.setSetting('sound', this.enabled);
    this._applyMute();
    // No music exists to revive: unmuting only allows FUTURE effects.
  }

  /**
   * Persists the music preference. This build ships no music tracks, so
   * the toggle changes nothing audible — it only keeps the user's saved
   * choice intact for a future soundtrack (old saves can never resurrect
   * music that is not loaded).
   */
  setMusicEnabled(v) {
    this.mutes.music = !v;
    if (this.save) this.save.setSetting('music', !!v);
  }

  setSfxEnabled(v) {
    this.mutes.sfx = !v;
    if (this.save) this.save.setSetting('sfx', !!v);
    if (!v) this.stopSlingMotion(0);
  }

  /** Persists the ambience preference (no ambience tracks ship — see setMusicEnabled). */
  setAmbienceEnabled(v) {
    this.mutes.ambience = !v;
    if (this.save) this.save.setSetting('ambience', !!v);
  }

  /** Numeric mixer control (0..1 per bus; not surfaced in the UI yet). */
  setBusVolume(bus, v) {
    if (!(bus in this.bus)) return;
    this.bus[bus] = clamp01(v);
    if (this.save && this.save.data) {
      const s = this.save.data.settings || (this.save.data.settings = {});
      const vol = { ...(s.volumes || {}), [bus]: this.bus[bus] };
      this.save.setSetting('volumes', vol);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Event routing (the interpretation layer)                            */
  /* ------------------------------------------------------------------ */
  _registerRoutes() {
    const R = (event, handler) => this.on(event, handler);

    // ---- slingshot ----
    R('sling-grab', () => this.play('sling-grab')); // subtle contact, once per grab
    R('sling-stretch', (p) => this.updateSlingMotion(
      p ? p.tension : 0,
      p ? p.speed : 0,
      !!(p && p.towardRest)
    ));
    R('sling-cancel', () => {
      this.stopSlingMotion(120);
      this.play('sling-cancel'); // soft leather/elastic return — never a launch
    });

    // ---- launch (one committed shot = one snap + one brief whoosh) ----
    R('launch', (p) => {
      const power = p && typeof p.power === 'number' ? p.power : 0.7;
      this.stopSlingMotion(60);
      this.play('sling-release', { volume: 0.72 + 0.28 * clamp01(power) });
      this.play('bird-launch', { volume: 0.55 + 0.3 * clamp01(power), detune: Math.round(-60 + 120 * clamp01(power)) });
      // no flight loop: any flight accent is the one-shot above and ends
      // with the sample; nothing lingers until shot-resolved.
    });
    R('bird-impact', (p) => {
      this.play('bird-hit', { volume: clamp01(0.35 + (p && p.severity || 8) / 60) });
    });

    // ---- abilities ----
    R('boost', () => this.play('boost'));
    R('split', () => this.play('split'));
    R('freeze', () => this.play('freeze'));
    R('explode', (p) => this.explosion(p && p.x, p && p.y));

    // ---- material collisions (payloads from the damage model) ----
    for (const mat of ['wood', 'glass', 'stone', 'pig', 'boom']) {
      R(`hit-${mat}`, (p) => {
        this.impact(mat, {
          severity: p ? p.severity : 10,
          grounded: !!(p && p.otherKind === 'terrain')
        });
      });
      R(`break-${mat}`, (p) => this.breakSound(mat, {
        severity: p ? p.severity : 30,
        frozen: !!(p && p.frozen)
      }));
    }

    // ---- learning feedback ----
    R('answer-correct', () => this.play('ui-correct'));
    R('answer-wrong', () => this.play('ui-wrong'));
    R('shot-missed', () => this.play('ui-missed'));
    R('question-ready', () => {
      this.stopSlingMotion(0);
      this.play('ui-question');
    });
    R('heart-lost', () => this.play('ui-heart'));

    // ---- question card transitions (once per transition, never per tween frame) ----
    R('card-open', () => this.play('ui-question', { volume: 0.45, detune: 60 }));
    R('card-close', () => this.play('ui-question', { volume: 0.4, detune: -60 }));

    R('level-complete', (p) => {
      const stars = p ? (p.stars || 0) : 0;
      // star chimes lead in, each a bit higher (never all at full volume)
      for (let i = 0; i < Math.min(3, stars); i++) {
        this._delay(250 + i * 330, () => this.play('ui-star', { volume: 0.85, detune: i * 200 }));
      }
      this._delay(700, () => this.play('ui-complete'));
    });
    R('level-failed', () => {
      this._delay(150, () => this.play('ui-failed'));
    });

    // ---- UI ----
    R('ui-click', () => this.play('ui-click'));
    R('ui-hover', () => this.play('ui-hover'));
    R('bird-selected', () => this.play('ui-select'));
    R('game-pause', () => {
      // pauseAll FIRST, then the cue: a click started before pauseAll would
      // freeze mid-play and hang until resume (audible wart, and it read as
      // "sound still playing while paused"). New sounds still play through
      // a paused manager, so the cue completes normally.
      this.setPaused(true);
      this.play('ui-pause');
    });
    R('game-resume', () => {
      this.setPaused(false);
      this.play('ui-resume');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Debug / test surface (development-only; never player-facing UI)     */
  /* ------------------------------------------------------------------ */
  audioDebugInfo() {
    this._prune();
    return {
      attached: this._attached,
      enabled: this.enabled,
      mutes: { ...this.mutes },
      bus: { ...this.bus },
      paused: this._paused,
      speechDuck: this._speechDuck,
      sling: {
        active: this._sling.active,
        key: this._sling.key,
        smoothedSpeed: Math.round(this._sling.smoothed),
        hasVoice: !!this._sling.voice
      },
      activeVoices: this._voices.length,
      active: this._voices.map((v) => ({ key: v.key, cat: v.cat, tag: v.tag || null, vol: v.s ? v.s.volume : 0 })),
      recentEvents: this.eventLog.slice(-12).map((e) => e.event),
      stats: {
        plays: { ...this.stats.plays },
        dropped: { ...this.stats.dropped },
        events: { ...this.stats.events }
      }
    };
  }
}
