# FINAL UI/UX POLISH — cohesive cartoon adventure presentation

Final pass over the player-facing interface only. **No gameplay system was
touched**: the 15 levels, 60 questions, bird abilities and inventory,
slingshot physics, tower physics, scoring, unlocking and SaveManager
behavior are exactly as before (full suite green: 67 unit · 15 integration
· 16 lifecycle · 26 ammo · 1357 panel battery · 15 question-card · 56
audio · production build OK).

Verification: `scripts/ui-polish-screenshots.mjs` drives the REAL built
game in a browser — **19/19 acceptance checks pass**, with all screens
captured to `screenshots/ui-polish/` (desktop 1536×864, tablet 1180×820,
phone 844×390).

## 1. Main menu — PLAY is now the hero action
`js/systems/MenuUI.js`, `js/scenes/MenuScene.js`
- PLAY bar widened 350 → 440 world px (height follows the supplied art's
  aspect ≈ 100) with a **golden** play triangle (`drawPlayIcon` gained
  fill/edge params; `PLAY_ICON_GOLD` tokens) and the existing cream text,
  leaves, shine, hover/press animations and rapid-click guard.
- RESET SAVE is smaller (200×48), reduced opacity — still confirmed by the
  existing dialog before anything is erased.

## 2. Top HUD — bigger where the player looks
`js/systems/HudLayout.js`, `js/systems/GameHUD.js`
- The 1280-wide row is a zero-sum budget: the center progress panel
  (Q · clock · stars) grew 66 → 73 and the hearts/shots/score counters
  54 → 60; the level plaque and round buttons gave the width back.
- Typography followed the panels: timer 21 → **24 px** desktop (22 phone),
  hearts 24 → 27, shots/score 15 → 18, stars 12.5 → 14.
- All existing guarantees re-verified by the unit tests: row fits the
  world with ≥9 px gaps, band stays under the question-card dock
  (bandBottom 77 ≤ 80), phone touch targets ≥ 44 CSS px, aspects never
  stretched.

## 3. Answer feedback — compact, still complete
`js/systems/FeedbackCard.js`
- Card shrunk 560×400 → **406×290** world px (72.5% of the old width;
  artwork aspect 1.4 preserved — nothing stretches).
- The existing measured-text fitting ladder grows the card only when a
  long explanation needs it (cap 1.55 ≈ 630 px, below the old 683 growth).
- All 120 question explanations still fit at ≥ 14 px display font (the
  suite's readability floor); everything else (green/red headers, badge,
  disabled-until-settled CONTINUE/TRY AGAIN, one-action guard) unchanged.

## 4. Pause — minimal blur-and-grayscale freeze
`js/systems/GameHUD.js`, `js/scenes/GameScene.js`
- The old settings-list menu (Resume / Restart Question / Restart Level /
  Sound / Music / FX / Exit / Reduced Motion) is gone.
- Pausing freezes everything as before, then applies **grayscale + soft
  blur post-fx to the gameplay camera only** — the HUD's own camera stays
  sharp and colored. Mobile uses the cheaper blur tier; Canvas sessions
  fall back to a deeper dim. Applied once per pause, removed on resume.
- The overlay shows a small PAUSED title, **one large circular wooden
  RESUME button with a golden play triangle** (pop-in, hover/press states,
  subtle glow) and one small confirmed EXIT TO LEVELS control.
- Sound stays reachable through the top bar's existing sound button; P and
  now ESC pause/resume (ESC cancels the exit confirmation first).

## 5. Victory screen — joined the visual system
`js/scenes/GameScene.js`
- Was plain text on a black scrim; now the same wooden panel + parchment
  as every other popup, a green chunky title, three **drawn** gold stars
  that pop in with the audio chimes, and the existing wood buttons.

## 6. Level select
Verified end-to-end (already rebuilt in the Fix #23 round): 15 wooden
cards 5×3, illustrated padlocks, saved stars, golden next-playable glow,
locked cards non-navigable — all re-checked in this pass's screenshots.

## Test note
`tests/audio-tests.mjs` — the restart test compared raw `{event,…}`
objects against the string `'launch'` (always 0 matches); fixed to compare
`e.event`, matching the identical assertion thirteen lines above. The
game's one-launch-per-shot behavior was never wrong.
