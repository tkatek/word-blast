# FIX #9 — Professional Animated English Question Card

The supplied wooden parchment banner (`public/assets/images/ui/question-card.png`,
2082×484, transparency preserved, palette-optimized 421 KB) is now the single
question display, replacing the old plain-text question/choices strips.

## Files changed
- `public/assets/images/ui/question-card.png` — NEW: the supplied artwork,
  trimmed to its opaque bounds and palette-optimized (avg pixel delta 1.8/255).
- `js/config.js` — NEW `QUESTION_CARD` block: artwork geometry ratios (measured
  pixel-exact by `scripts/tmp/analyze-question-card.mjs`), center/top layouts,
  typography, animation timings, shadow.
- `js/systems/QuestionCard.js` — NEW (~600 lines): the card component.
- `js/scenes/GameScene.js` — integration: card presentation replaces the old
  text panel + arming delay; timer frozen during the introduction; queued
  next-question hand-off; pause/resume hooks; peek slingshot gating; old
  `questionText`/`choicesText` removed.
- `js/scenes/BootScene.js` — preloads the artwork; procedural fallback texture
  with identical layout ratios when the PNG is unreachable (headless tests).
- `js/dev/DebugAPI.js` — `setCardTimings()` + `cardInfo()`.
- `tests/helpers/headless-game.mjs` — fast card timings for automated suites.
- `tests/question-card-tests.mjs` — NEW regression suite (12 tests, incl. the
  REAL 4-second reading window). Wired into `npm test` + `npm run test:card`.
- `scripts/tmp/fix9-*.mjs` — capture/verification helpers.

## Behavior
Per question: `CARD_ENTERING` (350 ms fade + 0.9→1 scale, Sine.easeOut,
centered) → `CARD_READING` (4000 ms of ACTIVE time; countdown frame-driven in
the pause-gated `update()`, so manual pause / portrait rotation / hidden tab
freeze it and resume from the same point; the level timer is frozen) →
`CARD_MOVING_TO_TOP` (600 ms Sine.easeInOut — the SAME container tweens
position + proportional scale; no rewrap, no flicker) → `CARD_READY` (arms
AIMING exactly now) → `CARD_EXITING` (240 ms) on question change / level end.
Wrong answers never replay the introduction. Question 4 → level complete, no
further card.

The card is UI sub-states only — the global GameStateMachine is untouched
(it simply stays `QUESTION_READY` until arming). Question tokens invalidate
stale tweens/callbacks; all card tweens are tracked, pausable and killed on
re-present/destroy.

## Positioning
- Center: (640, 352), 860×200 world px.
- Top: (420, 158), 620×144 — 10 px gap under the HUD band (y ≤ 76).
  Deliberately biased left of the tower band: a top-CENTER card covers up to
  22.8 % of the answer plaques (they reach y=102 in level 11); at x 110..730
  coverage is effectively zero across all 180 plaques and the slingshot
  (fork y ≥ 260) stays clear.
- Text is laid out once against the top scale (30 px down to a 15 px floor)
  and never reflows — the center view simply shows it larger. Long questions
  wrap adaptively and show a "⤢ tap to enlarge" hint; tapping the parchment
  opens the enlarged peek view (scrim blocks gameplay taps, slingshot
  disabled) without changing the question or consuming a shot.

## Audio
No prerecorded per-question audio exists in the project. The blue medallion
is a real button backed by the Web Speech API behind a voice-availability
check (`speechSynthesis.getVoices()`; live `voiceschanged` refresh). With no
engine/voices (Node headless) the button renders dimmed, non-interactive and
`trySpeak()` returns false — never a fake click. Tapping while available
pronounces the question (English voice preferred, rate 0.92); taps mark UI
(`markUi`) so they can never fire abilities or consume shots, and they do not
touch the timer or score.

## Tests performed
- `node tests/question-card-tests.mjs` — 12/12 (incl. real-timing 4 s window,
  frozen timer, disabled shooting, top geometry below HUD, next-question
  transition without duplicates/skips, wrong-answer no-replay, Q4 →
  LEVEL_COMPLETE, pause freeze/resume, restart mid-intro, peek gating,
  honest unavailability headless).
- `npm run test:unit` — 62/62. `test:integration` — 15/15 (full 15-level
  campaign). `test:lifecycle` — 16/16.
- `npm run build` + `verify-build` — production build verified; final dist
  booted and probed in a real browser (menu → level → card phases, peek,
  TTS voices present).
- 7 required screenshots captured from the running game and visually
  accepted: `docs/screenshots/fix9/` (A entrance, B reading window, C
  mid-move, D top resting, E long sentence, F phone landscape, G question 2).

## Known limitations
- Camera shake (strong impacts only, capped at 0.6 %, < 250 ms, skipped under
  reduced motion) translates the camera matrix and therefore nudges the card
  exactly like the existing wooden HUD; exempting it would require a second
  render camera (double draw of the whole scene) — declined for phone perf.
- Very long questions rest at the 15 px floor on the top card (~8 CSS px on a
  phone) — by design the peek view is the reading aid there.
- Web Speech availability/quality follows the host browser (no voices on
  desktop Firefox by default on some systems; the button then shows
  unavailable).
