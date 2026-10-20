# FIX #21 — Question card: smaller, docked upper-left, click-to-expand

The Fix #9 question card kept its center-biased top resting spot and its
320 ms peek. This change re-docks it as a smaller upper-LEFT card, makes
the WHOLE card tappable, and turns the peek into a polished expand /
collapse reading view — without touching the artwork, the 4-second
introduction, or any gameplay system.

## What changed

### 1. Compact card: 18.5% smaller, upper-left
`QUESTION_CARD.TOP` moved from `{x 420, y 158, w 620}` to
`{x 279, y 151, w 505}` (`js/config.js`):
- width 620 → 505 (−18.5%, inside the requested 15–20% band), aspect
  unchanged — the artwork is never stretched and the wooden frame is never
  cropped;
- left edge at `SAFE_X = 26.5` world px (≈ the HUD row's own margin) —
  aligned to the left gameplay margin, screen center left open;
- top edge y 92.3 keeps a ≥14 px gap under the tallest HUD band
  (desktop 73, phone 78) — no HUD overlap on any device;
- bottom edge y ≈ 210 stays above the slingshot fork (y ≥ 260), so the
  card never covers the bird or the aiming zone;
- all 15 level layouts unaffected (answer plaques live center-right).

Text floors lowered slightly (`KICKER 17/11`, `MAIN 30/12`) so the longest
sentence questions (up to 174 chars) still fit the smaller parchment; the
"⤢ tap to enlarge" hint still marks shrunken text.

### 2. Click-to-expand (the main feature)
New card UI states replace the single `PEEK` phase
(`js/systems/QuestionCard.js`):

    READY_TOP → EXPANDING (460 ms, Cubic.easeInOut, to exact center)
              → EXPANDED  (scrim 0.38, close button shown, timer frozen)
              → COLLAPSING (460 ms, Cubic.easeInOut, back to the dock)
              → READY_TOP ('wb-card-peek' false → aiming re-enabled)

- the WHOLE card is one tap zone (not just the parchment field); the
  speaker medallion and the close button sit above it and win their taps;
- a gold-ringed ✕ close button fades into the enlarged card's upper-right
  corner (`Back.easeOut` pop); tapping the card body also closes;
- the dark scrim sits just under the HUD (pause button stays reachable)
  and never covers the card itself;
- same container throughout — no duplicate sprites, no reflow: the docked
  layout is simply shown 1.7× larger, exactly like the Fix #9 peek;
- reversing mid-flight is supported: tapping during EXPANDING collapses
  from wherever the card is, tapping during COLLAPSING re-expands — every
  transition first kills the live tweens of its target, so rapid toggling
  can never stack tweens (regression-tested).

### 3. Game-state safety (`js/scenes/GameScene.js`)
- the scene passes `canExpand()` into the card: expansion is allowed only
  in `QUESTION_READY`/`AIMING` and never while paused — a flying or
  resolving shot can never be interrupted (regression-tested);
- `updateLevelTimer` now freezes the countdown while the card is EXPANDING
  or EXPANDED (same frame-gate as the introduction — no second timer, and
  resume is automatic because the timer only ever advances through that
  gate);
- the slingshot is disabled the instant the card starts expanding and
  re-enabled only when the collapse finishes and the game is in AIMING
  (never while paused — pausing with the card open can never resume
  aiming behind the pause menu);
- opening/closing consumes no shots, never triggers bird abilities
  (markUi) and never fires the slingshot (grab radius).

### 4. Unchanged, verified
The 4-second introduction, question flow, answer validation, physics,
scoring, hearts, shot limits, level progression, HUD, bird selector — all
untouched; the full regression battery passes.

## Files changed
- `js/config.js` — TOP dock values, `SAFE_X`, TYPE floors, `peekMs 460`,
  `PEEK.scrimAlpha`, updated timeline docs.
- `js/systems/QuestionCard.js` — EXPANDING/EXPANDED/COLLAPSING lifecycle,
  full-card tap zone, close button, tween-reversal safety, `expanded`
  getter, kill-tweens covers the close button.
- `js/scenes/GameScene.js` — `canExpand` gate, timer freeze while
  expanded.
- `tests/question-card-tests.mjs` — dock geometry (left edge, size band,
  fork clearance) + 4 new suites (expanded freeze/no-consume, refused
  mid-flight, rapid-toggle storm).
- `scripts/hud2-screenshots.mjs` — card-top probe now reads the live card
  instead of hardcoded Fix #9 geometry.
- `scripts/verify-build.mjs` — browser auto-discovery (Chrome → Edge) so
  the pipeline runs on machines without Chrome.
- `scripts/card21-screenshots.mjs` — NEW acceptance run (below).

## Tests performed
- `node tests/question-card-tests.mjs` — 15/15 (incl. real 4 s window,
  expanded-timer freeze, mid-flight refusal, toggle storm).
- `npm run test:unit` 67/67 · `test:integration` 15/15 ·
  `test:lifecycle` 16/16.
- `npm run build` + `verify-build` — production bundle boots clean.
- `node scripts/card21-screenshots.mjs` (vite preview, real Edge): 34/34
  checks — dock geometry, HUD clearance, REAL mouse + touch expansion,
  smooth-tween evidence (18 sampled frames, scale 0.587→1, no teleport),
  timer freeze 0 ms drift / resume, speaker input isolation, close-button
  return, resize stability, iPad/Android-tablet/iPhone/Android-phone
  landscape fits.

## Screenshots — `screenshots/card21/`
1. `1-desktop-compact-docked.png` — compact card upper-left, center open.
2. `2-desktop-mid-expansion.png` — halfway to the center (captured during
   a temporally stretched — same code path — glide so the midpoint is
   honest despite capture latency).
3. `3-desktop-fully-expanded.png` — centered, scrim, close button.
4. `4-desktop-mid-return.png` — gliding back to the dock.
5. `5-desktop-returned-to-dock.png` — exact dock restored, aiming back.
6. `6-ipad / 6-android-tablet` — tablet landscape layouts.
7. `7-iphone / 7-android-phone` — phone landscape: docked, expanded and
   final layouts (touch-verified).

## Known limitations
- The mid-flight captures (2 and 4) were taken with `peekMs` temporarily
  raised to 1200 ms via the debug API — identical easing and path, just
  slower, because a headless CDP screenshot round-trip exceeds the real
  460 ms tween's midpoint window. Production timing is 460 ms everywhere.
- Very long questions still rest at the font floor on the compact card;
  the tap-to-enlarge view remains the reading aid there (unchanged design).
