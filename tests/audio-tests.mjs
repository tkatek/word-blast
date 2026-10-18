/**
 * FIX #22 — audio system tests.
 *
 * Part A: deterministic unit tests of the AudioManager playback engine
 *         against a fake Phaser sound manager + fake scene clock (no real
 *         audio device needed — routing, mixing, cooldowns, caps, ducking
 *         and settings are all verifiable synchronously).
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
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

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
/* A2 — Slingshot sound lifecycle                                       */
/* ================================================================== */
console.log('\n== slingshot audio =========================================');

test('stretch starts only above the tension threshold and tracks tension', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('sling-stretch-start', { tension: 0.01 });
  eq(sound.sounds.length, 0, 'tiny grab must not start the loop');
  audio.emit('sling-stretch', { tension: 0.4 });
  const loop = sound.sounds.find((s) => s.key === 'sling-stretch');
  assert(loop && loop.isPlaying, 'stretch loop playing at tension 0.4');
  audio.emit('sling-stretch', { tension: 0.95 });
  assert(loop.volume > 0.7, `near-max tension loud enough (vol ${loop.volume.toFixed(2)})`);
  assert(loop.detune > 0, 'tension raises pitch');
  pump(scene, 2000);
});

test('cancel stops the loop and plays a soft return (never a launch)', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('sling-stretch', { tension: 0.6 });
  audio.emit('sling-cancel');
  pump(scene, 2000);
  const loop = sound.sounds.find((s) => s.key === 'sling-stretch');
  assert(loop.stopped, 'stretch loop stopped');
  assert(sound.plays.includes('sling-cancel'), 'elastic return sound played');
  assert(!sound.plays.includes('sling-release') && !sound.plays.includes('birds/launch.wav'),
    'cancel must never trigger launch audio');
});

test('launch plays release + bird cry exactly once and starts the flight loop', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('launch', { power: 0.9, typeKey: 'basic' });
  eq(sound.plays.filter((k) => k === 'sling-release').length, 1, 'one release snap');
  eq(sound.plays.filter((k) => k === 'bird-launch').length, 1, 'one bird cry');
  assert(sound.sounds.some((s) => s.key === 'bird-flight' && s.isPlaying), 'flight loop running');
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
  assert(impactVoices <= 8, `impact voice cap (got ${impactVoices} simultaneous)`);
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
/* A5 — Learning feedback + music coordination                          */
/* ================================================================== */
console.log('\n== feedback + music ========================================');

test('correct answer plays success once and ducks (never stops) music', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.playMusic('music-game');
  pump(scene, 2000); // ramp-in complete
  const music = sound.sounds.find((s) => s.key === 'music-game');
  assert(music && music.isPlaying, 'gameplay music playing');
  const before = music.volume;
  audio.emit('answer-correct');
  eq(sound.plays.filter((k) => k === 'ui-correct').length, 1, 'success jingle once');
  pump(scene, 2600); // duck ramp applied; restore (t+1200ms) not due yet
  assert(music.volume < before, `music ducked (v ${music.volume.toFixed(2)} < ${before.toFixed(2)})`);
  assert(music.isPlaying, 'music still playing under feedback');
});

test('wrong answer plays gentle feedback; missed shot plays a quiet whiff', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.emit('answer-wrong');
  audio.emit('shot-missed');
  eq(sound.plays.filter((k) => k === 'ui-wrong').length, 1);
  eq(sound.plays.filter((k) => k === 'ui-missed').length, 1);
});

test('level complete: star chimes match the star count, music fades out', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.playMusic('music-game');
  pump(scene, 2000);
  audio.emit('level-complete', { stars: 2 });
  pump(scene, 3500);   // staggered chimes + fanfare + music fade-out
  eq(sound.plays.filter((k) => k === 'ui-star').length, 2, 'two stars → two chimes');
  eq(sound.plays.filter((k) => k === 'ui-complete').length, 1, 'fanfare once');
  assert(!sound.plays.includes('music-victory'), 'no victory sting for a normal level');
});

test('level failed: gentle cue, music stops', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.playMusic('music-game');
  pump(scene, 2000);
  audio.emit('level-failed');
  pump(scene, 3200);
  eq(sound.plays.filter((k) => k === 'ui-failed').length, 1, 'failure cue once');
});

test('music switching is idempotent and crossfades instead of stacking', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.playMusic('music-menu');
  pump(scene, 2000);
  audio.playMusic('music-game'); // menu → gameplay
  pump(scene, 3000);
  const game = sound.sounds.filter((s) => s.key === 'music-game');
  const menu = sound.sounds.filter((s) => s.key === 'music-menu');
  eq(game.filter((s) => s.isPlaying).length, 1, 'gameplay music playing');
  assert(menu.every((s) => !s.isPlaying), 'menu music faded out');
  audio.playMusic('music-game'); // SAME key → no-op
  eq(sound.sounds.filter((s) => s.key === 'music-game').length, 1, 'same-key restart refused');
});

test('game pause suspends all audio; resume continues without duplication', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.playMusic('music-game');
  pump(scene, 2500);
  audio.emit('sling-stretch', { tension: 0.5 }); // have a loop running too
  audio.emit('game-pause');
  eq(sound.pauseAllCount, 1, 'pauseAll issued');
  const music = sound.sounds.find((s) => s.key === 'music-game');
  assert(music.isPlaying, 'music instance survives (paused, not destroyed)');
  audio.emit('game-resume');
  eq(sound.resumeAllCount, 1, 'resumeAll issued');
  eq(sound.sounds.filter((s) => s.key === 'music-game').length, 1, 'no duplicate music channel');
});

/* ================================================================== */
/* A6 — Settings + persistence + robustness                             */
/* ================================================================== */
console.log('\n== settings, persistence, robustness =======================');

test('sfx mute silences impacts/abilities but not UI clicks', () => {
  const { audio, sound } = freshManager(new SaveManager(new MemAdapt()));
  audio.setSfxEnabled(false);
  audio.emit('hit-wood', { severity: 30 });
  audio.emit('boost');
  eq(sound.plays.length, 0, 'sfx muted');
  audio.emit('ui-click');
  eq(sound.plays.length, 1, 'ui channel unaffected');
});

test('music mute stops current music and remembers the request', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.playMusic('music-game');
  pump(scene, 2000);
  audio.setMusicEnabled(false);
  pump(scene, 2500);
  assert(sound.sounds.filter((s) => s.key === 'music-game').every((s) => !s.isPlaying), 'music stopped');
  audio.setMusicEnabled(true);
  pump(scene, 3000);
  assert(sound.sounds.some((s) => s.key === 'music-game' && s.isPlaying), 'music restored');
});

test('master mute silences everything; unmute revives desired music', () => {
  const { audio, sound, scene } = freshManager(new SaveManager(new MemAdapt()));
  audio.playMusic('music-menu');
  pump(scene, 2000);
  audio.setMasterEnabled(false);
  eq(sound.mute, true, 'manager muted');
  assert(!audio.enabled, 'bus disabled');
  audio.setMasterEnabled(true);
  pump(scene, 2600);
  eq(sound.mute, false, 'manager unmuted');
  assert(sound.sounds.some((s) => s.key === 'music-menu' && s.isPlaying), 'desired music replayed');
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
  audio.playMusic('music-game');
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

  test('question flow emits question-ready through the real path', () => {
    const audio = h.game.registry.get('audio');
    assert(audio.eventLog.some((e) => e.event === 'question-ready'),
      'question-ready on the bus');
  });

  await testAsync('a real shot emits launch → impacts in order', async () => {
    const audio = h.game.registry.get('audio');
    audio.clearLog();
    h.api.setAutoPause(false);
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
    assert(info.activeVoices <= 14, `voice count bounded (${info.activeVoices})`);
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
