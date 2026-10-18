import { AudioManager } from '../../js/systems/AudioManager.js';
import { SaveManager } from '../../js/systems/SaveManager.js';

class MemAdapt {
  constructor(initial) { this.store = initial !== undefined ? JSON.stringify(initial) : null; }
  read() { return this.store ? JSON.parse(this.store) : null; }
  write(data) { this.store = JSON.stringify(data); return true; }
  clear() { this.store = null; }
}
class FakeSound {
  constructor(mgr, key, config) {
    this.mgr = mgr; this.key = key;
    this.volume = config.volume !== undefined ? config.volume : 1;
    this.detune = config.detune || 0; this.loop = !!config.loop;
    this.isPlaying = false; this.isPaused = false; this.stopped = false; this.destroyed = false;
    this._once = {};
  }
  play() { this.isPlaying = true; this.mgr.plays.push(this.key); }
  pause() {} resume() {} stop() { this.stopped = true; this.isPlaying = false; }
  destroy() { this.destroyed = true; this.isPlaying = false; }
  setVolume(v) { this.volume = v; } setDetune(d) { this.detune = d; }
  once(ev, fn) { (this._once[ev] = this._once[ev] || []).push(fn); }
  fire(ev) { (this._once[ev] || []).slice().forEach((fn) => fn()); }
}
function makeFakeSound() {
  const mgr = {
    mute: false, plays: [], sounds: [],
    add(key, config) {
      if (!this.loaded.has(key)) return null;
      const s = new FakeSound(this, key, config || {}); this.sounds.push(s); return s;
    },
    pauseAll() {}, resumeAll() {}, unlock() {}, once() {},
    loaded: new Set(['wood-light','wood-light-1','wood-light-2','wood-light-3','wood-heavy','wood-heavy-1','wood-heavy-2','bird-hit','bird-flight','sling-stretch','sling-release','sling-cancel','music-game','ui-correct','explosion','split','boost','freeze','glass-hit','glass-hit-1','glass-hit-2','glass-crack','stone-light','stone-light-1','stone-light-2','stone-heavy','stone-heavy-1','stone-heavy-2','stone-crack','wood-break','glass-shatter','ice-shatter','pig-pop','ui-click','music-menu']),
    context: { state: 'running', resume: async () => {} }
  };
  return mgr;
}
const sound = makeFakeSound();
const scene = {
  time: { now: 0, timers: [], delayedCall(ms, fn) { this.timers.push(fn); return { remove() {} }; } },
  tweens: { queue: [], add(cfg) { this.queue.push(cfg); return cfg; } },
  cache: { audio: { exists: (k) => sound.loaded.has(k) } },
  registry: { get: () => new SaveManager(new MemAdapt()) },
  sound
};
const audio = new AudioManager();
audio.attach(scene);
for (let i = 0; i < 10; i++) audio.emit('hit-wood', { severity: 15 });
console.log('hit-wood spam plays:', JSON.stringify(sound.plays));
for (let i = 0; i < 5; i++) audio.emit('bird-impact', { severity: 20 });
console.log('bird-impact spam plays:', JSON.stringify(sound.plays.filter(p => p === 'bird-hit')));
