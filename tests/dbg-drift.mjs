import { createHeadlessGame } from './helpers/headless-game.mjs';
const h = await createHeadlessGame();
await h.gotoLevel(13);
const s = h.scene();
const layout = s.levels.getLayout(13, 3);
s.factory.clearQuestionObjects();
s.factory.buildLayout(layout);
const start = new Map();
for (const b of s.factory.blocks) start.set(b, { x: b.x, y: b.y });
s.factory.settleLayout(75);
for (const b of s.factory.blocks) {
  const d0 = start.get(b);
  const d = Math.hypot(b.x - d0.x, b.y - d0.y);
  if (d > 1) console.log(b.wb.asset, 'drift', d.toFixed(1), 'from', d0.x.toFixed(0) + ',' + d0.y.toFixed(0), 'to', b.x.toFixed(0) + ',' + b.y.toFixed(0), 'angle', (b.angle * 180 / Math.PI).toFixed(1));
}
await h.destroy();
