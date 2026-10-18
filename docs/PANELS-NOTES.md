# Answer Panel Fix — automatic sizing + perfect text fitting

Fixes long English answers (full sentences) not fitting their wooden parchment
panels: cramping, border contact, badge interference, and physics misalignment.

## What changed

**New XL panel asset** — `public/assets/images/tower/props/answer_panel_xl.png`
(600×194 texture, displayed 300×97), baked from the newly uploaded wide
parchment artwork by `scripts/build-answer-panel-xl.mjs`. The chunky stock
rails are thinned between the corner posts with full-width band splices
(crop-and-rejoin — no stretching, no bolts cut); the artwork's transparency is
preserved and the canvas stays pre-trimmed (canvas == content, same contract
as the rest of the tower pack). Display aspect ≈ 3.09; parchment writing box
is x 0.083..0.864 / y 0.245..0.797 of the panel.

**Measurement-driven sizing** — `js/systems/AnswerPanel.js` replaces the old
character-count variant picker:

1. Each choice text is measured with a real Phaser `Text` scratch object
   (Arial bold, `useAdvancedWrap` so words never break mid-word).
2. A choice's needed format = the smallest panel (S → M → L → XL) whose
   parchment writing box holds the text at ≥ that format's font floor
   (S/M/L ≥ 17 px, XL ≥ 16 px — the readability floor; text that would have
   to shrink further escalates to the bigger panel instead).
3. The QUESTION format = the largest needed among its three choices, and all
   three panels share one font size — no visual advantage for any choice.
   Short-word questions stay compact (S), sentences get XL.

**Typography / badge** — text is centered in the parchment box derived from
the artwork (frame, bolts and rivets are never covered); the A/B/C badge sits
on the panel's top-left frame corner (r 12, r 13 on XL), sized so it stays
clear of the text; unbreakable tokens scale down instead of clipping.

**Physics alignment** — `createTarget` places the panel so its BOTTOM rests
on the slot surface (`panelCenterYForSlot`: center = slotY + 40 − height/2 —
level data is untouched by height changes); the Matter body is created at
texture size and `setDisplaySize` scales body + art together, so the collider
matches the visible panel exactly; badge + text ride the body through one
container (position + rotation). XL mass is normalized to the historical L
plaque (density ≈ 0.00056) so supports and settle behaviour are unchanged.

**Layout adaptation** (`scripts/adjust-xl-layouts.mjs`, applied to
`js/data/levels.json`) — every XL question (all of levels 8 and 13, chosen by
measurement) received: support beams under crate-topped slots, staggered
panel placement (≥12 px AABB separation), HUD/question-card/mover clearance,
and world-edge safety; two pre-existing 4 px-tight L-format spots (L4Q4,
L7Q3) were spread apart.

**Accessible reading view** — `js/systems/AnswerPeek.js`: on sentence (XL)
questions, HOLD a pointer on any answer panel (or press Z) while AIMING to
read all three answers at 25 px in an overlay; release/tap closes. Purely
presentational — validation stays collision-based on stable choice IDs.

**Headless honesty** — `tests/helpers/phaser-env.mjs` now provides a
font-size-aware `measureText` approximation so Node tests exercise the same
planning path as the browser (real canvas metrics).

## Tests

- `tests/answer-panel-tests.mjs` (`npm run test:panels`): 1300+ assertions —
  all 180 choices fit their writing box at ≥ the font floor, sentence
  questions use XL, per-question format/font consistency, panel AABB
  separation, supports, world/HUD bounds, live collider/mass match, settle
  stability for every XL question.
- Full battery re-run: unit (62), integration (15/15 incl. the 15-level
  campaign), bird lifecycle, ammo/ability, question card — all green.
- Browser screenshots (`npm run shots:panels`, see `docs/screenshots/panels/`):
  short answers, long answers + close-up, answer-peek overlay, phone
  landscape 844×390, tablet 1180×820 — visually verified (text inside
  parchment, badges clear, no overlaps, real supports).

## Files

- new: `js/systems/AnswerPanel.js`, `js/systems/AnswerPeek.js`,
  `scripts/build-answer-panel-xl.mjs`, `scripts/adjust-xl-layouts.mjs`,
  `scripts/panel-screenshots.mjs`, `tests/answer-panel-tests.mjs`,
  `public/assets/images/tower/props/answer_panel_xl.png`
- modified: `js/config.js` (TARGETS variants + XL mass reference),
  `js/data/tower-assets.js` (XL manifest entry), `js/systems/PhysicsObjects.js`
  (createTarget rewrite), `js/scenes/GameScene.js` (plan + peek wiring),
  `js/scenes/BootScene.js` (true-size panel fallback textures),
  `js/dev/DebugAPI.js` (`gotoQuestion`), `js/data/levels.json` (layouts),
  `tests/helpers/phaser-env.mjs` (font-aware shim), `package.json` (scripts)
