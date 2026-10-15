/**
 * Body↔sprite sync audit: right after build + settle, compare each target's
 * body position against its sprite position.
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const main = async () => {
  const h = await createHeadlessGame();
  await h.gotoLevel(1);
  await h.waitForState('AIMING', 10000);
  const s = h.scene();
  for (const t of s.factory.targets) {
    console.log(`target ${t.wb.choiceId}: sprite=(${t.x.toFixed(0)},${t.y.toFixed(0)}) body=(${t.body.position.x.toFixed(0)},${t.body.position.y.toFixed(0)}) offset=(${(t.x - t.body.position.x).toFixed(0)},${(t.y - t.body.position.y).toFixed(0)}) anchor=(${t.wb.anchorX},${t.wb.anchorY})`);
  }
  for (const b of s.factory.blocks.slice(0, 6)) {
    console.log(`block ${b.wb.asset}: sprite=(${b.x.toFixed(0)},${b.y.toFixed(0)}) body=(${b.body.position.x.toFixed(0)},${b.body.position.y.toFixed(0)})`);
  }
  await h.destroy();
};

main().catch(e => { console.error(e); process.exit(1); });
