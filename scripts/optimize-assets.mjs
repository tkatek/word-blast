/**
 * One-shot asset slim-down (load-time optimization pass).
 *
 * What it does (all under public/assets — dist/ picks the results up via
 * the next `npm run build`):
 *
 *   IMAGES
 *   - Painterly RGBA art that ships far above its on-screen size
 *     (the game caps rendering at 2× logical resolution — see
 *     js/systems/Viewport.js DPR_CAP) is resized to ≤ ~2× display and
 *     re-encoded as lossy WebP with alpha. Extension changes .png → .webp
 *     (the runtime paths are updated to match).
 *   - Every remaining flat-color PNG (tower sprites, birds, HUD panels,
 *     pause icons) is palette-encoded in place (pngquant-style): same
 *     format, same dimensions, alpha preserved — no code references
 *     change.
 *   - Existing WebPs that carry photographic weight (backgrounds, menu
 *     art) are recompressed at a tuned quality.
 *
 *   AUDIO
 *   - Every SFX WAV (mono 22 kHz PCM — the format written by
 *     scripts/generate-audio.mjs) is encoded to MP3 VBR (~64 kbps mono
 *     effective) and the WAV removed: ~85% smaller, universally decoded
 *     (same codec family the background track already ships in).
 *     js/systems/AudioManager.js manifest extensions updated to match.
 *
 * Safety: every file is copied to assets-src/pre-optimization/ (keeping
 * its tree) BEFORE it is touched, and re-runs are idempotent — a file
 * already converted is skipped, a "smaller-only" guard refuses any
 * result that is not at least 10% smaller than its original.
 *
 * Run: node scripts/optimize-assets.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const IMG_ROOT = path.join(ROOT, 'public', 'assets', 'images');
const AUD_ROOT = path.join(ROOT, 'public', 'assets', 'audio');
const BACKUP_ROOT = path.join(ROOT, 'assets-src', 'pre-optimization');

const kb = (n) => Math.round(n / 1024);
const relOf = (abs, root) => path.relative(root, abs).split(path.sep).join('/');

/** Copy to the backup tree once; never overwrite an existing backup. */
function backup(absPath, root) {
  const dest = path.join(BACKUP_ROOT, relOf(absPath, root));
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(absPath, dest);
  }
}

const rows = [];
let savedTotal = 0;

function record(label, before, after, note) {
  rows.push({ label, before: kb(before), after: kb(after), note });
  savedTotal += before - after;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

/**
 * Relocations: painterly art re-encoded to WebP (some also downsized).
 * `width` empty = keep dimensions. Key = path under IMG_ROOT.
 */
const TO_WEBP = {
  // displayed at 428×292 logical → 2× = 856 px; source was 1424×972 / 588 KB
  'ui/feedback-card.png': { width: 900, quality: 85 },
  // displayed at ~1041 logical wide (QUESTION_CARD.CENTER) → 2× ≈ 2082;
  // source is exactly 2082×484 — keep dims, just drop the 32-bit RGBA weight
  'ui/question-card.png': { width: null, quality: 85 },
  // slingshot displays ≈ 440 world px tall → 2× ≈ 880… but the art trims
  // with margins; 512² is the sweet spot the earlier rightsize pass aimed at
  'slingshot/slingshot-wood.png': { width: 512, quality: 85 }
};

/** In-place WebP recompression (extension stays .webp — no code change). */
const WEBP_RECOMPRESS = {
  // menu logo displays 530 wide → 2× = 1060; source 1774
  'menu/logo.webp': { width: 1100, quality: 82 },
  // hero PLAY sign displays ≈ 509×212 → 2× ≈ 1018; source 1386×598
  'menu/play-button.webp': { width: 1020, quality: 82 },
  // level-select MENU bar displays 176×57 → 2× = 352; source 2172×724 (!)
  // 880 keeps generous margin for the art's own padding around the letters
  'ui/menu-button.webp': { width: 880, quality: 82 },
  // level cards ~ 200 logical wide; source 560
  'ui/level-card.webp': { width: null, quality: 80 },
  // full-bleed scenery: 1672 px wide matches the widest world view — do NOT
  // resize (ultrawide screens sample it 1:1), just leaner quality
  'menu/background.webp': { width: null, quality: 72 },
  'backgrounds/gameplay.webp': { width: null, quality: 72 }
};

const PALETTE_PNG_DIRS = ['birds', 'tower', 'ui/hud', 'pause'];

sharp.cache(false);

async function toWebp() {
  // --- .png → .webp relocations -------------------------------------
  for (const [rel, rule] of Object.entries(TO_WEBP)) {
    const src = path.join(IMG_ROOT, rel);
    const outRel = rel.replace(/\.png$/, '.webp');
    const out = path.join(IMG_ROOT, outRel);
    if (!fs.existsSync(src)) {
      if (fs.existsSync(out)) console.log(`skip (done): ${outRel}`);
      continue;
    }
    const before = fs.statSync(src).size;
    let img = sharp(src);
    const meta = await img.metadata();
    if (rule.width && meta.width > rule.width) img = img.resize({ width: rule.width });
    const buf = await img.webp({ quality: rule.quality, alphaQuality: 90, effort: 5 }).toBuffer();
    if (buf.length >= before * 0.9) {
      console.log(`skip (not smaller): ${rel}`);
      continue;
    }
    backup(src, IMG_ROOT);
    fs.writeFileSync(out, buf);
    fs.unlinkSync(src);
    record(outRel, before, buf.length, `${meta.width}×${meta.height}` +
      (rule.width && meta.width > rule.width ? ` → ${rule.width}w` : '') + ' webp q' + rule.quality);
  }

  // --- in-place WebP recompression -----------------------------------
  for (const [rel, rule] of Object.entries(WEBP_RECOMPRESS)) {
    const src = path.join(IMG_ROOT, rel);
    if (!fs.existsSync(src)) { console.log(`missing: ${rel}`); continue; }
    const before = fs.statSync(src).size;
    let img = sharp(src);
    const meta = await img.metadata();
    if (rule.width && meta.width > rule.width) img = img.resize({ width: rule.width });
    const buf = await img.webp({ quality: rule.quality, alphaQuality: 88, effort: 5 }).toBuffer();
    if (buf.length >= before * 0.9) {
      console.log(`skip (not smaller): ${rel}`);
      continue;
    }
    backup(src, IMG_ROOT);
    fs.writeFileSync(src, buf);
    record(rel, before, buf.length, `${meta.width}×${meta.height}` +
      (rule.width && meta.width > rule.width ? ` → ${rule.width}w` : '') + ' webp q' + rule.quality);
  }

  // --- palette PNGs (same format, no code references change) ---------
  for (const dir of PALETTE_PNG_DIRS) {
    const absDir = path.join(IMG_ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const name of fs.readdirSync(absDir)) {
      if (!name.endsWith('.png')) continue;
      const src = path.join(absDir, name);
      const before = fs.statSync(src).size;
      const buf = await sharp(src)
        .png({ palette: true, quality: 82, effort: 10, compressionLevel: 9 })
        .toBuffer();
      if (buf.length >= before * 0.9) continue; // already tight — leave it
      backup(src, IMG_ROOT);
      fs.writeFileSync(src, buf);
      record(`${dir}/${name}`, before, buf.length, 'palette png');
    }
  }

  // --- stray build leftovers ------------------------------------------
  for (const tmp of ['menu/logo.webp.tmp']) {
    const p = path.join(IMG_ROOT, tmp);
    if (fs.existsSync(p)) {
      const size = fs.statSync(p).size;
      fs.unlinkSync(p);
      console.log(`deleted stray: ${tmp} (${kb(size)} KB)`);
    }
  }

  await audio();
}

/* ------------------------------------------------------------------ */
/* Audio: WAV → MP3 (VBR, mono, native 22.05 kHz)                      */
/* ------------------------------------------------------------------ */

async function audio() {
  const dirs = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name.endsWith('.wav')) dirs.push(path.join(d, e.name));
    }
  })(AUD_ROOT);

  for (const wav of dirs) {
    const mp3 = wav.replace(/\.wav$/, '.mp3');
    if (fs.existsSync(mp3)) { console.log(`skip (done): ${relOf(mp3, AUD_ROOT)}`); continue; }
    const before = fs.statSync(wav).size;
    execFileSync(ffmpegPath, [
      '-y', '-loglevel', 'error',
      '-i', wav,
      '-codec:a', 'libmp3lame',
      '-q:a', '6',          // VBR ≈ 60–70 kbps for mono 22 kHz source
      '-ac', '1',           // sources are mono — keep it explicit
      '-ar', '22050',       // native rate (MPEG-2 LSF); all target browsers decode
      '-write_xing', '1',   // duration header so progress/seek math is right
      mp3
    ]);
    const after = fs.statSync(mp3).size;
    backup(wav, AUD_ROOT);
    fs.unlinkSync(wav);
    record(relOf(mp3, AUD_ROOT), before, after, 'mp3 VBR q6 mono');
  }

  // Background theme: 2:22 stereo at 128 kbps CBR. It plays at music-bus
  // 0.55 under the SFX — a VBR re-encode keeps that context transparent
  // and drops ~40% of the single largest shipped file. Skipped on re-run.
  const music = path.join(AUD_ROOT, 'music', 'background-music.mp3');
  const musicDone = path.join(AUD_ROOT, 'music', '.optimized-q7');
  if (fs.existsSync(music) && !fs.existsSync(musicDone)) {
    const before = fs.statSync(music).size;
    const tmp = music + '.tmp.mp3';
    execFileSync(ffmpegPath, [
      '-y', '-loglevel', 'error',
      '-i', music,
      '-codec:a', 'libmp3lame',
      '-q:a', '7',           // VBR ≈ 100–110 kbps stereo — fine under SFX
      tmp
    ]);
    const after = fs.statSync(tmp).size;
    if (after < before * 0.9) {
      backup(music, AUD_ROOT);
      fs.renameSync(tmp, music);
      fs.writeFileSync(musicDone, 'q7');
      record('music/background-music.mp3', before, after, 'mp3 VBR q7 stereo');
    } else {
      fs.unlinkSync(tmp);
      console.log('skip (not smaller): music/background-music.mp3');
    }
  }

  report();
}

/* ------------------------------------------------------------------ */

function report() {
  console.log('\n=== asset slim-down results ===');
  for (const r of rows) {
    console.log(
      `${String(r.before).padStart(5)} KB → ${String(r.after).padStart(5)} KB  ` +
      `(-${Math.round((1 - r.after / r.before) * 100)}%)\t${r.label}\t${r.note}`
    );
  }
  console.log(`\nfiles touched: ${rows.length}`);
  console.log(`bytes saved:   ${kb(savedTotal)} KB (${(savedTotal / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`originals in:  ${path.relative(ROOT, BACKUP_ROOT)}`);
}

console.log('optimizing assets…');
await toWebp();
