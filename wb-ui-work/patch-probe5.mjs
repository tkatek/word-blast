import { readFileSync, writeFileSync } from 'node:fs';
const p = 'wb-ui-work/probe-pause.mjs';
let s = readFileSync(p, 'utf8');
const old = "      const vitals = await page.evaluate(() => ({";
if (!s.includes(old)) { console.log('anchor missing'); process.exit(1); }
s = s.replace(old, [
  "      const cardDump = await page.evaluate(() => JSON.stringify(window.__WB__.cardInfo()));",
  "      const pausedDump = await page.evaluate(() => window.__WB__.scene().stateMachine.isPaused());",
  "      console.log('CARD AT STALL:', cardDump, 'isPaused:', pausedDump);",
  "      const vitals = await page.evaluate(() => ({"
].join('\n'));
writeFileSync(p, s);
console.log('patched6');
