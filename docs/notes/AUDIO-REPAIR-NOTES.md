# AUDIO REPAIR — DELIVERY REPORT

Word Blast audio repair (silence-first, motion-driven slingshot sound).
Verified against the direct game output in a real browser (see §7).
Final acceptance rule status: **nothing happening → silence · pouch moving →
leather stretch · pouch held → silence · valid launch → one snap ·
meaningful impact → correct material sound · tower settled → silence.**

## 1. Confirmed causes of the unwanted audio

All confirmed by code inspection + in-browser output measurement (not
guessed from a mixed recording):

1. **Continuous loops by design (Fix #22 configuration).** `GameScene`
   started `music-game` (looping theme) + `amb-forest` (looping forest
   ambience) on every level entry; `MenuScene` / `LevelSelectScene` started
   `music-menu`. This was the constant background layer under gameplay.
2. **Tension-driven stretch loop.** The old `sling-stretch` was a synthetic
   `stretch-loop.wav` started whenever tension > 0.05 and **never stopped
   while the drag lasted** — holding the bird perfectly still at full
   stretch kept a loud creak loop running until release/cancel. This is
   the "stretching sound is unsatisfactory / sound continues underneath"
   complaint.
3. **Flight whistle loop** (`birds/flight-loop.wav`) ran for every shot
   (bounded by a 6 s safety timer, but still a continuous layer).
4. **Victory music track** (`music-victory`) on completing all levels —
   another long, non-diegetic layer.
5. Latent engine bugs found during the repair (all fixed):
   - Phaser emits **`complete`**, never `ended` — the old
     `sound.once('ended', …)` voice-tracking listeners never fired.
   - One-shot sounds were never destroyed → dead `Sound` instances
     accumulated in the Phaser manager (memory/list growth).
   - `sound.destroy()` alone leaves a nulled husk in `manager.sounds`
     for a frame (reading `.loop` on it throws) — correct teardown is
     `manager.remove()`.
   - **Master mute was cosmetic**: Phaser 3.90's `BaseSoundManager`
     constructor creates an own `mute` data property that shadows the
     WebAudio accessor, so `sound.mute = true` never reached
     `masterMuteNode` — the speakers kept playing when "muted".
   - The pause cue was started *before* `pauseAll()`, freezing it
     mid-play until resume.
   - Slingshot dud-release bug (gameplay, exposed by the audio lifecycle
     suite): `onPointerUp` cleared `dragging` before calling
     `cancelDrag()`, whose guard then no-oped — no snap-back, no return
     sound; the pouch stayed pulled and grab offsets accumulated until a
     "tiny" drag crossed the power threshold and fired an unintended shot.

Not from the game: no idle bird chirps, timer ticks, wind/waterfall
generators, or duplicate signal paths exist in this codebase — those
hypotheses were checked and ruled out.

## 2. Files changed

| File | Change |
|---|---|
| `js/systems/AudioManager.js` | Playback engine rewritten: motion-driven slingshot audio, music/ambience machinery removed, voice caps tightened, one-shot lifecycle (`complete` + `manager.remove`), REAL master mute (gain node), speech ducking, pause-cue ordering, richer dev diagnostics |
| `js/systems/Slingshot.js` | Per-frame motion measurement (speed/tension/towardRest from the accepted clamped pouch position), `sling-grab` contact event, motion-tracker resets (grab/cancel/resize), per-pointermove audio emit removed, dud-release order fixed |
| `js/scenes/GameScene.js` | Music/ambience startup removed; shutdown stops the movement voice |
| `js/scenes/MenuScene.js`, `js/scenes/LevelSelectScene.js` | Menu-music startup removed |
| `js/systems/QuestionCard.js` | Speech ducking on pronunciation (with safety restore), `card-open`/`card-close` events (once per transition) |
| `tests/audio-tests.mjs` | Rewritten for the new spec (49 tests) |
| `scripts/verify-audio.mjs` | Rewritten as the browser acceptance suite (29 checks, direct-output measurement) |
| `scripts/prepare-stretch-audio.mjs` | NEW — cuts/processes the leather segments |
| `scripts/analyze-stretch.mjs` | NEW — source envelope/structure analysis |
| `public/assets/audio/**` | Removed `music/`, `ambience/`, `birds/flight-loop.wav`, `slingshot/stretch-loop.wav`, `slingshot/cancel.wav`; added `slingshot/{grab,return,stretch-1..5}.wav` |
| `assets-src/audio-stretch/` | Source copy + `segments-report.json` (the supplied MP3 in Downloads is untouched) |

Settings migration is intentionally narrow: old saves with `music:true` /
`ambience:true` are read but can never restart anything (no tracks ship);
no save field is modified by the migration, and progress/scores/inventory
are untouched. Mute/unmute cannot resurrect disabled tracks.

## 3. Installed audio assets and sources

- **New leather set (7 files, `public/assets/audio/slingshot/`)** — cut
  from the user-supplied `freesound_community-slow-leather-stretch-63057.mp3`:
  **"Slow Leather Stretch" by OldCouches (Freesound)**, published 13 Jul 2022
  on Pixabay via the *freesound_community* account, 0:15, page states
  *"Free for use under the Pixabay Content License"*
  (https://pixabay.com/sound-effects/slow-leather-stretch-63057/).
  The license text was read from the page; no rights are inferred from the
  filename. Keep this attribution with any redistribution.
- **All other effects** are the original Fix #22 synthetic WAVs
  (wood/glass/stone hits + breaks + collapses, abilities, bird
  launch/hit, pig pop, UI set) generated by `scripts/generate-audio.mjs`
  — original, no external samples. Good samples were preserved; none were
  replaced with missing files or generic beeps.
- Deleted assets are gone from disk AND manifest (an orphan-file test
  enforces the correspondence both ways).

## 4. Leather segments and processing

Source analysis (`scripts/analyze-stretch.mjs`): one continuous 14.74 s
slow stretch; strong-creak zones at 0.5–2.0 / 4.5–6.5 / 8.8–10.8 /
12.0–14.0 s, a soft-texture zone at 2.3–3.7 s, decay tail at 14.0–14.8 s.

| File | Source region | Length | RMS | Peak | Use |
|---|---|---|---|---|---|
| stretch-1.wav | 0.55–1.75 s | 1.20 s | −24.3 dBFS | −6.0 dBFS | pull (main variants, random no-repeat) |
| stretch-2.wav | 4.55–5.95 s | 1.40 s | −26.1 dBFS | −6.1 dBFS | pull |
| stretch-3.wav | 8.85–10.45 s | 1.60 s | −25.2 dBFS | −5.9 dBFS | pull |
| stretch-4.wav | 11.95–13.65 s | 1.70 s | −26.2 dBFS | −6.2 dBFS | pull |
| stretch-5.wav | 2.35–3.65 s | 1.30 s | −27.1 dBFS | −6.7 dBFS | soft variant — return-to-rest motion, lighter pulls |
| grab.wav | 0.55–0.85 s | 0.30 s | −30.6 dBFS | −13.6 dBFS | subtle leather contact on grab |
| return.wav | 14.00–14.75 s | 0.75 s | −31.6 dBFS | −5.8 dBFS | soft tension-easing cue for cancellations |

Processing (conservative, `scripts/prepare-stretch-audio.mjs`): trim at
envelope minima → 70 Hz high-pass (rumble/DC only — no broadband denoise,
no aggressive spectral work) → 12 ms in / 20 ms out fades (grab 4/50 ms,
return 15/60 ms) → RMS-matched per variant with a hard −6 dBFS peak
ceiling (peaks pinned at the ceiling, so variants are matched within
~2 dB RMS and leave headroom under the release snap at −14 RMS). Format:
16-bit mono 22050 Hz, clean 44-byte RIFF headers (machine-verified).
Boundary-click and header QC run on every write; the report is cached at
`assets-src/audio-stretch/segments-report.json`. No looping segment is
used anywhere — every sound is a self-terminating one-shot, so the
"clean loop" risk class is eliminated by design.

## 5. How dragging, holding, cancellation and release control playback

One drag session = at most one controlled voice, driven per frame from
the ACCEPTED, clamped pouch position (never raw pointer, never visual
scale):

- **Grab** — one subtle `grab.wav` tick (0.5 vol, 300 ms cooldown).
  Pressing and holding is silent.
- **Pulling** — the Slingshot measures
  `speed = |pouch − prevPouch| / dt` and `tension = |rest − pouch| / 140`
  every frame while dragging and emits `sling-stretch {tension, speed,
  towardRest}`. The engine smooths speed (EMA 0.28); a segment starts
  only above **90 px/s** and is gated by hysteresis: below **38 px/s**
  for **130 ms** it fades out over **~120 ms**. Speed maps to loudness;
  tension only colours (−40…+80 cents detune, small gain lift). Moving
  toward rest picks the softer variant at 0.7×. When a segment ends
  while motion continues, the next variant chains automatically — never
  two audible layers.
- **Holding still** — no accepted movement → fade to true silence while
  the bird stays fully stretched (measured 0.00 RMS over 5 s).
- **Pointer beyond the drag limit** — the clamped pouch stops moving →
  speed 0 → no new audio (measured 0.00 RMS while the pointer circled
  beyond the clamp).
- **Cancellation / dud** — movement voice fades (120 ms), one soft
  `return.wav`; never a launch sound, never ammunition. The pouch
  snap-back that was silently broken before is fixed (see §1.6).
- **Valid launch** — one `sling-release` snap (volume scaled slightly by
  power) + one brief `bird-launch` whoosh. Both are one-shots; there is
  no flight loop. The visual snap-back emits nothing; launch emits
  exactly once per committed shot (shot-id guarded upstream).

Motion measurement resets on grab, cancel and resize (no artificial
speed spikes). Audio never gates gameplay: a refused/missing sound never
blocks a launch, question, or scoring.

## 6. Concurrency limits and cleanup

- Voice caps: **impact 6** (severity-priority — a stronger impact
  displaces the weakest), **sfx 8**, **ui 4**, **one stretch voice**.
- Collision discipline is reused from the existing damage model: resting
  contact filtered by closing-speed, per-pair cooldowns, once-per-body
  destruction (physics-side idempotency), impact cooldown 70 ms,
  terrain-contact trim, explosion position/time dedupe, collapse accent
  only for ≥3 breaks in 700 ms with a 1.6 s lockout.
- Every one-shot releases its nodes on `complete` via `manager.remove()`;
  20 drag/cancel cycles + a question restart left **0 sound instances**
  (was leaking before).
- Pause/hidden tab/portrait: `pauseAll` + movement voice dropped; resume
  never replays anything (a stationary pouch stays silent — measured).
  Scene shutdown stops the movement voice; unlock drops (never queues)
  effects requested before audio is available. Master mute now genuinely
  zeroes `masterMuteNode` (verified functionally: a click played while
  muted measures 0.00 on the output tap); unmuting revives nothing.
- Speech: pronunciation ducks competing sfx to 35 % and restores them
  smoothly (live multiplier — saved volume settings untouched).
- Development-only diagnostics: `DebugAPI.audio()` reports active
  sources (key/category/tag/volume), the sling voice state, recent
  events and per-key play/drop counters. Not player-facing UI.

## 7. Actual test results

Automated (this delivery, final run):

- **Full project suite: 1,530 passed / 0 failed**
  (67 unit + 15 integration + 16 lifecycle + 26 ammo/ability + 1,357
  panels + 49 audio).
- **Browser acceptance suite (real Edge, real Web Audio, autoplay
  allowed, output tapped at Phaser's `masterVolumeNode` — the single
  path to the speakers): 29/29 checks passed**, including
  idle 10 s → 0.00e+00 RMS · pull audible (max 1.8e-2) · 5 s hold with
  pouch at 118 px → 0.00e+00 · resume audible, exactly 1 stretch voice ·
  overshoot pointer motion → 0.00e+00 · release = +1 snap +1 cry, no
  loops, post-shot settle → 0.00e+00 · collapse impacts → settle
  0.00e+00 · pause kills the voice, stationary resume silent · card
  open/close = +1/+1 whooshes, reading window 0.00e+00 · 20 dud cycles:
  0 firing sounds, 20 soft returns, 0 instance growth, 0 ammo · master
  mute real + persists, unmute revives nothing · mobile-emulation idle
  + touch pull · 0 HTTP/page errors.

Evidence (direct tab-audio captures, microphone disabled — exactly what
the game sends to the speakers), in `wb-audio-evidence/`:

- `after-idle-silence.wav` — 10 s of a settled level: digital silence.
- `after-pull-hold-release.wav` — pull (leather creaks) → 5 s hold
  (silence) → release snap + whoosh + impact/settle.

**Honest limits of this verification**

- No human listening pass was performed in this environment; subjective
  quality (does the leather "feel" right?) is NOT claimed as auditioned.
  The objective evidence above (direct-output measurements, waveform QC,
  structure) is what was verified. A speaker/headphone pass is
  recommended, especially for the stretch loudness relative to impacts.
- "Before" behaviour is documented from the pre-repair code/git history;
  no before-recording was captured (the old build's music/ambience/loop
  configuration is quoted in §1 instead).
- Desktop verified in a real (headless) Edge; landscape-mobile verified
  by **device emulation only** — physical phone playback (iOS unlock
  behaviour, Bluetooth latency) remains unverified.
- Web-Speech pronunciation ducking is implemented but not exercised by
  the automated suite (headless Chrome ships no speech voices); it is
  covered by unit tests for the duck/restore behaviour.

## 8. How to re-run everything

```bash
npm run build
npm test                      # 1,530 tests
npm run verify:audio          # 29 browser acceptance checks + evidence WAVs
node scripts/analyze-stretch.mjs      # source structure analysis
node scripts/prepare-stretch-audio.mjs # regenerate the leather segments
```
