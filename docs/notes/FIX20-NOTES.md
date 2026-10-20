# FIX #20 — Supplied wooden HUD artwork integration (top bar)

The seven blank wooden/metal top-bar assets from `top bar elements.zip` are now
the HUD's decorative frames. Every label, icon, counter and interaction state
is a separate game object drawn on top — nothing is baked into the images, and
no second backing strip was added behind the already-framed panels.

## Files changed
- `public/assets/images/ui/hud/*.png` — NEW (7 files, 286 KB total): the
  supplied artwork, alpha-trimmed to its visible bounds and resized to ~3× the
  largest display size (scripts/prepare-hud-assets.mjs). Proportions preserved
  exactly; leaves/rivets/scroll ends intact; the black in previews was the
  alpha channel, never a painted background.
- `assets-src/hud/*.png` — NEW: the untouched originals, preserved in-repo.
- `js/systems/HudArt.js` — NEW: art registry (texture keys, files, MEASURED
  geometry: aspects, inner writing windows, real compartment boundaries),
  preload list, and procedural stand-ins with identical geometry for
  headless/missing-asset environments (same pattern as the question card).
- `js/systems/HudLayout.js` — NEW: ONE pure layout calculation
  (`computeHudLayout(deviceType)`) returning every element's position/size,
  the progress panel's compartment rects and the typography scale. Phaser-free,
  unit-tested in Node.
- `js/systems/GameHUD.js` — top bar rebuilt on the artwork: image panels with
  content fitted to the measured windows (never centered on raw canvases),
  code-drawn pause/sound icons centered in the inner disk, ink-on-parchment vs
  cream-on-dark text per background, fixed-width timer/score slots (no jitter),
  shots pulse after a launch, low-time colour+pulse on a child text object,
  level title shrink-to-fit, single-star phone mode. NEW dedicated HUD camera:
  the gameplay camera ignores the HUD tree, so impact shake/flash never reach
  it (verified: HUD camera matrix swing 0.000 px during a 25 px shake); the UI
  camera re-frames with the same whole-world fit on resize. `barBottom`
  exposes the occupied band. Pause menu, sync() contract, hearts animation,
  star progress crop and destroy lifecycle unchanged.
- `js/scenes/BootScene.js` — preloads the 7 PNGs (BASE_URL-relative); on
  load-error draws the procedural stand-in under the same key and warns.
- `tests/run-tests.mjs` — +5 layout/registry tests (world fit, gaps, band vs
  question-card top, aspect preservation, ≥44 CSS px phone hit-boxes).
- `scripts/measure-hud-art.mjs` — NEW: pixel measurement of the supplied art
  (alpha trim + centre-tone scans + divider detection).
- `scripts/prepare-hud-assets.mjs` — NEW: builds the runtime PNGs.
- `scripts/hud2-screenshots.mjs` — NEW: browser acceptance run (screenshots +
  functional probes) against the built game.
- `scripts/tmp/probe-shake.mjs` — diagnostic used while verifying isolation.

## Asset → component mapping (measured, not eyeballed)
| Supplied file | Runtime asset | Component | Key geometry (fractions of trimmed art) |
|---|---|---|---|
| 15_56_06-1 | pause-button-bg | pause button | Ø 1096×1110, icon disk 0.5 |
| 15_56_10-2 | sound-button-bg | sound button | Ø 1017×1011, icon disk 0.5 |
| 15_56_11-3 | level-panel-bg | LEVEL n + title | aspect 3.81, window x .109–.799 (scroll right), y .281–.702 |
| 15_56_12-4 | progress-panel-bg | Q · clock MM:SS · stars | aspect 5.08, cells .113–.240 / .273–.727 / .760–.887 (measured, NOT thirds) |
| 15_56_14-5 | hearts-panel-bg | hearts | aspect 3.26, dark centre, window x .096–.887 |
| 15_56_15-6 | shots-panel-bg | bird portrait + ×N | aspect 2.51, light centre, window x .143–.820 |
| 15_56_16-7 | score-panel-bg | coin + score | aspect 2.55, dark centre, window x .130–.856 |
| 15_56_17-8 (wide strip) | — not used — | individual panels compose a cleaner bar; a second backing bar would only add thickness (explicitly allowed by the brief) |

Timer occupies the wide middle compartment (icon + reserved MM:SS slot);
question progress and stars sit in the measured narrow side cells.

## Responsive behaviour
- Desktop/tablet: one full row `[Pause][LEVEL+title][Q·timer·stars][hearts][shots][score][Sound]`,
  band bottom y 73 (question card still docks at its unchanged y-86 spot).
- Phone landscape: same row, compact — `LV n` chip, single summary star
  (question-progress dial; star thresholds 2–3 stay on desktop/tablet and the
  victory screen), circular buttons at 72 world px with 92×92 world hit-boxes
  (≥ 44 CSS px at 667×375 zoom 0.52). Band bottom y 78.
- The world-fit viewport frames the whole 1280×720 world on every device, so
  the chosen layout never re-flows; resize only re-frames both cameras.

## Verification
- `node tests/run-tests.mjs` 67 passed · integration 15 · lifecycle 16 ·
  ammo 26 — full `npm test` green; `vite build` green (assets ship to dist,
  all 7 fetched over HTTP in the acceptance run).
- `node scripts/hud2-screenshots.mjs` — all checks passed: supplied textures
  in use, no duplicates after resize, timer unreset, pause opens the existing
  flow without firing a bird, sound toggle flips icon+setting, one-heart and
  123,450-score states, card dock gap, HUD camera matrix 0.000 px swing
  during a 25 px gameplay shake. Screenshots in `screenshots/hud2/`
  (viewports 1920×1080, 1366×768, 1280×800, 1024×768, 844×390, 667×375).
  Before: `docs/screenshots/fix17/`.

## Known limitations
- The counter panels' measured windows are short (17–24 world px): shots/score
  text is 14–15 world px (≈7.5 CSS px on the smallest phones) — crisp but
  small; the artwork's chunky frames are the binding constraint.
- Desktop stars are 12.5 world px (three fit the measured narrow cell); on
  phones a single 18 px star replaces them (secondary info, per the brief).
- Arial/Helvetica remains the game font (no webfont dependency added, keeping
  the offline/subdirectory-hosted build self-contained).
