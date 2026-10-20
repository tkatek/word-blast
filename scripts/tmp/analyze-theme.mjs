/** Objective structure analysis of the generated theme (no listening). */
import { readFileSync } from 'node:fs';

const path = new URL('../../public/assets/audio/music/word-blast-theme.wav', import.meta.url);
const buf = readFileSync(path);
const SR = buf.readUInt32LE(24);
const N = (buf.length - 44) / 2;
const x = new Float32Array(N);
for (let i = 0; i < N; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768;

const rms = (a, b) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return Math.sqrt(e / (b - a));
};
const db = (v) => 20 * Math.log10(v + 1e-12);

console.log(`dur ${(N / SR).toFixed(2)}s  SR ${SR}  samples ${N}`);
console.log(`overall RMS ${db(rms(0, N)).toFixed(1)} dB`);

// per-section energy (A / A' / B / A'', 8 bars each)
const secLen = Math.floor(N / 4);
for (let s = 0; s < 4; s++) {
  console.log(`section ${'ABCD'[s]}  RMS ${db(rms(s * secLen, (s + 1) * secLen)).toFixed(1)} dB`);
}

// seam: wrapped 25ms around sample 0 vs neighbours
const W = Math.round(0.025 * SR);
const seam = Math.sqrt((rms(N - W, N) ** 2 + rms(0, W) ** 2) / 2);
const near = Math.sqrt((rms(N - 8 * W, N - 4 * W) ** 2 + rms(4 * W, 8 * W) ** 2) / 2);
console.log(`seam RMS ${db(seam).toFixed(1)} dB vs neighbours ${db(near).toFixed(1)} dB  (delta ${(db(seam) - db(near)).toFixed(1)} dB)`);

// onset check: bar downbeats should show energy bumps (bass thud)
const barLen = Math.round((60 / 124) * 4 * SR);
let hits = 0;
for (let b = 2; b < 30; b++) {
  const at = b * barLen;
  const pre = rms(at - Math.round(0.05 * SR), at);
  const post = rms(at, at + Math.round(0.05 * SR));
  if (post > pre * 1.4) hits++;
}
console.log(`bar downbeats with clear onset: ${hits}/28`);

// crude spectral split via Goertzel on a 0.5s window at t=10s (section A')
const t0 = Math.round(10 * SR);
const win = x.subarray(t0, t0 + Math.round(0.5 * SR));
const goertzel = (f) => {
  const w = (2 * Math.PI * f) / SR;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < win.length; i++) { s0 = win[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (win.length / 2);
};
const bands = [
  ['bass 40-160', [55, 82, 110, 147]],
  ['pizz 200-700', [220, 262, 330, 440, 523, 659]],
  ['melody 500-1100', [523, 659, 784, 880, 988, 1047]],
  ['mallet partials 1.5-4k', [1568, 2093, 2637, 3136, 3951]],
  ['air 5k+', [5274, 6592, 7899]]
];
for (const [name, freqs] of bands) {
  const m = freqs.map((f) => `${f}:${goertzel(f).toFixed(4)}`).join('  ');
  console.log(`${name.padEnd(20)} ${m}`);
}
