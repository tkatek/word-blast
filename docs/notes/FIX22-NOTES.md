# FIX #22 — Professional Sound Effects and Dynamic Audio Engine (silence-first)

Word Blast now has a complete, playable, event-driven audio system built on
a **silence-first design**: the game is sound-effects-only, and a settled
scene with no input is *truly silent* (measured 0.00 RMS on the direct
output tap). **47 sound files (1.5 MB)** cover every gameplay event; the
slingshot stretch is real recorded leather, driven by actual pouch motion.
There are no placeholder or empty audio functions — every event routes to a
real, decoded, playable asset.

Verification: **49 automated audio tests** + the full existing suite
(67 unit + 15 integration + 16 lifecycle + 26 ammo + 1357 battery) all
pass, and the **real-browser acceptance suite**
(`npm run build && npm run verify:audio`) measures the game's DIRECT audio
output (AnalyserNode tapped onto Phaser's master volume node) through 13
scenarios including pull-and-hold, max-pull overshoot, 20 dud-release
cycles, pause/mute during stretch, question-card transitions and a
landscape-mobile touch pass — all green, with evidence WAVs captured to
`wb-audio-evidence/`.

---

## 1. Design — silence-first

An earlier iteration of this fix shipped menu/gameplay music loops and a
forest ambience bed. The final design deliberately removed them:

- No background music, no ambience loops, no flight whistle — nothing
  drones under the English questions or the pronunciation voice.
- Every sound is a **one-shot tied to a physical or UI event**; when the
  world settles, output returns to true silence (verified in-browser).
- The slingshot stretch plays **only while the pouch actually moves** and
  fades out ~120 ms after it stops — a held, fully-stretched pouch is
  silent (verified with a 5-second hold at 118 px stretch).
- The music/ambience settings and mixer buses still exist and persist, so
  a future soundtrack can be added without touching gameplay code (this
  build simply ships no tracks).

## 2. Audio asset inventory (47 files, all in `public/assets/audio/`)

| Category | Files | Source |
|---|---|---|
| slingshot | `grab`, `release`, `return`, `stretch-1..5` (8) | **Recorded leather** — segments cut from the user-supplied Pixabay recording *Slow Leather Stretch* (id 63057, by OldCouches, Pixabay Content License — full attribution: `assets-src/audio-stretch/ATTRIBUTION.md`) |
| wood | `hit-light-1..3`, `hit-heavy-1..2`, `crack`, `break`, `collapse` (8) | Original synthesis (`scripts/generate-audio.mjs`) |
| glass | `hit-1..2`, `crack`, `shatter` (4) | Original synthesis |
| stone | `hit-light-1..2`, `hit-heavy-1..2`, `crack`, `collapse` (6) | Original synthesis |
| abilities | `boost`, `split`, `explosion`, `freeze`, `ice-shatter` (5) | Original synthesis |
| birds | `launch`, `hit` (2) | Original synthesis |
| pigs | `pop` (1) | Original synthesis |
| ui | `click`, `hover`, `select`, `pause`, `resume`, `correct`, `wrong`, `star`, `heart-lost`, `level-complete`, `level-failed`, `missed`, `question-ready` (13) | Original synthesis |

All mono 16-bit 22050 Hz WAV (universally decoded by every supported
browser — no codec fallback needed). The synthesized set is regenerated
deterministically by `node scripts/audio:generate`; the slingshot segments
by `node scripts/prepare-stretch-audio.mjs` (cuts, 70 Hz HP, fades,
RMS-matched, peak ≤ −6 dBFS — see `segments-report.json` for exact source
ranges).

## 3. Source and license details

- **One external asset**: the slingshot leather recording — Pixabay sound
  63057, "Slow Leather Stretch" by OldCouches, Pixabay Content License
  (free for commercial use; attribution recorded in
  `assets-src/audio-stretch/ATTRIBUTION.md` along with the untouched source
  copy). Earlier comments mislabeled this as "Freesound #63057" — corrected
  (Freesound #63057 is an unrelated music-box sample).
- **Everything else is original synthesized material** (oscillators,
  filtered noise, damped partials, Karplus-Strong strings, Schroeder
  reverb) produced in-repo by `scripts/generate-audio.mjs`. Nothing is
  extracted from Angry Birds or any commercial game.

## 4. AudioManager architecture

One manager per game, created once in `BootScene.create()` and kept in the
registry (survives every scene restart; `attach()` is idempotent). Two
layers:

1. **Event bus** (API unchanged): gameplay emits semantic events with
   physics-derived payloads (`hit-wood {severity, otherKind…}`); no
   gameplay code knows about audio.
2. **Playback engine**: manifest → cache-existence check → category mute →
   per-key cooldown → voice caps (impact-tagged voices use severity
   priority — strongest wins) → variation pick (no immediate repeat) →
   ± detune jitter → play at `base × event × bus` volume.

**All engine timing runs on the game's `poststep` clock** (cooldowns,
fades, delayed chimes) — never on a scene clock, which freezes when a scene
shuts down (that exact bug shipped briefly and was caught by the browser
suite: cooldowns froze after boot and the first menu theme never faded).

Other engine duties:

- **Motion-driven slingshot voice** — ONE voice per drag session: smoothed
  pouch speed (EMA, spike-guarded) starts/stops segment playback, segments
  chain on natural completion, `RETRIG_GAP` prevents machine-gunning, and
  the voice fades 120 ms after real motion stops. Grab is a single subtle
  contact creak; dud/cancel is a soft leather return — never launch audio.
- **Speech ducking** — while the question voice speaks
  (`QuestionCard` → `duckForSpeech(true/false)`), competing sfx voices dip
  to 35% and ramp back smoothly.
- Explosion dedupe by time+distance (bomb + TNT chains never stack);
  collapse accent when ≥3 breaks land inside 700 ms (1.6 s lockout).
- **Phaser 3.90 mute quirk workaround**: `BaseSoundManager`'s constructor
  creates an own `mute` data property that shadows the WebAudio accessor,
  so master mute writes `masterMuteNode.gain` directly.
- Mobile unlock (gesture listeners + suspended-context resume +
  desired-state retry), pause/resume via one choke point, missing-asset
  degradation (per-key cache check, drops counted, never a crash).

## 5. Event → sound mapping

| Event (payload) | Sound |
|---|---|
| `sling-grab` | one subtle leather contact creak (300 ms cooldown) |
| `sling-stretch {tension, speed, towardRest}` | motion-driven creak segments; volume/pitch track speed + tension; toward-rest moves pick the softer variant |
| `sling-cancel` | fade motion voice + soft leather return — never launch audio |
| `launch {power}` | one snap (0.72–1.0 × power) + one bird cry; no flight loop |
| `bird-impact {severity}` | one soft "oof" (260 ms cooldown — the 5-way split fan = one vocal) |
| `hit-wood/glass/stone/pig/boom {severity, otherKind}` | light layer < 22 damage, heavy ≥ 22; volume 0.45+sev/55; ×0.8 on terrain; 70 ms material cooldown |
| `break-{mat} {severity, frozen}` | material break once per destroyed body; frozen = ice-shatter, never wood |
| ≥3 breaks / 700 ms | ONE collapse accent (wood/stone by majority), 1.6 s lockout |
| `explode {x, y}` | one layered explosion; dedupe < 120 ms global / < 450 ms within 90 px |
| `boost` / `split` / `freeze` | one activation sound each (physics-side `abilityUsed` guards) |
| `answer-correct` / `answer-wrong` | success arpeggio / gentle two-tone (no harsh buzzer) |
| `card-open` / `card-close` | one soft whoosh per transition (emitted by QuestionCard at the phase change, never per tween frame) |
| `question-ready` / `shot-missed` / `heart-lost` | soft whoosh / quiet whiff / soft thud+drop |
| `level-complete {stars}` | staggered star chimes (pitch +2 st each) then the fanfare cue |
| `level-failed` | gentle descending cue (150 ms in) |
| `game-pause` / `game-resume` | pauseAll FIRST then the cue (a pre-pause click would freeze mid-play); resume cue after resumeAll |
| `ui-click` / `ui-hover` (desktop) / `bird-selected` | woody click / very soft tick / selection pop |

The answer flow itself is **player-paced**: physics settles, the wooden
feedback card arms its CONTINUE button, and the question advances only on
the click — audio follows that contract (the browser suite clicks through
the card exactly like a player).

## 6. Volume and mixing configuration

Buses: `master 0.9 · sfx 1.0 · ui 0.9` (music/ambience/voice buses exist,
unused by this build). Voice caps: 8 sfx / 4 ui / 6 impact. The pause menu
exposes three ON/OFF toggles — **SOUND** (master, pre-existing control),
**MUSIC**, **FX** — persisted through the existing SaveManager
(`settings.sound/music/sfx/ambience` + clamped `volumes` map; legacy saves
default everything on). Anti-clipping: per-sound levels, bus mixing, tanh
soft-saturation baked into dense assets, voice caps, and the master mute
node hard-gate.

## 7. Mobile / browser compatibility

- WAV PCM decodes natively in Chrome, Edge, Firefox and Safari
  (desktop + iOS/Android) — no codec fallbacks.
- Mobile autoplay: music-free design makes this trivial, but the engine
  still unlocks on first gesture (document-level pointer/touch/key +
  Phaser `unlocked` + suspended-context resume) for the one-shots.
- A **landscape-mobile emulation pass** runs in the browser suite
  (Pixel-7 viewport, touch events): idle silent, touch pull audible.
  Physical-device listening remains a manual step (see honest list).
- Pause (menu, portrait rotation, hidden tab) funnels through one choke
  point: audio suspends with gameplay, resumes without duplication, and a
  muted player is never auto-unmuted.
- Missing files degrade to silence per key (counted, never a crash) —
  proven by the headless Node suite, which has no audio stack at all.

## 8. Tests run — actual results

- `node tests/audio-tests.mjs` → **49 passed, 0 failed** (routing,
  cooldowns, caps + severity priority, explosion dedupe, collapse
  detector, speech ducking, mutes, persistence, legacy saves,
  missing-asset safety, double-attach safety, headless real-game flow).
- `node tests/feedback-card-tests.mjs` → passing (the player-paced
  feedback card the audio integrates with).
- Full suite (`npm test`) → 67 + 15 + 16 + 26 + 1357 + 49 + feedback-card,
  **all passing, zero regressions** — re-run after the slingshot fix below.
- `npm run build && node scripts/verify-audio.mjs` → **PASSED** (twice;
  13 scenarios against the direct output tap, evidence WAVs in
  `wb-audio-evidence/`): 47/47 decoded, idle silence, stretch audible only
  while moving, 5 s hold silent, one voice on resume, max-pull overshoot
  silent, one snap + one cry per shot, post-shot silence, collapse audible
  then silent, pause-during-stretch drops the voice, card open/close one
  whoosh each + quiet reading, **20 dud releases = 20 soft returns, 0
  firing sounds, 0 ammunition lost, no voice growth**, master mute
  functionally silent (click into the muted graph = 0.00 RMS), unmute
  replays nothing, mobile-emulation pass, zero HTTP/page errors.

### Gameplay bug found and fixed by this suite

The dud-release path called `cancelDrag()` *after* clearing
`this.dragging`, and `cancelDrag`'s own guard turned it into a no-op: the
pouch stayed pulled out, each subsequent grab accumulated the offset
(5 px → 10 px → 17 px, measured in-browser), and after a few "tiny" drags
the game **fired a shot the player never intended**. Fixed in
`Slingshot.onPointerUp` (the dud cancel now runs while the drag flag is
still set); the lifecycle scenario now shows 20/20 clean cancellations.

## 9. Missing / incomplete — honest list

- **Nothing missing from the manifest** — all 47 files exist and decode in
  the browser; every routed event has a real asset.
- Background **music and ambience are intentionally absent** (silence-first
  redesign). The mixer, settings and persistence for them remain in place
  for a future soundtrack; nothing needs to be re-architected to add one.
- Perceptual listening on real speakers/phones (loudness balance, leather
  texture feel) requires human ears — everything machine-checkable is
  verified; the evidence WAVs in `wb-audio-evidence/` exist so a listener
  can hear exactly what the suite measured.
- Speech pronunciation still uses the browser's `speechSynthesis`
  (unchanged); the mixer's `voice` bus + speech ducking are ready for
  recorded narration.

## 10. Testing audio locally

```bash
cd word-blast
npm run audio:generate          # regenerate the synthesized SFX set
node scripts/prepare-stretch-audio.mjs   # re-cut the leather segments
npm test                        # full suite incl. audio + feedback-card
npm run build && npm run verify:audio    # browser acceptance + evidence WAVs
npm run dev                     # play: first click/tap unlocks audio
```

In-game diagnostics: `window.__WB__.audio()` (engine state, sling voice,
active voices, per-key play/drop counters). The pause menu's SOUND / MUSIC
/ FX toggles persist across reloads.
