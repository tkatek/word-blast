import { readFileSync, writeFileSync } from 'node:fs';
const p = 'wb-ui-work/probe-pause.mjs';
let s = readFileSync(p, 'utf8');
const old = "    if (Date.now() - t0 > t) throw new Error('waitState ' + target + ' failed; now=' + st);";
if (!s.includes(old)) { console.log('anchor missing'); process.exit(1); }
const neu = [
  "    if (Date.now() - t0 > t) {",
  "      const vitals = await page.evaluate(() => ({",
  "        vis: document.visibilityState,",
  "        loopStopped: window.__WB__.game.loop.isStopped,",
  "        fps: Math.round(window.__WB__.game.loop.actualFps),",
  "        running: window.__WB__.isLoopRunning(),",
  "        frame: window.__WB__.game.loop.frame,",
  "        time: window.__WB__.game.loop.now",
  "      }));",
  "      // sample twice to see if frames advance",
  "      const f1 = vitals.frame; await new Promise((r) => setTimeout(r, 800));",
  "      const f2 = await page.evaluate(() => window.__WB__.game.loop.frame);",
  "      throw new Error('waitState ' + target + ' failed; now=' + st + ' vitals=' + JSON.stringify(vitals) + ' frameAdvance=' + (f2 - f1));",
  "    }"
].join('\n');
s = s.replace(old, neu);
writeFileSync(p, s);
console.log('patched5');
