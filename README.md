# WORD BLAST — Gameplay Foundation (v0.1)

A physics-based English-learning game: Angry-Birds-style slingshot mechanics
combined with progressive English questions. **This build is the gameplay
foundation** — complete logic, physics, content, progression and persistence —
with a deliberately minimal debug interface. Final UI/art/audio come later,
plugged into the same systems.

Stack: HTML5 + CSS3 + JavaScript (ES modules) + **Phaser 3.90** (Matter.js
physics) + **Vite 6**. No backend required (LocalStorage; cloud-ready
persistence interface included).

## Quick start

```bash
npm install
npm run dev        # http://localhost:8080
npm test           # 37 automated Node tests (data, scoring, save, state machine…)
npm run build      # production bundle in dist/
```

## How to play

- **Drag** the ball on the slingshot backward, release to shoot.
- Each level asks **4 English questions**. Hit the target with the **correct**
  answer to advance. Hitting a wrong target or missing costs a shot.
- Run out of shots on a question → failure screen → *Retry Question* or
  *Restart Level*.
- Keyboard: `1-5` select projectile, `P` pause, `R` restart level, `M` menu.

## Game structure

| Element | Detail |
|---|---|
| Levels | 15, physics difficulty + CEFR A1→B1+ progression |
| Questions | 60 unique (4 per level), 3 choices, 1 correct, explanations |
| Projectiles | basic (L1+), speed (L4+), ice (L7+), split (L10+), bomb (L12+) |
| Materials | wood / glass / stone / explosive barrels, chain reactions |
| Scoring | deterministic: 1000/750/500/250 by attempt, −100 wrong hit, +150 per unused shot, +500 completion; 1–3 stars per level (thresholds in levels.json) |
| Persistence | versioned LocalStorage save with corruption sanitization; only better replays are kept |

## Architecture

```
js/
├── main.js               Phaser bootstrap (fixed 1280×720 world, FIT scaling,
│                         setTimeout-driven loop — runs even when occluded)
├── config.js             ALL tuning: physics, materials, projectiles, scoring,
│                         states, colors
├── scenes/
│   ├── BootScene.js      procedural textures, data validation, manager wiring
│   ├── MenuScene.js      debug menu (progress, reset save)
│   ├── LevelSelectScene.js  15-level grid, stars, locks
│   └── GameScene.js      gameplay orchestrator (state flow, collisions, HUD,
│                         overlays, pause, retry, victory)
├── systems/              ← all pure/testable in Node unless marked
│   ├── GameStateMachine.js   explicit states + legal transitions + pause stack
│   ├── Validators.js         question/level bank validation (boot + tests)
│   ├── QuestionManager.js    sequencing, strict by-ID answer checking
│   ├── LevelManager.js       level data access + cross-validation
│   ├── ScoringSystem.js      deterministic score/stars
│   ├── SaveManager.js        versioned save + LocalStorageAdapter (+ cloud iface)
│   ├── Trajectory.js         prediction + inverse solver (mirrors Matter math)
│   ├── InputMapper.js        client<->world coordinate mapping
│   ├── AudioManager.js       event bus (real audio attaches later)
│   ├── PhysicsObjects.js  ★  Matter body factory: blocks, targets, movers,
│   │                          projectiles, damage, explosions, freezing
│   └── Slingshot.js       ★  drag aiming, power clamp, trajectory dots
├── data/
│   ├── questions.json    60 questions
│   └── levels.json       15 levels × 4 question layouts (blocks/targets/movers)
└── dev/DebugAPI.js       window.__WB__ test hooks (simulateShot, autoAim,
                           waitForState, gotoLevel, step, mapClient…)
```
★ = Phaser-bound; everything else is dependency-free and covered by `npm test`.

### Key design decisions

- **Fixed logical world (1280×720)** — physics identical on every screen;
  Phaser FIT scaling handles responsiveness; touch/pointer handled by Phaser.
- **Bodies scale with the game object** in Phaser's Matter: bodies are created
  at texture size and `setDisplaySize` scales body+visual together. Never pass
  final-size shapes plus `setDisplaySize` (double-scaling bug — found the hard
  way during integration testing).
- **Answer validation is strict**: only an active player projectile of the
  current shot touching the target counts. Debris, explosions (targets are
  blast-immune), and later shots cannot answer. Validation locks after a
  correct answer until the next question.
- **Static answer targets** — always hittable; if rubble covers the correct
  target after a missed shot, a recovery sweep clears the covering blocks
  (never leaves the player stuck).
- **State machine guards everything**: no launch outside AIMING, no double
  transitions, pause stores/restores the exact prior state, restarts fully
  rebuild via scene lifecycle.

## Testing

- `npm test` — 37 Node tests: exact content counts (15/4/60/3/1), CEFR
  progression, layout validity, star-threshold feasibility, answer
  acceptance/rejection/duplicate-lock, deterministic scoring, save round-trips,
  corruption sanitization, unlock chain, state machine legality, trajectory
  solver accuracy, input mapping.
- Browser integration (run against `npm run dev` via the `window.__WB__` debug
  API): full Level-1 perfect play (score 6300 = theoretical max, 3 stars,
  save + unlock), wrong-answer penalty, miss recovery, out-of-shots failure →
  retry, pause/resume, restart reset, and a load+fire+resolve smoke of all 15
  levels. See `tests/MANUAL_CHECKLIST.md` for what still needs human eyes.

## Backend readiness (v2)

`SaveManager` talks to an injectable adapter. Ship cloud saves by implementing
the async `CloudSaveAdapter` interface documented in `SaveManager.js` — no
gameplay code changes needed.
