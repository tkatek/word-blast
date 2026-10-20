/** Precise spectral probe at bar 1 (t 0.05–0.45 s) where the arrangement
 *  is known exactly: bass C2 (65.4), melody E5 (659.3), stabs C4/E4/G4. */
import { readFileSync } from 'node:fs';

const path = new URL('../../public/assets/audio/music/word-blast-theme.wav', import.meta.url);
const buf = readFileSync(path);
const SR = buf.readUInt32LE(24);
const N = (buf.length - 44) / 2;
const x = new Float32Array(N);
for (let i = 0; i < N; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768;

const goertzel = (sig, f) => {
  const w = (2 * Math.PI * f) / SR;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < sig.length; i++) { s0 = sig[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / (sig.length / 2);
};

const seg = x.subarray(Math.round(0.05 * SR), Math.round(0.45 * SR));
const probes = [
  ['C2 bass fund', 65.41], ['G2 bass 5th', 98.0],
  ['C4 stab', 261.63], ['E4 stab', 329.63], ['G4 stab', 392.0],
  ['E5 melody', 659.26], ['E5 marimba 3.9x', 2588], ['E6 xylo double', 1318.5],
  ['shaker 6.6k', 6592]
];
for (const [name, f] of probes) console.log(`${name.padEnd(20)} ${f.toFixed(0).padStart(5)} Hz   ${goertzel(seg, f).toFixed(4)}`);

// time-energy profile around one bar to visualise the bounce (0..1.94s)
const e8 = Math.round((60 / 124 / 2) * SR);
let row = '';
for (let e = 0; e < 16; e++) {
  let s = 0;
  const a = e * e8, b = a + e8;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  const lvl = Math.min(9, Math.round(Math.sqrt(s / e8) * 90));
  row += lvl;
}
console.log('two-bar energy (0-9 scale, 16 eighth-slices):', row);
