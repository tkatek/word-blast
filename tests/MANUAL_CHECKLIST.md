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

## Projectile abilities

- [ ] Speed boost (tap mid-flight, L4+): clearly visible velocity jump, once.
- [ ] Ice (L7+): frozen tint appears; frozen blocks take visibly more damage.
- [ ] Split (L10+): tap splits into three; children can answer targets.
- [ ] Bomb (L12+): detonates on first impact; blast throws blocks; answer
      targets correctly survive blasts.

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

## Known debug-phase limitations (by design, not bugs)

- Placeholder graphics/text UI (final art phase comes next).
- AudioManager emits events only (no sounds yet).
- `forceSetTimeOut` loop keeps physics running when the canvas is occluded —
  revisit if battery usage matters on mobile.
