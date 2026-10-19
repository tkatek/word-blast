# Audio attribution — slingshot leather-stretch segments

## Source recording

| Field | Value |
|---|---|
| Title | **Slow Leather Stretch** |
| Author | **OldCouches** (published via the freesound_community account) |
| Source | Pixabay sound effect, id **63057** — https://pixabay.com/sound-effects/slow-leather-stretch-63057/ |
| License | **Pixabay Content License** (free to use, attribution appreciated; do not redistribute the file as-is as a stock asset) |
| Downloaded | July 2022 (per the Pixabay listing) |
| Local copy | `assets-src/audio-stretch/source-freesound-63057.mp3` (untouched original) |

> NOTE: earlier code comments called this "Freesound recording #63057".
> That id belongs to **Pixabay**, not Freesound (Freesound #63057 is an
> unrelated music-box sample by a different author). The comments have been
> corrected; the filename of the local copy still carries the old
> `freesound` wording but contains the Pixabay file.

## What ships in the game

`scripts/prepare-stretch-audio.mjs` (conservatively — cuts, 70 Hz high-pass,
fades, RMS-matched levels capped at −6 dBFS peak) derives these in-game
assets from the recording above:

- `public/assets/audio/slingshot/stretch-1.wav` … `stretch-5.wav` — the
  motion-driven leather-creak segments (see `segments-report.json` for the
  exact source time ranges)
- `public/assets/audio/slingshot/grab.wav` — the grab-contact creak
- `public/assets/audio/slingshot/return.wav` — the soft dud-return creak
- `public/assets/audio/slingshot/release.wav` — the snap layer

Everything else under `public/assets/audio/` is **original synthesized
material** produced by `scripts/generate-audio.mjs` (oscillators, filtered
noise, Karplus-Strong strings, envelopes — no external samples).

## Compliance summary

- The Pixabay Content License permits use in this game (including
  commercial projects) without mandatory attribution; this file records it
  anyway as good practice and because the task's spec asks for explicit
  source/license details for every external asset.
- The source file is kept unmodified in `assets-src/` for provenance.
