import { createHeadlessGame } from '../../tests/helpers/headless-game.mjs';

const h = await createHeadlessGame();
await h.gotoLevel(3);
await h.waitForState('AIMING', 8000);
const s = h.scene();
console.log('targets:', s.factory.targets.map(t => ({ x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.displayWidth), id: t.wb.choiceId })));
console.log('blocks leftmost:', Math.min(...s.factory.blocks.map(b => b.x - b.displayWidth / 2)));
const structLeft = Math.min(
  ...s.factory.targets.map((t) => t.x - 70),
  ...s.factory.blocks.map((b) => b.x - b.displayWidth / 2)
);
const landX = Math.max(320, Math.min(500, structLeft - 120));
console.log('landX:', landX);
const sol = h.solveLanding(landX);
console.log('sol:', sol && { vx: sol.vx.toFixed(1), vy: sol.vy.toFixed(1) });
s.stateChangeHandlers.push((next, prev) => console.log('STATE', prev, '->', next));
const origRoute = s.routeProjectileImpact.bind(s);
s.routeProjectileImpact = (a, b) => {
  const go = a.gameObject;
  if (go && go.wb && go.wb.kind === 'projectile') {
    const other = b.gameObject;
    if (other && other.wb && other.wb.kind === 'target') console.log('TOUCH target', other.wb.choiceId, 'at state', s.stateMachine.current);
  }
  return origRoute(a, b);
};
h.fire(sol.vx, sol.vy);
await h.waitForState('AIMING', 15000);
console.log('after re-arm: questionIndex', s.questionIndex, 'consumed projectiles:', s.factory.projectiles.filter(p => p.wb.consumed).length, 'live:', s.factory.projectiles.filter(p => !p.wb.consumed).length);
const ball = h.liveBalls()[0];
console.log('ball:', ball ? { x: Math.round(ball.x), y: Math.round(ball.y) } : 'GONE');
process.exit(0);
