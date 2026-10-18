/**
 * Structural analysis of the supplied leather-stretch recording.
 * Decodes via ffmpeg-static to raw PCM and prints a short-time envelope
 * so individual creak/pull events can be located for segmenting.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';

const SRC = 'C:/Users/HP/Downloads/freesound_community-slow-leather-stretch-63057.mp3';
const FF = 'node_modules/ffmpeg-static/ffmpeg.exe';
const SR = 44100;

const raw = execFileSync(FF, [
  '-hide_banner', '-loglevel', 'error',
  '-i', SRC,
  '-map', 'a:0',
  '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'
], { maxBuffer: 1 << 28 });

const n = raw.length / 2;
const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = raw.readInt16LE(i * 2) / 32768;

// 20 ms frames RMS in dB
const F = Math.round(SR * 0.02);
const frames = [];
for (let i = 0; i + F <= n; i += F) {
  let s = 0;
  for (let j = 0; j < F; j++) { const v = x[i + j]; s += v * v; }
  frames.push(10 * Math.log10(Math.sqrt(s / F) + 1e-12));
}

// print envelope as a bar map, 1 char per 100 ms (5 frames)
const TH = [-40, -35, -30, -25, -20, -15];
let out = '';
for (let i = 0; i < frames.length; i += 5) {
  const v = frames[i];
  let c = ' ';
  if (v < -45) c = '.';
  else if (v < -35) c = ':';
  else if (v < -28) c = '-';
  else if (v < -22) c = '+';
  else if (v < -16) c = '*';
  else c = '#';
  out += c;
}
console.log('envelope (100ms/char, .=<-45dB :=<-35 -=<-28 +=<-22 * =<-16 # =>=-16):');
for (let r = 0; r < out.length; r += 120) {
  console.log(String((r * 0.1).toFixed(1)).padStart(5) + 's |' + out.slice(r, r + 120) + '|');
}

// frame-level detail for event detection: contiguous runs above -34 dB
const ACT = -34;
const runs = [];
let cur = null;
for (let i = 0; i < frames.length; i++) {
  if (frames[i] > ACT) {
    if (!cur) cur = { from: i, to: i, peak: frames[i] };
    else { cur.to = i; cur.peak = Math.max(cur.peak, frames[i]); }
  } else if (cur) {
    runs.push(cur); cur = null;
  }
}
if (cur) runs.push(cur);
console.log('\nactive runs (>= -34 dB):');
for (const r of runs) {
  const t0 = (r.from * F / SR).toFixed(2), t1 = ((r.to + 1) * F / SR).toFixed(2);
  const dur = (((r.to + 1) - r.from) * 0.02).toFixed(2);
  console.log(`  ${t0}s -> ${t1}s  (${dur}s)  peak ${r.peak.toFixed(1)} dB`);
}
copyFileSync(SRC, 'assets-src/audio-stretch/source-freesound-63057.mp3');
console.log('\nsource copied into assets-src/audio-stretch/ (original untouched)');
