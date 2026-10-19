import { readFileSync, writeFileSync } from 'node:fs';
const p = 'wb-ui-work/probe-pause.mjs';
let s = readFileSync(p, 'utf8');
const oldBlock = "await page.evaluate(() => window.__WB__.gotoLevel(1));\nawait page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 30000 });";
const newBlock = [
  "await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });",
  "let okAiming = false;",
  "for (let i = 0; i < 80; i++) {",
  "  const st = await page.evaluate(() => window.__WB__.state());",
  "  if (st === 'AIMING') { okAiming = true; break; }",
  "  if (i % 10 === 0) console.log('poll state:', st);",
  "  await new Promise((r) => setTimeout(r, 500));",
  "}",
  "if (!okAiming) { console.log('NEVER AIMING'); process.exit(1); }"
].join('\n');
if (!s.includes(oldBlock)) {
  console.log('OLD BLOCK NOT FOUND');
  process.exit(1);
}
s = s.replace(oldBlock, newBlock);
writeFileSync(p, s);
console.log('patched2');
