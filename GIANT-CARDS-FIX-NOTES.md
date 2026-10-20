# GIANT ANSWER CARDS — ROOT CAUSE & FIX

**Symptom:** in advanced levels (long sentence answers), the parchment answer
card hit by a bird became EXTREMELY large — most visibly after a WRONG answer,
where the doubled card stays on screen through TRY AGAIN (early levels with
short answers looked fine).

## Root cause

`GameScene.flashTarget()` tweened a "flash pop" on every answer hit:

```js
const t = { k: 1 };
this.tweens.add({ targets: t, k: 1.18, duration: 130, yoyo: true,
  onUpdate: () => targetGo.setScale(t.k) });
```

`setScale` on a Phaser Matter image sets the **ABSOLUTE** sprite scale and
rescales the physics body to match (undo-current + apply-new, see
`phaser/src/physics/matter-js/components/Transform.js`). That is only safe
when the native scale is 1:

| panel | texture | display size | native scale |
|-------|---------|--------------|--------------|
| S/M/L | 116..170 × 80 | same as texture | **1** |
| XL    | 600 × 194 | 300 × 97     | **0.5**      |

The XL parchment (sentence answers, `answer_panel_xl`) renders at HALF its
texture size, so the very first `setScale(1)` of the flash instantly set the
card to 2× its configured size — and the yoyo "returned" to 1.0, not 0.5.
The card stayed **permanently doubled, sprite AND Matter collider** (4× the
collider area), pushing towers and occluding the screen until the question
changed. S/M/L cards popped 1→1.18→1 and came back unchanged, which is why
only long-answer levels showed the bug. Correct answers usually transition
to the next question quickly; wrong answers keep the plaque in the world —
exactly the reported screenshot.

## Fix (two layers)

1. **`js/scenes/GameScene.js` — `flashTarget()`**: the hit flash is now
   TINT-ONLY (`setTintFill` for 420 ms). No tween or effect may ever touch an
   answer plaque's scale; the green/red tint flash carries the feedback.

2. **`js/systems/PhysicsObjects.js` — size invariant**: `createTarget()`
   records the configured display scale (`wb.baseScaleX/baseScaleY` right
   after `setDisplaySize`), and `syncTargetLabels()` — already running every
   frame for every plaque — heals any drift back to that scale (which also
   rescales the Matter body back, keeping sprite and collider identical).
   No effect, tween or future code can permanently resize an answer card.

Falling, rotation and collisions are untouched: physics position/rotation
still drive the card; only its SIZE is pinned.

## Verification

- `npm run test:scale` (`tests/plaque-scale-tests.mjs`, 216 checks): wrong
  hit, correct hit + CONTINUE transition, tower collapse and TRY AGAIN retry
  on XL (L13/L8) and compact (L1) questions — sprite scale, display size AND
  collider area constant at every stage (sampled inside the old 130 ms tween
  window and long after). **Fails on the pre-fix code** (scale 0.5→1.0,
  display 300×97→600×194, collider area 29100→116400), passes after.
- Full suites after the fix: integration 15/15 (all 15 levels × 4 questions
  + lifecycle robustness), answer panels 1357/1357, bird lifecycle 16/16,
  unit 67/67.
- `npm run shots:scale` (`scripts/plaque-scale-screenshots.mjs`): real
  browser run on L13 Q1 (XL), game's own auto-aimed shot at a WRONG answer —
  screenshots before / mid-flash / after / after TRY AGAIN in
  `screenshots/plaque-scale/`, with numeric size reads: 300×97 at scale 0.5
  at every stage while the card tumbles freely.
