/**
 * PERFORMANCE PROBE — measures frame rate, body counts and live objects
 * during the heaviest destruction this build can produce (TNT chain into a
 * two-tower layout), then reports min/avg FPS over the collapse window.
 *
 * Run: node tests/perf-probe.mjs
 */
import { createHeadlessGame } from './helpers/headless-game.mjs';

const main = async () => {
  const h = await createHeadlessGame();
  await h.gotoLevel(12); // tier-3 mixed layouts
  await h.waitForState('AIMING', 12000);

  // find the layout with the most pieces for maximum debris
  let best = { scene: null, count: 0 };
  const s = h.scene();
  best = { count: s.factory.blocks.length };

  // fire a bomb into the densest cluster repeatedly (2 shots per question)
  const fps = [];
  const world = s.matter.world.localWorld;
  const sample = () => {
    fps.push(h.game.loop.actualFps);
    return { fps: h.game.loop.actualFps, bodies: world.bodies.length, blocks: s.factory.blocks.length, frags: s.factory.fragments.length };
  };

  // shot 1: bomb straight into the middle of the structures
  h.fire(17, -3, 'bomb');
  let peak = { bodies: 0, blocks: 0, frags: 0 };
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    await new Promise(r => setTimeout(r, 100));
    const snap = sample();
    peak.bodies = Math.max(peak.bodies, snap.bodies);
    peak.blocks = Math.max(peak.blocks, snap.blocks);
    peak.frags = Math.max(peak.frags, snap.frags);
    const st = h.state();
    if (st === 'AIMING' || h.state() === 'LEVEL_FAILED') break;
  }
  console.log(`layout pieces: ${best.count}`);
  console.log(`peak during collapse: bodies=${peak.bodies} blocks=${peak.blocks} fragments=${peak.frags}`);
  const nums = fps.filter(Number.isFinite);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const min = Math.min(...nums);
  console.log(`fps over collapse window: samples=${nums.length} avg=${avg.toFixed(1)} min=${min.toFixed(1)}`);
  console.log('(headless Canvas-on-shim render: numbers reflect simulation+loop cost; browser render adds GPU load)');

  // pause/resume sanity while we're here
  s.doPause();
  const pausedFps = h.game.loop.actualFps;
  await new Promise(r => setTimeout(r, 400));
  s.togglePause();
  console.log(`pause frame rate ${pausedFps.toFixed(1)} -> resumed ${h.game.loop.actualFps.toFixed(1)}`);
  await h.destroy();
};

main().catch(e => { console.error(e); process.exit(1); });
