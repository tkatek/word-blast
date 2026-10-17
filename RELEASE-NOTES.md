# WORD BLAST — Tower Construction & Release Readiness Report

**Date:** 2026-10-17 · **Build:** production bundle in `dist/` (Vite, `base: './'`)
**Scope of this pass:** sprite-built towers on all 60 challenges, material-specific
destruction, reliable 4-question progression, mobile-safe behavior, and an
evidence-based release assessment. Produced jointly with a parallel work stream
(auto-committed on `main`); this file reports the verified state of the tree.

---

## 1. What changed (principal files)

| Area | Files |
|---|---|
| Asset pipeline | `public/assets/images/tower/**` (40 supplied 1× PNGs), `js/data/tower-assets.js` (manifest: key → file, material, measured content size, logical size, collider), `js/scenes/BootScene.js` (preload + procedural fallback + particle/fragment textures) |
| Tower system | `js/data/towers.js` (16 templates: pedestal…fortress), `scripts/check-towers.mjs` (SAT overlap/support/footprint checker), `scripts/generate-levels.mjs` (deterministic seeded generator with **verified arc reachability**), `js/data/levels.json` (60 regenerated layouts: 300 pieces, 24 pigs) |
| Physics & damage | `js/systems/PhysicsObjects.js` (terrain bodies, manifest pieces, dynamic plaques, pre-step closing-speed damage, pair cooldowns, idempotent destruction, bounded fragments, wake-on-support-removal, build-time settle, out-of-bounds plaque recovery, ability speed caps) |
| Scene & flow | `js/scenes/GameScene.js` (settle phase, one-answer-per-launch guard, feedback pacing 1.1–3.2 s, reduced-motion toggle, effects wiring), `js/systems/EffectsSystem.js` (material particles, capped emitters, shake policy), `js/config.js` (TERRAIN profiles, FEEDBACK, BUDGETS, TUNNELING guards) |
| Tests | `tests/baseline-playthrough.mjs` (smart legitimate-launch player), `tests/integration-battery.mjs` (13 edge-case checks), `tests/perf-probe.mjs`, `tests/trace-question.mjs`, `tests/slingshot-headless.mjs`, harness upgrades in `tests/helpers/headless-game.mjs` |

## 2. Tower construction decisions

- Every load-bearing piece is an **independent dynamic body** (sprite + fitting
  collider). Only terrain (plateau/terrace measured from each background art,
  `terrainFor(device)`) and the two movers are static.
- Templates stack with **exact face contact** — verified mechanically by
  `check-towers.mjs` (SAT overlap ≥1.5 px fails, floating pieces fail,
  declared footprint must enclose the real one). All 16 templates pass.
- Layouts bake to absolute piece lists in `levels.json` (id, asset key, x/y,
  rotation) — no construction code in the scene.
- **Build-time settle:** 75 silent physics steps with damage suppressed, then
  force-sleep. Measured across all 60 layouts: worst drift **1.2 px**, zero
  pieces lost (integration battery check #1).
- Answer plaques (`sign_blank_wood`) are **dynamic** bodies resting on the
  structures; labels ride the board via a follower container (position+rotation).

## 3. Physics, damage & anti-cheat decisions

- One authoritative update path (Phaser Matter auto-update; fixed 60 Hz
  runner accumulator, bounded catch-up). No parallel manual stepping.
- **Tunneling:** Matter has no CCD. Verified geometric mitigation: every piece
  min dimension ≥ 20 px and projectile speed caps (launch 24, boosted ≤ 24,
  split children ≤ 20) → a ball can never jump a piece in one step.
- Damage = closing speed along the contact line from **pre-step velocities** ×
  clamped opposite mass × factor; resting contact (<1.2) never damages;
  per-pair 120 ms cooldown; destruction idempotent (break/award/explode once).
- Support removal **wakes the bounded column above** (± piece width + 70 px,
  260 px up) — sleeping stacks fall when their support breaks.
- Explosions: bounded radius/power, linear falloff, once per crate, chain
  rate-limited to 3 per frame; plaques get pushed but never damaged/validated.
- Answers: only a live projectile of the current unresolved shot, by direct
  contact, max **one selection per launch** (wrong→correct ricochet ignored,
  split children share the guard). Old projectiles can never answer. Plaques
  that leave the world respawn at their anchor (max 3, never auto-answered).

## 4. Fairness engineering (answer-shuffle safety)

- Generator validates **every anchor** with the game's own trajectory solver:
  at least one launch angle must reach the plaque (center or upper half)
  without clipping any piece (or already-placed plaque) rising above its level.
- **Anti-shadowing spacing:** no two anchors within 210 px horizontally unless
  ≥ 80 px apart vertically (a front plaque otherwise eats every flat arc).
- Tiering per spec §10: L1–5 small wood + open lanes; L6–10 mixed materials,
  glass houses, shelter walls, bridges; L11–15 two-storey/glass/TNT/fortress
  combos, movers with swept-box clearance, timing lanes.
- Shot allowances tuned from measured automated pass rates: L1–6 and L11/13 → 4,
  L7–10/12/14/15 → 3 (L11–15 raised after 33–50 % bot failures at 2–3 shots).

## 5. Tests executed (actual results, this tree)

| Suite | Result |
|---|---|
| `npm test` (49 checks: content counts, CEFR, layouts, scoring, save, state machine, trajectory, anchors, reachability sweep, input mapping, device) | **49 passed, 0 failed** |
| `node scripts/check-towers.mjs` (template geometry) | **all templates valid** |
| `node tests/integration-battery.mjs` (13 real-Phaser checks: 60-layout settle soak, one-answer-per-launch, old-projectile rejection, pause freeze/resume, portrait freeze, 8× restart soak, plaque respawn) | **13 passed, 0 failed** |
| `node tests/baseline-playthrough.mjs` (full 15×4 playthrough, legitimate solved launches only) | **one full 15/15 completion (incl. GAME_COMPLETE), a 14/15 run, and every level passing in isolation (most repeatedly)**; per-run end-to-end ≈60–70 % — residual variance is scripted-player execution on shuffled/dynamic layouts (see §7) |
| Production build under subpath `/games/wordblast/` (static server, curl + browser boot + gameplay screenshot) | **loads & plays; sprites, backgrounds, slingshot, plaques all render** |
| Visual verification (browser screenshots + vision review) | intact towers on platforms, slingshot grounded, mid-collapse tumbling + fragments, settled debris, next-question load — all confirmed on early/mid/late levels |

## 6. Performance evidence

- Peak collapse (headless, real Matter): **12 concurrent bodies, 3 fragments**
  — far below the 40-piece/22-fragment budgets. Loop FPS avg **52.6**, min
  **47.6** during the collapse window (Canvas-on-shim render, CPU-bound).
- Restart soak: 8 scene restarts → body count constant (drift 0), no leaks.
- Browser-side FPS measurement in this environment is invalid (background
  timer throttling); real-device frame rates remain unverified (see checklist).

## 7. Release checklist

**Verified (evidence above)**
- 15 levels / 4 questions / 60 unique questions / 3 choices / stable IDs preserved.
- Towers stand reliably (1.2 px worst settle drift) and fall when supports break.
- All 180 answer anchors arc-reachable at generation time; no shadowing pairs.
- Question 1→2→3→4→(LEVEL|GAME)_COMPLETE progression without freezes; pause,
  orientation and restart preserve state; one answer per launch enforced.
- Production bundle builds and runs under a server subdirectory with all assets.
- Deterministic scoring/star thresholds intact; saves versioned & sanitized;
  reduced-motion setting persisted.

**Unverified (needs a human / real hardware)**
- Physical-device 60 FPS and touch feel: Android/iPhone/tablet landscape
  (only desktop in-app browser + headless Node were exercised — browser
  emulation is NOT device testing).
- Long-session soak (> ~10 min continuous play) and real audio design.
- Subjective fun/tuning of the late levels by a human player.

**Known gaps / failed (honest)**
- **No sound assets exist.** The audio event bus emits correct events
  (launch/hit/break/answers) but nothing plays. Sound design is NOT complete.
- Automated playthrough is still ~70–85 % per-run on the hardest tiers before
  exhausting shots (L14/L15 pass 2/3 runs each): every anchor is
  solver-reachable, but steep-only anchors are hard for the scripted player.
  Human aiming trials needed to confirm the tuning.
- The 2× asset pack was not shipped (interpolated duplicates add texture
  memory without detail — pack README's own warning).
- Repo hygiene: stray backslash-named duplicate files (`js/\systems\…`)
  created by an automation commit exist in git history; harmless at runtime
  (imports resolve the real paths) but should be pruned.

**Scope statement:** client-side game with local progress saving. No accounts,
leaderboards, database, or backend. Any real-user deployment needs separate
hosting/performance checks; no user-scale claims are made.

## 8. How to run

```bash
npm install
npm test                                   # 49 data/logic checks
node scripts/check-towers.mjs              # template geometry
node tests/integration-battery.mjs         # 13 real-physics edge cases
node tests/baseline-playthrough.mjs        # full 15-level automated play
npm run build                              # dist/ (relative base — subpath-safe)
```
