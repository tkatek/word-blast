# Manual Testing Checklist

Automated coverage: `npm test` (37 Node tests) + the browser integration suite
(Level 1 full play, answer flows, failure/retry, pause, restart, 15-level
smoke). The items below **require human playtesting** — they are about feel
and fairness, which automation cannot judge honestly.

## Difficulty & feel (all levels)

- [ ] L1: a first-time player understands drag-and-release without help.
- [ ] Slingshot drag feels responsive (mouse + touch); trajectory dots match
      the real flight closely.
- [ ] L2–L5: wood/glass break satisfyingly; structures collapse believably.
- [ ] L6: stone walls feel heavy — players should prefer lobbing over them,
      not smashing through (stone HP 130).
- [ ] L7: two-stage fences (break fence → hit target) reads clearly.
- [ ] L8: sequential target row teaches "read all three, pick the correct".
- [ ] L9: moving-gate timing is fair at speed 1.6–2.5 (not pixel-perfect).
- [ ] L10–L11: fortresses/towers are solvable with available projectiles.
- [ ] L12: glass chains feel controllable, not random.
- [ ] L13: moving platforms + roofs make aiming strategic, not frustrating.
- [ ] L14: 2 shots/question with boom barrels — verify a boom barrel blast
      opening a bunker is actually the intended solution path.
- [ ] L15: the four finale layouts are beatable; all five projectile types
      get moments to shine.

## Projectile abilities (Fix #19 mapping: BLUE=boost, YELLOW=split, BLACK=bomb, PURPLE=ice)

- [ ] Speed boost (BLUE bird, tap/SPACE/TAP-button mid-flight, L4+): clearly
      visible velocity jump + blue trail, once per launch.
- [ ] Ice (PURPLE bird, L7+): mid-flight tap freezes nearby blocks (icy tint);
      frozen blocks take visibly more damage; tint expires after ~6s.
- [ ] Split (YELLOW bird, L10+): tap mid-flight splits into FIVE smaller
      yellow birds in a fan; children share one answer-selection per shot.
- [ ] Bomb (BLACK bird, L12+): mid-flight tap detonates; untriggered bombs
      still explode on first impact; blast throws blocks; answer targets
      correctly survive blasts (no answer awarded by blast damage).

## Bird selection cards + ammunition (Fix #19)

- [ ] Five cards bottom-left: RED/BLUE/YELLOW/BLACK/PURPLE with real artwork
      and gold ×N badges (proposed full-roster inventory 3/2/2/1/1).
- [ ] Selecting a card highlights it (gold glow + lift) and swaps the bird in
      the slingshot WITHOUT consuming ammunition.
- [ ] Launching consumes exactly one ammo unit and one shot; the badge pulses
      and the card dims at ×0; a zeroed bird cannot be re-selected.
- [ ] When the current bird hits zero, the next available bird auto-loads at
      the re-arm; selection is locked during flight.
- [ ] Keys 1–5 select birds on desktop; SPACE activates the flying ability;
      the TAP button appears mid-flight on touch layouts.

## Scoring fairness

- [ ] 3-star thresholds feel achievable-but-tight on a sample of levels
      (L1 5150, L7-13 4900, L14-15 4400).
- [ ] Wrong-answer feedback (correct answer + explanation) is readable in the
      ~2s it stays up; consider a "Next" tap to dismiss in the final UI.

## Mobile / lifecycle (desktop DevTools + a real phone)

- [ ] Landscape orientation prompt/behavior; FIT scaling letterboxes cleanly.
- [ ] Touch drag works; no page scroll/zoom/selection during play.
- [ ] Orientation change and browser resize keep the game stable mid-level.
- [ ] Tab switch → auto-pause; return → resume works; shots never fire while
      paused.
- [ ] Progress persists across reloads; RESET SAVE on the menu works.

## Mobile fullscreen (see MOBILE-FULLSCREEN-NOTES.md; automated base is
   scripts/verify-fullscreen.mjs — these need REAL devices)

**Verification status: NOT yet verified on a physical iPhone.** Everything
below passed in desktop Chrome with phone emulation (including an
iPhone-Safari emulation that removes the element Fullscreen API exactly
like real iOS). Emulation is a layout/capability test, NOT device proof —
run the on-device pass and record model + iOS version + build ID.

**On-device diagnostics**: open
`https://tkatek.github.io/word-blast/?diag=1` on the phone → 🛠 button
(bottom-left) → panel with build ID, launch mode, fullscreen capability,
last fullscreen error and live dimensions → COPY and paste it into the
bug report. No personal data is included.

- [ ] **A. Safari tab, portrait (iPhone):** styled rotation screen with the
      Rotation Lock hint; no broken loading UI.
- [ ] **B. Safari tab, landscape (iPhone):** game fits the viewport under
      the address bar; "PLAY WITHOUT THE ADDRESS BAR" card with the 7-step
      install guide; CONTINUE IN BROWSER keeps playing; ⌂ INSTALL chip can
      re-open the guide; the steps match the installed iOS version.
- [ ] **C. Home Screen app, landscape (iPhone):** no Safari bars; game
      fills the app viewport; all controls reachable; no install/fullscreen
      prompts; `?diag=1` reports `launch.standalone: true`.
- [ ] **D. Home Screen app, portrait:** rotation screen works; progress
      unchanged after rotating back.
- [ ] **E. Android Chrome (real phone), landscape:** PLAY FULLSCREEN card →
      tap → REAL fullscreen (`fs.fullscreenElement` set in ?diag=1);
      orientation locks where supported; pause menu shows EXIT FULLSCREEN;
      exit keeps the game paused; ⛶ chip offers fullscreen again.
- [ ] **F. Gameplay on device:** aim, launch, ability tap, feedback,
      question progression, pause/resume/restart, complete a level.
- [ ] **G. Interruptions:** rotate repeatedly, app-switch, lock/unlock;
      no frozen overlays, lost shots, duplicate audio or offset touches
      (verify the bird stays under the finger while dragging).
- [ ] **H. Regression:** desktop fullscreen (F11 + card), Android
      rejection path (decline the browser permission if shown) and exit
      paths all leave a working game.
- [ ] Record phone model, iOS version, browser, build ID (from ?diag=1)
      and launch mode with each pass. A short screen recording is ideal
      evidence for B and C.

## Known debug-phase limitations (by design, not bugs)

- Placeholder graphics/text UI (final art phase comes next).
- AudioManager emits events only (no sounds yet).
- `forceSetTimeOut` loop keeps physics running when the canvas is occluded —
  revisit if battery usage matters on mobile.
