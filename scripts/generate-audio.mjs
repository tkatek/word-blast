/**
 * FIX #22 — original audio asset generator.
 *
 * Synthesizes every game sound + music track procedurally (pure Node, no
 * dependencies, no external samples) into 16-bit mono 22050 Hz WAV files
 * under public/assets/audio/. All content is ORIGINAL: oscillators, noise,
 * filters, Karplus-Strong plucks and envelopes defined in this file —
 * nothing is copied from any commercial game.
 *
 * Usage:  node scripts/generate-audio.mjs [--quiet]
 *
 * Determinism: a fixed seed drives every random choice, so re-running the
 * script reproduces byte-identical assets (regeneration is safe).
 *
 * QC: after writing, the script measures duration / peak / RMS per file,
 * refuses peaks above -1 dBFS or NaN buffers, and verifies loop files have
 * seamless boundaries (crossfaded ends). Perceptual listening quality still
 * requires human verification (see FIX22-NOTES.md).
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'public', 'assets', 'audio');
const SR = 22050; // sample rate — covers everything these sounds use
const QUIET = process.argv.includes('--quiet');

/* ------------------------------------------------------------------ */
/* Deterministic RNG                                                    */
/* ------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(0xf00d22);
const rand = (a = 1, b) => (b === undefined ? rng() * a : a + rng() * (b - a));
const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];

/* ------------------------------------------------------------------ */
/* Buffer helpers                                                       */
/* ------------------------------------------------------------------ */
const n = (sec) => Math.max(1, Math.round(sec * SR));
const zeros = (sec) => new Float32Array(n(sec));

function mix(dst, atSec, src, gain = 1) {
  const off = Math.round(atSec * SR);
  for (let i = 0; i < src.length; i++) {
    const j = off + i;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * gain;
  }
  return dst;
}

/** Normalize to a target peak (dBFS, negative). */
function peakTo(buf, db) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak === 0) return buf;
  const g = Math.pow(10, db / 20) / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** Normalize to a target RMS (dBFS) with a peak ceiling. */
function rmsTo(buf, db, maxPeakDb = -1) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length) || 1e-9;
  let g = Math.pow(10, db / 20) / rms;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak * g > Math.pow(10, maxPeakDb / 20)) g = Math.pow(10, maxPeakDb / 20) / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

function fadeEdges(buf, inMs = 4, outMs = 8) {
  const a = Math.min(buf.length, Math.round((inMs / 1000) * SR));
  const b = Math.min(buf.length, Math.round((outMs / 1000) * SR));
  for (let i = 0; i < a; i++) buf[i] *= i / a;
  for (let i = 0; i < b; i++) buf[buf.length - 1 - i] *= i / b;
  return buf;
}

/** Seamless loop: crossfade the tail into the head. */
function loopify(buf, xfMs = 220) {
  const L = Math.round((xfMs / 1000) * SR);
  const cut = buf.length - L;
  const out = buf.subarray(0, cut); // loop body = everything before the tail
  for (let i = 0; i < L; i++) {
    const t = i / L; // 0..1 across the crossfade
    out[i] = out[i] * t + buf[cut + i] * (1 - t);
  }
  return out;
}

/** Soft saturation — tames sum-bus peaks without hard digital clipping. */
function softclip(buf, drive = 1.4) {
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] * drive;
    buf[i] = Math.tanh(x) / Math.tanh(drive);
  }
  return buf;
}

/* ------------------------------------------------------------------ */
/* Oscillators + noise                                                  */
/* ------------------------------------------------------------------ */
/**
 * Glide oscillator. `freq` may be a number or [startHz, endHz] (linear
 * glide). wave: sine | tri | saw | square. vibrato in Hz / depth in Hz.
 */
function tone({ dur, freq, wave = 'sine', gain = 1, attack = 0.004, release = 0.05, vibratoHz = 0, vibratoDepth = 0, glideShape = 1 }) {
  const len = n(dur);
  const out = new Float32Array(len);
  const f0 = Array.isArray(freq) ? freq[0] : freq;
  const f1 = Array.isArray(freq) ? freq[1] : freq;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const tt = Math.pow(t, glideShape);
    let f = f0 + (f1 - f0) * tt;
    if (vibratoHz) f += Math.sin(2 * Math.PI * vibratoHz * (i / SR)) * vibratoDepth;
    phase += (2 * Math.PI * f) / SR;
    const p = phase % (2 * Math.PI);
    let v;
    if (wave === 'sine') v = Math.sin(p);
    else if (wave === 'tri') v = p < Math.PI ? 4 * (p / (2 * Math.PI)) - 1 : 3 - 4 * (p / (2 * Math.PI));
    else if (wave === 'saw') v = 2 * (p / (2 * Math.PI)) - 1;
    else v = p < Math.PI ? 1 : -1; // square
    const ta = i / (attack * SR);
    const tr = (len - i) / (release * SR);
    const env = Math.min(1, ta, tr);
    out[i] = v * gain * (env < 0 ? 0 : env);
  }
  return out;
}

/** Exponentially-decaying damped sine ("knock" / "marimba" partial). */
function damped({ dur, freq, decay = 18, gain = 1, attack = 0.002, phase = 0 }) {
  const len = n(dur);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const a = Math.min(1, t / attack);
    out[i] = Math.sin(2 * Math.PI * freq * t + phase) * Math.exp(-t * decay) * gain * a;
  }
  return out;
}

function noiseBuf(dur, kind = 'white') {
  const len = n(dur);
  const out = new Float32Array(len);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) out[i] = rng() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's 3-row approximation
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
  } else { // brown
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      out[i] = last * 3.5;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Biquad filters (RBJ cookbook)                                         */
/* ------------------------------------------------------------------ */
function biquad(buf, kind, freq, q = 0.707) {
  const w0 = (2 * Math.PI * Math.min(freq, SR * 0.49)) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  let b0, b1, b2, a0, a1, a2;
  if (kind === 'lp') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (kind === 'hp') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else { // bp (constant skirt gain)
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  const out = new Float32Array(buf.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}
const lp = (b, f, q) => biquad(b, 'lp', f, q);
const hp = (b, f, q) => biquad(b, 'hp', f, q);
const bp = (b, f, q) => biquad(b, 'bp', f, q);

/* ------------------------------------------------------------------ */
/* Karplus-Strong plucked string                                        */
/* ------------------------------------------------------------------ */
function pluck(dur, freq, { decay = 0.9965, bright = 0.6, gain = 1 } = {}) {
  const N = Math.max(2, Math.round(SR / freq));
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = rng() * 2 - 1;
  // pre-darken the excitation: brighter notes attack brighter
  for (let i = 1; i < N; i++) line[i] = line[i] * bright + line[i - 1] * (1 - bright);
  const len = n(dur);
  const out = new Float32Array(len);
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    const nxt = line[(idx + 1) % N];
    line[idx] = (cur + nxt) * 0.5 * decay;
    out[i] = cur;
    idx = (idx + 1) % N;
  }
  fadeEdges(out, 2, 20);
  for (let i = 0; i < len; i++) out[i] *= gain;
  return out;
}

/* ------------------------------------------------------------------ */
/* Small Schroeder reverb (3 combs + 2 allpass) — adds "space"          */
/* ------------------------------------------------------------------ */
function reverb(buf, mixLevel = 0.18, { combMs = [29.7, 37.1, 41.1], allpassMs = [5, 1.7], decay = 0.77 } = {}) {
  let wet = new Float32Array(buf.length);
  for (const ms of combMs) {
    const d = Math.round((ms / 1000) * SR);
    const dl = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = dl[idx];
      dl[idx] = buf[i] + v * decay;
      wet[i] += v;
      idx = (idx + 1) % d;
    }
  }
  for (const ms of allpassMs) {
    const d = Math.max(1, Math.round((ms / 1000) * SR));
    const dl = new Float32Array(d);
    let idx = 0;
    const next = new Float32Array(wet.length);
    for (let i = 0; i < wet.length; i++) {
      const v = dl[idx];
      dl[idx] = wet[i] + v * 0.5;
      next[i] = v - dl[idx];
      idx = (idx + 1) % d;
    }
    wet = next;
  }
  const out = new Float32Array(buf.length);
  const g = mixLevel / combMs.length;
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] + wet[i] * g * combMs.length * 0.5;
  return out;
}

/* ------------------------------------------------------------------ */
/* WAV writer (16-bit PCM mono + TPDF dither)                           */
/* ------------------------------------------------------------------ */
function writeWav(path, buf) {
  const len = buf.length;
  const data = Buffer.alloc(len * 2);
  for (let i = 0; i < len; i++) {
    const d = (rng() + rng() - 1) * 0.6; // TPDF dither ≈ 0.35 LSB
    let v = buf[i] * 32767 + d;
    v = Math.max(-32768, Math.min(32767, v));
    data.writeInt16LE(Math.round(v), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);  // PCM
  header.writeUInt16LE(1, 22);  // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([header, data]));
}

/* ------------------------------------------------------------------ */
/* Musical helpers                                                      */
/* ------------------------------------------------------------------ */
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ================================================================== */
/* SOUND BUILDERS                                                      */
/* ================================================================== */

function buildSlingshot() {
  // Stretch loop — leather/rubber creak, quiet, crossfaded for looping.
  // Layers: slowly swelling filtered noise + a low squeak whose pitch
  // wobbles (the runtime maps tension → playback rate + volume).
  const dur = 1.8;
  let body = noiseBuf(dur, 'brown');
  body = bp(body, 420, 1.1);
  const creak = tone({ dur, freq: [95, 135], wave: 'saw', gain: 0.35, vibratoHz: 4.5, vibratoDepth: 14, attack: 0.15, release: 0.25, glideShape: 1.4 });
  creak.forEach((_, i, a) => { a[i] *= 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.7 * (i / SR) + 0.7); });
  let sq = bp(creak, 300, 2.2);
  const buf = zeros(dur);
  mix(buf, 0, body, 0.8);
  mix(buf, 0.05, sq, 0.9);
  loopify(buf, 260);
  peakTo(buf, -14);
  fadeEdges(buf, 2, 2);
  const files = [['slingshot/stretch-loop.wav', buf, true]];

  // Release — punchy rubber-band snap + elastic "thwang" + launch whoosh.
  {
    const dur2 = 0.5;
    const out = zeros(dur2);
    mix(out, 0, hp(noiseBuf(0.05), 1400, 0.8), 0.9);            // snap skin
    mix(out, 0, damped({ dur: 0.32, freq: 175, decay: 13, gain: 0.9 }), 1.0); // body
    mix(out, 0, damped({ dur: 0.18, freq: 445, decay: 26, gain: 0.35 }), 0.7);
    const thwang = tone({ dur: 0.3, freq: [210, 88], wave: 'sine', gain: 0.5, vibratoHz: 26, vibratoDepth: 30, glideShape: 0.6 });
    mix(out, 0.015, thwang, 0.55);
    const whoosh = bp(noiseBuf(0.34), 900, 0.9);
    whoosh.forEach((_, i, a) => { a[i] *= Math.sin(Math.PI * Math.min(1, i / a.length)) ** 1.5; });
    mix(out, 0.04, whoosh, 0.5);
    softclip(out, 1.25);
    fadeEdges(out, 1, 30);
    peakTo(out, -3);
    files.push(['slingshot/release.wav', out, false]);
  }

  // Cancel — soft short elastic return (no launch energy).
  {
    const dur2 = 0.26;
    const out = zeros(dur2);
    mix(out, 0, damped({ dur: 0.16, freq: 150, decay: 20, gain: 0.8 }), 1.0);
    mix(out, 0.01, tone({ dur: 0.2, freq: [130, 95], wave: 'sine', gain: 0.4, glideShape: 0.7 }), 0.7);
    mix(out, 0, hp(noiseBuf(0.03), 900, 0.8), 0.25);
    fadeEdges(out, 1, 25);
    peakTo(out, -12);
    files.push(['slingshot/cancel.wav', out, false]);
  }
  return files;
}

function buildWood() {
  const files = [];
  const knock = (f0, dur, clickHz, bodyGain, creak = false) => {
    const out = zeros(dur);
    mix(out, 0, damped({ dur, freq: f0, decay: 22, gain: 1 }), bodyGain);
    mix(out, 0, damped({ dur: dur * 0.6, freq: f0 * 2.51, decay: 34, gain: 0.32 }), bodyGain * 0.8);
    mix(out, 0, bp(noiseBuf(0.035), clickHz, 1.3), 0.55 * bodyGain); // knap
    if (creak) {
      const cr = tone({ dur: 0.13, freq: [80, 64], wave: 'saw', gain: 0.5, attack: 0.01, release: 0.04, glideShape: 0.8 });
      mix(out, 0.02, bp(cr, 240, 2.0), 0.5);
    }
    fadeEdges(out, 1, 20);
    return out;
  };
  // light taps — short, quiet, three variants
  for (const [i, f0] of [228, 214, 243].entries()) {
    const buf = knock(f0, 0.16, 1800, 1);
    peakTo(buf, -13);
    files.push([`wood/hit-light-${i + 1}.wav`, buf, false]);
  }
  // heavy knocks — lower + creak, two variants
  for (const [i, f0] of [132, 121].entries()) {
    const buf = knock(f0, 0.3, 1200, 1.15, true);
    softclip(buf, 1.2);
    peakTo(buf, -6.5);
    files.push([`wood/hit-heavy-${i + 1}.wav`, buf, false]);
  }
  // crack — mid snap + splinter crackle (damage milestone)
  {
    const out = zeros(0.26);
    mix(out, 0, hp(noiseBuf(0.045), 1100, 0.9), 0.85);
    mix(out, 0, damped({ dur: 0.2, freq: 310, decay: 26, gain: 0.7 }), 0.8);
    for (let k = 0; k < 6; k++) {
      mix(out, 0.03 + rand(0.14), bp(noiseBuf(0.02), rand(1500, 3200), 1.6), rand(0.25, 0.5));
    }
    fadeEdges(out, 1, 20);
    peakTo(out, -8);
    files.push(['wood/crack.wav', out, false]);
  }
  // break — crack + splintering scatter + body collapse thud
  {
    const out = zeros(0.62);
    mix(out, 0, hp(noiseBuf(0.05), 900, 0.8), 0.9);
    mix(out, 0, damped({ dur: 0.3, freq: 190, decay: 18, gain: 0.9 }), 1);
    mix(out, 0.005, damped({ dur: 0.22, freq: 95, decay: 14, gain: 0.7 }), 0.9);
    for (let k = 0; k < 11; k++) {
      const t = 0.02 + rand(0.34);
      mix(out, t, bp(noiseBuf(0.018), rand(900, 2800), 1.4), rand(0.3, 0.6) * (1 - t));
    }
    softclip(out, 1.3);
    fadeEdges(out, 1, 40);
    peakTo(out, -4.5);
    files.push(['wood/break.wav', out, false]);
  }
  // collapse accent — several staggered knocks + debris rattle, fading
  {
    const out = zeros(1.1);
    const hits = [0, 0.09, 0.17, 0.27, 0.4, 0.56];
    hits.forEach((t, k) => {
      const f = pick([96, 118, 138, 105]);
      mix(out, t, damped({ dur: 0.24, freq: f, decay: 17, gain: 0.95 }), 1 - k * 0.12);
      mix(out, t, bp(noiseBuf(0.03), 1300, 1.2), 0.4 * (1 - k * 0.1));
    });
    for (let k = 0; k < 14; k++) {
      const t = 0.05 + rand(0.85);
      mix(out, t, bp(noiseBuf(0.02), rand(700, 2200), 1.5), rand(0.15, 0.32) * (1 - t * 0.6));
    }
    const rumble = lp(noiseBuf(1.0, 'brown'), 140);
    mix(out, 0.02, rumble, 0.5);
    softclip(out, 1.35);
    fadeEdges(out, 2, 120);
    rmsTo(out, -14, -3);
    files.push(['wood/collapse.wav', out, false]);
  }
  return files;
}

function buildGlass() {
  const files = [];
  // contact ping — two bright partials, fast decay, two variants
  for (const [i, f0] of [2380, 2610].entries()) {
    const out = zeros(0.16);
    mix(out, 0, damped({ dur: 0.14, freq: f0, decay: 40, gain: 1 }), 0.9);
    mix(out, 0, damped({ dur: 0.1, freq: f0 * 1.51, decay: 55, gain: 0.4 }), 0.6);
    fadeEdges(out, 1, 14);
    peakTo(out, -14);
    files.push([`glass/hit-${i + 1}.wav`, out, false]);
  }
  // crack — high brittle crackle
  {
    const out = zeros(0.22);
    mix(out, 0, hp(noiseBuf(0.04), 2400, 0.8), 0.8);
    for (let k = 0; k < 7; k++) {
      mix(out, 0.02 + rand(0.13), bp(noiseBuf(0.014), rand(3200, 6500), 2.0), rand(0.3, 0.55));
    }
    fadeEdges(out, 1, 16);
    peakTo(out, -11);
    files.push(['glass/crack.wav', out, false]);
  }
  // shatter — burst + many falling shard clinks
  {
    const out = zeros(0.85);
    mix(out, 0, hp(noiseBuf(0.07), 1800, 0.7), 1.0);
    mix(out, 0, bp(noiseBuf(0.12), 4200, 0.9), 0.7);
    for (let k = 0; k < 22; k++) {
      const t = 0.03 + rand(0.7);
      const f = rand(2400, 6800);
      mix(out, t, damped({ dur: 0.09, freq: f, decay: 46, gain: rand(0.25, 0.6) * (1 - t * 0.5) }), 1);
    }
    softclip(out, 1.3);
    fadeEdges(out, 1, 90);
    peakTo(out, -5);
    files.push(['glass/shatter.wav', out, false]);
  }
  return files;
}

function buildStone() {
  const files = [];
  const thud = (f0, dur, gritGain) => {
    const out = zeros(dur);
    mix(out, 0, damped({ dur, freq: f0, decay: 15, gain: 1 }), 1);
    mix(out, 0, damped({ dur: dur * 0.55, freq: f0 * 2.13, decay: 24, gain: 0.28 }), 0.9);
    mix(out, 0, lp(noiseBuf(0.06), 900), 0.5); // gritty contact
    if (gritGain) mix(out, 0.01, bp(noiseBuf(0.16), 620, 1.6), gritGain); // scrape
    fadeEdges(out, 1, 22);
    return out;
  };
  for (const [i, f0] of [138, 126].entries()) {
    const buf = thud(f0, 0.2, 0.22);
    peakTo(buf, -12);
    files.push([`stone/hit-light-${i + 1}.wav`, buf, false]);
  }
  for (const [i, f0] of [84, 76].entries()) {
    const buf = thud(f0, 0.38, 0.45);
    mix(buf, 0, lp(noiseBuf(0.3, 'brown'), 160), 0.6); // low body
    softclip(buf, 1.25);
    peakTo(buf, -6);
    files.push([`stone/hit-heavy-${i + 1}.wav`, buf, false]);
  }
  // stone crack — low fracture + short rumble
  {
    const out = zeros(0.5);
    mix(out, 0, hp(noiseBuf(0.05), 500, 0.8), 0.7);
    mix(out, 0, damped({ dur: 0.3, freq: 170, decay: 16, gain: 0.9 }), 1);
    mix(out, 0.02, lp(noiseBuf(0.42, 'brown'), 120), 0.9);
    for (let k = 0; k < 6; k++) mix(out, 0.02 + rand(0.2), bp(noiseBuf(0.02), rand(500, 1400), 1.4), rand(0.2, 0.4));
    softclip(out, 1.25);
    fadeEdges(out, 1, 60);
    peakTo(out, -6.5);
    files.push(['stone/crack.wav', out, false]);
  }
  // stone collapse — heavy multi-thud rumble
  {
    const out = zeros(1.15);
    [0, 0.12, 0.22, 0.34, 0.5, 0.68].forEach((t, k) => {
      mix(out, t, damped({ dur: 0.3, freq: pick([64, 72, 58]), decay: 13, gain: 0.95 }), 1 - k * 0.1);
    });
    mix(out, 0.02, lp(noiseBuf(1.05, 'brown'), 110), 0.8);
    for (let k = 0; k < 8; k++) mix(out, 0.05 + rand(0.8), bp(noiseBuf(0.02), rand(400, 1100), 1.3), rand(0.12, 0.26));
    softclip(out, 1.35);
    fadeEdges(out, 2, 140);
    rmsTo(out, -13.5, -3);
    files.push(['stone/collapse.wav', out, false]);
  }
  return files;
}

function buildAbilities() {
  const files = [];
  // speed boost — rising airy whoosh + accent
  {
    const out = zeros(0.55);
    const w1 = bp(noiseBuf(0.5), 700, 0.8);
    const w2 = bp(noiseBuf(0.5), 2400, 1.1);
    for (let i = 0; i < w1.length; i++) {
      const t = i / w1.length;
      const env = Math.sin(Math.PI * Math.min(1, t)) ** 1.2;
      out[i] = (w1[i] * (1 - t) + w2[i] * t) * env * 0.8;
    }
    mix(out, 0.08, tone({ dur: 0.22, freq: [300, 900], wave: 'sine', gain: 0.3, glideShape: 0.7 }), 0.7);
    fadeEdges(out, 2, 60);
    peakTo(out, -8);
    files.push(['abilities/boost.wav', out, false]);
  }
  // split — one pop + airy burst + rapid light accents (never ×5 full)
  {
    const out = zeros(0.5);
    mix(out, 0, damped({ dur: 0.1, freq: 420, decay: 30, gain: 0.9 }), 1);
    mix(out, 0, bp(noiseBuf(0.16), 1600, 0.8), 0.55);
    for (let k = 0; k < 5; k++) {
      mix(out, 0.05 + k * 0.045, damped({ dur: 0.06, freq: 640 + k * 110, decay: 42, gain: 0.4 }), 0.5 - k * 0.06);
    }
    fadeEdges(out, 1, 45);
    peakTo(out, -6.5);
    files.push(['abilities/split.wav', out, false]);
  }
  // explosion — layered: crack blast + sub boom + debris + fading rumble
  {
    const dur = 1.5;
    const out = zeros(dur);
    // blast: noise LP sweep via crossfaded bright→dark filtered copies
    const raw = noiseBuf(0.7);
    const bright = lp(raw, 3400, 0.6);
    const mid = lp(raw, 900, 0.7);
    const dark = lp(raw, 220, 0.8);
    for (let i = 0; i < bright.length; i++) {
      const t = i / bright.length;
      out[i] = t < 0.3
        ? bright[i] * (1 - t / 0.3) + mid[i] * (t / 0.3)
        : mid[i] * (1 - (t - 0.3) / 0.7) + dark[i] * ((t - 0.3) / 0.7);
      out[i] *= Math.exp(-t * 5.2) * 1.1;
    }
    // sub boom with pitch drop
    mix(out, 0, tone({ dur: 0.8, freq: [56, 34], wave: 'sine', gain: 0.9, glideShape: 0.5, release: 0.3 }), 1.1);
    // crack transient
    mix(out, 0, hp(noiseBuf(0.03), 2000, 0.8), 0.8);
    // debris crackle
    for (let k = 0; k < 16; k++) {
      const t = 0.06 + rand(0.8);
      mix(out, t, bp(noiseBuf(0.02), rand(800, 2600), 1.5), rand(0.2, 0.45) * Math.exp(-t * 1.8));
    }
    // fading rumble
    const rumble = lp(noiseBuf(1.2, 'brown'), 90);
    for (let i = 0; i < rumble.length; i++) rumble[i] *= Math.exp(-(i / SR) * 2.2);
    mix(out, 0.1, rumble, 0.85);
    softclip(out, 1.5);
    fadeEdges(out, 1, 160);
    rmsTo(out, -10.5, -2.2);
    files.push(['abilities/explosion.wav', out, false]);
  }
  // freeze — cold magical burst + crystalline shimmer arpeggio
  {
    const out = zeros(0.9);
    const air = hp(noiseBuf(0.6), 3200, 0.8);
    for (let i = 0; i < air.length; i++) {
      const t = i / air.length;
      air[i] *= Math.sin(Math.PI * t) ** 0.8 * 0.5 * (0.7 + 0.3 * Math.sin(2 * Math.PI * 9 * t));
    }
    mix(out, 0, air, 1);
    // ascending bell partials (C6 E6 G6 C7 — inharmonic ring each)
    [1046.5, 1318.5, 1568, 2093].forEach((f, k) => {
      const t = 0.04 + k * 0.09;
      mix(out, t, damped({ dur: 0.5, freq: f, decay: 9, gain: 0.5 }), 0.75 - k * 0.08);
      mix(out, t, damped({ dur: 0.3, freq: f * 2.76, decay: 16, gain: 0.16 }), 0.6);
    });
    mix(out, 0, tone({ dur: 0.3, freq: [1800, 3400], wave: 'sine', gain: 0.18, glideShape: 0.6 }), 0.8);
    fadeEdges(out, 2, 90);
    peakTo(out, -9);
    files.push(['abilities/freeze.wav', out, false]);
  }
  // ice shatter — crystalline crack + high shard scatter (NOT the wood sound)
  {
    const out = zeros(0.55);
    mix(out, 0, hp(noiseBuf(0.05), 2600, 0.8), 0.85);
    mix(out, 0, damped({ dur: 0.12, freq: 2900, decay: 30, gain: 0.6 }), 0.8);
    for (let k = 0; k < 12; k++) {
      const t = 0.02 + rand(0.42);
      mix(out, t, damped({ dur: 0.08, freq: rand(3200, 7200), decay: 40, gain: rand(0.2, 0.45) * (1 - t) }), 1);
    }
    fadeEdges(out, 1, 60);
    peakTo(out, -8);
    files.push(['abilities/ice-shatter.wav', out, false]);
  }
  return files;
}

function buildBirds() {
  const files = [];
  // launch "wheee" — cartoon gliss whistle with vibrato
  {
    const out = zeros(0.5);
    const w = tone({ dur: 0.42, freq: [760, 1370], wave: 'sine', gain: 0.8, vibratoHz: 7, vibratoDepth: 26, glideShape: 0.8, release: 0.08 });
    const w2 = tone({ dur: 0.42, freq: [1520, 2740], wave: 'sine', gain: 0.16, vibratoHz: 7, vibratoDepth: 40, glideShape: 0.8, release: 0.08 });
    mix(out, 0, w, 1);
    mix(out, 0, w2, 1);
    fadeEdges(out, 4, 40);
    peakTo(out, -13);
    files.push(['birds/launch.wav', out, false]);
  }
  // flight loop — soft airy bed (quiet; stopped at first impact)
  {
    const dur = 1.4;
    let buf = noiseBuf(dur, 'pink');
    buf = bp(buf, 800, 0.55);
    for (let i = 0; i < buf.length; i++) {
      const t = i / SR;
      buf[i] *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 2.3 * t + 0.4);
    }
    loopify(buf, 240);
    peakTo(buf, -20);
    fadeEdges(buf, 2, 2);
    files.push(['birds/flight-loop.wav', buf, true]);
  }
  // bird hit — soft feathery "oof" + tiny squawk
  {
    const out = zeros(0.3);
    mix(out, 0, damped({ dur: 0.12, freq: 210, decay: 26, gain: 0.9 }), 1);
    mix(out, 0.01, tone({ dur: 0.12, freq: [560, 330], wave: 'tri', gain: 0.35, glideShape: 0.7 }), 0.8);
    mix(out, 0, bp(noiseBuf(0.05), 1100, 0.9), 0.3);
    fadeEdges(out, 1, 25);
    peakTo(out, -12);
    files.push(['birds/hit.wav', out, false]);
  }
  return files;
}

function buildUi() {
  const files = [];
  // click — woody tick
  {
    const out = zeros(0.09);
    mix(out, 0, damped({ dur: 0.06, freq: 950, decay: 60, gain: 1 }), 0.9);
    mix(out, 0, bp(noiseBuf(0.02), 2400, 1.4), 0.35);
    fadeEdges(out, 1, 8);
    peakTo(out, -12);
    files.push(['ui/click.wav', out, false]);
  }
  // hover — very soft tick (desktop only)
  {
    const out = zeros(0.055);
    mix(out, 0, damped({ dur: 0.04, freq: 1500, decay: 70, gain: 1 }), 0.8);
    fadeEdges(out, 1, 6);
    peakTo(out, -26);
    files.push(['ui/hover.wav', out, false]);
  }
  // bird-select — soft pop + chirp blip
  {
    const out = zeros(0.16);
    mix(out, 0, damped({ dur: 0.07, freq: 520, decay: 34, gain: 0.9 }), 1);
    mix(out, 0.02, tone({ dur: 0.09, freq: [900, 1250], wave: 'sine', gain: 0.3, glideShape: 0.7 }), 0.9);
    fadeEdges(out, 1, 14);
    peakTo(out, -14);
    files.push(['ui/select.wav', out, false]);
  }
  // pause — two soft descending wood tones
  {
    const out = zeros(0.34);
    mix(out, 0, damped({ dur: 0.16, freq: midi(76), decay: 14, gain: 0.7 }), 1);
    mix(out, 0.13, damped({ dur: 0.2, freq: midi(71), decay: 13, gain: 0.7 }), 1);
    fadeEdges(out, 2, 30);
    peakTo(out, -14);
    files.push(['ui/pause.wav', out, false]);
  }
  // resume — two ascending
  {
    const out = zeros(0.34);
    mix(out, 0, damped({ dur: 0.16, freq: midi(71), decay: 14, gain: 0.7 }), 1);
    mix(out, 0.13, damped({ dur: 0.2, freq: midi(76), decay: 13, gain: 0.7 }), 1);
    fadeEdges(out, 2, 30);
    peakTo(out, -14);
    files.push(['ui/resume.wav', out, false]);
  }
  // correct — cheerful major arpeggio + sparkle (brief, once)
  {
    const out = zeros(1.0);
    const notes = [72, 76, 79, 84];
    notes.forEach((m, k) => {
      const f = midi(m);
      const t = k * 0.09;
      mix(out, t, damped({ dur: 0.5, freq: f, decay: 7.5, gain: 0.62 }), 1);
      mix(out, t, damped({ dur: 0.22, freq: f * 2, decay: 16, gain: 0.18 }), 1);
    });
    mix(out, 0.32, damped({ dur: 0.5, freq: midi(88), decay: 8, gain: 0.2 }), 0.8); // sparkle tail
    mix(out, 0, bp(noiseBuf(0.05), 3000, 1.2), 0.2);
    const rev = reverb(out, 0.14);
    fadeEdges(rev, 2, 80);
    peakTo(rev, -7);
    files.push(['ui/correct.wav', rev, false]);
  }
  // wrong — gentle two-tone "womp" (soft, encouraging — no harsh buzzer)
  {
    const out = zeros(0.62);
    mix(out, 0, tone({ dur: 0.24, freq: midi(57), wave: 'tri', gain: 0.5, attack: 0.02, release: 0.08 }), 1);
    mix(out, 0, lp(tone({ dur: 0.24, freq: midi(57) * 2.01, wave: 'saw', gain: 0.2 }), 900), 1);
    mix(out, 0.22, tone({ dur: 0.34, freq: midi(53), wave: 'tri', gain: 0.5, attack: 0.02, release: 0.12 }), 1);
    mix(out, 0.22, lp(tone({ dur: 0.34, freq: midi(53) * 2.01, wave: 'saw', gain: 0.2 }), 800), 1);
    fadeEdges(out, 4, 70);
    peakTo(out, -11);
    files.push(['ui/wrong.wav', out, false]);
  }
  // star chime — bright bell (pitch rises per star at runtime)
  {
    const out = zeros(0.6);
    mix(out, 0, damped({ dur: 0.5, freq: midi(84), decay: 6.5, gain: 0.6 }), 1);
    mix(out, 0, damped({ dur: 0.3, freq: midi(84) * 2.76, decay: 11, gain: 0.15 }), 1);
    mix(out, 0, damped({ dur: 0.25, freq: midi(84) * 5.4, decay: 15, gain: 0.06 }), 1);
    fadeEdges(out, 2, 60);
    peakTo(out, -10);
    files.push(['ui/star.wav', out, false]);
  }
  // heart lost — soft low thud + minor drop
  {
    const out = zeros(0.5);
    mix(out, 0, damped({ dur: 0.2, freq: 130, decay: 16, gain: 0.9 }), 1);
    mix(out, 0.04, tone({ dur: 0.3, freq: [midi(64), midi(60)], wave: 'tri', gain: 0.3, glideShape: 0.8, release: 0.1 }), 0.9);
    fadeEdges(out, 2, 50);
    peakTo(out, -12);
    files.push(['ui/heart-lost.wav', out, false]);
  }
  // level complete — short celebratory fanfare cue
  {
    const out = zeros(2.9);
    const brass = (f, t, dur, gain) => {
      const b = tone({ dur, freq: f, wave: 'saw', gain, attack: 0.03, release: 0.1, vibratoHz: 5.5, vibratoDepth: f * 0.004 });
      const b2 = tone({ dur, freq: f * 1.005, wave: 'saw', gain: gain * 0.6, attack: 0.04, release: 0.1 });
      mix(out, t, lp(b, 2200), 1);
      mix(out, t, lp(b2, 2000), 1);
    };
    brass(midi(67), 0, 0.22, 0.32); // G4
    brass(midi(72), 0.18, 0.22, 0.32); // C5
    brass(midi(76), 0.36, 0.22, 0.34); // E5
    brass(midi(79), 0.54, 0.4, 0.36); // G5 hold
    brass(midi(76), 0.94, 0.2, 0.3);
    brass(midi(84), 1.14, 0.9, 0.4); // C6 finale
    // supporting chord + timpani + cymbal swell
    [60, 64, 67].forEach((m) => mix(out, 1.14, tone({ dur: 1.1, freq: midi(m), wave: 'tri', gain: 0.14, attack: 0.05, release: 0.4 }), 1));
    mix(out, 1.14, damped({ dur: 0.5, freq: 72, decay: 8, gain: 0.5 }), 1); // timpani-ish
    const cym = hp(noiseBuf(1.2), 5200, 0.6);
    for (let i = 0; i < cym.length; i++) cym[i] *= Math.exp(-(i / SR) * 3.2);
    mix(out, 1.14, cym, 0.22);
    const rev = reverb(out, 0.16);
    softclip(rev, 1.2);
    fadeEdges(rev, 2, 200);
    rmsTo(rev, -15, -2.5);
    files.push(['ui/level-complete.wav', rev, false]);
  }
  // level failed — brief gentle descending cue (warm, not punishing)
  {
    const out = zeros(2.3);
    const soft = (f, t, dur, gain) => {
      mix(out, t, tone({ dur, freq: f, wave: 'tri', gain, attack: 0.06, release: 0.25, vibratoHz: 5, vibratoDepth: f * 0.005 }), 1);
      mix(out, t, tone({ dur, freq: f * 2, wave: 'sine', gain: gain * 0.3, attack: 0.08, release: 0.25 }), 1);
    };
    soft(midi(69), 0.05, 0.5, 0.4);   // A4
    soft(midi(67), 0.5, 0.5, 0.38);   // G4
    soft(midi(65), 0.95, 0.55, 0.36); // F4
    soft(midi(60), 1.4, 0.8, 0.34);   // C4 — gentle landing
    [53, 60].forEach((m) => mix(out, 1.4, tone({ dur: 0.85, freq: midi(m), wave: 'sine', gain: 0.1, attack: 0.1, release: 0.4 }), 1));
    const rev = reverb(out, 0.12);
    fadeEdges(rev, 2, 150);
    peakTo(rev, -12);
    files.push(['ui/level-failed.wav', rev, false]);
  }
  // shot missed — soft airy whiff
  {
    const out = zeros(0.4);
    const w = bp(noiseBuf(0.36), 650, 0.7);
    for (let i = 0; i < w.length; i++) w[i] *= Math.sin(Math.PI * i / w.length) ** 1.4;
    mix(out, 0, w, 0.7);
    mix(out, 0.1, tone({ dur: 0.2, freq: [420, 250], wave: 'sine', gain: 0.16, glideShape: 0.8 }), 1);
    fadeEdges(out, 2, 40);
    peakTo(out, -20);
    files.push(['ui/missed.wav', out, false]);
  }
  // question ready — soft card/page whoosh
  {
    const out = zeros(0.4);
    const w = bp(noiseBuf(0.34), 1200, 0.8);
    for (let i = 0; i < w.length; i++) {
      const t = i / w.length;
      w[i] *= Math.sin(Math.PI * t) ** 1.3 * (0.6 + 0.4 * (1 - t));
    }
    mix(out, 0, w, 0.8);
    fadeEdges(out, 2, 40);
    peakTo(out, -22);
    files.push(['ui/question-ready.wav', out, false]);
  }
  return files;
}

function buildAmbience() {
  // forest loop — soft wind bed + occasional distant birds. Very quiet:
  // gameplay SFX must always dominate it.
  const dur = 16;
  const out = zeros(dur);
  let wind = noiseBuf(dur, 'pink');
  wind = lp(wind, 480, 0.6);
  // slow organic swell (two slow LFOs + random walk)
  let walk = 0;
  for (let i = 0; i < wind.length; i++) {
    const t = i / SR;
    if (i % 512 === 0) walk += rand(-0.05, 0.05);
    walk = Math.max(-0.3, Math.min(0.3, walk));
    const lfo = 0.6 + 0.25 * Math.sin(2 * Math.PI * 0.055 * t) + 0.15 * Math.sin(2 * Math.PI * 0.017 * t + 1.3) + walk * 0.3;
    wind[i] *= Math.max(0.15, lfo);
  }
  mix(out, 0, wind, 0.8);
  // leaves tickle — very quiet high flutter
  mix(out, 0, hp(noiseBuf(dur), 3800, 0.7), 0.12);
  // distant bird chirps: 2–4 note whistles, sparse
  let t = 1.2;
  while (t < dur - 1.5) {
    const base = rand(1900, 3100);
    const notes = 2 + Math.floor(rand(3));
    for (let k = 0; k < notes; k++) {
      const f = base * rand(0.92, 1.14);
      const nt = t + k * rand(0.09, 0.16);
      mix(out, nt, tone({ dur: 0.07, freq: [f * 0.94, f], wave: 'sine', gain: 0.5, attack: 0.008, release: 0.02, glideShape: 0.6 }), 0.16);
    }
    t += rand(2.6, 4.4);
  }
  loopify(out, 500);
  rmsTo(out, -34, -14);
  fadeEdges(out, 4, 4);
  return [['ambience/forest-loop.wav', out, true]];
}

/* ------------------------------------------------------------------ */
/* Music — tiny sequencer                                               */
/* ------------------------------------------------------------------ */

/** Render one instrument note event list onto a buffer.
 *  events: [midi|null, startSec, durSec, gain] */
function renderNotes(buf, events, voice) {
  for (const [m, t, d, g] of events) {
    if (m === null) continue;
    mix(buf, t, voice(m, d, g), 1);
  }
}

/** Build the MENU theme: bright plucky adventure loop (C major, 116 BPM,
 *  16 bars, A/A'). Karplus-Strong melody + arps, triangle bass, shaker. */
function buildMenuTheme() {
  const bpm = 116;
  const beat = 60 / bpm;
  const eighth = beat / 2;
  const bar = beat * 4;
  const bars = 16;
  const dur = bars * bar + 1.6; // reverb tail room
  const out = zeros(dur);

  // chord roots per bar (C C F C | G F C G | C C F C | G F C G) — MIDI roots
  const chords = [
    [48, 52, 55], [48, 52, 55], [53, 57, 60], [48, 52, 55],
    [43, 47, 50], [41, 45, 48], [48, 52, 55], [43, 47, 50],
    [48, 52, 55], [48, 52, 55], [53, 57, 60], [48, 52, 55],
    [43, 47, 50], [41, 45, 48], [48, 52, 55], [43, 47, 50]
  ];

  // melody — [midi, startEighth, lenEighths] over 128 eighths (16 bars)
  const melodyA = [
    // phrase A (bars 1-8)
    [76, 0, 2], [79, 2, 2], [81, 4, 2], [79, 6, 2],
    [76, 8, 3], [74, 11, 1], [72, 12, 4],
    [69, 16, 2], [72, 18, 2], [77, 20, 2], [76, 22, 2],
    [76, 24, 2], [74, 26, 2], [72, 28, 2], [67, 30, 2],
    [74, 32, 2], [71, 34, 2], [67, 36, 2], [74, 38, 2],
    [77, 40, 2], [76, 42, 2], [74, 44, 2], [72, 46, 2],
    [76, 48, 2], [79, 50, 2], [74, 52, 2], [71, 54, 2],
    [72, 56, 6]
  ];
  const melodyB = [
    // phrase A' (bars 9-16) — same skeleton, brighter finish
    [76, 64, 2], [79, 66, 2], [81, 68, 2], [79, 70, 2],
    [76, 72, 3], [74, 75, 1], [72, 76, 4],
    [69, 80, 2], [72, 82, 2], [77, 84, 2], [76, 86, 2],
    [76, 88, 2], [74, 90, 2], [72, 92, 2], [67, 94, 2],
    [74, 96, 2], [71, 98, 2], [67, 100, 2], [74, 102, 2],
    [77, 104, 2], [76, 106, 2], [74, 108, 2], [72, 110, 2],
    [72, 112, 2], [76, 114, 2], [79, 116, 2], [84, 118, 2],
    [72, 120, 6]
  ];
  const mel = [...melodyA, ...melodyB].map(([m, e, len]) => [m, e * eighth, len * eighth, 1]);
  renderNotes(out, mel, (m, d, g) => pluck(Math.min(d * 1.9 + 0.3, 1.5), midi(m), { decay: 0.9962, bright: 0.75, gain: 0.5 * g }));

  // arpeggio accompaniment — chord tones cycling on eighths (dark, quiet)
  const arpEvents = [];
  for (let b = 0; b < bars; b++) {
    const ch = chords[b];
    for (let e = 0; e < 8; e++) {
      const m = ch[[0, 1, 2, 1][e % 4]] + 12;
      arpEvents.push([m, (b * 8 + e) * eighth, eighth * 0.9, e % 2 ? 0.55 : 0.75]);
    }
  }
  renderNotes(out, arpEvents, (m, d, g) => pluck(Math.min(d + 0.15, 0.5), midi(m), { decay: 0.994, bright: 0.4, gain: 0.16 * g }));

  // bass — root on 1, fifth on 3 (soft triangle)
  const bassEvents = [];
  for (let b = 0; b < bars; b++) {
    const root = chords[b][0];
    bassEvents.push([root - 12, b * bar, beat * 1.7, 1]);
    bassEvents.push([root - 12 + 7, b * bar + beat * 2, beat * 1.6, 0.8]);
  }
  renderNotes(out, bassEvents, (m, d, g) => {
    const b = tone({ dur: d, freq: midi(m), wave: 'tri', gain: 0.3 * g, attack: 0.015, release: 0.06 });
    return lp(b, 700);
  });

  // shaker — HP noise ticks on eighths, offbeat accents
  for (let e = 0; e < bars * 8; e++) {
    const t = e * eighth;
    const acc = e % 2 ? 0.34 : 0.2;
    const tick = hp(noiseBuf(0.045), 6000, 0.7);
    mix(out, t, tick, acc * 0.5);
  }
  // wood block on beats 2 & 4
  for (let b = 0; b < bars; b++) {
    mix(out, b * bar + beat, damped({ dur: 0.08, freq: 1100, decay: 38, gain: 0.5 }), 0.32);
    mix(out, b * bar + beat * 3, damped({ dur: 0.08, freq: 1050, decay: 38, gain: 0.5 }), 0.3);
  }

  const body = out.subarray(0, n(bars * bar));
  const rev = reverb(out, 0.1);
  const loopBuf = rev.subarray(0, n(bars * bar));
  // make the loop seamless: crossfade the reverb tail into the loop head
  loopify(loopBuf, 380);
  softclip(loopBuf, 1.1);
  rmsTo(loopBuf, -19, -3);
  fadeEdges(loopBuf, 3, 3);
  return [['music/menu-theme.wav', loopBuf, true]];
}

/** Build the GAMEPLAY theme: calm supportive loop (F major, 80 BPM, 12
 *  bars). Soft arps + pads, sparse melody — stays under question audio. */
function buildGameplayTheme() {
  const bpm = 80;
  const beat = 60 / bpm;
  const q = beat;
  const bar = beat * 4;
  const bars = 12;
  const dur = bars * bar + 2.2;
  const out = zeros(dur);

  const chords = [
    [53, 57, 60], [50, 53, 57], [46, 50, 53], [48, 52, 55], // F Dm Bb C
    [53, 57, 60], [50, 53, 57], [46, 50, 53], [48, 52, 55],
    [53, 57, 60], [46, 50, 53], [48, 52, 55], [53, 57, 60]
  ];

  // slow arpeggio — one chord tone per quarter, gentle plucks
  const arpEvents = [];
  for (let b = 0; b < bars; b++) {
    const ch = chords[b];
    for (let k = 0; k < 4; k++) {
      const m = ch[[0, 2, 1, 2][k]] + 12;
      arpEvents.push([m, b * bar + k * q, q * 1.05, 1]);
    }
  }
  renderNotes(out, arpEvents, (m, d) => pluck(Math.min(d * 1.6 + 0.2, 1.4), midi(m), { decay: 0.997, bright: 0.5, gain: 0.2 }));

  // pad — soft slow triads
  for (let b = 0; b < bars; b++) {
    const ch = chords[b];
    for (const m of ch) {
      mix(out, b * bar, tone({ dur: bar * 1.05, freq: midi(m), wave: 'tri', gain: 0.075, attack: bar * 0.3, release: bar * 0.35, vibratoHz: 0.6, vibratoDepth: midi(m) * 0.004 }), 1);
    }
  }

  // bass — soft sine roots, one per bar (with fifth on bar 8k+4 pattern)
  for (let b = 0; b < bars; b++) {
    const root = chords[b][0] - 12;
    mix(out, b * bar, tone({ dur: bar * 0.9, freq: midi(root), wave: 'sine', gain: 0.16, attack: 0.05, release: 0.3 }), 1);
    if (b % 4 === 3) mix(out, b * bar + beat * 2.5, tone({ dur: beat * 1.4, freq: midi(root + 7), wave: 'sine', gain: 0.12, attack: 0.05, release: 0.25 }), 1);
  }

  // sparse melody — long breathing notes (F major pentatonic)
  const mel = [
    [72, 0, 6], [74, 6, 2], [77, 8, 8],
    [72, 16, 4], [69, 20, 4],
    [70, 24, 6], [72, 30, 2], [74, 32, 8],
    [77, 40, 4], [74, 44, 4],
    [72, 48, 8], [69, 56, 4], [67, 60, 4],
    [70, 64, 6], [72, 70, 2], [74, 72, 6], [77, 78, 2],
    [79, 80, 8], [77, 88, 4], [74, 92, 4],
    [72, 96, 12]
  ];
  renderNotes(out, mel.map(([m, b2, len]) => [m, b2 * beat, len * beat, 1]),
    (m, d) => {
      const v = tone({ dur: d, freq: midi(m), wave: 'tri', gain: 0.13, attack: 0.09, release: 0.35, vibratoHz: 4.5, vibratoDepth: midi(m) * 0.0035 });
      return lp(v, 1600);
    });

  const rev = reverb(out, 0.13);
  const loopLen = n(bars * bar);
  const loopBuf = rev.subarray(0, loopLen);
  loopify(loopBuf, 420);
  softclip(loopBuf, 1.05);
  rmsTo(loopBuf, -23, -6);
  fadeEdges(loopBuf, 3, 3);
  return [['music/gameplay-theme.wav', loopBuf, true]];
}

/* ================================================================== */
/* MAIN                                                                */
/* ================================================================== */

const ALL = [
  ...buildSlingshot(),
  ...buildWood(),
  ...buildGlass(),
  ...buildStone(),
  ...buildAbilities(),
  ...buildBirds(),
  ...buildUi(),
  ...buildAmbience(),
  ...buildMenuTheme(),
  ...buildGameplayTheme(),
  ...buildVictoryTheme()
];

function buildVictoryTheme() {
  // victory sting — upbeat orchestral-ish hit + rising run + major chord
  const out = zeros(3.4);
  const brass = (f, t, d, g) => {
    mix(out, t, lp(tone({ dur: d, freq: f, wave: 'saw', gain: g, attack: 0.02, release: 0.09, vibratoHz: 5, vibratoDepth: f * 0.004 }), 2400), 1);
    mix(out, t, lp(tone({ dur: d, freq: f * 1.007, wave: 'saw', gain: g * 0.55, attack: 0.025, release: 0.09 }), 2200), 1);
  };
  // rising run C5 E5 G5 C6
  [72, 76, 79, 84].forEach((m, k) => brass(midi(m), k * 0.14, 0.16, 0.3));
  // hit chord
  [60, 64, 67, 72].forEach((m) => brass(midi(m), 0.56, 1.6, 0.26));
  mix(out, 0.56, damped({ dur: 0.6, freq: 65, decay: 6, gain: 0.55 }), 1);
  const cym = hp(noiseBuf(1.6), 5000, 0.6);
  for (let i = 0; i < cym.length; i++) cym[i] *= Math.exp(-(i / SR) * 2.6);
  mix(out, 0.56, cym, 0.2);
  const rev = reverb(out, 0.17);
  softclip(rev, 1.2);
  fadeEdges(rev, 2, 220);
  rmsTo(rev, -15, -2.5);
  return [['music/victory-theme.wav', rev, false]];
}

/* ------------------------------------------------------------------ */
/* Write + QC                                                          */
/* ------------------------------------------------------------------ */
const written = [];
for (const [rel, buf, isLoop] of ALL) {
  writeWav(join(OUT, rel), buf);
  written.push([rel, buf, isLoop]);
}

let totalBytes = 0;
let failures = 0;
const rows = [];
for (const [rel, buf, isLoop] of written) {
  const path = join(OUT, rel);
  const size = statSync(path).size;
  totalBytes += size;
  let peak = 0, sum = 0, bad = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) bad++;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  const peakDb = 20 * Math.log10(peak || 1e-9);
  const rmsDb = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-9);
  const durS = buf.length / SR;
  const problems = [];
  if (bad) problems.push(`${bad} non-finite samples`);
  if (peakDb > -1) problems.push(`peak ${peakDb.toFixed(1)}dB > -1dB`);
  if (isLoop) {
    const head = Math.abs(buf[0]);
    if (head > 0.2) problems.push(`loop starts loud (${head.toFixed(2)})`);
  }
  if (problems.length) failures++;
  rows.push(`${rel.padEnd(34)} ${durS.toFixed(2)}s  peak ${peakDb.toFixed(1).padStart(6)}dB  rms ${rmsDb.toFixed(1).padStart(6)}dB  ${(size / 1024).toFixed(0).padStart(5)}KB${problems.length ? '  !! ' + problems.join('; ') : ''}`);
}

if (!QUIET) {
  console.log(rows.join('\n'));
  console.log('-'.repeat(100));
  console.log(`${written.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total, sample rate ${SR} Hz mono 16-bit`);
}
if (failures) {
  console.error(`QC FAILED on ${failures} file(s)`);
  process.exit(1);
}
if (!QUIET) console.log('QC passed: no NaN, no clipping, loop boundaries seamless.');
