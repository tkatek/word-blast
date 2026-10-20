# Fix #2 — Full-Width Desktop & Landscape-Only Mobile Gameplay

Responsive scaling architecture ("fit world, extend scenery"), delivered
2026-10-17 alongside the parallel background/ground unification stream.

## Strategy

- **Canvas**: `Phaser.Scale.NONE` — a single `ViewportController`
  (`js/systems/Viewport.js`) owns the canvas size. It reads the *visible*
  viewport (`visualViewport`, toolbar-aware, safe-area inset through the
  `#game` shell padding) and sizes the canvas buffer to CSS × DPR
  (capped at 2 for GPU memory). One code path covers desktop window
  resizes, fullscreen enter/exit, and mobile rotation; debounced 120 ms
  with a 300 ms self-healing re-check.
- **Camera**: every scene calls `attachViewport(scene, …)`, which frames
  the fixed 1280×720 logical world with `zoom = min(w/1280, h/720)`
  centered on the world. The whole gameplay region is therefore always
  fully visible on every aspect ratio — never cropped, never distorted.
- **Scenery extension**: on wider/taller viewports the space beyond the
  background art is filled by *mirrored copies* of the art
  (`BackgroundManager.extendTo`), pooled and repositioned on resize —
  pixel-continuous seams, no stretching, no new assets, no physics.
- **Phones**: portrait shows a fullscreen DOM "Rotate Your Phone" overlay
  (`#rotate-overlay` + `js/systems/OrientationGate.js`) on every scene.
  GameScene additionally freezes the state machine, Matter world and
  timers, disables shooting, and restores everything on rotation —
  progress (question, score, shots) is preserved. First tap on mobile
  attempts fullscreen + landscape lock where the browser allows.
- **Input**: Phaser camera zoom makes `pointer.worldX/worldY`
  zoom-aware automatically; `InputMapper` gained an optional `view`
  parameter (legacy call sites unchanged) and `__WB__.mapClient` passes
  the live view. Verified: the same world-space drag produces the same
  launch velocity at every tested size (see FIX2 verification below).

## Files (Fix #2 scope)

- `js/systems/Viewport.js` — NEW: fit-view math, ViewportController,
  attachViewport scene helper (Node-safe, unit-testable).
- `js/systems/OrientationGate.js` — NEW: DOM rotate-overlay gate.
- `js/main.js` — scale mode NONE + controller/gate wiring.
- `js/systems/BackgroundManager.js` — mirrored out-fill (`extendTo`).
- `js/scenes/GameScene.js` — viewport attach in `setupOrientation`
  (single scale listener, cleans up on shutdown).
- `js/scenes/MenuScene.js`, `js/scenes/LevelSelectScene.js` — viewport
  attach + full-bleed backdrops.
- `js/systems/InputMapper.js` — view-aware mapping (backward compatible).
- `js/dev/DebugAPI.js` — live-view `mapClient`, `refreshViewport()`,
  orientation/device overrides refresh the gate.
- `css/style.css`, `index.html` — full-bleed shell, safe areas, rotate
  overlay markup/styles.

## Invariants (must never change)

Physics world, Matter constants, trajectory integrator, slingshot power
curve, tower layouts, question flow — all world-space; the viewport is
presentation only. Resizing mid-flight keeps bodies, scores and timers.

Verified viewports: 1920×1080, 1366×768, 1440×900, 2560×1080 (ultrawide),
1180×820 (iPad 4:3), 844×390 (iPhone landscape) — screenshots in
`fix2-screens/`.
