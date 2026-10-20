# WORD BLAST — Final Cleanup & Optimization Report

**Date:** 2026-10-20 · **Scope:** safe clutter removal, asset optimization, loading-weight
reduction, regression fixing, deployment verification. **No gameplay, UI, level, or
question changes.**

Recovery points:

- Git checkpoint `2060f70` — full pre-cleanup working tree (including every file later
  deleted or recompressed).
- `../wb-archive/` — browsable copy of all archived evidence + pre-optimization
  originals of every recompressed asset (`pre-optimization-assets/`).

---

## CLEANUP REPORT

### Removed from the project (archived to `../wb-archive/`, also in git history)

| Item | Size | Reason |
|---|---|---|
| `screenshots/` | 212 MB | debugging evidence across fixes 2–23; regenerable via `scripts/*-screenshots.mjs` |
| `fix2-screens/`, `fix7-screens/` | 31 MB | obsolete fix evidence |
| `wb-audio-evidence/` | 1.2 MB | audio debugging WAVs (Fix #22 era) |
| `dist-fix19/` | 16 MB | stale build snapshot, superseded by `dist/` |
| `docs/screenshots/` | 41 MB | ground/slingshot analysis images |
| root `analysis-*.png`, `view-*.png`, `crop-*.png` | 14 MB | Oct-15 layout debugging |
| `_bird_src/`, `wb-backup-20261017/`, `wb-precheck/`, `wb-verify-freezefix/` (workspace level) | 19 MB | old workspace backups & sources |

### Deleted outright (verified junk)

- `.tmp-*.log` (7 root logs + 2 in `tests/`) — temporary run outputs
- `${dominant}` — 0-byte template-interpolation artifact (investigated: empty)
- `nul` — 49-byte Windows redirect accident (investigated: captured error text)
- `scripts/tmp/` probes (probe-play-music.mjs, repro scripts, serve-dir) + this pass's
  one-shot audit scripts
- `.tmp-bg-mobile-landscape.png` (workspace root) — byte-identical duplicate
  (md5-verified) of `analysis-mobile-landscape.png`
- empty `assets/` directory

### Kept in place (verified in active use)

- `assets-src/` — referenced by the asset pipeline (`scripts/build-birds.mjs`,
  `prepare-menu-assets.mjs`, `prepare-hud-assets.mjs`, …). Does **not** ship: only
  `public/` is copied into `dist/`.
- All 70 runtime images + 48 audio files — the key/frequency audit found **zero unused
  runtime assets** (audio `-2/-3` variants are used via the AudioManager `vars`
  mechanism; all four answer-panel sizes are used by question formats S/M/L/XL).
- Icons (`icon-192/512`, maskable, apple-touch) — referenced by `manifest.webmanifest`
  and `index.html` (installable web app). `icon-512` and `icon-maskable-512` are
  byte-identical but both manifest-declared with different purposes — kept.

### Organized

- Fix notes (`FIX*-NOTES.md`, `AUDIO-REPAIR-NOTES.md`, `MUSIC-NOTES.md`, …) → `docs/notes/`.
- `.gitignore` extended (`screenshots/`, `fix*-screens/`, `dist-fix*/`, `wb-audio-evidence/`,
  `scripts/tmp/`, `.tmp-*`) so evidence never creeps back into the repo.
- Final root: `index.html`, `README.md`, `RELEASE-NOTES.md`, `package.json`,
  `package-lock.json`, `vite.config.js`, `css/`, `js/`, `public/`, `scripts/`, `tests/`,
  `docs/`, `assets-src/`, `.github/`, `.vscode/` — nothing else.

---

## PERFORMANCE REPORT

### Asset weight (the dominant win — download size & decode memory)

| Layer | Before | After |
|---|---|---|
| Runtime images (`public/assets/images`) | 8.8 MB / 15.0 MP | **3.6 MB** / 15.0 MP |
| Music (`background-music.mp3`, 2.4 min) | 4.34 MB (256 kbps) | **2.17 MB** (128 kbps) |
| Production bundle | 1,788 KB min (427 KB gzip) | unchanged |
| Source map | 11.1 MB shipped in dist | **removed** (`sourcemap: false`) |
| `dist/` total | 28 MB | **9.0 MB** |
| Cold-load payload (what a browser downloads) | ≈ 16.9 MB | **≈ 7.6 MB over-the-wire** (≈ 9.0 MB − JS gzip saving), **−55 %** |

Method: 57/70 images recompressed in place (same filenames → zero code/manifest changes,
zero loader risk) — lossy palette PNG (quality 90) for PNGs, WebP q85 re-encode for
WebPs; dimensions and alpha untouched (no resized textures — every oversized check
passed: the largest textures are displayed at ≤3× zoom on 4K screens, so shrinking them
would visibly soften them). Music re-encoded 256→128 kbps CBR (full-decode verified).

Visual verification (all below):

- Pixel diff vs originals: mean per-pixel delta 0.9–4.0 / 255 across all 70 images
  (edge pixels only reach high deltas — normal palette behavior).
- Full scripted browser acceptance (`scripts/ui-polish-screenshots.mjs` against the
  built game, desktop + tablet + phone): **19/19 checks passed** including a complete
  4-question desktop playthrough to the victory panel.
- Screenshot diff vs pre-optimization set: gameplay/HUD/feedback/victory shots are
  near-identical (mean ≤ 3.2/255). Menu/level-select shots differ only because of the
  newer giant-cards fix and the fullscreen-entry modal (features added *after* those
  reference shots were taken — confirmed by side-by-side image analysis: layout
  identical, no compression artifacts).

### Runtime performance (physics, effects, memory)

The runtime was already engineered to budgets (`BUDGETS`: ≤40 pieces, ≤22 fragments,
≤6 emitters; sleeping enabled; single `collisionstart` listener with per-pair cooldowns;
fragment/removal queues; capped emitters auto-destroyed; decode-once audio with voice
caps; no per-frame allocations in the hot loops). This pass **audited** those paths
(PhysicsObjects.update, GameScene.update, EffectsSystem, AudioManager) and found no
regression-worthy hot spots, so no speculative rewrites were made — per the project
rule "profile before optimizing; don't fix what the numbers don't indict". Headless
collapse benchmark (`tests/perf-probe.mjs`, TNT chain into a tier-3 layout):

```
node tests/perf-probe.mjs
layout pieces: 5   (tier-3 mixed layout, L12)
peak during TNT collapse: bodies=11 blocks=5 fragments=3   (budgets hold: ≤40 pieces / ≤22 fragments)
fps over collapse window: samples=32 avg=54.0 min=52.8      (target-60 loop, headless shim)
pause → resumed cleanly (52.8 → 49.9)
```

(simulation-cost FPS in a software-renderer shim; browser adds GPU load — numbers are
for before/after comparison of simulation cost, which this pass did not alter.)

All 15 levels stayed within the piece/fragment budgets throughout the full-campaign
suite; restart/lifecycle suites confirm no projectile bodies, handlers or voices
survive question changes or scene restarts (no leak growth).

### Regressions found & fixed during this pass

1. **`GameHUD.js` syntax error** (stray `}` closed the class early) and a bare `scene`
   reference in `buildPauseMenu` — introduced by the last pre-cleanup edit; the game
   could not even load. Fixed; `answer-panel` suite re-ran green (1357/0).
2. **Feedback-card arming deadlock** (race): a resolved-miss projectile that creeps
   into the correct target during re-armed AIMING (the documented late-contact path)
   could show the feedback card and then have the state leave `ANSWER_FEEDBACK` before
   the settle watcher armed the CONTINUE button — a permanently disabled card stuck on
   screen (hit once by the desktop acceptance run). Fix: the arming watcher now runs
   whenever an un-armed feedback card is visible regardless of machine state, and the
   slingshot stays locked while such a card is on screen (`js/scenes/GameScene.js`).
   The full desktop campaign then passed end-to-end.

---

## VALIDATION REPORT

| Check | Result |
|---|---|
| Unit suite (`run-tests.mjs`) | pass (exit 0) |
| Integration battery (13 edge cases) | 67/0 |
| Full campaign: 15 levels × 4 questions, real physics | 15/0 |
| Bird lifecycle suite | 16/0 |
| Bird ammo & abilities (Fix #19) | 26/0 |
| Answer panels (60 questions) | 1357/0 |
| Audio suite (incl. restart handler stacking, voice sanity) | 56/0 |
| Fullscreen/PWA suite | 33/0 |
| **Total** | **1,570 checks, 0 failed** |
| `npm run build` + `scripts/verify-build.mjs` (Live Server layout) | PASSED — boots, textures, no HTTP errors |
| `npm run build:pages` + `scripts/verify-pages-build.mjs` (under `/word-blast/`) | PASSED — boots, textures, no HTTP errors |
| UI acceptance screenshots (desktop 1536×864, tablet 1180×820, phone 844×390) | **19/19** |
| Music full decode after re-encode | OK |
| All 70 images decode after recompression | OK, 0 corrupt |

### Deployment (GitHub Pages)

- `.github/workflows/deploy-pages.yml` (added earlier today) is **correct and
  verified locally**: tests → `vite build --base=/word-blast/` → artifact assertions →
  official Pages deploy action.
- **The live site currently serves the uncompiled repo root and fails** (`/js/main.js`
  imports the bare specifier `phaser` → 404; `/assets/*` 404). Cause: Pages is still
  configured to deploy from branch source.
- **One-time manual step (repo admin only):** GitHub → Settings → Pages → Build and
  deployment → Source: **GitHub Actions**, then push to `main` (the workflow also runs
  on `workflow_dispatch`). After that, `https://tkatek.github.io/word-blast/` serves
  the compiled `dist/`.
- VS Code Live Server workflow preserved (`.vscode/settings.json` still serves `dist/`
  on port 5500; `docs/LIVE-SERVER.md` still accurate).

### Remaining limitations / notes

- FPS figures here are from the headless software-renderer probes, not a physical
  phone; the earlier fix notes' on-device verification remains the reference for
  mobile. The 1,788 KB single bundle could be code-split (Phaser is the bulk), but
  with 427 KB gzip and one request it is a sound trade-off — not changed.
- `js/systems/FullscreenEntry.js` had uncommitted work-in-progress from a parallel
  session at report time; it was left untouched and out of this pass's commits.
- Test-suite caveat discovered here: piping `npm test` through `tail` swallows exit
  codes — use `set -o pipefail` (the Pages workflow runs `npm test` unpiped, so CI
  is unaffected).
