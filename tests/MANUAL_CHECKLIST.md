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

- [ ] Android Chrome (real phone), landscape: PLAY FULLSCREEN card → tap →
      toolbar hides, orientation locks; pause menu shows EXIT FULLSCREEN;
      exit keeps the game paused; corner chip offers fullscreen again.
- [ ] iPhone Safari (real phone), landscape: NO fullscreen button;
      Add-to-Home-Screen card once; CONTINUE PLAYING keeps the game running;
      guidance matches the installed iOS version (Share sheet wording).
- [ ] iPhone, installed from Home Screen: standalone (no Safari bars), no
      fullscreen prompts, gameplay responsive, rotation handled.
- [ ] Notch/home-indicator devices: HUD, timer and pause menu never clipped
      (safe-area insets).
- [ ] Rotate mid-aim / while paused / during a question on a real device:
      progress kept, no restart, manual pause survives.

## Known debug-phase limitations (by design, not bugs)

- Placeholder graphics/text UI (final art phase comes next).
- AudioManager emits events only (no sounds yet).
- `forceSetTimeOut` loop keeps physics running when the canvas is occluded —
  revisit if battery usage matters on mobile.
