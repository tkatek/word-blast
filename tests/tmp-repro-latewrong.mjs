/** TEMP repro: late-wrong-answer test sequence with state tracing. */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const main = async () => {
  const h = await createHeadlessGame();
  await h.gotoLevel(1);
  await h.waitForState('AIMING', 8000);
  const sol = h.solveLanding(900);
  console.log('fire#1:', h.fire(sol.vx, sol.vy), h.state());
  console.log('resolve:', await h.waitForState('AIMING', 15000), h.state());
  const s = h.scene();
  const ball = h.liveBalls()[0];
  console.log('ball?', !!ball, 'shots', h.info().shotsLeft, 'sel', h.info().selectedProjectile,
    'ammo', JSON.stringify(h.info().birdAmmo));
  const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId);
  // deliver the resting ball onto the wrong target (same nudges the suite uses)
  const ok = await h.waitFor(() => wrong.wb && wrong.wb.hit === true, 15000);
  console.log('wrong hit?', ok, 'state', h.state());
  if (!ok) {
    // manual nudge loop (mirror of deliverOnto in the suite)
    for (let i = 0; i < 400 && !(wrong.wb && wrong.wb.hit); i++) {
      if (!ball.active) break;
      const dx = wrong.x - ball.x, dy = wrong.y - ball.y;
      const d = Math.hypot(dx, dy) || 1;
      ball.setVelocity(dx / d * 4, dy / d * 4 - 0.5);
      await new Promise((r) => setTimeout(r, 30));
    }
    console.log('after nudges: hit?', !!wrong.wb.hit, 'state', h.state());
  }
  console.log('back to AIMING?', await h.waitForState('AIMING', 12000), h.state());
  console.log('pre-fire2: state', h.state(), 'shots', h.info().shotsLeft,
    'sel', h.info().selectedProjectile, 'ammo', JSON.stringify(h.info().birdAmmo));
  const ok2 = h.fire(6, -6);
  console.log('fire#2:', ok2, 'state now', h.state());
  await h.destroy();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
