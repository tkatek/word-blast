/**
 * One-off headless boot check for the redesigned LevelSelectScene (Fix #23).
 * Boots the real game under Node (Canvas renderer, no network → procedural
 * fallbacks), starts the level select, and verifies structure + behaviour.
 *
 * Scene transitions use the REAL path (ScenePlugin.start, which stops the
 * current scene first) — SceneManager.start would run scenes in parallel
 * and skew the clock.
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

const h = await createHeadlessGame();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await h.waitFor(() => !!h.game.registry.get('questions'), 8000, 'boot');

  h.game.scene.start('LevelSelectScene');
  await h.waitFor(() => h.api.levelSelect().active, 5000, 'scene active');
  await sleep(300);

  let info = h.api.levelSelect();
  check('scene active with 15 cards', info.cards.length === 15, `${info.cards.length}`);
  check('grid is 5×3', info.grid.cols === 5 && info.grid.rows === 3, `${info.grid.cols}×${info.grid.rows}`);
  check('background fallback active headless', info.usingBackgroundArt === false);

  const c1 = info.cards.find((c) => c.id === 1);
  const c2 = info.cards.find((c) => c.id === 2);
  const c15 = info.cards.find((c) => c.id === 15);
  check('level 1 unlocked & highlighted', c1.unlocked && c1.highlighted);
  check('level 1 shows 0 stars (fresh)', c1.stars === 0);
  check('level 2 locked, not highlighted', !c2.unlocked && !c2.highlighted);
  check('level 15 locked', !c15.unlocked);
  check('highlightId is 1', info.highlightId === 1);
  check('no celebration on first visit', info.celebrationId === 0);

  const scene = h.game.scene.getScene('LevelSelectScene');
  const n1 = scene.cards.get(1).name.text;
  const n15 = scene.cards.get(15).name.text;
  check('names come from level data', n1 === 'First Shot' && n15 === 'Final Challenge', `${n1} | ${n15}`);

  // sequential unlock celebration — via the real back/re-enter path
  const save = h.game.registry.get('save');
  save.recordLevelResult(1, 5000, 2);
  scene.scene.start('MenuScene'); // ScenePlugin: stops LS first
  await h.waitFor(() => h.api.menu().active, 5000, 'menu');
  const menu = h.game.scene.getScene('MenuScene');
  menu.scene.start('LevelSelectScene');
  await h.waitFor(() => h.api.levelSelect().active, 5000, 'scene 2');
  info = h.api.levelSelect();
  check('returning visit detects genuinely-new unlock', info.celebrationId === 2, `celeb=${info.celebrationId}`);
  check('highlight moves to level 2', info.highlightId === 2);
  const card2 = scene.cards.get(2);
  check('celebration card starts in locked look', card2.unlocked === false);
  await sleep(1400 + 1100); // reveal at 1400ms scene-time, completes ~1980ms
  info = h.api.levelSelect();
  const c2b = info.cards.find((c) => c.id === 2);
  check('card 2 revealed unlocked after celebration', c2b.unlocked === true && c2b.highlighted === true);
  check('card 1 shows saved 2 stars', info.cards.find((c) => c.id === 1).stars === 2);

  // no re-animation on the next visit
  scene.scene.start('MenuScene');
  await h.waitFor(() => h.api.menu().active, 5000, 'menu 2');
  h.game.scene.getScene('MenuScene').scene.start('LevelSelectScene');
  await h.waitFor(() => h.api.levelSelect().active, 5000, 'scene 3');
  info = h.api.levelSelect();
  check('same unlock never re-animates', info.celebrationId === 0, `celeb=${info.celebrationId}`);

  const g = info.grid;
  const cards = info.cards;
  let overlap = false;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (Math.abs(cards[i].x - cards[j].x) < g.cardW && Math.abs(cards[i].y - cards[j].y) < g.cardH) overlap = true;
    }
  }
  const inside = cards.every((c) =>
    c.x - g.cardW / 2 >= 0 && c.x + g.cardW / 2 <= 1280 && c.y - g.cardH / 2 >= 0 && c.y + g.cardH / 2 <= 720);
  check('no card overlaps', !overlap);
  check('all cards inside the 1280×720 world', inside);

  check('headless boot: no exceptions', true);
} catch (e) {
  check('headless campaign', false, e.message);
} finally {
  await h.destroy();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n== levelselect headless: ${results.length - failed.length}/${results.length} passed ==`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(' | '));
  process.exitCode = 1;
}
process.exit(process.exitCode || 0);
