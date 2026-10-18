/**
 * AUDIO REPAIR — prepare slingshot leather-stretch segments from the
 * user-supplied Freesound recording (id 63057, "slow leather stretch").
 *
 * The original MP3 stays untouched (a copy lives in assets-src/audio-stretch).
 * This script cuts the usable creak regions, cleans them conservatively and
 * writes game-ready 16-bit mono 22050 Hz WAVs into public/assets/audio/
 * slingshot/, matching the format contract of every other game asset
 * (44-byte RIFF header, verified below).
 *
 * Processing per segment (deliberately conservative — the tactile leather
 * texture must survive):
 *   - trim at source-local minima (found via the envelope analysis)
 *   - 70 Hz high-pass (DC offset / rumble only; no broadband denoise,
 *     which the spec forbids pushing until the sample sounds hollow)
 *   - 12 ms fade-in / 20 ms fade-out (grab: 4/50 ms, return: 15/60 ms)
 *   - RMS-matched to the variant target loudness, gain capped so peak
 *     never exceeds -6 dBFS (headroom for release/impact layers)
 *
 * Usage: node scripts/prepare-stretch-audio.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FF = join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const SRC = join(ROOT, 'assets-src', 'audio-stretch', 'source-freesound-63057.mp3');
const OUT = join(ROOT, 'public', 'assets', 'audio', 'slingshot');
const SR = 22050;

mkdirSync(OUT, { recursive: true });

/** Decode any time range of the source to mono Float32 @ SR. */
function decode(from, to) {
  const raw = execFileSync(FF, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(from), '-to', String(to), '-i', SRC,
    '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'
  ], { maxBuffer: 1 << 26 });
  const n = raw.length / 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = raw.readInt16LE(i * 2) / 32768;
  return x;
}

const rmsDb = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(Math.sqrt(s / x.length) + 1e-12);
};
const peakDb = (x) => {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return 20 * Math.log10(p + 1e-12);
};

/**
 * Segment definitions — source regions chosen at envelope minima:
 *   strong creak zones: 0.5–2.0, 4.5–6.5, 8.8–10.8, 12.0–14.0
 *   soft texture zone : 2.3–3.7   decay tail: 14.0–14.8
 */
const SEGMENTS = [
  { out: 'stretch-1.wav', from: 0.55, to: 1.75, rms: -20, fade: [0.012, 0.020] }, // opening creak
  { out: 'stretch-2.wav', from: 4.55, to: 5.95, rms: -20, fade: [0.012, 0.020] }, // strong rise
  { out: 'stretch-3.wav', from: 8.85, to: 10.45, rms: -20, fade: [0.012, 0.020] }, // mid pull
  { out: 'stretch-4.wav', from: 11.95, to: 13.65, rms: -20, fade: [0.012, 0.020] }, // sustained creak
  { out: 'stretch-5.wav', from: 2.35, to: 3.65, rms: -23, fade: [0.015, 0.025] }, // soft texture (return/light)
  { out: 'grab.wav', from: 0.55, to: 0.85, rms: -26, fade: [0.004, 0.050] }, // subtle contact tick
  { out: 'return.wav', from: 14.00, to: 14.75, rms: -24, fade: [0.015, 0.060] } // tension easing tail
];

const PEAK_CEIL = -6.0; // dBFS — headroom for the rest of the mix
const report = [];

for (const seg of SEGMENTS) {
  const pre = decode(seg.from, seg.to);
  const preRms = rmsDb(pre);
  // gain to hit the target RMS; cap so the result also respects the peak ceiling
  let gain = Math.pow(10, (seg.rms - preRms) / 20);
  const prePeak = Math.pow(10, peakDb(pre) / 20);
  if (prePeak * gain > Math.pow(10, PEAK_CEIL / 20)) {
    gain = Math.pow(10, PEAK_CEIL / 20) / prePeak;
  }
  const gainDb = 20 * Math.log10(gain);
  const dur = seg.to - seg.from;
  const [fi, fo] = seg.fade;

  const outPath = join(OUT, seg.out);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(seg.from), '-to', String(seg.to), '-i', SRC,
    '-af', [
      'highpass=f=70',
      `volume=${gainDb.toFixed(2)}dB`,
      `afade=t=in:st=0:d=${fi}`,
      `afade=t=out:st=${(dur - fo).toFixed(3)}:d=${fo}`
    ].join(','),
    '-ac', '1', '-ar', String(SR),
    '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    outPath
  ];
  execFileSync(FF, args);

  // ---- QC pass on the written file -----------------------------------
  const buf = readFileSync(outPath);
  const hdrOk = buf.length > 44
    && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE'
    && buf.readUInt16LE(20) === 1 && buf.readUInt16LE(22) === 1
    && buf.readUInt32LE(24) === SR && buf.readUInt16LE(34) === 16;
  const y = new Float32Array((buf.length - 44) / 2);
  for (let i = 0; i < y.length; i++) y[i] = buf.readInt16LE(44 + i * 2) / 32768;
  const postRms = rmsDb(y), postPeak = peakDb(y);
  if (!hdrOk) throw new Error(`${seg.out}: bad WAV header`);
  if (postPeak > PEAK_CEIL + 0.5) throw new Error(`${seg.out}: peak ${postPeak.toFixed(1)} dB over ceiling`);
  report.push({ file: seg.out, src: `${seg.from}s–${seg.to}s`, dur, rms: postRms, peak: postPeak, bytes: statSync(outPath).size });
}

// ---- boundary discipline: the very first/last ~3 ms must be near-zero -----
// (fades cover the edges; a discontinuity there would click on playback)
for (const seg of SEGMENTS) {
  const buf = readFileSync(join(OUT, seg.out));
  const y = new Float32Array((buf.length - 44) / 2);
  for (let i = 0; i < y.length; i++) y[i] = buf.readInt16LE(44 + i * 2) / 32768;
  const edge = Math.round(0.003 * SR);
  let edgePeak = 0;
  for (let i = 0; i < edge && i < y.length; i++) edgePeak = Math.max(edgePeak, Math.abs(y[i]), Math.abs(y[y.length - 1 - i]));
  if (edgePeak > 0.02) throw new Error(`${seg.out}: boundary click risk (first/last 3ms peak ${edgePeak.toFixed(3)})`);
}

console.log('segment report (target RMS / measured):');
for (const r of report) {
  console.log(`  ${r.file.padEnd(15)} src ${r.src.padEnd(16)} ${r.dur.toFixed(2)}s  rms ${r.rms.toFixed(1)} dB  peak ${r.peak.toFixed(1)} dB  ${r.bytes} B`);
}

// ---- machine-readable copy for the delivery report -------------------------
writeFileSync(join(ROOT, 'assets-src', 'audio-stretch', 'segments-report.json'), JSON.stringify(report, null, 2));
console.log('\nOK — segments written to public/assets/audio/slingshot/');
