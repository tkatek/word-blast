/** TEMP repro: freeze-regression sequence with lifecycle tracing. */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const h = await createHeadlessGame();
  await h.gotoLevel(3);
  await h.waitForState('AIMING', 8000);
  const s = h.scene();
  console.log('armed: settling=', s.factory.settling, 'blocks=', s.factory.blocks.length,
    'asleep=', s.factory.blocks.filter((b) => b.body.isSleeping).length);

  const landX = 420; // short lob well short of the towers
  const sol = h.solveLanding(landX);
  console.log('fire:', h.fire(sol.vx, sol.vy));
  let armed = false;
  for (let i = 0; i < 700 && !armed; i++) {
    armed = h.state() === 'AIMING';
    if (i % 60 === 0) {
      const info = h.info();
      console.log(`t${i}: state=${h.state()} shots=${info.shotsLeft} balls=${h.liveBalls().length}`,
        `settling=${s.factory.settling} blocks=${s.factory.blocks.length}`);
    }
    await sleep(20);
  }
  console.log('re-armed:', armed, 'state', h.state());
  const balls = h.liveBalls();
  console.log('balls after re-arm:', balls.length,
    balls.map((b) => ({ x: +b.x.toFixed(0), y: +b.y.toFixed(0), consumed: b.wb.consumed })));
  await h.destroy();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
