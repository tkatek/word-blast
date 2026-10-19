import { readFileSync, writeFileSync } from 'node:fs';
const p = 'wb-ui-work/probe-pause.mjs';
let s = readFileSync(p, 'utf8');
const old = "await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });";
if (!s.includes(old)) { console.log('anchor missing'); process.exit(1); }
s = s.replace(old, [
  "await page.evaluate(() => {",
  "  window.__WB__.setAutoPause(false);",
  "  window.__WB__.setCardTimings({ enterMs: 150, readingMs: 900, moveMs: 250, exitMs: 120, peekMs: 150 });",
  "  window.__WB__.gotoLevel(1);",
  "});"
].join('\n'));
writeFileSync(p, s);
console.log('patched7');
