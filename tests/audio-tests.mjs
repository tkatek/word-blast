/**
 * Audio system tests (audio-repair — silence-first configuration).
 *
 * Part A: deterministic unit tests of the AudioManager playback engine
 *         against a fake Phaser sound manager + fake scene clock (no real
 *         audio device needed — routing, mixing, cooldowns, caps, motion
 *         gating, ducking and settings are all verifiable synchronously).
 * Part B: headless integration — the REAL game boots, a real shot is fired
 *         and the semantic audio events must flow through the bus in the
 *         right order, surviving scene restarts without duplication.
 *
 * Run: node tests/audio-tests.mjs
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AudioManager, AUDIO_MANIFEST, audioManifestKeys, audioPreloadList
} from '../js/systems/AudioManager.js';
import { SaveManager, sanitizeSave, createDefaultSave } from '../js/systems/SaveManager.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** In-memory save adapter (same pattern as run-tests.mjs). */
class MemAdapt {
  constructor(initial) { this.store = initial !== undefined ? JSON.stringify(initial) : null; }
  read() { return this.store ? JSON.parse(this.store) : null; }
  write(data) { this.store = JSON.stringify(data); return true; }
  clear() { this.store = null; }
}

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

/* ================================================================== */
/* Fake Phaser sound manager + fake scene                               */
/* ================================================================== */
class FakeSound {
  constructor(mgr, key, config) {
    this.mgr = mgr;
    this.key = key;
    this.volume = config.volume !== undefined ? config.volume : 1;
    this.detune = config.detune || 0;
    this.loop = !!config.loop;
    this.isPlaying = false;
    this.isPaused = false;
    this.stopped = false;
    this.destroyed = false;
    this._once = {};
  }
  play() { this.isPlaying = true; this.mgr.plays.push(this.key); }
  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; }
  stop() { this.stopped = true; this.isPlaying = false; }
  destroy() { this.destroyed = true; this.isPlaying = false; }
  setVolume(v) { this.volume = v; }
  setDetune(d) { this.detune = d; }
  once(ev, fn) { (this._once[ev] = this._once[ev] || []).push(fn); }
  fire(ev) { (this._once[ev] || []).slice().forEach((fn) => fn()); }
}

function makeFakeSound() {
  const mgr = {
    mute: false,
    pauseAllCount: 0,
    resumeAllCount: 0,
    plays: [],
    sounds: [],
    add(key, config) {
      if (!this.loaded.has(key)) {
        // mirror Phaser: missing keys warn and return null (never throw)
        return null;
      }
      const s = new FakeSound(this, key, config || {});
      this.sounds.push(s);
      return s;
    },
    pauseAll() { this.pauseAllCount++; },
    resumeAll() { this.resumeAllCount++; },
    unlock() { this.unlockCount = (this.unlockCount || 0) + 1; },
    once() {},
    loaded: new Set(audioManifestKeys()),
    context: { state: 'running', resume: async () => {} }
  };
  return mgr;
}

function makeFakeScene(save, sound) {
  // Minimal game event emitter: tests pump the engine clock by emitting
  // 'poststep' with an explicit time — exactly how the real game drives it.
  const events = {
    map: new Map(),
    on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, []); this.map.get(ev).push(fn); },
    off(ev, fn) { const l = this.map.get(ev); if (l) this.map.set(ev, l.filter((f) => f !== fn)); },
    emit(ev, ...args) { (this.map.get(ev) || []).slice().forEach((fn) => fn(...args)); }
  };
  const scene = {
    time: { now: 0 }, // parity only — the engine reads the poststep clock
    game: { events },
    cache: { audio: { exists: (k) => sound.loaded.has(k) } },
    registry: { get: (k) => (k === 'save' ? save : null) },
    sound
  };
  return scene;
}

/** Advance the engine clock to `now` ms and run one engine tick. */
function pump(scene, now) {
  scene.time.now = now;
  scene.game.events.emit('poststep', now, 16);
}

function freshManager(save) {
  const sound = makeFakeSound();
  const scene = makeFakeScene(save, sound);
  const audio = new AudioManager();
  audio.attach(scene);
  pump(scene, 1000); // establish the engine clock
  return { audio, scene, sound, save };
}

/** Simulate the per-frame motion feed from the Slingshot. */
function motion(audio, { tension = 0.5, speed = 0, towardRest = false }) {
  audio.updateSlingMotion(tension, speed, towardRest);
}

/** Drive `frames` motion frames at 60fps, advancing the engine clock. */
function drive(audio, scene, t0, frames, m) {
  let t = t0;
  for (let i = 0; i < frames; i++) {
    motion(audio, m);
    t += 16;
    pump(scene, t);
  }
  return t;
}

/** All live (non-destroyed, non-stopped) sounds the fake manager holds. */
function liveSounds(sound) {
  return sound.sounds.filter((s) => !s.destroyed && !s.stopped);
}

/* ================================================================== */
/* A1 — Manifest ↔ disk integrity                                       */
/* ================================================================== */
console.log('\n== audio manifest ↔ asset files ============================');

test('every preload list entry maps to a real file on disk', () => {
  const list = audioPreloadList();
  assert(list.length >= 40, `expected a full sound set, got ${list.length}`);
  for (const { key, file } of list) {
    const p = join(ROOT, 'public', 'assets', 'audio', file);
    assert(existsSync(p), `missing file for ${key}: ${file}`);
    assert(statSync(p).size > 200, `${file} suspiciously small`);
  }
});

test('preload keys are unique and cover every playable sound', () => {
  const list = audioPreloadList();
  eq(new Set(list.map((e) => e.key)).size, list.length, 'duplicate preload keys');
  const keys = new Set(list.map((e) => e.key));
  for (const [key, def] of Object.entries(AUDIO_MANIFEST)) {
    // entries with variations play ONLY the variation keys (each file
    // decoded exactly once); the bare key is a manifest alias
    for (const playable of def.vars && def.vars.length ? def.vars : [key]) {
      assert(keys.has(playable), `playable key ${playable} never preloaded`);
    }
  }
});

test('every wav under public/assets/audio is referenced by the manifest', () => {
  const wanted = new Set(audioPreloadList().map((e) => e.file));
  const walk = (dir, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (name.endsWith('.wav')) {
        const rel = `${prefix}${name}`;
        assert(wanted.has(rel), `orphan audio file not in manifest: ${rel}`);
      }
    }
  };
  walk(join(ROOT, 'public', 'assets', 'audio'));
});

test('no music or ambience files ship (silence-first configuration)', () => {
  assert(!existsSync(join(ROOT, 'public', 'assets', 'audio', 'music')), 'music/ directory must not exist');
  assert(!existsSync(join(ROOT, 'public', 'assets', 'audio', 'ambience')), 'ambience/ directory must not exist');
  assert(!existsSync(join(ROOT, 'public', 'assets', 'audio', 'birds', 'flight-loop.wav')), 'flight loop must not exist');
  assert(!existsSync(join(ROOT, 'public', 'assets', 'audio', 'slingshot', 'stretch-loop.wav')), 'old stretch loop must not exist');
});

test('no manifest entry loops — every sound is a self-terminating one-shot', () => {
  for (const [key, def] of Object.entries(AUDIO_MANIFEST)) {
    eq(def.loop || false, false, `${key} must not be a loop`);
  }
});

test('all wavs are well-formed RIFF/PCM (44-byte header, mono, 22050 Hz)', () => {
  for (const { file } of audioPreloadList()) {
    const buf = readFileSync(join(ROOT, 'public', 'assets', 'audio', file));
    eq(buf.toString('ascii', 0, 4), 'RIFF', `${file}: not RIFF`);
    eq(buf.toString('ascii', 8, 12), 'WAVE', `${file}: not WAVE`);
    eq(buf.readUInt16LE(20), 1, `${file}: not PCM`);
    eq(buf.readUInt16LE(22), 1, `${file}: not mono`);
    eq(buf.readUInt32LE(24), 22050, `${file}: sample rate`);
    eq(buf.readUInt16LE(34), 16, `${file}: not 16-bit`);
  }
});

/* ================================================================== */
/* A2 — Slingshot motion audio                                          */
/* ================================================================== */
console.log('\n== slingshot motion audio ==================================');

test('grab plays one subtle contact tick — pressing and holding is silent', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('sling-grab');
  eq(sound.plays.filter((k) => k === 'sling-grab').length, 1, 'one contact tick');
  eq(liveSounds(sound).filter((s) => s.isPlaying).length, 1, 'no other layer started');
});

test('pouch MOVEMENT starts a leather segment (speed-driven, not tension)', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  drive(audio, scene, 1100, 6, { tension: 0.4, speed: 420 });
  const segs = liveSounds(sound).filter((s) => s.key.startsWith('sling-stretch-'));
  eq(segs.length, 1, 'exactly one stretch segment audible');
  assert(segs[0].isPlaying, 'segment playing');
  assert(!segs[0].loop, 'segment is a one-shot, never a loop');
  assert(segs[0].volume > 0.1, `movement audible (vol ${segs[0].volume.toFixed(2)})`);
});

test('tension WITHOUT movement never makes a sound (held fully-stretched = silent)', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  drive(audio, scene, 1100, 40, { tension: 1.0, speed: 0 }); // 640ms at full tension, still
  drive(audio, scene, 1800, 40, { tension: 0.95, speed: 3 }); // tremor-level jitter
  eq(liveSounds(sound).filter((s) => s.key.startsWith('sling-stretch')).length, 0,
    'no stretch audio without real movement');
});

test('movement stopping fades the segment out promptly (pull-and-hold)', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  let t = drive(audio, scene, 1100, 6, { tension: 0.8, speed: 500 });
  const seg = liveSounds(sound).find((s) => s.key.startsWith('sling-stretch-'));
  assert(seg, 'segment started');
  // hold still: EMA decays, STOP_HOLD elapses, fade completes
  t = drive(audio, scene, t, 14, { tension: 0.8, speed: 0 });
  t = drive(audio, scene, t, 12, { tension: 0.8, speed: 0 });
  assert(!audio._sling.voice, 'engine released the voice');
  assert(seg.destroyed || seg.stopped, 'segment stopped/destroyed after the fade');
});

test('moving again resumes naturally — one layer, no stacking', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  let t = drive(audio, scene, 1100, 6, { tension: 0.6, speed: 450 });
  t = drive(audio, scene, t, 30, { tension: 0.6, speed: 0 }); // fade out fully
  t = drive(audio, scene, t, 10, { tension: 0.6, speed: 400 }); // move again
  const segs = liveSounds(sound).filter((s) => s.key.startsWith('sling-stretch-') && s.isPlaying);
  eq(segs.length, 1, 'exactly one layer after resume (no stacking)');
});

test('a finished segment chains once while movement continues', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  let t = drive(audio, scene, 1100, 6, { tension: 0.5, speed: 500 });
  const seg = liveSounds(sound).find((s) => s.key.startsWith('sling-stretch-'));
  assert(seg, 'segment started');
  seg.fire('ended'); // natural end while still moving
  motion(audio, { tension: 0.5, speed: 500 });
  pump(scene, t += 16);
  const live = liveSounds(sound).filter((s) => s.key.startsWith('sling-stretch-') && s.isPlaying);
  eq(live.length, 1, 'next segment chained, still exactly one voice');
});

test('pointer motion beyond the drag limit (clamped pouch still) stays silent', () => {
  // the Slingshot emits speed measured on the CLAMPED pouch: when the
  // pointer runs past MAX_DRAG the accepted position stops moving →
  // speed 0 → no new segment, even at full tension.
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  drive(audio, scene, 1100, 30, { tension: 1.0, speed: 0 });
  eq(liveSounds(sound).length, 0, 'excess pointer motion generated no audio');
});

test('cancel: movement audio fades, soft return plays, NEVER a launch sound', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  drive(audio, scene, 1100, 6, { tension: 0.6, speed: 450 });
  audio.emit('sling-cancel');
  pump(scene, 3000);
  assert(!audio._sling.voice, 'movement voice released');
  assert(sound.plays.includes('sling-cancel'), 'soft leather return played');
  assert(!sound.plays.includes('sling-release') && !sound.plays.includes('bird-launch'),
    'cancel must never trigger launch audio');
});

test('launch: exactly one snap + one brief whoosh, no flight loop, stretch stops', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  drive(audio, scene, 1100, 6, { tension: 0.9, speed: 500 });
  audio.emit('launch', { power: 0.9, typeKey: 'basic' });
  pump(scene, 3000);
  eq(sound.plays.filter((k) => k === 'sling-release').length, 1, 'one release snap');
  eq(sound.plays.filter((k) => k === 'bird-launch').length, 1, 'one bird cry');
  eq(sound.sounds.filter((s) => s.loop).length, 0, 'no looping sound of any kind');
  assert(!audio._sling.voice, 'stretch fully released on launch');
});

/* ================================================================== */
/* A3 — Collision severity + material routing                           */
/* ================================================================== */
console.log('\n== collision audio =========================================');

test('light vs strong impacts pick different wood layers', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('hit-wood', { severity: 8 });
  const light = sound.plays.filter((k) => k.startsWith('wood-light')).length;
  const heavy = sound.plays.filter((k) => k.startsWith('wood-heavy')).length;
  assert(light === 1 && heavy === 0, `light wood (sev 8) → light layer (l=${light} h=${heavy})`);
  sound.plays.length = 0;
  audio.emit('hit-wood', { severity: 40 });
  assert(sound.plays.some((k) => k.startsWith('wood-heavy')), 'strong wood → heavy layer');
});

test('wood, glass and stone route to audibly different sounds', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('hit-wood', { severity: 12 });
  audio.emit('hit-glass', { severity: 12 });
  audio.emit('hit-stone', { severity: 12 });
  const fams = sound.plays.map((k) => k.split('-')[0]);
  eq(new Set(fams).size, 3, `three distinct material families (got ${fams})`);
});

test('impact volume grows with severity and terrain hits are trimmed', () => {
  const a = freshManager(new SaveManager(new MemAdapt()));
  a.audio.emit('hit-wood', { severity: 6 });
  const quiet = a.sound.sounds[0].volume;
  const b = freshManager(new SaveManager(new MemAdapt()));
  b.audio.emit('hit-wood', { severity: 45 });
  const loud = b.sound.sounds[0].volume;
  assert(loud > quiet * 1.5, `severity scales volume (q=${quiet.toFixed(2)} l=${loud.toFixed(2)})`);
  const c = freshManager(new SaveManager(new MemAdapt()));
  c.audio.emit('hit-stone', { severity: 30 });
  const air = c.sound.sounds[0].volume;
  const d = freshManager(new SaveManager(new MemAdapt()));
  d.audio.emit('hit-stone', { severity: 30, otherKind: 'terrain' });
  const ground = d.sound.sounds[0].volume;
  assert(ground < air, 'grounded contact is quieter');
});

test('rapid duplicate impacts are debounced (cooldown)', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  for (let i = 0; i < 10; i++) audio.emit('hit-wood', { severity: 15 });
  eq(sound.plays.filter((k) => k.startsWith('wood')).length, 1, 'same-frame spam → one sound');
});

test('impact voice cap holds under a burst; strongest wins', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  // spread over time so cooldowns pass; alternate materials to bypass
  // per-key cooldown and hammer the global impact cap
  const mats = ['hit-wood', 'hit-glass', 'hit-stone', 'hit-pig'];
  let sev = 10;
  for (let i = 0; i < 40; i++) {
    pump(scene, 1030 + i * 30);
    audio.emit(mats[i % mats.length], { severity: sev });
  }
  const impactVoices = sound.sounds.filter((s) => s.isPlaying && !s.loop).length;
  assert(impactVoices <= 6, `impact voice cap (got ${impactVoices} simultaneous)`);
  // a much stronger impact must displace a weaker active one
  pump(scene, 2230 + 200);
  audio.emit('hit-stone', { severity: 90 });
  assert(sound.sounds.some((s) => s.isPlaying && s.key.startsWith('stone-heavy')),
    'strong impact still lands at cap');
});

test('wood/stone/glass destruction plays material-specific breaks once', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('break-wood', { severity: 40 });
  pump(scene, 1900); // space them: 3 breaks at once WOULD be a collapse
  audio.emit('break-glass', { severity: 40 });
  pump(scene, 2800);
  audio.emit('break-stone', { severity: 40 });
  assert(sound.plays.includes('wood-break'), 'wood break');
  assert(sound.plays.includes('glass-shatter'), 'glass shatter');
  assert(sound.plays.includes('stone-crack'), 'stone crack');
  assert(!sound.plays.includes('wood-collapse'), 'spaced single breaks are not a collapse');
});

test('three breaks in a short window trigger ONE collapse accent', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  for (let i = 0; i < 3; i++) {
    pump(scene, 1080 + i * 80);
    audio.emit('break-wood', { severity: 45 });
  }
  eq(sound.plays.filter((k) => k === 'wood-collapse').length, 1, 'collapse accent fired once');
  // more breaks inside the lockout window must NOT retrigger
  for (let i = 0; i < 3; i++) {
    pump(scene, 1320 + i * 80);
    audio.emit('break-wood', { severity: 45 });
  }
  eq(sound.plays.filter((k) => k === 'wood-collapse').length, 1, 'lockout respected');
});

test('frozen blocks shatter icy, never woody', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('break-stone', { severity: 50, frozen: true });
  audio.emit('break-glass', { severity: 50, frozen: true });
  assert(sound.plays.includes('ice-shatter'), 'frozen break uses ice layer');
  eq(sound.plays.filter((k) => k === 'wood-break').length, 0, 'no wood audio for ice');
});

/* ================================================================== */
/* A4 — Abilities / explosion dedupe                                    */
/* ================================================================== */
console.log('\n== abilities + explosion dedupe ============================');

test('bomb explosion plays once even when bomb + chain emit close together', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('explode', { x: 400, y: 300, source: 'bomb' });
  audio.emit('explode', { x: 405, y: 302, source: 'blast' }); // same-frame chain
  eq(sound.plays.filter((k) => k === 'explosion').length, 1, 'deduped');
});

test('spaced TNT chain stays audible but rate-limited', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('explode', { x: 400, y: 300 });
  pump(scene, 1250); // past the 120ms global gap
  audio.emit('explode', { x: 700, y: 300 });
  pump(scene, 1280);  // too soon — dropped
  audio.emit('explode', { x: 1000, y: 300 });
  eq(sound.plays.filter((k) => k === 'explosion').length, 2, 'two of three blasts pass');
});

test('split / boost / freeze each play exactly one activation sound', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('split');
  audio.emit('boost');
  audio.emit('freeze');
  for (const k of ['split', 'boost', 'freeze']) {
    eq(sound.plays.filter((p) => p === k).length, 1, `${k} once`);
  }
  // the five split children colliding: ONE bird vocal (cooldown), not five
  for (let i = 0; i < 5; i++) audio.emit('bird-impact', { severity: 20 });
  eq(sound.plays.filter((k) => k === 'bird-hit').length, 1, 'split fan → single bird vocal');
});

/* ================================================================== */
/* A5 — Learning feedback + speech ducking                              */
/* ================================================================== */
console.log('\n== feedback + speech ducking ===============================');

test('correct answer plays success exactly once', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('answer-correct');
  eq(sound.plays.filter((k) => k === 'ui-correct').length, 1, 'success jingle once');
});

test('wrong answer plays gentle feedback; missed shot plays a quiet whiff', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('answer-wrong');
  audio.emit('shot-missed');
  eq(sound.plays.filter((k) => k === 'ui-wrong').length, 1);
  eq(sound.plays.filter((k) => k === 'ui-missed').length, 1);
});

test('speech ducking lowers active sfx and restores them smoothly', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('hit-wood', { severity: 40 });
  const voice = sound.sounds.find((s) => s.isPlaying && s.key.startsWith('wood'));
  assert(voice, 'impact voice live');
  const before = voice.volume;
  audio.duckForSpeech(true);
  pump(scene, 2000);
  assert(voice.volume < before * 0.6, `ducked (v ${voice.volume.toFixed(2)} < ${before.toFixed(2)})`);
  audio.duckForSpeech(false);
  pump(scene, 3000);
  assert(Math.abs(voice.volume - before) < 0.02, `restored (v ${voice.volume.toFixed(2)})`);
});

test('level complete: star chimes match the star count, no music track', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('level-complete', { stars: 2 });
  pump(scene, 3500);
  eq(sound.plays.filter((k) => k === 'ui-star').length, 2, 'two stars → two chimes');
  eq(sound.plays.filter((k) => k === 'ui-complete').length, 1, 'fanfare once');
  eq(sound.sounds.length, sound.sounds.filter((s) => !s.loop).length, 'no looping track started');
});

test('level failed: gentle cue once', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('level-failed');
  pump(scene, 3200);
  eq(sound.plays.filter((k) => k === 'ui-failed').length, 1, 'failure cue once');
});

test('game pause suspends all audio and kills the movement voice; resume is clean', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  drive(audio, scene, 1100, 6, { tension: 0.5, speed: 450 });
  const seg = liveSounds(sound).find((s) => s.key.startsWith('sling-stretch-'));
  assert(seg, 'segment live');
  audio.emit('game-pause');
  eq(sound.pauseAllCount, 1, 'pauseAll issued');
  assert(!audio._sling.voice, 'movement voice dropped on pause');
  audio.emit('game-resume');
  eq(sound.resumeAllCount, 1, 'resumeAll issued');
  // resume with a stationary pouch: nothing may restart
  pump(scene, 5000);
  eq(liveSounds(sound).filter((s) => s.key.startsWith('sling-stretch-')).length, 0,
    'no stretch sound resurrected after resume');
});

/* ================================================================== */
/* A6 — Settings + persistence + robustness                             */
/* ================================================================== */
console.log('\n== settings, persistence, robustness =======================');

test('sfx mute silences impacts/abilities/movement but not UI clicks', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.setSfxEnabled(false);
  audio.emit('hit-wood', { severity: 30 });
  audio.emit('boost');
  drive(audio, scene, 1100, 6, { tension: 0.6, speed: 500 });
  eq(sound.plays.length, 0, 'sfx muted (incl. movement audio)');
  audio.emit('ui-click');
  eq(sound.plays.length, 1, 'ui channel unaffected');
});

test('music toggle only persists the preference — nothing can play', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.setMusicEnabled(false);
  audio.setMusicEnabled(true);
  eq(audio.mutes.music, false, 'preference stored');
  eq(sound.sounds.length, 0, 'no music exists to start in this build');
});

test('an OLD save with music ON cannot resurrect background audio', () => {
  const legacy = { version: 1, settings: { sound: true, music: true, ambience: true } };
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt(legacy)));
  audio.unlock(); // the classic resurrection path: gesture → unlock → retry music
  pump(scene, 3000);
  eq(sound.sounds.length, 0, 'silence preserved (no tracks shipped, none restarted)');
  assert(!('music' in audio) || typeof audio.playMusic !== 'function', 'no music API to misuse');
});

test('master mute silences everything; unmute replays NOTHING old', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('ui-click');
  const voicesBefore = sound.sounds.length; // the click (fakes never auto-end)
  audio.setMasterEnabled(false);
  eq(sound.mute, true, 'manager muted');
  assert(!audio.enabled, 'bus disabled');
  audio.setMasterEnabled(true);
  pump(scene, 2600);
  eq(sound.mute, false, 'manager unmuted');
  eq(sound.sounds.length, voicesBefore, 'unmute started no new sound');
});

test('new settings persist through the SaveManager and reload', () => {
  const save = new SaveManager(new MemAdapt());
  save.load();
  save.setSetting('music', false);
  save.setSetting('sfx', false);
  const raw = save.adapter.read(); // MemAdapt.read returns the parsed save
  eq(raw.settings.music, false);
  eq(raw.settings.sfx, false);
  const reloaded = new SaveManager(new MemAdapt(raw));
  reloaded.load();
  eq(reloaded.data.settings.music, false, 'music toggle survives reload');
  eq(reloaded.data.settings.sound, true, 'master untouched');
});

test('old saves (v1 without audio fields) load with audio defaults on', () => {
  const legacy = sanitizeSave({
    version: 1,
    settings: { sound: false, reducedMotion: true } // pre-Fix22 shape
  });
  eq(legacy.settings.sound, false, 'legacy master mute preserved');
  eq(legacy.settings.music, true, 'music defaults on');
  eq(legacy.settings.sfx, true, 'sfx defaults on');
  eq(legacy.settings.ambience, true, 'ambience defaults on');
  assert(legacy.settings.volumes && legacy.settings.volumes.master > 0, 'default bus levels');
});

test('hacked volume values are clamped 0..1', () => {
  const s = sanitizeSave({
    version: 1,
    settings: { volumes: { master: 42, music: -3, sfx: 0.5 } }
  });
  eq(s.settings.volumes.master, 1);
  eq(s.settings.volumes.music, 0);
  eq(s.settings.volumes.sfx, 0.5);
});

test('default save stays valid through sanitize', () => {
  assert(sanitizeSave(createDefaultSave()) !== null);
});

test('missing assets never crash — plays are dropped and counted', () => {
  const sound = makeFakeSound();
  sound.loaded.clear(); // simulate total asset loss
  const scene = makeFakeScene(new SaveManager(new MemAdapt()), sound);
  const audio = new AudioManager();
  audio.attach(scene);
  audio.emit('launch', { power: 1 });
  audio.emit('hit-wood', { severity: 30 });
  audio.emit('explode', { x: 1, y: 1 });
  eq(sound.plays.length, 0, 'nothing played');
  assert((audio.stats.dropped['sling-release'] || 0) + (audio.stats.dropped['explosion'] || 0) >= 1,
    'drops counted for diagnostics');
});

test('attach() is idempotent — a second call cannot double-route events', () => {
  const sound = makeFakeSound();
  const scene = makeFakeScene(new SaveManager(new MemAdapt()), sound);
  const audio = new AudioManager();
  audio.attach(scene);
  audio.attach(scene); // BootScene re-run / restart scenario
  audio.emit('ui-click');
  eq(sound.plays.filter((k) => k === 'ui-click').length, 1, 'exactly one click');
});

test('unknown events and payloads are ignored safely', () => {
  const { audio } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('something-new', { weird: true });
  audio.emit('hit-wood'); // no payload at all
  audio.emit('launch', {}); // empty payload
  assert(true, 'no exceptions');
});

/* ================================================================== */
/* Part B — headless real-game integration                              */
/* ================================================================== */
console.log('\n== headless integration (real game, real events) ===========');

async function headless() {
  const { createHeadlessGame } = await import('./helpers/headless-game.mjs');
  const h = await createHeadlessGame();

  /** Async variant of test(): AWAITS the body so ordering is real. */
  const testAsync = async (name, fn) => {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (e) {
      failed++;
      failures.push({ name, error: e });
      console.log(`FAIL  ${name}\n      ${e.message}`);
    }
  };

  // wait for BootScene to wire the registry before asserting anything
  const booted = await h.waitFor(() => !!h.game.registry.get('audio'), 8000, 'audio in registry');
  assert(booted, 'BootScene registered the audio engine');

  test('boot attaches exactly one audio engine to the real game', () => {
    const audio = h.game.registry.get('audio');
    assert(audio instanceof AudioManager, 'registry audio is the engine');
    assert(audio._attached, 'engine attached');
  });

  await h.gotoLevel(1);
  await h.waitForState('AIMING');
  h.api.setAutoPause(false); // headless tab can blur mid-run → never auto-pause

  test('question flow emits question-ready through the real path', () => {
    const audio = h.game.registry.get('audio');
    assert(audio.eventLog.some((e) => e.event === 'question-ready'),
      'question-ready on the bus');
  });

  await testAsync('a settled level emits no further audio events on its own', async () => {
    const audio = h.game.registry.get('audio');
    // settle first: the previous test's shot may still be resolving → let
    // the question advance / re-arm finish before the idle window.
    await h.waitForState('AIMING', 12000);
    audio.clearLog();
    await new Promise((r) => setTimeout(r, 1500));
    eq(audio.eventLog.length, 0, 'silent bus with no input (silence-first)');
  });

  await testAsync('a real shot emits launch → impacts in order', async () => {
    const audio = h.game.registry.get('audio');
    audio.clearLog();
    h.fire(16, -11); // lob toward the answer towers
    await h.waitForState('PHYSICS_RESOLVING', 9000);
    await h.waitFor(() => {
      const names = audio.eventLog.map((e) => e.event);
      return names.includes('bird-impact') || names.some((n) => n.startsWith('hit-'));
    }, 6000, 'first impact event');
    const names = audio.eventLog.map((e) => e.event);
    const li = names.indexOf('launch');
    assert(li >= 0, 'launch on the bus');
    const firstImpact = names.findIndex((e2) => e2.startsWith('hit-') || e2 === 'bird-impact');
    assert(firstImpact > li, `impact after launch (launch@${li}, impact@${firstImpact})`);
    // one launch per shot — no duplicated listeners
    eq(names.filter((e2) => e2 === 'launch').length, 1, 'exactly one launch');
  });

  await testAsync('scene restart re-fires per-question events without stacking handlers', async () => {
    const audio = h.game.registry.get('audio');
    const beforeEvents = audio.stats.events['question-ready'] || 0;
    h.api.gotoLevel(1);
    await h.waitForState('AIMING', 15000);
    const after = audio.stats.events['question-ready'] || 0;
    assert(after > beforeEvents, 'question-ready fired again for the fresh load');
    audio.clearLog();
    h.fire(16, -11);
    await h.waitFor(() => audio.eventLog.some((e) => e.event === 'launch'), 2000, 'launch after restart');
    eq(audio.eventLog.filter((e) => e.event === 'launch').length, 1,
      'still exactly one launch per shot after restart');
  });

  test('audio stats stay sane after real gameplay (no runaway voices)', () => {
    const audio = h.game.registry.get('audio');
    const info = audio.audioDebugInfo();
    assert(info.activeVoices <= 10, `voice count bounded (${info.activeVoices})`);
    assert(info.attached, 'engine still attached');
  });

  h.game.destroy(true);
}

/* Memory adapter lives at the top of the file (used by every unit test) */

await headless().catch((e) => {
  failed++;
  failures.push({ name: 'headless audio integration', error: e });
  console.log(`FAIL  headless audio integration\n      ${e.message}`);
});

console.log('\n== summary ==================================================');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(` - ${f.name}: ${f.error.message}`);
  process.exit(1);
}
